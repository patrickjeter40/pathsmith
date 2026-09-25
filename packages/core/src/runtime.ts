import { randomUUID } from "node:crypto";
import {
  byteLength,
  inspectJson,
  validateAnswers,
  validateData,
  validateProfile,
  validateWorkflow,
  type Expr,
  type Json,
  type Workflow,
  type WorkflowNode,
} from "@pathsmith/contracts";
import {
  assertValid,
  immutable,
  PathsmithError,
  toExecutionError,
  type ExecutionError,
} from "./error.js";
import { evaluateExpression, type ExpressionStep } from "./expression.js";
import { hash, workflowHashes } from "./hash.js";
import type {
  Bindings,
  EvaluationRequest,
  EvaluationResponse,
  Exchange,
} from "./provider.js";

export const RUNTIME_VERSION = "0.1.0";
export interface ExecutionLimits {
  expressionOperations: number;
  scenarioDeadlineMs: number;
  providerRequestBytes: number;
  providerResponseBytes: number;
  computedValueBytes: number;
  scenarioArtifactBytes: number;
}
export const DEFAULT_LIMITS: ExecutionLimits = {
  expressionOperations: 10_000,
  scenarioDeadlineMs: 30_000,
  providerRequestBytes: 128 * 1024,
  providerResponseBytes: 512 * 1024,
  computedValueBytes: 512 * 1024,
  scenarioArtifactBytes: 8 * 1024 * 1024,
};
export function resolveLimits(
  input: Partial<ExecutionLimits> = {},
): ExecutionLimits {
  const limits = { ...DEFAULT_LIMITS, ...input };
  for (const [key, value] of Object.entries(limits))
    if (
      !Object.hasOwn(DEFAULT_LIMITS, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > DEFAULT_LIMITS[key as keyof ExecutionLimits]
    )
      throw new PathsmithError(
        "RUN_LIMIT_EXCEEDED",
        "Limits must be positive integers within supported defaults",
      );
  return limits;
}
export interface TraceEvent {
  sequence: number;
  kind: string;
  elapsedMs: number;
  nodeId?: string;
  data: Json;
}
interface ExecutionBase {
  runId: string;
  scenarioId: string | null;
  input: Json;
  outputs: Record<string, Json>;
  visitedNodes: string[];
  selectedEdges: string[];
  logicalJudgments: number;
  actualHttpAttempts: number;
  replayedJudgments: number;
  usage: null;
  elapsedMs: number;
  events: TraceEvent[];
  exchanges: Exchange[];
  observerErrors: number;
  workflowSemanticHash: string;
  artifactHash: string;
}
export type ExecutionResult = ExecutionBase &
  (
    | { status: "completed"; result: { outcomeId: string; value: Json } }
    | { status: "failed" | "canceled"; error: ExecutionError }
  );
export interface ExecuteOptions {
  workflow: Workflow;
  input: Json;
  bindings: Bindings;
  mode: "mock";
  runId?: string;
  scenarioId?: string | null;
  signal?: AbortSignal;
  limits?: Partial<ExecutionLimits>;
  trace?: boolean;
  onEvent?: (event: TraceEvent) => void;
  observerErrorPolicy?: "ignore" | "fail";
}

/** Snapshot public binding metadata without copying any adapter-private configuration. */
export function snapshotBindings(bindings: Bindings): Bindings {
  return Object.fromEntries(
    Object.entries(bindings).map(([name, b]) => [
      name,
      Object.freeze({
        providerId: b.providerId,
        model: b.model,
        adapter: Object.freeze({
          id: b.adapter.id,
          version: b.adapter.version,
          normalizerVersion: b.adapter.normalizerVersion,
          origin: b.adapter.origin,
          evaluate: b.adapter.evaluate.bind(b.adapter),
        }),
      }),
    ]),
  );
}

export async function executeWorkflow(
  options: ExecuteOptions,
): Promise<ExecutionResult> {
  // Preflight is never delegated to adapters and never emits a model request.
  assertValid(validateWorkflow(options.workflow));
  assertValid(
    validateData(options.workflow.inputSchema, options.input),
    "INPUT_INVALID",
  );
  if (byteLength(options.input) > 64 * 1024)
    throw new PathsmithError("INPUT_INVALID", "Input exceeds 64 KiB");
  if (options.mode !== "mock")
    throw new PathsmithError(
      "PROVIDER_NOT_CONFIGURED",
      "This milestone supports mock execution only",
    );
  const workflow = immutable(options.workflow),
    input = immutable(options.input),
    limits = resolveLimits(options.limits),
    bindings = snapshotBindings(options.bindings);
  const profile = {
    formatVersion: "0.1",
    bindings: Object.fromEntries(
      Object.entries(bindings).map(([name, b]) => [
        name,
        { providerId: b.providerId, model: b.model },
      ]),
    ),
  };
  assertValid(validateProfile(profile, workflow), "PROVIDER_NOT_CONFIGURED");
  for (const node of workflow.nodes)
    if (node.kind === "judgment") {
      const b = bindings[node.binding];
      if (
        b.adapter.id !== b.providerId ||
        b.adapter.origin !== "synthetic" ||
        b.providerId !== "mock"
      )
        throw new PathsmithError(
          "PROVIDER_NOT_CONFIGURED",
          "Mock mode requires an explicit synthetic mock adapter",
        );
    }
  const runId = options.runId ?? randomUUID(),
    scenarioId = options.scenarioId ?? null,
    started = performance.now();
  const outputs: Record<string, Json> = {},
    visitedNodes: string[] = [],
    selectedEdges: string[] = [],
    events: TraceEvent[] = [],
    exchanges: Exchange[] = [];
  let logicalJudgments = 0,
    sequence = 0,
    observerErrors = 0,
    activeNode: string | undefined;
  let retainedBytes = 0;
  const reserve = (value: unknown, maxBytes = limits.computedValueBytes) => {
    const bytes = byteLength(value, maxBytes);
    if (
      !Number.isFinite(bytes) ||
      retainedBytes + bytes > limits.scenarioArtifactBytes
    )
      throw new PathsmithError(
        "RUN_LIMIT_EXCEEDED",
        "Computed value or scenario artifact exceeds its byte budget",
      );
    retainedBytes += bytes;
  };
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new PathsmithError("RUN_CANCELED", "Run was canceled"));
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new PathsmithError("RUN_LIMIT_EXCEEDED", "Scenario deadline exceeded"),
      ),
    limits.scenarioDeadlineMs,
  );
  const check = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (performance.now() - started > limits.scenarioDeadlineMs)
      throw new PathsmithError(
        "RUN_LIMIT_EXCEEDED",
        "Scenario deadline exceeded",
      );
  };
  const emit = (kind: string, data: unknown = {}, nodeId = activeNode) => {
    const event: TraceEvent = {
      sequence: ++sequence,
      kind,
      elapsedMs: performance.now() - started,
      ...(nodeId ? { nodeId } : {}),
      data: data as Json,
    };
    if (!options.trace && !options.onEvent) return;
    // Preserve small terminal diagnostics after the ordinary artifact budget fills.
    if (!["node_failed", "run_failed", "run_canceled"].includes(kind))
      reserve(event, limits.scenarioArtifactBytes);
    if (options.trace) events.push(immutable(event));
    if (options.onEvent)
      try {
        options.onEvent(immutable(event));
      } catch {
        observerErrors++;
        if (options.observerErrorPolicy === "fail")
          throw new PathsmithError(
            "STORAGE_ERROR",
            "Required trace observer failed",
          );
      }
  };
  const budget = { remaining: limits.expressionOperations };
  const evaluate = (expr: Expr, steps?: ExpressionStep[]) =>
    evaluateExpression(
      expr,
      { input, outputs },
      { budget, onStep: steps ? (s) => steps.push(s) : undefined },
    );
  const base = (): ExecutionBase => ({
    runId,
    scenarioId,
    input,
    outputs,
    visitedNodes,
    selectedEdges,
    logicalJudgments,
    actualHttpAttempts: 0,
    replayedJudgments: 0,
    usage: null,
    elapsedMs: performance.now() - started,
    events,
    exchanges,
    observerErrors,
    ...workflowHashes(workflow),
  });
  try {
    check();
    emit("run_started", {
      mode: options.mode,
      runtimeVersion: RUNTIME_VERSION,
      limits,
    });
    let node: WorkflowNode = workflow.nodes.find((n) => n.kind === "start")!;
    while (node) {
      activeNode = node.id;
      check();
      visitedNodes.push(node.id);
      emit("node_started", { kind: node.kind });
      let port = "next";
      if (node.kind === "judgment") {
        logicalJudgments++;
        const state = evaluate(node.state),
          binding = bindings[node.binding];
        if (
          state === null ||
          typeof state === "boolean" ||
          typeof state === "number"
        )
          throw new PathsmithError(
            "EXPRESSION_TYPE_ERROR",
            "Judgment state must be string, object, or array",
          );
        const resolvedRequest: EvaluationRequest = {
          model: binding.model,
          state,
          questions: node.questions,
        };
        reserve(resolvedRequest, limits.providerRequestBytes);
        const request = immutable(resolvedRequest);
        const fingerprint = hash({
          providerId: binding.providerId,
          adapterVersion: binding.adapter.version,
          normalizerVersion: binding.adapter.normalizerVersion,
          request,
        });
        emit("judgment_request_resolved", {
          request,
          fingerprint,
          binding: node.binding,
        });
        const callStarted = performance.now();
        const response = await withAbort(
          binding.adapter.evaluate(request, {
            signal: controller.signal,
            runId,
            scenarioId,
            nodeId: node.id,
            binding: node.binding,
          }),
          controller.signal,
        );
        check();
        validateResponse(request, response, limits.providerResponseBytes);
        reserve(response, limits.providerResponseBytes);
        const saved = immutable(response);
        outputs[node.id] = saved.answers as unknown as Json;
        exchanges.push({
          runId,
          scenarioId,
          nodeId: node.id,
          binding: node.binding,
          providerId: binding.providerId,
          adapterVersion: binding.adapter.version,
          normalizerVersion: binding.adapter.normalizerVersion,
          origin: binding.adapter.origin,
          fingerprint,
          request,
          response: saved,
          elapsedMs: performance.now() - callStarted,
          actualHttpAttempts: 0,
        });
        emit("judgment_completed", {
          answers: saved.answers,
          requestedModel: request.model,
          resolvedModel: saved.model,
          origin: binding.adapter.origin,
          usage: saved.usage,
          actualHttpAttempts: 0,
        });
      } else if (node.kind === "transform") {
        const value = evaluate(node.value);
        reserve(value);
        outputs[node.id] = immutable(value);
        emit("transform_completed", { value: outputs[node.id] });
      } else if (node.kind === "branch") {
        const cases: {
          id: string;
          result: "true" | "false" | "not_evaluated" | "error";
          evaluations: ExpressionStep[];
        }[] = node.cases.map((c) => ({
          id: c.id,
          result: "not_evaluated",
          evaluations: [],
        }));
        port = "default";
        for (const [index, branchCase] of node.cases.entries()) {
          try {
            const condition = evaluate(
              branchCase.when,
              cases[index].evaluations,
            );
            if (typeof condition !== "boolean")
              throw new PathsmithError(
                "EXPRESSION_TYPE_ERROR",
                "Branch conditions must return Boolean values",
              );
            cases[index].result = condition ? "true" : "false";
            if (condition) {
              port = branchCase.id;
              break;
            }
          } catch (error) {
            cases[index].result = "error";
            emit("branch_evaluation_failed", { cases });
            throw error;
          }
        }
        emit("branch_selected", {
          port,
          cases,
          defaultReason:
            port === "default" ? "All cases evaluated false" : null,
        });
      } else if (node.kind === "output") {
        const value = evaluate(node.value);
        reserve(value);
        assertValid(
          validateData(workflow.outputSchema, value),
          "OUTPUT_INVALID",
        );
        const result = { outcomeId: node.outcomeId, value };
        emit("output_emitted", result);
        emit("run_completed", {});
        return immutable({ ...base(), status: "completed", result });
      }
      const edge = workflow.edges.find(
        (e) => e.source === node.id && e.port === port,
      )!;
      selectedEdges.push(edge.id);
      emit("edge_selected", {
        edgeId: edge.id,
        port: edge.port,
        target: edge.target,
      });
      node = workflow.nodes.find((n) => n.id === edge.target)!;
    }
    throw new PathsmithError("WORKFLOW_INVALID", "Execution did not terminate");
  } catch (error) {
    const failure = toExecutionError(
        controller.signal.aborted ? controller.signal.reason : error,
        activeNode,
        scenarioId ?? undefined,
      ),
      status = failure.code === "RUN_CANCELED" ? "canceled" : "failed";
    // Observation failures do not retry judgments, including failures while emitting terminal events.
    try {
      emit("node_failed", failure);
      emit(status === "canceled" ? "run_canceled" : "run_failed", failure);
    } catch {
      /* original failure remains authoritative */
    }
    return immutable({ ...base(), status, error: failure });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let listener: () => void = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        listener = () => reject(signal.reason);
        signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
function validateResponse(
  request: EvaluationRequest,
  response: EvaluationResponse,
  limit: number,
): void {
  const diagnostics = inspectJson(response, limit);
  assertValid(
    { valid: !diagnostics.length, diagnostics },
    "PROVIDER_INVALID_RESPONSE",
  );
  if (
    !response ||
    typeof response.model !== "string" ||
    !response.model.trim() ||
    response.usage !== null
  )
    throw new PathsmithError(
      "PROVIDER_INVALID_RESPONSE",
      "Mock responses require a model and null usage",
    );
  assertValid(
    validateAnswers(request.questions, response.answers),
    "PROVIDER_INVALID_RESPONSE",
  );
}
