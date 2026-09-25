import type { Diagnostic, Json } from "@pathsmith/contracts";
export interface ExecutionError {
  code: string;
  message: string;
  nodeId?: string;
  scenarioId?: string;
  retryable: boolean;
  details?: Diagnostic[];
}
export class PathsmithError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Diagnostic[],
  ) {
    super(message);
    this.name = "PathsmithError";
  }
}
export function toExecutionError(
  error: unknown,
  nodeId?: string,
  scenarioId?: string,
): ExecutionError {
  return {
    code: error instanceof PathsmithError ? error.code : "EXECUTION_FAILED",
    message:
      error instanceof PathsmithError
        ? error.message
        : "Execution failed; provider or observer returned an unexpected error",
    ...(nodeId ? { nodeId } : {}),
    ...(scenarioId ? { scenarioId } : {}),
    retryable: false,
    ...(error instanceof PathsmithError && error.details
      ? { details: error.details }
      : {}),
  };
}
export function assertValid(
  validation: { valid: boolean; diagnostics: Diagnostic[] },
  code = "WORKFLOW_INVALID",
): void {
  if (!validation.valid)
    throw new PathsmithError(
      code,
      "Preflight validation failed",
      validation.diagnostics,
    );
}
export function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  const frozen = new WeakSet<object>();
  function freeze(item: unknown): void {
    if (item && typeof item === "object" && !frozen.has(item)) {
      frozen.add(item);
      Object.freeze(item);
      Object.values(item).forEach(freeze);
    }
  }
  freeze(copy);
  return copy;
}
export type JsonObject = Record<string, Json>;
