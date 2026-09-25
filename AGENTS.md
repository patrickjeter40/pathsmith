# Pathsmith: instructions for coding agents

## Read first

Read `PATHSMITH_DESIGN.md` or, after it is moved during scaffolding, `docs/PATHSMITH_DESIGN.md`. The design document is the product/architecture authority. Read the current milestone before editing. Use the checked JSON examples rather than inventing a different workflow contract.

The owner approved a general-purpose tool, visual authoring backed by JSON, a local-first React/NestJS application, a portable TypeScript runtime, mock/live providers, and a future hosted service. The business demo is provisional. Do not introduce game-specific concepts.

## Task assessment and execution routing

For each request, assess scope, ambiguity, and consequences of errors
using the request and relevant repository context.

Select the minimum relevant installed skills. Read their instructions
before doing the work they govern.

Handle straightforward requests directly. Delegate bounded work to
configured specialist agents when their capabilities or independent
review would materially improve the result. Do not spawn agents merely
to perform this assessment.

Use the configured implementation agent for ordinary changes.
Use the configured architecture/review agent for changes to execution
semantics, shared contracts, persistence migrations, security boundaries,
or difficult cross-package behavior.

Reassess when investigation reveals greater complexity. Validate results
with appropriate tests rather than treating task classification as proof
that a particular model is sufficient.

For substantive tasks, briefly state the selected approach and skills.
Do not claim that the main model or effort setting changed unless it
actually changed through a supported client control.

Preserve existing approval and sandbox restrictions.

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

<!-- BEGIN PATHSMITH CODEX ROUTING v1 -->
## Task routing, effort, and skills

Apply this policy to every request in this repository. It supplements the product
rules above; it does not authorize new product scope, spending, or permissions.
Use the main session as coordinator. Its project default is GPT-6 Sol / medium,
subject to the user's effective client settings and workspace policy.

### Choose work, not an agent ceremony

First inspect enough relevant repository context to judge scope, uncertainty,
consequences of failure, and necessary validation. Do not spawn a classifier or
call Jev to make this assessment. For a trivial fix or short factual answer,
work directly with no mandatory delegation. Reuse context already gathered.

For substantial work, explicitly delegate a bounded task to the relevant
configured agent when isolation, capability, or independent review adds value:

| Agent name | Assigned work | Configured model / effort |
| --- | --- | --- |
| `pathsmith_explorer` | Locate code, follow dependencies, collect evidence; no edits. | `gpt-6-luna` / `high` |
| `pathsmith_implementer` | Ordinary implementation under established contracts. | `gpt-6-sol` / `medium` |
| `pathsmith_architect` | Architecture decisions and difficult core implementation when asked. | `gpt-6-astra` / `high` |
| `pathsmith_reviewer` | Independent design or high-risk code review; no edits. | `gpt-6-astra` / `xhigh` |
| `pathsmith_verifier` | Run checks, investigate failures, and add tests only when assigned. | `gpt-6-sol` / `high` |

Use `pathsmith_architect` for execution semantics, graph dominance, expressions,
hashing, immutable snapshots, replay matching, comparison correctness, migrations,
provider retry/usage accounting, credential boundaries, or a difficult defect
that persists after a focused diagnosis. In a plan/review request, the architect
must not implement. In an implementation request, explicitly give it the relevant
write scope. Ordinary UI/forms/CRUD work stays with the implementer unless it
changes a sensitive boundary.

Use a fresh `pathsmith_reviewer` for an initial design review, substantial changes
to those sensitive boundaries, explicit review requests, and milestone exit
reviews. Do not invoke this expensive profile for every small edit. Supply the
requirements, target diff/files, and test evidence, not just the author's account.
A fresh reviewer provides another check, not a guarantee or a human approval.

### Select skills from the actual task

Read the relevant installed `SKILL.md` before its work. Select the smallest useful
set; do not load every skill by default or invent tools a skill does not provide.
Repository skills are in `.agents/skills/`:

- `pathsmith-runtime`: workflow contracts, graph/expression semantics, traces,
  coverage, comparisons, replay, and portable-runtime parity.
- `pathsmith-ui`: React authoring, canonical graph round-trips, inspectors,
  scenarios, and run/compare screens.
- `pathsmith-provider`: Jev transport, response validation, retries, usage,
  model identity, mocked transport, and server-only secrets.
- `pathsmith-verification`: acceptance criteria, test planning, execution,
  regression reproduction, and completion evidence.

Use other relevant installed skills when they fit, without installing services
or granting permissions just to satisfy a skill. Skills provide procedures;
they do not change the model. No skill is a substitute for reading actual code.

### Bound delegation and protect the working tree

Keep at most three spawned threads open. This is a concurrency limit, not a
spending limit. Avoid recursive delegation: children return blockers to the
coordinator instead of spawning grandchildren. Close completed threads.

Default to one source-code writer at a time, including the coordinator. Assign
files/packages and acceptance criteria in every write task. Exploration can run
alongside writing only on independent, stable files. Run final verification and
review against a stable completed diff, not a moving implementation. Do not
publish, commit, push, delete unrelated files, or revert another contributor's
changes without authorization. Permission prompts remain in force.

Each delegation must state goal, relevant sources, read/write scope, selected
skills, required checks, and what result to return. Do not repeat the same full
implementation in the main thread while a child is doing it. The coordinator
integrates outputs, reconciles conflicting evidence, and owns the final answer.

### Escalate honestly

A custom profile's model/effort is configured in its TOML file. Do not claim a
main-session model change merely because this policy chose a role. Do not edit
agent configs mid-task to manufacture an escalation. Delegate to a suitable
available role, or report that the client cannot provide the requested setting.
If a named model/role is unavailable, do not invent a replacement ID or silently
use a different configuration. State the fallback; use a confirmed available
profile only when adequate, otherwise return a precise blocker.

For substantive work, announce the task approach and selected skills in one
sentence. Name a configured profile as configured, not as proof of runtime
execution. Report the actual spawned model/effort only when client metadata
confirms it. At completion give changes, commands actually run, outcomes,
unresolved risks, and whether independent review was completed. No fabricated
passing checks, inferred usage, or claims that routing is statistically optimal.
<!-- END PATHSMITH CODEX ROUTING v1 -->
