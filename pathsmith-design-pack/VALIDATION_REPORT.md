# Artifact validation report

**Date:** September 24, 2026

## Scope

These checks validate the supplied design artifacts and synthetic business example. An independent Python checker validated JSON Schemas, graph structure, dependencies, response shapes, and expected routing behavior. It is not the proposed TypeScript implementation. No Pathsmith application was built or tested, and no live Jev API calls were made.

## Result

**29 checks passed.**

1. Schema self-check: workflow.schema.json.
2. Artifact schema validation: baseline.
3. Artifact schema validation: candidate.
4. Schema self-check: suite.schema.json.
5. Artifact schema validation: suite.
6. Schema self-check: mock-fixtures.schema.json.
7. Artifact schema validation: mock fixtures.
8. Baseline graph structure and dominating references.
9. Candidate graph structure and dominating references.
10. Each scenario input conforms to the workflow input schema.
11. Negative: duplicate node rejected.
12. Negative: missing default edge rejected.
13. Negative: cyclic graph rejected.
14. Negative: ancestor without domination rejected.
15. Inclusive threshold equality.
16. Missing data is an error, not a false comparison.
17. Boolean/number coercion rejected.
18. All synthetic response shapes/distributions and weighted scores.
19. Baseline 11 assertion passes / 1 failure.
20. Candidate 10 assertion passes / 2 failures.
21. Strict recorded candidate replay matches fresh exact mocks.
22. Judgment counts: baseline 16 / candidate 14.
23. Both versions visit all 10 branch ports.
24. Exactly three changed cases / two regressions / one improvement.
25. Negative: changed question cannot replay source responses.
26. Negative: changed question cannot use an exact mock silently.
27. Negative: newly reached judgment causes replay miss.
28. First true case wins; later case is not evaluated.
29. Labels do not change semantic hash; policy threshold does.

## Verified example

| Metric | Baseline | Candidate |
|---|---:|---:|
| Completed cases | 12 | 12 |
| Passed assertions | 11 | 10 |
| Failed assertions | 1 | 2 |
| Branch ports visited | 10/10 | 10/10 |
| Logical judgments | 16 | 14 |
| Live requests | 0 | 0 |

Three cases change: two new assertion regressions and one improvement. Candidate strict replay reuses fourteen recorded synthetic judgments and matches the candidate mock results. The illustrative report is `examples/support-routing/expected-results.json`; it is not a reusable Pathsmith recording.

## Not validated here

Actual TypeScript package builds, browser interactions, NestJS request handling, SQLite migrations, production deployment security, live Jev responses, provider credential access, API costs, and npm/brand availability remain untested. They are implementation acceptance tasks, not completed features.
