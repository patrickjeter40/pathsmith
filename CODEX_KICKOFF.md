# Codex kickoff

The supplied design artifacts are now maintained directly in this repository: `PATHSMITH_DESIGN.md`, `AGENTS.md`, `schemas/`, `examples/support-routing/`, and `docs/ARTIFACT_VALIDATION_REPORT.md`. These prompts request implementation; inspect the current implementation and milestone evidence before using them. The initial M0–M1 delivery is recorded in `docs/M0-M1-RESULTS.md`.

## Initial prompt: scaffold M0 and M1

```text
Build the initial Pathsmith project from the design artifacts in this repository.

First read AGENTS.md, PATHSMITH_DESIGN.md (or docs/PATHSMITH_DESIGN.md if it has
already been moved), the three schemas, the support-routing example README,
and docs/ARTIFACT_VALIDATION_REPORT.md. Inspect the existing repository before changing it.
Preserve unrelated existing files.

Implement M0 and M1 of the design, not the entire future product at once.

Pathsmith is a general-purpose tool for authoring, testing, tracing, and
comparing probabilistic decision workflows. Use TypeScript, React, NestJS,
and a pnpm workspace. The first application is local-first. Preserve the
specified boundaries for future hosting without adding authentication,
billing, cloud infrastructure, or production monitoring now.

For this delivery:
1. Create the workspace, package boundaries, web shell, API health endpoint,
   build/typecheck/lint/test commands, .env.example, and ignored local data.
2. Implement schema and semantic validation, including cycles, required
   outgoing ports, one start, and dominating output references.
3. Implement the safe expression AST, deterministic single-path runtime,
   provider interface, exact-request mock adapter, traces, assertions,
   observed coverage, and the headless run/validate commands.
4. Use the supplied business workflows, suite, and exact mock fixtures.
   Produce actual run artifacts containing immutable snapshots and exchanges.
5. Implement a standalone example that consumes built runtime packages and
   reproduces the same outcomes and selected paths without the API server.
6. Add executable tests for the M0/M1 acceptance criteria and document how
   to start the shell and run the headless example.

The baseline intentionally has 11 passing cases and 1 failing case.
The candidate has 10 passing cases and 2 failing cases. Three outcomes change:
2 new regressions and 1 improvement. Both have 10/10 branch-port coverage.
Do not change expectations or hard-code result cards to make the demo pass.

Do not implement arbitrary code nodes, graph loops, concurrent branch joins,
random mock fallbacks, automatic scenario generation, or live API calls.
The supplied expected-results.json is not a replay source. Strict recorded
replay is a later milestone, but preserve enough run data to implement it.

Prefer exact dependency pins established by installation over guessed patch
versions. Keep the workflow schema, TypeScript types, and runtime aligned.
Use the design's defaults for ordinary implementation decisions. Record any
material deviation rather than silently changing execution semantics.

At the end, run the available build, typecheck, lint, unit/contract tests,
and standalone parity check. State which commands actually ran, what passed
or failed, what remains incomplete, and the concrete next milestone.
Do not call an untested or UI-only scaffold the completed Pathsmith POC.
```

## Continuation prompt

Use after reviewing the prior milestone's result:

```text
Continue Pathsmith with the next incomplete milestone in the design.
Read AGENTS.md, the design, and the current implementation/test results.
Preserve all established execution semantics and the supplied acceptance
fixtures. Complete this milestone end to end, add the tests it requires,
and update the README. Do not expand into excluded features.

Mock and routine test execution must remain network-free. Do not run live
Jev requests or deploy anything without explicit authorization. Report the
commands actually executed and distinguish working features from stubs.
```

## Owner-enabled live smoke testing, later

Live testing belongs after M4 has an implemented adapter, budget controls, and mocked transport tests. Configure a key only in the local backend environment. Do not paste it into prompts, workflow files, or browser variables. Use the implemented opt-in smoke command and inspect the actual resolved model and usage. The design pack itself makes no live calls.
