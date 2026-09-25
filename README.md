# Pathsmith

Build, test, trace, and compare probabilistic decision workflows.

**Implemented: M0–M1**, the first delivery requested by the supplied [kickoff](pathsmith-design-pack/CODEX_KICKOFF.md). This is a working offline execution foundation with a browser shell, not the completed POC. The [design](PATHSMITH_DESIGN.md) remains the product contract. The supplied schemas and support-routing fixtures are preserved unchanged.

## Start

Requires **Node 24 LTS** and **pnpm 10.33.0**. Dependencies are pinned in `pnpm-lock.yaml`. No Docker, database, credentials, or paid requests are needed.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open **http://127.0.0.1:5173**. The Nest API health endpoint is **http://127.0.0.1:4310/api/v1/health**. Both bind to loopback. The browser previews the actual graph, validates editable JSON, and imports/exports workflow definitions. Edits remain in the current tab; saving and visual node editing are later milestones. The graph inspector shows configuration, not a fabricated execution.

On the supplied Windows machine, Node 20 is the global runtime. An isolated Node 24.21.0 / pnpm 10.33.0 toolchain is already installed in ignored `.tooling/`. Use the wrapper without changing your global configuration:

```powershell
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 dev
```

To recreate that optional local toolchain on another Windows checkout:

```powershell
npm install --prefix .tooling --no-save node@24.21.0 pnpm@10.33.0
.\scripts\pnpm.ps1 install --frozen-lockfile
```

Use `Ctrl+C` to stop the development processes. `.env` is optional; `pnpm dev` loads it only into the backend. No key is needed or read by any implemented provider. The API supports `PATHSMITH_HOST` and `PATHSMITH_PORT`; if changing the API port, change the Vite proxy target accordingly.

## Execute the headless loop

```sh
pnpm demo
pnpm test:parity
```

`demo` executes the real CLI to validate, run baseline, run candidate, and compare. It handles each intentionally nonzero exit independently. Reports are written to `.pathsmith/reports/{baseline,candidate,comparison}.json`.

| Actual synthetic results | Baseline | Candidate |
| ------------------------ | -------: | --------: |
| Completed cases          |       12 |        12 |
| Passed expectations      |       11 |        10 |
| Failed expectations      |        1 |         2 |
| Observed branch ports    |  10 / 10 |   10 / 10 |
| Logical judgments        |       16 |        14 |
| HTTP requests            |        0 |         0 |

Three outcomes change: **two new assertion regressions and one improvement**. The comparison gate fails. Coverage is not correctness, and these authored synthetic labels are not a model-accuracy measurement.

Individual commands:

```sh
pnpm pathsmith validate --workflow examples/support-routing/baseline.workflow.json --suite examples/support-routing/suite.json
pnpm pathsmith run --workflow examples/support-routing/baseline.workflow.json --suite examples/support-routing/suite.json --profile examples/support-routing/mock.profile.json --mode mock --fixtures examples/support-routing/mock-fixtures.json --out .pathsmith/reports/baseline.json
pnpm pathsmith run --workflow examples/support-routing/candidate.workflow.json --suite examples/support-routing/suite.json --profile examples/support-routing/mock.profile.json --mode mock --fixtures examples/support-routing/mock-fixtures.json --out .pathsmith/reports/candidate.json
pnpm pathsmith compare --baseline .pathsmith/reports/baseline.json --candidate .pathsmith/reports/candidate.json --out .pathsmith/reports/comparison.json
```

`run` also accepts `--scenarios id,id` and `--concurrency 1..16`. `compare --strict` fails on any candidate assertion failure, including existing failures. Exit codes: **0** success, **1** completed assertion/gate failure, **2** invalid configuration, execution failure, or incomplete comparison. Reports and available diagnostics are written before nonzero exits. Do not join baseline and candidate commands with `&&`: both supplied runs intentionally exit 1.

Reports contain immutable workflow and suite snapshots, inputs, sanitized profile, hashes, limits, adapter/model provenance, ordered events, normalized answers, full exact mock exchanges, assertions, and coverage denominators. **Inputs and responses may be sensitive.** Reports are ignored by Git and are not application-level encrypted. `expected-results.json` is only an independent expectation fixture, never a runtime recording.

