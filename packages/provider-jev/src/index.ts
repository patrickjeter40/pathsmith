import {
  canonicalize,
  immutable,
  PathsmithError,
  PathsmithDeadlineError,
  validateResponse,
  validUsage,
  type EvaluationRequest,
  type EvaluationResponse,
  type JudgmentProvider,
  type ProviderAttemptResult,
  type ProviderContext,
  type Usage,
} from "@pathsmith/core";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export interface JevOptions {
  apiKey: string;
  /** Injection seam for offline contract tests; production uses global fetch. */
  fetch?: typeof globalThis.fetch;
  maxAttempts?: number;
  attemptTimeoutMs?: number;
  baseBackoffMs?: number;
  random?: () => number;
}

// Shared across every adapter instance in this process, including separate suite calls.
let inFlight = 0;
const waiting: (() => void)[] = [];
async function acquire(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw signal.reason;
  if (inFlight >= 4) {
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener("abort", cancel);
        resolve();
      };
      const cancel = () => {
        const index = waiting.indexOf(ready);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener("abort", cancel, { once: true });
      waiting.push(ready);
    });
  } else inFlight++;
  if (signal.aborted) {
    release();
    throw signal.reason;
  }
  return release;
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else inFlight--;
}

export function createJevProvider(options: JevOptions): JudgmentProvider {
  if (
    typeof options.apiKey !== "string" ||
    !options.apiKey.trim() ||
    /[\r\n]/.test(options.apiKey)
  )
    throw new PathsmithError(
      "PROVIDER_NOT_CONFIGURED",
      "A server-side TypeSafe API key is required",
    );
  const apiKey = options.apiKey.trim();
  const fetcher = options.fetch ?? globalThis.fetch;
  const maxAttempts = options.maxAttempts ?? 3;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 10_000;
  const baseBackoffMs = options.baseBackoffMs ?? 250;
  const random = options.random ?? Math.random;
  for (const [value, minimum, maximum] of [
    [maxAttempts, 1, 3],
    [attemptTimeoutMs, 1, 10_000],
    [baseBackoffMs, 0, 1_000],
  ])
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new PathsmithError(
        "PROVIDER_NOT_CONFIGURED",
        "Jev retry settings exceed supported bounds",
      );
  return {
    id: "jev",
    version: "0.1.0",
    normalizerVersion: "0.1.0",
    origin: "live",
    async evaluate(request, context) {
      if (
        typeof context.onAttemptStarted !== "function" ||
        typeof context.onAttemptFinished !== "function"
      )
        throw new PathsmithError(
          "PROVIDER_NOT_CONFIGURED",
          "Live execution requires observable transport accounting",
        );
      const body = JSON.stringify(toJevRequest(request));
      if (Buffer.byteLength(body, "utf8") > 128 * 1024)
        throw new PathsmithError(
          "RUN_LIMIT_EXCEEDED",
          "Jev request exceeds its byte limit",
        );
      if (containsSecret(request, apiKey))
        throw new PathsmithError(
          "PROVIDER_NOT_CONFIGURED",
          "Provider credential must not appear in request content",
        );
      const deadlineAt = Math.min(context.deadlineAt, Date.now() + 30_000);
      if (!Number.isFinite(deadlineAt))
        throw new PathsmithError(
          "PROVIDER_NOT_CONFIGURED",
          "A scenario deadline is required",
        );
      const responseLimit = Math.min(context.responseByteLimit, 512 * 1024);
      if (!Number.isSafeInteger(responseLimit) || responseLimit < 1)
        throw new PathsmithError(
          "PROVIDER_NOT_CONFIGURED",
          "A bounded response size is required",
        );
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        check(context, deadlineAt);
        const deadlineSignal = AbortSignal.timeout(
          Math.max(1, Math.ceil(deadlineAt - Date.now())),
        );
        const parentSignal = AbortSignal.any([context.signal, deadlineSignal]);
        let free: () => void;
        try {
          free = await acquire(parentSignal);
        } catch {
          check(context, deadlineAt);
          throw new PathsmithDeadlineError("Scenario deadline exceeded before HTTP dispatch");
        }
        try {
          check(context, deadlineAt);
          context.onAttemptStarted(attempt);
        } catch (error) {
          free();
          throw error;
        }
        const started = performance.now();
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), attemptTimeoutMs);
        const signal = AbortSignal.any([parentSignal, timeout.signal]);
        let response: EvaluationResponse | undefined;
        let failure: PathsmithError | undefined;
        let retryable = false;
        let retryAfter: number | null = null;
        const record: ProviderAttemptResult = {
          attempt,
          status: "failed",
          httpStatus: null,
          errorCode: null,
          elapsedMs: 0,
          usage: null,
          requestedModel: request.model,
          resolvedModel: null,
        };
        try {
          const http = await abortable(
            fetcher(JEV_ENDPOINT, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body,
              signal,
              redirect: "manual",
            }),
            signal,
          );
          record.httpStatus = http.status;
          if (!http.ok) {
            // Error bodies can contain reflected credentials or inputs; retain only status/category.
            void http.body?.cancel().catch(() => {});
            retryable = [429, 500, 502, 503, 504, 529].includes(http.status);
            retryAfter = parseRetryAfter(http.headers.get("retry-after"));
            throw new PathsmithError(
              http.status === 401 || http.status === 403
                ? "PROVIDER_AUTH_ERROR"
                : http.status === 429
                  ? "PROVIDER_RATE_LIMITED"
                  : retryable
                    ? "PROVIDER_UNAVAILABLE"
                    : "PROVIDER_REQUEST_ERROR",
              "Jev returned an unsuccessful HTTP status",
            );
          }
          const raw = await readJson(http, responseLimit, signal);
          try {
            canonicalize(raw);
          } catch {
            throw invalid("Provider response is not safe bounded JSON");
          }
          if (containsSecret(raw, apiKey))
            throw invalid("Provider response contains credential material");
          const rawObject = object(raw);
          record.usage = normalizeUsage(rawObject.usage);
          record.resolvedModel =
            typeof rawObject.model === "string" ? rawObject.model : null;
          response = normalizeJevResponse(request, raw, responseLimit);
          record.status = "succeeded";
        } catch (error) {
          if (context.signal.aborted) {
            failure = new PathsmithError(
              "RUN_CANCELED",
              "Live request was canceled",
            );
            record.status = "canceled";
          } else if (Date.now() >= deadlineAt || deadlineSignal.aborted) {
            failure = new PathsmithDeadlineError("Scenario deadline exceeded");
          } else if (timeout.signal.aborted) {
            failure = new PathsmithError(
              "PROVIDER_TIMEOUT",
              "Jev attempt timed out",
            );
            retryable = true;
          } else if (error instanceof PathsmithError) failure = error;
          else {
            failure = new PathsmithError(
              "PROVIDER_UNAVAILABLE",
              "Jev transport failed",
            );
            retryable = true;
          }
          if (
            record.status === "canceled" ||
            failure.code === "RUN_LIMIT_EXCEEDED"
          )
            retryable = false;
          record.errorCode = failure.code;
        } finally {
          clearTimeout(timer);
          free();
          record.elapsedMs = performance.now() - started;
        }
        // Callback failures never enter the retry loop.
        context.onAttemptFinished(immutable(record));
        if (response) return response;
        if (!retryable || attempt === maxAttempts) throw failure!;
        check(context, deadlineAt);
        const jitter = random();
        if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1)
          throw new PathsmithError(
            "PROVIDER_NOT_CONFIGURED",
            "Invalid retry jitter source",
          );
        const backoff =
          baseBackoffMs * 2 ** (attempt - 1) * (0.75 + 0.5 * jitter);
        const delay = retryAfter ?? backoff;
        if (delay >= deadlineAt - Date.now())
          throw new PathsmithDeadlineError("Retry delay exceeds remaining scenario deadline");
        await wait(delay, context.signal);
      }
      throw new PathsmithError(
        "PROVIDER_UNAVAILABLE",
        "Jev attempts exhausted",
      );
    },
  };
}

