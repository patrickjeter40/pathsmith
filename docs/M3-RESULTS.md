# M3 completion evidence

M3 adds graph authoring and saved-run comparisons to the local mock application. The canonical workflow JSON remains the executable definition; node positions are saved separately as layout. Comparisons are computed from immutable, workspace-scoped run records by the shared evaluation package.

## Implemented

- Graph node forms, named-port connection and reconnection, ordered branch cases with a default port, reference pickers, advanced expression JSON, and undo/redo. Invalid drafts stay editable, while publishing and workflow export require full validation.
- Historical graphs use each run's workflow and layout snapshot. Selected paths use recorded node visits and selected edges. Cohort overlays use stored observed coverage, including explicitly partial coverage for unfinished runs with saved cases.
- `POST /api/v1/comparisons` accepts baseline/candidate run IDs and an explicit gate policy. It enforces server-owned workspace scope, reuses `compareRuns`, and adds run status, selected paths, and execution configuration differences. Missing reports produce an inconclusive gate with unavailable metrics rather than zeros.
- The Compare view shows gate reasons, per-case regressions and improvements, first observed path divergence, linked traces, workflow/configuration differences, and model provenance change flags.

## Checks run

Commands below ran from `C:\Alchemy\pathsmith` using the checked-in Node 24/pnpm wrapper. All exited 0 on the final M3 change:

| Command | Result |
| --- | --- |
| `.\scripts\pnpm.ps1 build` | All workspace packages built. Vite reported a non-failing bundle-size warning. |
| `.\scripts\pnpm.ps1 typecheck` | All workspace TypeScript checks passed. |
| `.\scripts\pnpm.ps1 lint` | ESLint passed. |
| `.\scripts\pnpm.ps1 test` | 56 root tests and 4 storage tests passed; schema generation check current. |
| `.\scripts\pnpm.ps1 test:e2e` | 15 of 15 isolated Chrome browser tests passed. |
| `.\scripts\pnpm.ps1 test:parity` | 24 standalone cases passed through built package exports. |

The browser exit journey loaded the checked support baseline, ran its suite, changed `confidence_gate` from `0.7` to `0.8` through the node form, saved/published, ran the same suite, and displayed two new assertion regressions and one improvement. Browser tests also cover branch order and port reconnection, JSON recovery, undo/redo, stale comparison and coverage responses, an unstarted path, and unchanged semantic hash after layout movement. API tests cover explicit policy, cross-project same-workspace comparisons, workspace isolation, incompatible/incomplete cohorts, partial coverage, restart, and local request controls. No Jev or other network provider requests ran.

A fresh independent milestone reviewer found five consequential UI/coverage defects in the first pass. The fixes were reviewed again; the reviewer found no remaining consequential defect in that focused scope. The final build, API tests, and browser suite ran after the fixes.

## Limits and next work

The Compare run picker loads up to the newest 1,000 workspace runs; older runs require a future paged picker. Comparison reports are recomputed from immutable runs and are not stored as separate records. The application remains loopback-only and mock-only. M4 is recorded replay and the explicit Jev adapter/live boundary; no live smoke test or paid request was performed.
