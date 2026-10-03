import { MAX_HTTP_ATTEMPTS } from "@pathsmith/contracts";
import {
  validateProfile,
  validateSuite,
  validateWorkflow,
} from "@pathsmith/contracts";
import {
  assertValid,
  longestJudgmentPath,
  resolveRunControls,
  canonicalize,
  evaluateExpression,
  hash,
  PathsmithError,
  resolveLimits,
  sumUsage,
  validUsage,
  workflowHashes,
} from "@pathsmith/core";
import {
  coverage,
  evaluateAssertions,
  summarize,
  type RunReport,
} from "@pathsmith/evaluation";
import { createReplayBindings } from "@pathsmith/provider-replay";

/** Validate imported artifacts; this checks recorded facts without dispatching providers. */
export function readRunReport(value: unknown): RunReport {
  try {
    const r = value as RunReport;
    if (
      !r ||
      r.formatVersion !== "0.1" ||
      r.artifactType !== "pathsmith_run" ||
      ![r.id, r.workspaceId, r.projectId, r.runtimeVersion].every(
        (v) => typeof v === "string" && v.length > 0,
      ) ||
      !["mock", "replay", "live"].includes(r.mode) ||
      !["completed", "failed", "canceled"].includes(r.status) ||
      !["synthetic", "live"].includes(r.origin) ||
      (r.mode === "mock" && r.origin !== "synthetic") ||
      (r.mode === "live" && r.origin !== "live") ||
      (r.mode === "replay"
        ? typeof r.sourceRunId !== "string" ||
          !r.sourceRunId ||
          r.sourceRunId === r.id
        : r.sourceRunId !== null) ||
      !Array.isArray(r.scenarios) ||
      !Array.isArray(r.selectedScenarioIds) ||
      !r.selectedScenarioIds.length ||
      new Set(r.selectedScenarioIds).size !== r.selectedScenarioIds.length ||
      r.scenarios.length !== r.selectedScenarioIds.length ||
      new Set(r.scenarios.map((s) => s.scenarioId)).size !== r.scenarios.length
    )
      throw new Error("Invalid report envelope");
    assertValid(validateWorkflow(r.workflow));
    assertValid(validateSuite(r.suite, r.workflow, r.selectedScenarioIds));
    assertValid(validateProfile(r.profile, r.workflow));
    if (
      hash(r.suite) !== r.suiteSnapshotHash ||
      hash(r.workflow) !== r.artifactHash ||
      workflowHashes(r.workflow).workflowSemanticHash !==
        r.workflowSemanticHash ||
      hash(resolveLimits(r.limits)) !== hash(r.limits) ||
      !Number.isSafeInteger(r.concurrency) ||
      r.concurrency < 1 ||
      r.concurrency > 16
    )
      throw new Error("Invalid snapshots or limits");
    const httpLimit = r.httpAttemptLimit ?? 200;
    if (!Number.isSafeInteger(httpLimit) || httpLimit < 1 || httpLimit > MAX_HTTP_ATTEMPTS)
      throw new Error("Invalid attempt limit");
    if (r.controls !== undefined) {
      if (r.mode !== "live") throw new Error("Provider controls require live mode");
      resolveRunControls(r.controls, r.selectedScenarioIds.length * longestJudgmentPath(r.workflow));
    }
    // Validates each source/run/scenario/node/binding scope, fingerprint, identity and normalized response.
    createReplayBindings(r);
    const casesById = new Map(r.suite.scenarios.map((c)=>[c.id,c]));
    const selected = new Set(r.selectedScenarioIds);
    for (const s of r.scenarios) {
      const scenario = casesById.get(s.scenarioId);
      if (
        !scenario ||
        !selected.has(s.scenarioId) ||
        hash(s.input) !== hash(scenario.input) ||
        !["completed", "failed", "canceled"].includes(s.status) ||
        !["passed", "failed", "not_evaluated"].includes(s.assertionStatus) ||
        !Array.isArray(s.selectedEdges) ||
        !Array.isArray(s.visitedNodes) ||
        !Array.isArray(s.assertions) ||
        !Array.isArray(s.events) ||
        typeof s.started !== "boolean" ||
        !s.outputs ||
        typeof s.outputs !== "object" ||
        Array.isArray(s.outputs) ||
        ![s.logicalJudgments, s.actualHttpAttempts, s.replayedJudgments].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) ||
        !validUsage(s.usage) ||
        !validUsage(s.historicalUsage ?? null) ||
        (s.status === "completed" &&
          (!s.result ||
            !r.workflow.nodes.some(
              (n) => n.kind === "output" && n.outcomeId === s.result!.outcomeId,
            ))) ||
        (s.status !== "completed" &&
          (!s.error || typeof s.error.code !== "string"))
      )
        throw new Error("Invalid scenario facts");
      if (
        s.visitedNodes.some(
          (id) => !r.workflow.nodes.some((n) => n.id === id),
        ) ||
        new Set(s.visitedNodes).size !== s.visitedNodes.length ||
        s.selectedEdges.some((id) => !r.workflow.edges.some((e) => e.id === id))
      )
        throw new Error("Invalid recorded path");
      const evaluated = evaluateAssertions(scenario, s);
      if (
        s.assertionStatus !== evaluated.assertionStatus ||
        canonicalize(s.assertions) !== canonicalize(evaluated.assertions)
      )
        throw new Error("Invalid assertion facts");
      if (s.providerCalls !== undefined && (!Number.isSafeInteger(s.providerCalls) || s.providerCalls < 0 ||
        s.providerCalls > s.logicalJudgments || (r.mode !== "live" && s.providerCalls !== 0)))
        throw new Error("Invalid provider call count");
      const attempts = s.attempts ?? [];
      if (
        (s.providerCalls !== undefined && r.mode === "live" &&
          (s.providerCalls < s.exchanges.length || new Set(attempts.map((a) => a.nodeId)).size > s.providerCalls)) ||
        !Array.isArray(attempts) ||
        attempts.length !== s.actualHttpAttempts ||
        (r.mode !== "live" && attempts.length) ||
        (r.mode === "replay" && s.replayedJudgments !== s.exchanges.length) ||
        (r.mode !== "replay" && s.replayedJudgments !== 0) ||
        s.exchanges.length > s.logicalJudgments ||
        (r.mode === "replay" &&
          canonicalize(s.usage) !==
            canonicalize({ inputTokens: 0, outputTokens: 0 }))
      )
        throw new Error("Invalid attempt counts");
      const expectedUsage =
        r.mode === "mock"
          ? null
          : r.mode === "replay" || !attempts.length
            ? { inputTokens: 0, outputTokens: 0 }
            : sumUsage(attempts.map((a) => a.usage));
      const expectedHistoricalUsage =
        r.mode === "replay"
          ? sumUsage(s.exchanges.map((e) => e.historicalUsage ?? null))
          : null;
      if (
        canonicalize(s.usage) !== canonicalize(expectedUsage) ||
        canonicalize(s.historicalUsage ?? null) !==
          canonicalize(expectedHistoricalUsage)
      )
        throw new Error("Invalid usage totals");
      for (const a of attempts) {
        if (
          !["succeeded", "failed", "canceled"].includes(a.status) ||
          !Number.isSafeInteger(a.attempt) ||
          a.attempt < 1 ||
          a.attempt > 3 ||
          !validUsage(a.usage) ||
          !r.workflow.nodes.some(
            (n) =>
              n.id === a.nodeId &&
              n.kind === "judgment" &&
              n.binding === a.binding,
          )
        )
          throw new Error("Invalid attempt record");
      }
      for (const exchange of s.exchanges) {
        const callAttempts = attempts.filter(
          (a) => a.nodeId === exchange.nodeId && a.binding === exchange.binding,
        );
        if (
          exchange.actualHttpAttempts !== callAttempts.length ||
          (r.mode === "live" &&
            (!callAttempts.length ||
              callAttempts.at(-1)!.status !== "succeeded" ||
              canonicalize(exchange.usage ?? null) !==
                canonicalize(sumUsage(callAttempts.map((a) => a.usage))))) ||
          (r.mode === "mock" && exchange.usage != null) ||
          (r.mode === "replay" &&
            canonicalize(exchange.usage) !==
              canonicalize({ inputTokens: 0, outputTokens: 0 }))
        )
          throw new Error("Invalid exchange accounting");
        const node = r.workflow.nodes.find((n) => n.id === exchange.nodeId);
        if (
          !node ||
          node.kind !== "judgment" ||
          node.binding !== exchange.binding ||
          !s.visitedNodes.includes(node.id) ||
          canonicalize(node.questions) !==
            canonicalize(exchange.request.questions) ||
          canonicalize(
            evaluateExpression(node.state, {
              input: s.input,
              outputs: s.outputs,
            }),
          ) !== canonicalize(exchange.request.state) ||
          canonicalize(s.outputs[node.id]) !==
            canonicalize(exchange.response.answers) ||
          (exchange.sourceRunId ?? null) !== r.sourceRunId
        )
          throw new Error(
            "Exchange does not match its original workflow or scenario",
          );
      }
    }
    const expectedStatus =
      r.error || r.scenarios.some((s) => s.status === "failed")
        ? "failed"
        : r.scenarios.some((s) => s.status === "canceled")
          ? "canceled"
          : "completed";
    const summary = summarize(r.suite, r.selectedScenarioIds, r.scenarios);
    if (r.controls && (summary.providerCalls === null || summary.providerCalls > r.controls.maxProviderCalls))
      throw new Error("Provider call budget exceeded or unaccounted");
    if (r.stopReason && (!r.controls || !["PROVIDER_CALL_CAP", "CONSECUTIVE_PROVIDER_ERRORS"].includes(r.stopReason.code) ||
      r.stopReason.providerCalls !== summary.providerCalls || r.error?.code !== r.stopReason.code ||
      !Number.isSafeInteger(r.stopReason.consecutiveProviderErrors) || r.stopReason.consecutiveProviderErrors < 0 ||
      (r.stopReason.code === "PROVIDER_CALL_CAP" && r.stopReason.providerCalls !== r.controls.maxProviderCalls) ||
      (r.stopReason.code === "CONSECUTIVE_PROVIDER_ERRORS" && r.stopReason.consecutiveProviderErrors !== r.controls.stopAfterConsecutiveErrors)))
      throw new Error("Invalid stop accounting");
    // M1�M3 mock reports lacked historicalUsage; its absence means unavailable, not zero.
    if (
      r.status !== expectedStatus ||
      summary.actualHttpAttempts > httpLimit ||
      canonicalize({
        ...r.summary,
        providerCalls: r.summary.providerCalls ?? null,
        notRun: r.summary.notRun ?? summary.notRun,
        historicalUsage: r.summary.historicalUsage ?? null,
      }) !== canonicalize(summary) ||
      canonicalize(r.coverage) !==
        canonicalize(coverage(r.workflow, r.scenarios)) ||
      r.mixedModel !==
        Object.values(r.adapters).some((a) => a.resolvedModels.length > 1)
    )
      throw new Error("Invalid report aggregates");
    for (const [name, adapter] of Object.entries(r.adapters)) {
      const actual = [
        ...new Set(
          r.scenarios.flatMap((s) =>
            s.exchanges
              .filter((e) => e.binding === name)
              .map((e) => e.response.model),
          ),
        ),
      ].sort();
      if (canonicalize(adapter.resolvedModels) !== canonicalize(actual))
        throw new Error("Invalid resolved model provenance");
    }
    return r;
  } catch {
    throw new PathsmithError(
      "ARTIFACT_INVALID",
      "Run report has invalid snapshots, provenance, scopes, or execution accounting",
    );
  }
}
