# Pathsmith

Build, test, trace, and compare probabilistic decision workflows.

**Implemented: M0–M5.** The local app saves drafts, publishes immutable workflow and suite versions, runs exact mocks and source-scoped recorded replay, retains results across restarts, edits canonical workflows on a graph, and compares saved runs. The Figma-based local app has Overview, Test set, Results, Workflow, and Compare destinations, dark/light themes, and responsive desktop, compact, and mobile layouts. It adds imported test sets, measured reports, published-label rescoring, live hard stops, separate remainder runs, and real three-way save conflict handling. An explicit Jev live mode is available when locally enabled and configured. The [design](PATHSMITH_DESIGN.md) remains the product contract. The supplied support-routing expectations remain unchanged.

## Use the same Codex workflow on another device

Clone this repository and open its root in Codex. The project includes [agent routing and setup instructions](PATHSMITH_AGENTS_README.md), `.codex/config.toml`, five custom agent profiles, and four project skills. Review and trust the project in the client, then start a new session and run the [visibility smoke test](docs/codex/SMOKE_TESTS.md). See the [device setup guide](docs/codex/INSTALL_WITH_CODEX.md) for the complete sequence. Account sign-in, personal settings, Git credentials, `.env`, and local reports stay on each device.

## Start

For a password-protected, single-user hosted dev instance, see the
[Railway setup guide](docs/RAILWAY.md). Railway uses a separate hosted launcher;
the local development commands below remain unchanged.

