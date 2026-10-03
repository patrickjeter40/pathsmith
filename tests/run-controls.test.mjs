import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay, setImmediate as tick } from "node:timers/promises";
import { runSuite, compareRuns, classificationRow } from "@pathsmith/evaluation";
import { PathsmithError, PathsmithDeadlineError, longestJudgmentPath, executeWorkflow, hash } from "@pathsmith/core";
import { loadExample } from "../apps/api/dist/examples.js";
import { createJevProvider } from "../packages/provider-jev/dist/index.js";
import { minimal } from "./helpers.mjs";
import { readRunReport } from "../packages/cli/dist/report.js";
const example = loadExample("classification");
const response = { model: "offline-model", usage: null, answers: { label: {
  kind: "choice", value: "abusive", confidence: 0.9, probabilities: { abusive: 0.9, not_abusive: 0.1 },
} } };
function testSuite(n) {
  return { ...structuredClone(example.suite), scenarios: Array.from({ length: n }, (_, i) => ({
    id: `case_${i}`, name: `Case ${i}`, tags: [], input: { content: String(i) },
    referenceLabel: { value: "abusive", source: "human", review: "reviewed" },
  })) };
}
function adapter(handler) {
  return { id: "jev", version: "offline-v1", normalizerVersion: "offline-v1", origin: "live",
    evaluate: async (request, ctx) => handler(Number(request.state.content), ctx) };
}
function attempt(ctx, n, fail = false) {
  ctx.onAttemptStarted(n);
  finishAttempt(ctx, n, fail);
}
function finishAttempt(ctx, n, fail = false) {
  ctx.onAttemptFinished({ attempt: n, status: fail ? "failed" : "succeeded", httpStatus: fail ? 503 : 200,
    errorCode: fail ? "PROVIDER_UNAVAILABLE" : null, elapsedMs: 1, usage: null,
    requestedModel: "offline-model", resolvedModel: fail ? null : "offline-model" });
}
const run = (handler, options = {}) => runSuite({ workflow: example.workflow, suite: testSuite(8),
  bindings: { decisions: { providerId: "jev", model: "offline-model", adapter: adapter(handler) } },
  mode: "live", ...options });

test("parallel call admission is exact and preserves completed cases and actual attempts", async () => {
  let calls = 0;
  const report = await run(async (_i, ctx) => { calls++; await tick(); attempt(ctx, 1); return response; }, {
    concurrency: 4, controls: { maxProviderCalls: 3, stopAfterConsecutiveErrors: 5 },
  });
  assert.equal(calls, 3); assert.equal(report.summary.providerCalls, 3);
  assert.equal(report.summary.actualHttpAttempts, 3); assert.equal(report.summary.completed, 3);
  assert.equal(report.stopReason.code, "PROVIDER_CALL_CAP"); assert.equal(report.status, "failed");
  assert.equal(report.scenarios.filter((s) => !s.started).length, 4);
  assert.equal(report.summary.notRun, 4);
  const pending = report.scenarios.find((s) => !s.started);
  assert.equal(classificationRow(report.suite, report.suite.scenarios.find((s) => s.id === pending.scenarioId), pending, report.status).reviewedVerdict, "not_run");
  assert.equal(readRunReport(report).id, report.id);
  const altered = structuredClone(report); altered.summary.providerCalls = 4;
  assert.throws(() => readRunReport(altered), { code: "ARTIFACT_INVALID" });
});

test("success resets consecutive terminal errors, individual retry failures do not count", async () => {
  const report = await run(async (i, ctx) => {
    if (i === 1) { attempt(ctx, 1, true); attempt(ctx, 2); return response; }
    attempt(ctx, 1, true); throw new PathsmithError("PROVIDER_UNAVAILABLE", "Offline failure");
  }, { concurrency: 1, controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 2 } });
  assert.equal(report.summary.providerCalls, 4); assert.equal(report.summary.actualHttpAttempts, 5);
  assert.equal(report.summary.completed, 1); assert.equal(report.stopReason.code, "CONSECUTIVE_PROVIDER_ERRORS");
  assert.equal(report.stopReason.consecutiveProviderErrors, 2);
  assert.equal(report.scenarios[4].started, false);
});

