---
name: pathsmith-ui
description: "Pathsmith React graph editor, node forms, scenario authoring, run/trace views, coverage overlays, and comparison screens. Use for UI implementation or review, not headless-runtime-only changes."
---

# Visual authoring and inspection

Read design sections 4–7, 14–15, and the current milestone. Inspect existing React
components and the actual API contract first. Before M3, build only the shell or
minimal UI required by the milestone; do not substitute polished cards for a
working runtime.

## One persistent graph

Render and edit the canonical JSON workflow; React Flow internals are not the
persisted wire format. Keep layout/presentation separate from semantic data.
Preserve IDs, ordered branch cases, default ports, and expression structures
through import, edit, save, reload, and export. Round-trip through shared
validation. Do not silently drop invalid fields or accept unsupported formats.

Implement property forms and reference pickers around the allowed schema.
Use explicit validation errors rather than arbitrary-code escape hatches.
Preserve unsaved work on conflicts; a stale save must not silently overwrite a
newer version. Keep invalid drafts editable but distinguish them from executable
versions. Never expose provider keys or depend on browser-only execution logic.

## Inspect real runs

All traces, metrics, and comparisons must come from actual run data. Do not
hard-code the example's outcomes or synthesize missing history. Render a run
against its immutable graph snapshot, not the latest draft. Identify mock, live,
and recorded replay clearly. Show partial, cancelled, failed, and incompatible
states; distinguish business assertions from transport or validation errors.

Keep probability, confidence, score, observed frequency, and assertion success
visually distinct. Show N/A instead of misleading zero values. Use the exact
selected branch ports for observed coverage. A path never visited in the chosen
cohort is unvisited, not proven impossible. Comparison must disclose pairing,
missing cases, provenance differences, and gate reasons.

## Interaction and verification

Provide accessible labels, keyboard/focus behavior for forms and dialogs, usable
loading/empty/error states, and clear destructive-action affordances. Ensure
canvas selection and inspectors remain consistent. Test narrow layouts and
large permitted graphs without inventing performance guarantees.

Use available browser tooling for the changed journey. If none is available,
run component/contract tests and state that browser validation was not performed.
Cover canonical round-trip, a real mock run, history after draft edits, and the
threshold-change comparison when those features enter scope. Use the
verification skill for acceptance evidence. Do not add visual dependencies or
install browser/MCP services merely because this skill mentions browser testing.
