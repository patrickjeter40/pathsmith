# Configuration source notes

Checked September 24, 2026. OpenAI primary documentation was used for the Codex
mechanisms below. Model choices, division of responsibilities, checklists, and
routing thresholds are recommendations for this project, not an OpenAI-prescribed
Pathsmith setup or a measured optimization result.

## Codex mechanisms

- **Custom agents and subagent behavior:**
  <https://learn.chatgpt.com/docs/agent-configuration/subagents>
  Standalone project TOMLs identify custom roles and can set model/effort. Parent
  runtime controls still matter. This pack uses selective delegation, not a
  separate routing service.
- **Configuration reference:**
  <https://learn.chatgpt.com/docs/config-file/config-reference>
  Provides the root `model`, `model_reasoning_effort`, and `[agents]` fields used
  here, including the open-thread cap.
- **Configuration precedence and project trust:**
  <https://learn.chatgpt.com/docs/config-file/config-basic>
  Project configuration is conditional on trust, and higher-priority client
  overrides can affect effective settings. This pack does not change trust.
- **AGENTS.md discovery:**
  <https://learn.chatgpt.com/docs/agent-configuration/agents-md>
  Describes instruction discovery, overrides, and the default aggregate size
  limit. Start a new session after installation to check the effective guidance.
- **Skills:**
  <https://learn.chatgpt.com/docs/build-skills>
  Describes repository `.agents/skills/` discovery and skill metadata. The four
  skills supplied here are original Pathsmith procedures, not imported plugins.
- **Models and effort:**
  <https://learn.chatgpt.com/docs/models>
  Confirms the listed model IDs and effort conventions, with availability
  dependent on account/client. Higher effort is selectively used here for core
  work and review; there is no account-access verification in this pack.
- **Published configuration schema:**
  <https://learn.chatgpt.com/docs/config-schema.json>
  Available for upstream schema checking; the preparation checks did not perform
  a full validation against a downloaded copy of this schema.

## Pathsmith-specific requirements

The existing `PATHSMITH_DESIGN.md` and original design-pack `AGENTS.md` supply the
product constraints, milestones, tests, and safeguards. The original instructions
are retained in the combined `AGENTS.md`; the marked routing block is new.
TypeSafe-specific implementation details must be verified against the official
sources linked in the design when the Jev adapter is implemented. This pack
makes no new claim of live Jev compatibility or of Pathsmith name availability.
