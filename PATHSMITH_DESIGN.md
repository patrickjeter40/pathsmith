# Pathsmith
## Product and technical design for the proof of concept

**Document version:** 0.1  
**Prepared:** September 24, 2026  
**Audience:** Project owner and Codex implementation agent  
**Status:** Approved product direction; proposed implementation contract  
**Primary objective:** Scaffold a working, testable foundation—not a simulated dashboard.

> **Pathsmith helps developers build, test, trace, and compare probabilistic decision workflows.**
>
> The first product milestone is a complete loop: author a workflow, run a scenario, inspect its decisions, execute a labeled suite, change a policy or question, and compare the results.

This document specifies software to be implemented. It does not claim that the Pathsmith application, its packages, or any production integration already exist. The accompanying JSON schemas and synthetic examples are starter design artifacts. The separate validation report describes checks performed on those artifacts, not tests of a finished application.

## Contents

1. Decisions and scope
2. Product behavior and proof-of-concept goals
3. Architecture and repository
4. Canonical artifacts and versioning
5. Workflow and node contract
6. Expression language and data dependencies
7. Execution semantics
8. Provider contract and Jev adapter
9. Mock, live, and recorded-replay modes
10. Scenarios, assertions, and evaluation
11. Coverage and comparison semantics
12. Traces and error handling
13. Storage and local jobs
14. HTTP API
15. User interface
16. Portable runtime and CLI
17. Security, privacy, and resource controls
18. Hosted-service migration boundaries
19. Replaceable business demonstration
20. Tests and acceptance criteria
21. Implementation milestones
22. Engineering instructions and deferred decisions
23. Source notes

---

## 1. Decisions and scope

### 1.1 Confirmed product decisions

| Decision | Direction |
|---|---|
| Audience | General-purpose application developers; no game-specific domain objects. |
| Demonstration | Broad business application. The support-routing fixture in this pack is provisional and replaceable. |
| Authoring | Visual editor backed by a documented, versioned JSON definition. JSON is the semantic source of truth. |
| First deployment | Single-user, local-first browser application plus a local backend. |
| Next deployment | Hosted service after the proof of concept. Preserve boundaries now; do not build the hosted platform now. |
| Production execution | Export a workflow and execute it in a developer's own backend using a portable TypeScript runtime. |
| Runtime parity | The application, CLI, and exported integration use the same execution implementation. |
| MVP value | Build → inspect → test → change → compare. |
| Stack | TypeScript, React, NestJS, one repository. |
| Initial model integration | TypeSafe Jev. The project owner already has access; no credentials are supplied in this pack. |
| Offline development | Deterministic synthetic mocks. Routine development and CI must not require paid requests. |

### 1.2 Implementation defaults selected by this design

These are deliberate design choices, not claims about the only viable architecture.

Use a pnpm workspace, React with Vite, React Flow for the editor, NestJS with its normal HTTP adapter, and SQLite through Drizzle with better-sqlite3 as the local driver. Target Node.js 24 LTS. Pin exact dependency versions during scaffolding and commit a lockfile; do not freeze guessed patch versions in this document. Official references for these choices are listed in §23. [S9–S14]

Use JSON Schema 2020-12 and Ajv for wire validation. The bundled schemas are the starting contract. Generate TypeScript wire types from them, or provide an equivalence check if the selected generator cannot represent the recursive expression union. Do not maintain conflicting schemas in the frontend and backend. [S13]

The MVP supports acyclic workflows with one active control-flow path per execution. A node may ask several independent model questions together; this is not parallel execution of multiple workflow branches.

### 1.3 Included and explicitly excluded

**Included:** project/workflow management, graphical and JSON authoring, scenario editing, immutable workflow and suite snapshots, single and batch execution, deterministic policies, structured traces, observed branch coverage, labeled assertions, baseline/candidate comparison, strict recorded replay, Jev and mock adapters, workflow export, and a headless CLI.

**Excluded:** arbitrary TypeScript imports or reverse engineering, arbitrary code nodes, loops, concurrent branch joins, agent tool execution, hosted production execution, automatic external actions, automatic scenario generation, LLM-as-judge scoring, generated explanations, production log ingestion, drift alerts, billing, subscriptions, organization management, authentication, cloud queues, and plugin marketplaces.

Do not add excluded features merely to make the product appear more complete.

## 2. Product behavior and proof-of-concept goals

### 2.1 Primary user journey

A developer creates or imports a workflow and declares its input schema. They add model judgments that return typed results, then explicit deterministic branches that turn those results into an outcome. They run one scenario and inspect exactly which nodes and edges executed.

The developer then runs a saved scenario suite with expected outcomes. They save a candidate workflow with a changed threshold, question, or rubric and compare it with the baseline. Pathsmith shows changed paths, new assertion failures, improved cases, infrastructure errors, and coverage gaps separately.

The developer exports the definition and runs it outside the Pathsmith application. The same fixture inputs and provider responses must yield the same outcome and path there.

### 2.2 What the proof of concept must establish

The product must answer four questions with actual executions:

- Can a developer construct useful branching logic without hand-writing an application-specific harness?
- Can they explain an unexpected outcome from recorded inputs, outputs, and policy evaluations?
- Can they see precisely which labeled cases a change improves or breaks?
- Can they reuse the workflow without depending on Pathsmith's server in production?

These are product hypotheses to test, not established market demand. No revenue forecast or claim of a defensible business is implied by this specification.

### 2.3 Completion standard

A proof of concept is complete only when an editable workflow, persisted runs, a baseline/candidate comparison, and an exported-runtime parity test work end to end. A graph whose buttons merely display hard-coded results does not satisfy this standard.

## 3. Architecture and repository

### 3.1 Runtime boundaries

```text
React browser application
  author / inspect / compare
             |
      Local NestJS API
  projects / snapshots / jobs / queries
       |                    |
       |              Repository interfaces
       |                    |
       |                SQLite adapter
       v
 Shared evaluation runner
       |
 Shared workflow runtime  <---- CLI and standalone application
       |
 Named provider bindings
       +-- deterministic mock
       +-- TypeSafe Jev
       +-- strict recorded replay
```

There is one semantic validator, one expression evaluator, one workflow executor, one assertion evaluator, and one comparison implementation. The UI must not implement a second execution engine.

### 3.2 Proposed workspace

```text
pathsmith/
  apps/
    web/                         React, Vite, React Flow
    api/                         NestJS controllers, services, local jobs
  packages/
    contracts/                   JSON schemas, wire types, graph validation
    core/                        Expressions, execution, hashing, traces
    evaluation/                  Suites, assertions, coverage, comparisons
    provider-jev/                HTTP transport and response normalization
    provider-mock/               Exact-request synthetic fixtures
    provider-replay/             Source-scoped recorded-response lookup
    storage/                     Repository interfaces and SQLite adapter
    cli/                         Validate, run, compare; no API dependency
  examples/
    support-routing/             Replaceable demonstration from this pack
    standalone/                  Consumes built packages, not private source
  schemas/                       Checked-in artifact contracts
  docs/
    PATHSMITH_DESIGN.md
    decisions/                   Short architecture decision records
  tests/
    integration/
    e2e/
  AGENTS.md
  README.md
  .env.example
  .gitignore
  pnpm-workspace.yaml
  package.json
  pnpm-lock.yaml
```

`@pathsmith/*` names in this document are proposed private workspace names, not claims of npm availability. Mark packages private initially. Do not publish or choose a public license without an explicit owner decision.

### 3.3 Dependency rules

