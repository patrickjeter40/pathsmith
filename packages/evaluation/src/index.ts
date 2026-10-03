import { MAX_HTTP_ATTEMPTS, MAX_ARTIFACT_BYTES } from "@pathsmith/contracts";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import {
  byteLength,
  validateProfile,
  validateSuite,
  validateWorkflow,
  type ExecutionProfile,
  type Json,
  type Scenario,
  type Suite,
  type Workflow,
} from "@pathsmith/contracts";
import {
  ProviderCallControl,
  longestJudgmentPath,
  resolveRunControls,
  runStopError,
  type RunControls,
  type RunStopReason,
  assertValid,
  canonicalize,
  evaluateExpression,
  executeWorkflow,
  hash,
  immutable,
  PathsmithError,
  resolveLimits,
  RUNTIME_VERSION,
  snapshotBindings,
  sumUsage,
  type Usage,
  type ProviderAttemptRecord,
  type ExecutionMode,
  toExecutionError,
  workflowHashes,
  type Bindings,
  type ExecutionError,
  type ExecutionLimits,
  type ExecutionResult,
  type Exchange,
  type TraceEvent,
} from "@pathsmith/core";

import { classificationRow } from "./classification.js";

export const MAX_REPORT_BYTES = MAX_ARTIFACT_BYTES;
export * from "./classification.js";

