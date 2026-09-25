import type { PathsmithWorkflow01 } from "./generated/workflow.js";
import type { PathsmithScenarioSuite01 } from "./generated/suite.js";
import type { PathsmithExactRequestMockFixtures01 } from "./generated/mock-fixtures.js";

export type Workflow = PathsmithWorkflow01;
export type WorkflowNode = Workflow["nodes"][number];
export type JudgmentNode = Extract<WorkflowNode, { kind: "judgment" }>;
export type BranchNode = Extract<WorkflowNode, { kind: "branch" }>;
export type Expr = JudgmentNode["state"];
export type DataSchema = Workflow["inputSchema"];
export type Question = JudgmentNode["questions"][string];
export type Suite = PathsmithScenarioSuite01;
export type Scenario = Suite["scenarios"][number];
export type Fixtures = PathsmithExactRequestMockFixtures01;
export type Answer = Fixtures["entries"][number]["response"]["answers"][string];
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Diagnostic {
  code: string;
  message: string;
  pointer: string;
  severity: "error" | "warning";
  nodeId?: string;
  scenarioId?: string;
}
export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}
export interface ExecutionProfile {
  formatVersion: "0.1";
  bindings: Record<string, { providerId: string; model: string }>;
}