`contracts` must remain usable in the browser and must not import NestJS, a database driver, or credentials. `core` may depend on contracts but not the API, database, React, or a concrete model provider. Provider adapters depend on the provider interfaces, never on UI code. `evaluation` consumes core and contracts. Storage does not own execution semantics.

The core initially targets Node.js backends. Browser-only, edge-runtime, and non-TypeScript production execution are not promised. The frontend imports only browser-safe exports. Test the built package exports in the standalone example instead of hiding module-resolution issues behind source aliases.

### 3.4 Keep the backend modular, not distributed

Use NestJS modules for projects, workflows, suites, runs, providers, and local configuration. One API process and one local database are sufficient. An in-process job runner executes work after persisting job metadata. No Redis, microservices, Kubernetes, or message broker is required.

## 4. Canonical artifacts and versioning

### 4.1 Three distinct kinds of state

**Workflow definition:** execution semantics in a `.workflow.json` file, validated against `schemas/workflow.schema.json`.

**Presentation:** node positions, viewport, selected tab, and panel sizes. Store separately from semantic data; the example uses `layout.json`.

**Run artifacts:** immutable workflow/suite snapshots, execution profile, limits, input, outputs, traces, and provenance.

React Flow's node/edge representation is a rendering model, not the wire contract. Translate it into and out of the canonical workflow definition.

### 4.2 Drafts versus executable versions

Drafts are mutable and carry an integer `draftRevision`. Persist syntactically valid JSON drafts even when the graph is incomplete, together with validation diagnostics. Invalid JSON text can remain in an unsaved editor buffer; do not replace a valid draft silently with failed parse output.

Publishing a version, starting a run, and exporting a runnable workflow require full schema and semantic validation. A run from the current editor must first capture an immutable executable snapshot. Editing a draft must never mutate a previous run's meaning.

A stale update carrying the wrong expected revision returns `409 DRAFT_CONFLICT`; it must not overwrite newer data. This matters locally when two browser tabs edit the same workflow.

### 4.3 Hashes

Implement one documented canonicalization function: recursively sort object keys; preserve array order; reject non-finite numbers; encode as UTF-8 JSON; hash with SHA-256. Sort workflow `nodes` and `edges` by stable ID before semantic hashing, because their array order is not execution order. Preserve branch-case order and score-level order.

`workflowSemanticHash` includes format version, declared bindings, schemas, node IDs and executable configuration, and edges. Exclude workflow name/description and node labels. Layout is already separate.

`artifactHash` covers the complete saved definition. `suiteSnapshotHash` covers the entire suite snapshot. A comparison additionally records its sorted selected scenario IDs. Question text and rubric edits are semantic changes, including whitespace changes; do not normalize them away.

Include runtime version, adapter version, normalizer version, mode, execution profile, and requested/resolved model identities in run metadata. Semantic equality is not a promise of repeatable live inference.

### 4.4 Compatibility policy

Start with `formatVersion: "0.1"`. Reject unsupported versions with a useful diagnostic. Do not silently reinterpret unknown node kinds, operators, or question fields. Future migrations must be explicit, tested, and produce a new artifact; never rewrite historical snapshots in place.

## 5. Workflow and node contract

### 5.1 Top-level fields

The authoritative initial shape is in `schemas/workflow.schema.json`:

```text
formatVersion, id, name, description
bindings: named provider slots
inputSchema, outputSchema
nodes: semantic node definitions
edges: { id, source, port, target }
```

Bindings are symbolic names such as `decisions`, not embedded credentials or hard-wired model endpoints. A run profile maps them to concrete providers and requested models. Each judgment must reference a declared binding; unused declared bindings produce a warning, and their credentials are not required unless a node uses them.

A workflow's output schema validates the terminal node's `value`. The runtime returns the terminal `outcomeId` separately. Outcome IDs are stable business identifiers, not model-generated text.

### 5.2 Node types

| Kind | Meaning | Outgoing ports |
|---|---|---|
| `start` | Entry point; input is already validated. | Exactly `next`. |
| `judgment` | Resolve state, ask a map of typed questions, store normalized answers. | Exactly `next`. |
| `transform` | Evaluate a safe expression and store its JSON value. | Exactly `next`. |
| `branch` | Evaluate ordered Boolean cases and choose the first true case. | One per case ID, plus required `default`. |
| `output` | Produce a stable outcome ID and schema-validated JSON value. | None. |

Every required outgoing port must have exactly one edge. Do not store an additional `nextNodeId` alongside edges. That would create competing sources of truth. A branch case ID cannot be `default` or `next`.

Multiple incoming edges are allowed. They represent alternative control-flow paths, not a synchronization barrier. A node executes only when the single active path reaches it.

### 5.3 Provider-neutral question types

Pathsmith's question vocabulary is deliberately small:

```typescript
// Conceptual public types; generate the precise wire types from the schemas.
type Question =
  | { kind: "choice"; instructions: string; options: Record<string, string> }
  | { kind: "score"; instructions: string; levels: string[] }
  | { kind: "binary"; instructions: string;
      trueCriteria?: string; falseCriteria?: string };
```

All options and levels need meaningful descriptions in this first authoring experience. Structured instructions, nested rubric objects, and description-less choices are outside the initial Pathsmith contract, even where a provider supports them. This is an intentional subset, not a description of Jev's full API.

The Jev adapter maps `choice`, `score`, and `binary` to TypeSafe Choice, Score, and Noul respectively. [S2–S5]

### 5.4 Normalized answer types

```typescript
type Answer =
  | { kind: "choice"; value: string;
      probabilities: Record<string, number>; confidence: number }
  | { kind: "score"; value: number;
      probabilities: Record<string, number>; confidence: number }
  | { kind: "binary"; probabilityTrue: number };
```

Do not invent a `confidence` property for the binary answer. Keep the original provider response, including Score legends, in the bounded exchange record; executable policy reads only validated normalized answers.

The supplied mock-fixture schema also specifies these normalized shapes. In the implementation, generate both schemas from a shared definition or check that their question/answer contracts cannot diverge.

## 6. Expression language and data dependencies

### 6.1 Safe expression AST

No `eval`, `new Function`, dynamic module loading, shell commands, script nodes, template code execution, or arbitrary HTTP calls are permitted in workflow definitions.

Supported AST forms:

