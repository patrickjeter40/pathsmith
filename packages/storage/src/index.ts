import { MAX_HTTP_ATTEMPTS } from "@pathsmith/contracts";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import {
  inspectJson,
  validateWorkflow,
  validateSuite,
  validateProfile,
  type Json,
  type Workflow,
} from "@pathsmith/contracts";
import {
  assertValid,
  canonicalize,
  hash,
  workflowHashes,
  resolveLimits,
  RUNTIME_VERSION,
  validUsage,
  requestFingerprint,
  immutable,
  type ExecutionError,
} from "@pathsmith/core";
import { createMockProvider } from "@pathsmith/provider-mock";
import {
  summarize,
  coverage,
  type RunReport,
  type ScenarioResult,
  type ClassificationFacts,
  type SummaryFacts,
} from "@pathsmith/evaluation";
import { createReplayBindings } from "@pathsmith/provider-replay";
import { migrate } from "./migrations.js";
import type {
  WorkspaceContext,
  ProjectRecord,
  WorkflowRecord,
  SuiteRecord,
  WorkflowVersion,
  SuiteVersion,
  QueueRunInput,
  RunRecord,
  RunSnapshot,
  RunStatus,
  ScenarioRunRecord,
  PageOptions,
  Page,
  RunOverview,
} from "./types.js";
export * from "./types.js";

export class StorageError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "DRAFT_CONFLICT"
      | "LIFECYCLE_CONFLICT"
      | "STORAGE_LOCKED"
      | "INVALID_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
const now = () => new Date().toISOString();
const encode = (value: unknown) => canonicalize(value);
const decode = <T>(value: string): T => JSON.parse(value) as T;
function json(value: unknown, maxBytes: number): Json {
  const diagnostics = inspectJson(value, maxBytes);
  assertValid(
    { valid: diagnostics.length === 0, diagnostics },
    "ARTIFACT_INVALID",
  );
  return decode<Json>(encode(value));
}
function nameValue(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new StorageError(
      "INVALID_REQUEST",
      "Name must contain 1–200 characters",
    );
  return value.trim();
}
const pageOptions = (options: PageOptions = {}) => {
  const offset = options.offset ?? 0,
    limit = options.limit ?? 50;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new StorageError("INVALID_REQUEST", "Invalid pagination");
  return { offset, limit };
};
type RunRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  snapshot: string;
  report: string | null;
  error: string | null;
  completed_scenarios: number;
};

export function openStorage(
  options: {
    dataDir?: string;
    workspaceId?: string;
    workspaceName?: string;
  } = {},
): SqliteStorage {
  return new SqliteStorage(options);
}

export class SqliteStorage {
  readonly localContext: WorkspaceContext;
  readonly dataDir: string;
  readonly schemaVersion: number;
  private readonly connection!: Database.Database;
  private readonly lock: Database.Database;
  private readonly db: BetterSQLite3Database;
  private closed = false;
  // Only one active job exists. Never cache mutable job lifecycle or ownership.
  private appendCache?: { id: string; workspaceId: string; snapshot: RunSnapshot;
    positions: Map<string, { position: number; inputHash: string }> };

