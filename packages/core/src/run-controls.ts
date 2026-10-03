import type { Workflow } from "@pathsmith/contracts";
import { assertValid, immutable, PathsmithError } from "./error.js";
import { validateWorkflow } from "@pathsmith/contracts";

export interface RunControls {
  maxProviderCalls: number;
  stopAfterConsecutiveErrors: number;
}
export interface RunStopReason {
  code: "PROVIDER_CALL_CAP" | "CONSECUTIVE_PROVIDER_ERRORS";
  providerCalls: number;
  consecutiveProviderErrors: number;
}
/** Longest possible active path; branches select one edge, never all edges. */
export function longestJudgmentPath(workflow: Workflow): number {
  assertValid(validateWorkflow(workflow));
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const memo = new Map<string, number>();
  const count = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const value = (nodes.get(id)!.kind === "judgment" ? 1 : 0) +
      Math.max(0, ...(outgoing.get(id) ?? []).map(count));
    memo.set(id, value);
    return value;
  };
  return count(workflow.nodes.find((node) => node.kind === "start")!.id);
}
export function resolveRunControls(input: RunControls | undefined, maxCalls: number): RunControls {
  const controls = input ?? { maxProviderCalls: maxCalls, stopAfterConsecutiveErrors: 5 };
  if (!controls || typeof controls !== "object" || Array.isArray(controls) ||
    Object.keys(controls).some((key) => !["maxProviderCalls", "stopAfterConsecutiveErrors"].includes(key)) ||
    !Number.isSafeInteger(maxCalls) || maxCalls < 0 ||
    !Number.isSafeInteger(controls.maxProviderCalls) ||
    controls.maxProviderCalls < (maxCalls === 0 ? 0 : 1) || controls.maxProviderCalls > maxCalls ||
    !Number.isSafeInteger(controls.stopAfterConsecutiveErrors) ||
    controls.stopAfterConsecutiveErrors < 1 || controls.stopAfterConsecutiveErrors > 20)
    throw new PathsmithError("RUN_LIMIT_EXCEEDED", "Provider call cap must fit the selected path bound; consecutive error stop must be 1–20");
  return immutable(controls);
}
export function runStopError(reason: RunStopReason): PathsmithError {
  return new PathsmithError(reason.code, reason.code === "PROVIDER_CALL_CAP"
    ? "Run stopped at the provider call cap" : "Run stopped after consecutive terminal provider errors");
}
/** One shared admission controller for every worker. All reservations are synchronous. */
export class ProviderCallControl {
  readonly controls: RunControls;
  providerCalls = 0;
  consecutiveProviderErrors = 0;
  completionSequence = 0;
  private reason: RunStopReason | null = null;
  constructor(controls: RunControls) {
    this.controls = resolveRunControls(controls, controls.maxProviderCalls);
  }
  get stopReason(): RunStopReason | null { return this.reason; }
  private stop(code: RunStopReason["code"]): void {
    if (!this.reason || code === "CONSECUTIVE_PROVIDER_ERRORS")
      this.reason = immutable({ code, providerCalls: this.providerCalls,
        consecutiveProviderErrors: this.consecutiveProviderErrors });
  }
  admit(): void {
    if (this.reason) throw runStopError(this.reason);
    if (this.providerCalls >= this.controls.maxProviderCalls) {
      this.stop("PROVIDER_CALL_CAP");
      throw runStopError(this.reason!);
    }
    this.providerCalls++;
  }
  beforeAttempt(): void {
    // A call-cap stop still permits the bounded retries of previously admitted calls.
    if (this.reason?.code === "CONSECUTIVE_PROVIDER_ERRORS") throw runStopError(this.reason);
  }
  settled(outcome: "success" | "error" | "excluded") {
    this.completionSequence++;
    if (this.reason?.code !== "CONSECUTIVE_PROVIDER_ERRORS") {
      if (outcome === "success") this.consecutiveProviderErrors = 0;
      else if (outcome === "error") {
        this.consecutiveProviderErrors++;
        if (this.consecutiveProviderErrors >= this.controls.stopAfterConsecutiveErrors)
          this.stop("CONSECUTIVE_PROVIDER_ERRORS");
      }
    }
    return { outcome, completionSequence: this.completionSequence,
      consecutiveProviderErrors: this.consecutiveProviderErrors };
  }
}
