import { useEffect, useMemo, useRef, useState } from "react";
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
  type Suite,
  type Workflow,
  type WorkflowNode,
} from "@pathsmith/contracts";
import gaming from "../../../examples/gaming/workflow.json";
import "@xyflow/react/dist/style.css";
import "./style.css";

type Project = { id: string; name: string };
type Draft<T> = {
  id: string;
  projectId: string;
  name: string;
  definition: T;
  draftRevision: number;
  diagnostics: { code: string; message: string }[];
};
type Version = { id: string; draftRevision: number; createdAt: string };
type Example = { id: string; name: string; fixtureSetId: string };
type Page<T> = { items: T[]; total: number };
type Run = {
  id: string;
  projectId: string;
  status: string;
  mode: string;
  workflowName: string;
  suiteName: string;
  workflowVersionId: string;
  suiteVersionId: string;
  createdAt: string;
  progress: {
    selected: number;
    persisted: number;
    pending: number;
    interrupted: number;
  };
  summary: {
    labeled: number;
    unlabeled: number;
    completed: number;
    failedExecution: number;
    canceled: number;
    interrupted: number;
    assertionPassed: number;
    assertionFailed: number;
    logicalJudgments: number;
    actualHttpAttempts: number;
  };
  error?: { code: string; message: string } | null;
};
type CaseRun = {
  id: string;
  scenarioId: string;
  result: {
    status: string;
    assertionStatus: string;
    result?: { outcomeId: string; value: unknown };
    error?: { code: string; message: string };
    assertions: {
      label?: string;
      passed?: boolean;
      kind?: string;
      message?: string;
    }[];
    visitedNodes: string[];
    selectedEdges: string[];
  };
};
type Snapshot = {
  workflow: Workflow;
  suite: Suite;
  selectedScenarioIds: string[];
  profile: unknown;
  mode: string;
  origin: string;
};

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers:
      method === "GET"
        ? undefined
        : { "Content-Type": "application/json", "X-Pathsmith-Client": "local" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = value.error ?? value;
    throw new Error(
      `${error.code ?? response.status}: ${error.message ?? response.statusText}`,
    );
  }
  return value as T;
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const finalStatus = (status: string) =>
  ["completed", "failed", "canceled", "interrupted"].includes(status);

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

