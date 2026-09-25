# Pathsmith Codex agent pack

Version 1 · Prepared September 24, 2026

Project-scoped agent configurations and skills committed alongside the Pathsmith
application. This is development tooling, not a Jev router. Cloning the repository
does not change your account or make any live provider calls.

## Included defaults

| Role | Agent name | Model | Effort | Intended use |
| --- | --- | --- | --- | --- |
| Main coordinator | Main Codex session | `gpt-6-sol` | `medium` | Assess each request, work directly when simple, delegate selectively. |
| Explorer | `pathsmith_explorer` | `gpt-6-luna` | `high` | Read-only code discovery and evidence gathering. |
| Implementer | `pathsmith_implementer` | `gpt-6-sol` | `medium` | Ordinary changes within established contracts. |
| Architect | `pathsmith_architect` | `gpt-6-astra` | `high` | Architecture and explicitly assigned difficult implementation. |
| Reviewer | `pathsmith_reviewer` | `gpt-6-astra` | `xhigh` | Independent design, sensitive-change, and milestone review. |
| Verifier | `pathsmith_verifier` | `gpt-6-sol` | `high` | Offline tests, failure reproduction, and acceptance evidence. |

These are chosen starting settings, not measured optimal routing. Extra High is
reserved for selected independent reviews, not every prompt. The architect and
reviewer are separate so the author is not its own independent reviewer.

## Use on another device

Clone this repository, open its root in a current local Codex client, review the
project instructions and configuration, and trust the project if you accept them.
Start a new Codex session so project configuration, the five TOML agents in
`.codex/agents/`, and the four skills in `.agents/skills/` can be discovered.
They are already in the repository; no separate ZIP, copy, or merge step is needed.
See [device setup](docs/codex/INSTALL_WITH_CODEX.md) for commands and a visibility
check. Account sign-in, project trust, personal settings, and any future provider
credentials stay local to each device.

## Start a new Codex session

Open the cloned repository in a current local Codex client. Run the visibility check in
`docs/codex/SMOKE_TESTS.md`. Confirm the model options are available to your account
before substantial work. The project defaults do not grant model access.

After setup, ordinary requests can be normal language: the appended routing
policy asks Codex to select relevant skills and delegate substantive work to the
appropriate named profile. Simple requests stay in the main conversation. It
instructs the coordinator to limit open children to three and default to one
source writer at a time, then verify and review a stable change.

## What the configuration does and does not control

The custom files hold actual model/effort settings for spawned roles. The main
conversation is not transparently switched per prompt. Your client selection or
higher-priority configuration can override the coordinator's project default.
Named-agent selection is instruction-guided, not a deterministic router or
benchmark-proven optimizer. No Jev API key, custom wrapper, hooks, or MCP install is
required. This does not prevent normal Codex usage charges or plan-limit use.

Explorer and reviewer request `sandbox_mode = "read-only"` and forbid mutations
in their instructions. Other roles inherit the parent permissions. Effective
permissions still depend on the parent/client and enforced policies; the role
setting is not an independent security boundary. Review inherited connector/tool
permissions too. The pack never grants a new approval or permission itself.

Four repository skills cover runtime/contracts, UI, provider integration, and
verification. The instructions select them by relevance. They do not provide
missing tools or themselves change models. A verification run may write ordinary
local build/cache/report artifacts; source/test edits require assigned ownership.

## Compatibility and fallback

This repository uses the documented standalone TOML agent format in
`.codex/agents/` with `name`, `description`, and `developer_instructions`. It does
not require duplicating those agents under `[agents.<name>]` declarations.

If an older client does not discover these files, update it through your normal
installation method and repeat the smoke test. Do not guess deprecated feature
flags or silently reinterpret an unknown config. If a model or effort is not
available, choose an available option in your client and deliberately update the
relevant TOML plus the routing table. Unavailability is not a reason to claim the
original profile ran. These defaults do not configure hosted Codex cloud tasks.

## Optional offline check

Python 3.11+ can run the bundled static checker; Python is **not** a new requirement
for Pathsmith, the agents, or the skills. From the installed repository root:

```sh
python scripts/validate-pathsmith-agents.py
```

On Windows, `py -3 scripts/validate-pathsmith-agents.py` is another option with a
suitable Python installed. This checker does not call a model or access the
network. See `docs/codex/VALIDATION_REPORT.md` for the checks actually performed
when preparing the configuration, and the important checks that remain local to you.

## Official configuration references

Source details are in `docs/codex/SOURCES.md`. Check them again when updating
Codex: configuration fields, model availability, and client behavior can change.
