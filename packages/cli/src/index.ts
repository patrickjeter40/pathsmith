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
  canonicalize,
  type ExecutionMode,
  type ExecutionLimits,
  PathsmithError,
  toExecutionError,
  type Bindings,
} from "@pathsmith/core";
import { compareRuns, runSuite, MAX_REPORT_BYTES } from "@pathsmith/evaluation";
import { createMockProvider } from "@pathsmith/provider-mock";
import { createReplayBindings } from "@pathsmith/provider-replay";
import { createJevProvider } from "@pathsmith/provider-jev";
import { readRunReport } from "./report.js";

const help = `Pathsmith 0.1 ? local execution and recorded replay
  validate --workflow <file> [--suite <file>] [--out <file>]
  run --workflow <file> --suite <file> --out <file>
      --mode mock --profile <file> --fixtures <file>
      --mode replay --source <report> [--profile <matching-profile>]
      --mode live --profile <file> --enable-live
      [--scenarios id,id] [--concurrency 1..16] [--limits <file>]
      [--http-attempt-limit 1..30000]
  compare --baseline <report> --candidate <report> [--strict]
      [--accept-mixed-model] --out <file>

Mock is the default. Replay is offline and source-scoped, with no live fallback.
Live also requires TYPESAFE_API_KEY and sends state/questions to TypeSafe;
usage may be billed. The total HTTP attempt limit defaults to 200.
Run artifacts contain inputs, questions, and responses. Keep them private.
Source recording import limit: 256 MiB. Suite import limit: 8 MiB.
Exit: 0 success, 1 assertion/gate failure,
2 invalid/incomplete/execution failure. Available reports are written first.
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
  "source",
  "limits",
  "http-attempt-limit",
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
  try {
    return parseJson(buffer.toString("utf8"), maxBytes);
  } catch {
    throw new PathsmithError("ARTIFACT_INVALID", "Import must contain safe, valid JSON within its byte limit");
  }
}
async function output(value: unknown) {
  const content = JSON.stringify(value) + "\n";
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, { mode: 0o600 });
  } else process.stdout.write(content);
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
      "enable-live": { type: "boolean" },
      "accept-mixed-model": { type: "boolean" },
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
    const mode = (values.mode ?? "mock") as ExecutionMode;
    if (!["mock", "replay", "live"].includes(mode))
      throw new PathsmithError("CLI_INVALID", "Unknown execution mode");
    if (mode !== "live" && values["enable-live"])
      throw new PathsmithError(
        "CLI_INVALID",
        "--enable-live requires explicit live mode",
      );
    if (mode === "live" && values["enable-live"] !== true)
      throw new PathsmithError(
        "LIVE_DISABLED",
        "Live mode requires --enable-live",
      );
    if (
      (mode === "replay" && values.fixtures) ||
      (mode !== "replay" && values.source) ||
      (mode === "live" && values.fixtures)
    )
      throw new PathsmithError(
        "CLI_INVALID",
        "Conflicting mock, replay, or live options",
      );
    const workflow = await read(required("workflow"), 512 * 1024),
      suite = await read(required("suite"));
    const selectedScenarioIds =
      typeof values.scenarios === "string"
        ? values.scenarios.split(",")
        : undefined;
    assertValid(validateWorkflow(workflow));
    assertValid(
      validateSuite(suite, workflow as Workflow, selectedScenarioIds),
      "SUITE_INVALID",
    );
    const limits = values.limits
      ? ((await read(required("limits"))) as Partial<ExecutionLimits>)
      : undefined;
    if (
      limits !== undefined &&
      (!limits || typeof limits !== "object" || Array.isArray(limits))
    )
      throw new PathsmithError("CLI_INVALID", "Limits must be a JSON object");
    let bindings: Bindings;
    let sourceRunId: string | undefined;
    let sourceOrigin: "synthetic" | "live" | undefined;
    if (mode === "replay") {
      const source = readRunReport(await read(required("source"), MAX_REPORT_BYTES));
      if (values.profile) {
        const profile = await read(required("profile"));
        assertValid(
          validateProfile(profile, workflow as Workflow),
          "PROFILE_INVALID",
        );
        if (canonicalize(profile) !== canonicalize(source.profile))
          throw new PathsmithError(
            "REPLAY_PROFILE_MISMATCH",
            "Replay profile conflicts with the source recording",
          );
      }
      bindings = createReplayBindings(source);
      sourceRunId = source.id;
      sourceOrigin = source.origin;
    } else {
      const profile = await read(required("profile"));
      assertValid(
        validateProfile(profile, workflow as Workflow),
        "PROFILE_INVALID",
      );
      const adapter =
        mode === "live"
          ? createJevProvider({ apiKey: process.env.TYPESAFE_API_KEY ?? "" })
          : createMockProvider(await read(required("fixtures")));
      bindings = Object.fromEntries(
        Object.entries((profile as ExecutionProfile).bindings).map(
          ([name, binding]) => [name, { ...binding, adapter }],
        ),
      );
    }
    const run = await runSuite({
      workflow: workflow as Workflow,
      suite: suite as Suite,
      bindings,
      mode,
      sourceRunId,
      sourceOrigin,
      limits,
      httpAttemptLimit: values["http-attempt-limit"]
        ? Number(values["http-attempt-limit"])
        : undefined,
      selectedScenarioIds,
      concurrency: values.concurrency ? Number(values.concurrency) : undefined,
      signal: cancel.signal,
    });
    await output(run);
    process.stderr.write(JSON.stringify(run.summary) + "\n");
    process.exitCode =
      run.status !== "completed" ? 2 : run.summary.assertionFailed ? 1 : 0;
  } else if (command === "compare") {
    const baseline = readRunReport(
        await read(required("baseline"), MAX_REPORT_BYTES),
      ),
      candidate = readRunReport(
        await read(required("candidate"), MAX_REPORT_BYTES),
      ),
      comparison = compareRuns(baseline, candidate, {
        strict: values.strict === true,
        acceptMixedModel: values["accept-mixed-model"] === true,
      });
    await output(comparison);
    process.exitCode =
      comparison.gate === "inconclusive"
        ? 2
        : comparison.gate === "fail"
          ? 1
          : 0;
  } else throw new PathsmithError("CLI_INVALID", "Unknown command");
}
try {
  await main();
} catch (error) {
  await output({ error: toExecutionError(error) });
  process.exitCode = 2;
}