  constructor(
    options: {
      dataDir?: string;
      workspaceId?: string;
      workspaceName?: string;
    } = {},
  ) {
    this.dataDir = resolve(options.dataDir ?? ".pathsmith");
    mkdirSync(this.dataDir, { recursive: true });
    // An OS-held rollback-journal lock is released even after a process crash.
    this.lock = new Database(join(this.dataDir, "runner-lock.sqlite"), {
      timeout: 0,
    });
    try {
      this.lock.exec(
        "PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id INTEGER)",
      );
    } catch {
      this.lock.close();
      throw new StorageError(
        "STORAGE_LOCKED",
        "Another Pathsmith process owns this data directory",
      );
    }
    try {
      this.connection = new Database(join(this.dataDir, "pathsmith.sqlite"));
      this.connection.pragma("foreign_keys = ON");
      this.connection.pragma("journal_mode = WAL");
      this.db = drizzle(this.connection);
      this.schemaVersion = migrate(this.db);
      this.localContext = Object.freeze({
        workspaceId: options.workspaceId ?? "local",
      });
      this.db.run(
        sql`INSERT INTO workspaces(id,name) VALUES (${this.localContext.workspaceId},${options.workspaceName ?? "Local workspace"}) ON CONFLICT(id) DO NOTHING`,
      );
      const error: ExecutionError = {
        code: "RUN_INTERRUPTED",
        message:
          "The application stopped before this run finished. Start a new run to retry.",
        retryable: false,
      };
      this.db.run(
        sql`UPDATE runs SET status='interrupted',completed_at=${now()},error=${encode(error)} WHERE status IN ('queued','running','canceling')`,
      );
    } catch (error) {
      this.connection?.close();
      this.lock.close();
      throw error;
    }
  }
  close(): void {
    if (!this.closed) {
      this.connection.close();
      this.lock.close();
      this.closed = true;
    }
  }
  private record<T>(table: string, ctx: WorkspaceContext, id: string): T {
    const row = this.db.get<{ record: string }>(
      sql`SELECT record FROM ${sql.identifier(table)} WHERE workspace_id=${ctx.workspaceId} AND id=${id}`,
    );
    if (!row)
      throw new StorageError(
        "NOT_FOUND",
        "Resource not found in this workspace",
      );
    return decode<T>(row.record);
  }
  private records<T>(
    table: string,
    ctx: WorkspaceContext,
    projectId?: string,
  ): T[] {
    const where =
      projectId === undefined
        ? sql`workspace_id=${ctx.workspaceId}`
        : sql`workspace_id=${ctx.workspaceId} AND project_id=${projectId}`;
    return this.db
      .all<{ record: string }>(
        sql`SELECT record FROM ${sql.identifier(table)} WHERE ${where} ORDER BY rowid`,
      )
      .map((row) => decode<T>(row.record));
  }
  createProject(ctx: WorkspaceContext, name: string): ProjectRecord {
    const item = {
      id: randomUUID(),
      workspaceId: ctx.workspaceId,
      name: nameValue(name),
      createdAt: now(),
    };
    this.db.run(
      sql`INSERT INTO projects VALUES (${item.id},${ctx.workspaceId},${encode(item)})`,
    );
    return item;
  }
  listProjects(ctx: WorkspaceContext): ProjectRecord[] {
    return this.records("projects", ctx);
  }
  getProject(ctx: WorkspaceContext, id: string): ProjectRecord {
    return this.record("projects", ctx, id);
  }
  deleteProject(ctx: WorkspaceContext, id: string): void {
    this.getProject(ctx, id);
    if (
      this.db.get(
        sql`SELECT 1 FROM runs WHERE workspace_id=${ctx.workspaceId} AND project_id=${id} AND status IN ('queued','running','canceling')`,
      )
    )
      throw new StorageError(
        "LIFECYCLE_CONFLICT",
        "Cancel active runs before deleting the project",
      );
    this.db.transaction((tx) => {
      if (
        tx.get(
          sql`SELECT 1 FROM runs WHERE workspace_id=${ctx.workspaceId} AND project_id=${id} AND source_run_id IS NOT NULL`,
        )
      )
        throw new StorageError(
          "LIFECYCLE_CONFLICT",
          "Delete dependent replay runs first",
        );
      tx.run(
        sql`DELETE FROM runs WHERE workspace_id=${ctx.workspaceId} AND project_id=${id}`,
      );
      tx.run(
        sql`DELETE FROM projects WHERE workspace_id=${ctx.workspaceId} AND id=${id}`,
      );
    });
  }
  createWorkflow(
    ctx: WorkspaceContext,
    projectId: string,
    input: { name: string; definition?: Json; layout?: Json },
  ): WorkflowRecord {
    this.getProject(ctx, projectId);
    const definition = json(input.definition ?? {}, 512 * 1024),
      layout = json(input.layout ?? {}, 512 * 1024);
    const item: WorkflowRecord = {
      id: randomUUID(),
      workspaceId: ctx.workspaceId,
      projectId,
      name: nameValue(input.name),
      definition,
      layout,
      draftRevision: 1,
      diagnostics: validateWorkflow(definition).diagnostics,
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.run(
      sql`INSERT INTO workflows VALUES (${item.id},${ctx.workspaceId},${projectId},1,${encode(item)})`,
    );
    return item;
  }
  getWorkflow(ctx: WorkspaceContext, id: string): WorkflowRecord {
    return this.record("workflows", ctx, id);
  }
  listWorkflows(ctx: WorkspaceContext, projectId: string): WorkflowRecord[] {
    this.getProject(ctx, projectId);
    return this.records("workflows", ctx, projectId);
  }
  saveWorkflowDraft(
    ctx: WorkspaceContext,
    id: string,
    input: { expectedRevision: number; definition: Json; layout?: Json },
  ): WorkflowRecord {
    const previous = this.getWorkflow(ctx, id),
      definition = json(input.definition, 512 * 1024);
    const item = {
      ...previous,
      definition,
      layout: json(input.layout ?? previous.layout, 512 * 1024),
      draftRevision: previous.draftRevision + 1,
      diagnostics: validateWorkflow(definition).diagnostics,
      updatedAt: now(),
    };
    this.saveDraft("workflows", ctx, id, input.expectedRevision, item);
    return item;
  }
  private saveDraft(
    table: string,
    ctx: WorkspaceContext,
    id: string,
    expectedRevision: number,
    item: WorkflowRecord | SuiteRecord,
  ) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new StorageError(
        "INVALID_REQUEST",
        "Expected revision must be a positive integer",
      );
    const changed = this.db.run(
      sql`UPDATE ${sql.identifier(table)} SET revision=revision+1,record=${encode(item)} WHERE workspace_id=${ctx.workspaceId} AND id=${id} AND revision=${expectedRevision}`,
    );
    if (changed.changes !== 1)
      throw new StorageError(
        "DRAFT_CONFLICT",
        "Draft changed in another session; reload before saving",
      );
  }
  publishWorkflowVersion(
    ctx: WorkspaceContext,
    id: string,
    expectedRevision?: number,
  ): WorkflowVersion {
    const draft = this.getWorkflow(ctx, id);
    if (
      expectedRevision !== undefined &&
      expectedRevision !== draft.draftRevision
    )
      throw new StorageError(
        "DRAFT_CONFLICT",
        "Draft changed before publishing",
      );
    assertValid(validateWorkflow(draft.definition));
    const definition = draft.definition as unknown as Workflow;
    const item: WorkflowVersion = {
      id: randomUUID(),
      workspaceId: ctx.workspaceId,
      projectId: draft.projectId,
      workflowId: id,
      draftRevision: draft.draftRevision,
      definition,
      layout: draft.layout,
      ...workflowHashes(definition),
      createdAt: now(),
    };
    this.db.run(
      sql`INSERT INTO workflow_versions VALUES (${item.id},${ctx.workspaceId},${item.projectId},${id},${encode(item)})`,
    );
    return item;
  }
  getWorkflowVersion(ctx: WorkspaceContext, id: string): WorkflowVersion {
    return this.record("workflow_versions", ctx, id);
  }
  listWorkflowVersions(ctx: WorkspaceContext, id: string): WorkflowVersion[] {
    this.getWorkflow(ctx, id);
    return this.db
      .all<{ record: string }>(
        sql`SELECT record FROM workflow_versions WHERE workspace_id=${ctx.workspaceId} AND parent_id=${id} ORDER BY rowid DESC`,
      )
      .map((row) => decode<WorkflowVersion>(row.record));
  }
  createSuite(
    ctx: WorkspaceContext,
    projectId: string,
    input: { name: string; definition?: Json },
  ): SuiteRecord {
    this.getProject(ctx, projectId);
    const item: SuiteRecord = {
      id: randomUUID(),
      workspaceId: ctx.workspaceId,
      projectId,
      name: nameValue(input.name),
      definition: json(input.definition ?? {}, 8 * 1024 * 1024),
      draftRevision: 1,
      diagnostics: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.run(
      sql`INSERT INTO suites VALUES (${item.id},${ctx.workspaceId},${projectId},1,${encode(item)})`,
    );
    return item;
  }
  getSuite(ctx: WorkspaceContext, id: string): SuiteRecord {
    return this.record("suites", ctx, id);
  }
  listSuites(ctx: WorkspaceContext, projectId: string): SuiteRecord[] {
    this.getProject(ctx, projectId);
    return this.records("suites", ctx, projectId);
  }
  saveSuiteDraft(
    ctx: WorkspaceContext,
    id: string,
    input: {
      expectedRevision: number;
      definition: Json;
      workflowVersionId?: string;
    },
  ): SuiteRecord {
    const draft = this.getSuite(ctx, id),
      definition = json(input.definition, 8 * 1024 * 1024);
    const workflow = input.workflowVersionId
      ? this.getWorkflowVersion(ctx, input.workflowVersionId)
      : undefined;
    if (workflow && workflow.projectId !== draft.projectId)
      throw new StorageError(
        "NOT_FOUND",
        "Workflow version does not belong to this project",
      );
    const item = {
      ...draft,
      definition,
      draftRevision: draft.draftRevision + 1,
      diagnostics: workflow
        ? validateSuite(definition, workflow.definition).diagnostics
        : [],
      updatedAt: now(),
    };
    this.saveDraft("suites", ctx, id, input.expectedRevision, item);
    return item;
  }
  publishSuiteVersion(
    ctx: WorkspaceContext,
    id: string,
    workflowVersionId: string,
    expectedRevision?: number,
  ): SuiteVersion {
    const draft = this.getSuite(ctx, id),
      workflow = this.getWorkflowVersion(ctx, workflowVersionId);
    if (draft.projectId !== workflow.projectId)
      throw new StorageError(
        "NOT_FOUND",
        "Workflow version does not belong to this project",
      );
    if (
      expectedRevision !== undefined &&
      expectedRevision !== draft.draftRevision
    )
      throw new StorageError(
        "DRAFT_CONFLICT",
        "Draft changed before publishing",
      );
    assertValid(
      validateSuite(draft.definition, workflow.definition),
      "SUITE_INVALID",
    );
    const item: SuiteVersion = {
      id: randomUUID(),
      workspaceId: ctx.workspaceId,
      projectId: draft.projectId,
      suiteId: id,
      draftRevision: draft.draftRevision,
      definition: draft.definition as unknown as SuiteVersion["definition"],
      suiteSnapshotHash: hash(draft.definition),
      createdAt: now(),
    };
    this.db.run(
      sql`INSERT INTO suite_versions VALUES (${item.id},${ctx.workspaceId},${item.projectId},${id},${encode(item)})`,
    );
    return item;
  }
  getSuiteVersion(ctx: WorkspaceContext, id: string): SuiteVersion {
    return this.record("suite_versions", ctx, id);
  }
  listSuiteVersions(ctx: WorkspaceContext, id: string): SuiteVersion[] {
    this.getSuite(ctx, id);
    return this.db
      .all<{ record: string }>(
        sql`SELECT record FROM suite_versions WHERE workspace_id=${ctx.workspaceId} AND parent_id=${id} ORDER BY rowid DESC`,
      )
      .map((row) => decode<SuiteVersion>(row.record));
  }
  queueRun(ctx: WorkspaceContext, input: QueueRunInput): RunRecord {
    const workflow = this.getWorkflowVersion(ctx, input.workflowVersionId),
      suite = this.getSuiteVersion(ctx, input.suiteVersionId);
    if (workflow.projectId !== suite.projectId)
      throw new StorageError(
        "NOT_FOUND",
        "Versions do not belong to the same project",
      );
    const mode = input.mode ?? "mock";
    if (!["mock", "live", "replay"].includes(mode))
      throw new StorageError("INVALID_REQUEST", "Unknown execution mode");
    assertValid(validateWorkflow(workflow.definition));
    assertValid(
      validateSuite(
        suite.definition,
        workflow.definition,
        input.selectedScenarioIds,
      ),
      "SUITE_INVALID",
    );
    const concurrency = input.concurrency ?? (mode === "live" ? 4 : 16);
    const httpAttemptLimit = input.httpAttemptLimit ?? 200;
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 16
    )
      throw new StorageError(
        "INVALID_REQUEST",
        "Concurrency must be between 1 and 16",
      );
    if (
      !Number.isSafeInteger(httpAttemptLimit) ||
      httpAttemptLimit < 1 ||
      httpAttemptLimit > MAX_HTTP_ATTEMPTS
    )
      throw new StorageError(
        "INVALID_REQUEST",
        "HTTP attempt limit must be between 1 and 30,000",
      );
    let profile = input.profile;
    let adapters: RunReport["adapters"];
    let origin: RunSnapshot["origin"] = mode === "live" ? "live" : "synthetic";
    let sourceRunId: string | null = null;
    if (mode === "replay") {
      if (
        !input.sourceRunId ||
        input.fixtures !== undefined ||
        input.liveConfirmed
      )
        throw new StorageError(
          "INVALID_REQUEST",
          "Replay requires a saved source run and no live confirmation or mock fixtures",
        );
      const source = this.getRun(ctx, input.sourceRunId);
      if (source.projectId !== workflow.projectId)
        throw new StorageError(
          "NOT_FOUND",
          "Source run does not belong to this project",
        );
      if (!source.report)
        throw new StorageError(
          "LIFECYCLE_CONFLICT",
          "Replay source has no final recording",
        );
      createReplayBindings(source.report);
      if (profile && hash(profile) !== hash(source.report.profile))
        throw new StorageError(
          "INVALID_REQUEST",
          "Replay profile conflicts with the source recording",
        );
      profile = source.report.profile;
      adapters = source.report.adapters;
      origin = source.report.origin;
      sourceRunId = source.id;
    } else {
      if (input.sourceRunId !== undefined)
        throw new StorageError(
          "INVALID_REQUEST",
          "Only replay may reference a source run",
        );
      assertValid(
        validateProfile(profile, workflow.definition),
        "PROVIDER_NOT_CONFIGURED",
      );
      if (mode === "mock") {
        if (input.liveConfirmed)
          throw new StorageError(
            "INVALID_REQUEST",
            "Mock runs cannot include live confirmation",
          );
        const adapter = createMockProvider(input.fixtures);
        adapters = Object.fromEntries(
          Object.entries(profile!.bindings).map(([name, binding]) => [
            name,
            {
              providerId: binding.providerId,
              requestedModel: binding.model,
              adapterVersion: adapter.version,
              normalizerVersion: adapter.normalizerVersion,
              resolvedModels: [],
            },
          ]),
        );
      } else {
        if (
          input.fixtures !== undefined ||
          input.liveConfirmed !== true ||
          !input.adapters
        )
          throw new StorageError(
            "INVALID_REQUEST",
            "Live runs require explicit confirmation and server adapter metadata",
          );
        adapters = input.adapters;
      }
      if (
        Object.values(profile!.bindings).some(
          (b) => b.providerId !== (mode === "mock" ? "mock" : "jev"),
        )
      )
        throw new StorageError(
          "INVALID_REQUEST",
          "Binding provider does not match the execution mode",
        );
    }
    assertValid(
      validateProfile(profile, workflow.definition),
      "PROVIDER_NOT_CONFIGURED",
    );
    if (
      hash(Object.keys(adapters).sort()) !==
      hash(Object.keys(profile!.bindings).sort())
    )
      throw new StorageError(
        "INVALID_REQUEST",
        "Adapter metadata does not match bindings",
      );
    // Keep only the public identity fields; adapter instances and credentials never enter snapshots.
    adapters = Object.fromEntries(
      Object.entries(profile!.bindings).map(([name, binding]) => {
        const adapter = adapters[name];
        if (
          !adapter ||
          adapter.providerId !== binding.providerId ||
          adapter.requestedModel !== binding.model ||
          ![adapter.adapterVersion, adapter.normalizerVersion].every(
            (v) => typeof v === "string" && v.length > 0 && v.length <= 128,
          ) ||
          !Array.isArray(adapter.resolvedModels) ||
          adapter.resolvedModels.some((v) => typeof v !== "string") ||
          (mode !== "replay" && adapter.resolvedModels.length)
        )
          throw new StorageError("INVALID_REQUEST", "Invalid adapter metadata");
        return [
          name,
          {
            providerId: adapter.providerId,
            requestedModel: adapter.requestedModel,
            adapterVersion: adapter.adapterVersion,
            normalizerVersion: adapter.normalizerVersion,
            resolvedModels: adapter.resolvedModels,
          },
        ];
      }),
    );
    const snapshot: RunSnapshot = {
      workflowVersionId: workflow.id,
      suiteVersionId: suite.id,
      workflow: workflow.definition,
      layout: workflow.layout,
      suite: suite.definition,
      artifactHash: workflow.artifactHash,
      workflowSemanticHash: workflow.workflowSemanticHash,
      suiteSnapshotHash: suite.suiteSnapshotHash,
      profile: profile!,
      limits: resolveLimits(input.limits),
      selectedScenarioIds: (
        input.selectedScenarioIds ??
        suite.definition.scenarios.map((item) => item.id)
      )
        .slice()
        .sort(),
      concurrency,
      mode,
      origin,
      sourceRunId,
      httpAttemptLimit,
      liveConfirmed: mode === "live",
      runtimeVersion: RUNTIME_VERSION,
      ...(mode === "mock" ? { fixtures: input.fixtures } : {}),
      adapters,
    };
    const id = randomUUID();
    this.db.run(
      sql`INSERT INTO runs(id,workspace_id,project_id,workflow_version_id,suite_version_id,source_run_id,status,created_at,snapshot) VALUES (${id},${ctx.workspaceId},${workflow.projectId},${workflow.id},${suite.id},${sourceRunId},'queued',${now()},${encode(snapshot)})`,
    );
    return this.getRun(ctx, id);
  }
  private runRow(row: RunRow): RunRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      status: row.status,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      snapshot: decode(row.snapshot),
      report: row.report ? decode(row.report) : null,
      error: row.error ? decode(row.error) : null,
      completedScenarios: row.completed_scenarios,
    };
  }
  getRun(ctx: WorkspaceContext, id: string): RunRecord {
    const row = this.db.get<RunRow>(
      sql`SELECT runs.*,(SELECT COUNT(*) FROM scenario_runs WHERE run_id=runs.id) AS completed_scenarios FROM runs WHERE workspace_id=${ctx.workspaceId} AND id=${id}`,
    );
    if (!row)
      throw new StorageError("NOT_FOUND", "Run not found in this workspace");
    return this.runRow(row);
  }
  getRunOverview(ctx: WorkspaceContext, id: string): RunOverview {
    const row = this.db.get<RunRow>(sql`SELECT id,workspace_id,project_id,status,created_at,started_at,completed_at,error,
      json_remove(snapshot,'$.fixtures') AS snapshot,
      overview AS report,
      (SELECT COUNT(*) FROM scenario_runs WHERE run_id=runs.id) AS completed_scenarios
      FROM runs WHERE workspace_id=${ctx.workspaceId} AND id=${id}`);
    if (!row) throw new StorageError("NOT_FOUND", "Run not found in this workspace");
    const result = this.runRow(row) as RunOverview;
    if (result.report) result.report.mixedModel = Boolean(result.report.mixedModel);
    return result;
  }
  listRunOverviews(ctx: WorkspaceContext, options: PageOptions & { projectId?: string } = {}): Page<RunOverview> {
    const { offset, limit } = pageOptions(options);
    const where = options.projectId ? sql`workspace_id=${ctx.workspaceId} AND project_id=${options.projectId}` : sql`workspace_id=${ctx.workspaceId}`;
    const ids = this.db.all<{id:string}>(sql`SELECT id FROM runs WHERE ${where} ORDER BY created_at DESC,rowid DESC LIMIT ${limit} OFFSET ${offset}`);
    return { offset, limit, total: this.db.get<{total:number}>(sql`SELECT COUNT(*) AS total FROM runs WHERE ${where}`)!.total,
      items: ids.map(({id}) => this.getRunOverview(ctx,id)) };
  }
  listRuns(
    ctx: WorkspaceContext,
    options: PageOptions & { projectId?: string } = {},
  ): Page<RunRecord> {
    const { offset, limit } = pageOptions(options),
      where = options.projectId
        ? sql`workspace_id=${ctx.workspaceId} AND project_id=${options.projectId}`
        : sql`workspace_id=${ctx.workspaceId}`;
    return {
      offset,
      limit,
      total: this.db.get<{ total: number }>(
        sql`SELECT COUNT(*) AS total FROM runs WHERE ${where}`,
      )!.total,
      items: this.db
        .all<RunRow>(
          sql`SELECT runs.*,(SELECT COUNT(*) FROM scenario_runs WHERE run_id=runs.id) AS completed_scenarios FROM runs WHERE ${where} ORDER BY created_at DESC,rowid DESC LIMIT ${limit} OFFSET ${offset}`,
        )
        .map((row) => this.runRow(row)),
    };
  }
  claimNextRun(ctx: WorkspaceContext): RunRecord | null {
    return this.db.transaction((tx) => {
      if (
        tx.get(sql`SELECT 1 FROM runs WHERE status IN ('running','canceling')`)
      )
        return null;
      const row = tx.get<{ id: string }>(
        sql`SELECT id FROM runs WHERE workspace_id=${ctx.workspaceId} AND status='queued' ORDER BY created_at,rowid LIMIT 1`,
      );
      if (!row) return null;
      tx.run(
        sql`UPDATE runs SET status='running',started_at=${now()} WHERE id=${row.id} AND workspace_id=${ctx.workspaceId} AND status='queued'`,
      );
      return this.getRun(ctx, row.id);
    });
  }
  requestCancellation(
    ctx: WorkspaceContext,
    id: string,
  ): { run: RunRecord; active: boolean } {
    const run = this.getRun(ctx, id);
    if (run.status === "queued")
      this.db.run(
        sql`UPDATE runs SET status='canceled',completed_at=${now()} WHERE id=${id} AND workspace_id=${ctx.workspaceId}`,
      );
    else if (run.status === "running")
      this.db.run(
        sql`UPDATE runs SET status='canceling' WHERE id=${id} AND workspace_id=${ctx.workspaceId}`,
      );
    const result = this.getRun(ctx, id);
    return { run: result, active: result.status === "canceling" };
  }
  appendScenarioResult(
    ctx: WorkspaceContext,
    runId: string,
    result: ScenarioResult,
  ): ScenarioRunRecord {
    const lifecycle = this.db.get<{status: RunStatus; project_id: string}>(sql`SELECT status,project_id FROM runs WHERE workspace_id=${ctx.workspaceId} AND id=${runId}`);
    if (!lifecycle) throw new StorageError("NOT_FOUND", "Run not found in this workspace");
    if (!this.appendCache || this.appendCache.id !== runId || this.appendCache.workspaceId !== ctx.workspaceId) {
      const snapshot = immutable(this.getRun(ctx, runId).snapshot);
      const selected = new Set(snapshot.selectedScenarioIds);
      this.appendCache = { id: runId, workspaceId: ctx.workspaceId, snapshot,
        positions: new Map(snapshot.suite.scenarios.filter((s) => selected.has(s.id)).map((s, position) => [s.id, {position, inputHash: hash(s.input)}])) };
    }
    const run = { status: lifecycle.status, projectId: lifecycle.project_id, snapshot: this.appendCache.snapshot };
    if (!["running", "canceling"].includes(run.status))
      throw new StorageError("LIFECYCLE_CONFLICT", "Run is not active");
    const membership = this.appendCache.positions.get(result.scenarioId);
    const position = membership?.position ?? -1;
    if (!membership || membership.inputHash !== hash(result.input))
      throw new StorageError(
        "INVALID_REQUEST",
        "Scenario result does not match the run snapshot",
      );
    const existing = this.db.get<{ id: string; result: string }>(
      sql`SELECT id,result FROM scenario_runs WHERE workspace_id=${ctx.workspaceId} AND run_id=${runId} AND scenario_id=${result.scenarioId}`,
    );
    const payload = encode(result);
    if (existing) {
      if (existing.result !== payload)
        throw new StorageError(
          "LIFECYCLE_CONFLICT",
          "Scenario result is immutable",
        );
      return {
        id: existing.id,
        runId,
        scenarioId: result.scenarioId,
        position,
        result: decode(payload),
      };
    }
    if (
      result.events.some(
        (event, index) =>
          !Number.isSafeInteger(event.sequence) ||
          (index > 0 && event.sequence <= result.events[index - 1].sequence),
      )
    )
      throw new StorageError(
        "INVALID_REQUEST",
        "Trace sequences must increase",
      );
    if (
      result.exchanges.some(
        (exchange) =>
          exchange.runId !== runId || exchange.scenarioId !== result.scenarioId,
      )
    )
      throw new StorageError(
        "INVALID_REQUEST",
        "Exchange scope differs from its run",
      );
    const attempts = result.attempts ?? [];
    if (
      result.actualHttpAttempts !== attempts.length ||
      attempts.some(
        (a) =>
          !["succeeded", "failed", "canceled"].includes(a.status) ||
          !Number.isSafeInteger(a.attempt) ||
          a.attempt < 1 ||
          a.attempt > 3 ||
          !validUsage(a.usage) ||
          !run.snapshot.workflow.nodes.some(
            (n) =>
              n.id === a.nodeId &&
              n.kind === "judgment" &&
              n.binding === a.binding,
          ),
      ) ||
      (run.snapshot.mode !== "live" && attempts.length !== 0) ||
      (run.snapshot.mode === "replay" &&
        result.replayedJudgments !== result.exchanges.length) ||
      (run.snapshot.mode !== "replay" && result.replayedJudgments !== 0)
    )
      throw new StorageError(
        "INVALID_REQUEST",
        "Attempt accounting does not match the run mode",
      );
    if (
      result.exchanges.some((exchange) => {
        const identity = run.snapshot.adapters[exchange.binding];
        return (
          !identity ||
          exchange.providerId !== identity.providerId ||
          exchange.adapterVersion !== identity.adapterVersion ||
          exchange.normalizerVersion !== identity.normalizerVersion ||
          exchange.request.model !== identity.requestedModel ||
          exchange.origin !== run.snapshot.origin ||
          exchange.fingerprint !==
            requestFingerprint(
              {
                providerId: identity.providerId,
                adapterVersion: identity.adapterVersion,
                normalizerVersion: identity.normalizerVersion,
              },
              exchange.request,
            ) ||
          (exchange.sourceRunId ?? null) !== run.snapshot.sourceRunId
        );
      })
    )
      throw new StorageError(
        "INVALID_REQUEST",
        "Exchange provenance does not match the run snapshot",
      );
    const id = randomUUID();
    const {events:_events,exchanges:_exchanges,outputs:_outputs,...compact}=result;
    const target=run.snapshot.suite.classification;
    const nodeAnswer=target ? result.outputs[target.nodeId] : undefined;
    const classificationAnswer=target && nodeAnswer && typeof nodeAnswer==="object" && !Array.isArray(nodeAnswer)
      ? nodeAnswer[target.questionId] ?? null : null;
    const summary=encode({...compact,classificationAnswer});
    this.db.transaction((tx) => {
      tx.run(
        sql`INSERT INTO scenario_runs(id,workspace_id,project_id,run_id,scenario_id,position,result,summary) VALUES (${id},${ctx.workspaceId},${run.projectId},${runId},${result.scenarioId},${position},${payload},${summary})`,
      );
      for (const event of result.events)
        tx.run(
          sql`INSERT INTO node_traces VALUES (${id},${event.sequence},${encode(event)})`,
        );
      for (const [index, attempt] of (result.attempts ?? []).entries())
        tx.run(
          sql`INSERT INTO provider_attempts VALUES (${id},${index},${encode(attempt)})`,
        );
      for (const [index, exchange] of result.exchanges.entries())
        tx.run(
          sql`INSERT INTO provider_exchanges VALUES (${id},${index},${encode(exchange)})`,
        );
    });
    return {
      id,
      runId,
      scenarioId: result.scenarioId,
      position,
      result: decode(payload),
    };
  }
  finishRun(ctx: WorkspaceContext, id: string, report: RunReport): RunRecord {
    const run = this.getRun(ctx, id),
      snapshot = run.snapshot;
    if (!["running", "canceling"].includes(run.status))
      throw new StorageError("LIFECYCLE_CONFLICT", "Run is not active");
    if (
      report.id !== id ||
      report.workspaceId !== ctx.workspaceId ||
      report.projectId !== run.projectId ||
      report.workflowSemanticHash !== snapshot.workflowSemanticHash ||
      report.artifactHash !== snapshot.artifactHash ||
      report.suiteSnapshotHash !== snapshot.suiteSnapshotHash ||
      hash(report.workflow) !== hash(snapshot.workflow) ||
      hash(report.suite) !== hash(snapshot.suite) ||
      hash(report.profile) !== hash(snapshot.profile) ||
      hash(report.limits) !== hash(snapshot.limits) ||
      hash(report.selectedScenarioIds) !== hash(snapshot.selectedScenarioIds) ||
      report.concurrency !== snapshot.concurrency ||
      report.mode !== snapshot.mode ||
      report.origin !== snapshot.origin ||
      report.sourceRunId !== snapshot.sourceRunId ||
      report.runtimeVersion !== snapshot.runtimeVersion ||
      report.httpAttemptLimit !== (snapshot.httpAttemptLimit ?? 200) ||
      report.summary.actualHttpAttempts > (snapshot.httpAttemptLimit ?? 200) ||
      report.status !==
        (report.error || report.scenarios.some((s) => s.status === "failed")
          ? "failed"
          : report.scenarios.some((s) => s.status === "canceled")
            ? "canceled"
            : "completed") ||
      hash(report.summary) !==
        hash(
          summarize(
            snapshot.suite,
            snapshot.selectedScenarioIds,
            report.scenarios,
          ),
        ) ||
      hash(report.coverage) !==
        hash(coverage(snapshot.workflow, report.scenarios)) ||
      hash(Object.keys(report.adapters).sort()) !==
        hash(Object.keys(snapshot.adapters).sort()) ||
      Object.entries(snapshot.adapters).some(([name, original]) => {
        const actual = report.adapters[name];
        return (
          !actual ||
          actual.providerId !== original.providerId ||
          actual.requestedModel !== original.requestedModel ||
          actual.adapterVersion !== original.adapterVersion ||
          actual.normalizerVersion !== original.normalizerVersion ||
          hash(actual.resolvedModels) !==
            hash(
              [
                ...new Set(
                  report.scenarios.flatMap((s) =>
                    s.exchanges
                      .filter((e) => e.binding === name)
                      .map((e) => e.response.model),
                  ),
                ),
              ].sort(),
            )
        );
      }) ||
      report.mixedModel !==
        Object.values(report.adapters).some(
          (a) => a.resolvedModels.length > 1,
        ) ||
      report.scenarios.length !== snapshot.selectedScenarioIds.length ||
      new Set(report.scenarios.map((item) => item.scenarioId)).size !==
        report.scenarios.length
    )
      throw new StorageError(
        "INVALID_REQUEST",
        "Report does not match its immutable run snapshot",
      );
    this.db.transaction((tx) => {
      for (const result of report.scenarios)
        this.appendScenarioResult(ctx, id, result);
      tx.run(
        sql`UPDATE runs SET status=${report.status},completed_at=${now()},report=${encode(report)},overview=${encode({summary:report.summary,coverage:report.coverage,adapters:report.adapters,mixedModel:report.mixedModel})},error=${report.error ? encode(report.error) : null} WHERE workspace_id=${ctx.workspaceId} AND id=${id}`,
      );
    });
    this.appendCache=undefined;
    return this.getRun(ctx, id);
  }
  failRun(ctx: WorkspaceContext, id: string, error: ExecutionError): RunRecord {
    const run = this.getRun(ctx, id);
    if (!["queued", "running", "canceling"].includes(run.status))
      throw new StorageError("LIFECYCLE_CONFLICT", "Run is not active");
    this.db.run(
      sql`UPDATE runs SET status='failed',completed_at=${now()},error=${encode(error)} WHERE workspace_id=${ctx.workspaceId} AND id=${id}`,
    );
    return this.getRun(ctx, id);
  }
  listScenarioRuns(
    ctx: WorkspaceContext,
    runId: string,
    options: PageOptions = {},
  ): Page<ScenarioRunRecord> {
    this.assertRunExists(ctx, runId);
    const { offset, limit } = pageOptions(options);
    const rows = this.db.all<{
      id: string;
      scenario_id: string;
      position: number;
      result: string;
    }>(
      sql`SELECT id,scenario_id,position,result FROM scenario_runs WHERE workspace_id=${ctx.workspaceId} AND run_id=${runId} ORDER BY position LIMIT ${limit} OFFSET ${offset}`,
    );
    return {
      offset,
      limit,
      total: this.db.get<{ total: number }>(
        sql`SELECT COUNT(*) AS total FROM scenario_runs WHERE workspace_id=${ctx.workspaceId} AND run_id=${runId}`,
      )!.total,
      items: rows.map((row) => ({
        id: row.id,
        runId,
        scenarioId: row.scenario_id,
        position: row.position,
        result: decode(row.result),
      })),
    };
  }
  private assertRunExists(ctx: WorkspaceContext, id: string) {
    if (!this.db.get(sql`SELECT 1 FROM runs WHERE workspace_id=${ctx.workspaceId} AND id=${id}`))
      throw new StorageError("NOT_FOUND", "Run not found in this workspace");
  }
  scenarioSummaryFacts(ctx: WorkspaceContext, runId: string): SummaryFacts[] {
    this.assertRunExists(ctx, runId);
    return this.db.all<{result:string}>(sql`SELECT json_remove(summary,'$.attempts','$.input','$.assertions','$.visitedNodes','$.selectedEdges','$.classificationAnswer') AS result
      FROM scenario_runs WHERE workspace_id=${ctx.workspaceId} AND run_id=${runId} ORDER BY position`).map((r) => decode<SummaryFacts>(r.result));
  }
  observedModels(ctx: WorkspaceContext, runId: string): {binding:string;model:string}[] {
    this.assertRunExists(ctx,runId);
    return this.db.all<{binding:string;model:string}>(sql`SELECT DISTINCT
      json_extract(e.payload,'$.binding') AS binding,json_extract(e.payload,'$.response.model') AS model
      FROM provider_exchanges e JOIN scenario_runs s ON s.id=e.scenario_run_id
      WHERE s.workspace_id=${ctx.workspaceId} AND s.run_id=${runId} ORDER BY binding,model`);
  }
  classificationFacts(ctx: WorkspaceContext, runId: string, nodeId: string, questionId: string): (ClassificationFacts & {traceId:string})[] {
    this.assertRunExists(ctx, runId);
    return this.db.all<{id:string;scenario_id:string;status:string;answer:string|null;error:string|null;attempts:number;elapsed:number}>(sql`SELECT id,scenario_id,
      json_extract(summary,'$.status') AS status,json_extract(summary,'$.classificationAnswer') AS answer,json_extract(summary,'$.error') AS error,
      json_extract(summary,'$.actualHttpAttempts') AS attempts,json_extract(summary,'$.elapsedMs') AS elapsed
      FROM scenario_runs WHERE workspace_id=${ctx.workspaceId} AND run_id=${runId} ORDER BY position`).map((r) => ({
        traceId:r.id,scenarioId:r.scenario_id,status:r.status as ScenarioResult["status"],
        outputs:r.answer ? {[nodeId]:{[questionId]:decode<Json>(r.answer)}} : {},
        ...(r.error ? {error:decode<ExecutionError>(r.error)} : {}),actualHttpAttempts:r.attempts,elapsedMs:r.elapsed }));
  }
  listScenarioSummaries(ctx: WorkspaceContext, runId: string, options: PageOptions & {status?:string;assertionStatus?:string} = {}) {
    this.assertRunExists(ctx,runId);
    const {offset,limit}=pageOptions(options);
    const where=sql`workspace_id=${ctx.workspaceId} AND run_id=${runId}
      ${options.status ? sql`AND json_extract(summary,'$.status')=${options.status}` : sql``}
      ${options.assertionStatus ? sql`AND json_extract(summary,'$.assertionStatus')=${options.assertionStatus}` : sql``}`;
    const rows=this.db.all<{id:string;scenario_id:string;position:number;result:string}>(sql`SELECT id,scenario_id,position,
      json_remove(summary,'$.classificationAnswer') AS result FROM scenario_runs WHERE ${where} ORDER BY position LIMIT ${limit} OFFSET ${offset}`);
    return {offset,limit,total:this.db.get<{total:number}>(sql`SELECT COUNT(*) AS total FROM scenario_runs WHERE ${where}`)!.total,
      items:rows.map((r)=>({id:r.id,runId,scenarioId:r.scenario_id,position:r.position,result:decode<Omit<ScenarioResult,"events"|"exchanges"|"outputs">>(r.result)}))};
  }
  getScenarioTrace(ctx: WorkspaceContext, id: string): ScenarioRunRecord {
    const row = this.db.get<{
      run_id: string;
      scenario_id: string;
      position: number;
      result: string;
    }>(
      sql`SELECT * FROM scenario_runs WHERE workspace_id=${ctx.workspaceId} AND id=${id}`,
    );
    if (!row)
      throw new StorageError(
        "NOT_FOUND",
        "Scenario result not found in this workspace",
      );
    return {
      id,
      runId: row.run_id,
      scenarioId: row.scenario_id,
      position: row.position,
      result: decode(row.result),
    };
  }
  deleteRun(ctx: WorkspaceContext, id: string): void {
    const run = this.getRun(ctx, id);
    if (["queued", "running", "canceling"].includes(run.status))
      throw new StorageError(
        "LIFECYCLE_CONFLICT",
        "Cancel the active run before deleting it",
      );
    if (
      this.db.get(
        sql`SELECT 1 FROM runs WHERE workspace_id=${ctx.workspaceId} AND source_run_id=${id}`,
      )
    )
      throw new StorageError(
        "LIFECYCLE_CONFLICT",
        "Delete dependent replay runs first",
      );
    this.db.run(
      sql`DELETE FROM runs WHERE workspace_id=${ctx.workspaceId} AND id=${id}`,
    );
  }
}