| Form | Shape or behavior |
|---|---|
| `literal` | `{ op: "literal", value: <JSON> }` |
| `ref` | `{ op: "ref", path: ["input", "field"] }`; explicit path segments, never a JavaScript expression. |
| `object` | `{ op: "object", fields: { key: <expression> } }` |
| `array` | `{ op: "array", items: [<expression>, ...] }` |
| Binary operators | `{ op, left, right }` for `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `add`, `sub`, `mul`, `div`, `in`. |
| Variadic operators | `{ op, args }` for `and`, `or`, `coalesce`; at least one argument. |
| Unary operators | `{ op, value }` for `not`, `exists`. |

Allowed runtime roots are `input` and `outputs`. Assertion evaluation also exposes `result: { outcomeId, value }`. Node configuration may not reference `result`.

### 6.2 Evaluation rules

References use own properties only. Reject dangerous object/path keys `__proto__`, `prototype`, and `constructor` in executable dictionaries and imported JSON. Numeric path segments address array indexes only. A missing path produces an internal `Missing` sentinel; it is not `null`, false, zero, or an empty string.

Comparisons are strict and do not coerce types. `eq` and `ne` accept JSON scalar values; objects and arrays require explicit field comparisons. Ordered comparisons and arithmetic accept finite numbers only. `in` tests scalar membership in an array of scalars using strict equality. Division by zero, non-finite results, and invalid operand types fail evaluation.

`and` and `or` short-circuit and require Boolean operands. `not` requires a Boolean. `exists` is false only for `Missing`; a present null value exists. `coalesce` evaluates left to right and skips `Missing` and null; if all operands are skipped, it returns null. Missing values used elsewhere cause `EXPRESSION_MISSING_VALUE`.

Literal strings are data, never interpolated code. To construct model state, use `object`, `array`, and `ref` explicitly. Do not add an implicit template language.

### 6.3 Explicit data availability

A judgment writes its answer map to `outputs[nodeId]`. A transform writes its computed JSON to the same namespace. Start and branch nodes do not produce reusable output values. The terminal output becomes `result`, not a new value available to earlier nodes.

A node may reference another node's output only when that producer executes on **every** control-flow path leading to the consumer. Implement this with dominator analysis over the validated acyclic graph. A producer must strictly dominate the consumer and must be a judgment or transform.

A reference merely pointing to a graph ancestor is not sufficient. For example, a merge after alternatives A and B cannot read A's output when the B route skips A. MVP workflows must either move the shared computation before the split or use separate downstream nodes. Do not add implicit merge/default semantics.

Reject whole-`outputs` references in executable node expressions; require the producer node ID. This prevents accidentally sending path-dependent global state to a model. Whole-input references are allowed.

### 6.4 Input and output schemas

Support the restricted data-schema grammar included in the workflow schema: one `type`, properties, required fields, Boolean additional-properties policy, array items, enum, numeric bounds, string-length bounds, array-length bounds, title, and description. Do not support remote references, `$ref`, custom formats, regular expressions, recursive user schemas, or executable validation hooks in v0.1.

Validate without coercion, default insertion, or silent property removal. Unsupported schema keywords are errors. Optional input fields are allowed, but accessing one requires explicit `exists` or `coalesce` handling when absence is possible.

The top-level format schema checks shapes. Additional semantic checks must validate keyword applicability, schema correctness, data dependencies, reference paths where statically knowable, and all limits in §17.

## 7. Execution semantics

### 7.1 Compilation/preflight

Before any live request, validate the workflow, input or every selected suite input, referenced bindings, execution limits, and assertion definitions. Preflight must detect:

- Duplicate IDs, unknown edge targets, missing/duplicate outgoing ports, and undeclared bindings.
- Anything other than one start node, incoming edges to start, outgoing edges from outputs, cycles, or disconnected nodes.
- A reachable path that cannot terminate at an output.
- Invalid branch case IDs, unsafe expressions, unavailable output references, and schema violations.

Disconnected nodes may be preserved in drafts, but an executable snapshot must not contain them. Return diagnostic codes, node IDs, and JSON pointers instead of only a generic error message.

### 7.2 Traversal

Create an immutable input reference and an initially empty output map. Enter the start node, follow its `next` edge, and execute nodes sequentially. After a successful judgment or transform, store its output and follow `next`.

For a branch, evaluate cases in array order. Select the first true case; do not evaluate later cases. If no case is true, select `default`. The trace must distinguish false from not evaluated. Array order, not edge position on the canvas or edge array order, determines priority.

An expression error is not a false condition. A provider error is not a low-confidence judgment. Neither should fall through to a normal business outcome.

For an output node, compute `value`, validate it against `outputSchema`, emit the terminal event, and finish with `status: "completed"`. The output describes a recommendation; it does not execute the recommended external action.

### 7.3 Determinism

The traversal, transformations, and policies must be deterministic given a validated workflow, input, and recorded provider responses. Do not sample a branch from the returned probability distribution. A `0.7` threshold means the configured comparison, not a 70% chance of choosing that branch.

Randomized scenario generation and stochastic policies are deferred. Do not expose a seed option that pretends to control live Jev inference.

### 7.4 Independent questions versus dependent stages

Within one judgment node, all questions use the same resolved state. One question cannot consume another answer from that same node. A dependent question belongs in a later judgment node whose state explicitly includes the earlier answer.

This matches TypeSafe's documented per-request question isolation. It does not imply statistical independence of the answers. [S1]

No speculative batching across future graph branches in the MVP. It complicates cost, coverage, and replay semantics. The initial batching unit is exactly one reached judgment node.

## 8. Provider contract and Jev adapter

### 8.1 Adapter boundary

Proposed public interfaces:

```typescript
interface EvaluationRequest {
  model: string;
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, Question>;
}

interface EvaluationResponse {
  model: string;                       // Actual provider-reported model
  answers: Record<string, Answer>;
  usage: { inputTokens: number; outputTokens: number } | null;
}

interface JudgmentProvider {
  id: string;
  version: string;
  evaluate(
    request: EvaluationRequest,
    context: {
      signal: AbortSignal;
      runId: string;
      scenarioId: string | null;
      nodeId: string;
      binding: string;
      // Trace/attempt hooks are injected, not a global logger.
    }
  ): Promise<EvaluationResponse>;
}
```

Validate resolved state to a provider-supported top-level shape before calling. A scalar number, Boolean, or null produced by an expression is an invalid judgment state in this MVP; wrap it in an explicit object.

The adapter must expose transport attempts to the runner's budget/tracing mechanism. Do not bury unobserved retries behind `evaluate`. Keep run cancellation wired through to the HTTP request.

### 8.2 Verified Jev transport

TypeSafe documents `POST https://api.typesafe.ai/v1/systemone`, bearer authentication, and request fields `state`, `model`, and `questions`. Answers are keyed by the submitted question IDs. The response includes model identity and token usage. [S2]

The initial adapter may use Node's `fetch` directly to make attempt accounting explicit. An official JavaScript/TypeScript SDK exists as `@typesafe-ai/sdk`; using direct HTTP is a project choice, not a claim that a supported SDK is missing. Do not install a guessed package name. [S8]

Use `TYPESAFE_API_KEY` on the server or standalone application only. The execution profile selects a model; `jev-latest` is the convenience default. TypeSafe documents moving aliases and a response model field, so record both requested and resolved identities. Encourage an explicit version for evaluation baselines rather than assuming an alias is immutable. [S7]

### 8.3 Mapping

| Pathsmith request | Jev request | Pathsmith response |
|---|---|---|
| `choice`, `options` | `type: "choice"`, `criteria: options` | `value` from `choice`; preserve probabilities/confidence. |
| `score`, `levels` | `type: "score"`, `criteria: levels` | `value` from `score`; preserve probabilities/confidence. |
| `binary` | `type: "noul"`; optional true/false criteria | `probabilityTrue` from `noul`. |

Choice returns a selected option and distribution. Score is a probability-weighted position on the ordered level indexes, so it may be fractional; a three-level rubric spans 0 through 2, not automatically 0 through 1. Noul returns a yes probability. [S3–S5]

Confidence is a distribution-derived statistic on Choice and Score, not the probability that the entire workflow is correct. Noul does not carry the separate confidence field. Pathsmith must not fabricate the provider's confidence formula or equate it with the maximum option probability. [S6]

### 8.4 Response validation

Treat every HTTP response as untrusted input even when the provider advertises typed outputs. Require the requested answer keys and answer kinds; reject missing or extra answer keys. Require finite probabilities in [0, 1]. Choice keys must match submitted options; Score keys must match the string indexes of its levels.

Use an absolute tolerance of `1e-4` for probability sums and a Score's weighted-mean consistency check. Confidence must be finite and in [0, 1]. A selected Choice must be a maximum-probability option within tolerance; ties are allowed and the provider's chosen label is preserved. Do not reselect it independently.