The host setup requires **Node 24 LTS** and **pnpm 10.33.0**. Dependencies are pinned in `pnpm-lock.yaml`. SQLite is embedded; `better-sqlite3` may need native build tools during host installation. No separate database service, credentials, or paid requests are needed.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
pnpm dev
```

Open **http://127.0.0.1:5173**. The Nest API health endpoint is **http://127.0.0.1:4310/api/v1/health**. Both bind to loopback. In **Overview**, select **Create from starter** to create a classification project, open a saved project, or import a local project JSON file. **Project and file tools** lets you load the other checked examples. Use **Workflow** to edit canonical nodes, ordered branch cases, connections, and separate layout positions; **Save version** atomically saves and publishes a valid executable version. Saved projects, versions, runs, and traces persist across restarts.

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

Use `Ctrl+C` to stop the development processes. `.env` is optional; `pnpm dev` loads it only into the backend. Mock and replay need no key. Local data defaults to ignored `.pathsmith/`; set `PATHSMITH_DATA_DIR` to a trusted local directory before starting the API to use another location. The API supports `PATHSMITH_HOST` and `PATHSMITH_PORT`; if changing the API port, change the Vite proxy target accordingly. Only one API process may own a data directory at a time.

### Start with Docker Compose

On a device with Docker Engine and Compose, clone the repository and run:

```sh
docker compose up --build
```

Open **http://127.0.0.1:5173**. The first build installs the pinned Node 24 and pnpm 10.33.0 toolchain and the locked workspace dependencies, then builds the packages. The container runs the API on its own loopback address and Vite proxies `/api` to it. Compose publishes only the web port on the host's loopback address; use **http://127.0.0.1:5173/api/v1/health** for the containerized health endpoint. Mock and recorded replay work without an `.env` file. Stop with `Ctrl+C`, or run `docker compose down` from another terminal. The named `pathsmith-data` volume keeps projects and runs across container restarts and rebuilds. `docker compose down --volumes` deletes that data.

Compose reads an optional local `.env` for variable substitution and passes `TYPESAFE_API_KEY`, `TYPESAFE_MODEL`, and `PATHSMITH_ENABLE_LIVE` to the backend process. The file is excluded from the image; the launcher removes these values from Vite's environment. For live access, copy `.env.example` to `.env`, set the key and `PATHSMITH_ENABLE_LIVE=1`, then recreate the container with `docker compose up --force-recreate`. Each live run still requires explicit confirmation in the app. Do not put secrets in `VITE_` variables. To pick up source edits in this container setup, rerun `docker compose up --build`; the host `pnpm dev` command provides the regular edit loop.

## Use the local app

Use the five destinations in the sidebar or mobile navigation:

1. **Overview:** create a classification starter, open a saved project, or import/export a content-only project JSON file. Project files contain workflow/layout and test-set drafts, including safe invalid drafts that must be repaired before publication. They do not contain credentials or run recordings.
2. **Test set:** paste messages or import CSV/JSONL, preview errors and duplicates, review references, and publish an immutable test-set version. CSV requires `content` and accepts `expected_label`, `source`, and `tags`. Starter labels are `abusive`, `not_abusive`, or `unclear`; source is `generated`, `human`, or `unknown`; separate tags with `|`. Generated or provisional references are not verified model accuracy.
3. **Workflow:** edit supported nodes, expressions, ordered branch cases, named ports, and layout. Validate and use **Save version** to publish atomically. Invalid drafts remain editable; **Advanced draft and file tools** offers draft-only saving and workflow JSON import/export. Workflow export requires a valid definition. Undo/redo never changes published versions. A real stale save preserves local work and opens explicit base/local/latest reconciliation; branch order, destinations, and default routing are resolved together.
4. **Test set → Run:** select published versions, a sample or exact selection, and Mock, Recorded Replay, or Live. Mock fixtures match exact requests. Imported or changed messages need matching fixtures or an intentionally configured provider. Live requires a backend key/enable flag, server preflight, valid call/error stops and HTTP attempt budget, and fresh confirmation for each run.
5. **Results:** inspect actual persisted progress, review groups, measured agreement denominators, saved traces, and immutable workflow paths. **Review label** focuses that exact case in Test set. Publish compatible reference changes and **Re-score** saved predictions without rerunning or contacting a provider; **Use original labels** restores the scoring view without undoing label edits. **Run remaining cases** creates a distinct child run using the original setup; it does not modify or complete the parent run.
6. **Compare:** choose earlier baseline and later candidate runs and an explicit Assertions or Reviewed classification labels gate. Complete runs need the same mode, equivalent full test-set content, exact selected IDs, and compatible provenance. Incomplete or incompatible pairs are inconclusive, with actual cohort counts and fixes that open setup. Candidate options use server-assessed comparability; pairs not yet checked are labeled explicitly. Cross-project test-set fixes copy the exact baseline content into the candidate project before publication. Reviewed classification gates exclude provisional, unclear, and unlabeled references; authored assertion gates retain their separate semantics.

The raw test-set JSON/version controls are under **Advanced test-set JSON and versions**. Full run setup, sensitive recording exports, and historical coverage remain under **Advanced run setup, exports and historical graph** in Results. Classification CSV/JSON exports include the selected scoring provenance. Full recording and project exports require acknowledgment because they can contain sensitive inputs.

For the checked support-routing example, run the baseline in Mock, change the `confidence_gate` literal from `0.7` to `0.8`, save a new workflow version, run the same published suite, and compare: two new assertion regressions and one improvement appear. The baseline's existing failure is intentional. Mock → Replay is an inconclusive gate; to test the same threshold change behind a qualified Replay gate, compare unchanged-baseline Replay and candidate Replay using the same exact original source recording.

The supplied examples and fixtures are synthetic; imported content keeps its actual or unknown provenance. Runs recommend routes only and do not moderate content or create support tickets. No LLM review is sent automatically.

Mock fixtures match exact requests. Changing scenario input or judgment questions without adding a matching fixture produces `MOCK_REQUEST_MISMATCH`, an execution error rather than a business outcome. Local data can contain scenario text and full mock exchanges and is not application-level encrypted.

Recorded replay matches each request against one source run, including scenario, node, binding, model, state, and questions. A miss produces `REPLAY_MISS` and never calls Jev. The run export includes full inputs, responses, and traces; treat it as sensitive local data.

### Optional live Jev run

Live execution is disabled by default and may incur provider charges. To enable it locally, put `PATHSMITH_ENABLE_LIVE=1` and `TYPESAFE_API_KEY=<your key>` in the backend-only `.env`, then restart `pnpm dev`. The key is never needed in the browser or workflow JSON. Select **Live** in Test set run setup. Review the selected cases, actual requested model, concurrency, maximum judgment path, separate provider-call/HTTP-attempt upper bounds, call cap, consecutive-error stop, and HTTP attempt budget, then confirm that individual run. Changing the setup resets confirmation. Already submitted requests may settle after a stop; a call cap bounds logical call admissions, while an error stop also prevents new retry attempts. The backend also requires `confirmLive: true`; configuration alone does not dispatch a request. `GET /api/v1/providers/status` reveals availability booleans, never the key. An optional owner-run smoke can select one safe scenario first and inspect its recorded model identity, attempts, and usage; no live smoke was performed for M5.

## Execute the headless loop

```sh
pnpm demo
pnpm test:parity
```

`demo` executes the real CLI to validate, run baseline, run candidate, compare, replay candidate against the baseline recording, and compare again. It handles each intentionally nonzero exit independently. Reports are written to `.pathsmith/reports/{baseline,candidate,comparison,candidate-replay,replay-comparison}.json`.

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
pnpm pathsmith run --workflow examples/support-routing/candidate.workflow.json --suite examples/support-routing/suite.json --mode replay --source .pathsmith/reports/baseline.json --out .pathsmith/reports/candidate-replay.json
pnpm pathsmith compare --baseline .pathsmith/reports/baseline.json --candidate .pathsmith/reports/candidate-replay.json --out .pathsmith/reports/replay-comparison.json
```

