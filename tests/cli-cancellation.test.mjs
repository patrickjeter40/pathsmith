import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runSuite, compareRuns } from "@pathsmith/evaluation";
import { createJevProvider } from "../packages/provider-jev/dist/index.js";
import { createReplayBindings } from "../packages/provider-replay/dist/index.js";
import { readRunReport } from "../packages/cli/dist/report.js";
import { minimal, literal } from "./helpers.mjs";
const suite = {
  formatVersion: "0.1",
  id: "cancellation_suite",
  name: "Cancellation",
  description: "Offline report boundaries",
  scenarios: ["one", "two"].map((id) => ({
    id,
    name: id,
    tags: [],
    input: { value: 1 },
    expected: { allowedOutcomes: ["done"] },
  })),
};
function workflow() {
  const result = minimal();
  result.bindings = ["decisions"];
  result.nodes.push({
    id: "judge",
    label: "Judge",
    kind: "judgment",
    binding: "decisions",
    state: literal("message"),
    questions: { safe: { kind: "binary", instructions: "Safe?" } },
  });
  result.edges[0].target = "judge";
  result.edges.push({
    id: "judge_next",
    source: "judge",
    port: "next",
    target: "finish",
  });
  return result;
}
const roundTrip = (report) => readRunReport(JSON.parse(JSON.stringify(report)));

test("canceled live reports distinguish zero undispatched usage from unknown dispatched usage and remain importable", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pathsmith-canceled-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const state of ["before-dispatch", "known", "unknown"]) {
    const controller = new AbortController();
    let calls = 0;
    if (state === "before-dispatch") controller.abort();
    const adapter = createJevProvider({
      apiKey: "offline-cancellation-test",
      fetch: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            model: "jev-test",
            answers: { safe: { type: "noul", noul: 0.8 } },
            ...(state === "known"
              ? { usage: { input_tokens: 12, output_tokens: 2 } }
              : {}),
          }),
        );
      },
    });
    const report = await runSuite({
      workflow: workflow(),
      suite,
      mode: "live",
      bindings: {
        decisions: { providerId: "jev", model: "jev-latest", adapter },
      },
      signal: controller.signal,
      concurrency: 1,
      onScenario: () => controller.abort(),
    });
    assert.equal(report.status, "canceled");
    assert.equal(calls, state === "before-dispatch" ? 0 : 1);
    for (const scenario of report.scenarios.filter((s) => !s.started))
      assert.deepEqual(scenario.usage, { inputTokens: 0, outputTokens: 0 });
    assert.deepEqual(
      report.summary.usage,
      state === "before-dispatch"
        ? { inputTokens: 0, outputTokens: 0 }
        : state === "known"
          ? { inputTokens: 12, outputTokens: 2 }
          : null,
    );
    await assert.rejects(
      () =>
        runSuite({
          workflow: workflow(),
          suite,
          mode: "replay",
          bindings: createReplayBindings(report),
          sourceOrigin: "synthetic",
        }),
      { code: "PROVIDER_NOT_CONFIGURED" },
    );
    assert.equal(roundTrip(report).status, "canceled");
    assert.equal(compareRuns(report, report).gate, "inconclusive");
    const path = join(directory, `${state}.json`),
      out = join(directory, `${state}-comparison.json`);
    await writeFile(path, JSON.stringify(report));
    const cli = spawnSync(
      process.execPath,
      [
        "packages/cli/dist/index.js",
        "compare",
        "--baseline",
        path,
        "--candidate",
        path,
        "--out",
        out,
      ],
      { encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "" } },
    );
    assert.equal(cli.status, 2);
    assert.equal(JSON.parse(await readFile(out, "utf8")).gate, "inconclusive");
    const replay = await runSuite({
      workflow: workflow(),
      suite,
      mode: "replay",
      bindings: createReplayBindings(report),
    });
    assert.equal(replay.status, "failed");
    assert.equal(replay.scenarios[1].error.code, "REPLAY_MISS");
    assert.equal(replay.summary.actualHttpAttempts, 0);
  }
});

test("zero-judgment live and replay reports preserve origin with empty profiles", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pathsmith-empty-profile-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const w = minimal();
  for (const mode of ["mock", "live"]) {
    const source = await runSuite({ workflow: w, suite, mode, bindings: {} });
    assert.equal(source.origin, mode === "live" ? "live" : "synthetic");
    assert.equal(roundTrip(source).status, "completed");
    await assert.rejects(
      () =>
        runSuite({
          workflow: w,
          suite,
          mode: "replay",
          bindings: {},
          sourceRunId: source.id,
        }),
      { code: "PROVIDER_NOT_CONFIGURED" },
    );
    const replay = await runSuite({
      workflow: w,
      suite,
      mode: "replay",
      bindings: createReplayBindings(source),
      sourceRunId: source.id,
      sourceOrigin: source.origin,
    });
    assert.equal(replay.origin, source.origin);
    assert.equal(roundTrip(replay).status, "completed");
    assert.equal(compareRuns(source, replay).gate, "pass");
    assert.equal(replay.summary.actualHttpAttempts, 0);
    const sourcePath = join(directory, `${mode}.json`),
      workflowPath = join(directory, "workflow.json"),
      suitePath = join(directory, "suite.json"),
      out = join(directory, `${mode}-replay.json`);
    await writeFile(sourcePath, JSON.stringify(source));
    await writeFile(workflowPath, JSON.stringify(w));
    await writeFile(suitePath, JSON.stringify(suite));
    const cli = spawnSync(
      process.execPath,
      [
        "packages/cli/dist/index.js",
        "run",
        "--mode",
        "replay",
        "--source",
        sourcePath,
        "--workflow",
        workflowPath,
        "--suite",
        suitePath,
        "--out",
        out,
      ],
      { encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "" } },
    );
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.equal(JSON.parse(await readFile(out, "utf8")).origin, source.origin);
  }
});
