# Explicit three-way workflow reconciliation

The approved workflow editor needs real optimistic conflict handling, including
the prototype's explicit combination of locally reordered branch cases with new
remote cases. Reconciliation operates on the last acknowledged draft, the local
document and the latest server draft. It never modifies a saved version or run.

`planWorkflowMerge` and `resolveWorkflowMerge` are pure browser-compatible helpers
over `{definition, layout}` JSON. They use shared JSON safety and workflow
validation, without runtime hashing, HTTP, React or history state. Inputs remain
unchanged. Unsafe or oversized input produces diagnostics without a mergeable
document; safe unknown fields survive and shared validation determines whether
they are executable. A resolved document can remain an invalid editable draft;
only `valid: true` permits publication.

Plain objects merge by property. Missing properties differ from explicit null.
When both sides introduce an ordinary object under an absent parent, its keys
merge against an empty object; this does not relax same-ID entity collisions or
discriminator safeguards. Ownership checks index edge IDs once and skip work
when there are no branches, so safe large invalid drafts still reach canonical
validation without a quadratic ownership scan.
Ordinary arrays are atomic. Canonical node/edge collections pair by stable IDs,
preserving local order then remote-only entities. Differing same-ID additions,
delete/edit collisions and overlapping values require an explicit side choice.
Changed `kind` or `op` discriminators resolve their whole object, avoiding mixed
variant shapes. Labels and layout are preserved independently of execution
semantics. Equality compares JSON content, never semantic hashes.

Each existing branch's ordered cases and all outgoing edges, including default,
form one routing unit excluded from generic edge merging. Branch labels remain
independently mergeable. An added/deleted branch or changed node kind instead
couples the entire node and its outgoing edges. Duplicate/malformed entity IDs
or an edge moving between branch routing owners cause a conservative complete
definition conflict; no edge is silently dropped, reassigned or duplicated.

Combine is an explicit choice available only when both sides retain every base
case with the same ID and expression, every existing edge and default unchanged,
and the remote projection onto base IDs retains base order. Local reordering is
allowed. New case IDs must be disjoint and each case/default must own exactly one
edge to an existing destination; new edge IDs must be globally disjoint. Existing
edits, deletion, renaming, changed routing or malformed ports disable Combine.

The combined case sequence is the complete local list followed by remote-only
additions in remote order. Distinct IDs with identical predicates remain distinct.
Metadata includes the complete base/local/remote/combined order, expressions,
edges, default and destination labels so the editor can display an explicit
first-true-wins preview. Keep mine/Take theirs always selects a whole conflicting
unit while preserving unrelated merges. Shared validation checks the assembled
graph, including cycles and dominance introduced by otherwise disjoint changes.

The editor remains responsible for fetching latest drafts after genuine 409s,
preserving text/history, presenting choices, validating before publication and
calling atomic save-version with the latest revision. A second 409 must preserve
the resolved candidate and replan; the helper does not implement retry or saving.

Focused offline tests cover path/array/identity conflicts, both required Combine
orders, routing and ownership rejection, immutable inputs, JSON safety and
canonical cycle/dominance validation. No execution semantics are reimplemented.
