# Pathsmith: instructions for coding agents

## Read first

Read `PATHSMITH_DESIGN.md` or, after it is moved during scaffolding, `docs/PATHSMITH_DESIGN.md`. The design document is the product/architecture authority. Read the current milestone before editing. Use the checked JSON examples rather than inventing a different workflow contract.

The owner approved a general-purpose tool, visual authoring backed by JSON, a local-first React/NestJS application, a portable TypeScript runtime, mock/live providers, and a future hosted service. The business demo is provisional. Do not introduce game-specific concepts.

## Initial implementation boundary

Start with M0 and M1. Scaffold the repository, contract validation, deterministic engine, exact mocks, suite evaluation, CLI, and standalone runtime parity. A basic web shell and API health endpoint are sufficient at this stage. Do not claim the full product is complete until later milestones pass.

Use pnpm workspaces and TypeScript. Target Node.js 24 LTS; pin compatible dependency versions and commit a lockfile. Account for NestJS decorator metadata and built-package module resolution. Do not require Docker, Redis, a cloud account, or live credentials for development.

## Non-negotiable architecture

- One canonical workflow definition and one implementation of execution semantics.
- The core cannot depend on React, NestJS, SQLite, or a concrete model provider.
- The editor renders the canonical graph; React Flow objects are not its persistent wire format.
- Layout and labels do not change the semantic hash.
- Bindings resolve providers outside workflow JSON. Credentials never appear in definitions or exports.
- Immutable run snapshots preserve input, expectations, policy, model identity, limits, and provenance.
- The standalone consumer must use built package exports, not privileged source aliases.

## Execution and evaluation rules

Workflows are acyclic and follow one active path. Every branch has ordered cases and a default. First true case wins; unevaluated cases are not false. Output references must come from strictly dominating judgment/transform nodes. No arbitrary code nodes or implicit merge semantics.

Use the specified expression AST. Never use `eval`, `new Function`, dynamic code loading, shell execution, or implicit JavaScript templates. Missing data and wrong operand types are errors, not false comparisons.

Mock mode is deterministic and exact-request matched. No random or “reasonable” mock fallback. Live mode is explicit. Recorded replay is source-scoped and exact-request matched; replay misses must never trigger a live call.

Keep probabilities, confidence, scores, observed frequencies, and assertion pass rates distinct. Do not invent confidence for binary answers or multiply model probabilities into a claimed full-path probability. Score may be fractional.

Unvisited is not the same as unreachable. Unlabeled is not the same as correct. Changed behavior is not automatically a regression. Infrastructure failure is not a business outcome. Partial/incompatible runs cannot produce a clean comparison gate.

## Provider integration

Consult the official TypeSafe API and primitive documentation linked in the design before implementing `provider-jev`. Record requested and actual model identities. Put all HTTP retries under one observable, bounded policy. Preserve usage as unknown when it is unavailable.

An official package named `@typesafe-ai/sdk` exists, but the design permits a thin direct HTTP adapter for transparent attempt accounting. Do not fabricate an SDK or assume undocumented parameters. If using the SDK, avoid double retry layers.

Do not send live requests automatically. The owner having access does not authorize paid integration testing. Live smoke testing requires an explicit enable flag and locally configured credentials.

## Data and security

Bind local services to loopback and implement the design's Host/Origin/mutation controls. Do not expose the unauthenticated POC publicly. Avoid wildcard CORS and arbitrary filesystem paths from HTTP clients.

Never read unrelated secrets, log keys, expose credentials in browser variables, or add analytics by default. Ignore local data, `.env`, private traces, and generated run reports in Git. Include empty placeholders in `.env.example`.

Do not publish packages, assign a public license, deploy, provision paid infrastructure, or install unrelated services without owner direction.

## Tests and completion evidence

Implement schema, graph, expression, provider-contract, evaluation, replay, persistence, and browser tests in the milestones that introduce those features. Ordinary tests are network-free.

The provisional example has twelve cases, sixteen baseline judgments, fourteen candidate judgments, two new assertion regressions, and one improvement. Baseline has one existing failure, so a baseline CLI run should exit 1 after writing its report. Do not alter the labels to manufacture a perfect result.

`expected-results.json` is an independently checked expectation file, not an actual runtime recording. Generate recordings using the implemented runner before testing replay.

After each milestone, report files changed, commands actually run, results, limitations, and the next milestone. Never claim tests passed when they were not run. Keep `README.md` setup commands current. Record material contract deviations in a short decision note and update schemas/examples/tests together.
