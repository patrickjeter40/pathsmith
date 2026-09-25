import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
const directory = ".pathsmith/reports";
await mkdir(directory, { recursive: true });
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
const commands = [
  ["validate", "--workflow", "examples/support-routing/baseline.workflow.json"],
  [
    "run",
    "--workflow",
    "examples/support-routing/baseline.workflow.json",
    ...common,
    "--out",
    `${directory}/baseline.json`,
  ],
  [
    "run",
    "--workflow",
    "examples/support-routing/candidate.workflow.json",
    ...common,
    "--out",
    `${directory}/candidate.json`,
  ],
  [
    "compare",
    "--baseline",
    `${directory}/baseline.json`,
    "--candidate",
    `${directory}/candidate.json`,
    "--out",
    `${directory}/comparison.json`,
  ],
];
for (const args of commands) {
  const result = spawnSync(
    process.execPath,
    ["packages/cli/dist/index.js", ...args],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  const expected = args[0] === "validate" ? 0 : 1;
  if (result.status !== expected)
    throw new Error(`${args[0]} exited ${result.status}, expected ${expected}`);
  console.log(`${args[0]}: expected exit ${expected}`);
}
console.log(
  `Actual reports written to ${directory}. Both suites intentionally contain assertion failures.`,
);
