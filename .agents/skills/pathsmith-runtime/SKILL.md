---
name: pathsmith-runtime
description: "Pathsmith workflow contracts, graph or expression execution, semantic hashes, traces, coverage, comparison gates, replay, and standalone parity. Use for changes or review of these behaviors, not cosmetic UI-only work."
---

# Runtime and contract work

## Read the governing contracts

Find `PATHSMITH_DESIGN.md` at the root or under `docs/`. Read the relevant sections
4–12, 16, and the current milestone. Inspect actual schema/type sources and the
corresponding examples/tests; do not assume all proposed packages already exist.
The specification governs the approved behavior, while tests provide evidence.
A contradiction needs an explicit resolution, not a quiet semantic change.

## Establish the invariants affected by the task

Keep schema validation, graph validation, expressions, execution, assertions,
and comparison in their respective shared implementations. Neither the browser
nor NestJS controllers should own a second execution algorithm. Keep `core`
independent of React, NestJS, SQLite, and concrete provider implementations.

Validate one start, acyclicity, required outgoing ports, ordered cases with a
default, and output references from strictly dominating producers. An ancestor
is not necessarily a dominator. Follow one active path. Evaluate branch cases in
order, with the first true case winning; remaining cases are not evaluated.

Use the allowed expression AST only. Missing values and incorrect types are
errors, not convenient false values. Do not introduce eval, dynamic code, shell
nodes, JavaScript templates, arbitrary properties, or implicit coercion. Follow
the design's import/key/depth/size limits. Questions sharing a judgment have one
state; no question can consume another answer from that same judgment.

Preserve semantic JSON separately from editor layout. Verify hashing and immutable
run snapshots, including expectations, model/policy identity, limits, provenance,
and exchanges. Test the public built exports in a standalone consumer.

## Evaluate what actually happened

Observed branch-port coverage is not exhaustive path coverage or reachability
proof. Keep denominators explicit, with N/A for an empty applicable cohort.
Do not multiply marginal model outputs into a claimed full-path probability.
Keep unlabeled, failed assertion, infrastructure error, incomplete, and incompatible
results distinct. A changed output becomes a regression only against the relevant
expectation/baseline policy. Partial comparisons must not become clean gates.

Mocks match exact requests. Replay uses actual recorded exchanges, source-scoped
matching, and zero network fallback. The supplied `expected-results.json` is an
expectation, not a recording. Test a changed prompt/state, a newly reached node,
and a model/configuration mismatch as appropriate to the active milestone.

## Completion

Map changed behavior to acceptance criteria and regression tests, using the
verification skill. Update contracts, examples, runtime, and tests together for
an authorized contract change. Return evidence and any unresolved ambiguity.
