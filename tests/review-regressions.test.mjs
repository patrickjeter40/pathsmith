import test from "node:test";
import assert from "node:assert/strict";
import { byteLength, inspectJson } from "@pathsmith/contracts";
import { executeWorkflow, immutable } from "@pathsmith/core";
import { runSuite, compareRuns } from "@pathsmith/evaluation";
import {
  baseline,
  suite,
  bindings,
  minimal,
  literal,
  ref,
} from "./helpers.mjs";

test("bounded JSON measurement counts UTF-8/escapes and shared values without expansion", () => {
  for (const value of [
    null,
    1,
    -0,
    true,
    false,
    'quote"\n\t\\😃\ud800\udc00é中',
    { é: ["\u0001", null, 22] },
    [[], {}],
  ])
    assert.equal(byteLength(value), Buffer.byteLength(JSON.stringify(value)));
  let value = "x".repeat(1024);
  for (let i = 0; i < 26; i++) value = [value, value];
  assert.equal(byteLength(value, 512 * 1024), Infinity);
  assert(inspectJson(value, 512 * 1024).length);
  const frozen = immutable(value);
  assert.equal(frozen[0], frozen[1]);
  assert(Object.isFrozen(frozen[0]));
});
test("expanded transforms fail within the computed-value budget before clone/trace", async () => {
  const workflow = minimal();
  workflow.nodes.splice(
    1,
    0,
    ...Array.from({ length: 17 }, (_, i) => ({
      id: `expand_${i}`,
      kind: "transform",
      label: "Expand",
      value:
        i === 0
          ? literal("x".repeat(1024))
          : {
              op: "array",
              items: [
                ref("outputs", `expand_${i - 1}`),
                ref("outputs", `expand_${i - 1}`),
              ],
            },
    })),
  );
  workflow.edges = workflow.nodes
    .slice(0, -1)
    .map((n, i) => ({
      id: `edge_${i}`,
      source: n.id,
      port: "next",
      target: workflow.nodes[i + 1].id,
    }));
  const result = await executeWorkflow({
    workflow,
    input: { value: 1 },
    bindings: {},
    mode: "mock",
    trace: true,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "RUN_LIMIT_EXCEEDED");
  assert(result.visitedNodes.length < workflow.nodes.length);
  assert(byteLength(result) < 8 * 1024 * 1024);
  assert(result.events.some((e) => e.kind === "run_failed"));
});
test("missing or falsified assertion evaluations make comparison inconclusive", async () => {
  const report = await runSuite({
    workflow: baseline,
    suite,
    bindings: bindings(),
    mode: "mock",
  });
  for (const mutate of [
    (s) => {
      s.assertions = [];
      s.assertionStatus = "not_evaluated";
    },
    (s) => {
      s.assertions = [];
      s.assertionStatus = "passed";
    },
    (s) => (s.assertions[0].passed = !s.assertions[0].passed),
  ]) {
    const candidate = structuredClone(report);
    mutate(candidate.scenarios[0]);
    const comparison = compareRuns(report, candidate);
    assert.equal(comparison.gate, "inconclusive");
    assert(comparison.issues.some((s) => s.includes("Assertion evaluation")));
  }
});
