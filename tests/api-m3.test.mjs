import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createApi } from "../apps/api/dist/app.js";
import { LocalApplication } from "../apps/api/dist/service.js";
import { loadExample } from "../apps/api/dist/examples.js";
import { openStorage } from "../packages/storage/dist/index.js";
import { runSuite } from "@pathsmith/evaluation";
import { createMockProvider } from "@pathsmith/provider-mock";

const policy = { strict: false, acceptMixedModel: false };
const queueBody = (loaded) => ({
  workflowVersionId: loaded.workflowVersion.id,
  suiteVersionId: loaded.suiteVersion.id,
  fixtureSetId: loaded.fixtureSetId,
  mode: "mock",
});
function seedRun(storage, context, exampleId = "support-baseline") {
  const example = loadExample(exampleId);
  const project = storage.createProject(context, "Comparison test");
  const workflow = storage.createWorkflow(context, project.id, {
    name: example.workflow.name,
    definition: example.workflow,
  });
  const workflowVersion = storage.publishWorkflowVersion(
    context,
    workflow.id,
    1,
  );
  const suite = storage.createSuite(context, project.id, {
    name: example.suite.name,
    definition: example.suite,
  });
  const suiteVersion = storage.publishSuiteVersion(
    context,
    suite.id,
    workflowVersion.id,
    1,
  );
  return storage.queueRun(context, {
    workflowVersionId: workflowVersion.id,
    suiteVersionId: suiteVersion.id,
    profile: example.profile,
    fixtures: example.fixtures,
    concurrency: 1,
  });
}
async function setup(t, seedOtherWorkspace = false) {
  const dataDir = mkdtempSync(join(tmpdir(), "pathsmith-api-m3-"));
  let foreignRun;
  if (seedOtherWorkspace) {
    const storage = openStorage({ dataDir, workspaceId: "other" });
    try {
      foreignRun = seedRun(storage, storage.localContext);
    } finally {
      storage.close();
    }
  }
  let app = await createApi({ port: 0, dataDir });
  let url = await app.getUrl();
  t.after(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    foreignRun,
    get local() {
      return app.get(LocalApplication);
    },
    async restart() {
      await app.close();
      app = await createApi({ port: 0, dataDir });
      url = await app.getUrl();
    },
    async request(path, method = "GET", body, headers = {}) {
      const response = await fetch(`${url}/api/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Pathsmith-Client": "local",
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    async compare(baselineRunId, candidateRunId, selectedPolicy = policy) {
      return this.request("/comparisons", "POST", {
        baselineRunId,
        candidateRunId,
        policy: selectedPolicy,
      });
    },
  };
}
async function runExample(env, exampleId, overrides = {}) {
  const loaded = await env.request(`/examples/${exampleId}/load`, "POST", {});
  assert.equal(loaded.status, 201);
  const queued = await env.request("/runs", "POST", {
    ...queueBody(loaded.body),
    ...overrides,
  });
  assert.equal(queued.status, 202);
  for (let attempt = 0; attempt < 800; attempt++) {
    const { body } = await env.request(`/runs/${queued.body.id}`);
    if (!["queued", "running", "canceling"].includes(body.status)) return body;
    await delay(25);
  }
  throw new Error("Run did not finish in 20 seconds");
}

test("M3 HTTP compares immutable cross-project runs with explicit default and strict gates", async (t) => {
  const env = await setup(t);
  const baseline = await runExample(env, "support-baseline");
  const candidate = await runExample(env, "support-candidate");
  assert.notEqual(baseline.projectId, candidate.projectId);
  assert.equal(baseline.summary.actualHttpAttempts, 0);
  assert.equal(candidate.summary.actualHttpAttempts, 0);
  const storedCoverage = await env.request(`/runs/${baseline.id}/coverage`);
  assert.equal(storedCoverage.status, 200);
  assert.equal(storedCoverage.body.coverage.branchPortsVisited, 10);
  assert.equal(storedCoverage.body.coverage.branchPortsTotal, 10);
  const response = await env.compare(baseline.id, candidate.id);
  assert.equal(response.status, 200);
  const comparison = response.body;
  assert.equal(comparison.gate, "fail");
  assert.equal(comparison.newAssertionRegressions, 2);
  assert.equal(comparison.assertionImprovements, 1);
  assert.equal(comparison.changedCases, 3);
  assert.equal(comparison.cases.length, 12);
  assert.equal(comparison.workflowChanged, true);
  assert.equal(comparison.modelChanged, false);
  assert.equal(comparison.confounded, false);
  assert.deepEqual(comparison.policy, policy);
  assert.deepEqual(comparison.issues, []);
  assert.deepEqual(comparison.configurationDiff, []);
  assert.ok(
    comparison.workflowDiff.nodes.changed.some(
      (n) => n.id === "confidence_gate",
    ),
  );
  for (const item of comparison.cases.filter((c) => c.behaviorChanged)) {
    assert.ok(item.firstDivergence);
    assert.ok(item.baseline.visitedNodes.includes("start"));
    assert.ok(item.candidate.visitedNodes.includes("start"));
    assert.notDeepEqual(
      item.baseline.selectedEdges,
      item.candidate.selectedEdges,
    );
  }
  const same = (await env.compare(baseline.id, baseline.id)).body;
  assert.equal(same.gate, "pass");
  assert.equal(same.newAssertionRegressions, 0);
  assert.equal(same.cases.filter((c) => c.unchangedFailure).length, 1);
  assert.equal(
    (await env.compare(baseline.id, baseline.id, { ...policy, strict: true }))
      .body.gate,
    "fail",
  );
  await env.restart();
  assert.deepEqual(
    (await env.compare(baseline.id, candidate.id)).body,
    comparison,
  );
});

test("M3 incomplete and incompatible cohorts cannot produce a clean comparison gate", async (t) => {
  const env = await setup(t);
  const baseline = await runExample(env, "support-baseline");
  const gaming = await runExample(env, "gaming");
  const mismatch = (await env.compare(baseline.id, gaming.id)).body;
  assert.equal(mismatch.gate, "inconclusive");
  assert.ok(mismatch.issues.includes("Suite snapshots differ"));
  assert.ok(mismatch.issues.includes("Selected scenario IDs differ"));
  const selected = baseline.selectedScenarioIds.slice(0, 1);
  const subset = await runExample(env, "support-baseline", {
    selectedScenarioIds: selected,
  });
  assert.equal(
    (await env.compare(baseline.id, subset.id)).body.gate,
    "inconclusive",
  );
  const failed = await runExample(env, "support-baseline", {
    limits: { expressionOperations: 1 },
  });
  assert.equal(failed.status, "failed");
  const failedCoverage = (await env.request(`/runs/${failed.id}/coverage`)).body
    .coverage;
  assert.deepEqual(
    failedCoverage,
    env.local.storage.getRun(env.local.context, failed.id).report.coverage,
  );
  assert.equal(failedCoverage.partial, true);
  assert.ok(failedCoverage.nodes.some((node) => node.visits > 0));
  const failure = (await env.compare(baseline.id, failed.id)).body;
  assert.equal(failure.gate, "inconclusive");
  assert.ok(failure.issues.includes("Run execution is incomplete"));
  assert.ok(
    failure.configurationDiff.some((change) => change.key === "limits"),
  );

  // Queue directly through storage to observe lifecycle states deterministically
  // without scheduling or fabricating final reports.
  const queued = seedRun(env.local.storage, env.local.context);
  assert.deepEqual(await env.request(`/runs/${queued.id}/coverage`), {
    status: 200,
    body: { coverage: null },
  });
  for (const candidateId of [queued.id, baseline.id]) {
    const result = (await env.compare(queued.id, candidateId)).body;
    assert.equal(result.gate, "inconclusive");
    assert.equal(result.newAssertionRegressions, null);
    assert.deepEqual(result.cases, []);
    assert.ok(
      result.issues.some((issue) => issue.includes("no final report (queued)")),
    );
  }
  await env.request(`/runs/${queued.id}/cancel`, "POST", {});
  const canceled = (await env.compare(baseline.id, queued.id)).body;
  assert.equal(canceled.gate, "inconclusive");
  assert.equal(canceled.candidateStatus, "canceled");
  assert.equal(
    (await env.request(`/runs/${queued.id}/coverage`)).body.coverage,
    null,
  );
  const pending = seedRun(env.local.storage, env.local.context);
  await env.restart();
  const interrupted = (await env.compare(baseline.id, pending.id)).body;
  assert.equal(interrupted.gate, "inconclusive");
  assert.equal(interrupted.candidateStatus, "interrupted");
  assert.equal(interrupted.assertionImprovements, null);
});

test("M3 coverage preserves observed paths for unfinished and canceled runs", async (t) => {
  const env = await setup(t);
  async function partialRun() {
    const run = seedRun(env.local.storage, env.local.context);
    assert.equal(env.local.storage.claimNextRun(env.local.context).id, run.id);
    const snapshot = run.snapshot;
    const controller = new AbortController();
    const adapter = createMockProvider(snapshot.fixtures);
    const report = await runSuite({
      workflow: snapshot.workflow,
      suite: snapshot.suite,
      bindings: Object.fromEntries(
        Object.entries(snapshot.profile.bindings).map(([name, binding]) => [
          name,
          { ...binding, adapter },
        ]),
      ),
      limits: snapshot.limits,
      concurrency: snapshot.concurrency,
      selectedScenarioIds: snapshot.selectedScenarioIds,
      mode: "mock",
      runId: run.id,
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      signal: controller.signal,
      onScenario(result) {
        env.local.storage.appendScenarioResult(
          env.local.context,
          run.id,
          result,
        );
        controller.abort();
      },
    });
    assert.equal(report.status, "canceled");
    assert.equal(report.summary.completed, 1);
    return { run, report };
  }
  const interrupted = await partialRun();
  const observed = (await env.request(`/runs/${interrupted.run.id}/coverage`))
    .body.coverage;
  assert.equal(observed.partial, true);
  assert.equal(observed.completed, 1);
  assert.equal(observed.started, 1);
  assert.ok(
    observed.completed < interrupted.run.snapshot.selectedScenarioIds.length,
  );
  const visitedEdges = interrupted.report.scenarios[0].selectedEdges;
  assert.ok(visitedEdges.length > 0);
  assert.deepEqual(
    observed.edges
      .filter((edge) => edge.traversals > 0)
      .map((edge) => edge.edgeId)
      .sort(),
    [...visitedEdges].sort(),
  );
  assert.ok(
    observed.edges.some(
      (edge) => edge.sourceVisits === 0 && edge.conditionalRate === null,
    ),
  );
  await env.restart();
  assert.equal(
    (await env.request(`/runs/${interrupted.run.id}`)).body.status,
    "interrupted",
  );
  assert.deepEqual(
    (await env.request(`/runs/${interrupted.run.id}/coverage`)).body.coverage,
    observed,
  );

  const canceled = await partialRun();
  env.local.storage.finishRun(
    env.local.context,
    canceled.run.id,
    canceled.report,
  );
  const finalCoverage = (await env.request(`/runs/${canceled.run.id}/coverage`))
    .body.coverage;
  assert.deepEqual(finalCoverage, canceled.report.coverage);
  assert.equal(finalCoverage.partial, true);
  assert.equal(finalCoverage.completed, 1);
});

test("M3 comparison validates explicit policy, workspace ownership and local request controls", async (t) => {
  const env = await setup(t, true);
  const local = seedRun(env.local.storage, env.local.context);
  const valid = { baselineRunId: local.id, candidateRunId: local.id, policy };
  for (const body of [
    {},
    { ...valid, policy: undefined },
    { ...valid, policy: {} },
    { ...valid, policy: { ...policy, strict: "false" } },
    { ...valid, policy: { ...policy, acceptMixedModel: 1 } },
    { ...valid, policy: { ...policy, allowIncomplete: true } },
    { ...valid, workspaceId: "other" },
    { ...valid, baseline: {} },
    { ...valid, candidateRunId: "../../outside" },
  ])
    assert.equal((await env.request("/comparisons", "POST", body)).status, 400);
  assert.equal((await env.compare(local.id, "missing")).status, 404);
  assert.equal((await env.compare(local.id, env.foreignRun.id)).status, 404);
  assert.equal((await env.compare(env.foreignRun.id, local.id)).status, 404);
  assert.equal(
    (await env.request(`/runs/${env.foreignRun.id}/coverage`)).status,
    404,
  );
  assert.equal(
    (
      await env.request("/comparisons", "POST", valid, {
        "X-Pathsmith-Client": "",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await env.request("/comparisons", "POST", valid, {
        Origin: "https://example.com",
      })
    ).status,
    403,
  );
});
