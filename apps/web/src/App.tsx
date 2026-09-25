import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type NodeProps,
} from "@xyflow/react";
import {
  parseJson,
  requiredPorts,
  validateWorkflow,
  type Workflow,
  type WorkflowNode,
} from "@pathsmith/contracts";
import baseline from "../../../examples/support-routing/baseline.workflow.json";
import candidate from "../../../examples/support-routing/candidate.workflow.json";
import "@xyflow/react/dist/style.css";
import "./style.css";

function WorkflowCard({ data, selected }: NodeProps) {
  const node = data.definition as WorkflowNode;
  return (
    <div className={`workflow-card ${selected ? "selected" : ""}`}>
      <div className="kind">{node.kind}</div>
      <strong>{node.label}</strong>
      <code>{node.id}</code>
      {node.kind !== "start" && (
        <Handle type="target" position={Position.Top} />
      )}
      <div className="ports">
        {requiredPorts(node).map((port, index, ports) => (
          <span key={port}>
            {port}
            <Handle
              id={port}
              type="source"
              position={Position.Bottom}
              style={{ left: `${((index + 1) * 100) / (ports.length + 1)}%` }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}
const nodeTypes = { workflow: WorkflowCard };
const examples = { baseline, candidate };
export default function App() {
  const [example, setExample] = useState("baseline");
  const [text, setText] = useState(JSON.stringify(baseline, null, 2));
  const [view, setView] = useState<"graph" | "json">("graph");
  const [selected, setSelected] = useState<string>("confidence_gate");
  const [importError, setImportError] = useState("");
  const [health, setHealth] = useState("Checking API…");
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/v1/health", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(() => setHealth("API ready"))
      .catch(() => {
        if (!abort.signal.aborted) setHealth("API unavailable");
      });
    return () => abort.abort();
  }, []);
  const validation = useMemo(() => {
    try {
      const value = parseJson(text, 512 * 1024);
      const result = validateWorkflow(value);
      return {
        result,
        workflow: result.valid ? (value as unknown as Workflow) : null,
      };
    } catch (e) {
      return {
        result: {
          valid: false,
          diagnostics: [
            {
              code: "JSON_INVALID",
              message: e instanceof Error ? e.message : "Invalid JSON",
              pointer: "",
              severity: "error" as const,
            },
          ],
        },
        workflow: null,
      };
    }
  }, [text]);
  const workflow = validation.workflow;
  const depths = useMemo(() => {
    const map = new Map<string, number>();
    if (!workflow) return map;
    const visit = (id: string, depth: number) => {
      if (depth <= (map.get(id) ?? -1)) return;
      map.set(id, depth);
      workflow.edges
        .filter((e) => e.source === id)
        .forEach((e) => visit(e.target, depth + 1));
    };
    visit(workflow.nodes.find((n) => n.kind === "start")!.id, 0);
    return map;
  }, [workflow]);
  const nodes = useMemo(() => {
    const counts = new Map<number, number>();
    return (
      workflow?.nodes.map((n) => {
        const depth = depths.get(n.id) ?? 0,
          index = counts.get(depth) ?? 0;
        counts.set(depth, index + 1);
        return {
          id: n.id,
          type: "workflow",
          selected: n.id === selected,
          data: { definition: n },
          position: { x: index * 270, y: depth * 175 },
        };
      }) ?? []
    );
  }, [workflow, depths, selected]);
  const edges =
    workflow?.edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.port,
      target: e.target,
      type: "smoothstep",
      label: e.port === "next" ? "" : e.port,
    })) ?? [];
  const node = workflow?.nodes.find((n) => n.id === selected);
  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      setImportError(
        "Import exceeds 512 KiB. The current definition was preserved.",
      );
      return;
    }
    try {
      const imported = await file.text();
      parseJson(imported, 512 * 1024);
      setText(imported);
      setImportError("");
    } catch {
      setImportError(
        "The file is not safe, valid JSON. The current definition was preserved.",
      );
      return;
    }
    setExample("imported");
    setView("json");
  }
  function exportFile() {
    if (!workflow) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(workflow, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${workflow.id}.workflow.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/">
          p<span>Pathsmith</span>
        </a>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav>
          <span>
            Projects <small>M2</small>
          </span>
          <span className="active">
            Workflow <small>preview</small>
          </span>
          <span>
            Scenarios <small>M2</small>
          </span>
          <span>
            Runs <small>M2</small>
          </span>
          <span>
            Compare <small>M3</small>
          </span>
        </nav>
        <div className="sidebar-footer">
          <span className="dot" />
          {health}
          <p>
            Local execution foundation
            <br />
            M0–M1 · v0.1
          </p>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="breadcrumb">Examples / Support routing</span>
            <h1>Inspect the decision path.</h1>
          </div>
          <span className="mode">● MOCK · OFFLINE</span>
        </header>
        <div className="milestone-note">
          <strong>A working engine. An early workspace.</strong>
          <span>
            Validate definitions here. Run suites and inspect complete reports
            with the CLI. Saving, visual authoring, and run history arrive in
            the next milestones.
          </span>
        </div>
        {importError && <p role="alert">{importError}</p>}
        <section className="workspace">
          <div className="toolbar">
            <label className="example-picker">
              Definition{" "}
              <select
                aria-label="Example definition"
                value={example}
                onChange={(e) => {
                  setExample(e.target.value);
                  setText(
                    JSON.stringify(
                      examples[e.target.value as keyof typeof examples],
                      null,
                      2,
                    ),
                  );
                }}
              >
                <option value="baseline">Baseline · ≥ 0.70</option>
                <option value="candidate">Candidate · ≥ 0.80</option>
                {example === "imported" && (
                  <option value="imported">Imported definition</option>
                )}
              </select>
            </label>
            <div className="toolbar-actions">
              <label className="button">
                Import JSON
                <input
                  aria-label="Import workflow JSON"
                  type="file"
                  accept=".json"
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
              </label>
              <button disabled={!workflow} onClick={exportFile}>
                Export workflow
              </button>
            </div>
          </div>
          <div className="tabs">
            <button
              aria-pressed={view === "graph"}
              onClick={() => setView("graph")}
            >
              Graph preview
            </button>
            <button
              aria-pressed={view === "json"}
              onClick={() => setView("json")}
            >
              JSON definition
            </button>
            <span
              className={
                validation.result.valid
                  ? "validation valid"
                  : "validation invalid"
              }
              role="status"
            >
              {validation.result.valid
                ? "✓ Valid definition"
                : `! ${validation.result.diagnostics.length} problem(s)`}
            </span>
          </div>
          <div className="editor">
            <div className="canvas">
              {view === "json" ? (
                <textarea
                  aria-label="Workflow JSON"
                  spellCheck={false}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              ) : workflow ? (
                <ReactFlow
                  key={example + workflow.id}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  edgesReconnectable={false}
                  onNodeClick={(_, n) => setSelected(n.id)}
                  fitView
                  minZoom={0.2}
                  colorMode="dark"
                >
                  <Background gap={22} color="#28333d" />
                  <Controls showInteractive={false} />
                </ReactFlow>
              ) : (
                <div className="empty">
                  <strong>Resolve the definition errors</strong>
                  <p>The graph preview requires a valid workflow.</p>
                  <button onClick={() => setView("json")}>
                    Open JSON definition
                  </button>
                </div>
              )}
            </div>
            <aside className="inspector">
              <span className="eyebrow">DEFINITION INSPECTOR</span>
              <h2>{node?.label ?? "Select a node"}</h2>
              <p>Canonical configuration. No execution is shown here.</p>
              {node && <pre>{JSON.stringify(node, null, 2)}</pre>}
            </aside>
          </div>
          <div className="problems">
            <strong>
              {validation.result.valid
                ? "Preflight passed"
                : "Definition problems"}
            </strong>
            {validation.result.valid ? (
              <span>
                {workflow?.nodes.length} nodes · {workflow?.edges.length} edges
                · acyclic · validated output dependencies
              </span>
            ) : (
              <ul>
                {validation.result.diagnostics.slice(0, 12).map((d, i) => (
                  <li key={i}>
                    <code>{d.code}</code> {d.pointer} — {d.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="next-step">
          <div>
            <span className="eyebrow">EXECUTE THE COMPLETE HEADLESS LOOP</span>
            <h2>Build → run → inspect → compare</h2>
            <p>
              The demo writes real, immutable reports with ordered traces, exact
              synthetic exchanges, assertions, and observed coverage.
            </p>
          </div>
          <div className="commands">
            <code>pnpm demo</code>
            <code>pnpm test:parity</code>
            <span>Reports: .pathsmith/reports/ · no credentials needed</span>
          </div>
        </section>
      </main>
    </div>
  );
}
