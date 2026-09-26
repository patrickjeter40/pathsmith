# Gaming content triage example

This synthetic M1 example exercises Pathsmith's general-purpose workflow contract with player reports, in-game chat, reviews, and support conversations. It annotates content with an intent category, binary signal probabilities for toxicity, suspicious behavior, and churn, plus two fractional rubric scores for frustration and engagement. A shared transform prepares the annotations, then a deterministic, ordered branch recommends a queue. No message is removed, player is sanctioned, ticket is created, or other external action is taken.

Routing order is intentional: toxicity or suspicious behavior at or above `0.8` goes to trust and safety review; intent confidence below `0.7` goes to manual triage; support requests go to support; churn signal at or above `0.7` goes to player care; feedback goes to insights; other content goes to manual triage. The support plus abuse and support plus churn cases expose first-true ordering. All output routes carry annotations and scores for inspection. Thresholds are illustrative fixture policy, not production moderation guidance.

All nine cases, expected routes, and responses are synthetic and human-authored. Mock responses are exact-request matched and contain no real model measurements. The choice/score confidence fields are fixture values; binary signals have probabilities but no confidence. Score values are distribution-weighted values on a 0–2 rubric. The `suite.json` expectations are generated from the authored case table, not a runtime recording or independent model-quality oracle.

From the repository root after `pnpm build`:

```powershell
node packages/cli/dist/index.js validate --workflow examples/gaming/workflow.json --suite examples/gaming/suite.json
node packages/cli/dist/index.js run --workflow examples/gaming/workflow.json --suite examples/gaming/suite.json --profile examples/gaming/mock.profile.json --mode mock --fixtures examples/gaming/mock-fixtures.json --out .pathsmith/reports/gaming.json
```

The report contains player content and full mock exchanges; keep it private. `node examples/gaming/generate.mjs` regenerates the checked JSON from the case and question definitions after edits.