Reports use compact JSON with a 64 MiB budget, separate from the 8 MiB suite/fixture import limit. Computed values are capped at 512 KiB, and retained scenario artifacts at 8 MiB, to prevent safe ASTs from expanding data without bound. Exceeding a budget produces an inspectable failure. Comparisons re-evaluate stored expectations and treat missing/inconsistent assertion records as inconclusive.

## Packages and portable use

| Boundary                                     | Implemented responsibility                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `contracts`                                  | Browser-safe generated wire types, Ajv 2020-12 schemas, graph/dominator/reference validation, normalized-answer validation |
| `core`                                       | Safe AST, canonical SHA-256 hashes, deterministic traversal, cancellation/deadlines, traces, provider interface            |
| `provider-mock`                              | Exact `(scenario, node, binding, model, state, questions)` matching; no fallback or network                                |
| `evaluation`                                 | Preflight of selected inputs, bounded suite concurrency, assertions, coverage, comparison gates                            |
| `cli`                                        | Headless validate/run/compare and JSON report files                                                                        |
| `apps/api`                                   | Compiled Nest shell with health/provider status and local request controls                                                 |
| `apps/web`                                   | React/Vite/React Flow graph preview and shared-contract JSON validation                                                    |
| `storage`, `provider-replay`, `provider-jev` | Explicitly deferred package boundaries; no hidden implementation                                                           |

The standalone example imports **built package exports**, with no API, database, React, or private source aliases. Its 24 cases compare both definitions' outcomes and ordered paths against the supplied independent expectations. It demonstrates the intended production boundary; the packages remain private and are not published.

```typescript
import { executeWorkflow } from "@pathsmith/core";
import { createMockProvider } from "@pathsmith/provider-mock";

const execution = await executeWorkflow({
  workflow,
  input,
  scenarioId,
  mode: "mock",
  bindings: {
    decisions: {
      providerId: "mock",
      model: "mock-v1",
      adapter: createMockProvider(fixtures),
    },
  },
});
if (execution.status === "completed") {
  // Your application decides what to do with this recommendation.
  console.log(execution.result.outcomeId, execution.result.value);
}
```

Preflight errors throw `PathsmithError` before execution. Runtime failures return a discriminated failed/canceled result, never a normal outcome. Tracing is opt-in for standalone consumers with `trace: true` or `onEvent`. Optional observer errors are counted and ignored by default. Set `observerErrorPolicy: 'fail'` for a required observer; failures become `STORAGE_ERROR` and never retry a model call. `runSuite.onScenario` is required when supplied; callback failure preserves completed results and fails the report.

Canonicalization recursively sorts object keys in JavaScript lexicographic order, preserves arrays, rejects non-JSON/non-finite/unsafe values, serializes UTF-8 JSON, then hashes SHA-256. Semantic hashes additionally sort nodes/edges by stable ID and exclude workflow name/description and node labels. Case order, rubric order, question whitespace, declared bindings, and schemas remain semantic. Layout is separate.

## Verification

Build before running tests: tests exercise emitted packages and real Nest decorator metadata.

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm test:parity
pnpm demo
```

Tests are offline except for loopback API/browser requests. Browser tests use an installed Google Chrome (`channel: chrome`); installing Chrome is a one-time environment prerequisite, not a test-time download. No test contacts Jev. `pnpm test` includes the 100-node / 1,000-scenario generated workload and CLI exit-code tests.

Use `pnpm generate` after an intentional schema change, and commit generated types with the schema. `pnpm generate:check` verifies drift and equality of shared question/expression contracts. Schemas and fixture files are not rewritten by formatting. `pnpm db:migrate` currently reports that persistence is deferred; it does not claim to migrate a database.

See [milestone evidence](docs/M0-M1-RESULTS.md) for the checks actually run and [implementation decisions](docs/decisions/001-implementation-contract.md) for deliberate choices.

## Next milestone

**M2:** SQLite/Drizzle migrations and scoped repositories; projects, revisioned drafts, immutable versions, persisted jobs and incremental results, restart interruption, cancellation, and browser-triggered run/trace history.

**M3:** Visual node/edge authoring, undo/redo, historical graph overlays, and comparison UI. **M4:** Strict recorded replay, Jev transport with observable retry/attempt budgets, live consent, and remaining POC acceptance tests. The CLI presently rejects live/replay mode; no requests or billable smoke tests were run. Nothing is deployed, licensed for publication, or published.
