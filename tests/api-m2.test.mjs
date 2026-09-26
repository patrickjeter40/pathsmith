import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createApi } from "../apps/api/dist/app.js";
import { minimal } from "./helpers.mjs";

async function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "pathsmith-api-m2-"));
  let app = await createApi({ port: 0, dataDir }),
    url = await app.getUrl();
  t.after(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    dataDir,
    get app() {
      return app;
    },
    async restart() {
      await app.close();
      app = await createApi({ port: 0, dataDir });
      url = await app.getUrl();
    },
    async request(path, method = "GET", body) {
      const response = await fetch(`${url}/api/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Pathsmith-Client": "local",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    },
  };
}
async function terminal(env, id) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const response = await env.request(`/runs/${id}`);
    assert.equal(response.status, 200);
    if (!["queued", "running", "canceling"].includes(response.body.status))
      return response.body;
    await delay(25);
  }
  throw new Error("Run did not finish in 20 seconds");
}
const queueBody = (loaded) => ({
  workflowVersionId: loaded.workflowVersion.id,
  suiteVersionId: loaded.suiteVersion.id,
  fixtureSetId: loaded.fixtureSetId,
  mode: "mock",
});
async function largeSuite(env, count = 160) {
  const project = (
    await env.request("/projects", "POST", { name: "Cancellation" })
  ).body;
  const workflow = (
    await env.request(`/projects/${project.id}/workflows`, "POST", {
      name: "Deterministic",
      definition: minimal(),
    })
  ).body;
  const workflowVersion = (
    await env.request(`/workflows/${workflow.id}/versions`, "POST", {
      expectedRevision: 1,
    })
  ).body;
  const definition = {
    formatVersion: "0.1",
    id: "many_cases",
    name: "Many cases",
    description: "Offline lifecycle check",
    scenarios: Array.from({ length: count }, (_, i) => ({
      id: `case_${i}`,
      name: `Case ${i}`,
      tags: [],
      input: { value: i },
    })),
  };
  const suite = (
    await env.request(`/projects/${project.id}/suites`, "POST", {
      name: "Many cases",
      definition,
    })
  ).body;
  const versionResponse = await env.request(
    `/suites/${suite.id}/versions`,
    "POST",
    { expectedRevision: 1, workflowVersionId: workflowVersion.id },
  );
  assert.equal(
    versionResponse.status,
    201,
    JSON.stringify(versionResponse.body),
  );
  return {
    project,
    workflow,
    workflowVersion,
    suite,
    suiteVersion: versionResponse.body,
    fixtureSetId: "gaming",
  };
}

test("M2 HTTP gaming run, historical trace, saved versions, stale tabs, and restart", async (t) => {
  const env = await setup(t);
  const examples = await env.request("/examples");
  assert.equal(examples.status, 200);
  assert.equal(examples.body[0].id, "gaming");
  const loadedResponse = await env.request("/examples/gaming/load", "POST", {});
  assert.equal(loadedResponse.status, 201);
  const loaded = loadedResponse.body;
  assert.equal(
    (await env.request(`/projects/${loaded.project.id}/workflows`)).body.length,
    1,
  );
  const queued = await env.request("/runs", "POST", queueBody(loaded));
  assert.equal(queued.status, 202);
  assert.equal(queued.body.status, "queued");
  const done = await terminal(env, queued.body.id);
  assert.equal(done.status, "completed");
  assert.equal(done.summary.completed, 9);
  assert.equal(done.summary.assertionPassed, 9);
  assert.equal(done.summary.actualHttpAttempts, 0);
  assert.equal(done.progress.pending, 0);
  assert.equal(done.coverage.branchPortsVisited, 6);
  const page = await env.request(`/runs/${done.id}/scenarios?offset=1&limit=2`);
  assert.equal(page.body.total, 9);
  assert.equal(page.body.items.length, 2);
  assert.equal(page.body.items[0].result.events, undefined);
  const trace = await env.request(
    `/scenario-runs/${page.body.items[0].id}/trace`,
  );
  assert.ok(trace.body.result.events.length);
  assert.ok(trace.body.result.exchanges.length);
  const snapshot = (await env.request(`/runs/${done.id}/snapshot`)).body;
  assert.equal(snapshot.fixtures, undefined);
  assert.equal(snapshot.workflow.id, loaded.workflowVersion.definition.id);
  const renamed = structuredClone(loaded.workflow.definition);
  renamed.name = "Changed after run";
  const saved = await env.request(
    `/workflows/${loaded.workflow.id}/draft`,
    "PUT",
    {
      expectedRevision: 1,
      definition: renamed,
      layout: { positions: { start: { x: 500, y: 500 } } },
    },
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.draftRevision, 2);
  const stale = await env.request(
    `/workflows/${loaded.workflow.id}/draft`,
    "PUT",
    { expectedRevision: 1, definition: renamed },
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "DRAFT_CONFLICT");
  const secondVersion = await env.request(
    `/workflows/${loaded.workflow.id}/versions`,
    "POST",
    { expectedRevision: 2 },
  );
  assert.equal(secondVersion.status, 201);
  assert.equal(
    secondVersion.body.workflowSemanticHash,
    loaded.workflowVersion.workflowSemanticHash,
  );
  assert.equal(
    (
      await env.request(
        `/workflow-versions/${loaded.workflowVersion.id}/export`,
      )
    ).body.name,
    loaded.workflow.definition.name,
  );
  const suiteDraft = structuredClone(loaded.suite.definition);
  suiteDraft.scenarios[0].input.extra_invalid_property = true;
  const savedSuite = await env.request(
    `/suites/${loaded.suite.id}/draft`,
    "PUT",
    {
      expectedRevision: 1,
      definition: suiteDraft,
      workflowVersionId: loaded.workflowVersion.id,
    },
  );
  assert.equal(savedSuite.status, 200);
  assert.ok(savedSuite.body.diagnostics.length);
  const invalidSuite = await env.request(
    `/suites/${loaded.suite.id}/versions`,
    "POST",
    { expectedRevision: 2, workflowVersionId: loaded.workflowVersion.id },
  );
  assert.equal(invalidSuite.status, 422);
  assert.equal(invalidSuite.body.error.code, "SUITE_INVALID");
  await env.restart();
  const after = (await env.request(`/runs/${done.id}`)).body;
  assert.equal(after.status, "completed");
  assert.equal(after.summary.assertionPassed, 9);
  assert.deepEqual(
    (await env.request(`/scenario-runs/${trace.body.id}/trace`)).body,
    trace.body,
  );
  assert.equal(
    (await env.request(`/runs?projectId=${loaded.project.id}&limit=1`)).body
      .items[0].id,
    done.id,
  );
  const beforeDelete = await env.request(`/runs/${done.id}`, "DELETE", {
    confirm: false,
  });
  assert.equal(beforeDelete.status, 400);
  assert.equal(
    (await env.request(`/runs/${done.id}`, "DELETE", { confirm: true })).status,
    204,
  );
  assert.equal(
    (await env.request(`/scenario-runs/${trace.body.id}/trace`)).status,
    404,
  );
});

test("M2 API validates envelopes, ownership, preflight, unsupported modes, and safe catalog selectors", async (t) => {
  const env = await setup(t),
    loaded = (await env.request("/examples/gaming/load", "POST", {})).body;
  for (const body of [
    { name: "Bad", workspaceId: "other" },
    { name: "Bad", path: "C:/outside" },
  ])
    assert.equal((await env.request("/projects", "POST", body)).status, 400);
  assert.equal(
    (await env.request("/examples/arbitrary-file/load", "POST", {})).status,
    404,
  );
  assert.equal(
    (await env.request("/runs", "POST", { ...queueBody(loaded), mode: "live" }))
      .status,
    400,
  );
  assert.equal(
    (
      await env.request("/runs", "POST", {
        ...queueBody(loaded),
        sourceRunId: "other",
      })
    ).status,
    400,
  );
  const invalid = await env.request("/runs", "POST", {
    ...queueBody(loaded),
    selectedScenarioIds: ["missing"],
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, "SUITE_INVALID");
  assert.equal(
    (
      await env.request("/runs", "POST", {
        ...queueBody(loaded),
        fixtureSetId: "unknown",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await env.request("/runs", "POST", {
        ...queueBody(loaded),
        profile: {
          formatVersion: "0.1",
          bindings: {
            decisions: {
              providerId: "mock",
              model: "mock-v1",
              apiKey: "private",
            },
          },
        },
      })
    ).status,
    422,
  );
  assert.equal((await env.request("/runs?offset=-1")).status, 400);
  const other = (
    await env.request("/examples/support-baseline/load", "POST", {})
  ).body;
  assert.equal(
    (
      await env.request("/runs", "POST", {
        ...queueBody(loaded),
        suiteVersionId: other.suiteVersion.id,
      })
    ).status,
    404,
  );
  const invalidDraft = await env.request(
    `/workflows/${loaded.workflow.id}/draft`,
    "PUT",
    { expectedRevision: 1, definition: { nodes: [] } },
  );
  assert.equal(invalidDraft.status, 200);
  assert.ok(invalidDraft.body.diagnostics.length);
  assert.equal(
    (
      await env.request(`/workflows/${loaded.workflow.id}/versions`, "POST", {
        expectedRevision: 2,
      })
    ).status,
    422,
  );
  const encoded = JSON.parse(
    '{"name":"unsafe","definition":{"__proto__":{"polluted":true}}}',
  );
  assert.equal(
    (
      await env.request(
        `/projects/${loaded.project.id}/workflows`,
        "POST",
        encoded,
      )
    ).status,
    400,
  );
  assert.equal((await env.request("/projects", "POST", null)).status, 400);
  assert.equal(
    (
      await env.request("/projects", "POST", {
        name: "x",
        unknown: "x".repeat(520 * 1024),
      })
    ).status,
    413,
  );
  assert.equal((await env.request("/runs")).body.total, 0);
});

test("M2 cancellation stops dispatch, preserves partial records, and is idempotent", async (t) => {
  const env = await setup(t),
    loaded = await largeSuite(env);
  const run = (
    await env.request("/runs", "POST", { ...queueBody(loaded), concurrency: 1 })
  ).body;
  const queued = (
    await env.request("/runs", "POST", { ...queueBody(loaded), concurrency: 1 })
  ).body;
  const canceledQueued = await env.request(
    `/runs/${queued.id}/cancel`,
    "POST",
    {},
  );
  assert.equal(canceledQueued.status, 200);
  assert.equal(canceledQueued.body.status, "canceled");
  assert.equal(canceledQueued.body.summary.canceled, 160);
  const cancellation = await env.request(`/runs/${run.id}/cancel`, "POST", {});
  assert.equal(cancellation.status, 200);
  const done = await terminal(env, run.id);
  assert.equal(done.status, "canceled");
  assert.ok(done.summary.canceled > 0);
  assert.ok(done.summary.completed < 160);
  assert.equal(done.summary.actualHttpAttempts, 0);
  assert.equal(
    (await env.request(`/runs/${run.id}/cancel`, "POST", {})).body.status,
    "canceled",
  );
  assert.equal(
    (await env.request(`/runs/${run.id}/scenarios?status=completed`)).body
      .total,
    done.summary.completed,
  );
});

test("M2 API restart interrupts unfinished jobs and does not dispatch them again", async (t) => {
  const env = await setup(t),
    loaded = await largeSuite(env);
  await assert.rejects(createApi({ port: 0, dataDir: env.dataDir }), {
    code: "STORAGE_LOCKED",
  });
  const run = (
    await env.request("/runs", "POST", { ...queueBody(loaded), concurrency: 1 })
  ).body;
  const queued = (
    await env.request("/runs", "POST", { ...queueBody(loaded), concurrency: 1 })
  ).body;
  const before = (await env.request(`/runs/${run.id}`)).body;
  assert.equal(before.status, "running");
  await env.restart();
  const interrupted = (await env.request(`/runs/${run.id}`)).body;
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.error.code, "RUN_INTERRUPTED");
  assert.ok(interrupted.summary.completed >= before.summary.completed);
  assert.ok(interrupted.progress.persisted < 160);
  assert.equal(
    (await env.request(`/runs/${queued.id}`)).body.status,
    "interrupted",
  );
  const count = interrupted.progress.persisted;
  await delay(60);
  assert.equal(
    (await env.request(`/runs/${run.id}`)).body.progress.persisted,
    count,
  );
});
