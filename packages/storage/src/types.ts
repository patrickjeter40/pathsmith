import type {
  Diagnostic,
  ExecutionProfile,
  Fixtures,
  Json,
  Suite,
  Workflow,
} from "@pathsmith/contracts";
import type {
  ExecutionError,
  ExecutionLimits,
  ExecutionMode,
} from "@pathsmith/core";
import type { RunReport, ScenarioResult } from "@pathsmith/evaluation";

/** Constructed by the server; never taken from an HTTP request. */
export interface WorkspaceContext {
  readonly workspaceId: string;
}
export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
}
export interface DraftRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  definition: Json;
  draftRevision: number;
  diagnostics: Diagnostic[];
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowRecord extends DraftRecord {
  layout: Json;
}
export type SuiteRecord = DraftRecord;
export interface WorkflowVersion {
  id: string;
  workspaceId: string;
  projectId: string;
  workflowId: string;
  draftRevision: number;
  definition: Workflow;
  layout: Json;
  artifactHash: string;
  workflowSemanticHash: string;
  createdAt: string;
}
export interface SuiteVersion {
  id: string;
  workspaceId: string;
  projectId: string;
  suiteId: string;
  draftRevision: number;
  definition: Suite;
  suiteSnapshotHash: string;
  createdAt: string;
}
export type RunStatus =
  | "queued"
  | "running"
  | "canceling"
  | "completed"
  | "failed"
  | "canceled"
  | "interrupted";
export interface RunSnapshot {
  workflowVersionId: string;
  suiteVersionId: string;
  workflow: Workflow;
  layout: Json;
  suite: Suite;
  workflowSemanticHash: string;
  artifactHash: string;
  suiteSnapshotHash: string;
  profile: ExecutionProfile;
  limits: ExecutionLimits;
  selectedScenarioIds: string[];
  concurrency: number;
  mode: ExecutionMode;
  origin: "synthetic" | "live";
  sourceRunId: string | null;
  httpAttemptLimit: number;
  liveConfirmed: boolean;
  runtimeVersion: string;
  fixtures?: Fixtures;
  adapters: RunReport["adapters"];
}
export interface RunRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  snapshot: RunSnapshot;
  report: RunReport | null;
  error: ExecutionError | null;
  completedScenarios: number;
}
export type RunOverview = Omit<RunRecord, "report"> & {
  report: Pick<RunReport, "summary" | "coverage" | "adapters" | "mixedModel"> | null;
};
export interface QueueRunInput {
  workflowVersionId: string;
  suiteVersionId: string;
  profile?: ExecutionProfile;
  fixtures?: Fixtures;
  selectedScenarioIds?: string[];
  limits?: Partial<ExecutionLimits>;
  concurrency?: number;
  mode?: ExecutionMode;
  sourceRunId?: string;
  httpAttemptLimit?: number;
  liveConfirmed?: boolean;
  /** Server-derived adapter identities; never accepted from HTTP clients. */
  adapters?: RunReport["adapters"];
}
export interface ScenarioRunRecord {
  id: string;
  runId: string;
  scenarioId: string;
  position: number;
  result: ScenarioResult;
}
export interface PageOptions {
  offset?: number;
  limit?: number;
}
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