Validate Score legend keys and retain the original legend in the exchange record. Unknown top-level provider metadata may be retained within size limits but is never exposed to policy expressions. Do not silently clamp, normalize, fabricate missing values, or turn a malformed response into an outcome. Fail with `PROVIDER_INVALID_RESPONSE`.

### 8.5 Retry ownership

Own retries in one place. Initial policy: at most three transport attempts total per logical call, ten-second per-attempt timeout, exponential backoff with bounded jitter, and a thirty-second scenario deadline. These are configurable Pathsmith defaults, not TypeSafe guarantees.

Retry rate-limit responses, selected transient 5xx responses, and transient transport failures. Respect a valid `Retry-After` value only within remaining deadline and attempt limits. Do not retry user cancellation, authentication failures, malformed requests, or a successfully received but invalid answer body.

If using the official SDK later, disable its internal retries or replace the runner's retries so attempts are never multiplied. TypeSafe documents rate limits as changeable; do not encode the website's published limits as permanent capacity. [S7]

## 9. Mock, live, and recorded-replay modes

### 9.1 Mock mode

Mock is the default. It requires no API key, no network access, and no random fallback. Each supplied fixture matches `(scenarioId, nodeId, binding)` plus the exact normalized request, including model, state, and questions.

A mismatch is `MOCK_REQUEST_MISMATCH`, not an invitation to guess an answer. This makes a changed question visible in tests. Fixtures are synthetic and carry `origin: "synthetic"`; their provider/model identity is `mock` / `mock-v1`. They report no live token usage or cost.

### 9.2 Live mode

Live evaluates every reached judgment with the chosen provider. An explicit user action selects live mode. The UI warns that scenario state and question text will leave the local machine and that usage may be billed. The default test and development commands must never opt into live mode implicitly.

A pinned model name improves provenance but does not establish deterministic responses. When a run contains multiple resolved model versions for the same binding, flag it as mixed-model and block an unqualified release-gate verdict until the user explicitly accepts that limitation.

### 9.3 Strict recorded replay

Replay executes deterministic logic again while looking up recorded model responses from a **specific source run**, without making any provider calls.

A lookup is scoped by source run, scenario ID, node ID, binding, and exact logical-request fingerprint. The fingerprint covers original provider identity, adapter/normalizer versions, requested model, resolved state, and question definitions. The source record retains its resolved model. Replay uses that original profile for matching; it must not try to resolve an alias against today's live service.

Replay does not invalidate a source record simply because a downstream threshold changed. However, changed state or questions require a different response. Reaching a judgment that never ran in the source scenario also requires a missing response. Both cases produce `REPLAY_MISS` with the node ID and mismatch explanation.

**Never fall back to a live call during strict replay.** Do not reuse another scenario's answer merely because it looks similar. Do not reuse answers from an unexecuted branch. Cross-run/global response caching is not part of v0.1.

### 9.4 What replay can and cannot establish

A completed replay shows the consequences of a policy change **conditional on the recorded model responses**. It does not show what Jev would return on a new call, measure current model quality, or prove an unseen branch safe.

Report current provider attempts and billed-token usage as zero for replay. Display historical source usage separately when available; never add it to the replay's new usage. Source provenance remains visible: replay of a mock run is still synthetic, not a live evaluation.

### 9.5 Comparison modes

For a threshold-only change, recommend strict replay against a saved source run. For changed questions, changed model versions, or changed state construction, recommend fresh live runs on the same labeled suite. If both workflow and model change together, display the change as confounded rather than attributing every outcome difference to the workflow edit.

## 10. Scenarios, assertions, and evaluation

### 10.1 Suite contract

Use `schemas/suite.schema.json`. Each scenario has a stable ID, name, tags, input, and optional `expected` object. Expected values can specify:

```json
{
  "allowedOutcomes": ["billing_priority"],
  "requiredNodes": ["assess_request"],
  "forbiddenNodes": [],
  "assertions": []
}
```

`assertions` holds Boolean expressions over input, executed outputs, and result. All specified requirements must pass. An empty expected object is a semantic validation error; omit it for an unlabeled scenario. Duplicate scenario IDs and contradictory required/forbidden nodes are invalid.

Check referenced outcome and node IDs against the workflow before a suite runs. A nonexistent forbidden node must not silently pass. Inputs that do not match the input schema invalidate preflight; malformed-input testing belongs in validator tests, not an ordinary passing business suite.

### 10.2 Assertion semantics

A completed execution is an assertion pass only when every expectation passes. An assertion expression that reads an unexecuted output or has a type error is a failed assertion with its own diagnostic, not an infrastructure failure and not a skipped assertion.

Unlabeled scenarios have `assertionStatus: "not_evaluated"`; never count them as correct. A manual-review outcome can be an expected successful outcome. Provider timeouts, cancellation, missing recordings, and invalid response bodies are execution statuses, never business outcomes.

### 10.3 Suite execution

Snapshot the selected scenario list, workflow, suite, profile, and limits before starting. Validate every selected scenario before the first live request. Run scenarios with bounded concurrency, preserving their original IDs for pairing and stable display order.

Persist each completed scenario and its traces incrementally. A bad scenario must not erase already completed results. Queue-level cancellation stops dispatching new work and signals in-flight executions; it cannot promise that already submitted requests will be unbilled.

### 10.4 Reported counts and denominators

Always show selected, completed, failed execution, canceled/interrupted, labeled, unlabeled, passed assertions, and failed assertions.

`Labeled completed pass rate = assertion passes / labeled completed executions`.

`End-to-end labeled success rate = assertion passes / selected labeled scenarios`.

`Execution completion rate = completed executions / selected scenarios`.

For a zero denominator, display `N/A`, not 0% or 100%. Do not hide errors behind a high pass rate on only the cases that finished. The provisional demo has authored labels; do not present its result as real-world model accuracy.

## 11. Coverage and comparison semantics

### 11.1 Observed coverage

Branch coverage measures **selected outgoing branch ports**, including each default port, on one workflow version and one displayed scenario cohort:

```text
observed branch coverage =
  distinct traversed outgoing branch ports /
  all outgoing branch ports in the validated workflow
```

A branch predicate evaluating false is not coverage of its outgoing edge. Start/judgment/transform `next` edges are included in general edge coverage but excluded from this branch-coverage denominator.

Display absolute counts as well as percentages. On the graph, distinguish `visits / started scenarios` from `edge traversals / visits to that source branch`. The second is conditional on reaching the branch. Zero visits yield N/A conditional rate.

Count observed execution events even in partial runs, but mark their coverage as partial and show the completion count. An error before an edge selection does not cover that edge.

### 11.2 Do not overclaim reachability or probabilities

The semantic validator can establish structural reachability in the graph. Zero observed visits does **not** establish that a condition is impossible. Label it `unvisited in this cohort`, not `unreachable`.

Do not claim path coverage over every possible path. Do not multiply node probabilities or confidence values to label the probability of a complete outcome. Shared inputs, dependent stages, and policy thresholds prevent that shortcut from being justified.

Full observed branch coverage does not establish correct behavior. The example suite deliberately illustrates this distinction.

### 11.3 Baseline/candidate pairing

A standard comparison requires the same suite snapshot hash and the same selected scenario IDs. Pair by ID, never by row order. Missing cases and input/expectation changes make the comparison incomplete or incompatible; do not silently intersect the sets and issue a pass verdict.

Report per-case:

