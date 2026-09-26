import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cli = (...args) =>
  spawnSync(process.execPath, ["packages/cli/dist/index.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, TYPESAFE_API_KEY: "", PATHSMITH_ENABLE_LIVE: "" },
  });
test("CLI validate/run/compare write reports before their expected exit codes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathsmith-cli-"));
  const baseline = join(directory, "baseline.json"),
    candidate = join(directory, "candidate.json"),
    comparison = join(directory, "comparison.json");
  const common = [
    "--suite",
    "examples/support-routing/suite.json",
    "--profile",
    "examples/support-routing/mock.profile.json",
    "--mode",
    "mock",
    "--fixtures",
    "examples/support-routing/mock-fixtures.json",
  ];
  assert.equal(
    cli(
      "validate",
      "--workflow",
      "examples/support-routing/baseline.workflow.json",
    ).status,
    0,
  );
  assert.equal(
    cli(
      "run",
      "--workflow",
      "examples/support-routing/baseline.workflow.json",
      ...common,
      "--out",
      baseline,
    ).status,
    1,
  );
  assert.equal(
    cli(
      "run",
      "--workflow",
      "examples/support-routing/candidate.workflow.json",
      ...common,
      "--out",
      candidate,
    ).status,
    1,
  );
  assert.equal(
    cli(
      "compare",
      "--baseline",
      baseline,
      "--candidate",
      candidate,
      "--out",
      comparison,
    ).status,
    1,
  );
  const report = JSON.parse(await readFile(comparison, "utf8"));
  assert.equal(report.newAssertionRegressions, 2);
  assert.equal(report.assertionImprovements, 1);
  assert.equal(report.gate, "fail");
  const run = JSON.parse(await readFile(baseline, "utf8"));
  assert.equal(run.scenarios.flatMap((s) => s.exchanges).length, 16);
  assert.equal(run.scenarios[0].exchanges[0].origin, "synthetic");
  const invalid = join(directory, "invalid.json");
  await writeFile(invalid, '{"formatVersion":"99.0"}');
  assert.equal(cli("validate", "--workflow", invalid).status, 2);
  const errorPath = join(directory, "error.json");
  assert.equal(
    cli("run", "--workflow", invalid, ...common, "--out", errorPath).status,
    2,
  );
  assert.equal(
    JSON.parse(await readFile(errorPath, "utf8")).error.code,
    "WORKFLOW_INVALID",
  );
  assert.equal(
    cli(
      "compare",
      "--baseline",
      "examples/support-routing/expected-results.json",
      "--candidate",
      candidate,
    ).status,
    2,
  );
  assert.equal(
    cli(
      "run",
      "--workflow",
      "examples/support-routing/baseline.workflow.json",
      ...common.filter((v, i) => i !== 4 && i !== 5),
      "--mode",
      "live",
    ).status,
    2,
  );
});
