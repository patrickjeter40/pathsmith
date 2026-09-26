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
import {
  openStorage,
  type RunRecord,
  type PageOptions,
  type ScenarioRunRecord,
} from "@pathsmith/storage";
import { loadExample, loadFixtureSet } from "./examples.js";

export class LocalApplication implements OnModuleDestroy {
  readonly storage;
  readonly context;
  private stopping = false;
  private scheduled: NodeJS.Immediate | undefined;
  private active: { id: string; controller: AbortController } | undefined;
  private running: Promise<void> | undefined;
  storageFailed = false;
  constructor(dataDir?: string) {
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
  queue(input: {
    workflowVersionId: string;
    suiteVersionId: string;
    fixtureSetId: string;
    profile?: ExecutionProfile;
    selectedScenarioIds?: string[];
    limits?: Partial<ExecutionLimits>;
    concurrency?: number;
  }) {
    const fixtureSet = loadFixtureSet(input.fixtureSetId);
    const run = this.storage.queueRun(this.context, {
      workflowVersionId: input.workflowVersionId,
      suiteVersionId: input.suiteVersionId,
      fixtures: fixtureSet.fixtures,
      profile: input.profile ?? fixtureSet.profile,
      selectedScenarioIds: input.selectedScenarioIds,
      limits: input.limits,
      concurrency: input.concurrency,
      mode: "mock",
    });
    this.schedule();
    return this.view(run);
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
        const snapshot = run.snapshot,
          adapter = createMockProvider(snapshot.fixtures);
        const report = await runSuite({
          workflow: snapshot.workflow,
          suite: snapshot.suite,
          mode: "mock",
          bindings: Object.fromEntries(
            Object.entries(snapshot.profile.bindings).map(([name, binding]) => [
              name,
              { ...binding, adapter },
            ]),
          ),
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