export function toJevRequest(request: EvaluationRequest) {
  // The canonical runtime already validates questions; enforce the documented vendor caps here too.
  canonicalize(request);
  const questions = Object.fromEntries(
    Object.entries(request.questions).map(([id, q]) => {
      if (q.kind === "choice") {
        if (Object.keys(q.options).length > 255)
          throw new PathsmithError(
            "PROVIDER_REQUEST_ERROR",
            "Choice exceeds Jev option limit",
          );
        return [
          id,
          { type: "choice", instructions: q.instructions, criteria: q.options },
        ];
      }
      if (q.kind === "score") {
        if (q.levels.length < 2 || q.levels.length > 10)
          throw new PathsmithError(
            "PROVIDER_REQUEST_ERROR",
            "Score requires between 2 and 10 levels",
          );
        return [
          id,
          { type: "score", instructions: q.instructions, criteria: q.levels },
        ];
      }
      const criteria = {
        ...(q.trueCriteria !== undefined ? { true: q.trueCriteria } : {}),
        ...(q.falseCriteria !== undefined ? { false: q.falseCriteria } : {}),
      };
      return [
        id,
        {
          type: "noul",
          instructions: q.instructions,
          ...(Object.keys(criteria).length ? { criteria } : {}),
        },
      ];
    }),
  );
  return { state: request.state, model: request.model, questions };
}

