import test from "node:test";
import assert from "node:assert/strict";
import { executeWorkflow, requestFingerprint } from "@pathsmith/core";
import { runSuite, compareRuns } from "@pathsmith/evaluation";
// Public built export (the root test package need not add a workspace dependency).
import { createReplayBindings } from "../packages/provider-replay/dist/index.js";
import { baseline, candidate, suite, bindings, literal } from "./helpers.mjs";
let networkCalls = 0;
globalThis.fetch = () => {
  networkCalls++;
  throw new Error("Network forbidden");
};
const source = await runSuite({
  workflow: baseline,
  suite,
  bindings: bindings(),
  mode: "mock",
});
const replay = (workflow = candidate, extra = {}) =>
  runSuite({
    workflow,
    suite,
    bindings: createReplayBindings(source),
    mode: "replay",
    ...extra,
  });

test("AC-09/24: source-generated candidate replay preserves provenance, zero new usage, and 2 regressions/1 improvement", async () => {
  const result = await replay();
  assert.equal(source.summary.logicalJudgments, 16);
  assert.equal(result.status, "completed");
  assert.equal(result.mode, "replay");
  assert.equal(result.sourceRunId, source.id);
  assert.equal(result.origin, "synthetic");
  assert.deepEqual(result.profile, source.profile);
  assert.deepEqual(result.adapters, source.adapters);
  assert.equal(result.summary.logicalJudgments, 14);
  assert.equal(result.summary.replayedJudgments, 14);
  assert.equal(result.summary.actualHttpAttempts, 0);
  assert.deepEqual(result.summary.usage, { inputTokens: 0, outputTokens: 0 });
  assert.equal(result.summary.historicalUsage, null);
  const comparison = compareRuns(source, result);
  assert.equal(comparison.gate, "fail");
  assert.equal(comparison.newAssertionRegressions, 2);
  assert.equal(comparison.assertionImprovements, 1);
  assert.equal(comparison.modelChanged, false);
  for (const scenario of result.scenarios)
    for (const exchange of scenario.exchanges) {
      assert.equal(exchange.sourceRunId, source.id);
      assert.equal(exchange.providerId, "mock");
      assert.equal(exchange.actualHttpAttempts, 0);
    }
  assert.equal(networkCalls, 0);
});

test("AC-10: changed question, state, model, or adapter versions yield REPLAY_MISS", async () => {
  for (const change of [
    "question",
    "state",
    "model",
    "adapter",
    "normalizer",
    "source",
  ]) {
    const workflow = structuredClone(candidate);
    const rb = createReplayBindings(source);
    const judgment = workflow.nodes.find((n) => n.kind === "judgment");
    if (change === "question")
      Object.values(judgment.questions)[0].instructions += " ";
    if (change === "state") judgment.state = literal("Changed state");
    if (change === "model") rb.decisions.model = "other-model";
    if (change === "adapter") rb.decisions.adapter.version = "other-version";
    if (change === "source")
      rb.decisions.adapter.replay.sourceRunId = "wrong-source";
    if (change === "normalizer")
      rb.decisions.adapter.normalizerVersion = "other-version";
    const result = await replay(workflow, { bindings: rb });
    assert.equal(result.status, "failed", change);
    assert.equal(result.scenarios[0].error.code, "REPLAY_MISS", change);
    assert.equal(result.scenarios[0].error.nodeId, judgment.id);
    assert.equal(result.summary.actualHttpAttempts, 0);
    assert.equal(compareRuns(source, result).gate, "inconclusive");
  }
  assert.equal(networkCalls, 0);
});

test("AC-10: newly reached judgment and foreign scenario cannot reuse another answer", async () => {
  const workflow = structuredClone(baseline);
  const added = structuredClone(
    workflow.nodes.find((n) => n.kind === "judgment"),
  );
  added.id = "new_judgment";
  const first = workflow.edges.find(
    (e) => e.source === workflow.nodes.find((n) => n.kind === "start").id,
  );
  workflow.edges.push({
    id: "new_next",
    source: added.id,
    port: "next",
    target: first.target,
  });
  first.target = added.id;
  workflow.nodes.push(added);
  const result = await replay(workflow);
  assert.ok(
    result.scenarios.some(
      (s) =>
        s.error?.code === "REPLAY_MISS" &&
        s.error.message.includes("no recorded judgment"),
    ),
  );
  const changedSuite = structuredClone(suite);
  changedSuite.scenarios[0].id = "foreign_scenario";
  const scoped = await replay(candidate, { suite: changedSuite });
  assert.equal(scoped.scenarios[0].error.code, "REPLAY_MISS");
  assert.equal(networkCalls, 0);
});

