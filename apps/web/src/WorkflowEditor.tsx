import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Background, Controls, Handle, Position, ReactFlow, useUpdateNodeInternals,
  type Connection, type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react";
import { requiredPorts, validateWorkflow, type Workflow, type WorkflowNode } from "@pathsmith/contracts";

export type Layout = { formatVersion?: string; workflowId?: string; positions?: Record<string, { x: number; y: number }> };
type Coverage = {
  started: number; partial: boolean;
  nodes: { nodeId: string; visits: number; startedScenarios: number }[];
  edges: { edgeId: string; traversals: number; sourceVisits: number }[];
};
export type NodeProblem = { severity: "error" | "warning"; message: string };
type Props = {
  workflow: Workflow;
  layout: Layout;
  selectedNode: string;
  onSelect: (id: string) => void;
  onEdit?: (workflow: Workflow) => void;
  onLayout?: (layout: Layout) => void;
  selectedEdges?: string[];
  visitedNodes?: string[];
  coverage?: Coverage | null;
  nodeProblems?: ReadonlyMap<string, NodeProblem[]>;
  readOnly?: boolean;
  readOnlyReason?: string;
  onDocument?: (workflow: Workflow, layout: Layout) => void;
};
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const unique = (existing: string[], base: string) => {
  let id = base, index = 2;
  while (existing.includes(id)) id = `${base}_${index++}`;
  return id;
};

