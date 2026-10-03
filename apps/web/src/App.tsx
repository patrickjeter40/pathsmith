import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseJson,
  validateWorkflow,
  type Suite,
  type Workflow,
} from "@pathsmith/contracts";
import { WorkflowEditor, type Layout } from "./WorkflowEditor";
import { WorkflowScreen } from "./WorkflowScreen";
import { CompareScreen } from "./CompareScreen";
import { ApiError, request } from "./apiClient";
import { planWorkflowMerge, resolveWorkflowMerge, type MergeChoice, type WorkflowMergePlan } from "./workflowMerge";
import type { Json } from "@pathsmith/contracts";
import { GuidedClassification } from "./GuidedClassification";
import { ResultsScreen } from "./ResultsScreen";
import { OverviewScreen } from "./OverviewScreen";
import { downloadText } from "./apiClient";
import type { RerunPlan, RunPrefill } from "./screenTypes";
import AppShell, { type Destination } from "./AppShell";
import gaming from "../../../examples/gaming/workflow.json";
import "@xyflow/react/dist/style.css";
import "./style.css";
import "./screens.css";

type Project = { id: string; name: string };
type Draft<T> = {
  id: string;
  projectId: string;
  name: string;
  definition: T;
  draftRevision: number;
  diagnostics: { code: string; message: string }[];
  layout?: Layout;
};
type Version = { id: string; draftRevision: number; createdAt: string; definition?: Workflow; layout?: Layout };
type Example = { id: string; name: string; fixtureSetId: string };
type Page<T> = { items: T[]; total: number };
type ProviderStatus = {
  allowedModes: string[];
  defaultMode: string;
  defaultHttpAttemptLimit: number;
  maximumHttpAttemptLimit: number;
  providers: { id: string; configured: boolean; enabled?: boolean; defaultModel?: string }[];
};
type Usage = { inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null } | null;
type Run = {
  id: string;
  projectId: string;
  status: string;
  mode: "mock" | "replay" | "live";
  origin: "synthetic" | "live";
  sourceRunId: string | null;
  httpAttemptLimit: number;
  mixedModel: boolean;
  adapters?: Record<string, { providerId: string; requestedModel: string; resolvedModels: string[] }>;
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
    replayedJudgments: number;
    usage: Usage;
    historicalUsage: Usage;
  };
  error?: { code: string; message: string } | null;
};
type CaseRun = {
  id: string;
  scenarioId: string;
  result: {
    started?: boolean;
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
  layout: Layout;
  suite: Suite;
  selectedScenarioIds: string[];
  profile: unknown;
  mode: "mock" | "replay" | "live";
  origin: string;
  adapters?: Record<string, { providerId: string; requestedModel: string; resolvedModels: string[] }>;
};
type Coverage = { started: number; partial: boolean; nodes: { nodeId: string; visits: number; startedScenarios: number }[]; edges: { edgeId: string; traversals: number; sourceVisits: number }[]; branchPortsVisited: number; branchPortsTotal: number };
const destinations: Destination[] = ["overview", "testset", "results", "workflow", "compare"];
function routeDestination(): Destination {
  const route = window.location.hash.slice(2);
  const destination = destinations.find((item) => item === route) ?? "overview";
  if (window.location.hash !== `#/${destination}`) {
    window.history.replaceState(null, "", `#/${destination}`);
  }
  return destination;
}

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return request<T>(path, method, body);
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const finalStatus = (status: string) =>
  ["completed", "failed", "canceled", "interrupted"].includes(status);
const modeLabel = (mode: string) => mode === "replay" ? "Recorded Replay" : mode === "live" ? "Live Jev" : "Mock";
function usageLabel(usage: Usage): string {
  if (!usage) return "unknown";
  return `input ${usage.inputTokens ?? "unknown"}, output ${usage.outputTokens ?? "unknown"}, total ${usage.totalTokens ?? "unknown"} tokens`;
}
function graphable(value: unknown): value is Workflow {
  const expression = (raw: unknown): boolean => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const item = raw as Record<string, unknown>;
    if (typeof item.op !== "string") return false;
    if (item.op === "ref") return Array.isArray(item.path) && item.path.every((part) => typeof part === "string");
    if (Object.hasOwn(item, "left") && !expression(item.left)) return false;
    if (Object.hasOwn(item, "right") && !expression(item.right)) return false;
    return true;
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.nodes) || !Array.isArray(item.edges) || !Array.isArray(item.bindings) || item.bindings.some((binding) => typeof binding !== "string") || !item.inputSchema || typeof item.inputSchema !== "object" || Array.isArray(item.inputSchema)) return false;
  return item.nodes.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== "string" || typeof node.label !== "string") return false;
    if (node.kind === "branch") return Array.isArray(node.cases) && node.cases.every((entry: unknown) => { if (!entry || typeof entry !== "object") return false; const branchCase = entry as Record<string, unknown>; return typeof branchCase.id === "string" && expression(branchCase.when); });
    if (node.kind === "judgment") return expression(node.state) && typeof node.binding === "string" && !!node.questions && typeof node.questions === "object" && !Array.isArray(node.questions) && Object.values(node.questions).every((question) => { if (!question || typeof question !== "object") return false; const q = question as Record<string, unknown>; return typeof q.instructions === "string" && (q.kind === "binary" || q.kind === "choice" && !!q.options && typeof q.options === "object" && !Array.isArray(q.options) && Object.values(q.options).every((description) => typeof description === "string") || q.kind === "score" && Array.isArray(q.levels) && q.levels.every((level) => typeof level === "string")); });
    if (node.kind === "transform" || node.kind === "output") return expression(node.value) && (node.kind !== "output" || typeof node.outcomeId === "string");
    return node.kind === "start";
  }) && item.edges.every((raw) => !!raw && typeof raw === "object" && ["id", "source", "port", "target"].every((key) => typeof (raw as Record<string, unknown>)[key] === "string"));
}

