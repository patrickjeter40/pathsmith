# M2 implementation evidence

M2 adds the persistent local application described in `PATHSMITH_DESIGN.md` §21. The application remains mock-only and loopback-only. The checked support-routing expectation files were not changed.

## Delivered

- SQLite schema v1, migrations, foreign keys, transactions, workspace-scoped repositories, revisioned workflow/suite drafts, immutable versions, and a process-held data-directory lock.
- Persisted queued mock runs, one active local job, incremental scenario/trace/exchange writes, cancellation, progress, history, and interruption of unfinished jobs on startup without redispatch.
- Nest API routes for checked-example loading, drafts/versions, runs, paginated results, historical snapshots/traces, and explicit deletion. The API continues to enforce loopback binding, Host/Origin checks, a mutation header, and JSON limits.
- Browser controls to load and reopen projects, edit scenario JSON, save and publish versions, run a case or suite, inspect results and traces, cancel, and page through history. Mock request mismatches remain execution errors. The gaming example is the default preview.

## Commands actually run

Commands ran from the repository root using `scripts/pnpm.ps1` (Node 24.21.0 / pnpm 10.33.0). The standard `pnpm` forms are shown below.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Exit 0; lockfile current |
| `pnpm build` | Exit 0; all workspace builds passed; Vite emitted a nonblocking large-chunk warning |
| `pnpm typecheck` | Exit 0 |
| `pnpm lint` | Exit 0 |
| `pnpm test` | Exit 0; 52 root tests and 4 storage integration tests passed |
| `pnpm test:e2e` | Exit 0; 8 browser tests passed with a fresh temporary API/data directory |
| `pnpm test:parity` | Exit 0; 24 built-package standalone cases passed |
| `pnpm demo` | Exit 0; baseline 11/12, candidate 10/12, expected comparison failure preserved |
| `pnpm db:migrate` with `PATHSMITH_DATA_DIR=.pathsmith/migration-check` | Exit 0; SQLite schema version 1 ready |

The browser suite includes a run started in the browser, an API close/recreate against the same data directory, and reopening its saved run and trace. It also checks a stale two-tab save, malformed suite JSON retained after save/reopen, the 51st run, the 101st case, a delayed trace response, and an exact mock miss. Storage/API tests separately cover startup interruption, preserving completed cases, a second-process lock rejection, lock release after a killed process, workspace ownership, and cancellation.

An independent read-only milestone review found malformed-suite rendering, missing browser pagination, and a delayed-trace race. Those were fixed and verified with browser regressions. Its follow-up review found no remaining consequential issue in the fixes; it did not rerun the test suite.

## Acceptance and limits

M2 evidence addresses AC-13 (mock cancellation), AC-14 (startup interruption without redispatch), AC-15 (immutable snapshots), AC-16 (stale-save conflicts), AC-20 (local request controls), and AC-25 (workspace-scoped repositories), plus the M2 browser/restart exit. M0–M1 evidence remains in [M0-M1-RESULTS.md](M0-M1-RESULTS.md). The broader AC-21 visual node/edge authoring and comparison requirements remain M3; replay, Jev transport, and live usage controls remain M4.

Browser editing is JSON-based in M2. Changing a mock request without adding an exact fixture yields `MOCK_REQUEST_MISMATCH`; no fallback or live call occurs. Local data and reports can contain scenario text and model exchanges and are not application-level encrypted. `better-sqlite3` compiled on the checked Windows machine using existing native build tools; installation on another machine may require its own compatible toolchain. Large persisted-history query performance was not measured. No live request, deployment, package publication, or credential test was performed.

The next milestone is M3: visual graph authoring, historical graph overlays, and baseline/candidate comparison in the browser.
