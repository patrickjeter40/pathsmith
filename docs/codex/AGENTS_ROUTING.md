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
