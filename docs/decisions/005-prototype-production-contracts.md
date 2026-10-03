# Prototype production contracts

The owner authorized the Figma prototype's visual design and added interactions,
implemented in reviewed phases. The prototype and handoff are requirements and
reference data. The canonical engine, immutable records, local security controls,
and original support-routing oracle remain authoritative. Synthetic histories,
fake first-save conflicts, estimated completed cases, and “not executed — prototype”
are replaced by actual application state.

## Published label scoring views

The classification report, rows and export routes accept an optional
`labelsSuiteVersionId`. Its omission selects the original run labels. A scoring
view uses two immutable artifacts: the run and an explicitly published suite
version. The latter must belong to the same project and suite lineage, preserve
the classification target (including positive/negative identity), and contain
every original selected case with unchanged input. Extra examples do not enlarge
the run cohort. Only reference labels are overlaid; original inputs, tags,
expectations, execution results, traces and run hashes remain unchanged.

Responses expose `scoring: {kind, runSuiteVersionId, labelsSuiteVersionId,
labelsSuiteSnapshotHash, changedReferenceCount}`. JSON and CSV exports identify
the scoring version. “Use original labels” selects a view; it does not undo label
edits. The implementation does not queue work, replay, or contact a provider.
Generated provenance survives a human marking a label reviewed.

`reviewedVerdict` is agreement, missed positive, false alarm, unknown, or an
explicit execution/missing-prediction state. Provisional, unclear and absent
references cannot count as reviewed agreement. Existing M5 raw confusion counts
and separately labeled provisional statistics are retained. Unstarted rows expose
`not_run` as their primary status and verdict (including filters and CSV), with
the original status retained as `executionStatus`. Absent partial rows retain
pending/interrupted provenance and unknown `started`; absence alone cannot prove
that dispatch never happened. The old canceled execution count may include
those rows, so not-run is a subset and must not be added to cancellation counts.
The run summary's `notRun` counts selected cases without a started execution,
including cases absent from a partial persisted report.

## Portable live execution controls

`controls: {maxProviderCalls, stopAfterConsecutiveErrors}` is captured in each new
live run snapshot and report. The cap defaults to the selected count multiplied
by the longest judgment path in the validated DAG. A positive bound accepts a cap
from one through that bound. A zero-judgment workflow accepts cap zero. The error
threshold is 1–20, default five. Controls are rejected for mock/replay modes.

The shared core/evaluation implementation reserves one logical provider call
synchronously after resolving the request and immediately before invoking the
adapter. It is shared by concurrent workers. `providerCalls` is separate from
reached `logicalJudgments` and actual HTTP attempts. Reaching the cap alone does
not make a completed run partial; denied additional admission stops dispatch.

Consecutive errors are terminal logical-call failures in observed completion
order, not individual failed retry attempts. A validated success resets the
streak. User cancellation, local expression errors and budget denials do not
count. Terminal invalid responses and provider deadlines count once. When the
threshold trips it remains latched, including after a later in-flight success.
A prior call-cap stop does not disable the independent error-streak stop: the
error stop takes precedence once reached.

A cap stops new calls/scenario dispatch but permits already admitted calls to use
their bounded retries. An error stop also blocks all subsequent HTTP attempt
admissions, including retries. Already submitted requests can settle and their
accounting/results are retained; this is not a promise of avoiding charges.
The existing total HTTP attempt limit and three-attempt policy still apply.

`POST /runs/preflight` performs the same snapshot/profile/selection validation
without queueing work. It returns the selected IDs, requested providers/models,
longest judgment path, concurrency, controls and separate call/HTTP attempt
bounds. The latter is `min(httpAttemptLimit, maxProviderCalls * 3)`. It never
requires or stores fresh execution consent. `POST /runs` continues to require
`confirmLive: true`; being configured or preflighted does not authorize execution.

Stopped runs retain the existing `failed` storage status, plus `stopReason`
(`PROVIDER_CALL_CAP` or `CONSECUTIVE_PROVIDER_ERRORS`) and explicit row errors.
The UI presents them as partial with measured completion and not-run counts.
Historical snapshots are never rewritten; absent legacy provider-call counts
remain unknown rather than inferred from judgments or HTTP attempts.

## Explicit remainder runs

