import type { Answer, Json, Question } from "@pathsmith/contracts";
import { hash } from "./hash.js";
export type ExecutionMode = "mock" | "replay" | "live";
export interface EvaluationRequest {
  model: string;
  state: string | Json[] | Record<string, Json>;
  questions: Record<string, Question>;
}
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export interface EvaluationResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: Usage | null;
  /** Bounded original provider body, never headers; unavailable for synthetic mocks. */
  raw?: Json;
  /** Aggregate historical call usage supplied only by a recorded replay adapter. */
  historicalUsage?: Usage | null;
}
export interface ProviderAttemptResult {
  attempt: number;
  status: "succeeded" | "failed" | "canceled";
  httpStatus: number | null;
  errorCode: string | null;
  elapsedMs: number;
  usage: Usage | null;
  requestedModel: string;
  resolvedModel: string | null;
}
export interface ProviderAttemptRecord extends Omit<
  ProviderAttemptResult,
  "status"
> {
  status: ProviderAttemptResult["status"] | "in_flight";
  nodeId: string;
  binding: string;
  fingerprint: string;
}
export interface HttpAttemptBudget {
  remaining: number;
}
export interface ProviderContext {
  signal: AbortSignal;
  runId: string;
  scenarioId: string | null;
  nodeId: string;
  binding: string;
  requestFingerprint: string;
  sourceRunId: string | null;
  deadlineAt: number;
  responseByteLimit: number;
  onAttemptStarted(attempt: number): void;
  onAttemptFinished(attempt: ProviderAttemptResult): void;
}
export interface JudgmentProvider {
  id: string;
  version: string;
  normalizerVersion: string;
  origin: "synthetic" | "live";
  /** Original identity is preserved; this marker enforces explicit replay mode. */
  replay?: { sourceRunId: string };
  evaluate(
    request: EvaluationRequest,
    context: ProviderContext,
  ): Promise<EvaluationResponse>;
}
export interface ProviderBinding {
  providerId: string;
  model: string;
  adapter: JudgmentProvider;
}
export type Bindings = Record<string, ProviderBinding>;
export interface Exchange {
  runId: string;
  scenarioId: string | null;
  nodeId: string;
  binding: string;
  providerId: string;
  adapterVersion: string;
  normalizerVersion: string;
  origin: "synthetic" | "live";
  fingerprint: string;
  request: EvaluationRequest;
  response: EvaluationResponse;
  elapsedMs: number;
  actualHttpAttempts: number;
  /** Aggregate current call usage, including retries; null if any attempt is unknown. */
  usage?: Usage | null;
  sourceRunId?: string;
  historicalUsage?: Usage | null;
}

export function requestFingerprint(
  identity: {
    providerId: string;
    adapterVersion: string;
    normalizerVersion: string;
  },
  request: EvaluationRequest,
): string {
  return hash({
    providerId: identity.providerId,
    adapterVersion: identity.adapterVersion,
    normalizerVersion: identity.normalizerVersion,
    request,
  });
}

/** Unknown usage poisons the total; an empty cohort has no measured usage. */
export function sumUsage(values: (Usage | null)[]): Usage | null {
  if (!values.length || values.some((value) => value === null)) return null;
  return values.reduce<Usage>(
    (sum, value) => ({
      inputTokens: sum.inputTokens + value!.inputTokens,
      outputTokens: sum.outputTokens + value!.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}