export default function App() {
  const [health, setHealth] = useState("Checking API…");
  const [examples, setExamples] = useState<Example[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [exampleId, setExampleId] = useState("gaming");
  const [fixtureSetId, setFixtureSetId] = useState("gaming");
  const [workflowDraft, setWorkflowDraft] = useState<Draft<Workflow> | null>(
    null,
  );
  const [suiteDraft, setSuiteDraft] = useState<Draft<Suite> | null>(null);
  const [workflowVersions, setWorkflowVersions] = useState<Version[]>([]);
  const [suiteVersions, setSuiteVersions] = useState<Version[]>([]);
  const [workflowVersionId, setWorkflowVersionId] = useState("");
  const [suiteVersionId, setSuiteVersionId] = useState("");
  const [text, setText] = useState(pretty(gaming));
  const [suiteText, setSuiteText] = useState("");
  const [view, setView] = useState<"graph" | "json">("graph");
  const [selectedNode, setSelectedNode] = useState("route_content");
  const [selectedCase, setSelectedCase] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState("");
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runTotal, setRunTotal] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [caseRuns, setCaseRuns] = useState<CaseRun[]>([]);
  const [caseTotal, setCaseTotal] = useState(0);
  const [selectedCaseRun, setSelectedCaseRun] = useState("");
  const [trace, setTrace] = useState<unknown>(null);
  const projectSelection = useRef("");
  const projectRequest = useRef(0);
  const runSelection = useRef("");
  const runRequest = useRef(0);
  const traceSelection = useRef("");
  const traceRequest = useRef(0);
  const runPageCount = useRef(50);
  const casePageCount = useRef(100);

  useEffect(() => {
    void Promise.all([
      api<unknown>("/health"),
      api<Example[]>("/examples"),
      api<Project[]>("/projects"),
    ])
      .then(([, catalog, saved]) => {
        setHealth("API ready");
        setExamples(catalog);
        setProjects(saved);
      })
      .catch((error) => {
        setHealth("API unavailable");
        setMessage(String(error));
      });
  }, []);
  async function refreshProjects() {
    setProjects(await api<Project[]>("/projects"));
  }
  async function refreshVersions(workflowId: string, suiteId: string) {
    const generation = projectRequest.current;
    const [w, s] = await Promise.all([
      api<Version[]>(`/workflows/${workflowId}/versions`),
      api<Version[]>(`/suites/${suiteId}/versions`),
    ]);
    if (projectRequest.current !== generation) return;
    setWorkflowVersions(w);
    setSuiteVersions(s);
    setWorkflowVersionId(w[0]?.id ?? "");
    setSuiteVersionId(s[0]?.id ?? "");
  }
  async function fetchPages<T>(path: string, count: number): Promise<Page<T>> {
    const items: T[] = [];
    let total: number;
    do {
      const page = await api<Page<T>>(`${path}${path.includes("?") ? "&" : "?"}offset=${items.length}&limit=${Math.min(100, count - items.length)}`);
      total = page.total;
      items.push(...page.items);
      if (page.items.length === 0) break;
    } while (items.length < count && items.length < total);
    return { items, total };
  }
  async function refreshRuns(id: string, selectId?: string) {
    const generation = projectRequest.current;
    const page = await fetchPages<Run>(`/runs?projectId=${id}`, runPageCount.current);
    if (projectSelection.current !== id || projectRequest.current !== generation) return;
    setRuns(page.items);
    setRunTotal(page.total);
    if (selectId) await openRun(selectId);
  }
  async function openProject(id: string, knownFixture?: string) {
    projectSelection.current = id;
    const generation = ++projectRequest.current;
    runSelection.current = "";
    runRequest.current++;
    traceSelection.current = "";
    traceRequest.current++;
    runPageCount.current = 50;
    casePageCount.current = 100;
    setBusy(true);
    setMessage("");
    setConflict("");
    try {
      const [workflows, suites] = await Promise.all([
        api<Draft<Workflow>[]>(`/projects/${id}/workflows`),
        api<Draft<Suite>[]>(`/projects/${id}/suites`),
      ]);
      const w = workflows[0],
        s = suites[0];
      if (!w || !s)
        throw new Error("Project needs a workflow and suite draft.");
      const [fullW, fullS] = await Promise.all([
        api<Draft<Workflow>>(`/workflows/${w.id}`),
        api<Draft<Suite>>(`/suites/${s.id}`),
      ]);
      if (projectRequest.current !== generation) return;
      setProjectId(id);
      setWorkflowDraft(fullW);
      setSuiteDraft(fullS);
      setText(pretty(fullW.definition));
      setSuiteText(pretty(fullS.definition));
      setSelectedCase(fullS.definition.scenarios?.[0]?.id ?? "");
      setSelectedNode("");
      setView("graph");
      setRun(null);
      setSnapshot(null);
      setCaseRuns([]);
      setCaseTotal(0);
      setTrace(null);
      const selectedProject = projects.find((item) => item.id === id);
      const matchingExample = examples.find(
        (item) => item.name === selectedProject?.name,
      );
      if (knownFixture || matchingExample)
        setFixtureSetId(knownFixture ?? matchingExample!.fixtureSetId);
      await Promise.all([refreshVersions(w.id, s.id), refreshRuns(id)]);
    } catch (error) {
      if (projectRequest.current === generation) setMessage(String(error));
    } finally {
      if (projectRequest.current === generation) setBusy(false);
    }
  }
  async function loadExample() {
    setBusy(true);
    setMessage("");
    try {
      const loaded = await api<{ project: Project; fixtureSetId: string }>(
        `/examples/${exampleId}/load`,
        "POST",
      );
      await refreshProjects();
      await openProject(loaded.project.id, loaded.fixtureSetId);
      setMessage(`Loaded ${loaded.project.name} as a persisted project.`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  const validation = useMemo(() => {
    try {
      const value = parseJson(text, 512 * 1024);
      const result = validateWorkflow(value);
      return {
        result,
        workflow: result.valid ? (value as unknown as Workflow) : null,
      };
    } catch (error) {
      return {
        result: {
          valid: false,
          diagnostics: [
            { code: "JSON_INVALID", message: String(error), pointer: "" },
          ],
        },
        workflow: null,
      };
    }
  }, [text]);
  const workflow = validation.workflow;
  const suiteParse = useMemo(() => {
    try {
      const value = parseJson(suiteText, 8 * 1024 * 1024);
      if (
        !value || typeof value !== "object" || Array.isArray(value) ||
        !Array.isArray(value.scenarios) ||
        value.scenarios.some((item) => !item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || typeof item.name !== "string")
      ) return { suite: null, issue: "Suite JSON needs a scenarios array of case objects with string id and name. The draft text is preserved." };
      return { suite: value as unknown as Suite, issue: "" };
    } catch (error) {
      return { suite: null, issue: `Suite JSON could not be parsed: ${String(error)}. The draft text is preserved.` };
    }
  }, [suiteText]);
  const suite = suiteParse.suite;
  const scenario = suite?.scenarios.find((item) => item.id === selectedCase);
  const workflowDirty =
    !!workflowDraft && text !== pretty(workflowDraft.definition);
  const suiteDirty =
    !!suiteDraft && suiteText !== pretty(suiteDraft.definition);
  const depths = useMemo(() => {
    const map = new Map<string, number>();
    if (!workflow) return map;
    const visit = (id: string, depth: number) => {
      if (depth <= (map.get(id) ?? -1)) return;
      map.set(id, depth);
      workflow.edges
        .filter((edge) => edge.source === id)
        .forEach((edge) => visit(edge.target, depth + 1));
    };
    const start = workflow.nodes.find((node) => node.kind === "start");
    if (start) visit(start.id, 0);
    return map;
  }, [workflow]);
  const nodes = useMemo(() => {
    const counts = new Map<number, number>();
    return (
      workflow?.nodes.map((node) => {
        const depth = depths.get(node.id) ?? 0,
          index = counts.get(depth) ?? 0;
        counts.set(depth, index + 1);
        return {
          id: node.id,
          type: "workflow",
          selected: node.id === selectedNode,
          data: { definition: node },
          position: { x: index * 270, y: depth * 175 },
        };
      }) ?? []
    );
  }, [workflow, depths, selectedNode]);
  const edges =
    workflow?.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.port,
      target: edge.target,
      type: "smoothstep",
      label: edge.port === "next" ? "" : edge.port,
    })) ?? [];
  const node = workflow?.nodes.find((item) => item.id === selectedNode);
  async function saveWorkflow() {
    if (!workflowDraft) return;
    setMessage("");
    setConflict("");
    try {
      const definition = parseJson(text, 512 * 1024);
      const saved = await api<Draft<Workflow>>(
        `/workflows/${workflowDraft.id}/draft`,
        "PUT",
        { expectedRevision: workflowDraft.draftRevision, definition },
      );
      setWorkflowDraft(saved);
      setText(pretty(saved.definition));
      setMessage(`Workflow draft saved at revision ${saved.draftRevision}.`);
    } catch (error) {
      const detail = String(error);
      if (detail.includes("CONFLICT"))
        setConflict(
          "Workflow save conflict. Your local JSON is preserved. Reopen the project to inspect the newer revision before merging.",
        );
      else setMessage(detail);
    }
  }
  async function publishWorkflow() {
    if (!workflowDraft || workflowDirty) return;
    try {
      const version = await api<Version>(
        `/workflows/${workflowDraft.id}/versions`,
        "POST",
        { expectedRevision: workflowDraft.draftRevision },
      );
      await refreshVersions(workflowDraft.id, suiteDraft!.id);
      setWorkflowVersionId(version.id);
      setMessage(`Workflow version ${version.id} published.`);
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function saveSuite() {
    if (!suiteDraft) return;
    setMessage("");
    setConflict("");
    try {
      const definition = parseJson(suiteText, 8 * 1024 * 1024);
      const saved = await api<Draft<Suite>>(
        `/suites/${suiteDraft.id}/draft`,
        "PUT",
        {
          expectedRevision: suiteDraft.draftRevision,
          definition,
          workflowVersionId,
        },
      );
      setSuiteDraft(saved);
      setSuiteText(pretty(saved.definition));
      setMessage(`Suite draft saved at revision ${saved.draftRevision}.`);
    } catch (error) {
      const detail = String(error);
      if (detail.includes("CONFLICT"))
        setConflict(
          "Suite save conflict. Your local JSON is preserved. Reopen the project to inspect the newer revision before merging.",
        );
      else setMessage(detail);
    }
  }
  async function publishSuite() {
    if (!suiteDraft || suiteDirty || !workflowVersionId) return;
    try {
      const version = await api<Version>(
        `/suites/${suiteDraft.id}/versions`,
        "POST",
        { expectedRevision: suiteDraft.draftRevision, workflowVersionId },
      );
      await refreshVersions(workflowDraft!.id, suiteDraft.id);
      setSuiteVersionId(version.id);
      setMessage(`Suite version ${version.id} published.`);
    } catch (error) {
      setMessage(String(error));
    }
  }
  function editScenario(field: "input" | "expected", value: string) {
    if (!suite || !scenario) return;
    try {
      const updated = parseJson(value, 64 * 1024);
      const next = {
        ...suite,
        scenarios: suite.scenarios.map((item) =>
          item.id === scenario.id ? { ...item, [field]: updated } : item,
        ),
      };
      setSuiteText(pretty(next));
      setMessage("");
    } catch (error) {
      setMessage(`${field} JSON was not applied: ${String(error)}`);
    }
  }
  async function startRun(single: boolean) {
    if (!projectId || !workflowVersionId || !suiteVersionId) return;
    setMessage("");
    try {
      const queued = await api<Run>("/runs", "POST", {
        workflowVersionId,
        suiteVersionId,
        fixtureSetId,
        mode: "mock",
        ...(single ? { selectedScenarioIds: [selectedCase] } : {}),
      });
      await refreshRuns(projectId, queued.id);
      setMessage(
        `Queued exact-mock ${single ? "case" : "suite"} run. Edits after publication are not included.`,
      );
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function openRun(id: string) {
    const changed = runSelection.current !== id;
    runSelection.current = id;
    const generation = ++runRequest.current;
    const projectGeneration = projectRequest.current;
    if (changed) {
      setRun(null);
      casePageCount.current = 100;
      traceSelection.current = "";
      traceRequest.current++;
      setSelectedCaseRun("");
      setTrace(null);
      setCaseRuns([]);
      setCaseTotal(0);
      setSnapshot(null);
    }
    try {
      const [record, snap, cases] = await Promise.all([
        api<Run>(`/runs/${id}`),
        api<Snapshot>(`/runs/${id}/snapshot`),
        fetchPages<CaseRun>(`/runs/${id}/scenarios`, casePageCount.current),
      ]);
      if (runRequest.current !== generation || runSelection.current !== id || projectRequest.current !== projectGeneration || projectSelection.current !== record.projectId) return;
      setRun(record);
      setSnapshot(snap);
      setCaseRuns(cases.items);
      setCaseTotal(cases.total);
    } catch (error) {
      if (runRequest.current === generation) setMessage(String(error));
    }
  }
  useEffect(() => {
    if (!run || finalStatus(run.status)) return;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void Promise.all([openRun(run.id), projectId ? refreshRuns(projectId) : Promise.resolve()]).finally(() => { pending = false; });
    }, 750);
    return () => window.clearInterval(timer);
  }, [run?.id, run?.status, projectId]);
  async function cancelRun() {
    if (!run) return;
    try {
      await api(`/runs/${run.id}/cancel`, "POST");
      await openRun(run.id);
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function showTrace(id: string) {
    traceSelection.current = id;
    const generation = ++traceRequest.current;
    const selectedRun = runSelection.current;
    setSelectedCaseRun(id);
    setTrace(null);
    try {
      const result = await api(`/scenario-runs/${id}/trace`);
      if (traceRequest.current === generation && traceSelection.current === id && runSelection.current === selectedRun) setTrace(result);
    } catch (error) {
      if (traceRequest.current === generation) setMessage(String(error));
    }
  }
  async function loadMoreRuns() {
    if (!projectId) return;
    runPageCount.current += 50;
    try { await refreshRuns(projectId); } catch (error) { setMessage(String(error)); }
  }
  async function loadMoreCases() {
    if (!run) return;
    casePageCount.current += 100;
    await openRun(run.id);
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      setMessage("Import exceeds 512 KiB. Current definition preserved.");
      return;
    }
    try {
      const imported = await file.text();
      const value = parseJson(imported, 512 * 1024);
      const result = validateWorkflow(value);
      if (!result.valid)
        throw new Error(
          result.diagnostics.map((item) => item.message).join("; "),
        );
      setText(imported);
      setView("json");
      setMessage(
        "Valid workflow imported into the local editor. Save the draft to persist it.",
      );
    } catch (error) {
      setMessage(
        `Import failed; current definition preserved. ${String(error)}`,
      );
    }
  }
  function exportFile() {
    if (!workflow) return;
    const url = URL.createObjectURL(
      new Blob([pretty(workflow)], { type: "application/json" }),
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
        <div className="sidebar-caption">LOCAL WORKSPACE</div>
        <nav>
          <a href="#projects">Projects</a>
          <a href="#workflow">Workflow</a>
          <a href="#scenarios">Scenarios</a>
          <a href="#runs">Runs</a>
        </nav>
        <div className="sidebar-footer">
          <span className="dot" />
          {health}
          <p>M2 · local mock execution</p>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="breadcrumb">
              {projectId
                ? projects.find((item) => item.id === projectId)?.name
                : "Examples / Gaming"}
            </span>
            <h1>Inspect the decision path.</h1>
          </div>
          <span className="mode">● MOCK · OFFLINE</span>
        </header>
        <section className="m2-panel" id="projects">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PERSISTED WORKSPACE</span>
              <h2>Projects and examples</h2>
            </div>
          </div>
          <div className="row">
            <label>
              Example{" "}
              <select
                aria-label="Example to load"
                value={exampleId}
                onChange={(event) => setExampleId(event.target.value)}
              >
                {examples.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void loadExample()}
              disabled={busy || health !== "API ready"}
            >
              Load checked example
            </button>
            <label>
              Saved project{" "}
              <select
                aria-label="Saved project"
                value={projectId}
                onChange={(event) => void openProject(event.target.value)}
              >
                <option value="">Select project</option>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => void refreshProjects()}>
              Refresh projects
            </button>
          </div>
          <p className="hint">
            Loading creates a project with published workflow and suite
            versions. Select a saved project to reopen it after restart.
          </p>
        </section>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {conflict && (
          <p className="notice conflict" role="alert">
            {conflict}
          </p>
        )}
        <section className="workspace" id="workflow">
          <div className="toolbar">
            <div>
              <span className="eyebrow">WORKFLOW</span>
              <h2>{workflowDraft?.name ?? "Gaming preview"}</h2>
            </div>
            <div className="toolbar-actions">
              <label className="button">
                Import JSON
                <input
                  aria-label="Import workflow JSON"
                  type="file"
                  accept=".json"
                  onChange={(event) => void importFile(event.target.files?.[0])}
                />
              </label>
              <button disabled={!workflow} onClick={exportFile}>
                Export workflow
              </button>
              {workflowDraft && (
                <>
                  <button
                    disabled={!workflowDirty}
                    onClick={() => void saveWorkflow()}
                  >
                    Save workflow draft
                  </button>
                  <button
                    disabled={workflowDirty || !validation.result.valid}
                    onClick={() => void publishWorkflow()}
                  >
                    Publish workflow
                  </button>
                </>
              )}
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
              className={`validation ${validation.result.valid ? "valid" : "invalid"}`}
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
                  onChange={(event) => setText(event.target.value)}
                />
              ) : workflow ? (
                <ReactFlow
                  key={workflow.id + workflowDraft?.id}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  edgesReconnectable={false}
                  onNodeClick={(_, item) => setSelectedNode(item.id)}
                  fitView
                  minZoom={0.2}
                  colorMode="dark"
                >
                  <Background gap={22} color="#28333d" />
                  <Controls showInteractive={false} />
                </ReactFlow>
              ) : (
                <div className="empty">
                  <strong>Resolve definition errors</strong>
                  <button onClick={() => setView("json")}>
                    Open JSON definition
                  </button>
                </div>
              )}
            </div>
            <aside className="inspector">
              <span className="eyebrow">DEFINITION INSPECTOR</span>
              <h2>{node?.label ?? "Select a node"}</h2>
              <p>
                Canonical configuration. Runs below use published snapshots.
              </p>
              {node && <pre>{pretty(node)}</pre>}
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
              </span>
            ) : (
              <ul>
                {validation.result.diagnostics
                  .slice(0, 12)
                  .map((item, index) => (
                    <li key={index}>
                      <code>{item.code}</code> {item.message}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </section>
        <section className="m2-panel" id="scenarios">
          <div className="section-heading">
            <div>
              <span className="eyebrow">SCENARIOS</span>
              <h2>{suiteDraft?.name ?? "Load a project to edit scenarios"}</h2>
            </div>
            <div className="row">
              <button disabled={!suiteDirty} onClick={() => void saveSuite()}>
                Save suite draft
              </button>
              <button
                disabled={!suiteDraft || suiteDirty || !workflowVersionId || !!suiteParse.issue}
                onClick={() => void publishSuite()}
              >
                Publish suite
              </button>
            </div>
          </div>
          {suiteDraft && (
            <>
              {suiteParse.issue && <p className="notice conflict" role="alert">{suiteParse.issue}</p>}
              <div className="row">
                <label>
                  Case{" "}
                  <select
                    aria-label="Scenario case"
                    value={selectedCase}
                    onChange={(event) => setSelectedCase(event.target.value)}
                  >
                    {suite?.scenarios?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="hint">
                  Draft revision {suiteDraft.draftRevision} ·{" "}
                  {suiteDirty ? "unsaved edits" : "saved"}
                </span>
              </div>
              <div className="scenario-editors">
                <label>
                  Input JSON
                  <textarea
                    key={`${selectedCase}-input-${scenario ? pretty(scenario.input) : ""}`}
                    aria-label="Scenario input JSON"
                    defaultValue={scenario ? pretty(scenario.input) : ""}
                    onBlur={(event) =>
                      editScenario("input", event.target.value)
                    }
                    spellCheck={false}
                  />
                </label>
                <label>
                  Expectations JSON
                  <textarea
                    key={`${selectedCase}-expected-${scenario ? pretty(scenario.expected) : ""}`}
                    aria-label="Scenario expectations JSON"
                    defaultValue={scenario ? pretty(scenario.expected) : "{}"}
                    onBlur={(event) =>
                      editScenario("expected", event.target.value)
                    }
                    spellCheck={false}
                  />
                </label>
              </div>
              <p className="hint">
                Edit JSON, then leave the field to apply it to the draft. Save
                and publish before running. Changed mock requests must have an
                exact fixture; a miss appears as an execution error.
              </p>
              <details>
                <summary>Full suite JSON</summary>
                <textarea
                  className="suite-json"
                  aria-label="Suite JSON"
                  spellCheck={false}
                  value={suiteText}
                  onChange={(event) => setSuiteText(event.target.value)}
                />
              </details>
              {suiteDraft.diagnostics.length > 0 && (
                <ul className="diagnostics">
                  {suiteDraft.diagnostics.map((item, index) => (
                    <li key={index}>
                      {item.code}: {item.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
        <section className="m2-panel" id="runs">
          <div className="section-heading">
            <div>
              <span className="eyebrow">EXACT MOCK · IMMUTABLE VERSIONS</span>
              <h2>Run and inspect</h2>
            </div>
            <div className="row">
              <button
                disabled={
                  !suiteVersionId || !workflowVersionId || !selectedCase
                }
                onClick={() => void startRun(true)}
              >
                Run selected case
              </button>
              <button
                disabled={!suiteVersionId || !workflowVersionId}
                onClick={() => void startRun(false)}
              >
                Run full suite
              </button>
            </div>
          </div>
          <div className="row">
            <label>
              Workflow version{" "}
              <select
                aria-label="Workflow version"
                value={workflowVersionId}
                onChange={(event) => setWorkflowVersionId(event.target.value)}
              >
                {workflowVersions.map((item) => (
                  <option key={item.id} value={item.id}>
                    Revision {item.draftRevision} · {item.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Suite version{" "}
              <select
                aria-label="Suite version"
                value={suiteVersionId}
                onChange={(event) => setSuiteVersionId(event.target.value)}
              >
                {suiteVersions.map((item) => (
                  <option key={item.id} value={item.id}>
                    Revision {item.draftRevision} · {item.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Exact fixture set{" "}
              <select
                aria-label="Exact fixture set"
                value={fixtureSetId}
                onChange={(event) => setFixtureSetId(event.target.value)}
              >
                {[
                  ...new Map(
                    examples.map((item) => [item.fixtureSetId, item]),
                  ).values(),
                ].map((item) => (
                  <option key={item.fixtureSetId} value={item.fixtureSetId}>
                    {item.fixtureSetId}
                  </option>
                ))}
              </select>
            </label>
            <span className="hint">Mode: mock only.</span>
          </div>
          <h3>Run history</h3>
          {runs.length === 0 ? (
            <p className="hint">No runs in this project yet.</p>
          ) : (
            <div className="history">
              {runs.map((item) => (
                <button
                  key={item.id}
                  className={run?.id === item.id ? "selected-run" : ""}
                  onClick={() => void openRun(item.id)}
                >
                  <strong>{item.status}</strong> ·{" "}
                  {new Date(item.createdAt).toLocaleString()} ·{" "}
                  {item.progress.persisted}/{item.progress.selected} persisted ·{" "}
                  {item.id.slice(0, 8)}
                </button>
              ))}
            </div>
          )}
          {runs.length < runTotal && (
            <button className="load-more" onClick={() => void loadMoreRuns()}>
              Load more runs ({runs.length} of {runTotal})
            </button>
          )}
          {run && (
            <div className="run-details">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">HISTORICAL RUN SNAPSHOT</span>
                  <h3>
                    {run.workflowName} · {run.status}
                  </h3>
                </div>
                {!["completed", "failed", "canceled", "interrupted"].includes(
                  run.status,
                ) && (
                  <button onClick={() => void cancelRun()}>Cancel run</button>
                )}
              </div>
              <p className="hint">
                {run.mode} · {snapshot?.origin ?? "synthetic"} · workflow{" "}
                {run.workflowVersionId.slice(0, 8)} · suite{" "}
                {run.suiteVersionId.slice(0, 8)}
              </p>
              <p>
                {run.progress.persisted}/{run.progress.selected} persisted ·{" "}
                {run.progress.pending} pending · {run.summary.completed}{" "}
                completed · {run.summary.failedExecution} execution failures ·{" "}
                {run.summary.canceled} canceled · {run.summary.interrupted}{" "}
                interrupted
              </p>
              <p>
                {run.summary.labeled} labeled · {run.summary.unlabeled} unlabeled ·{" "}
                {run.summary.assertionPassed} assertion passes ·{" "}
                {run.summary.assertionFailed} assertion failures ·{" "}
                {run.summary.logicalJudgments} logical judgments ·{" "}
                {run.summary.actualHttpAttempts} HTTP attempts
              </p>
              {run.error && (
                <p role="alert">
                  {run.error.code}: {run.error.message}
                </p>
              )}
              {run.status !== "completed" && (
                <p className="hint">
                  Partial or interrupted runs do not imply all selected cases
                  passed.
                </p>
              )}
              <details>
                <summary>Immutable workflow and suite snapshot</summary>
                <pre>
                  {pretty({
                    workflow: snapshot?.workflow,
                    suite: snapshot?.suite,
                    selectedScenarioIds: snapshot?.selectedScenarioIds,
                    profile: snapshot?.profile,
                  })}
                </pre>
              </details>
              <h3>Case outcomes</h3>
              {caseRuns.length === 0 ? (
                <p className="hint">No case results persisted yet.</p>
              ) : (
                <div className="case-results">
                  {caseRuns.map((item) => (
                    <button
                      key={item.id}
                      className={
                        selectedCaseRun === item.id ? "selected-run" : ""
                      }
                      onClick={() => void showTrace(item.id)}
                    >
                      {item.scenarioId} · {item.result.status} ·{" "}
                      {item.result.assertionStatus} ·{" "}
                      {item.result.result?.outcomeId ??
                        item.result.error?.code ??
                        "N/A"}
                    </button>
                  ))}
                </div>
              )}
              {caseRuns.length < caseTotal && (
                <button className="load-more" onClick={() => void loadMoreCases()}>
                  Load more cases ({caseRuns.length} of {caseTotal})
                </button>
              )}
              {selectedCaseRun && (
                <div className="trace">
                  <h3>Saved case trace</h3>
                  <pre>{trace ? pretty(trace) : "Loading trace…"}</pre>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
