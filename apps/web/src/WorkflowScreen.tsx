import { useMemo, useState } from "react";
import { validateWorkflow, type Workflow } from "@pathsmith/contracts";
import { Icon, ModeBadge, StatusPill } from "./ScreenUi";
import { SavedTrace, type SavedTraceResult } from "./SavedTrace";
import { WorkflowEditor, type Layout, type NodeProblem } from "./WorkflowEditor";
import type { MergeChoice, WorkflowMergePlan } from "./workflowMerge";

type Diagnostic = { code: string; message: string; pointer?: string; severity?: string; nodeId?: string };
type Conflict = { plan: WorkflowMergePlan; choices: Record<string, MergeChoice>; message: string };
type SnapshotView = { runId: string; caseId: string; workflowVersionId: string; mode: "mock" | "replay" | "live"; workflow: Workflow; layout: Layout; trace: (SavedTraceResult & { visitedNodes?: string[]; selectedEdges?: string[] }) | null; status: string };
type Props = {
  name: string; workflow: Workflow | null; layout: Layout; text: string; selectedNode: string; diagnostics: Diagnostic[];
  state: "saving" | "conflict" | "invalid" | "draft" | "executable"; versionId: string; ready: boolean; canPersist: boolean; hasSuite: boolean;
  canUndo: boolean; canRedo: boolean; conflict: Conflict | null; snapshot: SnapshotView | null; message: string;
  onSelectNode: (id: string) => void; onEdit: (workflow: Workflow, field?: string) => void; onLayout: (layout: Layout) => void;
  onDocument: (workflow: Workflow, layout: Layout) => void; onText: (text: string) => void; onBoundary: () => void;
  onUndo: () => void; onRedo: () => void; onSaveVersion: () => void; onSaveDraft: () => void; onRun: () => void;
  onImport: (file?: File) => void; onExport: () => void; onResolve: () => void; onChoice: (key: string, choice: MergeChoice) => void; onDismissConflict: () => void; onEditMerged: () => void;
  onClearPath: () => void; onBackResults: () => void;
};
const kinds = ["start", "judgment", "transform", "branch", "output"] as const;
const glyph: Record<string, string> = { start: "◉", judgment: "◆", transform: "⇄", branch: "⑂", output: "■" };
const stateLabel = { saving: "Saving…", conflict: "Save conflict", invalid: "Invalid draft", draft: "Draft", executable: "Executable" };
const fmt = (value: unknown) => JSON.stringify(value, null, 2) ?? "null";
function Slot({ value }: { value: { exists: boolean; value?: unknown } }) { return <pre>{value.exists ? fmt(value.value) : "Absent"}</pre>; }
export function WorkflowScreen(props: Props) {
  const [tab, setTab] = useState<"problems" | "json" | "trace">("problems");
  const [kind, setKind] = useState<(typeof kinds)[number]>("branch");
  const active = props.snapshot?.workflow ?? props.workflow;
  const activeLayout = props.snapshot?.layout ?? props.layout;
  const activeDiagnostics = useMemo(() => props.snapshot ? validateWorkflow(props.snapshot.workflow).diagnostics : props.diagnostics, [props.snapshot, props.diagnostics]);
  const shownConflict = props.snapshot ? null : props.conflict;
  const nodeProblems = useMemo(() => {
    const grouped = new Map<string, NodeProblem[]>();
    if (!active) return grouped;
    for (const item of activeDiagnostics) {
      const indexed = item.pointer?.match(/^\/nodes\/(\d+)(?:\/|$)/) ?? item.pointer?.match(/^nodes\[(\d+)\](?:\.|$)/);
      const id = indexed ? active.nodes[Number(indexed[1])]?.id : item.nodeId;
      if (!id || !active.nodes.some((node) => node.id === id)) continue;
      grouped.set(id, [...(grouped.get(id) ?? []), { severity: item.severity === "warning" ? "warning" : "error", message: item.message }]);
    }
    return grouped;
  }, [active, activeDiagnostics]);
  const locked = !props.ready || props.state === "saving" || !!props.snapshot || !!props.conflict;
  const lockReason = props.snapshot ? "Saved snapshot · read only. Choose Edit in my draft to change the current workflow."
    : props.conflict || props.state === "conflict" ? "Save conflict · review the choices in Problems, or choose Keep editing to retain your draft."
    : props.state === "saving" ? "Saving this workflow · editing will resume when the save finishes."
    : !props.ready ? "Project is loading · editing will resume when it is ready." : undefined;
  const add = () => {
    if (!props.workflow || locked || kind === "start") return;
    const used = new Set(props.workflow.nodes.map((node) => node.id));
    let id: string = kind, suffix = 2; while (used.has(id)) id = `${kind}_${suffix++}`;
    const node = kind === "judgment" ? { id, label: "New judgment", kind, binding: props.workflow.bindings[0] ?? "decisions", state: { op: "ref", path: ["input"] }, questions: { decision: { kind: "binary", instructions: "Describe the decision." } } }
      : kind === "transform" ? { id, label: "New transform", kind, value: { op: "ref", path: ["input"] } }
      : kind === "branch" ? { id, label: "New branch", kind, cases: [{ id: "case_1", when: { op: "literal", value: true } }] }
      : { id, label: "New output", kind: "output", outcomeId: id, value: { op: "literal", value: null } };
    props.onDocument({ ...props.workflow, nodes: [...props.workflow.nodes, node] } as Workflow, { ...props.layout, positions: { ...props.layout.positions, [id]: { x: props.workflow.nodes.length * 235, y: 0 } } });
    props.onSelectNode(id);
  };
  const goProblem = (pointer?: string) => {
    const match = pointer?.match(/(?:\/nodes\/\d+|nodes\[(\d+)\])/);
    const index = match ? Number(match[1] ?? match[0].split("/").at(-1)) : -1;
    const nodeId = index >= 0 ? props.workflow?.nodes[index]?.id : props.workflow?.nodes.find((node) => pointer?.includes(node.id))?.id;
    if (nodeId && props.workflow) { props.onSelectNode(nodeId); window.requestAnimationFrame(() => { const area = document.getElementById("workflow-inspector"); const fields = [...(area?.querySelectorAll<HTMLElement>("input,textarea,select") ?? [])]; const part = pointer?.split("/").at(-1) ?? ""; const field = fields.find((item) => item.getAttribute("aria-label")?.toLowerCase().includes(part.toLowerCase())) ?? fields[0]; field?.focus(); field?.scrollIntoView({ block: "nearest" }); }); }
    else setTab("json");
  };
  return <div className="workflow-screen" aria-busy={!props.ready || props.state === "saving"}>
    <header className="workflow-toolbar"><div className="workflow-title"><h2>{props.name}</h2><StatusPill kind={props.snapshot ? "unvisited" : props.state === "executable" ? "success" : props.state === "invalid" || props.state === "conflict" ? "warn" : "accent"}>{props.snapshot ? "Saved snapshot · read only" : stateLabel[props.state]}</StatusPill><small>{props.snapshot ? `Workflow ${props.snapshot.workflowVersionId.slice(0, 8)} · immutable` : props.versionId ? `Published ${props.versionId.slice(0, 8)} · immutable` : "No published version"}</small></div><div className="workflow-actions"><button title="Undo" aria-label="Undo edit" disabled={locked || !props.canUndo} onClick={props.onUndo}>↶</button><button title="Redo" aria-label="Redo edit" disabled={locked || !props.canRedo} onClick={props.onRedo}>↷</button><button onClick={() => setTab("problems")}>Validate</button><button disabled={!props.workflow || props.state === "invalid" || !!props.snapshot} onClick={props.onExport}>Export</button><button title={!props.hasSuite ? "Publish a test set before running" : undefined} disabled={props.state !== "executable" || !props.ready || !!props.snapshot || !props.hasSuite} onClick={props.onRun}><Icon name="play" /> Run {props.versionId.slice(0, 8)}</button><button className="primary-action" disabled={locked || !props.canPersist || props.state === "executable" || props.state === "invalid" || !props.workflow} onClick={props.onSaveVersion}>{props.state === "saving" ? "Saving…" : "Save version"}</button></div></header>
    {!props.snapshot && props.state === "executable" && !props.hasSuite && <p className="screen-banner">Publish a test set before running this workflow.</p>}
    {props.snapshot && <div className="workflow-snapshot-banner" role="status"><Icon name="route" /><ModeBadge mode={props.snapshot.mode} /> Path from <code>{props.snapshot.runId.slice(0, 8)}</code> · case <code>{props.snapshot.caseId}</code> on saved workflow <code>{props.snapshot.workflowVersionId.slice(0, 8)}</code>. Your draft is untouched.<button onClick={props.onBackResults}>Back to results</button><button onClick={props.onClearPath}>Edit in my draft</button></div>}
    {props.message && !props.snapshot && <p className="screen-banner" role="status">{props.message}</p>}
    <div className="workflow-composition"><aside className="workflow-palette" aria-label="Supported nodes"><strong>Supported nodes</strong>{kinds.map((item) => <button key={item} title={item} aria-label={`Select ${item} node kind`} aria-pressed={kind === item} disabled={locked || item === "start"} onClick={() => setKind(item)}><span aria-hidden="true">{glyph[item]}</span><span>{item}</span></button>)}<button onClick={add} disabled={locked || kind === "start"}><Icon name="plus" /><span>Add {kind}</span></button><small>Only supported canonical node kinds can run.</small></aside><div className="workflow-center"><div className="workflow-editor-wrap" id="workflow-inspector">{active ? <WorkflowEditor workflow={active} layout={activeLayout} selectedNode={props.selectedNode} onSelect={props.onSelectNode} nodeProblems={nodeProblems} onEdit={props.snapshot || locked ? undefined : (next) => props.onEdit(next)} onLayout={props.snapshot || locked ? undefined : props.onLayout} onDocument={props.snapshot || locked ? undefined : props.onDocument} readOnly={!!props.snapshot || locked} readOnlyReason={lockReason} selectedEdges={props.snapshot ? props.snapshot.trace?.selectedEdges ?? [] : undefined} visitedNodes={props.snapshot ? props.snapshot.trace?.visitedNodes ?? [] : undefined} /> : <div className="screen-empty">This draft cannot be drawn safely. Repair the canonical JSON in the JSON tab.</div>}</div><section className="workflow-dock"><div role="tablist" aria-label="Workflow detail tabs"><button role="tab" aria-selected={tab === "problems"} onClick={() => setTab("problems")}>Problems · {activeDiagnostics.length + (shownConflict ? shownConflict.plan.conflicts.length : 0)}</button><button role="tab" aria-selected={tab === "json"} onClick={() => setTab("json")}>JSON</button><button role="tab" aria-selected={tab === "trace"} onClick={() => setTab("trace")}>Selected-run trace</button></div><div className="workflow-dock-content">{tab === "problems" && <>{shownConflict && <div className="merge-conflicts" role="alert"><h3>Another window saved this draft</h3><p>{shownConflict.message}</p>{shownConflict.plan.conflicts.map((conflict) => <div key={conflict.key} className="merge-conflict"><strong>{conflict.path.join(" · ") || conflict.key}</strong><p>{conflict.reason}</p><div className="merge-sides"><div><small>Base</small><Slot value={conflict.base} /></div><div><small>Mine</small><Slot value={conflict.local} /></div><div><small>Latest</small><Slot value={conflict.remote} /></div></div>{conflict.branch && <div className="merge-branch-preview">{(["base", "local", "remote", "combined"] as const).map((side) => { const preview = conflict.branch?.[side]; return preview && <div key={side}><strong>{side}</strong><p>Order: {preview.order.join(" → ") || "none"}</p><p>{preview.destinations.map((edge) => `${edge.port} → ${edge.targetLabel ?? edge.target}`).join(" · ") || "No destinations"}</p><p>Default: {preview.defaultEdges.map((edge) => fmt(edge)).join(" · ") || "None"}</p></div>; })}</div>}<div className="inline-actions">{(["local", "remote", "combine"] as const).map((choice) => <button key={choice} aria-pressed={shownConflict?.choices[conflict.key] === choice} disabled={choice === "combine" && !conflict.combineAvailable} title={choice === "combine" ? conflict.combineReason : undefined} onClick={() => props.onChoice(conflict.key, choice)}>{choice === "local" ? "Keep mine" : choice === "remote" ? "Take latest" : "Combine"}</button>)}</div></div>)}<div className="inline-actions"><button className="primary-action" onClick={props.onResolve}>{shownConflict.plan.conflicts.length ? "Review and save resolution" : "Apply my edits on top"}</button><button onClick={props.onEditMerged}>Edit merged draft</button><button onClick={props.onDismissConflict}>Keep editing</button></div><p>Ordered branches use first true case. Review every port destination and the required default before resolving.</p></div>}{activeDiagnostics.length ? <ul className="workflow-problems">{activeDiagnostics.map((item, index) => <li key={`${item.code}-${index}`}><StatusPill kind={item.severity === "warning" ? "warn" : "error"}>{item.code}</StatusPill><span>{item.message}</span>{!props.snapshot && <button onClick={() => goProblem(item.pointer)}>Go to field</button>}</li>)}</ul> : !shownConflict && <p>{props.snapshot ? "No validation problems in this saved workflow snapshot." : "No validation problems. Save a version to make this draft executable."}</p>}{props.snapshot && (props.diagnostics.length > 0 || props.conflict) && <p className="snapshot-draft-deferred">Draft problems and save conflicts are deferred until you choose Edit in my draft.</p>}</>}{tab === "json" && <textarea aria-label="Workflow JSON" spellCheck={false} disabled={locked} value={props.snapshot ? fmt(props.snapshot.workflow) : props.text} onChange={(event) => props.onText(event.target.value)} onBlur={props.onBoundary} />}{tab === "trace" && (props.snapshot?.trace ? <SavedTrace trace={props.snapshot.trace} workflow={props.snapshot.workflow} /> : <p>{props.snapshot ? `No saved node trace for this ${props.snapshot.status} case.` : "Open a saved case path from Results to inspect its immutable trace."}</p>)}</div></section></div></div>
    <details className="workflow-advanced"><summary>Advanced draft and file tools</summary><div className="inline-actions"><button disabled={!props.canPersist || locked} onClick={props.onSaveDraft}>Save draft only</button><label className="button">Import workflow JSON<input aria-label="Import workflow JSON" type="file" accept=".json" disabled={locked} onChange={(event) => props.onImport(event.target.files?.[0])} /></label><button disabled={!props.workflow || props.state === "invalid" || !!props.snapshot} onClick={props.onExport}>Export workflow JSON</button></div><p>Invalid but parseable definitions may be saved as drafts. Executable versions require validation.</p></details>
    <div className="workflow-mobile-handoff"><button onClick={() => void navigator.clipboard.writeText(window.location.href)}>Copy local editor URL</button></div>
  </div>;
}
