# Local smoke tests

These are owner-run checks after cloning and opening the repository in a new Codex session. Normal Codex
model usage applies. No prompt below authorizes Jev calls, deployment, package
installation, or changes to application source.

## 1. Check visibility in a new session

```text
Do a non-mutating Pathsmith agent-setup check. Identify the applicable AGENTS.md
instructions, available custom agent names, and four Pathsmith skills. Compare
what this session actually exposes with the files in .codex/agents and
.agents/skills. Distinguish configured values from confirmed runtime metadata.
Report missing or unsupported settings. Do not spawn agents, edit files, run
application tests, print secrets, or contact Jev.
```

Expected: the five `pathsmith_*` roles and four `pathsmith-*` skills are available,
not merely present as files. A missing model or missing tool is a setup limitation,
not proof that a similarly named role was loaded.

## 2. Exercise one bounded actual delegation

```text
Spawn exactly one pathsmith_explorer subagent. Have it read the Pathsmith design
and identify the M0/M1 exit conditions and any existing repository scripts for
checking them. It must not modify files, run write-producing commands, contact
Jev, or spawn children. Wait for its result and summarize it with file references.
Report the actual spawned model/effort only if the client exposes that metadata;
otherwise report only the configured profile and that metadata is unverified.
```

Inspect the child thread in your client when available. A model repeating its own
configuration file is not independent evidence of actual model selection. This
checks the explorer path only. Exercise another profile explicitly before relying
on its model/access settings for significant work.

## 3. Review the current milestone without implementation

```text
Ask pathsmith_reviewer for an independent read-only review of the implemented
M0/M1 milestone against PATHSMITH_DESIGN.md, docs/M0-M1-RESULTS.md, and the
current repository. It should load relevant runtime and verification skills,
identify concrete missing acceptance evidence, and separate M2-M4 work from
M0/M1 defects. Do not modify files or run live requests. Wait for its findings
and give me the unresolved issues with evidence.
```

## 4. Continue with the next milestone

Use only when you intend to begin M2. This is an implementation prompt,
not part of installation or the non-mutating setup check.

```text
Implement Pathsmith M2 from PATHSMITH_DESIGN.md, preserving the verified M0/M1
runtime. Follow AGENTS.md routing and relevant skills. Delegate persistence,
job recovery, and security-sensitive changes to pathsmith_architect, and bounded
ordinary UI/API work to pathsmith_implementer as appropriate, with one source
writer at a time. Use pathsmith_verifier for offline evidence against the stable
change, then a fresh pathsmith_reviewer for the milestone review. Fix concrete
findings and rerun affected checks. Do not change acceptance labels, run Jev,
deploy, or call unfinished stubs complete. Report actual commands, results, and
unresolved milestone-exit criteria.
```

## Routing checks to observe over time

| Request | Intended starting route, not a guaranteed outcome |
| --- | --- |
| Correct a README typo. | Main session; no subagents or unrelated skills. |
| Locate where branch defaults are validated. | Explorer when isolation helps; runtime skill. |
| Add a node property form under an existing schema. | Implementer; UI plus targeted verification. |
| Repair an incorrect dominance check. | Architect; runtime and verification; independent reviewer. |
| Implement bounded Jev retries in M4. | Architect; provider and verification; independent reviewer. |
| Explain why an already recorded suite failed. | Verifier or main; inspect actual evidence first. |
| Audit milestone acceptance before calling it complete. | Verifier followed by reviewer, against a stable diff. |

Record observed defects, rework, time, and usage where available before treating
the routing defaults as optimal. A concurrency cap does not bound the total
number of sequential delegations or their cost.
