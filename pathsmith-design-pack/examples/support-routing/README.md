# Provisional business demo: support request routing

This is a replaceable fixture for the Pathsmith proof of concept. It demonstrates general business routing without executing an external action. It does not commit the product to the support domain.

## Files

| File | Purpose |
|---|---|
| `baseline.workflow.json` | 13-node graph with automatic routing at confidence >= 0.70. |
| `candidate.workflow.json` | The same graph; only that threshold changes to >= 0.80. |
| `suite.json` | Twelve authored input/expectation cases. |
| `mock-fixtures.json` | Sixteen exact-request synthetic provider responses for the baseline paths. |
| `mock.profile.json` | Named provider binding to the deterministic mock provider. |
| `jev.profile.json` | Illustrative live binding using `jev-latest`; no key and no implicit live authorization. |
| `layout.json` | Suggested positions, separate from execution semantics. |
| `expected-results.json` | Independently computed fixture expectations; not a Pathsmith run report or replay recording. |

All confidence values, probabilities, labels, thresholds, and inputs are demonstration data. The thresholds are not recommended defaults for real support automation. No live Jev evaluations produced these fixtures.

## Expected behavior

The baseline completes twelve cases, with eleven assertion passes and one intentional failure. The candidate completes the same cases, with ten passes and two failures. Both cover all ten branch ports.

The candidate creates two new regressions: `billing_threshold_075` and `technical_threshold_070` move to manual review despite their expected priority queues. It improves `technical_threshold_079`, whose authored expectation is manual review. No claim about a universally better threshold is implied.

Baseline paths visit sixteen judgment nodes across the suite. Candidate paths visit fourteen. The candidate can be replayed from a real baseline recording created by the implemented mock runner, because its reached requests are available in that source.

## Exact mocks

The mock adapter must compare resolved request state, question definitions, provider/model identity, scenario ID, node ID, and binding. Changing a question while using these same fixtures should fail exact matching. It should not silently reuse a response or call Jev.

Score fixtures contain weighted fractional values. Binary fixtures intentionally lack a separate confidence field. Supplied Choice/Score confidence values are synthetic; they do not reproduce TypeSafe's confidence computation.

## Running the example after implementation

Use the CLI commands in the main design once the relevant milestones have been implemented. A baseline run exits 1 because of its intentional failed expectation, but must still write its report. Run the candidate and comparison separately; do not use a success-only shell chain that stops at the baseline.

For strict replay, generate a complete baseline report from the implemented runner. Do not pass `expected-results.json` as `--source`: it is an expectation artifact and contains no runtime recording contract.
