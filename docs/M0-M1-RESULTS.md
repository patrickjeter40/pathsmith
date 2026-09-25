# M0–M1 implementation evidence

Implemented against the supplied `PATHSMITH_DESIGN.md`, `AGENTS.md`, and `pathsmith-design-pack/CODEX_KICKOFF.md`. The kickoff explicitly requests M0–M1 before the later product milestones. No reconstructed fixture pack was substituted.

## Delivered

- Private pnpm workspace with exact pins, lockfile, Node 24 tooling, ESM exports, lint/build/typecheck commands, and local-only Nest/React shells.
- Generated schema-derived wire types, shared browser/server validation, unsafe-JSON checks, required ports, DAG reachability/termination, dominators, static reference checks, data-schema applicability, and expression limits.
- One deterministic expression evaluator/executor: exact mocks, ordered branch cases and operands, immutable snapshots and exchanges, cancellation, deadlines, and observer-error policy.
- Labeled and unlabeled evaluation, absolute coverage counts/denominators, honest partial-run status, complete report files, and baseline/candidate comparison gates.
- CLI validate/run/compare, an executable demo script that respects intentional nonzero exits, and standalone built-package parity.
- Browser graph preview, canonical JSON editing/validation and import/export; no simulated results or fake persistence controls.

## Commands actually run

Commands used `scripts/pnpm.ps1` to select the isolated Node 24.21.0 / pnpm 10.33.0 toolchain. The equivalent standard commands are below.

| Command | Observed result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed; lockfile current |
| `pnpm build` | All 11 child workspaces built |
| `pnpm typecheck` | Passed across all workspaces |
| `pnpm lint` | Passed |
| `pnpm test` | **48 passed**, 0 failed; includes schema generation drift, engine, API, CLI, workload bounds, and review regressions |
| `pnpm test:e2e` | **2 passed** using installed Chrome; desktop JSON/import/export flow and small-screen controls |
| `pnpm test:parity` | **24 cases passed**, both workflow versions, built exports without API/database |
| `pnpm demo` | Actual reports produced; validate exits 0, each supplied run exits 1, comparison exits 1 as designed |
| `pnpm db:migrate` | Correctly reports deferred M2 persistence; no migration falsely claimed |

No Jev requests, credentials, billing tests, deployment, or package publication were involved. Network during installation/documentation lookup is separate from execution tests; tests only use local HTTP where required.

## Actual demonstration

| Metric | Baseline | Candidate |
|---|---:|---:|
| Completed | 12 | 12 |
| Assertion passed | 11 | 10 |
| Assertion failed | 1 | 2 |
| Branch ports visited | 10 / 10 | 10 / 10 |
| Logical judgments | 16 | 14 |
| Actual HTTP attempts | 0 | 0 |

The comparison records exactly three changed cases, two new assertion regressions (`billing_threshold_075`, `technical_threshold_070`), and one improvement (`technical_threshold_079`). The default gate is **fail**. Improvements do not cancel regressions. Full branch coverage does not imply correct outcomes.

Actual local outputs (ignored by Git):

- `.pathsmith/reports/baseline.json`
- `.pathsmith/reports/candidate.json`
- `.pathsmith/reports/comparison.json`

The generated 100-node / 1,000-scenario deterministic workload completed with 1,000 passing cases and zero HTTP attempts. The final test also wrote and compared its real report, exceeding the old 8 MiB suite-import threshold. Execution plus this report round trip took approximately **21.2 seconds** during concurrent verification on Windows x64, Intel Core i7-11800H, Node 24.21.0. An isolated run of the expanded test took approximately 15.0 seconds. These are local measurements, not universal latency promises.

An independent architecture review identified unbounded transform expansion, incomplete assertion records incorrectly allowing a passing gate, and a reader limit that rejected some generated reports. All three were fixed and verified. New regressions test bounded UTF-8 JSON measurement, shared-reference expansion, and incomplete/falsified assertion evaluation. The follow-up review reported no further significant findings within those fixes.

## Acceptance coverage and limits

M0–M1 evidence covers AC-01–08, normalized mock response validation in AC-11, mock cancellation/deadlines in AC-13, snapshot/hash behavior in AC-15, AC-17–18, local API/import controls from AC-20, built-runtime parity in AC-22, semantic JSON/version validation in AC-23, and mock accounting in AC-24. Tests named for later criteria exercise only the implemented parts; they are not claims that the entire later criterion has shipped.

**Not implemented:** SQLite/Drizzle persistence, scoped repository ownership tests, revision conflicts, persisted jobs/restart recovery, browser-run controls, visual graph authoring/undo, historical trace UI, strict replay, Jev transport/retries/live budgets, or hosted features. The three reserved packages explicitly expose deferred status. The health endpoint explicitly reports database support as not implemented. No live smoke test was run.

The browser build emits a nonblocking Vite warning for a roughly 572 kB minified JavaScript chunk (173 kB gzip) containing React Flow and the validator. Browser interaction tests pass; bundle splitting can be addressed when the workspace gains multiple routed screens.

**Next concrete milestone: M2** — implement SQLite migrations and workspace-scoped repositories, revisioned drafts and immutable versions, persisted cancellable jobs with restart interruption, incremental scenario/trace writes, and the minimum browser run/trace history loop.