function Card({ id, data, selected }: NodeProps) {
  const definition = data.definition as WorkflowNode;
  const ports = requiredPorts(definition);
  const handleSignature = `${definition.kind}\u0000${ports.join("\u0000")}`;
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(id); }, [id, handleSignature, updateNodeInternals]);
  const visited = data.visited as boolean | undefined;
  const visits = data.visits as string | undefined;
  const problems = data.problems as NodeProblem[] | undefined;
  const problem = problems?.find((item) => item.severity === "error") ?? problems?.[0];
  return <div className={`workflow-card ${selected ? "selected" : ""} ${visited === true ? "path-visited" : visited === false ? "path-unvisited" : ""} ${problem ? `problem-${problem.severity}` : ""}`} tabIndex={0} data-canvas-node={definition.id} onKeyDown={data.onNavigate as (event: ReactKeyboardEvent<HTMLDivElement>) => void} aria-label={`${definition.kind} node ${definition.label}${visited === true ? ", visited" : visited === false ? ", unvisited in this selection" : ""}${problem ? `, ${problems?.length} validation ${problem.severity}: ${problem.message}` : ""}`}>
    <div className="kind">{definition.kind}</div><strong>{definition.label}</strong><code>{definition.id}</code>
    {problem && <span className="workflow-card-problem" title={problems?.map((item) => `${item.severity}: ${item.message}`).join("\n")}>⚠ {problem.severity === "error" ? "Error" : "Warning"} · {problem.message}{(problems?.length ?? 0) > 1 ? ` · ${problems?.length} problems` : ""}</span>}
    {visits && <small className="coverage-count">{visits}</small>}
    {definition.kind !== "start" && <Handle type="target" position={Position.Left} />}
    <div className="ports">{ports.map((port, index) => <span key={port}>{port}<Handle id={port} type="source" position={Position.Right} style={{ top: `${((index + 1) * 100) / (ports.length + 1)}%` }} /></span>)}</div>
  </div>;
}
const nodeTypes = { workflow: Card };
function appColorMode(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function defaultPosition(workflow: Workflow, id: string) {
  const seen = new Set<string>();
  const levels = new Map<string, number>();
  const walk = (current: string, depth: number) => {
    if (seen.has(current) && (levels.get(current) ?? 0) >= depth) return;
    if (depth > workflow.nodes.length) return;
    seen.add(current); levels.set(current, depth);
    workflow.edges.filter((edge) => edge.source === current).forEach((edge) => walk(edge.target, depth + 1));
  };
  const start = workflow.nodes.find((node) => node.kind === "start");
  if (start) walk(start.id, 0);
  const depth = levels.get(id) ?? workflow.nodes.length;
  const peers = workflow.nodes.filter((node) => (levels.get(node.id) ?? workflow.nodes.length) === depth);
  return { x: depth * 235, y: peers.findIndex((node) => node.id === id) * 155 };
}

function references(workflow: Workflow) {
  const result: string[] = ["input", ...Object.keys(workflow.inputSchema.properties ?? {}).map((key) => `input.${key}`)];
  for (const node of workflow.nodes) {
    if (node.kind === "judgment") {
      result.push(`outputs.${node.id}`);
      for (const [key, question] of Object.entries(node.questions)) {
        result.push(`outputs.${node.id}.${key}.value`);
        if (question.kind === "choice") result.push(`outputs.${node.id}.${key}.confidence`);
        if (question.kind === "binary") result.push(`outputs.${node.id}.${key}.probabilityTrue`);
      }
    } else if (node.kind === "transform") result.push(`outputs.${node.id}`);
  }
  return result;
}

export function WorkflowEditor({ workflow, layout, selectedNode, onSelect, onEdit, onLayout, selectedEdges, visitedNodes, coverage, nodeProblems, readOnly = false, readOnlyReason, onDocument }: Props) {
  const [colorMode, setColorMode] = useState(appColorMode);
  useEffect(() => {
    const observer = new MutationObserver(() => setColorMode(appColorMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    setColorMode(appColorMode());
    return () => observer.disconnect();
  }, []);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const currentWorkflow = useRef(workflow);
  const currentSelection = useRef(selectedNode);
  currentWorkflow.current = workflow;
  currentSelection.current = selectedNode;
  const arrowTrail = useRef<string[]>([]);
  const nextEdge = useRef<Map<string, number>>(new Map());
  const fitGeneration = useRef(0);
  const fitFrame = useRef<number | null>(null);
  const mounted = useRef(false);
  const pendingFocus = useRef<string | null>(null);
  const resetZoom = useRef(true);
  const dimensions = useRef(new Map<string, { width: number; height: number }>());
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const currentNodes = useRef<Node[]>([]);
  const [fitReady, setFitReady] = useState(false);
  const scheduleFit = useCallback((reset = false) => {
    if (!mounted.current) return;
    const generation = ++fitGeneration.current;
    if (fitFrame.current !== null) window.cancelAnimationFrame(fitFrame.current);
    resetZoom.current ||= reset;
    setFitReady(false);
    const current = () => mounted.current && generation === fitGeneration.current;
    const again = () => {
      if (current()) fitFrame.current = window.requestAnimationFrame(settle);
    };
    function settle() {
      fitFrame.current = null;
      if (!current()) return;
      const canvas = canvasRef.current;
      const viewport = canvas?.querySelector<HTMLElement>(".react-flow");
      // A hidden/mobile canvas waits for ResizeObserver instead of polling forever.
      if (!canvas || !viewport?.clientWidth || !viewport.clientHeight) return;
      const flow = flowRef.current;
      if (!flow?.viewportInitialized) { again(); return; }
      const nodes = currentNodes.current;
      const measured = nodes.map((node) => flow.getInternalNode(node.id));
      // Controlled node adoption follows React commit. Do not center an older graph.
      if (!nodes.length || measured.some((node, index) => !node || node.internals.userNode !== nodes[index] ||
        !(node.measured.width && node.measured.height))) { again(); return; }
      const selected = pendingFocus.current ?? currentSelection.current;
      const anchor = measured.find((node) => node?.id === selected) ?? measured.find((node) =>
        currentWorkflow.current.nodes.find((definition) => definition.id === node?.id)?.kind === "start") ?? measured[0];
      if (!anchor) return;
      const card = [...canvas.querySelectorAll<HTMLElement>("[data-canvas-node]")].find((node) => node.dataset.canvasNode === anchor.id);
      if (!card) { again(); return; }
      // Native focus may scroll an overflow-hidden flow; pan/zoom owns this viewport.
      viewport.scrollLeft = 0; viewport.scrollTop = 0;
      const zoom = resetZoom.current ? 0.85 : flow.getZoom();
      const next = { x: viewport.clientWidth / 2 - (anchor.internals.positionAbsolute.x + anchor.measured.width! / 2) * zoom,
        y: viewport.clientHeight / 2 - (anchor.internals.positionAbsolute.y + anchor.measured.height! / 2) * zoom, zoom };
      const previous = flow.getViewport();
      if (Math.abs(previous.x - next.x) > 0.25 || Math.abs(previous.y - next.y) > 0.25 || previous.zoom !== zoom) {
        // setCenter uses RF's asynchronously observed width/height. Use current DOM dimensions.
        void flow.setViewport(next, { duration: 0 }).then(() => { again(); });
        return;
      }
      const bounds = viewport.getBoundingClientRect(), box = card.getBoundingClientRect();
      const centered = Math.abs((box.left + box.right - bounds.left - bounds.right) / 2) < 2 &&
        Math.abs((box.top + box.bottom - bounds.top - bounds.bottom) / 2) < 2;
      if (!box.width || !box.height || !centered || box.right <= bounds.left || box.left >= bounds.right || box.bottom <= bounds.top || box.top >= bounds.bottom) {
        again(); return;
      }
      if (pendingFocus.current === anchor.id) {
        card.focus({ preventScroll: true });
        if (document.activeElement !== card) { again(); return; }
        pendingFocus.current = null;
      }
      resetZoom.current = false;
      setFitReady(true);
    }
    again();
  }, []);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let changed = false;
    for (const change of changes) {
      if (change.type !== "dimensions" || !change.dimensions) continue;
      const previous = dimensions.current.get(change.id);
      if (previous?.width === change.dimensions.width && previous.height === change.dimensions.height) continue;
      dimensions.current.set(change.id, change.dimensions);
      changed = true;
    }
    if (changed) { setMeasurementVersion((version) => version + 1); scheduleFit(); }
  }, [scheduleFit]);
  useEffect(() => {
    mounted.current = true;
    const observer = new ResizeObserver(() => scheduleFit(true));
    if (canvasRef.current) observer.observe(canvasRef.current);
    scheduleFit(true);
    return () => {
      mounted.current = false;
      observer.disconnect(); fitGeneration.current++;
      if (fitFrame.current !== null) window.cancelAnimationFrame(fitFrame.current);
      flowRef.current = null;
    };
  }, [scheduleFit]);
  useEffect(() => { scheduleFit(); }, [workflow, layout, selectedNode, scheduleFit]);
  const [feedback, setFeedback] = useState("");
  const [newKind, setNewKind] = useState<WorkflowNode["kind"]>("branch");
  const editable = !!onEdit && !readOnly;
  const chosen = workflow.nodes.find((node) => node.id === selectedNode);
  const refs = useMemo(() => references(workflow), [workflow]);
  const graphNodes: Node[] = useMemo(() => workflow.nodes.map((definition) => {
    const count = coverage?.nodes.find((item) => item.nodeId === definition.id);
    return { id: definition.id, type: "workflow", selected: definition.id === selectedNode,
      measured: dimensions.current.get(definition.id),
      position: layout.positions?.[definition.id] ?? defaultPosition(workflow, definition.id),
      data: { definition, problems: nodeProblems?.get(definition.id), visited: visitedNodes ? visitedNodes.includes(definition.id) : coverage ? (count?.visits ?? 0) > 0 : undefined,
        visits: count ? `${count.visits}/${count.startedScenarios} started` : undefined,
        onNavigate: (event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Enter" || event.key === " ") { pendingFocus.current = definition.id; onSelect(definition.id); scheduleFit(); return; }
          const position = defaultPosition(workflow, definition.id);
          const neighbors = workflow.nodes.map((node) => ({ node, at: defaultPosition(workflow, node.id) }));
          const peers = neighbors.filter((item) => Math.abs(item.at.x - position.x) < 30).sort((a, b) => a.at.y - b.at.y);
          const index = peers.findIndex((item) => item.node.id === definition.id);
          let target: string | undefined;
          if (event.key === "ArrowRight") {
            const outgoing = workflow.edges.filter((edge) => edge.source === definition.id);
            if (outgoing.length) {
              const cursor = nextEdge.current.get(definition.id) ?? 0;
              target = outgoing[cursor % outgoing.length].target;
              nextEdge.current.set(definition.id, cursor + 1);
              arrowTrail.current.push(definition.id);
            }
          } else if (event.key === "ArrowLeft") {
            const previous = arrowTrail.current.at(-1);
            target = previous && workflow.edges.some((edge) => edge.source === previous && edge.target === definition.id)
              ? arrowTrail.current.pop() : workflow.edges.find((edge) => edge.target === definition.id)?.source;
          } else {
            arrowTrail.current = [];
            target = (event.key === "ArrowDown" ? peers[index + 1] : peers[index - 1])?.node.id;
            if (!target) {
              const incoming = workflow.edges.find((edge) => edge.target === definition.id);
              const siblings = incoming && workflow.edges.filter((edge) => edge.source === incoming.source);
              const siblingIndex = siblings?.findIndex((edge) => edge.target === definition.id) ?? -1;
              target = (event.key === "ArrowDown" ? siblings?.[siblingIndex + 1] : siblings?.[siblingIndex - 1])?.target;
            }
          }
          if (target) { pendingFocus.current = target; onSelect(target); scheduleFit(); }
        } },
    };
  }), [workflow, layout, selectedNode, coverage, selectedEdges, visitedNodes, nodeProblems, onSelect, measurementVersion, scheduleFit]);
  currentNodes.current = graphNodes;
  const graphEdges: Edge[] = workflow.edges.map((edge) => {
    const count = coverage?.edges.find((item) => item.edgeId === edge.id);
    const visited = selectedEdges ? selectedEdges.includes(edge.id) : coverage ? (count?.traversals ?? 0) > 0 : undefined;
    return { id: edge.id, source: edge.source, sourceHandle: edge.port, target: edge.target, type: "smoothstep",
      label: coverage && count ? `${edge.port}: ${count.traversals}/${count.sourceVisits || "N/A"} source visits` : edge.port === "next" ? "" : edge.port,
      className: visited === true ? "path-visited" : visited === false ? "path-unvisited" : "",
    };
  });
  function editNode(update: (node: WorkflowNode) => WorkflowNode) {
    if (!chosen || !onEdit) return;
    const next = structuredClone(workflow);
    const index = next.nodes.findIndex((node) => node.id === chosen.id);
    next.nodes[index] = update(next.nodes[index]);
    onEdit(next);
    setFeedback("");
  }
  function changeConnection(connection: Connection, oldId?: string) {
    if (!onEdit || !connection.source || !connection.target || !connection.sourceHandle) return;
    const source = workflow.nodes.find((node) => node.id === connection.source);
    const target = workflow.nodes.find((node) => node.id === connection.target);
    if (!source || !target || target.kind === "start" || source.id === target.id || !requiredPorts(source).includes(connection.sourceHandle)) {
      setFeedback("Invalid connection: choose a source port and a different destination node."); return;
    }
    const next = structuredClone(workflow);
    const existing = next.edges.find((edge) => edge.source === source.id && edge.port === connection.sourceHandle);
    next.edges = next.edges.filter((edge) => edge.id !== oldId && !(edge.source === source.id && edge.port === connection.sourceHandle)) as Workflow["edges"];
    next.edges.push({ id: existing?.id ?? unique(next.edges.map((edge) => edge.id), `e_${source.id}_${connection.sourceHandle}`), source: source.id, port: connection.sourceHandle, target: target.id });
    const links = new Map<string, string[]>();
    next.edges.forEach((edge) => links.set(edge.source, [...(links.get(edge.source) ?? []), edge.target]));
    const reaches = (from: string, goal: string, seen = new Set<string>()): boolean => {
      if (from === goal) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return (links.get(from) ?? []).some((id) => reaches(id, goal, seen));
    };
    if (reaches(target.id, source.id)) { setFeedback("Invalid connection: cycles are not allowed."); return; }
    const result = validateWorkflow(next);
    if (result.diagnostics.some((item) => ["REFERENCE_NOT_DOMINATING", "INVALID_REFERENCE"].includes(item.code))) {
      setFeedback(`Invalid connection: ${result.diagnostics.find((item) => item.code.includes("REFERENCE"))?.message}`); return;
    }
    onEdit(next); setFeedback("");
  }
  function addNode() {
    if (!onEdit || newKind === "start") return;
    const next = structuredClone(workflow);
    const id = unique(next.nodes.map((node) => node.id), newKind);
    const sample: WorkflowNode = newKind === "branch" ? { id, label: "New branch", kind: "branch", cases: [{ id: "case_1", when: { op: "literal", value: true } }] } :
      newKind === "judgment" ? { id, label: "New judgment", kind: "judgment", binding: workflow.bindings[0] ?? "decisions", state: { op: "ref", path: ["input"] }, questions: { decision: { kind: "binary", instructions: "Describe the decision." } } } :
      newKind === "transform" ? { id, label: "New transform", kind: "transform", value: { op: "ref", path: ["input"] } } :
      { id, label: "New output", kind: "output", outcomeId: id, value: { op: "literal", value: null } };
    next.nodes.push(sample); onSelect(id);
    const nextLayout = { ...layout, positions: { ...layout.positions, [id]: { x: workflow.nodes.length * 235, y: 0 } } };
    if (onDocument) onDocument(next, nextLayout); else { onEdit(next); onLayout?.(nextLayout); }
    setFeedback("Connect the new node through its named ports; the draft may be incomplete until then.");
  }
  function deleteNode() {
    if (!chosen || !onEdit || chosen.kind === "start") return;
    const next = structuredClone(workflow);
    next.nodes = next.nodes.filter((node) => node.id !== chosen.id) as Workflow["nodes"];
    next.edges = next.edges.filter((edge) => edge.source !== chosen.id && edge.target !== chosen.id) as Workflow["edges"];
    onSelect("");
    const positions = { ...layout.positions }; delete positions[chosen.id];
    if (onDocument) onDocument(next, { ...layout, positions }); else { onEdit(next); onLayout?.({ ...layout, positions }); }
  }
  function setCase(index: number, field: "id" | "when", value: string) {
    if (chosen?.kind !== "branch") return;
    if (field === "when") {
      try { const parsed = JSON.parse(value); editNode((node) => { if (node.kind !== "branch") return node; node.cases[index].when = parsed; return node; }); }
      catch (error) { setFeedback(`Expression JSON was not applied: ${String(error)}`); }
    } else {
      if (!value.trim() || chosen.cases.some((item, i) => i !== index && item.id === value)) { setFeedback("Case port IDs must be unique and nonempty."); return; }
      const old = chosen.cases[index].id;
      const next = structuredClone(workflow);
      const branch = next.nodes.find((node) => node.id === chosen.id);
      if (branch?.kind !== "branch") return;
      branch.cases[index].id = value;
      next.edges.forEach((edge) => { if (edge.source === chosen.id && edge.port === old) edge.port = value; });
      onEdit?.(next);
    }
  }
  return <div className={`editor ${readOnly ? "editor-readonly" : ""}`}>
    <ol className="editor-mobile-list" aria-label="Workflow nodes">{workflow.nodes.map((node, index) => { const problems = nodeProblems?.get(node.id) ?? []; const problem = problems.find((item) => item.severity === "error") ?? problems[0]; return <li key={node.id}><button className={problem ? `problem-${problem.severity}` : ""} aria-pressed={selectedNode === node.id} onClick={() => onSelect(node.id)}><code>{index + 1}</code><span><strong>{node.label}</strong><small>{node.kind} · {node.id}</small>{problem && <em className="workflow-mobile-problem">⚠ {problem.severity === "error" ? "Error" : "Warning"}: {problem.message}{problems.length > 1 ? ` · ${problems.length} problems` : ""}</em>}</span><span>{visitedNodes ? visitedNodes.includes(node.id) ? "Visited" : "Unvisited" : "Inspect"}</span></button></li>; })}</ol>
    <div className="canvas" ref={canvasRef} data-fit-ready={fitReady}><ReactFlow nodes={graphNodes} edges={graphEdges} nodeTypes={nodeTypes} nodesDraggable={editable} nodesConnectable={editable} edgesReconnectable={editable}
      onInit={(instance) => { if (mounted.current) { flowRef.current = instance; scheduleFit(true); } }}
      onNodesChange={onNodesChange}
      onNodeClick={(_, item) => onSelect(item.id)} onPaneClick={() => onSelect("")}
      onConnect={changeConnection} onReconnect={(old, connection) => changeConnection(connection, old.id)}
      onNodeDragStop={(_, item) => onLayout?.({ ...layout, positions: { ...layout.positions, [item.id]: item.position } })}
      defaultViewport={{ x: 0, y: 0, zoom: 0.85 }} minZoom={0.2} colorMode={colorMode} nodesFocusable={false} deleteKeyCode={null} panOnDrag><Background gap={16} color="var(--grid-dot)" /><Controls showInteractive={editable} /></ReactFlow></div>
    <aside className="inspector" aria-label={readOnly ? "Node inspector, read only" : "Node inspector"}>
      <span className="eyebrow">NODE INSPECTOR</span>
      {editable && <div className="row"><label>New node kind<select aria-label="New node kind" value={newKind} onChange={(event) => setNewKind(event.target.value as WorkflowNode["kind"])}><option value="judgment">Judgment</option><option value="transform">Transform</option><option value="branch">Branch</option><option value="output">Output</option></select></label><button onClick={addNode}>Add node</button></div>}
      {feedback && <p className="editor-feedback" role="alert">{feedback}</p>}
      {readOnly && <p className="inspector-readonly-note">{readOnlyReason ?? "Read only."}</p>}
      <fieldset className="inspector-fields" disabled={!editable}>
      {chosen ? <>
        <h2>{chosen.label}</h2><p><code>{chosen.id}</code> · {chosen.kind}</p>
        <label>Node label<input aria-label="Node label" value={chosen.label} onChange={(event) => editNode((node) => ({ ...node, label: event.target.value }))} /></label>
        {chosen.kind === "judgment" && <>
          <label>Binding<select aria-label="Judgment binding" value={chosen.binding} onChange={(event) => editNode((node) => node.kind === "judgment" ? { ...node, binding: event.target.value } : node)}>{workflow.bindings.map((binding) => <option key={binding}>{binding}</option>)}</select></label>
          <label>State reference<select aria-label="Judgment state reference" value={chosen.state.op === "ref" ? chosen.state.path.join(".") : ""} onChange={(event) => editNode((node) => node.kind === "judgment" ? { ...node, state: { op: "ref", path: event.target.value.split(".") as [string, ...string[]] } } : node)}><option value="">Advanced expression</option>{refs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}</select></label>
          <details><summary>State expression JSON</summary><textarea key={`${chosen.id}-state-${pretty(chosen.state)}`} aria-label="State expression JSON" defaultValue={pretty(chosen.state)} onBlur={(event) => { try { const value = JSON.parse(event.target.value); editNode((node) => node.kind === "judgment" ? { ...node, state: value } : node); } catch (error) { setFeedback(String(error)); } }} /></details>
          {Object.entries(chosen.questions).map(([key, question]) => <fieldset key={key}><legend>{key} · {question.kind}</legend>
            <label>Question instructions<textarea aria-label={`${key} instructions`} value={question.instructions} onChange={(event) => editNode((node) => { if (node.kind !== "judgment") return node; node.questions[key].instructions = event.target.value; return node; })} /></label>
            {question.kind === "choice" && Object.entries(question.options).map(([option, description]) => <label key={option}>{option} description<input aria-label={`${key} ${option} description`} value={description} onChange={(event) => editNode((node) => { if (node.kind !== "judgment") return node; const q = node.questions[key]; if (q.kind === "choice") q.options[option] = event.target.value; return node; })} /></label>)}
            {question.kind === "score" && question.levels.map((level, index) => <label key={index}>Level {index}<input aria-label={`${key} level ${index}`} value={level} onChange={(event) => editNode((node) => { if (node.kind !== "judgment") return node; const q = node.questions[key]; if (q.kind === "score") q.levels[index] = event.target.value; return node; })} /></label>)}
            {question.kind === "binary" && <><label>True criteria<input aria-label={`${key} true criteria`} value={question.trueCriteria ?? ""} onChange={(event) => editNode((node) => { if (node.kind !== "judgment") return node; const q = node.questions[key]; if (q.kind === "binary") q.trueCriteria = event.target.value; return node; })} /></label><label>False criteria<input aria-label={`${key} false criteria`} value={question.falseCriteria ?? ""} onChange={(event) => editNode((node) => { if (node.kind !== "judgment") return node; const q = node.questions[key]; if (q.kind === "binary") q.falseCriteria = event.target.value; return node; })} /></label></>}
          </fieldset>)}
          <details><summary>Questions JSON (types and options)</summary><textarea key={`${chosen.id}-questions-${pretty(chosen.questions)}`} aria-label="Questions JSON" defaultValue={pretty(chosen.questions)} onBlur={(event) => { try { const value = JSON.parse(event.target.value); editNode((node) => node.kind === "judgment" ? { ...node, questions: value } : node); } catch (error) { setFeedback(String(error)); } }} /></details>
        </>}
        {chosen.kind === "branch" && <><p>Cases run top to bottom; first true wins. Later cases are not evaluated. Default is explicit.</p>
          {chosen.cases.map((item, index) => {
            const expr = item.when;
              const simple = "left" in expr && "right" in expr && !!expr.left && !!expr.right && expr.left.op === "ref" && expr.right.op === "literal";
            return <fieldset key={`${index}-${item.id}`}><legend>Case {index + 1}</legend>
              <label>Port ID<input aria-label={`Case ${index + 1} port ID`} value={item.id} onChange={(event) => setCase(index, "id", event.target.value)} /></label>
              {simple && "left" in expr && "right" in expr && !!expr.left && !!expr.right && expr.left.op === "ref" && expr.right.op === "literal" && <>
                <label>Field reference<select aria-label={`Case ${index + 1} field reference`} value={expr.left.path.join(".")} onChange={(event) => editNode((node) => { if (node.kind !== "branch") return node; const current = node.cases[index].when; if ("left" in current) current.left = { op: "ref", path: event.target.value.split(".") as [string, ...string[]] }; return node; })}>{refs.map((ref) => <option key={ref}>{ref}</option>)}</select></label>
                <label>Operator<select aria-label={`Case ${index + 1} operator`} value={expr.op} onChange={(event) => editNode((node) => { if (node.kind !== "branch") return node; const current = node.cases[index].when; if ("left" in current && "right" in current) node.cases[index].when = { ...current, op: event.target.value as typeof current.op }; return node; })}>{["eq", "ne", "gt", "gte", "lt", "lte", "in"].map((op) => <option key={op}>{op}</option>)}</select></label>
                <label>Literal value<input aria-label={`Case ${index + 1} literal value`} value={String(expr.right.value)} onChange={(event) => editNode((node) => { if (node.kind !== "branch") return node; const current = node.cases[index].when; if ("right" in current) current.right = { op: "literal", value: /^-?(?:\d+\.?\d*|\.\d+)$/.test(event.target.value) ? Number(event.target.value) : event.target.value }; return node; })} /></label>
              </>}
              <label>Destination<select aria-label={`Case ${index + 1} destination`} value={workflow.edges.find((edge) => edge.source === chosen.id && edge.port === item.id)?.target ?? ""} onChange={(event) => changeConnection({ source: chosen.id, sourceHandle: item.id, target: event.target.value, targetHandle: null })}><option value="">Connect a node</option>{workflow.nodes.filter((node) => node.id !== chosen.id && node.kind !== "start").map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
              <div className="row"><button disabled={index === 0} onClick={() => editNode((node) => { if (node.kind !== "branch") return node; [node.cases[index - 1], node.cases[index]] = [node.cases[index], node.cases[index - 1]]; return node; })}>Move up</button><button disabled={index === chosen.cases.length - 1} onClick={() => editNode((node) => { if (node.kind !== "branch") return node; [node.cases[index], node.cases[index + 1]] = [node.cases[index + 1], node.cases[index]]; return node; })}>Move down</button><button disabled={chosen.cases.length === 1} onClick={() => { const next = structuredClone(workflow); const branch = next.nodes.find((node) => node.id === chosen.id); if (branch?.kind !== "branch") return; const [removed] = branch.cases.splice(index, 1); next.edges = next.edges.filter((edge) => !(edge.source === chosen.id && edge.port === removed.id)) as Workflow["edges"]; onEdit?.(next); }}>Remove case</button></div>
              <details><summary>Advanced expression JSON</summary><textarea key={`${chosen.id}-${item.id}-${pretty(item.when)}`} aria-label={`Case ${index + 1} expression JSON`} defaultValue={pretty(item.when)} onBlur={(event) => setCase(index, "when", event.target.value)} /></details>
            </fieldset>;
          })}
          <button onClick={() => editNode((node) => { if (node.kind !== "branch") return node; node.cases.push({ id: unique(node.cases.map((item) => item.id), "case"), when: { op: "literal", value: true } }); return node; })}>Add branch case</button>
          <label>Default destination<select aria-label="Default destination" value={workflow.edges.find((edge) => edge.source === chosen.id && edge.port === "default")?.target ?? ""} onChange={(event) => changeConnection({ source: chosen.id, sourceHandle: "default", target: event.target.value, targetHandle: null })}><option value="">Connect a node</option>{workflow.nodes.filter((node) => node.id !== chosen.id && node.kind !== "start").map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
        </>}
        {chosen.kind === "output" && <label>Outcome ID<input aria-label="Outcome ID" value={chosen.outcomeId} onChange={(event) => editNode((node) => node.kind === "output" ? { ...node, outcomeId: event.target.value } : node)} /></label>}
        {(chosen.kind === "transform" || chosen.kind === "output") && <details><summary>Value expression JSON</summary><textarea key={`${chosen.id}-value-${pretty(chosen.value)}`} aria-label="Value expression JSON" defaultValue={pretty(chosen.value)} onBlur={(event) => { try { const value = JSON.parse(event.target.value); editNode((node) => node.kind === "transform" || node.kind === "output" ? { ...node, value } : node); } catch (error) { setFeedback(String(error)); } }} /></details>}
        {chosen.kind !== "start" && chosen.kind !== "output" && chosen.kind !== "branch" && <label>Next destination<select aria-label="Next destination" value={workflow.edges.find((edge) => edge.source === chosen.id && edge.port === "next")?.target ?? ""} onChange={(event) => changeConnection({ source: chosen.id, sourceHandle: "next", target: event.target.value, targetHandle: null })}><option value="">Connect a node</option>{workflow.nodes.filter((node) => node.id !== chosen.id && node.kind !== "start").map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>}
        <button className="danger" disabled={chosen.kind === "start"} onClick={deleteNode}>Delete node and connections</button>
        <details><summary>Canonical node JSON</summary><pre>{pretty(chosen)}</pre></details>
      </> : <p>Select a node to inspect its canonical configuration. Layout stays separate from workflow semantics.</p>}
      </fieldset>
    </aside>
  </div>;
}