`run` also accepts `--scenarios id,id`, `--concurrency 1..16`, `--limits <file>`, and `--http-attempt-limit 1..2000`. Replay derives its profile from the source report; an optional `--profile` must match. CLI live mode requires `--mode live --profile <file> --enable-live` and `TYPESAFE_API_KEY` in its process environment. `compare --strict` fails on any candidate assertion failure, including existing failures. Exit codes: **0** success, **1** completed assertion/gate failure, **2** invalid configuration, execution failure, or incomplete comparison. Reports and available diagnostics are written before nonzero exits. Do not join the supplied run commands with `&&`: each intentionally exits 1.

Reports contain immutable workflow and suite snapshots, inputs, sanitized profile, hashes, limits, adapter/model provenance, ordered events, normalized answers, full exact mock exchanges, assertions, and coverage denominators. **Inputs and responses may be sensitive.** Reports are ignored by Git and are not application-level encrypted. `expected-results.json` is only an independent expectation fixture, never a runtime recording.

The [synthetic gaming example](examples/gaming/README.md) exercises player reports, in-game chat, reviews, and support conversations through the same built CLI. It tests content annotations, frustration and engagement scores, churn signals, and suggested moderation or support routes with nine exact-mock cases. It performs no external moderation or support action.

Reports use compact JSON with a 64 MiB budget, separate from the 8 MiB suite/fixture import limit. Computed values are capped at 512 KiB, and retained scenario artifacts at 8 MiB, to prevent safe ASTs from expanding data without bound. Exceeding a budget produces an inspectable failure. Comparisons re-evaluate stored expectations and treat missing/inconsistent assertion records as inconclusive.

## Packages and portable use

| Boundary                                     | Implemented responsibility                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `contracts`                                  | Browser-safe generated wire types, Ajv 2020-12 schemas, graph/dominator/reference validation, normalized-answer validation |
| `core`                                       | Safe AST, canonical SHA-256 hashes, deterministic traversal, cancellation/deadlines, traces, provider interface            |
| `provider-mock`                              | Exact `(scenario, node, binding, model, state, questions)` matching; no fallback or network                                |
| `evaluation`                                 | Preflight of selected inputs, bounded suite concurrency, assertions, coverage, comparison gates                            |
| `cli`                                        | Headless validate/run/compare and JSON report files                                                                        |
| `storage`                                    | Embedded SQLite migrations, workspace-scoped repositories, revisioned drafts, immutable versions, jobs, results, traces   |
| `apps/api`                                   | Loopback Nest API, checked examples, mock/replay/live jobs, history, exports, comparisons, local request controls          |
| `apps/web`                                   | React graph/JSON authoring, saved projects and suites, run paths, replay/live controls, comparison inspection              |
| `provider-replay`                            | Source-scoped exact recorded exchanges with offline miss diagnostics                                                       |
| `provider-jev`                               | Explicit Jev HTTP adapter, validated answers, bounded retries, attempts, usage and model identity                           |

The standalone example imports **built package exports**, with no API, database, React, or private source aliases. Its 36 cases cover 24 mock and 12 replay executions against the supplied independent expectations. It demonstrates the intended production boundary; the packages remain private and are not published.

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

Tests are offline except for loopback API/browser requests. Browser tests use an installed Google Chrome (`channel: chrome`); installing Chrome is a one-time environment prerequisite, not a test-time download. They run against an isolated temporary API and do not use the developer's local data. No test contacts Jev. `pnpm test` includes storage integration, API lifecycle and comparisons, the 100-node / 1,000-scenario workload, and CLI exit-code tests.

Use `pnpm generate` after an intentional schema change, and commit generated types with the schema. `pnpm generate:check` verifies drift and equality of shared question/expression contracts. Schemas and fixture files are not rewritten by formatting. `pnpm db:migrate` creates or advances the local SQLite schema, using `PATHSMITH_DATA_DIR` when set.

See [M0–M1 evidence](docs/M0-M1-RESULTS.md), [M2 evidence](docs/M2-RESULTS.md), [M3 evidence](docs/M3-RESULTS.md), [M4 evidence](docs/M4-RESULTS.md), [M5 evidence](docs/M5-RESULTS.md), the [M5 contract decision](docs/decisions/004-m5-classification-evaluation.md), and [Figma integration coverage and evidence](docs/FIGMA-INTEGRATION-RESULTS.md).

## Next product check

Ask representative developers to try the guided classification cycle with their own labeled data and judge whether the report helps them improve a workflow. In-app LLM analysis remains the agreed follow-up. Hosted service, package publication, and public deployment remain future decisions. No live or billable smoke test was run for M5.
