import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { candidate, minimal, literal } from "./helpers.mjs";
const suitePath = "examples/support-routing/suite.json";
const basePath = "examples/support-routing/baseline.workflow.json";
const candidatePath = "examples/support-routing/candidate.workflow.json";
const profilePath = "examples/support-routing/mock.profile.json";
const fixturesPath = "examples/support-routing/mock-fixtures.json";
const canary = "cli-canary-secret-value";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), "pathsmith-cli-m4-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const guard = join(directory, "offline.mjs");
  await writeFile(
    guard,
    'globalThis.fetch = () => { throw new Error("Unexpected network is forbidden"); };',
  );
  const cli = (args, { key = "", preload = guard } = {}) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(preload).href,
        "packages/cli/dist/index.js",
        ...args,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TYPESAFE_API_KEY: key,
          PATHSMITH_ENABLE_LIVE: "",
        },
      },
    );
  const sourcePath = join(directory, "source.json");
  const baseline = cli([
    "run",
    "--workflow",
    basePath,
    "--suite",
    suitePath,
    "--profile",
    profilePath,
    "--fixtures",
    fixturesPath,
    "--out",
    sourcePath,
  ]);
  assert.equal(baseline.status, 1, baseline.stdout + baseline.stderr);
  return { directory, cli, sourcePath };
}
const replayArgs = (env, out, workflow = candidatePath) => [
  "run",
  "--workflow",
  workflow,
  "--suite",
  suitePath,
  "--mode",
  "replay",
  "--source",
  env.sourcePath,
  "--out",
  out,
];

test("M4 CLI replay derives profile, reports14 reused/zeroHTTP and compares2 regressions/1 improvement", async (t) => {
  const env = await setup(t),
    out = join(env.directory, "replay.json"),
    comparison = join(env.directory, "comparison.json");
  const replayed = env.cli(replayArgs(env, out), { key: canary });
  assert.equal(replayed.status, 1, replayed.stdout + replayed.stderr);
  const report = await json(out),
    source = await json(env.sourcePath);
  assert.equal(report.mode, "replay");
  assert.equal(report.sourceRunId, source.id);
  assert.equal(report.origin, "synthetic");
  assert.deepEqual(report.profile, source.profile);
  assert.equal(report.summary.replayedJudgments, 14);
  assert.equal(report.summary.actualHttpAttempts, 0);
  assert.deepEqual(report.summary.usage, { inputTokens: 0, outputTokens: 0 });
  assert.equal(
    env.cli([
      "compare",
      "--baseline",
      env.sourcePath,
      "--candidate",
      out,
      "--out",
      comparison,
    ]).status,
    1,
  );
  const compared = await json(comparison);
  assert.equal(compared.newAssertionRegressions, 2);
  assert.equal(compared.assertionImprovements, 1);
  assert.equal(JSON.stringify(report).includes(canary), false);
  const matching = env.cli([...replayArgs(env, out), "--profile", profilePath]);
  assert.equal(matching.status, 1);
  const conflicting = join(env.directory, "profile.json"),
    profile = structuredClone(source.profile);
  profile.bindings.decisions.model = "different";
  await writeFile(conflicting, JSON.stringify(profile));
  assert.equal(
    env.cli([...replayArgs(env, out), "--profile", conflicting]).status,
    2,
  );
  assert.equal((await json(out)).error.code, "REPLAY_PROFILE_MISMATCH");
});

test("M4 CLI replay miss writes failed report before exit2; malformed sources fail safely", async (t) => {
  const env = await setup(t),
    out = join(env.directory, "result.json"),
    workflowPath = join(env.directory, "changed.workflow.json");
  const changed = structuredClone(candidate);
  Object.values(
    changed.nodes.find((n) => n.kind === "judgment").questions,
  )[0].instructions += " changed";
  await writeFile(workflowPath, JSON.stringify(changed));
  const failure = env.cli(replayArgs(env, out, workflowPath));
  assert.equal(failure.status, 2);
  const report = await json(out);
  assert.equal(report.status, "failed");
  assert.equal(report.scenarios[0].error.code, "REPLAY_MISS");
  assert.equal(report.summary.actualHttpAttempts, 0);
  const bad = join(env.directory, "bad.json");
  const original = await json(env.sourcePath);
  for (const mutation of [
    "hash",
    "node",
    "scope",
    "fingerprint",
    "summary",
    "duplicate",
    "profile",
    "origin",
    "status",
  ]) {
    const source = structuredClone(original);
    if (mutation === "hash") source.workflowSemanticHash = "bad";
    if (mutation === "node")
      source.scenarios[0].exchanges[0].nodeId = "never-recorded";
    if (mutation === "scope")
      source.scenarios[0].exchanges[0].scenarioId =
        source.scenarios[1].scenarioId;
    if (mutation === "fingerprint")
      source.scenarios[0].exchanges[0].fingerprint = "bad";
    if (mutation === "summary") source.summary.logicalJudgments = 999;
    if (mutation === "duplicate") source.scenarios[1] = source.scenarios[0];
    if (mutation === "profile")
      source.profile.bindings.decisions.model = "other";
    if (mutation === "origin") source.origin = "live";
    if (mutation === "status") source.status = "failed";
    await writeFile(bad, JSON.stringify(source));
    const result = env.cli(replayArgs({ ...env, sourcePath: bad }, out));
    assert.equal(result.status, 2, mutation);
    assert.equal((await json(out)).error.code, "ARTIFACT_INVALID", mutation);
  }
  const oracle = env.cli(
    replayArgs(
      { ...env, sourcePath: "examples/support-routing/expected-results.json" },
      out,
    ),
  );
  assert.equal(oracle.status, 2);
  assert.equal((await json(out)).error.code, "ARTIFACT_INVALID");
});

