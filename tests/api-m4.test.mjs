import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { createApi } from "../apps/api/dist/app.js";
import { LocalApplication } from "../apps/api/dist/service.js";
import { openStorage } from "../packages/storage/dist/index.js";
import { loadExample } from "../apps/api/dist/examples.js";
import { candidate, minimal, literal } from "./helpers.mjs";
const Database = createRequire(
  new URL("../packages/storage/package.json", import.meta.url),
)("better-sqlite3");
const key = "api-integration-canary-key";
async function setup(t, providerConfig = {}, foreign = false) {
  const dataDir = mkdtempSync(join(tmpdir(), "pathsmith-api-m4-"));
  let foreignRunId;
  if (foreign) {
    const storage = openStorage({ dataDir, workspaceId: "foreign" });
    const example = loadExample("support-baseline"),
      ctx = storage.localContext;
    const project = storage.createProject(ctx, "Foreign");
    const workflow = storage.createWorkflow(ctx, project.id, {
      name: "Foreign",
      definition: example.workflow,
    });
    const wv = storage.publishWorkflowVersion(ctx, workflow.id);
    const suite = storage.createSuite(ctx, project.id, {
      name: "Foreign",
      definition: example.suite,
    });
    const sv = storage.publishSuiteVersion(ctx, suite.id, wv.id);
    foreignRunId = storage.queueRun(ctx, {
      workflowVersionId: wv.id,
      suiteVersionId: sv.id,
      profile: example.profile,
      fixtures: example.fixtures,
    }).id;
    storage.close();
  }
  const config = {
    enableLive: false,
    apiKey: "",
    fetch: async () => {
      throw new Error("Unexpected live request");
    },
    ...providerConfig,
  };
  let app = await createApi({ port: 0, dataDir, providerConfig: config }),
    url = await app.getUrl();
  t.after(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    dataDir,
    foreignRunId,
    get local() {
      return app.get(LocalApplication);
    },
    async restart() {
      await app.close();
      app = await createApi({ port: 0, dataDir, providerConfig: config });
      url = await app.getUrl();
    },
    async request(path, method = "GET", body) {
      const res = await fetch(`${url}/api/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Pathsmith-Client": "local",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: res.status,
        body: res.status === 204 ? null : await res.json(),
        headers: res.headers,
      };
    },
  };
}
async function terminal(env, id) {
  for (let i = 0; i < 200; i++) {
    const res = await env.request(`/runs/${id}`);
    assert.equal(res.status, 200);
    if (!["queued", "running", "canceling"].includes(res.body.status))
      return res.body;
    await delay(15);
  }
  throw new Error("Run did not terminate");
}
const versions = (loaded) => ({
  workflowVersionId: loaded.workflowVersion.id,
  suiteVersionId: loaded.suiteVersion.id,
});
async function createLiveExample(env) {
  const local = env.local,
    ctx = local.context,
    storage = local.storage;
  const project = storage.createProject(ctx, "Live test");
  const definition = minimal();
  definition.bindings = ["decisions"];
  definition.nodes.push({
    id: "judge",
    label: "Judge",
    kind: "judgment",
    binding: "decisions",
    state: literal("Evaluate this message"),
    questions: { safe: { kind: "binary", instructions: "Safe?" } },
  });
  definition.edges[0].target = "judge";
  definition.edges.push({
    id: "judge_next",
    source: "judge",
    port: "next",
    target: "finish",
  });
  const workflow = storage.createWorkflow(ctx, project.id, {
    name: "Live",
    definition,
  });
  const workflowVersion = storage.publishWorkflowVersion(ctx, workflow.id);
  const suite = storage.createSuite(ctx, project.id, {
    name: "Live",
    definition: {
      formatVersion: "0.1",
      id: "live_suite",
      name: "Live",
      description: "Offline transport",
      scenarios: [
        {
          id: "one",
          name: "One",
          tags: [],
          input: { value: 1 },
          expected: { allowedOutcomes: ["done"] },
        },
      ],
    },
  });
  const suiteVersion = storage.publishSuiteVersion(
    ctx,
    suite.id,
    workflowVersion.id,
  );
  return { workflow, workflowVersion, suiteVersion, project };
}
const liveResponse = () =>
  new Response(
    JSON.stringify({
      model: "jev-test-version",
      answers: { safe: { type: "noul", noul: 0.8 } },
      usage: { input_tokens: 12, output_tokens: 2 },
    }),
  );

test("M4 persisted replay, report export, comparison and source deletion protection", async (t) => {
  let calls = 0;
  const env = await setup(t, {
    fetch: async () => {
      calls++;
      throw new Error("Replay must never dispatch live");
    },
  });
  const loaded = (
    await env.request("/examples/support-baseline/load", "POST", {})
  ).body;
  const queued = await env.request("/runs", "POST", {
    ...versions(loaded),
    fixtureSetId: loaded.fixtureSetId,
  });
  assert.equal(queued.status, 202);
  const source = await terminal(env, queued.body.id);
  assert.equal(source.status, "completed");
  const exported = await env.request(`/runs/${source.id}/export`);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.summary.logicalJudgments, 16);
  const draft = env.local.storage.saveWorkflowDraft(
    env.local.context,
    loaded.workflow.id,
    { expectedRevision: 1, definition: candidate },
  );
  const version = env.local.storage.publishWorkflowVersion(
    env.local.context,
    draft.id,
    draft.draftRevision,
  );
  const queuedReplay = await env.request("/runs", "POST", {
    ...versions(loaded),
    workflowVersionId: version.id,
    mode: "replay",
    sourceRunId: source.id,
  });
  assert.equal(queuedReplay.status, 202, JSON.stringify(queuedReplay.body));
  const replayed = await terminal(env, queuedReplay.body.id);
  assert.equal(replayed.status, "completed", JSON.stringify(replayed));
  assert.equal(replayed.mode, "replay");
  assert.equal(replayed.sourceRunId, source.id);
  assert.equal(replayed.origin, "synthetic");
  assert.equal(replayed.summary.replayedJudgments, 14);
  assert.equal(replayed.summary.actualHttpAttempts, 0);
  assert.deepEqual(replayed.summary.usage, { inputTokens: 0, outputTokens: 0 });
  const comparison = await env.request("/comparisons", "POST", {
    baselineRunId: source.id,
    candidateRunId: replayed.id,
    policy: { strict: false, acceptMixedModel: false },
  });
  assert.equal(comparison.body.newAssertionRegressions, 2);
  assert.equal(comparison.body.assertionImprovements, 1);
  const report = (await env.request(`/runs/${replayed.id}/export`)).body;
  assert.equal(report.sourceRunId, source.id);
  assert.deepEqual(report.profile, exported.body.profile);
  assert.ok(
    report.scenarios
      .flatMap((s) => s.exchanges)
      .every((e) => e.sourceRunId === source.id),
  );
  assert.equal(
    (await env.request(`/runs/${source.id}`, "DELETE", { confirm: true }))
      .status,
    409,
  );
  assert.equal(
    (
      await env.request(`/projects/${loaded.project.id}`, "DELETE", {
        confirm: true,
      })
    ).status,
    409,
  );
  await env.restart();
  assert.equal(
    (await env.request(`/runs/${replayed.id}/export`)).body.sourceRunId,
    source.id,
  );
  assert.equal(
    (await env.request(`/runs/${replayed.id}`, "DELETE", { confirm: true }))
      .status,
    204,
  );
  assert.equal(
    (await env.request(`/runs/${source.id}`, "DELETE", { confirm: true }))
      .status,
    204,
  );
  assert.equal(calls, 0);
});

test("Replay source lookup enforces project/workspace and profile; absent reports cannot export", async (t) => {
  const env = await setup(t, {}, true);
  const loaded = (
    await env.request("/examples/support-baseline/load", "POST", {})
  ).body;
  const sourceQueued = await env.request("/runs", "POST", {
    ...versions(loaded),
    fixtureSetId: loaded.fixtureSetId,
  });
  const source = await terminal(env, sourceQueued.body.id);
  const replayBody = {
    ...versions(loaded),
    mode: "replay",
    sourceRunId: source.id,
  };
  assert.equal(
    (
      await env.request("/runs", "POST", {
        ...replayBody,
        sourceRunId: env.foreignRunId,
      })
    ).status,
    404,
  );
  assert.equal(
    (await env.request(`/runs/${env.foreignRunId}/export`)).status,
    404,
  );
  const other = (
    await env.request("/examples/support-baseline/load", "POST", {})
  ).body;
  assert.equal(
    (await env.request("/runs", "POST", { ...replayBody, ...versions(other) }))
      .status,
    404,
  );
  const profile = structuredClone(loaded.profile);
  profile.bindings.decisions.model = "different";
  assert.equal(
    (await env.request("/runs", "POST", { ...replayBody, profile })).status,
    400,
  );
  assert.equal(
    (
      await env.request("/runs", "POST", {
        ...replayBody,
        fixtureSetId: loaded.fixtureSetId,
      })
    ).status,
    400,
  );
  assert.throws(
    () =>
      env.local.storage.queueRun(
        { workspaceId: "foreign" },
        { ...versions(loaded), mode: "replay", sourceRunId: source.id },
      ),
    { code: "NOT_FOUND" },
  );
  const pending = env.local.storage.queueRun(env.local.context, {
    ...versions(loaded),
    profile: loaded.profile,
    fixtures: loadExample("support-baseline").fixtures,
  });
  assert.equal((await env.request(`/runs/${pending.id}/export`)).status, 409);
  assert.equal(
    (
      await env.request("/runs", "POST", {
        ...replayBody,
        sourceRunId: pending.id,
      })
    ).status,
    409,
  );
});

test("Live gates require backend enablement, key and per-request consent; status never dispatches", async (t) => {
  for (const [enableLive, apiKey, code] of [
    [false, key, "LIVE_DISABLED"],
    [true, "", "PROVIDER_NOT_CONFIGURED"],
  ]) {
    let calls = 0;
    const env = await setup(t, {
      enableLive,
      apiKey,
      fetch: async () => {
        calls++;
        return liveResponse();
      },
    });
    const loaded = await createLiveExample(env),
      body = { ...versions(loaded), mode: "live" };
    const status = await env.request("/providers/status");
    assert.equal(status.status, 200);
    assert.deepEqual(status.body.allowedModes, ["mock", "replay"]);
    assert.equal(JSON.stringify(status.body).includes(key), false);
    assert.equal((await env.request("/runs", "POST", body)).status, 400);
    const rejected = await env.request("/runs", "POST", {
      ...body,
      confirmLive: true,
    });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.error.code, code);
    assert.equal(
      (
        await env.request("/runs", "POST", {
          ...body,
          confirmLive: true,
          apiKey: key,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await env.request("/runs", "POST", {
          ...body,
          confirmLive: true,
          httpAttemptLimit: 30001,
        })
      ).status,
      400,
    );
    assert.equal(calls, 0);
    assert.equal(env.local.storage.listRuns(env.local.context).total, 0);
  }
});

test("Injected live transport persists attempts separately from exchanges, usage, consent and secure export", async (t) => {
  let calls = 0;
  const env = await setup(t, {
    enableLive: true,
    apiKey: key,
    fetch: async (_url, init) => {
      assert.equal(init.headers.Authorization, `Bearer ${key}`);
      calls++;
      return liveResponse();
    },
  });
  const loaded = await createLiveExample(env);
  const status = await env.request("/providers/status");
  assert.ok(status.body.allowedModes.includes("live"));
  assert.equal(calls, 0);
  const queued = await env.request("/runs", "POST", {
    ...versions(loaded),
    mode: "live",
    confirmLive: true,
    httpAttemptLimit: 3,
  });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.httpAttemptLimit, 3);
  const finished = await terminal(env, queued.body.id);
  assert.equal(finished.status, "completed", JSON.stringify(finished));
  assert.equal(calls, 1);
  assert.equal(finished.mode, "live");
  assert.equal(finished.summary.actualHttpAttempts, 1);
  assert.equal(finished.adapters.decisions.requestedModel, "jev-latest");
  assert.deepEqual(finished.adapters.decisions.resolvedModels, [
    "jev-test-version",
  ]);
  assert.deepEqual(finished.summary.usage, {
    inputTokens: 12,
    outputTokens: 2,
  });
  const snapshot = await env.request(`/runs/${finished.id}/snapshot`);
  assert.equal(snapshot.body.liveConfirmed, true);
  assert.equal(snapshot.body.httpAttemptLimit, 3);
  const exported = await env.request(`/runs/${finished.id}/export`);
  assert.equal(exported.headers.get("cache-control"), "no-store");
  assert.equal(
    exported.body.adapters.decisions.resolvedModels[0],
    "jev-test-version",
  );
  assert.equal(exported.body.scenarios[0].attempts[0].status, "succeeded");
  assert.equal(
    JSON.stringify([snapshot.body, exported.body, finished]).includes(key),
    false,
  );
  const db = new Database(join(env.dataDir, "pathsmith.sqlite"), {
    readonly: true,
  });
  try {
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM provider_attempts").get().n,
      1,
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM provider_exchanges").get().n,
      1,
    );
    assert.equal(
      JSON.parse(
        db.prepare("SELECT payload FROM provider_attempts").get().payload,
      ).attempt,
      1,
    );
  } finally {
    db.close();
  }
  const replay = await env.request("/runs", "POST", {
    ...versions(loaded),
    mode: "replay",
    sourceRunId: finished.id,
  });
  const replayed = await terminal(env, replay.body.id);
  assert.equal(replayed.status, "completed");
  assert.equal(replayed.origin, "live");
  assert.deepEqual(replayed.summary.historicalUsage, {
    inputTokens: 12,
    outputTokens: 2,
  });
  assert.equal(calls, 1);
});

test("Restart interrupts active and queued live jobs without resending; partial attempts remain inspectable", async (t) => {
  let calls = 0;
  const env = await setup(t, {
    enableLive: true,
    apiKey: key,
    fetch: async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const loaded = await createLiveExample(env),
    body = { ...versions(loaded), mode: "live", confirmLive: true };
  const active = await env.request("/runs", "POST", body);
  for (let i = 0; calls === 0 && i < 50; i++) await delay(5);
  assert.equal(calls, 1);
  const queued = await env.request("/runs", "POST", body);
  await env.restart();
  for (const id of [active.body.id, queued.body.id]) {
    const run = (await env.request(`/runs/${id}`)).body;
    assert.equal(run.status, "interrupted");
    assert.equal((await env.request(`/runs/${id}/export`)).status, 409);
  }
  const scenarios = (await env.request(`/runs/${active.body.id}/scenarios`))
    .body;
  assert.equal(scenarios.items[0].result.actualHttpAttempts, 1);
  assert.equal(scenarios.items[0].result.attempts[0].status, "canceled");
  await delay(25);
  assert.equal(calls, 1);
});

test("Live retries, auth failures and explicit cancellation preserve actual attempt counts", async (t) => {
  let calls = 0,
    phase = "retry";
  const env = await setup(t, {
    enableLive: true,
    apiKey: key,
    fetch: async () => {
      calls++;
      if (phase === "pending") return new Promise(() => {});
      if (phase === "auth")
        return new Response(JSON.stringify({ error: key }), { status: 401 });
      return calls === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "0" } })
        : liveResponse();
    },
  });
  const loaded = await createLiveExample(env),
    body = { ...versions(loaded), mode: "live", confirmLive: true };
  const queued = await env.request("/runs", "POST", body);
  const finished = await terminal(env, queued.body.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.summary.actualHttpAttempts, 2);
  assert.equal(finished.summary.usage, null);
  const report = (await env.request(`/runs/${finished.id}/export`)).body;
  assert.equal(report.scenarios[0].attempts.length, 2);
  assert.equal(report.scenarios[0].exchanges.length, 1);
  const replayQueue = await env.request("/runs", "POST", {
    ...versions(loaded),
    mode: "replay",
    sourceRunId: finished.id,
  });
  const replayed = await terminal(env, replayQueue.body.id);
  assert.equal(replayed.summary.historicalUsage, null);
  assert.equal(calls, 2);
  phase = "auth";
  const authQueued = await env.request("/runs", "POST", body),
    auth = await terminal(env, authQueued.body.id);
  assert.equal(auth.status, "failed");
  assert.equal(auth.summary.actualHttpAttempts, 1);
  assert.equal(calls, 3);
  const authReport = (await env.request(`/runs/${auth.id}/export`)).body;
  assert.equal(authReport.scenarios[0].error.code, "PROVIDER_AUTH_ERROR");
  assert.equal(authReport.scenarios[0].exchanges.length, 0);
  assert.equal(JSON.stringify(authReport).includes(key), false);
  phase = "pending";
  const cancelQueued = await env.request("/runs", "POST", body);
  for (let i = 0; calls < 4 && i < 50; i++) await delay(5);
  assert.equal(
    (await env.request(`/runs/${cancelQueued.body.id}/cancel`, "POST", {}))
      .status,
    200,
  );
  const canceled = await terminal(env, cancelQueued.body.id);
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.summary.actualHttpAttempts, 1);
  const db = new Database(join(env.dataDir, "pathsmith.sqlite"), {
    readonly: true,
  });
  try {
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM provider_attempts").get().n,
      4,
    );
  } finally {
    db.close();
  }
});

test("Zero-judgment live jobs and empty-profile replays retain live source origin without HTTP", async (t) => {
  let calls = 0;
  const env = await setup(t, {
    enableLive: true,
    apiKey: key,
    fetch: async () => {
      calls++;
      throw new Error("No judgment means no request");
    },
  });
  const loaded = await createLiveExample(env);
  const draft = env.local.storage.saveWorkflowDraft(
    env.local.context,
    loaded.workflow.id,
    { expectedRevision: 1, definition: minimal() },
  );
  const version = env.local.storage.publishWorkflowVersion(
    env.local.context,
    draft.id,
    draft.draftRevision,
  );
  const base = { ...versions(loaded), workflowVersionId: version.id };
  const queued = await env.request("/runs", "POST", {
    ...base,
    mode: "live",
    confirmLive: true,
  });
  assert.equal(queued.status, 202);
  const source = await terminal(env, queued.body.id);
  assert.equal(source.status, "completed", JSON.stringify(source));
  assert.equal(source.origin, "live");
  assert.deepEqual(source.summary.usage, { inputTokens: 0, outputTokens: 0 });
  const replayQueue = await env.request("/runs", "POST", {
    ...base,
    mode: "replay",
    sourceRunId: source.id,
  });
  assert.equal(replayQueue.status, 202);
  const replay = await terminal(env, replayQueue.body.id);
  assert.equal(replay.status, "completed", JSON.stringify(replay));
  assert.equal(replay.origin, "live");
  const exported = await env.request(`/runs/${replay.id}/export`);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.origin, "live");
  assert.equal(exported.body.sourceRunId, source.id);
  assert.equal(calls, 0);
});
