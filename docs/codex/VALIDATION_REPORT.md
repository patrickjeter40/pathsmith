# Agent-pack validation report

Prepared September 24, 2026. Scope: the configuration and instruction artifacts,
not an implemented Pathsmith application.

## Executed checks

| Check | Result |
| --- | --- |
| Python standard-library TOML parsing of project config plus five agent files | PASS: six files |
| Required agent fields, unique expected names, model/effort strings, and pack field subset | PASS: five agents |
| Full YAML parse of skill frontmatter during preparation | PASS: four skills |
| Skill metadata, routing references, merge markers, and documentation paths | PASS |
| Original design-pack AGENTS.md retained as exact byte prefix | PASS: 5,490 original bytes preserved |
| Combined root AGENTS.md size | PASS: 11,071 bytes; below 32 KiB by itself |
| No approval, credential, provider, network, or MCP overrides introduced | PASS |
| Read-only defaults for explorer/reviewer; other roles inherit sandbox | PASS |
| Valid pack accepted by bundled offline validator | PASS |
| Five deliberately damaged configurations rejected | PASS |

Negative cases: malformed TOML, missing UI skill, a writable reviewer override,
duplicated routing block, and a non-string reasoning effort. The last case also
checks graceful validation of an incorrect type, rather than an uncaught error.

The bundled checker runs without dependencies on Python 3.11+ and uses a small
metadata subset rather than a general YAML parser. Full YAML parsing above was
an additional preparation check. No Python runtime is needed to use Codex agents.
The root AGENTS.md size check does not inspect the user's inherited/global
instruction budget.

## Not performed

- Loading this pack inside Codex or spawning an actual subagent. Codex is not
  installed in the artifact-building environment.
- Verifying your account's access to the selected models or efforts.
- Validating against a downloaded complete upstream Codex JSON schema. Field
  usage was reviewed against current official documentation instead.
- Verifying effective sandbox permissions, project trust, client configuration
  precedence, or actual skill-selection/delegation behavior in your environment.
- Running Pathsmith application tests or making any live Jev/API calls.
- Measuring whether these routing choices minimize cost, time, or defects.

Use SMOKE_TESTS.md in a new local Codex session for loading and delegation checks.
Configuration syntax passing does not establish any of the items above.
