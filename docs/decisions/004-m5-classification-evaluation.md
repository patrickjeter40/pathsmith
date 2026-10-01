# M5: Test sets and measured classification reports

The owner approved importing large sets of generated examples, reviewing their
reference labels, running a sample or full set through Jev, and exporting an
actionable report. In-app generation and LLM-written analysis are follow-up work.

## Contract

The existing `0.1` suite gains optional `classification` metadata with `nodeId`,
`questionId`, `positiveLabel`, and `negativeLabel`. The target must be a Choice
question with exactly those two distinct options. Workflows and execution remain
provider-neutral and unchanged. Chat abuse is one checked example of this general
classification task; existing routing examples are preserved.

A scenario can carry `referenceLabel: { value, source, review }`. A string value
must match one of the two options; `null` explicitly marks an unclear reference.
Omitting the object means unlabeled. Source is `generated`, `human`, or `unknown`;
review is `provisional` or `reviewed`. Reviewing a generated label does not erase
its generated source. Legacy suites have neither field and retain their previous
meaning. Historical artifacts are never migrated in place.

Classification agreement is a measured view over saved typed answers and saved
reference labels, independent of existing workflow assertions. It never infers
classification quality from a routing outcome or overwrites assertion results.
The full suite hash covers reference labels, provenance, review state and target.

## Report semantics

Reports provide separate reviewed and provisional cohorts, label-source counts,
confusion counts, explicit rate numerators/denominators, per-tag slices and row
evidence. Agreement divides matching predictions by evaluated binary labels;
end-to-end agreement divides matching predictions by all selected binary labels.
Unclear/unlabeled references are excluded from those denominators. Zero
denominators are `null`, displayed as N/A. Tag slices can overlap.

Failed executions, canceled/interrupted work and missing target predictions are
not correct predictions. A classification judgment on an unexecuted branch is
reported as a missing prediction. Reports use immutable run inputs and labels,
including when a job has no final full artifact after interruption. No clean
comparison gate is derived from a partial classification report.

The compact JSON export includes an external-review prompt and row evidence.
CSV cells escape formula prefixes for spreadsheet use. Full JSON preserves the
original values. Neither export runs an LLM or sends data anywhere automatically.

## Bounds and storage

The row ceiling rises to 10,000, still subject to the 8 MiB suite and 64 KiB input
caps. The HTTP attempt override ceiling rises to 30,000; the default remains 200.
Retries remain three total per judgment, live concurrency remains four, and the
budget is reserved before actual dispatch. These are application limits, not
provider limits or cost estimates.

The aggregate report/read/hash limit is 256 MiB, shared by writers and
recording readers. Every byte limit still applies; individually valid large inputs do
not guarantee a complete run within the aggregate budget. Exceeding a budget
leaves a failed/partial run with explicit accounting, never silent trace removal.

The active writer caches only immutable snapshot membership. Every append still
checks current lifecycle and server-derived workspace ownership. Compact SQL
queries return result facts without loading all traces for progress or tables.
Migration 3 adds derived summary/overview columns and backfills them from saved JSON. Full snapshots, results, and restart behavior are preserved.

## Evidence required

M5 requires a measured persisted 10,000-example run with an injected offline
transport, checked confusion-matrix examples, import/browser checks, and existing
regressions. The opt-in backend measurement is
`PATHSMITH_BATCH_BENCHMARK=1 node --test tests/api-m5.test.mjs` after building.
Its generated expected transport replies are synthetic test evidence, not a Jev
quality measurement or authorization for a paid smoke test.
