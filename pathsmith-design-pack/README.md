# Pathsmith design pack

**Version:** 0.1 · **Prepared:** September 24, 2026

This pack defines a general-purpose tool for authoring, testing, tracing, and comparing probabilistic decision workflows. It is intended to be given to Codex to scaffold a TypeScript / React / NestJS project.

It is **not an application scaffold or a finished application**. The main document describes the software to build; the JSON artifacts provide concrete, checked starting contracts and test examples.

## Start here

Open **`PATHSMITH_DESIGN.md`** for the complete specification. Give Codex this entire folder and paste the initial prompt from **`CODEX_KICKOFF.md`**. **`AGENTS.md`** contains repository-wide implementation instructions.

The first implementation target is M0–M1: workspace/contracts followed by a working headless execution and testing slice. The remaining milestones progressively add local persistence, the visual editor, comparisons, recorded replay, and live Jev integration.

## Contents

| File or folder | Purpose |
|---|---|
| `PATHSMITH_DESIGN.md` | Product scope, architecture, contracts, execution rules, screens, persistence, APIs, security, migration boundaries, acceptance tests, and build sequence. |
| `CODEX_KICKOFF.md` | Initial implementation prompt and a continuation prompt. |
| `AGENTS.md` | Guardrails to keep generated code consistent with the design. |
| `schemas/` | Initial workflow, scenario-suite, and exact-mock-fixture JSON Schemas. |
| `examples/support-routing/` | A replaceable business demo with baseline/candidate workflows, twelve scenarios, sixteen synthetic response fixtures, and expected results. |
| `VALIDATION_REPORT.md` | Twenty-nine checks performed on the starter artifacts, with explicit limitations. |

## Confirmed direction

Pathsmith is general-purpose, not game-specific. Start with a single-user local application; preserve boundaries for a hosted service after the proof of concept. Visual authoring and JSON editing share one semantic definition. Applications can execute exported workflows through a portable TypeScript runtime without a Pathsmith server.

The support-routing example is provisional. Replacing it must not require changing the engine.

## Evidence and limitations

The supplied example was independently checked for schema validity, graph structure, dominating data dependencies, synthetic response consistency, expected outcomes, and strict recorded-replay behavior. The baseline has eleven passing cases and one failing case. The candidate has ten passing cases and two failing cases. Three cases change: two regressions and one improvement. Both visit every branch port.

These are **synthetic fixture results**, not live Jev evaluations. No API key was accessed, no paid calls were made, and the proposed TypeScript application was not built or tested. See `VALIDATION_REPORT.md`.

## Repository placement

The files can initially remain in this folder. During M0, Codex may move the main design document to `docs/PATHSMITH_DESIGN.md`, as shown in the proposed repository layout, while updating references and retaining one canonical copy. Keep `AGENTS.md` at repository root. Preserve the schemas and examples as implementation/test inputs.

Public package names, trademark/name availability, licensing, hosting provider, and pricing are deliberately unresolved. Nothing in this pack authorizes publishing, deployment, or live API usage.
