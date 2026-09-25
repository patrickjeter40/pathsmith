# Pathsmith agent-pack installation

Installed September 24, 2026 (local time) from
`C:\Users\orioe\OneDrive\Desktop\pathsmith-agent-pack` into
`C:\Alchemy\pathsmith`. This installation changed configuration and instructions
only. The supplied `VALIDATION_REPORT.md` describes the pack's preparation;
the checks below describe this repository installation.

## Installed paths

- `.codex/config.toml`: supplied project model/effort defaults and one `[agents]`
  table. No project configuration existed, so there were no existing keys to merge.
- `.codex/agents/pathsmith_explorer.toml`
- `.codex/agents/pathsmith_implementer.toml`
- `.codex/agents/pathsmith_architect.toml`
- `.codex/agents/pathsmith_reviewer.toml`
- `.codex/agents/pathsmith_verifier.toml`
- `.agents/skills/pathsmith-runtime/SKILL.md`
- `.agents/skills/pathsmith-ui/SKILL.md`
- `.agents/skills/pathsmith-provider/SKILL.md`
- `.agents/skills/pathsmith-verification/SKILL.md`
- `PATHSMITH_AGENTS_README.md`
- `docs/codex/`: all six supplied documentation/manifest files, plus this report.
- `scripts/validate-pathsmith-agents.py`
- `AGENTS.md`: appended the exact marked routing block once; retained all prior
  instructions, including the existing general routing section.

## Preservation and conflicts

No conflicting project instructions or applicable override files were found.
Neither `.codex` nor `.agents` existed before installation. The specific profiles
refine the existing general routing guidance without replacing it.

Before modification, `AGENTS.md` was copied to:

`C:\Alchemy\pathsmith\.pathsmith\backups\agent-pack-20260925T050745Z\AGENTS.md`

The same backup directory contains `installation-manifest.json`, recording the
copied paths and SHA-256 hashes of all 110 previously tracked files. It is under
the existing ignored `.pathsmith/` directory. The timestamp is UTC.

No existing user/global configuration, trust, MCP, approval, sandbox, or credential
settings were edited. The supplied explorer/reviewer files retain their own
`sandbox_mode = "read-only"` declarations; the other three profiles inherit
permissions. Effective runtime permissions were not tested.

## Checks executed

Commands ran from `C:\Alchemy\pathsmith` unless otherwise indicated.

- `py -3 --version`: Windows Python 3.10.11 is below the validator requirement.
- `wsl.exe -d Ubuntu -- python3 --version`: existing Python 3.12.3 is suitable;
  nothing was installed.
- Ran the supplied validator against the source pack through WSL Python: exit 0.
- `wsl.exe -d Ubuntu -- python3 /mnt/c/Alchemy/pathsmith/scripts/validate-pathsmith-agents.py --root /mnt/c/Alchemy/pathsmith`:
  exit 0. Parsed six TOMLs; checked five role definitions, four simple skill
  metadata blocks, required documentation paths, routing references, one pair of
  routing markers, and the root instruction size limit.
- PowerShell SHA-256 checks: all 18 entries in the source pack manifest matched;
  all 18 copied files matched their source files exactly.
- PowerShell preservation checks: all 109 tracked files other than `AGENTS.md`
  retained their pre-installation hashes. The entire original `AGENTS.md` remains
  an exact byte prefix. Replacing the marked block with the supplied fragment
  again produces identical content.
- `git diff --check`: exit 0. Reviewed the `AGENTS.md` diff and the complete
  untracked-file inventory against the supplied files.
- Reviewed the used configuration fields against the official
  [subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents),
  [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference),
  and [skill discovery documentation](https://learn.chatgpt.com/docs/build-skills).

`docs/codex/FILE_HASHES.json` was refreshed after the repository setup documents
were updated for cloning. It now hashes the current checked-in configuration and
instructions, including the merged `AGENTS.md`.

## Remaining verification

No installation blockers remain. No agents were spawned, no Jev calls were made,
and no application tests or implementation work ran during installation.
Independent agent review was not performed, as requested.

The checks do not establish Codex discovery, account model/effort availability,
effective permissions, configuration precedence, or complete upstream schema
compliance. Start a **new Codex session** in this repository and use the first
prompt in [SMOKE_TESTS.md](SMOKE_TESTS.md) to check actual visibility. The second
prompt exercises one bounded delegation after that check.