- Baseline and candidate execution status, outcome, and assertion status.
- Ordered selected edge IDs and the first observed path divergence.
- Assertion details, model provenance, elapsed time, attempts, and replay misses.

A workflow diff shows added/removed nodes and edges, changed questions/rubrics/state expressions, and changed deterministic expressions. Match by stable IDs; do not infer that renamed nodes are identical.

### 11.4 Categorization

**New assertion regression:** baseline completed and passed expectations; candidate completed but failed them.

**Assertion improvement:** baseline completed and failed expectations; candidate completed and passed them.

**New execution regression:** baseline completed; candidate did not complete because of an execution failure. Keep cancellation and interruption explicit, not evidence of a business regression.

**Behavior change:** outcome or selected path changed, whether or not assertions changed. An unlabeled behavior change is not automatically a regression.

**Unchanged failure:** both fail the same or different expectations; show it without counting it as a new regression.

Outcome distribution changes are descriptive counts for the selected cohort. Do not attach significance claims or automatically judge the desired direction.

### 11.5 Release-gate policy

The default comparison gate fails on any new assertion regression. Any incomplete, incompatible, canceled, interrupted, or failed execution produces an inconclusive/error gate rather than a clean pass. Display improvements separately; they do not cancel new failures numerically.

Offer an explicit stricter option to fail when any candidate assertion fails, including previously failing cases. Do not add an LLM judge to decide whether a regression is acceptable.

## 12. Traces and error handling

### 12.1 Required run metadata

A run stores ID, workspace/project, timestamps, mode, source run if replayed, immutable snapshots and hashes, runtime version, sanitized execution profile, adapter/normalizer versions, limits, selected scenario IDs, and final status.

A scenario run stores input snapshot, execution status, assertion status, output or error, visited nodes, selected edges, logical judgment count, actual HTTP attempt count, timing, and usage availability.

### 12.2 Ordered trace events

Each scenario owns an increasing sequence number. Minimum event kinds:

```text
run_started
node_started
judgment_request_resolved
provider_attempt_started
provider_attempt_finished
judgment_completed
transform_completed
branch_selected
output_emitted
node_failed
run_completed / run_failed / run_canceled
```

Node traces include resolved state, question configuration, normalized answers, selected edge, and relevant expression evaluations. Store output records once where possible rather than copying the entire growing context into every event.

A branch trace lists each case as `true`, `false`, `not_evaluated`, or `error` and records evaluated operands. A default selection says that all evaluated cases were false. This is a causal execution trace of application policy, not an explanation of the model's internal reasoning.

Provider attempt records retain attempt number, status/error category, elapsed time, usage if supplied, original and resolved model, fingerprint, and bounded request/response bodies needed for replay. Never store authorization headers. Unknown usage stays null; do not replace it with invented zero usage.

### 12.3 Error taxonomy

Use machine-readable codes and sanitized messages:

```text
WORKFLOW_INVALID          INPUT_INVALID
UNSUPPORTED_FORMAT        DRAFT_CONFLICT
EXPRESSION_MISSING_VALUE  EXPRESSION_TYPE_ERROR
PROVIDER_NOT_CONFIGURED   PROVIDER_AUTH_ERROR
PROVIDER_RATE_LIMIT       PROVIDER_TIMEOUT
PROVIDER_UNAVAILABLE      PROVIDER_INVALID_RESPONSE
MOCK_REQUEST_MISMATCH     REPLAY_MISS
RUN_LIMIT_EXCEEDED        RUN_CANCELED
RUN_INTERRUPTED           STORAGE_ERROR
```

Include `nodeId`, `scenarioId`, and retryability where meaningful. Stack traces and credentials must not appear in ordinary browser errors. Preserve detailed sanitized server diagnostics for development.

### 12.4 Observation failure

For persisted test runs, inability to write required results is a run/storage error, not a successful invisible run. For standalone execution, tracing is optional and disabled by default; an optional observer failure must not rerun an already completed judgment. Provide a documented observer-error policy without implicit model retries.

## 13. Storage and local jobs

### 13.1 Persistence model

Store under a configurable local data directory, default `.pathsmith/` in the project working directory. Ignore it in Git. Use migrations, foreign keys, and transactions; do not make application state depend on browser localStorage.

Proposed tables:

| Table | Essential data |
|---|---|
| `workspaces` | Local workspace ID/name. |
| `projects` | Workspace, project ID/name. |
| `workflows` | Project, mutable draft JSON, draft revision, layout. |
| `workflow_versions` | Immutable definition/layout snapshots and hashes. |
| `suites` | Project, mutable suite draft and revision. |
| `suite_versions` | Immutable scenario/expectation snapshot and hash. |
| `runs` | Job status, version IDs, profile, mode, limits, selection, source run. |
| `scenario_runs` | Per-case status, result, assertion details, path, aggregate counts. |
| `node_traces` | Ordered per-node/event payloads. |
| `provider_attempts` | Requests, answers, fingerprints, attempt/result metadata. |

Comparison reports may be computed from immutable runs initially rather than adding a cache table. Use JSON columns/text for snapshot payloads; do not normalize every graph property into a separate relational table in the proof of concept.

Every resource must be scoped to a workspace, directly or through enforced ownership. Repository methods accept server-derived `WorkspaceContext`. Use composite ownership constraints or equivalent checked foreign-key relationships so a run cannot accidentally attach a suite or source run from another workspace.

### 13.2 Local runner behavior

Persist a run as queued before dispatching it. A single API process claims it, changes status to running, and executes it. Use transactions for claims and a single-process startup lock for the data directory. Do not run multiple API replicas against the local job runner.

On restart, mark abandoned queued/running/canceling jobs as `interrupted`. Preserve completed scenario results. Do not automatically resume or resend live requests; a user rerun creates a new run ID with a clear cost warning.

Use polling for progress in v0.1, approximately once per second while a run is active. Server-sent events and WebSockets are unnecessary for the first milestone.

### 13.3 Retention and deletion

Full local run data is retained because traces and exact replay need it. State clearly that local storage is not application-level encrypted in the MVP. Do not claim automatic personal-data removal.

Allow explicit run deletion and project deletion with confirmation. A source run referenced by a replay run must either block deletion with a clear message or require explicit dependent-run deletion; never leave a misleading replay provenance link.

Exporting full traces requires a warning that inputs, questions, and model responses may contain sensitive information. Workflow-only export does not include runs, scenarios, or credentials.

## 14. HTTP API

Prefix routes with `/api/v1`. Validate requests on the server. IDs and paths are opaque identifiers, not arbitrary filesystem locations. Use JSON error envelopes `{ error: { code, message, details? } }`.

| Route | Behavior |
|---|---|
| `GET /health` | Service and database readiness; no credentials. |
| `GET /providers/status` | Configured/not configured, allowed modes, default model; never key values. |
| `POST /projects`, `GET /projects` | Create/list local projects. |
| `POST /projects/:id/workflows` | Create an empty draft or import a definition. |
| `GET /workflows/:id` | Draft, revision, layout, diagnostics. |
| `PUT /workflows/:id/draft` | Save draft/layout with `expectedRevision`. |
| `POST /workflows/:id/validate` | Schema and semantic diagnostics; no provider calls. |
| `POST /workflows/:id/versions` | Save immutable executable snapshot. |
| `GET /workflows/:id/versions` | Version history and hashes. |
| `GET /workflow-versions/:id/export` | Definition only; optional separate layout export. |
| `POST /projects/:id/suites`, `GET /projects/:id/suites` | Suite creation/listing. |
| `GET /suites/:id`, `PUT /suites/:id/draft` | Read/edit suite with optimistic revision. |
| `POST /suites/:id/versions` | Immutable suite snapshot. |
| `POST /runs` | Preflight and queue a scenario/suite run; returns `202` plus run ID. |
| `GET /runs`, `GET /runs/:id` | History, provenance, progress, aggregate metrics. |
| `GET /runs/:id/scenarios` | Paginated per-case results and filters. |
| `GET /scenario-runs/:id/trace` | Ordered trace details. |
| `POST /runs/:id/cancel` | Idempotent cancellation request. |
| `POST /comparisons` | Compare baseline/candidate run IDs and explicit gate policy. |
| `GET /runs/:id/export` | Explicit full run export with replay/provenance data. |
| `DELETE /runs/:id`, `DELETE /projects/:id` | Explicit confirmed deletion with dependency checks. |

