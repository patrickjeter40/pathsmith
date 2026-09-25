import {
  validateAnswers,
  validateFixtures,
  type Fixtures,
} from "@pathsmith/contracts";
import {
  assertValid,
  canonicalize,
  immutable,
  PathsmithError,
  type JudgmentProvider,
} from "@pathsmith/core";

export function createMockProvider(value: unknown): JudgmentProvider {
  assertValid(validateFixtures(value), "MOCK_FIXTURES_INVALID");
  const fixtures = immutable(value as Fixtures),
    entries = new Map<string, Fixtures["entries"][number]>();
  for (const entry of fixtures.entries) {
    const key = JSON.stringify([entry.scenarioId, entry.nodeId, entry.binding]);
    if (entries.has(key))
      throw new PathsmithError(
        "MOCK_FIXTURES_INVALID",
        "Duplicate fixture scope",
      );
    assertValid(
      validateAnswers(entry.request.questions, entry.response.answers),
      "PROVIDER_INVALID_RESPONSE",
    );
    const state = entry.request.state;
    if (
      state === null ||
      typeof state === "number" ||
      typeof state === "boolean"
    )
      throw new PathsmithError(
        "MOCK_FIXTURES_INVALID",
        "Mock state must be string, array, or object",
      );
    entries.set(key, entry);
  }
  return {
    id: "mock",
    version: "0.1.0",
    normalizerVersion: "0.1.0",
    origin: "synthetic",
    async evaluate(request, context) {
      if (context.signal.aborted)
        throw new PathsmithError("RUN_CANCELED", "Run was canceled");
      const entry = entries.get(
        JSON.stringify([context.scenarioId, context.nodeId, context.binding]),
      );
      if (
        !entry ||
        canonicalize(entry.request) !==
          canonicalize({ providerId: "mock", ...request })
      )
        throw new PathsmithError(
          "MOCK_REQUEST_MISMATCH",
          `No exact fixture for scenario ${context.scenarioId ?? "(none)"}, node ${context.nodeId}, binding ${context.binding}`,
        );
      return structuredClone(entry.response);
    },
  };
}