export interface AssertionDetail {
  kind: "outcome" | "required_node" | "forbidden_node" | "expression";
  passed: boolean;
  message: string;
  error?: ExecutionError;
}
export interface ScenarioResult {
  scenarioId: string;
  input: Json;
  started: boolean;
  status: "completed" | "failed" | "canceled";
  assertionStatus: "passed" | "failed" | "not_evaluated";
  result?: { outcomeId: string; value: Json };
  error?: ExecutionError;
  assertions: AssertionDetail[];
  visitedNodes: string[];
  selectedEdges: string[];
  logicalJudgments: number;
  providerCalls?: number;
  actualHttpAttempts: number;
  replayedJudgments: number;
  elapsedMs: number;
  usage: Usage | null;
  historicalUsage: Usage | null;
  events: TraceEvent[];
  exchanges: Exchange[];
  attempts: ProviderAttemptRecord[];
  outputs: Record<string, Json>;
}
export function evaluateAssertions(
  scenario: Scenario,
  execution: Pick<ExecutionResult, "status" | "outputs" | "visitedNodes"> & {
    result?: { outcomeId: string; value: Json };
  },
): {
  assertionStatus: ScenarioResult["assertionStatus"];
  assertions: AssertionDetail[];
} {
  const assertions: AssertionDetail[] = [];
  if (
    execution.status !== "completed" ||
    !scenario.expected ||
    !execution.result
  )
    return { assertionStatus: "not_evaluated", assertions };
  const expected = scenario.expected;
  if (expected.allowedOutcomes)
    assertions.push({
      kind: "outcome",
      passed: expected.allowedOutcomes.includes(execution.result.outcomeId),
      message: `Outcome ${execution.result.outcomeId}; allowed: ${expected.allowedOutcomes.join(", ")}`,
    });
  for (const id of expected.requiredNodes ?? [])
    assertions.push({
      kind: "required_node",
      passed: execution.visitedNodes.includes(id),
      message: `Required node: ${id}`,
    });
  for (const id of expected.forbiddenNodes ?? [])
    assertions.push({
      kind: "forbidden_node",
      passed: !execution.visitedNodes.includes(id),
      message: `Forbidden node: ${id}`,
    });
  const budget = { remaining: 10_000 };
  for (const [i, expr] of (expected.assertions ?? []).entries()) {
    try {
      const value = evaluateExpression(
        expr,
        {
          input: scenario.input,
          outputs: execution.outputs,
          result: execution.result,
        },
        { budget },
      );
      if (typeof value !== "boolean")
        throw new PathsmithError(
          "EXPRESSION_TYPE_ERROR",
          "Assertion must evaluate to Boolean",
        );
      assertions.push({
        kind: "expression",
        passed: value,
        message: `Assertion ${i + 1}: ${value}`,
      });
    } catch (error) {
      assertions.push({
        kind: "expression",
        passed: false,
        message: `Assertion ${i + 1} could not be evaluated`,
        error: toExecutionError(error, undefined, scenario.id),
      });
    }
  }
  return {
    assertionStatus: assertions.every((a) => a.passed) ? "passed" : "failed",
    assertions,
  };
}
export const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;
export function coverage(workflow: Workflow, scenarios: ScenarioResult[]) {
  const started = scenarios.filter((s) => s.started).length,
    completed = scenarios.filter((s) => s.status === "completed").length;
  const nodes = workflow.nodes.map((node) => {
    const visits = scenarios.filter((s) =>
      s.visitedNodes.includes(node.id),
    ).length;
    return {
      nodeId: node.id,
      visits,
      startedScenarios: started,
      visitRate: ratio(visits, started),
    };
  });
  const edges = workflow.edges.map((edge) => {
    const traversals = scenarios.filter((s) =>
        s.selectedEdges.includes(edge.id),
      ).length,
      sourceVisits = nodes.find((n) => n.nodeId === edge.source)!.visits;
    return {
      edgeId: edge.id,
      source: edge.source,
      port: edge.port,
      target: edge.target,
      traversals,
      sourceVisits,
      conditionalRate: ratio(traversals, sourceVisits),
      isBranchPort:
        workflow.nodes.find((n) => n.id === edge.source)!.kind === "branch",
    };
  });
  const branchPorts = edges.filter((e) => e.isBranchPort),
    branchPortsVisited = branchPorts.filter((e) => e.traversals > 0).length;
  return {
    started,
    completed,
    partial: completed !== scenarios.length,
    nodes,
    edges,
    branchPortsVisited,
    branchPortsTotal: branchPorts.length,
    branchCoverage: ratio(branchPortsVisited, branchPorts.length),
    edgesVisited: edges.filter((e) => e.traversals > 0).length,
    edgesTotal: edges.length,
  };
}
export type SummaryFacts = Pick<ScenarioResult, "scenarioId" | "status" | "started" | "assertionStatus" | "result" | "logicalJudgments" | "providerCalls" | "actualHttpAttempts" | "replayedJudgments" | "usage" | "historicalUsage">;
export function summarize(
  suite: Suite,
  selectedIds: string[],
  scenarios: SummaryFacts[],
) {
  const byId = new Map(suite.scenarios.map((s) => [s.id, s]));
  const selected = selectedIds.length,
    completed = scenarios.filter((s) => s.status === "completed").length,
    failedExecution = scenarios.filter((s) => s.status === "failed").length,
    canceled = scenarios.filter((s) => s.status === "canceled").length;
  const labeled = selectedIds.filter(
      (id) => byId.get(id)?.expected,
    ).length,
    labeledCompleted = scenarios.filter(
      (s) =>
        s.status === "completed" &&
        byId.get(s.scenarioId)?.expected,
    ).length;
  const assertionPassed = scenarios.filter(
      (s) => s.assertionStatus === "passed",
    ).length,
    assertionFailed = scenarios.filter(
      (s) => s.assertionStatus === "failed",
    ).length;
  const outcomeCounts: Record<string, number> = {};
  for (const s of scenarios)
    if (s.result)
      outcomeCounts[s.result.outcomeId] =
        (outcomeCounts[s.result.outcomeId] ?? 0) + 1;
  return {
    selected,
    notRun: selected - scenarios.length + scenarios.filter((s) => !s.started).length,
    started: scenarios.filter((s) => s.started).length,
    completed,
    failedExecution,
    canceled,
    interrupted: 0,
    labeled,
    unlabeled: selected - labeled,
    labeledCompleted,
    assertionPassed,
    assertionFailed,
    labeledCompletedPassRate: ratio(assertionPassed, labeledCompleted),
    endToEndLabeledSuccessRate: ratio(assertionPassed, labeled),
    executionCompletionRate: ratio(completed, selected),
    providerCalls: scenarios.some((s) => s.providerCalls === undefined) ? null : scenarios.reduce((sum, s) => sum + s.providerCalls!, 0),
    logicalJudgments: scenarios.reduce((s, r) => s + r.logicalJudgments, 0),
    actualHttpAttempts: scenarios.reduce((s, r) => s + r.actualHttpAttempts, 0),
    replayedJudgments: scenarios.reduce((s, r) => s + r.replayedJudgments, 0),
    usage: sumUsage(scenarios.map((s) => s.usage)),
    historicalUsage: sumUsage(scenarios.map((s) => s.historicalUsage ?? null)),
    outcomeCounts,
  };
}
export interface RunReport {
  formatVersion: "0.1";
  artifactType: "pathsmith_run";
  id: string;
  workspaceId: string;
  projectId: string;
  status: "completed" | "failed" | "canceled";
  mode: ExecutionMode;
  origin: "synthetic" | "live";
  sourceRunId: string | null;
  createdAt: string;
  completedAt: string;
  runtimeVersion: string;
  workflow: Workflow;
  suite: Suite;
  profile: ExecutionProfile;
  limits: ExecutionLimits;
  concurrency: number;
  httpAttemptLimit: number;
  controls?: RunControls;
  stopReason?: RunStopReason;
  rerunOfRunId?: string;
  workflowSemanticHash: string;
  artifactHash: string;
  suiteSnapshotHash: string;
  selectedScenarioIds: string[];
  adapters: Record<
    string,
    {
      providerId: string;
      adapterVersion: string;
      normalizerVersion: string;
      requestedModel: string;
      resolvedModels: string[];
    }
  >;
  mixedModel: boolean;
  scenarios: ScenarioResult[];
  summary: ReturnType<typeof summarize>;
  coverage: ReturnType<typeof coverage>;
  error?: ExecutionError;
}
export interface RunSuiteOptions {
  workflow: Workflow;
  suite: Suite;
  bindings: Bindings;
  mode: ExecutionMode;
  /** Required for replay with an empty binding profile; otherwise derived and checked. */
  sourceRunId?: string;
  /** Preserve source provenance when replay has no provider bindings to carry it. */
  sourceOrigin?: "synthetic" | "live";
  selectedScenarioIds?: string[];
  limits?: Partial<ExecutionLimits>;
  concurrency?: number;
  /** Explicit override of the default 200; maximum 30,000 is a Pathsmith cap. */
  httpAttemptLimit?: number;
  controls?: RunControls;
  rerunOfRunId?: string;
  signal?: AbortSignal;
  workspaceId?: string;
  projectId?: string;
  runId?: string;
  onScenario?: (result: ScenarioResult) => void | Promise<void>;
}
export async function runSuite(options: RunSuiteOptions): Promise<RunReport> {
  assertValid(validateWorkflow(options.workflow));
  assertValid(
    validateSuite(options.suite, options.workflow, options.selectedScenarioIds),
    "SUITE_INVALID",
  );
  const limits = resolveLimits(options.limits),
    concurrency = options.concurrency ?? (options.mode === "live" ? 4 : 16);
  const httpAttemptLimit = options.httpAttemptLimit ?? 200;
  if (
    !Number.isSafeInteger(httpAttemptLimit) ||
    httpAttemptLimit < 1 ||
    httpAttemptLimit > MAX_HTTP_ATTEMPTS
  )
    throw new PathsmithError(
      "RUN_LIMIT_EXCEEDED",
      "HTTP attempt limit must be an integer from 1 through 30,000",
    );
  const httpAttemptBudget = { remaining: httpAttemptLimit };
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new PathsmithError(
      "RUN_LIMIT_EXCEEDED",
      "Scenario concurrency must be between 1 and 16",
    );
  if (!["mock", "replay", "live"].includes(options.mode))
    throw new PathsmithError(
      "PROVIDER_NOT_CONFIGURED",
      "A supported explicit execution mode is required",
    );
  const workflow = immutable(options.workflow),
    suite = immutable(options.suite),
    id = options.runId ?? randomUUID(),
    createdAt = new Date().toISOString(),
    bindings = snapshotBindings(options.bindings);
  const sourceRunIds = [
    ...new Set([
      ...(options.sourceRunId ? [options.sourceRunId] : []),
      ...Object.values(bindings).flatMap((b) =>
        b.adapter.replay ? [b.adapter.replay.sourceRunId] : [],
      ),
    ]),
  ];
  if (options.mode === "replay" && sourceRunIds.length !== 1)
    throw new PathsmithError(
      "PROVIDER_NOT_CONFIGURED",
      "Replay requires bindings from exactly one source run",
    );
  if (
    options.sourceOrigin !== undefined &&
    (options.mode !== "replay" ||
      !["synthetic", "live"].includes(options.sourceOrigin))
  )
    throw new PathsmithError(
      "PROVIDER_NOT_CONFIGURED",
      "Source origin is valid only for recorded replay",
    );
  const replayOrigins = [
    ...new Set([
      ...(options.sourceOrigin ? [options.sourceOrigin] : []),
      ...Object.values(bindings).map((b) => b.adapter.origin),
    ]),
  ];
  if (
    options.mode === "replay" &&
    (replayOrigins.length !== 1 ||
      !["synthetic", "live"].includes(replayOrigins[0]))
  )
    throw new PathsmithError(
      "PROVIDER_NOT_CONFIGURED",
      "Replay requires one consistent source origin; empty bindings require sourceOrigin",
    );
  const origin =
    options.mode === "replay"
      ? replayOrigins[0]
      : options.mode === "live"
        ? "live"
        : "synthetic";
  const profile: ExecutionProfile = {
    formatVersion: "0.1",
    bindings: Object.fromEntries(
      Object.entries(bindings).map(([name, b]) => [
        name,
        { providerId: b.providerId, model: b.model },
      ]),
    ),
  };
  assertValid(validateProfile(profile, workflow), "PROVIDER_NOT_CONFIGURED");
  const selection = options.selectedScenarioIds ? new Set(options.selectedScenarioIds) : undefined;
  const selected = suite.scenarios.filter(
      (s) =>
        !selection || selection.has(s.id),
    ),
    results = new Map<string, ScenarioResult>();
  if (options.mode !== "live" && options.controls !== undefined)
    throw new PathsmithError("RUN_LIMIT_EXCEEDED", "Provider controls apply only to live runs");
  const controls = options.mode === "live"
    ? resolveRunControls(options.controls, selected.length * longestJudgmentPath(workflow)) : undefined;
  const callControl = controls ? new ProviderCallControl(controls) : undefined;
  const controller = new AbortController(),
    cancel = () => controller.abort();
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  let next = 0,
    storageError: ExecutionError | undefined;
  const pendingRows = new Map<string, ScenarioResult>(selected.map((s) => [s.id, {
        scenarioId: s.id,
        input: s.input,
        started: false,
        status: "canceled" as const,
        assertionStatus: "not_evaluated" as const,
        assertions: [],
        error: toExecutionError(
          new PathsmithError("RUN_CANCELED", "Canceled before dispatch"),
          undefined,
          s.id,
        ),
        visitedNodes: [],
        selectedEdges: [],
        logicalJudgments: 0,
        providerCalls: 0,
        actualHttpAttempts: 0,
        replayedJudgments: 0,
        elapsedMs: 0,
        usage:
          options.mode !== "mock" ? { inputTokens: 0, outputTokens: 0 } : null,
        historicalUsage: null,
        events: [],
        exchanges: [],
        attempts: [],
        outputs: {},
      }]));
  const pendingBytes = new Map([...pendingRows].map(([id, row]) => [id, byteLength(row)]));
  // Reserve every absent row before dispatch, plus bounded accounting retained by
  // workers that may finish after another worker exhausts the report budget.
  const overflowReserve = Math.min(concurrency, selected.length) *
    (limits.scenarioArtifactBytes + limits.providerResponseBytes + 512 * 1024);
  let reportBytes = byteLength(workflow) + 2 * byteLength(suite) + 1024 * 1024 +
    [...pendingBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
  const retainedModels = new Set<string>();
  const modelCost = (item: ScenarioResult) => {
    const additions = new Map<string, number>();
    for (const exchange of item.exchanges) {
      const key = JSON.stringify([exchange.binding, exchange.response.model]);
      if (!retainedModels.has(key)) additions.set(key, byteLength(exchange.response.model) + 1);
    }
    return additions;
  };
  async function worker() {
    while (!controller.signal.aborted && !callControl?.stopReason && next < selected.length) {
      const scenario = selected[next++];
      const execution = await executeWorkflow({
        workflow,
        input: scenario.input,
        bindings,
        mode: options.mode,
        httpAttemptBudget,
        providerCallControl: callControl,
        runId: id,
        scenarioId: scenario.id,
        limits,
        signal: controller.signal,
        trace: true,
      });
      let item: ScenarioResult = {
        scenarioId: scenario.id,
        input: scenario.input,
        started: execution.visitedNodes.length > 0,
        status: execution.status,
        ...("result" in execution
          ? { result: execution.result }
          : { error: execution.error }),
        ...evaluateAssertions(scenario, execution),
        visitedNodes: execution.visitedNodes,
        selectedEdges: execution.selectedEdges,
        logicalJudgments: execution.logicalJudgments,
        providerCalls: execution.providerCalls,
        actualHttpAttempts: execution.actualHttpAttempts,
        replayedJudgments: execution.replayedJudgments,
        elapsedMs: execution.elapsedMs,
        usage: execution.usage,
        historicalUsage: execution.historicalUsage,
        events: execution.events,
        exchanges: execution.exchanges,
        attempts: execution.attempts,
        outputs: execution.outputs,
      };
      const itemBytes = byteLength(item, MAX_REPORT_BYTES);
      const newModels = modelCost(item);
      const modelBytes = [...newModels.values()].reduce((sum, bytes) => sum + bytes, 0);
      if (reportBytes + itemBytes - pendingBytes.get(scenario.id)! + modelBytes + overflowReserve > MAX_REPORT_BYTES) {
        storageError = toExecutionError(
          new PathsmithError(
            "RUN_LIMIT_EXCEEDED",
            "Run artifact exceeds the 256 MiB report budget",
          ),
        );
        controller.abort();
        item = {
          scenarioId: scenario.id,
          input: scenario.input,
          started: item.started,
          status: "failed",
          assertionStatus: "not_evaluated",
          assertions: [],
          error: storageError,
          visitedNodes: item.visitedNodes,
          selectedEdges: item.selectedEdges,
          logicalJudgments: item.logicalJudgments,
          providerCalls: item.providerCalls,
          actualHttpAttempts: item.actualHttpAttempts,
          replayedJudgments: item.replayedJudgments,
          elapsedMs: item.elapsedMs,
          usage: item.usage,
          historicalUsage: item.historicalUsage,
          events: [],
          exchanges: item.exchanges,
          attempts: item.attempts,
          outputs: {},
        };
      }
      reportBytes += byteLength(item, MAX_REPORT_BYTES) - pendingBytes.get(scenario.id)! + modelBytes;
      for (const key of newModels.keys()) retainedModels.add(key);
      results.set(scenario.id, immutable(item));
      if (options.onScenario)
        try {
          await options.onScenario(immutable(item));
        } catch {
          storageError = toExecutionError(
            new PathsmithError(
              "STORAGE_ERROR",
              "Unable to persist required scenario results",
            ),
          );
          controller.abort();
        }
      await yieldTurn(); // Let cancellation and other local work run between CPU-bound mock scenarios.
    }
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, selected.length) }, () =>
        worker(),
      ),
    );
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
  const stopReason = callControl?.stopReason;
  if (stopReason) for (const row of pendingRows.values())
    row.error = toExecutionError(runStopError(stopReason), undefined, row.scenarioId);
  const scenarios = selected.map((s) => results.get(s.id) ?? pendingRows.get(s.id)!);
  const selectedScenarioIds = selected.map((s) => s.id).sort();
  const adapters = Object.fromEntries(
    Object.entries(bindings).map(([name, b]) => [
      name,
      {
        providerId: b.providerId,
        adapterVersion: b.adapter.version,
        normalizerVersion: b.adapter.normalizerVersion,
        requestedModel: b.model,
        resolvedModels: [
          ...new Set(
            scenarios.flatMap((s) =>
              s.exchanges
                .filter((e) => e.binding === name)
                .map((e) => e.response.model),
            ),
          ),
        ].sort(),
      },
    ]),
  );
  const report: RunReport = {
    formatVersion: "0.1",
    artifactType: "pathsmith_run",
    id,
    workspaceId: options.workspaceId ?? "local",
    projectId: options.projectId ?? "headless",
    status:
      storageError || stopReason || scenarios.some((s) => s.status === "failed")
        ? "failed"
        : scenarios.some((s) => s.status === "canceled")
          ? "canceled"
          : "completed",
    mode: options.mode,
    origin,
    sourceRunId: options.mode === "replay" ? sourceRunIds[0] : null,
    createdAt,
    completedAt: new Date().toISOString(),
    runtimeVersion: RUNTIME_VERSION,
    workflow,
    suite,
    profile,
    limits,
    concurrency,
    httpAttemptLimit,
    ...(controls ? { controls } : {}),
    ...(stopReason ? { stopReason } : {}),
    ...(options.rerunOfRunId ? { rerunOfRunId: options.rerunOfRunId } : {}),
    ...workflowHashes(workflow),
    suiteSnapshotHash: hash(suite),
    selectedScenarioIds,
    adapters,
    mixedModel: Object.values(adapters).some(
      (a) => a.resolvedModels.length > 1,
    ),
    scenarios,
    summary: summarize(suite, selectedScenarioIds, scenarios),
    coverage: coverage(workflow, scenarios),
    ...(storageError ? { error: storageError } : stopReason ? { error: toExecutionError(runStopError(stopReason)) } : {}),
  };
  // Keep the public writer bound authoritative even for unusual metadata from
  // portable callers. Already persisted rows remain available if this fails.
  if (byteLength(report, MAX_REPORT_BYTES) > MAX_REPORT_BYTES)
    throw new PathsmithError("RUN_LIMIT_EXCEEDED", "Final run artifact exceeds the report byte budget");
  return immutable(report);
}

