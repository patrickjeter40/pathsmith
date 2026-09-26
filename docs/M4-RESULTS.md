# M4 completion evidence

M4 adds source-scoped recorded replay, an explicit Jev HTTP adapter, local live-run consent, exportable run reports, and mock/replay parity through the built standalone packages. The canonical workflow runtime and immutable run snapshots remain shared across modes.

## Implemented

- Replay uses exact source-run exchanges and retains source model/origin provenance. A missing request fails with `REPLAY_MISS`; replay makes no live call. Current HTTP attempts and usage are separate from historical source usage.
- The Jev adapter maps documented questions and normalized answers, validates response shape, records requested and actual model IDs, and applies one bounded retry policy. HTTP attempts are recorded separately from logical judgments and provider exchanges. Routine tests inject transport.
- SQLite migration v2 preserves old exchange rows and snapshots while adding actual HTTP attempt records. The API persists mock, replay, and live jobs, exports full reports, protects referenced replay sources, and does not redispatch jobs after restart.
- Live API runs require `PATHSMITH_ENABLE_LIVE=1`, a backend `TYPESAFE_API_KEY`, and per-run `confirmLive: true`. CLI live runs require `--mode live --enable-live` and a key in the CLI environment. The UI shows the run scope and budget before consent. No real Jev request was made.
- The CLI demo compares the checked baseline and candidate in mock mode and candidate replay. Both produce two new assertion regressions and one improvement. The standalone consumer passes 24 mock and 12 replay cases through built exports.

## Checks run

Commands below ran from `C:\Alchemy\pathsmith` using the checked-in Node 24/pnpm wrapper after the review fixes.

| Command | Result |
| --- | --- |
| `.\scripts\pnpm.ps1 build` | All workspace packages built. Vite reported a non-failing bundle-size warning. |
| `.\scripts\pnpm.ps1 typecheck` | All workspace TypeScript checks passed. |
| `.\scripts\pnpm.ps1 lint` | ESLint passed. |
| `.\scripts\pnpm.ps1 test` | 86 root tests and 6 storage tests passed; schema generation check current. |
| `.\scripts\pnpm.ps1 test:e2e` | Final isolated Chrome run passed 19 of 19 browser tests. |
| `.\scripts\pnpm.ps1 test:parity` | 36 standalone cases passed through built package exports. |
| `.\scripts\pnpm.ps1 demo` | Expected exit handling passed; mock and replay comparisons showed two regressions and one improvement. |
| `git diff --check` | No whitespace errors. |

The previous local M3 development process was stopped and restarted from the M4 build. `http://127.0.0.1:4310/api/v1/health` returned milestone `M4`, schema version `2`, and ready status; `http://127.0.0.1:5173` returned HTTP 200. Provider status allows mock and replay, with Jev unconfigured and disabled on this machine.

Tests are offline apart from loopback API and browser traffic. The Jev contract tests use an injected fake transport. An owner-enabled live smoke remains optional and was not performed; no actual access, billing, or response behavior can be claimed from this evidence.

A fresh independent milestone review found two report edge cases: canceled live runs had inconsistent usage for undispatched cases, and workflows without judgments lost live origin. Both were reproduced and fixed with regression tests, then reviewed again with no remaining major finding. The UI replay picker was also updated to include canceled runs with final partial recordings. The first full browser run after that UI change had one drag-layout timeout; the test passed in isolation and the second full run passed 19/19 without another code change.

## Limits and next work

The application remains loopback-only, with local data and sensitive full-report exports. The Compare run picker loads up to the newest 1,000 workspace runs. The next product check is with representative developers before hosted-service work.

## Handoff

- Start the local app with `pnpm dev` (or `.\scripts\pnpm.ps1 dev` on the supplied Windows machine). Open `http://127.0.0.1:5173`; the API health endpoint is `http://127.0.0.1:4310/api/v1/health`.
- Use **Load checked example** to create a saved project. Run the suite in mock mode, change and publish the threshold workflow, then replay the candidate against the saved baseline run and inspect Compare. `pnpm demo` runs the equivalent CLI cycle offline.
- No credentials are present in the repository or required for mock/replay. Live Jev is disabled unless the owner configures the backend and explicitly consents per run. A real live smoke remains unverified.
- Continue with representative developer feedback before designing hosted behavior. Keep M4's immutable reports and source-scoped replay contract when extending the product.