test("M4 CLI accepts legacy mock recording fields and rejects bounded import/option violations", async (t) => {
  const env = await setup(t),
    out = join(env.directory, "result.json"),
    legacyPath = join(env.directory, "legacy.json"),
    legacy = await json(env.sourcePath);
  delete legacy.httpAttemptLimit;
  delete legacy.summary.historicalUsage;
  for (const scenario of legacy.scenarios) {
    delete scenario.attempts;
    delete scenario.historicalUsage;
    for (const exchange of scenario.exchanges) delete exchange.usage;
  }
  await writeFile(legacyPath, JSON.stringify(legacy));
  assert.equal(
    env.cli(replayArgs({ ...env, sourcePath: legacyPath }, out)).status,
    1,
  );
  for (const flags of [
    ["--fixtures", fixturesPath],
    ["--enable-live"],
    ["--http-attempt-limit", "2001"],
    ["--concurrency", "17"],
  ]) {
    assert.equal(env.cli([...replayArgs(env, out), ...flags]).status, 2);
    assert.ok((await json(out)).error);
  }
  const huge = join(env.directory, "huge.json");
  await writeFile(huge, " ".repeat(8 * 1024 * 1024 + 1));
  assert.equal(
    env.cli(replayArgs({ ...env, sourcePath: huge }, out)).status,
    2,
  );
  assert.equal((await json(out)).error.code, "ARTIFACT_INVALID");
});

test("M4 CLI live requires enable flag and key, never exposing credential diagnostics", async (t) => {
  const env = await setup(t),
    out = join(env.directory, "live.json"),
    profilePath = join(env.directory, "live-profile.json");
  await writeFile(
    profilePath,
    JSON.stringify({
      formatVersion: "0.1",
      bindings: { decisions: { providerId: "jev", model: "jev-latest" } },
    }),
  );
  const args = [
    "run",
    "--workflow",
    basePath,
    "--suite",
    suitePath,
    "--profile",
    profilePath,
    "--mode",
    "live",
    "--out",
    out,
  ];
  let result = env.cli(args, { key: canary });
  assert.equal(result.status, 2);
  assert.equal((await json(out)).error.code, "LIVE_DISABLED");
  assert.equal(
    (result.stdout + result.stderr + (await readFile(out, "utf8"))).includes(
      canary,
    ),
    false,
  );
  result = env.cli([...args, "--enable-live"]);
  assert.equal(result.status, 2);
  assert.equal((await json(out)).error.code, "PROVIDER_NOT_CONFIGURED");
});

test("M4 CLI live path and comparisons work with injected transport; replay preserves live provenance offline", async (t) => {
  const env = await setup(t),
    source = join(env.directory, "live.json"),
    out = join(env.directory, "replay.json"),
    profile = join(env.directory, "live-profile.json"),
    workflowPath = join(env.directory, "workflow.json"),
    suite = join(env.directory, "suite.json"),
    transport = join(env.directory, "transport.mjs");
  const workflow = minimal();
  workflow.bindings = ["decisions"];
  workflow.nodes.push({
    id: "judge",
    kind: "judgment",
    label: "Judge",
    binding: "decisions",
    state: literal("a message"),
    questions: { safe: { kind: "binary", instructions: "Safe?" } },
  });
  workflow.edges[0].target = "judge";
  workflow.edges.push({
    id: "judge_next",
    source: "judge",
    port: "next",
    target: "finish",
  });
  await writeFile(workflowPath, JSON.stringify(workflow));
  await writeFile(
    profile,
    JSON.stringify({
      formatVersion: "0.1",
      bindings: { decisions: { providerId: "jev", model: "jev-latest" } },
    }),
  );
  await writeFile(
    suite,
    JSON.stringify({
      formatVersion: "0.1",
      id: "cli_live",
      name: "CLI",
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
    }),
  );
  await writeFile(
    transport,
    'globalThis.fetch = async () => new Response(JSON.stringify({model:"jev-mocked-version", answers:{safe:{type:"noul",noul:0.8}}, usage:{input_tokens:12,output_tokens:2}}));',
  );
  const live = env.cli(
    [
      "run",
      "--workflow",
      workflowPath,
      "--suite",
      suite,
      "--profile",
      profile,
      "--mode",
      "live",
      "--enable-live",
      "--http-attempt-limit",
      "1",
      "--out",
      source,
    ],
    { key: canary, preload: transport },
  );
  assert.equal(live.status, 0, live.stdout + live.stderr);
  const report = await json(source);
  assert.equal(report.summary.actualHttpAttempts, 1);
  assert.equal(report.origin, "live");
  assert.equal(JSON.stringify(report).includes(canary), false);
  const replayed = env.cli([
    "run",
    "--workflow",
    workflowPath,
    "--suite",
    suite,
    "--mode",
    "replay",
    "--source",
    source,
    "--out",
    out,
  ]);
  assert.equal(replayed.status, 0, replayed.stdout + replayed.stderr);
  const replayReport = await json(out);
  assert.equal(replayReport.origin, "live");
  assert.equal(replayReport.summary.actualHttpAttempts, 0);
  assert.deepEqual(replayReport.summary.historicalUsage, {
    inputTokens: 12,
    outputTokens: 2,
  });
  assert.equal(
    env.cli(["compare", "--baseline", source, "--candidate", out]).status,
    0,
  );
});