`GET /runs/:id/rerun-plan` derives unfinished IDs from a terminal run. Completed
executions are excluded even if their business assertions failed. `POST
/runs/:id/rerun` with `{scope: "remaining"}` creates a distinct queued ID and
records `rerunOfRunId`. Live mode requires fresh `confirmLive: true`. The new run
uses original workflow/suite versions, inputs, requested profile, limits and
concurrency. Mock fixtures and replay source come from the saved parent. The
inherited call cap is reduced to the remaining cohort's bound; explicit controls
and HTTP attempt-budget overrides are revalidated. Actual runtime/adapter/model
provenance describes the new execution.

An interrupted run is not automatically dispatched on restart. Rerunning the
remaining cases does not modify, complete, or silently compose the old report.
It cannot repair the old run's full-cohort gate. A full rerun is a separate setup
choice. Migration 4 adds scoped immutable `run_reruns` links, with child deletion
cascading its link and parent deletion restricted while children exist. Existing
snapshot/report bytes are preserved. Delete dependent remainder runs before a
parent or project, as with replay dependencies.

## Comparison gates

The shared comparison requires the same mode, identical full suite content/hash,
exact selected ID sets without duplicates, and complete execution pairs. UUIDs
alone do not define suite content identity: equivalent imported versions may
have distinct storage IDs. API responses disclose both version IDs and modes,
structured `issueDetails`, and actual shared/completed/extra cohort counts.
Partial reports never acquire fabricated case results or a clean gate.

`policy.basis` is `assertions` (default, preserving legacy semantics) or
`reviewed_classification` (explicitly selected by the guided view). Classification
regressions compare saved typed predictions against reviewed, non-null binary
labels with identical reviewed reference metadata and classification targets on
both sides, separately from assertion regressions. Incompatible references do
not produce classification regressions or a spurious missing-prediction reason.
A required reviewed pair missing
either target prediction makes the gate inconclusive. No reviewed evaluable
pairs also means inconclusive. Provisional, unclear and absent labels are excluded
from this gate. Mixed-model acceptance and confounding diagnostics remain active.
An alternate label-scoring view is not silently substituted into a comparison.

Comparing a source mock/live run directly to a replay is now intentionally
inconclusive, although descriptive changes remain visible. The support demo's
two regressions and one improvement are unchanged; its qualified replay gate
compares an unchanged-baseline replay with candidate replay of that same source.
The authored labels and baseline's existing failure remain untouched.

## Atomic versions and local project files

`POST /workflows/:id/save-version` takes `{expectedRevision, definition, layout}`.
It validates, conditionally saves the draft and publishes an immutable version
within one SQLite transaction. A stale revision returns a genuine 409; invalid
content leaves the draft and history unchanged. Existing mutable invalid-draft
saving remains available. Conflict reconciliation belongs to the editor's
base/local/latest-remote state; branch order and its port edges form one unit.
No endpoint simulates a concurrent edit or forces an overwrite.

Project opening reads a user-selected file's contents in the browser. `POST
/projects/import {artifact}` accepts a content-only `pathsmith_project` version
0.1 document: a name, workflow drafts (`key`, `name`, `definition`, `layout`) and
suite drafts (`key`, `name`, `definition`). `GET /projects/:id/export` produces
the same format. There are no filesystem paths, URL fetches, archives, run
recordings, profiles or credential fields. Imported projects and resource IDs
are newly allocated; opaque bundle keys never select existing server resources.
Imports are transactional. Safe invalid drafts stay visibly invalid until fixed
and published; import does not execute anything. Suite drafts use shared schema
validation without requiring a workflow. Structurally valid drafts carry an
explicit `SUITE_WORKFLOW_UNVALIDATED` warning until validated against a published
workflow; structural validity alone never establishes executable validity.

The aggregate project-file bound is 8 MiB and at most 100 workflows plus 100
suites, still subject to each 512 KiB workflow/layout and 8 MiB suite bound and
normal JSON key/depth safety. The import envelope limit is 9 MiB. Atomic workflow
save envelopes use the existing 2 MiB workflow-envelope allowance. Preflight
uses the existing 1 MiB run-envelope allowance. Loopback, Host, Origin, mutation
header, workspace scoping, no-store and response-budget protections apply.

## Verification scope

Normal tests use exact mocks or injected offline adapters/transports. Focused
coverage includes concurrent admission, retry/error-stop interleavings,
cancellation/deadlines, zero-judgment runs, immutable label views and exports,
remainder consent/provenance/deletion/restart, classification compatibility,
transaction rollback, project JSON safety and legacy artifact/migration reads.
No live Jev call, transport/API mapping change, deployment or package publication
is part of this change. Browser integration follows this reviewed backend phase.