`POST /runs` accepts workflow/suite version IDs, selected scenario IDs, mode, sanitized binding profile, limits, and optional source run ID. A single-scenario inspector run uses a one-case immutable suite snapshot. Avoid a separate execution path for it.

Use `400` for malformed envelopes, `404` for missing scoped IDs, `409` for draft or lifecycle conflicts, and `422` for invalid executable content. Never trust a client-supplied workspace ID or a frontend validation result.

## 15. User interface

### 15.1 Product shell

Use a restrained developer-tool interface. Prioritize legible node labels, useful empty/error states, and trace inspection over decorative animation. Include accessible focus states and text/status icons; color alone cannot convey pass/fail or branch selection.

Top-level areas are Projects, Workflow, Scenarios, Runs, and Compare. A persistent badge identifies Mock, Live, or Recorded Replay. Live mode must be visually unmistakable.

### 15.2 Workflow workspace

```text
[Project / Workflow] [Draft status] [Save version] [Run] [Export]

[Node palette]  [Graph canvas................]  [Node inspector]
               [ports, labels, connections...]  [question / policy]
               [validation markers..........]  [schema / fields..]

[Problems | JSON definition | Selected run trace]
```

The palette exposes only supported node kinds. Adding a node, changing configuration, reconnecting an edge, deleting a node, and editing JSON update the same draft definition. Stable IDs survive label edits.

Provide undo/redo within the current editing session. Canvas layout changes do not mark a semantic version change. Invalid connections receive immediate feedback; server validation remains authoritative. Raw JSON edits may temporarily be invalid, but cannot be run or published.

### 15.3 Judgment inspector

Expose binding, question type, instructions, option descriptions/ordered levels, and state expression. Provide input-field pickers so ordinary users need not write AST JSON for common references. A compact JSON editor remains available for advanced expressions.

For executed nodes, show the actual state, question, response, distribution, confidence where supported, requested/resolved model, elapsed time, attempts, and provenance. The UI must use the snapshot attached to the selected run, not today's draft question text.

### 15.4 Branch inspector

Display ordered cases, their expressions, destination labels, and an explicit default destination. Make precedence visible and allow reordering. On a trace, show the selected port and evaluated operands; later cases should be labeled not evaluated rather than false.

### 15.5 Scenario and suite screens

Use a table with ID, name, tags, expected outcome(s), and validation status. Editing input and expectations should not require a CSV import system. JSON import/export is sufficient initially.

Before live execution, show number of scenarios, provider/model, configured attempt limit, current request concurrency, and a conservative upper bound on logical calls/attempts based on the longest judgment path. Do not promise exact dollar cost when tokenizer, retry usage, or current pricing is unknown.

### 15.6 Trace, coverage, and comparison

Selecting a result highlights the historical execution path on its historical graph. Clicking a node opens its trace. Switching to a coverage overlay shows the cohort, version, counts, denominators, and partial-run warning.

Compare uses per-case rows, filterable by regression/improvement/change/error, with linked baseline and candidate traces. Show a structural/configuration diff and the first observed divergence; do not invent a model explanation for why a probability changed.

## 16. Portable runtime and CLI

### 16.1 Proposed runtime entry point

The final TypeScript signatures may refine names, but must preserve these boundaries:

```typescript
const result = await executeWorkflow({
  workflow,                          // Validated immutable JSON definition
  input,                             // Schema-validated JSON
  bindings: {
    decisions: {
      providerId: "jev",
      model: process.env.TYPESAFE_MODEL ?? "jev-latest",
      adapter: createJevProvider({ apiKey })
    }
  },
  mode: "live",
  signal,
  limits,
  onEvent                           // Optional; no Pathsmith server required
});
```

This is a proposed Pathsmith API, not a verified existing package API. The example implementation must explicitly reject a missing API key before live mode. The runtime returns a discriminated result such as completed with `{ outcomeId, value, traceSummary }`, or failed/canceled with a structured error. It must not return an ordinary outcome on infrastructure failure.

Consumer code, outside the workflow, decides whether and how to act on `outcomeId`. No required connection to Pathsmith, SQLite, an account service, or a hosted endpoint may be introduced into this runtime.

### 16.2 CLI contract

The scaffold should provide a root `pnpm pathsmith` script. Proposed commands:

```sh
pnpm pathsmith validate --workflow examples/support-routing/baseline.workflow.json

pnpm pathsmith run \
  --workflow examples/support-routing/baseline.workflow.json \
  --suite examples/support-routing/suite.json \
  --profile examples/support-routing/mock.profile.json \
  --mode mock \
  --fixtures examples/support-routing/mock-fixtures.json \
  --out .pathsmith/reports/baseline.json

pnpm pathsmith run \
  --workflow examples/support-routing/candidate.workflow.json \
  --suite examples/support-routing/suite.json \
  --mode replay \
  --source .pathsmith/reports/baseline.json \
  --out .pathsmith/reports/candidate.json

pnpm pathsmith compare \
  --baseline .pathsmith/reports/baseline.json \
  --candidate .pathsmith/reports/candidate.json \
  --out .pathsmith/reports/comparison.json
```

Replay derives the binding profile from the source artifact. Passing a conflicting profile is an error. CLI report files include all required snapshots and exchange records for replay; the illustrative expected-result file in this pack is not itself a recording.

`validate` exits 0 for valid content, 2 for invalid content. `run` exits 0 if complete with no assertion failures, 1 if complete with assertion failures, and 2 for configuration/execution failure or incomplete execution. `compare` exits 0 for a passing gate, 1 for assertion regressions, and 2 for an incomplete/incompatible/error gate. All commands write available diagnostic/report output before a nonzero exit.

The demo baseline intentionally exits 1 because one authored expectation fails. Scripts demonstrating all three commands must still run candidate and comparison; do not join them with an unconditional success-only `&&` chain.

### 16.3 Default developer commands