test("error stop remains latched after an in-flight success completes", async () => {
  const report = await run(async (i, ctx) => {
    if (i === 1) { ctx.onAttemptStarted(1); await delay(20); finishAttempt(ctx, 1); return response; }
    attempt(ctx, 1, true); throw new PathsmithError("PROVIDER_UNAVAILABLE", "Offline failure");
  }, { concurrency: 2, controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 } });
  assert.equal(report.summary.providerCalls, 2); assert.equal(report.summary.completed, 1);
  assert.equal(report.stopReason.code, "CONSECUTIVE_PROVIDER_ERRORS");
  assert.equal(report.stopReason.consecutiveProviderErrors, 1);
});

test("a terminal error after cap denial still stops another admitted call's retry", async () => {
  let retries = 0;
  const report = await run(async (i, ctx) => {
    if (i === 0) { await tick(); attempt(ctx, 1, true); throw new PathsmithError("PROVIDER_UNAVAILABLE", "Offline failure"); }
    attempt(ctx, 1, true); await delay(20); ctx.onAttemptStarted(2); retries++;
    throw Error("Retry must never be admitted");
  }, { concurrency: 3, controls: { maxProviderCalls: 2, stopAfterConsecutiveErrors: 1 } });
  assert.equal(report.summary.providerCalls, 2); assert.equal(report.summary.actualHttpAttempts, 2);
  assert.equal(retries, 0); assert.equal(report.stopReason.code, "CONSECUTIVE_PROVIDER_ERRORS");
});

test("a pure call cap permits bounded retries for admitted calls", async () => {
  const report = await run(async (i, ctx) => {
    attempt(ctx, 1, i === 1); await delay(5);
    if (i === 1) attempt(ctx, 2);
    return response;
  }, { concurrency: 3, controls: { maxProviderCalls: 2, stopAfterConsecutiveErrors: 1 } });
  assert.equal(report.summary.providerCalls, 2); assert.equal(report.summary.actualHttpAttempts, 3);
  assert.equal(report.summary.completed, 2); assert.equal(report.stopReason.code, "PROVIDER_CALL_CAP");
});

test("invalid responses count as terminal provider errors; local expression errors do not", async () => {
  const invalid = await run(async (_i, ctx) => { attempt(ctx, 1); return { ...response, answers: {} }; }, {
    concurrency: 1, controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 },
  });
  assert.equal(invalid.summary.providerCalls, 1); assert.equal(invalid.stopReason.code, "CONSECUTIVE_PROVIDER_ERRORS");
  const workflow = structuredClone(example.workflow);
  workflow.nodes.find((n) => n.kind === "judgment").state = { op: "literal", value: 1 };
  const local = await run(() => { throw Error("Must not call"); }, { workflow, concurrency: 1,
    controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 } });
  assert.equal(local.summary.providerCalls, 0); assert.equal(local.stopReason, undefined);
  assert.equal(local.summary.failedExecution, 8);
});

test("cancel during a provider call does not count as a consecutive provider error", async () => {
  const controller = new AbortController();
  const report = await run(async (_i, ctx) => { ctx.onAttemptStarted(1); controller.abort(); await tick(); throw Error("Canceled"); }, {
    concurrency: 1, signal: controller.signal, controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 },
  });
  assert.equal(report.stopReason, undefined); assert.equal(report.status, "canceled");
  assert.equal(report.summary.providerCalls, 1);
});

