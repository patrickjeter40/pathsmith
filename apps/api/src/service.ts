import type { OnModuleDestroy } from "@nestjs/common";
import {
  validateProfile,
  validateSuite,
  validateWorkflow,
  type Json,
  type ExecutionProfile,
} from "@pathsmith/contracts";
import {
  assertValid,
  canonicalize,
  PathsmithError,
  toExecutionError,
  type ExecutionLimits,
  type ExecutionMode,
  type Bindings,
} from "@pathsmith/core";
import {
  compareRuns,
  coverage,
  workflowDiff,
  runSuite,
  summarize,
  type ScenarioResult,
} from "@pathsmith/evaluation";
import { createMockProvider } from "@pathsmith/provider-mock";
import { createReplayBindings } from "@pathsmith/provider-replay";
import { createJevProvider } from "@pathsmith/provider-jev";
import {
  openStorage,
  StorageError,
  type QueueRunInput,
  type RunRecord,
  type PageOptions,
  type ScenarioRunRecord,
} from "@pathsmith/storage";
import { loadExample, loadFixtureSet } from "./examples.js";

export interface ProviderConfiguration {
  enableLive?: boolean;
  apiKey?: string;
  defaultModel?: string;
  /** Server-only injection seam for network-free integration tests. */
  fetch?: typeof globalThis.fetch;
}
export class LocalApplication implements OnModuleDestroy {
  private readonly providerConfig: ProviderConfiguration;
  readonly storage;
  readonly context;
  private stopping = false;
  private scheduled: NodeJS.Immediate | undefined;
  private active: { id: string; controller: AbortController } | undefined;
  private running: Promise<void> | undefined;
  storageFailed = false;
  constructor(dataDir?: string, providerConfig: ProviderConfiguration = {}) {
    this.providerConfig = {
      enableLive:
        providerConfig.enableLive ?? process.env.PATHSMITH_ENABLE_LIVE === "1",
      apiKey: providerConfig.apiKey ?? process.env.TYPESAFE_API_KEY ?? "",
      defaultModel:
        providerConfig.defaultModel ??
        process.env.TYPESAFE_MODEL ??
        "jev-latest",
      ...(providerConfig.fetch ? { fetch: providerConfig.fetch } : {}),
    };
    this.storage = openStorage({ dataDir });
    this.context = this.storage.localContext;
  }
  loadExample(id: string) {
    const example = loadExample(id);
    assertValid(validateWorkflow(example.workflow));
    assertValid(
      validateSuite(example.suite, example.workflow),
      "SUITE_INVALID",
    );
    assertValid(
      validateProfile(example.profile, example.workflow),
      "PROVIDER_NOT_CONFIGURED",
    );
    createMockProvider(example.fixtures);
    const project = this.storage.createProject(this.context, example.name);
    const workflow = this.storage.createWorkflow(this.context, project.id, {
      name: example.workflow.name,
      definition: example.workflow as unknown as Json,
      layout: example.layout,
    });
    const workflowVersion = this.storage.publishWorkflowVersion(
      this.context,
      workflow.id,
      workflow.draftRevision,
    );
    const suite = this.storage.createSuite(this.context, project.id, {
      name: example.suite.name,
      definition: example.suite as unknown as Json,
    });
    const suiteVersion = this.storage.publishSuiteVersion(
      this.context,
      suite.id,
      workflowVersion.id,
      suite.draftRevision,
    );
    return {
      project,
      workflow,
      suite,
      workflowVersion,
      suiteVersion,
      fixtureSetId: example.fixtureSetId,
      profile: example.profile,
    };
  }
  providerStatus() {
    const configured = Boolean(this.providerConfig.apiKey?.trim());
    const enabled = this.providerConfig.enableLive === true;
    return {
      allowedModes: [
        "mock",
        "replay",
        ...(configured && enabled ? ["live"] : []),
      ],
      defaultMode: "mock",
      defaultHttpAttemptLimit: 200,
      maximumHttpAttemptLimit: 2000,
      providers: [
        { id: "mock", configured: true, defaultModel: "mock-v1" },
        {
          id: "jev",
          configured,
          enabled,
          defaultModel: this.providerConfig.defaultModel,
        },
      ],
    };
  }
  private liveAdapter() {
    if (!this.providerConfig.enableLive)
      throw new PathsmithError(
        "LIVE_DISABLED",
        "Live execution is not enabled on this server",
      );
    return createJevProvider({
      apiKey: this.providerConfig.apiKey ?? "",
      fetch: this.providerConfig.fetch,
    });
  }
  queue(input: {
    workflowVersionId: string;
    suiteVersionId: string;
    mode?: ExecutionMode;
    fixtureSetId?: string;
    sourceRunId?: string;
    confirmLive?: boolean;
    profile?: ExecutionProfile;
    selectedScenarioIds?: string[];
    limits?: Partial<ExecutionLimits>;
    concurrency?: number;
    httpAttemptLimit?: number;
  }) {
    const mode = input.mode ?? "mock";
    const request: QueueRunInput = {
      workflowVersionId: input.workflowVersionId,
      suiteVersionId: input.suiteVersionId,
      selectedScenarioIds: input.selectedScenarioIds,
      limits: input.limits,
      concurrency: input.concurrency,
      httpAttemptLimit: input.httpAttemptLimit,
      mode,
    };
    if (mode === "mock") {
      if (
        !input.fixtureSetId ||
        input.sourceRunId !== undefined ||
        input.confirmLive !== undefined
      )
        throw new StorageError(
          "INVALID_REQUEST",
          "Mock mode requires a fixture set only",
        );
      const fixtureSet = loadFixtureSet(input.fixtureSetId);
      request.fixtures = fixtureSet.fixtures;
      request.profile = input.profile ?? fixtureSet.profile;
    } else if (mode === "replay") {
      if (
        !input.sourceRunId ||
        input.fixtureSetId !== undefined ||
        input.confirmLive !== undefined
      )
        throw new StorageError(
          "INVALID_REQUEST",
          "Replay requires a source run only",
        );
      request.sourceRunId = input.sourceRunId;
      if (input.profile) request.profile = input.profile;
    } else {
      if (
        input.confirmLive !== true ||
        input.fixtureSetId !== undefined ||
        input.sourceRunId !== undefined
      )
        throw new StorageError(
          "INVALID_REQUEST",
          "Live mode requires explicit confirmation and no mock or replay source",
        );
      const adapter = this.liveAdapter();
      const workflow = this.storage.getWorkflowVersion(
        this.context,
        input.workflowVersionId,
      );
      request.profile = input.profile ?? {
        formatVersion: "0.1",
        bindings: Object.fromEntries(
          workflow.definition.bindings.map((name) => [
            name,
            { providerId: "jev", model: this.providerConfig.defaultModel! },
          ]),
        ),
      };
      assertValid(
        validateProfile(request.profile, workflow.definition),
        "PROVIDER_NOT_CONFIGURED",
      );
      request.adapters = Object.fromEntries(
        Object.entries(request.profile.bindings).map(([name, b]) => [
          name,
          {
            providerId: adapter.id,
            requestedModel: b.model,
            adapterVersion: adapter.version,
            normalizerVersion: adapter.normalizerVersion,
            resolvedModels: [],
          },
        ]),
      );
      request.liveConfirmed = true;
    }
    const run = this.storage.queueRun(this.context, request);
    this.schedule();
    return this.view(run);
  }
  private bindings(run: RunRecord): Bindings {
    const snapshot = run.snapshot;
    if (snapshot.mode === "replay") {
      const source = this.storage.getRun(this.context, snapshot.sourceRunId!);
      if (!source.report || source.projectId !== run.projectId)
        throw new StorageError(
          "LIFECYCLE_CONFLICT",
          "Replay source is unavailable",
        );
      return createReplayBindings(source.report);
    }
    const adapter =
      snapshot.mode === "live"
        ? this.liveAdapter()
        : createMockProvider(snapshot.fixtures);
    return Object.fromEntries(
      Object.entries(snapshot.profile.bindings).map(([name, binding]) => [
        name,
        { ...binding, adapter },
      ]),
    );
  }
  exportRun(id: string) {
    const run = this.storage.getRun(this.context, id);
    if (!run.report)
      throw new StorageError(
        "LIFECYCLE_CONFLICT",
        "Run has no final report to export",
      );
    return run.report;
  }
  private schedule() {
    if (this.stopping || this.scheduled || this.running) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      this.running = this.drain().finally(() => {
        this.running = undefined;
      });
    });
  }
  private async drain() {
    while (!this.stopping) {
      let run: RunRecord | null;
      try {
        run = this.storage.claimNextRun(this.context);
      } catch {
        this.storageFailed = true;
        return;
      }
      if (!run) return;
      const controller = new AbortController();
      this.active = { id: run.id, controller };
      try {
        const snapshot = run.snapshot;
        const report = await runSuite({
          workflow: snapshot.workflow,
          suite: snapshot.suite,
          mode: snapshot.mode,
          bindings: this.bindings(run),
          sourceRunId: snapshot.sourceRunId ?? undefined,
          sourceOrigin:
            snapshot.mode === "replay" ? snapshot.origin : undefined,
          httpAttemptLimit: snapshot.httpAttemptLimit ?? 200,
          selectedScenarioIds: snapshot.selectedScenarioIds,
          limits: snapshot.limits,
          concurrency: snapshot.concurrency,
          runId: run.id,
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          signal: controller.signal,
          onScenario: (result) => {
            this.storage.appendScenarioResult(this.context, run!.id, result);
          },
        });
        // Closing preserves the job as unfinished; startup marks it interrupted.
        if (!this.stopping)
          this.storage.finishRun(this.context, run.id, report);
      } catch (error) {
        if (!this.stopping) {
          const failure =
            error instanceof PathsmithError
              ? toExecutionError(error)
              : {
                  code: "STORAGE_ERROR",
                  message: "Unable to persist required run results",
                  retryable: false,
                };
          try {
            this.storage.failRun(this.context, run.id, failure);
          } catch {
            this.storageFailed = true;
          }
        }
      } finally {
        this.active = undefined;
      }
    }
  }
  cancel(id: string) {
    const { run, active } = this.storage.requestCancellation(this.context, id);
    if (active && this.active?.id === id) this.active.controller.abort();
    return this.view(run);
  }
  allScenarios(id: string): ScenarioRunRecord[] {
    const items: ScenarioRunRecord[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = this.storage.listScenarioRuns(this.context, id, {
        offset,
        limit: 100,
      });
      items.push(...page.items);
      if (items.length >= page.total) return items;
    }
  }
  view(run: RunRecord) {
    const results =
      run.report?.scenarios ??
      this.allScenarios(run.id).map((item) => item.result);
    const summary =
      run.report?.summary ??
      summarize(run.snapshot.suite, run.snapshot.selectedScenarioIds, results);
    const missing = run.snapshot.selectedScenarioIds.length - results.length;
    const interrupted = run.status === "interrupted" ? missing : 0;
    // A queued cancellation has no dispatched cases and still counts all selected
    // cases as canceled, without fabricating execution records or assertions.
    const canceledBeforeDispatch =
      run.status === "canceled" && !run.report ? missing : 0;
    return {
      id: run.id,
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      status: run.status,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      mode: run.snapshot.mode,
      origin: run.snapshot.origin,
      sourceRunId: run.snapshot.sourceRunId,
      httpAttemptLimit: run.snapshot.httpAttemptLimit ?? 200,
      mixedModel: run.report?.mixedModel ?? false,
      adapters: run.report?.adapters ?? run.snapshot.adapters,
      workflowVersionId: run.snapshot.workflowVersionId,
      suiteVersionId: run.snapshot.suiteVersionId,
      workflowName: run.snapshot.workflow.name,
      suiteName: run.snapshot.suite.name,
      workflowSemanticHash: run.snapshot.workflowSemanticHash,
      artifactHash: run.snapshot.artifactHash,
      suiteSnapshotHash: run.snapshot.suiteSnapshotHash,
      selectedScenarioIds: run.snapshot.selectedScenarioIds,
      summary: {
        ...summary,
        interrupted,
        canceled: summary.canceled + canceledBeforeDispatch,
      },
      progress: {
        selected: run.snapshot.selectedScenarioIds.length,
        persisted: results.length,
        pending: missing - interrupted - canceledBeforeDispatch,
        interrupted,
      },
      error: run.error,
      coverage: run.report?.coverage ?? null,
    };
  }
  history(options: PageOptions & { projectId?: string }) {
    const page = this.storage.listRuns(this.context, options);
    return { ...page, items: page.items.map((run) => this.view(run)) };
  }
  compare(
    baselineId: string,
    candidateId: string,
    policy: { strict: boolean; acceptMixedModel: boolean },
  ) {
    // Look up both IDs in server-owned context. Different projects are allowed;
    // cohort compatibility is decided by the shared comparison implementation.
    const baseline = this.storage.getRun(this.context, baselineId);
    const candidate = this.storage.getRun(this.context, candidateId);
    const configuration = (run: RunRecord) => ({
      profile: run.snapshot.profile,
      limits: run.snapshot.limits,
      concurrency: run.snapshot.concurrency,
      mode: run.snapshot.mode,
      origin: run.snapshot.origin,
      sourceRunId: run.snapshot.sourceRunId,
      httpAttemptLimit: run.snapshot.httpAttemptLimit ?? 200,
      runtimeVersion: run.snapshot.runtimeVersion,
      adapters: run.report?.adapters ?? run.snapshot.adapters,
    });
    const before = configuration(baseline),
      after = configuration(candidate);
    const configurationDiff = (Object.keys(before) as (keyof typeof before)[])
      .filter((key) => canonicalize(before[key]) !== canonicalize(after[key]))
      .map((key) => ({ key, before: before[key], after: after[key] }));
    const metadata = {
      baselineStatus: baseline.status,
      candidateStatus: candidate.status,
      configurationDiff,
    };
    if (!baseline.report || !candidate.report) {
      // No final report means no complete comparison cohort. Do not synthesize
      // execution results or advertise zero regressions for unavailable pairs.
      return {
        formatVersion: "0.1",
        artifactType: "pathsmith_comparison",
        baselineRunId: baseline.id,
        candidateRunId: candidate.id,
        suiteSnapshotHash: baseline.snapshot.suiteSnapshotHash,
        selectedScenarioIds: [...baseline.snapshot.selectedScenarioIds].sort(),
        gate: "inconclusive",
        policy,
        issues: [baseline, candidate].flatMap((run, i) =>
          run.report
            ? []
            : [
                `${i === 0 ? "Baseline" : "Candidate"} run has no final report (${run.status})`,
              ],
        ),
        changedCases: null,
        newAssertionRegressions: null,
        assertionImprovements: null,
        newExecutionRegressions: null,
        modelChanged: null,
        workflowChanged:
          baseline.snapshot.workflowSemanticHash !==
          candidate.snapshot.workflowSemanticHash,
        confounded: null,
        workflowDiff: workflowDiff(
          baseline.snapshot.workflow,
          candidate.snapshot.workflow,
        ),
        cases: [],
        ...metadata,
      };
    }
    const comparison = compareRuns(baseline.report, candidate.report, policy);
    return {
      ...comparison,
      ...metadata,
      cases: comparison.cases.map((item) => ({
        ...item,
        baseline: {
          ...item.baseline,
          selectedEdges: baseline.report!.scenarios.find(
            (s) => s.scenarioId === item.scenarioId,
          )!.selectedEdges,
          visitedNodes: baseline.report!.scenarios.find(
            (s) => s.scenarioId === item.scenarioId,
          )!.visitedNodes,
        },
        candidate: {
          ...item.candidate,
          selectedEdges: candidate.report!.scenarios.find(
            (s) => s.scenarioId === item.scenarioId,
          )!.selectedEdges,
          visitedNodes: candidate.report!.scenarios.find(
            (s) => s.scenarioId === item.scenarioId,
          )!.visitedNodes,
        },
      })),
    };
  }
  snapshot(id: string) {
    const run = this.storage.getRun(this.context, id);
    const { fixtures: _fixtures, ...snapshot } = run.snapshot;
    return { ...snapshot, adapters: run.report?.adapters ?? snapshot.adapters };
  }
  coverage(id: string) {
    const run = this.storage.getRun(this.context, id);
    if (run.report) return run.report.coverage;
    const results = this.allScenarios(id).map((item) => item.result);
    if (!results.length) return null;
    // Saved results are only the observed part of an unfinished run. Even if
    // every saved case completed, absent cases cannot establish full coverage.
    return { ...coverage(run.snapshot.workflow, results), partial: true };
  }
  scenarios(
    id: string,
    options: PageOptions & { status?: string; assertionStatus?: string },
  ) {
    const offset = options.offset ?? 0,
      limit = options.limit ?? 50;
    const items = this.allScenarios(id).filter(
      (item) =>
        (!options.status || item.result.status === options.status) &&
        (!options.assertionStatus ||
          item.result.assertionStatus === options.assertionStatus),
    );
    return {
      total: items.length,
      offset,
      limit,
      items: items.slice(offset, offset + limit).map((item) => {
        const {
          events: _events,
          exchanges: _exchanges,
          outputs: _outputs,
          ...result
        } = item.result;
        return { ...item, result };
      }),
    };
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.scheduled) clearImmediate(this.scheduled);
    this.active?.controller.abort();
    try {
      await this.running;
    } finally {
      this.storage.close();
    }
  }
}

export type RunView = ReturnType<LocalApplication["view"]>;
export type ScenarioSummary = Omit<
  ScenarioResult,
  "events" | "exchanges" | "outputs"
>;