export default function App() {
  const [health, setHealth] = useState("Checking API…");
  const [examples, setExamples] = useState<Example[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [exampleId, setExampleId] = useState("gaming");
  const [fixtureSetId, setFixtureSetId] = useState("");
  const [workflowDraft, setWorkflowDraft] = useState<Draft<Workflow> | null>(
    null,
  );
  const [suiteDraft, setSuiteDraft] = useState<Draft<Suite> | null>(null);
  const [workflowVersions, setWorkflowVersions] = useState<Version[]>([]);
  const [suiteVersions, setSuiteVersions] = useState<Version[]>([]);
  const [workflowVersionId, setWorkflowVersionId] = useState("");
  const [suiteVersionId, setSuiteVersionId] = useState("");
  const [text, setText] = useState(pretty(gaming));
  const [layout, setLayout] = useState<Layout>({});
  const [, setHistoryIndex] = useState(0);
  const undoStack = useRef<{ text: string; layout: Layout }[]>([]);
  const redoStack = useRef<{ text: string; layout: Layout }[]>([]);
  const [suiteText, setSuiteText] = useState("");
  const [testStep, setTestStep] = useState(0);
  const [testLiveArmed, setTestLiveArmed] = useState(false);
  const [focusCaseId, setFocusCaseId] = useState("");
  const [runPrefill, setRunPrefill] = useState<RunPrefill | null>(null);
  const [scoreVersionId, setScoreVersionId] = useState("");
  const [startedRunId, setStartedRunId] = useState("");
  const [projectFileBusy, setProjectFileBusy] = useState(false);
  const [projectFileAck, setProjectFileAck] = useState(false);
  const [projectFileMessage, setProjectFileMessage] = useState("");
  const [destination, setDestination] = useState<Destination>(routeDestination);
  const compareActionRequest = useRef(0);
  useEffect(() => {
    const sync = () => {
      compareActionRequest.current++;
      setDestination(routeDestination());
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("app-main")?.scrollTo(0, 0);
  }, [destination]);
  function navigate(to: Destination) {
    compareActionRequest.current++;
    if (window.location.hash !== `#/${to}`) window.history.pushState(null, "", `#/${to}`);
    setDestination(to);
    window.scrollTo(0, 0);
    document.getElementById("app-main")?.scrollTo(0, 0);
  }
  const [selectedNode, setSelectedNode] = useState("route_content");
  const [selectedCase, setSelectedCase] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [runMode, setRunMode] = useState<"mock" | "replay" | "live">("mock");
  const [sourceRunId, setSourceRunId] = useState("");
  const [exportAcknowledged, setExportAcknowledged] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [comparisonRuns, setComparisonRuns] = useState<Run[]>([]);
  const [runTotal, setRunTotal] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [caseRuns, setCaseRuns] = useState<CaseRun[]>([]);
  const [caseTotal, setCaseTotal] = useState(0);
  const [selectedCaseRun, setSelectedCaseRun] = useState("");
  const [trace, setTrace] = useState<unknown>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [historyView, setHistoryView] = useState<"path" | "coverage">("path");
  const [selectedHistoricalNode, setSelectedHistoricalNode] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowConflict, setWorkflowConflict] = useState<{ plan: WorkflowMergePlan; choices: Record<string, MergeChoice>; message: string; revision: number; latest: Draft<Workflow> } | null>(null);
  const [workflowSnapshot, setWorkflowSnapshot] = useState<{ runId: string; caseId: string; workflowVersionId: string; mode: Run["mode"]; workflow: Workflow; layout: Layout; trace: (import("./SavedTrace").SavedTraceResult & { visitedNodes?: string[]; selectedEdges?: string[] }) | null; status: string } | null>(null);
  const [focusResultCaseId, setFocusResultCaseId] = useState("");
  const workflowPathRequest = useRef(0);
  const coalesceField = useRef("");
  const projectSelection = useRef("");
  const projectRequest = useRef(0);
  const suiteTextRef = useRef(suiteText);
  suiteTextRef.current = suiteText;
  const workflowEditRevision = useRef(0);
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
      api<ProviderStatus>("/providers/status"),
    ])
      .then(([, catalog, saved, status]) => {
        setHealth("API ready");
        setExamples(catalog);
        setProjects(saved);
        setProviderStatus(status);
        const parameter = new URLSearchParams(window.location.search).get("project");
        const preferred = [parameter, window.localStorage.getItem("pathsmith.projectId")].find((id) => saved.some((item) => item.id === id));
        if (preferred) {
          const name = saved.find((item) => item.id === preferred)?.name;
          void openProject(preferred, catalog.find((item) => item.name === name)?.fixtureSetId);
        }
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
      workflowId ? api<Version[]>(`/workflows/${workflowId}/versions`) : Promise.resolve([]),
      suiteId ? api<Version[]>(`/suites/${suiteId}/versions`) : Promise.resolve([]),
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
    const all = await fetchPages<Run>("/runs", 1000);
    if (projectSelection.current === id && projectRequest.current === generation) setComparisonRuns(all.items);
    if (selectId) await openRun(selectId);
  }
  async function openProject(id: string, knownFixture?: string, fromCompare = false) {
    if (!fromCompare) compareActionRequest.current++;
    projectSelection.current = id;
    const generation = ++projectRequest.current;
    workflowPathRequest.current++;
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
      const [fullW, fullS] = await Promise.all([
        w ? api<Draft<Workflow>>(`/workflows/${w.id}`) : Promise.resolve(null),
        s ? api<Draft<Suite>>(`/suites/${s.id}`) : Promise.resolve(null),
      ]);
      if (projectRequest.current !== generation) return false;
      setProjectId(id);
      setProjectFileBusy(false); setProjectFileAck(false); setProjectFileMessage("");
      const address = new URL(window.location.href);
      address.searchParams.set("project", id);
      window.history.replaceState(null, "", address);
      window.localStorage.setItem("pathsmith.projectId", id);
      setRunMode("mock"); setSourceRunId(""); setExportAcknowledged(false);
      setWorkflowDraft(fullW);
      setWorkflowConflict(null); setWorkflowSnapshot(null); setWorkflowSaving(false); coalesceField.current = "";
      setSuiteDraft(fullS);
      setText(pretty(fullW?.definition ?? {}));
      setLayout(fullW?.layout ?? {});
      undoStack.current = []; redoStack.current = []; setHistoryIndex(0);
      setSuiteText(pretty(fullS?.definition ?? { scenarios: [] }));
      setSelectedCase(fullS?.definition.scenarios?.[0]?.id ?? "");
      setSelectedNode("");
    setRun(null);
      setSnapshot(null);
      setCaseRuns([]);
      setCaseTotal(0);
      setTrace(null);
      setCoverage(null);
      setSelectedHistoricalNode("");
      setCandidateId("");
      const selectedProject = projects.find((item) => item.id === id);
      const matchingExample = examples.find(
        (item) => item.name === selectedProject?.name,
      );
      const selectedFixture = knownFixture ?? window.localStorage.getItem(`pathsmith.fixtureSet.${id}`) ?? matchingExample?.fixtureSetId ?? "";
      setFixtureSetId(selectedFixture);
      if (selectedFixture) window.localStorage.setItem(`pathsmith.fixtureSet.${id}`, selectedFixture);
      setRunPrefill(null); setScoreVersionId(""); setStartedRunId(""); setTestStep(0); setFocusCaseId("");
      await Promise.all([refreshVersions(w?.id ?? "", s?.id ?? ""), refreshRuns(id)]);
      return projectRequest.current === generation;
    } catch (error) {
      if (projectRequest.current === generation) setMessage(String(error));
      return false;
    } finally {
      if (projectRequest.current === generation) setBusy(false);
    }
  }
  async function loadExample(selectedId = exampleId) {
    const generation = projectRequest.current;
    setBusy(true);
    setMessage("");
    try {
      const loaded = await api<{ project: Project; fixtureSetId: string }>(
        `/examples/${selectedId}/load`,
        "POST",
      );
      if (projectRequest.current !== generation) return;
      await refreshProjects();
      if (projectRequest.current !== generation) return;
      await openProject(loaded.project.id, loaded.fixtureSetId);
      if (projectSelection.current === loaded.project.id) setMessage(`Loaded ${loaded.project.name} as a persisted project.`);
    } catch (error) {
      if (projectRequest.current === generation) setMessage(String(error));
    } finally {
      if (projectRequest.current === generation) setBusy(false);
    }
  }
  async function loadClassification() {
    const generation = projectRequest.current;
    setBusy(true); setMessage("");
    try {
      const loaded = await api<{ project: Project; fixtureSetId: string }>("/examples/classification/load", "POST");
      if (projectRequest.current !== generation) return;
      await refreshProjects();
      if (projectRequest.current !== generation) return;
      await openProject(loaded.project.id, loaded.fixtureSetId);
      if (projectSelection.current === loaded.project.id) setMessage("Loaded the chat abuse classification example.");
    } catch (error) { if (projectRequest.current === generation) setMessage(String(error)); }
    finally { if (projectRequest.current === generation) setBusy(false); }
  }
  const validation = useMemo(() => {
    try {
      const value = parseJson(text, 512 * 1024);
      const result = validateWorkflow(value);
      return {
        result,
        workflow: graphable(value) ? value : null,
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
    !!workflowDraft && (text !== pretty(workflowDraft.definition) || pretty(layout) !== pretty(workflowDraft.layout ?? {}));
  const suiteDirty =
    !!suiteDraft && suiteText !== pretty(suiteDraft.definition);
  const currentProjectReady = !busy && projectSelection.current === projectId;
  const ownerReadyAtEntry = () => !busy && projectSelection.current === projectId;
  function editDefinition(value: string, field?: string) {
    const focus = document.activeElement as HTMLElement | null;
    const typing = field ?? (focus && ["INPUT", "TEXTAREA"].includes(focus.tagName) ? `${selectedNode}:${focus.getAttribute("aria-label") ?? ""}` : "");
    if (!typing || coalesceField.current !== typing) undoStack.current.push({ text, layout });
    coalesceField.current = typing;
    workflowEditRevision.current++;
    redoStack.current = [];
    setText(value); setHistoryIndex((index) => index + 1);
  }
  function editLayout(value: Layout) {
    coalesceField.current = "";
    workflowEditRevision.current++;
    undoStack.current.push({ text, layout });
    redoStack.current = [];
    setLayout(value); setHistoryIndex((index) => index + 1);
  }
  function editWorkflowDocument(definition: Workflow, nextLayout: Layout) {
    coalesceField.current = "";
    workflowEditRevision.current++;
    undoStack.current.push({ text, layout }); redoStack.current = [];
    setText(pretty(definition)); setLayout(nextLayout); setHistoryIndex((index) => index + 1);
  }
  function travel(direction: "undo" | "redo") {
    if (workflowSaving || workflowSnapshot || workflowConflict) return;
    coalesceField.current = "";
    const source = direction === "undo" ? undoStack : redoStack;
    const target = direction === "undo" ? redoStack : undoStack;
    const previous = source.current.pop();
    if (!previous) return;
    workflowEditRevision.current++;
    target.current.push({ text, layout });
    setText(previous.text); setLayout(previous.layout);
    setHistoryIndex((index) => index + 1);
  }
  useEffect(() => {
    if (destination !== "workflow") return;
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || workflowSaving || workflowSnapshot || workflowConflict) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable=true]") || !document.getElementById("workflow")?.contains(target)) return;
      event.preventDefault(); travel(event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  async function saveWorkflow() {
    if (!workflowDraft || !ownerReadyAtEntry() || workflowDraft.projectId !== projectId || workflowSaving || workflowSnapshot || workflowConflict) return;
    const generation = projectRequest.current, ownerId = workflowDraft.projectId;
    const currentOwner = () => projectRequest.current === generation && projectSelection.current === ownerId;
    const editorRevision = workflowEditRevision.current;
    setMessage("");
    setConflict("");
    try {
      const definition = parseJson(text, 512 * 1024);
      const saved = await api<Draft<Workflow>>(
        `/workflows/${workflowDraft.id}/draft`,
        "PUT",
        { expectedRevision: workflowDraft.draftRevision, definition, layout },
      );
      if (!currentOwner() || saved.id !== workflowDraft.id || saved.projectId !== ownerId) return;
      setWorkflowDraft(saved);
      if (workflowEditRevision.current === editorRevision) { setText(pretty(saved.definition)); setLayout(saved.layout ?? layout); }
      setMessage(`Workflow draft saved at revision ${saved.draftRevision}.`);
    } catch (error) {
      if (!currentOwner()) return;
      const detail = String(error);
      if (detail.includes("CONFLICT"))
        setConflict(
          "Workflow save conflict. Your local JSON is preserved. Reopen the project to inspect the newer revision before merging.",
        );
      else setMessage(detail);
    }
  }
  async function saveWorkflowVersion() {
    if (!workflowDraft || !ownerReadyAtEntry() || workflowDraft.projectId !== projectId || !workflow || !validation.result.valid || workflowSaving || workflowSnapshot) return;
    const owner = projectRequest.current, workflowId = workflowDraft.id, ownerId = projectId;
    const editorRevision = workflowEditRevision.current;
    const owns = () => projectRequest.current === owner && projectSelection.current === ownerId;
    const submitted = { definition: workflow as unknown as Json, layout: layout as Json };
    const base = { definition: workflowDraft.definition as unknown as Json, layout: (workflowDraft.layout ?? {}) as Json };
    setWorkflowSaving(true); setWorkflowConflict(null); setMessage("");
    try {
      const saved = await api<{ draft: Draft<Workflow>; version: Version }>(`/workflows/${workflowId}/save-version`, "POST", { expectedRevision: workflowDraft.draftRevision, ...submitted });
      if (!owns()) return;
      setWorkflowDraft(saved.draft); setWorkflowVersionId(saved.version.id);
      setWorkflowVersions((list) => [saved.version, ...list.filter((item) => item.id !== saved.version.id)]);
      if (workflowEditRevision.current === editorRevision) { setText(pretty(saved.draft.definition)); setLayout(saved.draft.layout ?? layout); }
      setMessage(`Saved executable workflow version ${saved.version.id.slice(0, 8)}.`);
    } catch (error) {
      if (!owns()) return;
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await api<Draft<Workflow>>(`/workflows/${workflowId}`);
          if (!owns()) return;
          const plan = planWorkflowMerge(base, submitted, { definition: latest.definition as unknown as Json, layout: (latest.layout ?? {}) as Json });
          setWorkflowConflict({ plan, choices: {}, message: `Draft revision ${latest.draftRevision} was saved in another window. Review all changes before publishing.`, revision: latest.draftRevision, latest });
        } catch (failure) { if (owns()) setMessage(`Conflict inspection failed; your draft is retained. ${String(failure)}`); }
      } else setMessage(`Workflow version was not saved. ${String(error)}`);
    } finally { if (owns()) setWorkflowSaving(false); }
  }
  async function resolveWorkflowConflict() {
    if (!workflowConflict || !workflowDraft || !ownerReadyAtEntry() || workflowSaving || workflowSnapshot) return;
    const conflictAtStart = workflowConflict, owner = projectRequest.current, ownerId = projectId, workflowId = workflowDraft.id;
    const owns = () => projectRequest.current === owner && projectSelection.current === ownerId;
    const resolved = resolveWorkflowMerge(conflictAtStart.plan, conflictAtStart.choices);
    if (!resolved.document || resolved.unresolved.length || !resolved.valid) { setWorkflowConflict({ ...conflictAtStart, message: resolved.unresolved.length ? `Choose how to resolve: ${resolved.unresolved.join(", ")}` : resolved.diagnostics.map((item) => item.message).join("; ") || "Merged workflow is invalid." }); return; }
    setWorkflowSaving(true);
    try {
      const saved = await api<{ draft: Draft<Workflow>; version: Version }>(`/workflows/${workflowId}/save-version`, "POST", { expectedRevision: conflictAtStart.revision, ...resolved.document });
      if (!owns()) return;
      setWorkflowConflict(null); setWorkflowDraft(saved.draft); setText(pretty(saved.draft.definition)); setLayout(saved.draft.layout ?? {}); workflowEditRevision.current++;
      setWorkflowVersionId(saved.version.id); setWorkflowVersions((list) => [saved.version, ...list.filter((item) => item.id !== saved.version.id)]);
      setMessage(`Conflict resolved and saved as executable version ${saved.version.id.slice(0, 8)}.`);
    } catch (error) {
      if (!owns()) return;
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await api<Draft<Workflow>>(`/workflows/${workflowId}`);
          if (!owns()) return;
          setText(pretty(resolved.document.definition)); setLayout(resolved.document.layout as Layout); workflowEditRevision.current++;
          setWorkflowConflict({ plan: planWorkflowMerge(conflictAtStart.plan.sources!.remote, resolved.document, { definition: latest.definition as unknown as Json, layout: (latest.layout ?? {}) as Json }), choices: {}, revision: latest.draftRevision, latest, message: `A newer revision ${latest.draftRevision} arrived during resolution. Your resolved candidate is retained; review the new changes.` });
        } catch (failure) { if (owns()) setMessage(`A second conflict occurred. Your candidate is retained. ${String(failure)}`); }
      } else setWorkflowConflict({ ...conflictAtStart, message: `Resolution was not saved. ${String(error)}` });
    } finally { if (owns()) setWorkflowSaving(false); }
  }
  function editMergedWorkflowDraft() {
    if (!workflowConflict || workflowSaving || workflowSnapshot || !ownerReadyAtEntry()) return;
    const resolved = resolveWorkflowMerge(workflowConflict.plan, workflowConflict.choices);
    if (!resolved.document || resolved.unresolved.length) { setWorkflowConflict((current) => current ? { ...current, message: "Choose how to resolve every conflict before editing the combined draft." } : null); return; }
    setWorkflowDraft(workflowConflict.latest);
    editWorkflowDocument(resolved.document.definition as unknown as Workflow, resolved.document.layout as Layout);
    setWorkflowConflict(null);
    setMessage("Merged candidate is now an editable local draft based on the latest saved revision. Repair its problems before saving a version.");
  }
  async function saveSuite() {
    if (!suiteDraft || !ownerReadyAtEntry() || suiteDraft.projectId !== projectId) return;
    const generation = projectRequest.current, ownerId = suiteDraft.projectId;
    const currentOwner = () => projectRequest.current === generation && projectSelection.current === ownerId;
    const submittedText = suiteText;
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
      if (!currentOwner() || saved.id !== suiteDraft.id || saved.projectId !== ownerId) return;
      setSuiteDraft(saved);
      if (suiteTextRef.current === submittedText) setSuiteText(pretty(saved.definition));
      setMessage(`Suite draft saved at revision ${saved.draftRevision}.`);
    } catch (error) {
      if (!currentOwner()) return;
      const detail = String(error);
      if (detail.includes("CONFLICT"))
        setConflict(
          "Suite save conflict. Your local JSON is preserved. Reopen the project to inspect the newer revision before merging.",
        );
      else setMessage(detail);
    }
  }
  async function publishSuite() {
    if (!suiteDraft || suiteDirty || !workflowVersionId || !ownerReadyAtEntry() || suiteDraft.projectId !== projectId) return;
    const generation = projectRequest.current, ownerId = suiteDraft.projectId;
    const currentOwner = () => projectRequest.current === generation && projectSelection.current === ownerId;
    try {
      const version = await api<Version>(
        `/suites/${suiteDraft.id}/versions`,
        "POST",
        { expectedRevision: suiteDraft.draftRevision, workflowVersionId },
      );
      if (!currentOwner()) return;
      await refreshVersions(workflowDraft?.id ?? "", suiteDraft.id);
      if (!currentOwner()) return;
      setSuiteVersionId(version.id);
      setMessage(`Suite version ${version.id} published.`);
    } catch (error) {
      if (currentOwner()) setMessage(String(error));
    }
  }
  function editScenario(field: "input" | "expected", value: string) {
    if (!ownerReadyAtEntry() || !suite || !scenario) return;
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
  function prepareAdvancedRun(single: boolean) {
    if (!workflowVersionId || !suiteVersionId || (single && !selectedCase)) return;
    setRunPrefill({ from: "advanced setup", title: single ? `Run selected case ${selectedCase}` : "Run full published test set",
      workflowVersionId, suiteVersionId, mode: runMode, sourceRunId,
      selectedScenarioIds: single ? [selectedCase] : undefined });
    setTestStep(2); navigate("testset");
  }
  async function openRun(id: string) {
    if (runSelection.current !== id) { workflowPathRequest.current++; setWorkflowSnapshot(null); }
    const changed = runSelection.current !== id;
    runSelection.current = id;
    const generation = ++runRequest.current;
    const projectGeneration = projectRequest.current;
    if (changed) {
      setRun(null);
      setExportAcknowledged(false);
      casePageCount.current = 100;
      traceSelection.current = "";
      traceRequest.current++;
      setSelectedCaseRun("");
      setSelectedHistoricalNode("");
      setTrace(null);
      setCaseRuns([]);
      setCaseTotal(0);
      setSnapshot(null);
      setCoverage(null);
    }
    try {
      const [record, snap, cases, observed] = await Promise.all([
        api<Run>(`/runs/${id}`),
        api<Snapshot>(`/runs/${id}/snapshot`),
        fetchPages<CaseRun>(`/runs/${id}/scenarios`, casePageCount.current),
        api<{ coverage: Coverage | null }>(`/runs/${id}/coverage`).catch(() => ({ coverage: null })),
      ]);
      if (runRequest.current !== generation || runSelection.current !== id || projectRequest.current !== projectGeneration || projectSelection.current !== record.projectId) return;
      setRun(record);
      setSnapshot(snap);
      setCaseRuns(cases.items);
      setCaseTotal(cases.total);
      setCoverage(observed.coverage);
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
  async function exportRun() {
    if (!run || !exportAcknowledged || !finalStatus(run.status)) return;
    try {
      const report = await api<unknown>(`/runs/${run.id}/export`);
      const url = URL.createObjectURL(new Blob([pretty(report)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${run.id}.pathsmith-run.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportAcknowledged(false);
    } catch (error) { setMessage(String(error)); }
  }
  async function showTrace(id: string) {
    traceSelection.current = id;
    const generation = ++traceRequest.current;
    const selectedRun = runSelection.current;
    setSelectedCaseRun(id);
    setSelectedHistoricalNode("");
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
    const generation = projectRequest.current, ownerId = projectSelection.current;
    if (file.size > 512 * 1024) {
      setMessage("Import exceeds 512 KiB. Current definition preserved.");
      return;
    }
    try {
      const imported = await file.text();
      if (projectRequest.current !== generation || projectSelection.current !== ownerId) return;
      const value = parseJson(imported, 512 * 1024);
      const result = validateWorkflow(value);
      if (!result.valid)
        throw new Error(
          result.diagnostics.map((item) => item.message).join("; "),
        );
      editWorkflowDocument(value as unknown as Workflow, layout);
      setMessage(
        "Valid workflow imported into the local editor. Save the draft to persist it.",
      );
    } catch (error) {
      if (projectRequest.current === generation && projectSelection.current === ownerId) setMessage(
        `Import failed; current definition preserved. ${String(error)}`,
      );
    }
  }
  function exportFile() {
    if (!validation.result.valid || !workflow) return;
    const url = URL.createObjectURL(
      new Blob([pretty(workflow)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${workflow.id}.workflow.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function importProjectFile(file?: File) {
    if (!file) return;
    const generation = projectRequest.current;
    setProjectFileBusy(true); setProjectFileMessage("");
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("Project file exceeds 8 MiB.");
      const artifact: unknown = JSON.parse(await file.text());
      if (projectRequest.current !== generation) return;
      const result = await api<{ project: Project; workflows: Draft<Workflow>[]; suites: Draft<Suite>[] }>("/projects/import", "POST", { artifact });
      if (projectRequest.current !== generation) return;
      await refreshProjects();
      if (projectRequest.current !== generation) return;
      await openProject(result.project.id);
      if (projectSelection.current === result.project.id) setProjectFileMessage(`Imported ${result.project.name} as a new local project. ${result.workflows.length} workflow drafts and ${result.suites.length} test-set drafts; validate and publish before running.`);
    } catch (error) { if (projectRequest.current === generation) setProjectFileMessage(`Import failed. ${String(error)}`); }
    finally { if (projectRequest.current === generation) setProjectFileBusy(false); }
  }
  async function exportProjectFile() {
    if (!projectId || !projectFileAck) return;
    const generation = projectRequest.current, ownerId = projectId;
    setProjectFileBusy(true); setProjectFileMessage("");
    try {
      const artifact = await api<unknown>(`/projects/${projectId}/export`);
      if (projectRequest.current !== generation || projectSelection.current !== ownerId) return;
      downloadText(pretty(artifact), `pathsmith-project-${ownerId.slice(0, 8)}.json`);
      setProjectFileAck(false);
    } catch (error) { if (projectRequest.current === generation) setProjectFileMessage(`Export failed. ${String(error)}`); }
    finally { if (projectRequest.current === generation) setProjectFileBusy(false); }
  }
  function configureRun(record: Run, latest: boolean) {
    setRunPrefill({ from: record.id, title: latest ? `Re-run latest versions` : `Adjust ${record.id}`,
      workflowVersionId: latest ? workflowVersionId : record.workflowVersionId,
      suiteVersionId: latest ? suiteVersionId : record.suiteVersionId,
      mode: record.mode as "mock" | "replay" | "live", sourceRunId: record.sourceRunId,
      selectedScenarioIds: latest ? undefined : snapshot?.selectedScenarioIds });
    setTestStep(2); navigate("testset");
  }
  async function resumeRun(record: Run) {
    const generation = projectRequest.current, ownerId = projectSelection.current;
    try {
      const plan = await api<RerunPlan>(`/runs/${record.id}/rerun-plan`);
      if (projectRequest.current !== generation || projectSelection.current !== ownerId || runSelection.current !== record.id) return;
      setRunPrefill({ from: record.id, title: `Run remaining cases from ${record.id.slice(0, 8)}`,
        workflowVersionId: plan.workflowVersionId, suiteVersionId: plan.suiteVersionId,
        selectedScenarioIds: plan.selectedScenarioIds, mode: plan.mode, sourceRunId: plan.sourceRunId, rerunPlan: plan });
      setTestStep(2); navigate("testset");
    } catch (error) { if (projectRequest.current === generation && projectSelection.current === ownerId) setMessage(String(error)); }
  }
  async function openWorkflowPath(caseId: string, traceId?: string | null) {
    if (!run || !snapshot || !caseId) return;
    const generation = ++workflowPathRequest.current, selectedRunId = run.id, owner = projectRequest.current;
    const owns = () => workflowPathRequest.current === generation && runSelection.current === selectedRunId && projectRequest.current === owner;
    setWorkflowSnapshot({ runId: selectedRunId, caseId, workflowVersionId: run.workflowVersionId, mode: run.mode, workflow: snapshot.workflow, layout: snapshot.layout ?? {}, trace: null, status: traceId ? "loading saved path" : "without a saved path" });
    setSelectedNode(""); navigate("workflow");
    if (!traceId) return;
    try {
      const record = await api<{ id: string; runId: string; scenarioId: string; result: import("./SavedTrace").SavedTraceResult & { visitedNodes?: string[]; selectedEdges?: string[]; status?: string } }>(`/scenario-runs/${traceId}/trace`);
      if (!owns() || record.id !== traceId || record.runId !== selectedRunId || record.scenarioId !== caseId) return;
      setWorkflowSnapshot({ runId: selectedRunId, caseId, workflowVersionId: run.workflowVersionId, mode: run.mode, workflow: snapshot.workflow, layout: snapshot.layout ?? {}, trace: record.result, status: record.result.status ?? "saved" });
    } catch (error) { if (owns()) { setWorkflowSnapshot((current) => current?.caseId === caseId ? { ...current, status: "trace unavailable" } : current); setMessage(`Saved path could not be loaded: ${String(error)}`); } }
  }

  async function comparisonOwnerReady(owner: string, action: number) {
    if (compareActionRequest.current !== action) return false;
    if (projectSelection.current !== owner) {
      const before = projectRequest.current;
      const loaded = await openProject(owner, undefined, true);
      if (!loaded || projectRequest.current !== before + 1) return false;
    }
    return compareActionRequest.current === action && projectSelection.current === owner;
  }

  return (
    <AppShell active={destination} navigate={navigate}
      projectName={projects.find((item) => item.id === projectId)?.name ?? "Local workspace"}
      workflowName={workflowDraft?.name} version={workflowVersionId ? workflowVersionId.slice(0, 8) : undefined}
      health={health} liveArmed={destination === "testset" && testLiveArmed}>
      <div className="page-content">
        {destination === "overview" && <OverviewScreen projectId={projectId} projects={projects} examples={examples}
          workflowDraft={workflowDraft} suiteDraft={suiteDraft} workflowVersionId={workflowVersionId} suiteVersionId={suiteVersionId}
          runs={runs} busy={busy || projectFileBusy} fileMessage={projectFileMessage} fileAck={projectFileAck} onFileAck={setProjectFileAck}
          onOpenProject={async (id) => { await openProject(id); }} onLoadStarter={loadClassification} onLoadExample={loadExample}
          onImportFile={importProjectFile} onExportFile={exportProjectFile}
          onStep={(step) => { setTestStep(Math.min(step, 2)); navigate(step === 3 ? "results" : "testset"); }}
          onOpenRun={(id) => { void openRun(id); navigate("results"); }} onWorkflow={() => navigate("workflow")} onCompare={() => navigate("compare")} />}
        {destination === "compare" && <div className="page-heading"><div><span className="eyebrow">PATHSMITH</span><h1>Compare</h1></div></div>}
        <div className={destination === "testset" ? "" : "destination-hidden"}>
        <GuidedClassification projectId={projectId} projects={projects} suiteDraft={suiteDraft} suiteDirty={suiteDirty} workflowVersionId={workflowVersionId} suiteVersionId={suiteVersionId} fixtureSetId={fixtureSetId}
          fixtureSets={[...new Set(examples.map((item) => item.fixtureSetId))]} onFixtureSetChange={(id) => { setFixtureSetId(id); if (projectId) window.localStorage.setItem(`pathsmith.fixtureSet.${projectId}`, id); }}
          run={run} runs={runs} providerStatus={providerStatus}
          step={testStep} focusCaseId={focusCaseId} prefill={runPrefill} onStep={setTestStep}
          ownerGeneration={projectRequest.current} ownerReady={!busy && projectSelection.current === projectId}
          isOwnerCurrent={(generation, ownerId, suiteId) => generation === projectRequest.current && projectSelection.current === ownerId && suiteDraft?.id === suiteId}
          onLiveModeChange={setTestLiveArmed}
          onLoadStarter={loadClassification} onOpenProject={async (id) => { await openProject(id); }}
          onSuiteDraftSaved={(draft, generation) => { if (generation !== projectRequest.current || projectSelection.current !== draft.projectId || suiteDraft?.id !== draft.id) return; if (suiteTextRef.current === pretty(suiteDraft.definition)) setSuiteText(pretty(draft.definition)); setSuiteDraft(draft); }}
          onSuitePublished={(draft, version, generation) => { if (generation !== projectRequest.current || projectSelection.current !== draft.projectId || suiteDraft?.id !== draft.id) return; if (suiteTextRef.current === pretty(suiteDraft.definition)) setSuiteText(pretty(draft.definition)); setSuiteDraft((current) => current ? { ...current, ...draft } : current); setSuiteVersions((current) => [version, ...current]); setSuiteVersionId(version.id); }}
          onRunQueued={async (id, generation) => { if (generation !== projectRequest.current || !projectId || projectSelection.current !== projectId) return; setStartedRunId(id); setScoreVersionId(""); await refreshRuns(projectId, id); if (generation === projectRequest.current && projectSelection.current === projectId) navigate("results"); }}
          onClearPrefill={() => setRunPrefill(null)} onViewResults={(version) => { setScoreVersionId(version ?? ""); navigate("results"); }} />
        </div>
        <div className={destination === "results" ? "" : "destination-hidden"}>
          <ResultsScreen run={run} runs={runs} snapshot={snapshot} caseRuns={caseRuns} caseTotal={caseTotal} focusCaseId={focusResultCaseId}
            scoreVersionId={scoreVersionId} startedRunId={startedRunId} onSelectRun={async (id) => { setFocusResultCaseId(""); await openRun(id); }} onCancelRun={cancelRun}
            onLoadMoreCases={loadMoreCases} onReviewLabel={(id) => { setFocusCaseId(id); setTestStep(1); navigate("testset"); }}
            onConfigureRun={configureRun} onResume={(record) => { void resumeRun(record); }}
            onCompare={(id) => { setCandidateId(id); navigate("compare"); }}
            onUseOriginalLabels={() => setScoreVersionId("")} onViewWorkflow={(caseId, traceId) => { void openWorkflowPath(caseId, traceId); }} />
        </div>
        <div className="destination-content">
        <section className="destination-hidden" id="projects">
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
        <section className={destination === "workflow" ? "workflow-destination" : "destination-hidden"} id="workflow" onBlurCapture={(event) => { if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) coalesceField.current = ""; }}>
          <WorkflowScreen name={workflowDraft?.name ?? "Workflow preview"} workflow={workflow} layout={layout} text={text} selectedNode={selectedNode}
            diagnostics={validation.result.diagnostics} state={workflowSaving ? "saving" : workflowConflict ? "conflict" : !validation.result.valid ? "invalid" : workflowDirty || !workflowVersions.find((item) => item.id === workflowVersionId && item.definition && pretty(item.definition) === pretty(workflow)) ? "draft" : "executable"}
            versionId={workflowVersionId} ready={currentProjectReady} canPersist={!!workflowDraft && currentProjectReady && (() => { try { parseJson(text, 512 * 1024); return true; } catch { return false; } })()} hasSuite={!!suiteVersionId} canUndo={undoStack.current.length > 0} canRedo={redoStack.current.length > 0}
            conflict={workflowConflict} snapshot={workflowSnapshot} message={message} onSelectNode={setSelectedNode}
            onEdit={(value) => editDefinition(pretty(value))} onLayout={editLayout} onDocument={editWorkflowDocument}
            onText={editDefinition} onBoundary={() => { coalesceField.current = ""; }} onUndo={() => travel("undo")} onRedo={() => travel("redo")}
            onSaveVersion={() => void saveWorkflowVersion()} onSaveDraft={() => void saveWorkflow()}
            onRun={() => { if (!workflowVersionId || !suiteVersionId) return; setRunPrefill({ from: "workflow", title: `Run workflow ${workflowVersionId.slice(0, 8)}`, workflowVersionId, suiteVersionId, mode: runMode }); setTestStep(2); navigate("testset"); }}
            onImport={(file) => void importFile(file)} onExport={exportFile}
            onChoice={(key, choice) => setWorkflowConflict((current) => current ? { ...current, choices: { ...current.choices, [key]: choice } } : null)}
            onResolve={() => void resolveWorkflowConflict()} onEditMerged={editMergedWorkflowDraft} onDismissConflict={() => setWorkflowConflict(null)} onClearPath={() => { workflowPathRequest.current++; setWorkflowSnapshot(null); }} onBackResults={() => { workflowPathRequest.current++; setWorkflowSnapshot(null); navigate("results"); }} />
        </section>
        <details className={destination === "testset" ? "secondary-tools" : "destination-hidden"}><summary>Advanced test-set JSON and versions</summary>
        <fieldset className="test-owner-gate" disabled={!currentProjectReady}>
        <section className="m2-panel" id="scenarios">
          <div className="section-heading">
            <div>
              <span className="eyebrow">SCENARIOS</span>
              <h2>{suiteDraft?.name ?? "Load a project to edit scenarios"}</h2>
            </div>
            <div className="row">
              <button disabled={!currentProjectReady || !suiteDirty} onClick={() => void saveSuite()}>
                Save suite draft
              </button>
              <button
                disabled={!currentProjectReady || !suiteDraft || suiteDirty || !workflowVersionId || !!suiteParse.issue}
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
        </fieldset>
        </details>
        <details className={destination === "results" ? "secondary-tools" : "destination-hidden"}><summary>Advanced run setup, exports and historical graph</summary>
        <section className="m2-panel" id="runs">
          <div className="section-heading">
            <div>
              <span className="eyebrow">IMMUTABLE VERSIONS · EXPLICIT EXECUTION MODE</span>
              <h2>Run and inspect</h2>
            </div>
            <div className="row">
              <button
                disabled={!suiteVersionId || !workflowVersionId || !selectedCase || runMode === "replay" && !sourceRunId}
                onClick={() => prepareAdvancedRun(true)}
              >
                Run selected case
              </button>
              <button
                disabled={!suiteVersionId || !workflowVersionId || runMode === "replay" && !sourceRunId}
                onClick={() => prepareAdvancedRun(false)}
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
            <label>Execution mode<select aria-label="Execution mode" value={runMode} onChange={(event) => { setRunMode(event.target.value as "mock" | "replay" | "live"); }}>
              <option value="mock">Mock (offline)</option><option value="replay">Recorded Replay (offline)</option><option value="live">Live Jev</option>
            </select></label>
            {runMode === "mock" && <label>
              Exact fixture set{" "}
              <select
                aria-label="Exact fixture set"
                value={fixtureSetId}
                onChange={(event) => { setFixtureSetId(event.target.value); if (projectId) window.localStorage.setItem(`pathsmith.fixtureSet.${projectId}`, event.target.value); }}
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
            </label>}
          </div>
          {runMode === "replay" && <div className="run-mode-panel">
            <label>Source run from this project<select aria-label="Replay source run" value={sourceRunId} onChange={(event) => setSourceRunId(event.target.value)}><option value="">Select a saved recording</option>{runs.filter((item) => ["completed", "failed", "canceled"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{modeLabel(item.mode)} · {item.status}{item.status === "canceled" ? ` (partial: ${item.progress.persisted}/${item.progress.selected} saved)` : ""} · {item.id.slice(0, 8)} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
            <p className="hint">The source recording supplies the provider profile and exact responses. Canceled runs are usable only if a final recording was saved; the server verifies this. Missing requests fail with REPLAY_MISS. Replay sends zero new provider requests.</p>
            {sourceRunId && <p className="hint">Source provenance: {modeLabel(runs.find((item) => item.id === sourceRunId)?.mode ?? "mock")} · {runs.find((item) => item.id === sourceRunId)?.origin ?? "unknown"}.</p>}
          </div>}
          {runMode === "live" && <p className="hint">Continue to Test set for the server preflight, hard-stop controls, requested model and fresh consent before queuing.</p>}
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
                  <span className={`mode mode-${item.mode}`}>{modeLabel(item.mode)}</span> <strong>{item.status}</strong> ·{" "}
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
                <span className={`mode mode-${run.mode}`}>{modeLabel(run.mode)}</span> · {run.origin} · workflow{" "}
                {run.workflowVersionId.slice(0, 8)} · suite{" "}
                {run.suiteVersionId.slice(0, 8)}
              </p>
              {run.sourceRunId && <p className="hint">Recorded replay source: {run.sourceRunId} · source origin {run.origin}. These outcomes are conditional on saved responses.</p>}
              {run.mixedModel && <p className="notice conflict" role="alert">Mixed resolved model versions were observed. Review provenance before interpreting comparisons; an unqualified gate is blocked.</p>}
              {(run.adapters ?? snapshot?.adapters) && <div className="provenance"><strong>Provider provenance</strong>{Object.entries(run.adapters ?? snapshot?.adapters ?? {}).map(([binding, adapter]) => <p key={binding}>{binding}: {adapter.providerId} · requested {adapter.requestedModel} · resolved {adapter.resolvedModels?.length ? adapter.resolvedModels.join(", ") : "unknown until response"}</p>)}</div>}
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
                {run.summary.actualHttpAttempts} current HTTP attempts · {run.summary.replayedJudgments ?? 0} replayed judgments
              </p>
              <p>Current provider usage: {run.mode === "replay" ? "0 tokens (no new provider usage)" : usageLabel(run.summary.usage)} · Historical source usage: {usageLabel(run.summary.historicalUsage)}. Historical usage is excluded from current usage.</p>
              <p className="hint">Configured HTTP attempt budget: {run.httpAttemptLimit}. Unknown usage remains unknown.</p>
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
              {finalStatus(run.status) && <div className="export-warning"><p className="notice conflict">Full run export may contain scenario inputs, questions, model responses, traces, and replay provenance. Local storage is not application-level encrypted. Review the destination before sharing.</p><label className="check"><input type="checkbox" aria-label="Acknowledge sensitive run export" checked={exportAcknowledged} onChange={(event) => setExportAcknowledged(event.target.checked)} /> I understand this export may contain sensitive data.</label><button disabled={!exportAcknowledged} onClick={() => void exportRun()}>Export full run JSON</button></div>}
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
                  {caseRuns.find((item) => item.id === selectedCaseRun)?.result.error && <p className="notice conflict" role="alert">{caseRuns.find((item) => item.id === selectedCaseRun)?.result.error?.code}: {caseRuns.find((item) => item.id === selectedCaseRun)?.result.error?.message}. Inspect the saved trace for the node and exact request details.</p>}
                  <pre>{trace ? pretty(trace) : "Loading trace…"}</pre>
                </div>
              )}
              {snapshot && <div className="historical-graph">
                <div className="section-heading"><h3>Historical graph</h3><div className="row"><button aria-pressed={historyView === "path"} onClick={() => setHistoryView("path")}>Selected case path</button><button aria-pressed={historyView === "coverage"} onClick={() => setHistoryView("coverage")}>Cohort coverage</button></div></div>
                <p className="hint">Workflow version {run.workflowVersionId.slice(0, 8)} · {snapshot.mode} · {snapshot.origin} · {historyView === "coverage" ? `${coverage?.started ?? "N/A"} started; ${coverage?.branchPortsVisited ?? "N/A"}/${coverage?.branchPortsTotal ?? "N/A"} branch ports visited` : selectedCaseRun ? caseRuns.find((item) => item.id === selectedCaseRun)?.result.started === false ? "Case did not start; no path was observed" : "Selected case path" : "Choose a case above"}. Unvisited in this cohort does not mean unreachable.</p>
                {coverage?.partial && <p className="notice conflict">Partial cohort: coverage counts include only saved case results.</p>}
                {historyView === "coverage" && !coverage && <p className="hint">Coverage N/A: no saved case results are available.</p>}
                <WorkflowEditor workflow={snapshot.workflow} layout={snapshot.layout ?? {}} selectedNode={selectedHistoricalNode} onSelect={setSelectedHistoricalNode}
                  selectedEdges={historyView === "path" && selectedCaseRun ? caseRuns.find((item) => item.id === selectedCaseRun)?.result.selectedEdges : undefined}
                  visitedNodes={historyView === "path" && selectedCaseRun ? caseRuns.find((item) => item.id === selectedCaseRun)?.result.visitedNodes : undefined}
                  coverage={historyView === "coverage" ? coverage : null} />
                {selectedHistoricalNode && <div className="trace"><h4>{snapshot.workflow.nodes.find((item) => item.id === selectedHistoricalNode)?.label ?? selectedHistoricalNode} · saved trace events</h4><pre>{trace ? pretty((trace as { events?: { nodeId?: string }[] }).events?.filter((item) => item.nodeId === selectedHistoricalNode) ?? []) : "Choose a case above to load trace events."}</pre></div>}
              </div>}
            </div>
          )}
        </section>
        </details>
        <section className={destination === "compare" ? "compare-destination" : "destination-hidden"} id="comparisons">
          <CompareScreen runs={comparisonRuns} initialCandidateId={candidateId}
            ownerKey={`${projectSelection.current}:${destination}`} onSelectionChanged={() => { compareActionRequest.current++; }}
            onOpenSetup={async (owner, prefill) => { const action = ++compareActionRequest.current; if (!await comparisonOwnerReady(owner, action)) return; setRunPrefill(prefill); setTestStep(2); navigate("testset"); }}
            onRemainder={async (record) => { const action = ++compareActionRequest.current; const owner = projectSelection.current, generation = projectRequest.current; const plan = await api<RerunPlan>(`/runs/${record.id}/rerun-plan`); if (compareActionRequest.current !== action || projectSelection.current !== owner || projectRequest.current !== generation) return; if (!await comparisonOwnerReady(record.projectId, action)) return; setRunPrefill({ from: record.id, title: `Run remaining cases from ${record.id.slice(0, 8)}`, workflowVersionId: plan.workflowVersionId, suiteVersionId: plan.suiteVersionId, selectedScenarioIds: plan.selectedScenarioIds, mode: plan.mode, sourceRunId: plan.sourceRunId, rerunPlan: plan }); setTestStep(2); navigate("testset"); }}
            onOpenCandidate={async (record, caseId) => { const action = ++compareActionRequest.current; if (!await comparisonOwnerReady(record.projectId, action)) return; setFocusResultCaseId(caseId); await openRun(record.id); if (compareActionRequest.current !== action || projectSelection.current !== record.projectId || runSelection.current !== record.id) return; navigate("results"); }} />
        </section>
        </div>
      </div>
    </AppShell>
  );
}
