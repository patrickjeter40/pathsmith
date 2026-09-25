#!/usr/bin/env node
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  parseJson,
  validateProfile,
  validateSuite,
  validateWorkflow,
  type ExecutionProfile,
  type Suite,
  type Workflow,
} from "@pathsmith/contracts";
import {
  assertValid,
  hash,
  workflowHashes,
  PathsmithError,
  toExecutionError,
  type Bindings,
} from "@pathsmith/core";
import {
  compareRuns,
  runSuite,
  MAX_REPORT_BYTES,
  type RunReport,
} from "@pathsmith/evaluation";
import { createMockProvider } from "@pathsmith/provider-mock";

const help = `Pathsmith 0.1 — offline execution foundation (M0–M1)
  validate --workflow <file> [--suite <file>] [--out <file>]
  run --workflow <file> --suite <file> --profile <file>
      --mode mock --fixtures <file> [--scenarios id,id] [--concurrency 1..16] --out <file>
  compare --baseline <report> --candidate <report> [--strict] --out <file>

Run artifacts contain inputs, questions, and responses. Keep them private.
Live calls and strict recorded replay are deferred to M4. No live fallback exists.
Exit: 0 success, 1 assertion/gate failure, 2 invalid/incomplete/execution failure.
`;
const optionNames = [
  "workflow",
  "suite",
  "profile",
  "mode",
  "fixtures",
  "out",
  "baseline",
  "candidate",
  "scenarios",
  "concurrency",
];
let outputPath: string | undefined;
const cancel = new AbortController();
process.once("SIGINT", () => cancel.abort());
async function read(
  path: string,
  maxBytes = 8 * 1024 * 1024,
): Promise<unknown> {
  if ((await stat(path)).size > maxBytes)
    throw new PathsmithError("ARTIFACT_INVALID", "Import exceeds byte limit");
  const buffer = await readFile(path);
  if (buffer.byteLength > maxBytes)
    throw new PathsmithError("ARTIFACT_INVALID", "Import exceeds byte limit");
  return parseJson(buffer.toString("utf8"), maxBytes);
}
async function output(value: unknown) {
  const content = JSON.stringify(value) + "\n";
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, { mode: 0o600 });
  } else process.stdout.write(content);
}
function report(value: unknown): RunReport {
  const r = value as RunReport;
  if (
    !r ||
    r.formatVersion !== "0.1" ||
    r.artifactType !== "pathsmith_run" ||
    !Array.isArray(r.scenarios) ||
    !Array.isArray(r.selectedScenarioIds) ||
    !r.selectedScenarioIds.length ||
    new Set(r.selectedScenarioIds).size !== r.selectedScenarioIds.length ||
    r.mode !== "mock"
  )
    throw new PathsmithError(
      "ARTIFACT_INVALID",
      "Expected a Pathsmith run report",
    );
  assertValid(validateWorkflow(r.workflow), "ARTIFACT_INVALID");
  assertValid(
    validateSuite(r.suite, r.workflow, r.selectedScenarioIds),
    "ARTIFACT_INVALID",
  );
  if (
    hash(r.suite) !== r.suiteSnapshotHash ||
    hash(r.workflow) !== r.artifactHash ||
    workflowHashes(r.workflow).workflowSemanticHash !== r.workflowSemanticHash
  )
    throw new PathsmithError("ARTIFACT_INVALID", "Snapshot hash mismatch");
  for (const s of r.scenarios) {
    const scenario = r.suite.scenarios.find((c) => c.id === s.scenarioId);
    if (
      !scenario ||
      hash(s.input) !== hash(scenario.input) ||
      !["completed", "failed", "canceled"].includes(s.status) ||
      !["passed", "failed", "not_evaluated"].includes(s.assertionStatus) ||
      !Array.isArray(s.selectedEdges) ||
      !Array.isArray(s.assertions) ||
      (s.status === "completed" && !s.result)
    )
      throw new PathsmithError("ARTIFACT_INVALID", "Invalid scenario result");
  }
  return r;
}
async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      ...Object.fromEntries(
        optionNames.map((name) => [name, { type: "string" as const }]),
      ),
      strict: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const values: Record<string, string | boolean | undefined> = parsed.values;
  outputPath = values.out as string | undefined;
  const command = parsed.positionals[0];
  if (values.help || !command) {
    process.stdout.write(help);
    return;
  }
  if (parsed.positionals.length !== 1)
    throw new PathsmithError("CLI_INVALID", "Unexpected positional arguments");
  const required = (key: string): string => {
    const value = values[key];
    if (typeof value !== "string" || !value)
      throw new PathsmithError("CLI_INVALID", `Missing --${key}`);
    return value;
  };
  if (command === "validate") {
    const workflow = await read(required("workflow"), 512 * 1024),
      validation = validateWorkflow(workflow);
    if (validation.valid && values.suite) {
      const suiteValidation = validateSuite(
        await read(required("suite")),
        workflow as Workflow,
      );
      validation.diagnostics.push(...suiteValidation.diagnostics);
      validation.valid &&= suiteValidation.valid;
    }
    await output(validation);
    process.exitCode = validation.valid ? 0 : 2;
  } else if (command === "run") {
    const workflow = await read(required("workflow"), 512 * 1024),
      suite = await read(required("suite")),
      profile = await read(required("profile"));
    assertValid(validateWorkflow(workflow));
    assertValid(
      validateProfile(profile, workflow as Workflow),
      "PROFILE_INVALID",
    );
    if (values.mode && values.mode !== "mock")
      throw new PathsmithError(
        "PROVIDER_NOT_CONFIGURED",
        "M1 implements mock mode only; replay and live are deferred to M4",
      );
    const adapter = createMockProvider(await read(required("fixtures"))),
      bindings: Bindings = {};
    for (const [name, b] of Object.entries(
      (profile as ExecutionProfile).bindings,
    ))
      bindings[name] = { ...b, adapter };
    const run = await runSuite({
      workflow: workflow as Workflow,
      suite: suite as Suite,
      bindings,
      mode: "mock",
      selectedScenarioIds:
        typeof values.scenarios === "string"
          ? values.scenarios.split(",")
          : undefined,
      concurrency: values.concurrency ? Number(values.concurrency) : undefined,
      signal: cancel.signal,
    });
    await output(run);
    process.stderr.write(JSON.stringify(run.summary) + "\n");
    process.exitCode =
      run.status !== "completed" ? 2 : run.summary.assertionFailed ? 1 : 0;
  } else if (command === "compare") {
    const baseline = report(await read(required("baseline"), MAX_REPORT_BYTES)),
      candidate = report(await read(required("candidate"), MAX_REPORT_BYTES)),
      comparison = compareRuns(baseline, candidate, {
        strict: values.strict === true,
      });
    await output(comparison);
    process.exitCode =
      comparison.gate === "inconclusive"
        ? 2
        : comparison.gate === "fail"
          ? 1
          : 0;
  } else throw new PathsmithError("CLI_INVALID", `Unknown command ${command}`);
}
try {
  await main();
} catch (error) {
  await output({ error: toExecutionError(error) });
  process.exitCode = 2;
}
