---
name: pathsmith-verification
description: "Pathsmith acceptance criteria, test plans, regression reproduction, build/lint/type checks, offline suite evaluation, and milestone completion evidence. Use whenever behavior is implemented, validated, or reviewed for completion."
---

# Verification and completion evidence

## Determine what exists and what is in scope

Read design sections 19–21, the current milestone, relevant code/diff, root and
package scripts, and existing test configuration. Inspect the repository rather
than assuming commands or packages in the design already exist. Identify the
acceptance IDs affected by the change and state the necessary evidence.

Prioritize focused checks, then wider checks justified by the change. Examples
include build/typecheck/lint; schema and invalid-graph tests; expressions and
traversal; mocked provider contracts; evaluation/replay; SQLite/API integration;
browser flows; and standalone consumption of built packages. Use actual defined
scripts, not invented `pnpm` task names. Do not silently install dependencies or
invoke services when their setup has not been authorized.

## Preserve the test oracle

The supplied support-routing demonstration is provisional but its current labels
are intentional. Read the current checked-in expectation file. In the original
pack: baseline has 11 passes and 1 assertion failure; candidate has 10 passes and
2 failures. Three outcomes change: two new regressions and one improvement.
Both observe 10/10 branch ports. Baseline CLI exit 1 is expected for its failing
assertion after a report is written; it is not necessarily a crashed test harness.

Do not modify labels, snapshots, or expected outcomes to hide a discrepancy.
`expected-results.json` is not a recorded provider-exchange source. Generate replay
recordings with the actual implemented runner. Add negative tests at exact
thresholds, on wrong types/missing values, on replay misses, for incomplete runs,
and for incompatible comparisons. Use built public exports for runtime parity.

## Execute safely

Run against a stable change, one writer at a time. Normal tests use mocks and
must not contact Jev or require a key. Stop and report any attempted unexpected
live request. Do not read unrelated secrets, expose local unauthenticated services,
update dependency lockfiles, or bless snapshot changes as a verification shortcut.
If sandbox/tooling prevents a command, record it as blocked, not passed.

Check confidentiality and local controls where relevant: server-only credentials,
Host/Origin/mutation validation, workspace-context scoping, safe input limits,
stale-save conflicts, cancellation, and restart without automatic redispatch.
Do not describe a limited adversarial test set as a proof of injection resistance.

## Report evidence

For each meaningful check report its command, working directory, exit code, and
result. Distinguish passed, failed, blocked, and skipped. Attribute measured
counts to an actual run and never claim tests executed based on source inspection.
List unresolved acceptance IDs and missing manual/browser/live checks. A milestone
is complete only when its exit conditions have supporting evidence. A verifier
report does not itself authorize a release or deployment.