export function normalizeJevResponse(
  request: EvaluationRequest,
  value: unknown,
  limit = 512 * 1024,
): EvaluationResponse {
  try {
    const encoded = canonicalize(value);
    if (Buffer.byteLength(encoded, "utf8") > limit)
      throw invalid("Provider response exceeds its byte limit");
    const raw = object(value),
      sourceAnswers = object(raw.answers);
    if (
      Object.keys(sourceAnswers).sort().join("\0") !==
      Object.keys(request.questions).sort().join("\0")
    )
      throw invalid("Answer IDs do not match requested questions");
    const answers = Object.fromEntries(
      Object.entries(request.questions).map(([id, q]) => {
        const a = object(sourceAnswers[id]);
        if (a.type !== (q.kind === "binary" ? "noul" : q.kind))
          throw invalid("Provider answer kind does not match its question");
        if (q.kind === "binary")
          return [id, { kind: "binary", probabilityTrue: a.noul }];
        if (q.kind === "score") {
          const legend = object(a.legend);
          if (
            Object.keys(legend).sort().join("\0") !==
              q.levels
                .map((_, i) => String(i))
                .sort()
                .join("\0") ||
            Object.values(legend).some((v) => typeof v !== "string")
          )
            throw invalid("Score legend does not match its level indexes");
        }
        return [
          id,
          {
            kind: q.kind,
            value: q.kind === "choice" ? a.choice : a.score,
            probabilities: a.probabilities,
            confidence: a.confidence,
          },
        ];
      }),
    );
    const response = {
      model: raw.model,
      answers,
      usage: normalizeUsage(raw.usage),
      raw: value,
    } as EvaluationResponse;
    validateResponse(request, response, limit);
    return immutable(response);
  } catch {
    throw invalid("Jev response failed typed validation");
  }
}
function normalizeUsage(value: unknown): Usage | null {
  if (value === undefined || value === null) return null;
  const source = object(value);
  const usage = {
    inputTokens: source.input_tokens,
    outputTokens: source.output_tokens,
  };
  if (!validUsage(usage)) throw invalid("Invalid provider token usage");
  return usage;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid("Expected a provider object");
  return value as Record<string, unknown>;
}
function invalid(message: string): PathsmithError {
  return new PathsmithError("PROVIDER_INVALID_RESPONSE", message);
}
function containsSecret(value: unknown, secret: string): boolean {
  if (typeof value === "string") return value.includes(secret);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) => key.includes(secret) || containsSecret(child, secret),
  );
}
function check(context: ProviderContext, deadlineAt: number) {
  if (context.signal.aborted)
    throw new PathsmithError("RUN_CANCELED", "Live request was canceled");
  if (Date.now() >= deadlineAt)
    throw new PathsmithDeadlineError("Scenario deadline exceeded");
}
function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    const ms = Number(value) * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  if (
    !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value.trim(),
    )
  )
    return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}
async function readJson(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw invalid("Provider response has no body");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit)
        throw invalid("Provider response exceeds its byte limit");
      parts.push(value);
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)),
      );
    } catch {
      throw invalid("Provider response is not JSON");
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let cancel = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener("abort", cancel, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
async function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted)
    throw new PathsmithError("RUN_CANCELED", "Canceled during retry backoff");
  let timer: ReturnType<typeof setTimeout>;
  try {
    await abortable(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
      signal,
    );
  } catch {
    throw new PathsmithError("RUN_CANCELED", "Canceled during retry backoff");
  } finally {
    clearTimeout(timer!);
  }
}