export function workflowDiff(baseline: Workflow, candidate: Workflow) {
  function diffRecords(a: { id: string }[], b: { id: string }[]) {
    return {
      added: b.filter((n) => !a.some((p) => p.id === n.id)).map((n) => n.id),
      removed: a.filter((n) => !b.some((p) => p.id === n.id)).map((n) => n.id),
      changed: b.flatMap((n) => {
        const previous = a.find((p) => p.id === n.id);
        return previous && canonicalize(previous) !== canonicalize(n)
          ? [{ id: n.id, before: previous, after: n }]
          : [];
      }),
    };
  }
  return {
    nodes: diffRecords(baseline.nodes, candidate.nodes),
    edges: diffRecords(baseline.edges, candidate.edges),
    inputSchemaChanged:
      hash(baseline.inputSchema) !== hash(candidate.inputSchema),
    outputSchemaChanged:
      hash(baseline.outputSchema) !== hash(candidate.outputSchema),
    bindingsChanged: hash(baseline.bindings) !== hash(candidate.bindings),
  };
}
export interface ComparisonPolicy {
  strict?: boolean;
  acceptMixedModel?: boolean;
  basis?: "assertions" | "reviewed_classification";
}
export interface ComparisonIssue { code: string; runId?: string; scenarioIds?: string[] }
export function compareRuns(
  baseline: RunReport,
  candidate: RunReport,
  options: ComparisonPolicy = {},
) {
  const issues: string[] = [];
  const issueDetails: ComparisonIssue[] = [];
  const basis = options.basis ?? "assertions";
  if (!["assertions", "reviewed_classification"].includes(basis))
    throw new PathsmithError("COMPARISON_INVALID", "Unsupported comparison basis");
  if (baseline.mode !== candidate.mode) {
    issues.push("Execution modes differ");
    issueDetails.push({ code: "MODE_MISMATCH" });
  }
  if (
    baseline.suiteSnapshotHash !== candidate.suiteSnapshotHash ||
    canonicalize(baseline.suite) !== canonicalize(candidate.suite)
  )
    issues.push("Suite snapshots differ");
  if (
    canonicalize([...baseline.selectedScenarioIds].sort()) !==
    canonicalize([...candidate.selectedScenarioIds].sort())
  )
    issues.push("Selected scenario IDs differ");
  if (baseline.status !== "completed" || candidate.status !== "completed")
    issues.push("Run execution is incomplete");
  if (
    (baseline.mixedModel || candidate.mixedModel) &&
    !options.acceptMixedModel
  )
    issues.push("Mixed-model provenance requires explicit acceptance");
  for (const report of [baseline, candidate]) {
    const executionsById = new Map(report.scenarios.map((s) => [s.scenarioId, s]));
    const casesById = new Map(report.suite.scenarios.map((s) => [s.id, s]));
    const selectedIds = new Set(report.selectedScenarioIds);
    if (hash(report.suite) !== report.suiteSnapshotHash) issues.push("Suite snapshot hash does not match its content");
    if (
      new Set(report.selectedScenarioIds).size !== report.selectedScenarioIds.length ||
      new Set(report.suite.scenarios.map((s) => s.id)).size !== report.suite.scenarios.length ||
      report.selectedScenarioIds.some((id) => !casesById.has(id)) ||
      report.scenarios.some((s) => !selectedIds.has(s.scenarioId)) ||
      report.scenarios.length !== report.selectedScenarioIds.length ||
      new Set(report.scenarios.map((s) => s.scenarioId)).size !==
        report.scenarios.length ||
      report.selectedScenarioIds.some(
        (id) => !executionsById.has(id),
      )
    )
      issues.push("Missing or duplicate comparison pair");
    if (report.scenarios.some((s) => s.status !== "completed"))
      issues.push("Scenario execution is incomplete");
    for (const execution of report.scenarios) {
      const scenario = casesById.get(execution.scenarioId);
      if (!scenario || !execution.result || execution.status !== "completed") {
        issues.push("Scenario result or snapshot is missing");
        continue;
      }
      if (hash(execution.input) !== hash(scenario.input))
        issues.push("Scenario input does not match its snapshot");
      const evaluated = evaluateAssertions(scenario, execution);
      if (
        execution.assertionStatus !== evaluated.assertionStatus ||
        canonicalize(execution.assertions) !==
          canonicalize(evaluated.assertions)
      ) {
        issues.push(
          `Assertion evaluation is incomplete or inconsistent for ${execution.scenarioId}`,
        );
      }
    }
  }
  const baselineById = new Map(baseline.scenarios.map((s) => [s.scenarioId,s]));
  const candidateById = new Map(candidate.scenarios.map((s) => [s.scenarioId,s]));
  const baselineReferences = new Map(baseline.suite.scenarios.map((s) => [s.id, s]));
  const candidateReferences = new Map(candidate.suite.scenarios.map((s) => [s.id, s]));
  const matchingTargets = Boolean(baseline.suite.classification && candidate.suite.classification &&
    canonicalize(baseline.suite.classification) === canonicalize(candidate.suite.classification));
  if (basis === "reviewed_classification" && !matchingTargets) {
    issues.push("Classification targets are absent or differ");
    issueDetails.push({ code: "CLASSIFICATION_TARGET_MISMATCH" });
  }
  const cases = baseline.selectedScenarioIds.flatMap((id) => {
    const a = baselineById.get(id), b = candidateById.get(id);
    if (!a || !b) return [];
    const reference = baselineReferences.get(id);
    const candidateReference = candidateReferences.get(id);
    const classificationA = baseline.suite.classification && reference
      ? classificationRow(baseline.suite, reference, a, baseline.status) : null;
    const classificationB = candidate.suite.classification && candidateReference
      ? classificationRow(candidate.suite, candidateReference, b, candidate.status) : null;
    const reviewedPair = Boolean(matchingTargets &&
      reference?.referenceLabel?.review === "reviewed" && candidateReference?.referenceLabel?.review === "reviewed" &&
      reference.referenceLabel.value !== null && candidateReference.referenceLabel.value !== null &&
      [baseline.suite.classification!.positiveLabel, baseline.suite.classification!.negativeLabel].includes(reference.referenceLabel.value) &&
      canonicalize(reference.referenceLabel) === canonicalize(candidateReference.referenceLabel));
    const completedPair = a.status === "completed" && b.status === "completed";
    const validPredictions = Boolean(classificationA && classificationB &&
      classificationA.predictedLabel !== null && classificationB.predictedLabel !== null);
    const classificationInGate = reviewedPair && completedPair && validPredictions;
    if (basis === "reviewed_classification" && reviewedPair && completedPair && !validPredictions) {
      issues.push(`Reviewed classification prediction is missing for ${id}`);
      issueDetails.push({ code: "MISSING_CLASSIFICATION_PREDICTION", scenarioIds: [id] });
    }
    const classificationRegression = classificationInGate && classificationA?.reviewedVerdict === "agree" && classificationB?.reviewedVerdict !== "agree";
    const classificationImprovement = classificationInGate && classificationA?.reviewedVerdict !== "agree" && classificationB?.reviewedVerdict === "agree";
    const changed =
      a.result?.outcomeId !== b.result?.outcomeId ||
      canonicalize(a.selectedEdges) !== canonicalize(b.selectedEdges);
    const regression =
      a.status === "completed" &&
      a.assertionStatus === "passed" &&
      b.status === "completed" &&
      b.assertionStatus === "failed";
    const improvement =
      a.status === "completed" &&
      a.assertionStatus === "failed" &&
      b.status === "completed" &&
      b.assertionStatus === "passed";
    const executionRegression =
      a.status === "completed" && b.status === "failed";
    const divergence = Array.from(
      { length: Math.max(a.selectedEdges.length, b.selectedEdges.length) },
      (_, i) => i,
    ).find((i) => a.selectedEdges[i] !== b.selectedEdges[i]);
    return [
      {
        scenarioId: id,
        referenceLabel: reference?.referenceLabel ?? null,
        candidateReferenceLabel: candidateReference?.referenceLabel ?? null,
        classificationInGate,
        newClassificationRegression: classificationRegression,
        classificationImprovement,
        baselineClassification: classificationA ? { predictedLabel: classificationA.predictedLabel, reviewedVerdict: classificationA.reviewedVerdict } : null,
        candidateClassification: classificationB ? { predictedLabel: classificationB.predictedLabel, reviewedVerdict: classificationB.reviewedVerdict } : null,
        behaviorChanged: changed,
        newAssertionRegression: regression,
        assertionImprovement: improvement,
        newExecutionRegression: executionRegression,
        unchangedFailure:
          a.assertionStatus === "failed" && b.assertionStatus === "failed",
        firstDivergence:
          divergence === undefined
            ? null
            : {
                index: divergence,
                baselineEdge: a.selectedEdges[divergence] ?? null,
                candidateEdge: b.selectedEdges[divergence] ?? null,
              },
        baseline: {
          status: a.status,
          outcome: a.result?.outcomeId ?? null,
          assertionStatus: a.assertionStatus,
          assertions: a.assertions,
          elapsedMs: a.elapsedMs,
          actualHttpAttempts: a.actualHttpAttempts,
        },
        candidate: {
          status: b.status,
          outcome: b.result?.outcomeId ?? null,
          assertionStatus: b.assertionStatus,
          assertions: b.assertions,
          elapsedMs: b.elapsedMs,
          actualHttpAttempts: b.actualHttpAttempts,
        },
      },
    ];
  });
  const newAssertionRegressions = cases.filter(
      (c) => c.newAssertionRegression,
    ).length,
    assertionImprovements = cases.filter((c) => c.assertionImprovement).length;
  const reviewedPairs = cases.filter((c) => c.classificationInGate).length;
  if (basis === "reviewed_classification" && reviewedPairs === 0) {
    issues.push("No reviewed evaluable classification pairs");
    issueDetails.push({ code: "NO_REVIEWED_LABELS" });
  }
  const newClassificationRegressions = cases.filter((c) => c.newClassificationRegression).length;
  const classificationImprovements = cases.filter((c) => c.classificationImprovement).length;
  for (const [text, code] of [
    ["Suite snapshots differ", "SUITE_MISMATCH"],
    ["Selected scenario IDs differ", "SELECTION_MISMATCH"],
    ["Run execution is incomplete", "INCOMPLETE_RUN"],
    ["Mixed-model provenance requires explicit acceptance", "MIXED_MODEL"],
  ]) if (issues.includes(text)) issueDetails.push({ code });
  if (issues.some((s) => /pair|Scenario|Assertion/.test(s))) issueDetails.push({ code: "INCOMPLETE_PAIR" });
  const candidateSelected = new Set(candidate.selectedScenarioIds);
  const sharedIds = baseline.selectedScenarioIds.filter((id) => candidateSelected.has(id));
  const cohort = { baselineSelected: baseline.selectedScenarioIds.length, candidateSelected: candidate.selectedScenarioIds.length,
    sharedSelected: sharedIds.length, completedInBoth: sharedIds.filter((id) => baselineById.get(id)?.status === "completed" && candidateById.get(id)?.status === "completed").length,
    baselineOnly: baseline.selectedScenarioIds.length - sharedIds.length, candidateOnly: candidate.selectedScenarioIds.length - sharedIds.length, reviewedPairs };
  const gateFails = basis === "reviewed_classification"
    ? newClassificationRegressions > 0 || (options.strict && cases.some((c) => c.classificationInGate && c.candidateClassification?.reviewedVerdict !== "agree"))
    : newAssertionRegressions > 0 || (options.strict && candidate.scenarios.some((s) => s.assertionStatus === "failed"));
  const modelChanged = hash(baseline.adapters) !== hash(candidate.adapters),
    workflowChanged =
      baseline.workflowSemanticHash !== candidate.workflowSemanticHash;
  return {
    formatVersion: "0.1",
    artifactType: "pathsmith_comparison",
    baselineRunId: baseline.id,
    candidateRunId: candidate.id,
    suiteSnapshotHash: baseline.suiteSnapshotHash,
    selectedScenarioIds: [...baseline.selectedScenarioIds].sort(),
    gate: issues.length
      ? "inconclusive"
      : gateFails
        ? "fail"
        : "pass",
    policy: {
      basis,
      strict: options.strict ?? false,
      acceptMixedModel: options.acceptMixedModel ?? false,
    },
    issues: [...new Set(issues)],
    issueDetails,
    cohort,
    newClassificationRegressions,
    classificationImprovements,
    changedCases: cases.filter((c) => c.behaviorChanged).length,
    newAssertionRegressions,
    assertionImprovements,
    newExecutionRegressions: cases.filter((c) => c.newExecutionRegression)
      .length,
    modelChanged,
    workflowChanged,
    confounded: modelChanged && workflowChanged,
    workflowDiff: workflowDiff(baseline.workflow, candidate.workflow),
    cases,
  };
}
