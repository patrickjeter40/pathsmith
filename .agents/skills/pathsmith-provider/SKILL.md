---
name: pathsmith-provider
description: "Pathsmith TypeSafe Jev adapter, typed response normalization, model identity, retry/usage accounting, mocked transport, and secret boundaries. Use for provider implementation or review; never implies authorization for live requests."
---

# Provider integration

Read design sections 5, 8–9, 12, and 17, including the source notes, and inspect
current adapter interfaces/tests. The Jev adapter belongs to M4 unless the owner
explicitly changes scope. Keep early development and normal CI independent of
credentials and paid model calls.

## Verify before implementing

Use available primary TypeSafe API documentation to check the current endpoint,
authentication, request/response fields, supported models, question limits, and
error behavior. Begin with the official sources already linked in the design.
Do not substitute community summaries or invent SDK methods, retry options, or
prices. If access to documentation is unavailable, clearly mark transport details
unverified and implement only the documented contract/mocks that can be justified.
Record an API change rather than quietly redefining the provider-neutral boundary.

## Keep responsibilities explicit

Bindings select a concrete provider outside workflow JSON. Keep server-only
credentials out of browser payloads, prompts, source, logs, traces, and exports.
Read locally configured keys only through the approved backend credential path.
Do not print environment values to establish whether credentials exist.

Map binary, choice, and score judgments to the verified transport and validate
answers against question IDs/options/types. Preserve raw supported provenance
and normalized results without inventing confidence or coercing fractional scores
to integers. Record requested versus actual model identity; expose unknown values
as unknown. A new model identity is evidence, not proof of a model-policy effect.

Keep HTTP retry ownership in one observable layer. Avoid SDK-plus-adapter retry
multiplication. Observe attempt, wall-clock, cancellation, and usage constraints.
Test nonretryable auth errors, rate limits, transient failures, malformed bodies,
and interruption. Unknown usage must not become a fabricated cost estimate.

## Test without spending

Use injected/mock transport for routine contract tests. Verify that exact mocks
and replay misses cannot call a live backend. Never use a live model response as
a stable expected CI probability. Live smoke testing requires a specific owner
request, implemented opt-in/budgets, and a locally configured key. Having Jev
access or asking to build an adapter is not that authorization.

Return verified documentation assumptions, changed mapping, tests actually run,
remaining unknowns, and a clear live-tested/not-live-tested statement. Apply the
verification skill to acceptance and resource-accounting evidence.
