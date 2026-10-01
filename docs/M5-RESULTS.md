# M5 completion evidence

M5 adds a guided classification test flow to the local Pathsmith app. Users can paste lines or import CSV, inspect invalid rows, review expected labels, run a sample or a published full test set, and inspect a measured after-action report. Graph and JSON authoring remain in Advanced. In-app LLM analysis is the agreed follow-up; exports support external review now.

## Implemented

- The additive suite contract records a binary classification target and optional reference labels with source and review state. Generated labels remain provisional until reviewed. The workflow contract and execution engine remain general purpose.
- A suite can contain up to 10,000 examples within byte limits. The guided flow previews import errors, batches label edits, spreads samples across the set, requires a published test-set version for execution, and makes live Jev consent and attempt limits explicit. Imported messages without exact mock fixtures cannot be launched as an unexplained mock run.
- Persisted reports separate reviewed and provisional denominators, missed positives, false alarms, correct classifications, unclear/unlabeled rows, incomplete rows, usage, model identities, tag slices, and row evidence. Partial and interrupted runs do not claim unobserved predictions. CSV/JSON exports require acknowledgment of message content.
- SQLite migration 3 adds compact run projections while retaining immutable snapshots and full traces. A 256 MiB report bound reserves all selected rows, including canceled rows after a limit failure. Actual model identities from saved exchanges survive an interrupted run and restart.
- The editor mounts and fits its graph when Advanced becomes visible. Advanced open state persists across reload. Browser regressions cover delayed trace responses, unpublished drafts, invalid drafts, graph drag persistence, and existing replay/comparison flows.

## Checks run

Commands ran from `C:\Projects\Alchemy\pathsmith` in disposable Node 24.21.0 Docker images. The Chrome test image added a browser only for verification; it is not part of the application setup.

| Command | Result |
| --- | --- |
| `docker compose build` | All workspace packages built. Vite reported a non-failing bundle-size warning. |
| `docker run --rm pathsmith-e2e-latest pnpm lint` | Passed. |
| `docker run --rm pathsmith-e2e-latest pnpm typecheck` | Passed across the workspace. |
| `docker run --rm pathsmith-e2e-latest pnpm test` | 97 root tests passed, 2 opt-in workload tests skipped; 7 storage tests passed. Generated schema check passed. |
| `docker run --rm pathsmith-e2e-latest pnpm test:parity` | 36 cases passed through built standalone exports. |
| `docker run --rm pathsmith-e2e-latest pnpm test:e2e` | 23 of 23 isolated Chrome browser tests passed. |
| `docker run --rm -e PATHSMITH_BATCH_BENCHMARK=1 pathsmith-benchmark node --test tests/api-m5.test.mjs` | 4 tests passed, including 10,000 persisted examples through an injected offline transport. The batch took 172,081 ms, made 10,000 fake calls, produced a 59,735,047-byte report, and reached 1,239 MiB observed process RSS. |
| `docker run --rm -e PATHSMITH_REPORT_CAP_TEST=1 pathsmith-benchmark node --test tests/report-cap-m5.test.mjs` | Passed: all 10,000 rows persisted in a failed partial run (210 completed, 1 failed, 9,789 canceled); report 115,819,536 bytes under the 268,435,456-byte cap. |

Manual browser smoke on the local Compose app ran the eight-message mock starter and showed one missed abusive message, one harmless message flagged, four agreements, and the expected unclear/unlabeled rows. No real Jev request was made.

## Review and limits

Independent backend review found that interrupted live runs could lose observed model versions and that canceled rows could push a failed report beyond the storage limit. Both were reproduced, fixed, and given offline regressions. Independent milestone exit review found four guided UI correctness issues involving unpublished drafts, live-call estimates, delayed traces, and mixed-model visibility; the final browser suite covers the repaired paths. The initial large-batch benchmark timed out at its four-minute test deadline while other checks ran concurrently. Its opt-in wait was extended to ten minutes; the isolated rerun completed in 172 seconds.

The benchmark uses generated messages, expected labels, and fake transport replies. It measures local throughput and persistence, not Jev classification quality, live cost, or model latency. Agreement with provisional labels is not verified accuracy. A real user data trial and an optional owner-enabled live smoke remain unperformed. In-app LLM report analysis remains the next feature follow-up.
