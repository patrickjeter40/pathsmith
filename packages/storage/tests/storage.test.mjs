import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import Database from "better-sqlite3";
import { openStorage } from "../dist/index.js";
import { runSuite } from "@pathsmith/evaluation";
import { createMockProvider } from "@pathsmith/provider-mock";

const read = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../examples/gaming/${name}`, import.meta.url),
      "utf8",
    ),
  );
const workflow = read("workflow.json"),
  suite = read("suite.json"),
  fixtures = read("mock-fixtures.json"),
  profile = read("mock.profile.json");
function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "pathsmith-storage-"));
  let storage = openStorage({ dataDir });
  t.after(() => {
    storage.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    dataDir,
    get storage() {
      return storage;
    },
    reopen() {
      storage.close();
      storage = openStorage({ dataDir });
      return storage;
    },
  };
}
function seed(storage) {
  const ctx = storage.localContext,
    project = storage.createProject(ctx, "Gaming");
  const draft = storage.createWorkflow(ctx, project.id, {
    name: "Gaming",
    definition: workflow,
    layout: { x: 10 },
  });
  const workflowVersion = storage.publishWorkflowVersion(ctx, draft.id, 1);
  const suiteDraft = storage.createSuite(ctx, project.id, {
    name: "Gaming cases",
    definition: suite,
  });
  const suiteVersion = storage.publishSuiteVersion(
    ctx,
    suiteDraft.id,
    workflowVersion.id,
    1,
  );
  const queue = () =>
    storage.queueRun(ctx, {
      workflowVersionId: workflowVersion.id,
      suiteVersionId: suiteVersion.id,
      profile,
      fixtures,
    });
  return {
    ctx,
    project,
    draft,
    workflowVersion,
    suiteDraft,
    suiteVersion,
    queue,
  };
}
async function execute(storage, run, onScenario) {
  const snapshot = run.snapshot,
    adapter = createMockProvider(snapshot.fixtures);
  return runSuite({
    workflow: snapshot.workflow,
    suite: snapshot.suite,
    bindings: Object.fromEntries(
      Object.entries(snapshot.profile.bindings).map(([name, b]) => [
        name,
        { ...b, adapter },
      ]),
    ),
    mode: "mock",
    selectedScenarioIds: snapshot.selectedScenarioIds,
    limits: snapshot.limits,
    concurrency: snapshot.concurrency,
    runId: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    onScenario,
  });
}

test("migrations, revision conflicts, immutable snapshots, and workspace isolation", (t) => {
  const env = setup(t),
    storage = env.storage,
    data = seed(storage),
    { ctx, draft, workflowVersion } = data;
  assert.equal(storage.schemaVersion, 1);
  assert.throws(() => openStorage({ dataDir: env.dataDir }), {
    code: "STORAGE_LOCKED",
  });
  assert.throws(() => storage.getWorkflow({ workspaceId: "other" }, draft.id), {
    code: "NOT_FOUND",
  });
  assert.throws(
    () =>
      storage.createWorkflow({ workspaceId: "other" }, data.project.id, {
        name: "Wrong",
      }),
    { code: "NOT_FOUND" },
  );
  const updated = storage.saveWorkflowDraft(ctx, draft.id, {
    expectedRevision: 1,
    definition: workflow,
    layout: { x: 20 },
  });
  assert.equal(updated.draftRevision, 2);
  assert.throws(
    () =>
      storage.saveWorkflowDraft(ctx, draft.id, {
        expectedRevision: 1,
        definition: {},
      }),
    { code: "DRAFT_CONFLICT" },
  );
  const second = storage.publishWorkflowVersion(ctx, draft.id, 2);
  assert.equal(
    second.workflowSemanticHash,
    workflowVersion.workflowSemanticHash,
  );
  assert.deepEqual(storage.getWorkflowVersion(ctx, workflowVersion.id).layout, {
    x: 10,
  });
  storage.saveWorkflowDraft(ctx, draft.id, {
    expectedRevision: 2,
    definition: { nodes: [] },
  });
  assert.ok(storage.getWorkflow(ctx, draft.id).diagnostics.length);
  assert.throws(() => storage.publishWorkflowVersion(ctx, draft.id), {
    code: "WORKFLOW_INVALID",
  });
  assert.equal(env.reopen().getWorkflow(ctx, draft.id).draftRevision, 3);
  assert.equal(
    env.storage.getWorkflowVersion(ctx, workflowVersion.id).definition.id,
    workflow.id,
  );
});

test("queue validation, foreign keys, incremental results, trace persistence, and final report", async (t) => {
  const env = setup(t),
    storage = env.storage,
    { ctx, project, workflowVersion, suiteVersion, queue } = seed(storage);
  assert.throws(
    () =>
      storage.queueRun(ctx, {
        workflowVersionId: workflowVersion.id,
        suiteVersionId: suiteVersion.id,
        profile,
        fixtures,
        selectedScenarioIds: ["missing"],
      }),
    { code: "SUITE_INVALID" },
  );
  assert.throws(
    () =>
      storage.queueRun(ctx, {
        workflowVersionId: workflowVersion.id,
        suiteVersionId: suiteVersion.id,
        profile: { ...profile, secret: "no" },
        fixtures,
      }),
    { code: "PROVIDER_NOT_CONFIGURED" },
  );
  const otherProject = storage.createProject(ctx, "Other"),
    otherSuite = storage.createSuite(ctx, otherProject.id, {
      name: "Other",
      definition: suite,
    });
  assert.throws(
    () => storage.publishSuiteVersion(ctx, otherSuite.id, workflowVersion.id),
    { code: "NOT_FOUND" },
  );
  const run = queue();
  assert.equal(run.status, "queued");
  assert.equal(storage.claimNextRun(ctx).id, run.id);
  assert.equal(storage.claimNextRun(ctx), null);
  const report = await execute(storage, run, (result) =>
    storage.appendScenarioResult(ctx, run.id, result),
  );
  assert.equal(storage.getRun(ctx, run.id).completedScenarios, 9);
  assert.throws(
    () =>
      storage.finishRun(ctx, run.id, {
        ...report,
        profile: { ...profile, bindings: {} },
      }),
    { code: "INVALID_REQUEST" },
  );
  storage.finishRun(ctx, run.id, report);
  const page = storage.listScenarioRuns(ctx, run.id, { offset: 1, limit: 2 });
  assert.equal(page.total, 9);
  assert.equal(page.items.length, 2);
  const trace = storage.getScenarioTrace(ctx, page.items[0].id);
  assert.ok(trace.result.events.length);
  assert.ok(trace.result.exchanges.length);
  assert.throws(
    () => storage.getScenarioTrace({ workspaceId: "other" }, trace.id),
    { code: "NOT_FOUND" },
  );
  const raw = new Database(join(env.dataDir, "pathsmith.sqlite"));
  try {
    raw.pragma("foreign_keys=ON");
    assert.throws(
      () =>
        raw
          .prepare("UPDATE workflow_versions SET record='{}' WHERE id=?")
          .run(workflowVersion.id),
      /Immutable version/,
    );
    assert.throws(
      () => raw.prepare("UPDATE runs SET snapshot='{}' WHERE id=?").run(run.id),
      /Immutable run snapshot/,
    );
    assert.equal(
      raw.prepare("SELECT count(*) AS count FROM node_traces").get().count,
      report.scenarios.reduce((n, item) => n + item.events.length, 0),
    );
    assert.equal(
      raw.prepare("SELECT count(*) AS count FROM provider_attempts").get()
        .count,
      report.scenarios.reduce((n, item) => n + item.exchanges.length, 0),
    );
    assert.throws(
      () =>
        raw
          .prepare("INSERT INTO workflows VALUES ('invalid','other',?,1,'{}')")
          .run(project.id),
      /FOREIGN KEY/,
    );
  } finally {
    raw.close();
  }
  assert.equal(
    env.reopen().getRun(ctx, run.id).report.summary.assertionPassed,
    9,
  );
  env.storage.deleteRun(ctx, run.id);
  assert.throws(() => env.storage.getScenarioTrace(ctx, trace.id), {
    code: "NOT_FOUND",
  });
  env.storage.deleteProject(ctx, project.id);
  assert.throws(() => env.storage.getWorkflowVersion(ctx, workflowVersion.id), {
    code: "NOT_FOUND",
  });
});

test("restart interrupts every unfinished status, retains completed cases, and does not claim jobs", async (t) => {
  const env = setup(t),
    storage = env.storage,
    { ctx, queue } = seed(storage);
  const running = queue();
  storage.claimNextRun(ctx);
  const report = await execute(storage, running);
  storage.appendScenarioResult(ctx, running.id, report.scenarios[0]);
  const queued = queue();
  assert.equal(storage.requestCancellation(ctx, running.id).active, true);
  assert.equal(storage.requestCancellation(ctx, running.id).active, true);
  const canceled = queue();
  assert.equal(
    storage.requestCancellation(ctx, canceled.id).run.status,
    "canceled",
  );
  assert.equal(storage.requestCancellation(ctx, canceled.id).active, false);
  const restarted = env.reopen();
  for (const id of [running.id, queued.id]) {
    assert.equal(restarted.getRun(ctx, id).status, "interrupted");
    assert.equal(restarted.getRun(ctx, id).error.code, "RUN_INTERRUPTED");
  }
  assert.equal(restarted.getRun(ctx, running.id).completedScenarios, 1);
  assert.equal(restarted.getRun(ctx, canceled.id).status, "canceled");
  assert.equal(restarted.claimNextRun(ctx), null);
});

test("a killed process releases the OS-held data-directory lock", async (t) => {
  const env = setup(t);
  env.storage.close();
  const script = `import {openStorage} from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)}; openStorage({dataDir:process.argv[1]}); process.stdout.write('ready'); setInterval(()=>{},1000);`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", script, env.dataDir],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  const [ready] = await once(child.stdout, "data");
  assert.equal(ready.toString(), "ready");
  assert.throws(() => openStorage({ dataDir: env.dataDir }), {
    code: "STORAGE_LOCKED",
  });
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  assert.equal(env.reopen().schemaVersion, 1);
});