Implement `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, and `pnpm db:migrate`. All routine tests must be network-free. Document an explicitly opt-in live smoke command requiring both a key and an enable flag.

Use a compatible test setup for NestJS decorator metadata rather than assuming every TypeScript transpiler emits it. A conventional Jest/ts-jest server setup and a Vite-compatible frontend test setup are acceptable. Keep the number of tools small, and verify the built standalone consumer.

## 17. Security, privacy, and resource controls

### 17.1 Local does not mean automatically safe

Bind the application to loopback only. Validate Host and Origin, use an explicit development-origin allowlist, and reject arbitrary cross-origin API access. Require a custom request header on mutations to prevent ordinary cross-origin form submissions from triggering operations; do not treat the header as authentication. Configure Vite's proxy/host behavior consistently.

No wildcard CORS. Reject non-loopback listen configuration in this POC rather than describing it as an unauthenticated hosted deployment. Serve sensitive API responses with no-store caching. Apply response and request size limits.

The threat model excludes a malicious process already operating as the same local OS user. Public deployment requires the separate controls in §18.

### 17.2 Secrets and data

Read `TYPESAFE_API_KEY` from the backend environment. Never use a `VITE_` variable for a secret, return it in a status API, save it in a workflow or profile, or put it in a trace or exported bundle.

Provide `.env.example` with empty placeholders. Ignore `.env`, local data, reports, and private traces in Git. Never echo environment variable values in error messages. Do not add automatic telemetry or product analytics.

A model receiving untrusted text can still make a wrong semantic judgment. Constrained outputs do not remove prompt-injection or misclassification risk. Test hostile message content, while relying on deterministic policy and the absence of external action nodes to limit the application impact. No confidence threshold is a security authorization mechanism.

### 17.3 Initial limits

These are configurable POC defaults and application limits, not provider capabilities:

| Limit | Initial value |
|---|---:|
| Workflow nodes / edges | 100 / 500 |
| Questions per judgment | 32 |
| Scenarios per suite | 1,000 |
| Workflow import | 512 KiB |
| Suite or recording import | 8 MiB |
| Individual scenario input | 64 KiB serialized JSON |
| Resolved provider request | 128 KiB serialized JSON |
| Response body retained per attempt | 512 KiB |
| Expression depth | 16 |
| Total AST nodes per workflow | 2,000 |
| Evaluated AST operations per scenario | 10,000 |
| In-flight live requests | 4 process-wide |
| Concurrent mock scenarios | 16 |
| Active suite jobs | 1 |
| Total live attempts per suite | 200 by default; explicit bounded override required |
| Attempts per judgment / attempt timeout | 3 total / 10 seconds |
| Scenario wall-clock deadline | 30 seconds |

A suite must satisfy all applicable limits; 1,000 individually large scenarios need not fit within the import limit. The byte limits are not token estimates. Large inputs can still violate a provider context limit and must surface that failure honestly.

Reserve live-attempt budget atomically before dispatch so concurrent scenarios cannot exceed it. Show the maximum attempt budget before live runs. Do not promise that a token or dollar cap is exact when in-flight requests may complete without reported usage. Initially report provider tokens and attempts, not a fabricated billing total.

## 18. Hosted-service migration boundaries

### 18.1 Preserve now

Pass an explicit workspace context through services and repositories. Keep secrets outside workflow/run profiles. Use migrations and repository interfaces. Keep jobs represented by persisted IDs/snapshots, not closures that only work inside an HTTP handler. Keep the core runtime independent of transport and storage.

These boundaries reduce future coupling; they do not make the local POC multi-tenant or production-secure.

### 18.2 Build only after the POC

A hosted release needs real identity, workspace authorization, tenant-isolation tests, encrypted provider credentials or an alternative credential flow, provider-usage accounting, quotas, billing decisions, durable jobs, safe worker retries, storage retention/deletion policies, backups, monitoring, and deployment hardening.

A PostgreSQL adapter is a likely next storage step, but migrations, JSON handling, transaction behavior, and tenancy enforcement must be implemented and tested rather than assumed portable. Multiple workers require explicit leases and recovery semantics; do not simply run several copies of the local runner.

Hosted authoring and evaluation do not require hosting customers' production decision execution. Preserve the portable runtime as a separate distribution boundary.

## 19. Replaceable business demonstration

### 19.1 Scenario

The supplied example classifies an incoming support request, assesses operational impact and time sensitivity, and recommends a departmental queue or manual review. It sends no message, changes no ticket, and issues no refund.

It uses a second judgment for technical workaround assessment, demonstrating a dependent stage with explicitly passed earlier outputs. No support-domain logic belongs in the core engine.

```text
Incoming request
       |
Assess: department / impact / time-sensitive
       |
Confidence gate --------------------> Manual review
       |
Department
   | billing        | technical          | sales       | other
Priority policy   Inspect workaround    Sales queue    Manual review
   |     |             |
Priority Standard  Priority policy
                      |      |
                   Priority Standard