test("zero-judgment live runs admit no calls; exact cap completion is not a stop", async () => {
  const workflow = minimal(), suite = { formatVersion: "0.1", id: "zero", name: "Zero", description: "No judgments", scenarios: [{ id: "one", name: "One", tags: [], input: { value: 1 } }] };
  const zero = await runSuite({ workflow, suite, mode: "live", bindings: {}, controls: { maxProviderCalls: 0, stopAfterConsecutiveErrors: 1 } });
  assert.equal(longestJudgmentPath(workflow), 0); assert.equal(zero.status, "completed");
  assert.equal(zero.summary.providerCalls, 0); assert.equal(zero.stopReason, undefined);
  const exact = await run(async (_i, ctx) => { attempt(ctx, 1); return response; }, {
    selectedScenarioIds: ["case_0"], controls: { maxProviderCalls: 1, stopAfterConsecutiveErrors: 1 },
  });
  assert.equal(exact.status, "completed"); assert.equal(exact.stopReason, undefined);
  await assert.rejects(run(() => response, { controls: { maxProviderCalls: 0, stopAfterConsecutiveErrors: 1 } }), { code: "RUN_LIMIT_EXCEEDED" });
  const portable = await executeWorkflow({ workflow, input: { value: 2 }, bindings: {}, mode: "live" });
  assert.equal(portable.status, "completed"); assert.equal(portable.providerCalls, 0);
});

test("reviewed classification gate checks exact pairing, label state, mode and required predictions", async () => {
  const baseline = await run(async (_i, ctx) => { attempt(ctx, 1); return response; }, { suite: testSuite(2) });
  const same = compareRuns(baseline, baseline, { basis: "reviewed_classification" });
  assert.equal(same.gate, "pass"); assert.equal(same.cohort.reviewedPairs, 2);
  const candidate = structuredClone(baseline); candidate.id = "candidate";
  candidate.scenarios[0].outputs.classify.label.value = "not_abusive";
  const regression = compareRuns(baseline, candidate, { basis: "reviewed_classification" });
  assert.equal(regression.gate, "fail"); assert.equal(regression.newClassificationRegressions, 1);
  assert.equal(regression.newAssertionRegressions, 0);
  delete candidate.scenarios[0].outputs.classify;
  assert.equal(compareRuns(baseline, candidate, { basis: "reviewed_classification" }).gate, "inconclusive");
  const duplicate = structuredClone(baseline); duplicate.selectedScenarioIds = ["case_0", "case_0"];
  assert.equal(compareRuns(duplicate, duplicate).gate, "inconclusive");
  const provisional = structuredClone(baseline);
  for (const s of provisional.suite.scenarios) s.referenceLabel.review = "provisional";
  provisional.suiteSnapshotHash = hash(provisional.suite);
  assert.equal(compareRuns(provisional, provisional, { basis: "reviewed_classification" }).gate, "inconclusive");
  assert.equal(compareRuns(baseline, { ...baseline, mode: "mock" }).gate, "inconclusive");
});

test("incompatible reviewed labels or targets cannot fabricate classification regressions", async () => {
  const baseline = await run(async (_i, ctx) => { attempt(ctx, 1); return response; }, { suite: testSuite(1) });
  for (const mutate of [
    (suite) => { suite.scenarios[0].referenceLabel.review = "provisional"; },
    (suite) => { suite.scenarios[0].referenceLabel.value = "not_abusive"; },
    (suite) => { suite.scenarios[0].referenceLabel.value = null; },
    (suite) => { suite.scenarios[0].referenceLabel.value = "invalid"; },
    (suite) => { suite.classification.questionId = "other"; },
    (suite) => { [suite.classification.positiveLabel, suite.classification.negativeLabel] = [suite.classification.negativeLabel, suite.classification.positiveLabel]; },
  ]) {
    const candidate = structuredClone(baseline); mutate(candidate.suite);
    candidate.suiteSnapshotHash = hash(candidate.suite);
    const comparison = compareRuns(baseline, candidate, { basis: "reviewed_classification" });
    assert.equal(comparison.gate, "inconclusive");
    assert.equal(comparison.cases[0].classificationInGate, false);
    assert.equal(comparison.newClassificationRegressions, 0);
    assert.equal(comparison.classificationImprovements, 0);
    assert.equal(comparison.issueDetails.some((issue) => issue.code === "MISSING_CLASSIFICATION_PREDICTION"), false);
    assert.deepEqual(candidate.scenarios[0].outputs, baseline.scenarios[0].outputs);
  }
});

