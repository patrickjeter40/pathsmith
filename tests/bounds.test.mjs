import test from "node:test";
import assert from "node:assert/strict";
import { cpus, platform, arch } from "node:os";
import { mkdtemp, writeFile, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runSuite } from "@pathsmith/evaluation";
import { minimal, literal, ref } from "./helpers.mjs";
test("100-node / 1,000-scenario deterministic bounds execute without network", async (t) => {
  const workflow = minimal();
  workflow.nodes = [
    workflow.nodes[0],
    ...Array.from({ length: 98 }, (_, i) => ({
      id: `step_${i}`,
      kind: "transform",
      label: `Step ${i}`,
      value: {
        op: "add",
        left: i === 0 ? ref("input", "value") : ref("outputs", `step_${i - 1}`),
        right: literal(1),
      },
    })),
    { ...workflow.nodes[1], value: ref("outputs", "step_97") },
  ];
  workflow.edges = workflow.nodes.slice(0, -1).map((n, i) => ({
    id: `edge_${i}`,
    source: n.id,
    port: "next",
    target: workflow.nodes[i + 1].id,
  }));
  const suite = {
    formatVersion: "0.1",
    id: "bounds",
    name: "Bounds",
    description: "Generated deterministic fixtures",
    scenarios: Array.from({ length: 1000 }, (_, i) => ({
      id: `scenario_${i}`,
      name: `Scenario ${i}`,
      tags: [],
      input: { value: i },
      expected: {
        allowedOutcomes: ["done"],
        assertions: [
          { op: "eq", left: ref("result", "value"), right: literal(i + 98) },
        ],
      },
    })),
  };
  const started = performance.now();
  const report = await runSuite({
    workflow,
    suite,
    bindings: {},
    mode: "mock",
  });
  assert.equal(report.summary.completed, 1000);
  assert.equal(report.summary.assertionPassed, 1000);
  assert.equal(report.summary.actualHttpAttempts, 0);
  assert.equal(report.coverage.branchCoverage, null);
  assert.equal(report.coverage.edgesVisited, 99);
  const serialized = JSON.stringify(report);
  assert(
    Buffer.byteLength(serialized) > 8 * 1024 * 1024,
    "Exercise a real report beyond the suite import limit",
  );
  const directory = await mkdtemp(join(tmpdir(), "pathsmith-large-report-"));
  const path = join(directory, "run.json"),
    comparisonPath = join(directory, "comparison.json");
  try {
    await writeFile(path, serialized);
    const compared = spawnSync(
      process.execPath,
      [
        "packages/cli/dist/index.js",
        "compare",
        "--baseline",
        path,
        "--candidate",
        path,
        "--out",
        comparisonPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(compared.status, 0, compared.stdout + compared.stderr);
    assert.equal(
      JSON.parse(await readFile(comparisonPath, "utf8")).gate,
      "pass",
    );
  } finally {
    await unlink(path);
    await unlink(comparisonPath).catch(() => {});
    await rmdir(directory);
  }
  t.diagnostic(
    `${(performance.now() - started).toFixed(0)} ms; ${platform()} ${arch()}; ${cpus()[0].model}; Node ${process.version}`,
  );
});