test("Replay snapshots source records and validates provenance, duplicate scopes, fingerprints and answers", async () => {
  const copy = structuredClone(source);
  const rb = createReplayBindings(copy);
  copy.scenarios[0].exchanges.length = 0;
  const result = await replay(candidate, { bindings: rb });
  assert.equal(result.status, "completed");
  for (const change of [
    "scope",
    "fingerprint",
    "answer",
    "duplicate",
    "identity",
  ]) {
    const invalid = structuredClone(source),
      exchange = invalid.scenarios[0].exchanges[0];
    if (change === "scope") exchange.runId = "another-source";
    if (change === "fingerprint") exchange.request.state = "tampered";
    if (change === "answer") exchange.response.answers = {};
    if (change === "duplicate") invalid.scenarios[0].exchanges.push(exchange);
    if (change === "identity")
      invalid.adapters.decisions.adapterVersion = "other";
    assert.throws(
      () => createReplayBindings(invalid),
      { code: "REPLAY_SOURCE_INVALID" },
      change,
    );
  }
});

test("AC-24: historical source usage stays distinct from replay's zero new usage, including chained replay", async () => {
  const liveSource = structuredClone(source);
  liveSource.origin = "live";
  liveSource.mode = "live";
  liveSource.profile.bindings.decisions.providerId = "jev";
  liveSource.adapters.decisions.providerId = "jev";
  for (const scenario of liveSource.scenarios)
    for (const e of scenario.exchanges) {
      e.providerId = "jev";
      e.origin = "live";
      e.response.usage = { inputTokens: 10, outputTokens: 2 };
      e.usage = { inputTokens: 10, outputTokens: 2 };
      e.fingerprint = requestFingerprint(
        {
          providerId: e.providerId,
          adapterVersion: e.adapterVersion,
          normalizerVersion: e.normalizerVersion,
        },
        e.request,
      );
    }
  const result = await replay(candidate, {
    bindings: createReplayBindings(liveSource),
  });
  assert.equal(result.origin, "live");
  assert.deepEqual(result.summary.usage, { inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(result.summary.historicalUsage, {
    inputTokens: 140,
    outputTokens: 28,
  });
  const chained = await replay(candidate, {
    bindings: createReplayBindings(result),
  });
  assert.equal(chained.sourceRunId, result.id);
  assert.deepEqual(
    chained.summary.historicalUsage,
    result.summary.historicalUsage,
  );
});

test("Replay cancellation and explicit mode guards never dispatch a transport", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await replay(candidate, { signal: controller.signal });
  assert.equal(result.status, "canceled");
  assert.equal(result.summary.replayedJudgments, 0);
  assert.deepEqual(result.summary.usage, { inputTokens: 0, outputTokens: 0 });
  await assert.rejects(() => replay(candidate, { bindings: bindings() }), {
    code: "PROVIDER_NOT_CONFIGURED",
  });
  await assert.rejects(
    () =>
      runSuite({
        workflow: candidate,
        suite,
        bindings: createReplayBindings(source),
        mode: "mock",
      }),
    { code: "PROVIDER_NOT_CONFIGURED" },
  );
  const other = await runSuite({
    workflow: baseline,
    suite,
    bindings: bindings(),
    mode: "mock",
  });
  const rb = createReplayBindings(source);
  rb.foreign = createReplayBindings(other).decisions;
  await assert.rejects(() => replay(candidate, { bindings: rb }), {
    code: "PROVIDER_NOT_CONFIGURED",
  });
  const canceled = await executeWorkflow({
    workflow: candidate,
    input: suite.scenarios[0].input,
    bindings: createReplayBindings(source),
    mode: "replay",
    scenarioId: suite.scenarios[0].id,
    signal: controller.signal,
  });
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.logicalJudgments, 0);
  assert.equal(networkCalls, 0);
});