test("provider deadline is one terminal error and HTTP budget denial is excluded", async () => {
  const deadline = await run(async (_i, ctx) => { ctx.onAttemptStarted(1); await delay(100); return response; }, {
    concurrency: 1, limits: { scenarioDeadlineMs: 30 }, controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 },
  });
  assert.equal(deadline.stopReason.code, "CONSECUTIVE_PROVIDER_ERRORS"); assert.equal(deadline.summary.providerCalls, 1);
  const exhausted = await run(async (_i, ctx) => { attempt(ctx, 1); return response; }, {
    concurrency: 1, httpAttemptLimit: 1, controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 },
  });
  assert.equal(exhausted.stopReason, undefined); assert.equal(exhausted.summary.actualHttpAttempts, 1);
});

test("legacy artifacts without added call/control fields remain readable without fabricated calls", async () => {
  const { runSuite } = await import("@pathsmith/evaluation");
  const { createMockProvider } = await import("@pathsmith/provider-mock");
  const report = await runSuite({ workflow: example.workflow, suite: example.suite, mode: "mock",
    bindings: { decisions: { ...example.profile.bindings.decisions, adapter: createMockProvider(example.fixtures) } } });
  const old = structuredClone(report);
  for (const s of old.scenarios) delete s.providerCalls;
  delete old.summary.providerCalls; delete old.summary.notRun;
  const bytes = JSON.stringify(old);
  assert.equal(readRunReport(old).id, old.id); assert.equal(JSON.stringify(old), bytes);
});


test("typed terminal provider deadlines count once without relying on diagnostic wording", async () => {
  for (const message of ["Scenario deadline exceeded before HTTP dispatch", "Retry delay exceeds remaining scenario deadline", "Opaque deadline diagnostic"]) {
    const result = await run(async () => { throw new PathsmithDeadlineError(message); }, {
      concurrency: 1, controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 },
    });
    assert.equal(result.stopReason.code, "CONSECUTIVE_PROVIDER_ERRORS");
    assert.equal(result.summary.providerCalls, 1); assert.equal(result.summary.actualHttpAttempts, 0);
    assert.equal(result.stopReason.consecutiveProviderErrors, 1);
    assert.equal(result.scenarios[0].error.code, "RUN_LIMIT_EXCEEDED");
    assert.equal(result.scenarios[0].error.message, message);
  }
  const localLimit = await run(async () => { throw new PathsmithError("RUN_LIMIT_EXCEEDED", "Local byte budget exceeded"); }, {
    concurrency: 1, controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 },
  });
  assert.equal(localLimit.stopReason, undefined);
});

test("injected Jev retry delay exhaustion is a terminal logical error, not an extra attempt", async () => {
  let calls = 0;
  const jev = createJevProvider({ apiKey: "offline-only", fetch: async () => {
    calls++;
    return new Response("{}", { status: 503, headers: { "Retry-After": "2" } });
  } });
  const result = await run(() => response, { concurrency: 1, limits: { scenarioDeadlineMs: 1000 },
    controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 },
    bindings: { decisions: { providerId: "jev", model: "offline-model", adapter: jev } },
  });
  assert.equal(calls, 1); assert.equal(result.summary.actualHttpAttempts, 1);
  assert.equal(result.summary.providerCalls, 1); assert.equal(result.stopReason.code, "CONSECUTIVE_PROVIDER_ERRORS");
  assert.equal(result.scenarios[0].error.message, "Retry delay exceeds remaining scenario deadline");
});

test("Jev expiry before HTTP dispatch counts one terminal call and sends no request", async () => {
  let calls = 0;
  const jev = createJevProvider({ apiKey: "offline-only", fetch: async () => { calls++; throw Error("No transport admission"); } });
  const expired = { ...jev, evaluate: (request, context) => jev.evaluate(request, { ...context, deadlineAt: Date.now() - 1 }) };
  const result = await run(() => response, { concurrency: 1,
    controls: { maxProviderCalls: 8, stopAfterConsecutiveErrors: 1 },
    bindings: { decisions: { providerId: "jev", model: "offline-model", adapter: expired } },
  });
  assert.equal(calls, 0); assert.equal(result.summary.actualHttpAttempts, 0);
  assert.equal(result.summary.providerCalls, 1); assert.equal(result.stopReason.code, "CONSECUTIVE_PROVIDER_ERRORS");
});
