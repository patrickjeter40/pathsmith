import { readFile } from "node:fs/promises";
import { createMockProvider } from "@pathsmith/provider-mock";
export const load = async (name) =>
  JSON.parse(
    await readFile(
      new URL(`../examples/support-routing/${name}`, import.meta.url),
      "utf8",
    ),
  );
export const baseline = await load("baseline.workflow.json");
export const candidate = await load("candidate.workflow.json");
export const suite = await load("suite.json");
export const fixtures = await load("mock-fixtures.json");
export const expected = await load("expected-results.json");
export const bindings = () => ({
  decisions: {
    providerId: "mock",
    model: "mock-v1",
    adapter: createMockProvider(fixtures),
  },
});
export const literal = (value) => ({ op: "literal", value });
export const ref = (...path) => ({ op: "ref", path });
export const minimal = () => ({
  formatVersion: "0.1",
  id: "test_workflow",
  name: "Test",
  description: "Deterministic test workflow",
  bindings: [],
  inputSchema: {
    type: "object",
    properties: { value: { type: "number" } },
    required: ["value"],
    additionalProperties: false,
  },
  outputSchema: { type: "number" },
  nodes: [
    { id: "start", label: "Start", kind: "start" },
    {
      id: "finish",
      label: "Finish",
      kind: "output",
      outcomeId: "done",
      value: ref("input", "value"),
    },
  ],
  edges: [
    { id: "start_next", source: "start", port: "next", target: "finish" },
  ],
});
