import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateExpression,
  executeWorkflow,
  hash,
  workflowHashes,
} from "@pathsmith/core";
import { runSuite, compareRuns, coverage, ratio } from "@pathsmith/evaluation";
import { createMockProvider } from "@pathsmith/provider-mock";
import {
  baseline,
  candidate,
  suite,
  fixtures,
  expected,
  bindings,
  minimal,
  literal,
  ref,
} from "./helpers.mjs";
globalThis.fetch = () => {
  throw new Error("Network is forbidden in engine tests");
};
const run = (w) =>
  runSuite({ workflow: w, suite, bindings: bindings(), mode: "mock" });
test("AC-04: strict expressions, Missing distinct from null, short circuit, finite arithmetic", () => {
  const evalExpr = (e) =>
    evaluateExpression(e, { input: { present: null, list: [1, "1", null] } });
  assert.equal(
    evalExpr({ op: "gte", left: literal(0.7), right: literal(0.7) }),
    true,
  );
  assert.throws(
    () =>
      evalExpr({
        op: "gte",
        left: ref("input", "missing"),
        right: literal(0.7),
      }),
    { code: "EXPRESSION_MISSING_VALUE" },
  );
  assert.throws(
    () => evalExpr({ op: "gte", left: literal(true), right: literal(0) }),
    { code: "EXPRESSION_TYPE_ERROR" },
  );
  assert.equal(
    evalExpr({ op: "exists", value: ref("input", "present") }),
    true,
  );
  assert.equal(
    evalExpr({ op: "exists", value: ref("input", "absent") }),
    false,
  );
  assert.equal(
    evalExpr({
      op: "coalesce",
      args: [ref("input", "absent"), ref("input", "present"), literal(0)],
    }),
    0,
  );
  assert.equal(evalExpr({ op: "coalesce", args: [literal(null)] }), null);
  assert.equal(
    evalExpr({ op: "eq", left: literal(1), right: literal("1") }),
    false,
  );
  assert.equal(
    evalExpr({ op: "in", left: literal(1), right: ref("input", "list") }),
    true,
  );
  assert.throws(
    () => evalExpr({ op: "eq", left: literal({}), right: literal({}) }),
    { code: "EXPRESSION_TYPE_ERROR" },
  );
  assert.throws(
    () => evalExpr({ op: "in", left: literal(1), right: literal([{}]) }),
    { code: "EXPRESSION_TYPE_ERROR" },
  );
  assert.throws(
    () => evalExpr({ op: "div", left: literal(1), right: literal(0) }),
    { code: "EXPRESSION_TYPE_ERROR" },
  );
  assert.throws(
    () => evalExpr({ op: "mul", left: literal(1e308), right: literal(1e308) }),
    { code: "EXPRESSION_TYPE_ERROR" },
  );
  assert.equal(
    evalExpr({ op: "and", args: [literal(false), ref("input", "absent")] }),
    false,
  );
  assert.equal(
    evalExpr({ op: "or", args: [literal(true), ref("input", "absent")] }),
    true,
  );
  assert.throws(() => evalExpr({ op: "not", value: literal(0) }), {
    code: "EXPRESSION_TYPE_ERROR",
  });
  assert.throws(
    () =>
      evaluateExpression(
        { op: "add", left: literal(1), right: literal(2) },
        {},
        { budget: { remaining: 1 } },
      ),
    { code: "RUN_LIMIT_EXCEEDED" },
  );
  assert.equal(
    evalExpr({ op: "exists", value: ref("input", "list", "0") }),
    false,
  );
  assert.equal(evalExpr(ref("input", "list", 0)), 1);
});
test("AC-08: all supplied outcomes, ordered paths, assertions, counts and coverage match", async () => {
  const [a, b] = await Promise.all([run(baseline), run(candidate)]);
  for (const [report, wanted] of [
    [a, expected.baseline],
    [b, expected.candidate],
  ]) {
    assert.equal(report.status, "completed");
    for (const key of [
      "completed",
      "assertionPassed",
      "assertionFailed",
      "logicalJudgments",
    ])
      assert.equal(report.summary[key], wanted[key]);
    assert.equal(report.coverage.branchPortsVisited, 10);
    assert.equal(report.coverage.branchPortsTotal, 10);
    assert.equal(report.summary.actualHttpAttempts, 0);
    assert.equal(report.summary.usage, null);
    for (const scenario of report.scenarios) {
      const e = wanted.scenarios.find(
        (x) => x.scenarioId === scenario.scenarioId,
      );
      assert.equal(scenario.result.outcomeId, e.outcomeId);
      assert.deepEqual(scenario.result.value, e.value);
      assert.deepEqual(scenario.visitedNodes, e.visitedNodes);
      assert.deepEqual(scenario.selectedEdges, e.selectedEdges);
      assert.equal(scenario.assertionStatus, e.assertionStatus);
      assert.deepEqual(
        scenario.events.map((e) => e.sequence),
        scenario.events.map((_, i) => i + 1),
      );
      assert.equal(scenario.exchanges.length, e.logicalJudgments);
    }
  }
  const comparison = compareRuns(a, b);
  assert.equal(comparison.gate, "fail");
  assert.equal(comparison.changedCases, 3);
  assert.equal(comparison.newAssertionRegressions, 2);
  assert.equal(comparison.assertionImprovements, 1);
  assert.equal(comparison.modelChanged, false);
  assert.equal(comparison.workflowDiff.nodes.changed.length, 1);
  assert(
    comparison.cases
      .filter((c) => c.behaviorChanged)
      .every((c) => c.firstDivergence),
  );
  assert.equal(compareRuns(a, a).gate, "pass");
  assert.equal(compareRuns(a, a, { strict: true }).gate, "fail");
});
test("AC-05: first true case wins and later cases are not evaluated", async () => {
  const w = structuredClone(baseline),
    branch = w.nodes.find((n) => n.id === "confidence_gate");
  branch.cases = [
    { id: "first", when: literal(true) },
    { id: "second", when: literal(true) },
    {
      id: "bad",
      when: {
        op: "gte",
        left: { op: "div", left: literal(1), right: literal(0) },
        right: literal(0),
      },
    },
  ];
  w.edges = w.edges.filter((e) => e.id !== "e_confidence_gate_auto");
  for (const port of ["first", "second", "bad"])
    w.edges.push({
      id: `case_${port}`,
      source: "confidence_gate",
      port,
      target: "department_router",
    });
  const r = await executeWorkflow({
    workflow: w,
    input: suite.scenarios[0].input,
    scenarioId: suite.scenarios[0].id,
    bindings: bindings(),
    mode: "mock",
    trace: true,
  });
  assert.equal(r.status, "completed");
  const event = r.events.find((e) => e.kind === "branch_selected");
  assert.deepEqual(
    event.data.cases.map((c) => c.result),
    ["true", "not_evaluated", "not_evaluated"],
  );
  assert.equal(event.data.port, "first");
});
test("AC-07: changed request fails exact mock matching, scope is not global", async () => {
  for (const change of ["question", "input", "scenario", "model"]) {
    const w = structuredClone(baseline),
      input = structuredClone(suite.scenarios[0].input),
      b = bindings();
    let id = suite.scenarios[0].id;
    if (change === "question")
      w.nodes[1].questions.department.instructions += " ";
    if (change === "input") input.message += " changed";
    if (change === "scenario") id = "another";
    if (change === "model") b.decisions.model = "different-model";
    const r = await executeWorkflow({
      workflow: w,
      input,
      scenarioId: id,
      bindings: b,
      mode: "mock",
    });
    assert.equal(r.status, "failed");
    assert.equal(r.error.code, "MOCK_REQUEST_MISMATCH");
    assert.equal(r.actualHttpAttempts, 0);
  }
  const duplicate = structuredClone(fixtures);
  duplicate.entries.push(duplicate.entries[0]);
  assert.throws(() => createMockProvider(duplicate), {
    code: "MOCK_FIXTURES_INVALID",
  });
});
test("invalid graph and all selected inputs fail before any provider call", async () => {
  let calls = 0;
  const b = bindings();
  const original = b.decisions.adapter.evaluate;
  b.decisions.adapter.evaluate = (...args) => {
    calls++;
    return original(...args);
  };
  const w = structuredClone(baseline);
  w.edges = [];
  await assert.rejects(
    executeWorkflow({
      workflow: w,
      input: suite.scenarios[0].input,
      bindings: b,
      mode: "mock",
    }),
    { code: "WORKFLOW_INVALID" },
  );
  const s = structuredClone(suite);
  s.scenarios.at(-1).input = { message: 0 };
  await assert.rejects(
    runSuite({ workflow: baseline, suite: s, bindings: b, mode: "mock" }),
    { code: "SUITE_INVALID" },
  );
  assert.equal(calls, 0);
});
test("invalid provider answers and branch types fail execution, never select normal outcome", async () => {
  const b = bindings();
  b.decisions.adapter.evaluate = async () => ({
    model: "mock-v1",
    answers: {},
    usage: null,
  });
  let r = await executeWorkflow({
    workflow: baseline,
    input: suite.scenarios[0].input,
    scenarioId: suite.scenarios[0].id,
    bindings: b,
    mode: "mock",
    trace: true,
  });
  assert.equal(r.status, "failed");
  assert.equal(r.error.code, "PROVIDER_INVALID_RESPONSE");
  assert.equal(r.result, undefined);
  const w = structuredClone(baseline);
  w.nodes.find((n) => n.id === "confidence_gate").cases[0].when = literal(1);
  r = await executeWorkflow({
    workflow: w,
    input: suite.scenarios[0].input,
    scenarioId: suite.scenarios[0].id,
    bindings: bindings(),
    mode: "mock",
    trace: true,
  });
  assert.equal(r.error.code, "EXPRESSION_TYPE_ERROR");
  assert.equal(
    r.events.find((e) => e.kind === "branch_evaluation_failed").data.cases[0]
      .result,
    "error",
  );
  assert(!r.selectedEdges.includes("e_confidence_gate_default"));
});
test("AC-13: cancellation aborts pending provider and stops new scenario dispatch", async () => {
  const controller = new AbortController(),
    b = bindings();
  let calls = 0,
    aborted = false;
  b.decisions.adapter.evaluate = (_r, ctx) =>
    new Promise((_resolve, reject) => {
      calls++;
      ctx.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new Error("Aborted"));
        },
        { once: true },
      );
      setImmediate(() => controller.abort());
    });
  const r = await runSuite({
    workflow: baseline,
    suite,
    bindings: b,
    mode: "mock",
    concurrency: 1,
    signal: controller.signal,
  });
  assert.equal(calls, 1);
  assert.equal(aborted, true);
  assert.equal(r.status, "canceled");
  assert.equal(r.summary.canceled, 12);
  assert.equal(r.summary.started, 1);
  assert.equal(r.coverage.partial, true);
});
test("deadlines and expression budgets are bounded", async () => {
  const b = bindings();
  b.decisions.adapter.evaluate = () => new Promise(() => {});
  const r = await executeWorkflow({
    workflow: baseline,
    input: suite.scenarios[0].input,
    scenarioId: suite.scenarios[0].id,
    bindings: b,
    mode: "mock",
    limits: { scenarioDeadlineMs: 10 },
  });
  assert.equal(r.status, "failed");
  assert.equal(r.error.code, "RUN_LIMIT_EXCEEDED");
  await assert.rejects(
    executeWorkflow({
      workflow: minimal(),
      input: { value: 1 },
      bindings: {},
      mode: "mock",
      limits: { scenarioDeadlineMs: NaN },
    }),
    { code: "RUN_LIMIT_EXCEEDED" },
  );
});
test("AC-15: snapshots and exchanges do not change when caller edits original values", async () => {
  const w = structuredClone(baseline),
    s = structuredClone(suite),
    f = structuredClone(fixtures),
    b = {
      decisions: {
        providerId: "mock",
        model: "mock-v1",
        adapter: createMockProvider(f),
      },
    };
  const promise = runSuite({
    workflow: w,
    suite: s,
    bindings: b,
    mode: "mock",
  });
  w.name = "Changed later";
  s.scenarios[0].input.message = "Changed later";
  f.entries[0].response.answers.department.value = "technical";
  const report = await promise;
  assert.equal(report.workflow.name, baseline.name);
  assert.equal(report.suiteSnapshotHash, hash(suite));
  assert.equal(report.scenarios[0].result.outcomeId, "billing_standard");
  assert(Object.isFrozen(report));
  assert(Object.isFrozen(report.scenarios[0].exchanges[0].response));
  assert.equal(report.artifactHash, workflowHashes(baseline).artifactHash);
});
test("observer errors never retry model calls; required persistence failure fails suite", async () => {
  let calls = 0;
  const b = bindings(),
    original = b.decisions.adapter.evaluate;
  b.decisions.adapter.evaluate = (...args) => {
    calls++;
    return original(...args);
  };
  const options = {
    workflow: baseline,
    input: suite.scenarios[0].input,
    scenarioId: suite.scenarios[0].id,
    bindings: b,
    mode: "mock",
    onEvent: (e) => {
      if (e.kind === "judgment_completed")
        throw new Error("private-storage-detail");
    },
  };
  let r = await executeWorkflow(options);
  assert.equal(r.status, "completed");
  assert.equal(r.observerErrors, 1);
  assert.equal(calls, 1);
  r = await executeWorkflow({ ...options, observerErrorPolicy: "fail" });
  assert.equal(r.status, "failed");
  assert.equal(r.error.code, "STORAGE_ERROR");
  assert.equal(calls, 2);
  assert(!JSON.stringify(r).includes("private-storage-detail"));
  const report = await runSuite({
    workflow: baseline,
    suite,
    bindings: bindings(),
    mode: "mock",
    concurrency: 1,
    onScenario: () => {
      throw new Error();
    },
  });
  assert.equal(report.status, "failed");
  assert.equal(report.error.code, "STORAGE_ERROR");
  assert.equal(report.summary.completed, 1);
});
test("AC-17/18: unlabeled cases, zero denominators, incomplete pairs cannot be called correct", async () => {
  const s = structuredClone(suite);
  delete s.scenarios[0].expected;
  const r = await runSuite({
    workflow: baseline,
    suite: s,
    bindings: bindings(),
    mode: "mock",
  });
  assert.equal(r.summary.unlabeled, 1);
  assert.equal(r.scenarios[0].assertionStatus, "not_evaluated");
  assert.equal(r.summary.labeled, 11);
  assert.equal(ratio(0, 0), null);
  const emptyCoverage = coverage(baseline, []);
  assert(emptyCoverage.edges.every((e) => e.conditionalRate === null));
  const missing = structuredClone(r);
  missing.scenarios.pop();
  assert.equal(compareRuns(r, missing).gate, "inconclusive");
  const different = structuredClone(r);
  different.suite.scenarios[1].name = "different";
  assert.equal(compareRuns(r, different).gate, "inconclusive");
  const mixed = structuredClone(r);
  mixed.mixedModel = true;
  assert.equal(compareRuns(r, mixed).gate, "inconclusive");
});
test("unexecuted-output or wrong-type assertion is an assertion failure", async () => {
  const s = structuredClone(suite);
  s.scenarios[0].expected.assertions = [
    {
      op: "gte",
      left: ref(
        "outputs",
        "technical_context",
        "usable_workaround",
        "probabilityTrue",
      ),
      right: literal(0.5),
    },
  ];
  const report = await runSuite({
    workflow: baseline,
    suite: s,
    bindings: bindings(),
    mode: "mock",
    selectedScenarioIds: [s.scenarios[0].id],
  });
  assert.equal(report.scenarios[0].status, "completed");
  assert.equal(report.scenarios[0].assertionStatus, "failed");
  assert(
    report.scenarios[0].assertions.some(
      (a) => a.error?.code === "EXPRESSION_MISSING_VALUE",
    ),
  );
});