```

### 19.2 Included artifacts

`baseline.workflow.json` uses automatic-routing confidence `>= 0.70`. `candidate.workflow.json` changes only that threshold to `>= 0.80`. The shared suite contains twelve synthetic cases and human-authored illustrative expectations. Exact-request mock responses cover the sixteen judgments visited by the baseline.

All thresholds are demonstration policies, not recommended defaults for real support automation. The confidence values in these mocks are supplied test data. They are not a reimplementation of TypeSafe's confidence calculation and are not results of live Jev calls.

### 19.3 Expected demonstration results

| Metric | Baseline | Candidate |
|---|---:|---:|
| Completed synthetic cases | 12 | 12 |
| Assertions passed | 11 | 10 |
| Assertions failed | 1 | 2 |
| Visited branch ports | 10 of 10 | 10 of 10 |
| Logical judgments reached | 16 | 14 |
| Actual live requests | 0 | 0 |

Three outcomes change. `billing_threshold_075` and `technical_threshold_070` become new assertion regressions because manual review replaces their expected priority queues. `technical_threshold_079` improves because manual review is the authored expectation. Cases at exactly 0.70 and 0.80 exercise inclusive-boundary behavior.

Both versions attain 100% observed branch coverage while still having failures. This is intentional: coverage is not correctness. A strict replay of the candidate can reuse the relevant baseline responses without live calls because the changed policy removes, rather than adds, reached judgments in these cases.

The accompanying `expected-results.json` is an independently checked fixture expectation, not a real Pathsmith report or a provider recording.

## 20. Tests and acceptance criteria

### 20.1 Test strategy

Test the engine and evaluator before polishing the canvas. Use unit tests for pure functions, contract tests for artifacts/adapters, integration tests for storage and API, Playwright or equivalent browser tests for the user journey, and a built-package standalone parity test.

Mock HTTP responses for Jev transport tests. Live tests are optional integration smoke tests, never the source of expected CI snapshots. Assert execution policy, not a supposedly fixed live probability.

### 20.2 Required acceptance matrix

| ID | Acceptance criterion |
|---|---|
| AC-01 | Both supplied workflows and the suite pass schema plus semantic validation. |
| AC-02 | Duplicate IDs, missing default edge, two edges on one port, cycles, and disconnected nodes fail before any provider call. |
| AC-03 | A producer that is an ancestor but does not dominate its consumer is rejected. |
| AC-04 | `gte` includes the threshold; missing operands and wrong types do not become false conditions. |
| AC-05 | Two true branch cases select the first; later cases are marked not evaluated. |
| AC-06 | Multiple questions share one state; attempts to read an answer from the same judgment are rejected. |
| AC-07 | Mock mode works with no credentials and no network; a changed request fails exact fixture matching. |
| AC-08 | The example produces the counts, three changed outcomes, two regressions, and one improvement in §19. |
| AC-09 | Strict candidate replay uses zero network calls and preserves source-model/mock provenance. |
| AC-10 | Changed questions, changed state, or a newly reached unrecorded judgment yield `REPLAY_MISS`; no live fallback occurs. |
| AC-11 | Score remains fractional; binary results have no fabricated confidence; invalid distributions/keys/types fail response validation. |
| AC-12 | Authentication failures are not retried; 429/backoff and transient retries obey both attempt and wall-clock budgets. |
| AC-13 | Cancellation stops new dispatches, aborts in-flight requests, and leaves inspectable partial results. |
| AC-14 | Restart marks unfinished jobs interrupted and never resends live requests automatically. |
| AC-15 | Draft edits and layout movement do not alter past snapshots; layout-only changes preserve semantic hash. |
| AC-16 | Two-tab stale saves return a conflict rather than losing data. |
| AC-17 | Coverage uses traversed branch ports and correct cohort denominators; zero denominators display N/A. |
| AC-18 | Unlabeled cases are not called correct; incomplete runs and missing comparison pairs cannot produce a clean gate. |
| AC-19 | Provider credentials never reach browser payloads, logs, local run artifacts, or exports. |
| AC-20 | API Host/Origin, mutation-header, input-size, and unsafe-expression tests reject hostile requests. |
| AC-21 | The UI can add/edit/connect nodes, save an executable version, run a case, inspect it, and compare suites without hard-coded result cards. |
| AC-22 | Exported definitions execute through built runtime packages outside the API and reproduce mock outcomes/paths exactly. |
| AC-23 | Import/export preserves semantic JSON; unsupported format versions are rejected. |
| AC-24 | HTTP attempt counts, logical judgments, replayed judgments, and actual versus historical usage remain distinct. |
| AC-25 | Repository tests cannot link or fetch resources across differing workspace contexts, despite local mode using one context. |
| AC-26 | A new live model identity is recorded, mixed-model runs are warned, and comparison cannot misattribute a model change to a policy edit. |

Security tests should include hostile imported keys, oversized/deep ASTs, malformed model bodies, text that asks the classifier to ignore instructions, and state accidentally containing secrets. Do not claim that a small adversarial fixture set proves general injection resistance.

### 20.3 Performance checks

Use generated deterministic fixtures to test the stated 100-node/1,000-scenario bounds without network access. Measure on a documented local machine; do not promise a universal latency figure. Keep canvas interactions usable while runs execute, paginate run tables, and avoid loading every full trace into the browser at once.

## 21. Implementation milestones

### M0 — Repository and contracts

Scaffold the workspace, web shell, API health endpoint, packages, lint/typecheck/test commands, and ignored local configuration. Copy the initial schemas/examples. Generate wire types, add schema checks and graph validation, and document dependency pins/module configuration.

**Exit:** clean install/build/typecheck; health endpoint and web shell start; schema and invalid-graph tests run offline. Do not add simulated analytics panels.

### M1 — Headless execution slice

Implement the expression evaluator, graph executor, typed provider boundary, exact mock adapter, suite assertions, core trace events, coverage, and initial CLI. Produce reports containing snapshots and complete mock exchanges. Implement the standalone built-package consumer.

**Exit:** the twelve-case baseline and candidate match §19, negative validation tests pass, and standalone parity holds. This proves the semantics before storage/UI obscure bugs.

### M2 — Persistent local application

Implement migrations/repositories, drafts/versions, suite snapshots, local jobs, progress polling, run history, cancellation, and restart behavior. Add the minimum UI to load the demo, edit scenario inputs, run cases/suites, and inspect historical traces.

**Exit:** a browser-triggered run persists across application restart, unfinished work is marked interrupted, and no API key is needed.

### M3 — Visual authoring and comparisons

Add editable node forms, connections/ports, ordered branch cases, field-reference pickers, JSON round-trip, undo/redo, validation panel, historical graph overlay, and per-case baseline/candidate comparison. Implement workflow/configuration diffing and explicit gate results.

**Exit:** a user can change the threshold in the UI and inspect the expected two regressions and one improvement. Node positions do not alter semantics.

### M4 — Recorded replay, Jev, and complete POC

Implement strict replay and replay-miss diagnostics, actual Jev HTTP mapping/validation, server-only configuration, bounded retries/usage accounting, live consent, workflow/run exports, and complete CLI behavior. Add all remaining acceptance tests and owner-run live smoke instructions.

**Exit:** build → test → change → compare works in mock and recorded replay, the live adapter passes mocked contract tests, exported workflows execute independently, and an optional owner-enabled live smoke validates actual access. If live execution is not performed, say so; do not claim it passed.

Do not start hosted-service work until the local cycle is demonstrated. The next product check is whether representative developers find this more useful than maintaining their own small evaluation harness.

## 22. Engineering instructions and deferred decisions

### 22.1 Instructions to Codex

Read this document and `AGENTS.md` before making changes. Build one milestone at a time, with executable acceptance evidence. Start with M0 and M1. Do not spend the first iteration building polished graph cards while leaving the runtime implicit.

Keep changes scoped. Prefer conventional libraries and explicit interfaces to generic frameworks. Update schemas, fixtures, runtime, and tests together when a contract changes. Record a short decision note for material deviations; do not silently widen MVP scope.

Do not add unavailable SDK methods, undocumented provider parameters, hidden fallback requests, or guessed billing calculations. Re-check the primary TypeSafe API docs when implementing the adapter. If the current API differs from this dated document, preserve the provider boundary, update the contract tests and source note, and explain the difference.

Never insert a license, publish a package, deploy publicly, provision paid infrastructure, use credentials from unrelated files, or send live requests without explicit authorization. The fact that the owner has Jev access is not a request to run paid evaluations automatically.

### 22.2 Deliberately deferred, not blockers

The final business demo, public branding/trademark clearance, public package names, license/open-source strategy, hosted pricing, hosted cloud provider, and production telemetry ingestion are not settled here. They do not block the local scaffold. In particular, using `Pathsmith` in this pack does not establish name availability or legal clearance.

Loop support, arbitrary code integration, extra model providers, automatic scenario generation, and production monitoring require separate design decisions after the proof of concept. Do not prebuild their infrastructure.

## 23. Source notes

External facts below were checked against primary documentation on September 24, 2026. Product requirements, limits, mock values, architecture, and acceptance criteria elsewhere in this document are authored design decisions, not vendor guarantees. API details can change; re-check them during adapter implementation.

- **[S1] TypeSafe introduction:** question isolation, primitive composition. https://docs.typesafe.ai/introduction
- **[S2] TypeSafe API reference:** endpoint, authentication, wire request/response fields. https://docs.typesafe.ai/api
- **[S3] TypeSafe Choice:** option selection and distributions. https://docs.typesafe.ai/primitives/choice
- **[S4] TypeSafe Score:** ordered rubric levels, weighted score, distributions. https://docs.typesafe.ai/primitives/score
- **[S5] TypeSafe Noul:** yes-probability primitive. https://docs.typesafe.ai/primitives/noul
- **[S6] TypeSafe confidence:** distinction between confidence and probabilities. https://docs.typesafe.ai/confidence
- **[S7] TypeSafe models:** model aliases, resolved identity, version pinning, changeable limits. https://docs.typesafe.ai/models
- **[S8] TypeSafe JavaScript SDK:** official package and usage. https://docs.typesafe.ai/sdk/javascript
- **[S9] React Flow:** React graph editor installation and core concepts. https://reactflow.dev/learn
- **[S10] NestJS:** TypeScript server framework and module architecture. https://docs.nestjs.com/
- **[S11] pnpm workspaces:** monorepo/workspace conventions. https://pnpm.io/workspaces
- **[S12] Drizzle SQLite:** local database adapter options. https://orm.drizzle.team/docs/sqlite/get-started-sqlite
- **[S13] Ajv JSON Schema:** dialect support and validation reference. https://ajv.js.org/json-schema.html
- **[S14] Node.js release status:** Node.js 24 LTS status at verification. https://nodejs.org/en/about/previous-releases

---

**End state:** Pathsmith should be useful because its execution and comparison results are trustworthy. The editor is how users reach that capability—not a substitute for it.
