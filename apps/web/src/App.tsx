import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseJson,
  validateWorkflow,
  type Suite,
  type Workflow,
} from "@pathsmith/contracts";
import { WorkflowEditor, type Layout } from "./WorkflowEditor";
import { GuidedClassification } from "./GuidedClassification";
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
  layout?: Layout;
};
type Version = { id: string; draftRevision: number; createdAt: string };
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
  mode: string;
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
  mode: string;
  origin: string;
  adapters?: Record<string, { providerId: string; requestedModel: string; resolvedModels: string[] }>;
};
type ComparisonCase = {
  scenarioId: string;
  behaviorChanged: boolean;
  newAssertionRegression: boolean;
  assertionImprovement: boolean;
  newExecutionRegression: boolean;
  unchangedFailure: boolean;
  firstDivergence: { index: number; baselineEdge: string | null; candidateEdge: string | null } | null;
  baseline: { status: string; outcome: string | null; assertionStatus: string; assertions: unknown[]; selectedEdges: string[]; visitedNodes: string[] };
  candidate: { status: string; outcome: string | null; assertionStatus: string; assertions: unknown[]; selectedEdges: string[]; visitedNodes: string[] };
};
type Comparison = {
  gate: "pass" | "fail" | "inconclusive";
  baselineRunId: string; candidateRunId: string;
  policy: { strict: boolean; acceptMixedModel: boolean };
  baselineStatus: string; candidateStatus: string;
  issues: string[];
  changedCases: number | null; newAssertionRegressions: number | null;
  assertionImprovements: number | null; newExecutionRegressions: number | null;
  modelChanged: boolean | null; workflowChanged: boolean; confounded: boolean | null;
  workflowDiff: { nodes: { added: string[]; removed: string[]; changed: { id: string; before: unknown; after: unknown }[] }; edges: { added: string[]; removed: string[]; changed: { id: string; before: unknown; after: unknown }[] }; inputSchemaChanged: boolean; outputSchemaChanged: boolean; bindingsChanged: boolean };
  configurationDiff: { key: string; before: unknown; after: unknown }[];
  cases: ComparisonCase[];
};
type Coverage = { started: number; partial: boolean; nodes: { nodeId: string; visits: number; startedScenarios: number }[]; edges: { edgeId: string; traversals: number; sourceVisits: number }[]; branchPortsVisited: number; branchPortsTotal: number };

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
const modeLabel = (mode: string) => mode === "replay" ? "Recorded Replay" : mode === "live" ? "Live Jev" : "Mock";
function longestJudgmentPath(workflow: Workflow): number {
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const count = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) throw new Error("Published workflow contains a cycle");
    visiting.add(id);
    const next = Math.max(0, ...(outgoing.get(id) ?? []).map(count));
    visiting.delete(id);
    const result = (nodes.get(id)?.kind === "judgment" ? 1 : 0) + next;
    memo.set(id, result);
    return result;
  };
  return count(workflow.nodes.find((node) => node.kind === "start")?.id ?? "");
}
function usageLabel(usage: Usage): string {
  if (!usage) return "unknown";
  return `input ${usage.inputTokens ?? "unknown"}, output ${usage.outputTokens ?? "unknown"}, total ${usage.totalTokens ?? "unknown"} tokens`;
}
function graphable(value: unknown): value is Workflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.nodes) || !Array.isArray(item.edges) || !Array.isArray(item.bindings) || !item.inputSchema || typeof item.inputSchema !== "object") return false;
  return item.nodes.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== "string" || typeof node.label !== "string") return false;
    if (node.kind === "branch") return Array.isArray(node.cases) && node.cases.every((entry: unknown) => !!entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).id === "string");
    if (node.kind === "judgment") return !!node.questions && typeof node.questions === "object" && !Array.isArray(node.questions) && Object.values(node.questions).every((question) => !!question && typeof question === "object" && ["choice", "score", "binary"].includes(String((question as Record<string, unknown>).kind)));
    return ["start", "transform", "output"].includes(String(node.kind));
  }) && item.edges.every((raw) => !!raw && typeof raw === "object" && ["id", "source", "port", "target"].every((key) => typeof (raw as Record<string, unknown>)[key] === "string"));
}

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
  const [layout, setLayout] = useState<Layout>({});
  const [, setHistoryIndex] = useState(0);
  const undoStack = useRef<{ text: string; layout: Layout }[]>([]);
  const redoStack = useRef<{ text: string; layout: Layout }[]>([]);
  const [suiteText, setSuiteText] = useState("");
  const [view, setView] = useState<"graph" | "json">("graph");
  const [advancedOpen, setAdvancedOpen] = useState(() => window.localStorage.getItem("pathsmith.advancedOpen") === "1");
  const [selectedNode, setSelectedNode] = useState("route_content");
  const [selectedCase, setSelectedCase] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [runMode, setRunMode] = useState<"mock" | "replay" | "live">("mock");
  const [sourceRunId, setSourceRunId] = useState("");
  const [liveConsent, setLiveConsent] = useState(false);
  const [liveConcurrency, setLiveConcurrency] = useState(4);
  const [httpAttemptLimit, setHttpAttemptLimit] = useState(200);
  const [preflight, setPreflight] = useState<{ scenarios: number; model: string; maxJudgments: number; maxLogicalCalls: number; maxAttempts: number } | null>(null);
  const [preflightError, setPreflightError] = useState("");
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
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [baselineId, setBaselineId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [strictGate, setStrictGate] = useState(false);
  const [acceptMixedModel, setAcceptMixedModel] = useState(false);
  const [comparisonFilter, setComparisonFilter] = useState("all");
  const [selectedComparisonCase, setSelectedComparisonCase] = useState("");
  const [comparisonSnapshots, setComparisonSnapshots] = useState<{ baseline: Snapshot; candidate: Snapshot } | null>(null);
  const [comparisonTraces, setComparisonTraces] = useState<{ baseline: unknown; candidate: unknown } | null>(null);
  const projectSelection = useRef("");
  const projectRequest = useRef(0);
  const runSelection = useRef("");
  const runRequest = useRef(0);
  const traceSelection = useRef("");
  const traceRequest = useRef(0);
  const compareRequest = useRef(0);
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
        setHttpAttemptLimit(status.defaultHttpAttemptLimit);
      })
      .catch((error) => {
        setHealth("API unavailable");
        setMessage(String(error));
      });
  }, []);
  useEffect(() => {
    if (runMode !== "live" || !workflowVersionId || !suiteVersionId) {
      setPreflight(null); setPreflightError(""); return;
    }
    let active = true;
    setPreflight(null); setPreflightError("");
    void Promise.all([
      api<Workflow>(`/workflow-versions/${workflowVersionId}/export`),
      api<{ definition: Suite }>(`/suite-versions/${suiteVersionId}`),
    ]).then(([published, version]) => {
      if (!active) return;
      const scenarios = version.definition.scenarios.length;
      const maxJudgments = longestJudgmentPath(published);
      const maxLogicalCalls = scenarios * maxJudgments;
      setPreflight({ scenarios, model: providerStatus?.providers.find((item) => item.id === "jev")?.defaultModel ?? "unknown", maxJudgments, maxLogicalCalls, maxAttempts: maxLogicalCalls * 3 });
    }).catch((error) => { if (active) setPreflightError(String(error)); });
    return () => { active = false; };
  }, [runMode, workflowVersionId, suiteVersionId, providerStatus]);
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
    const all = await fetchPages<Run>("/runs", 1000);
    if (projectSelection.current === id && projectRequest.current === generation) setComparisonRuns(all.items);
    if (selectId) await openRun(selectId);
  }
  async function openProject(id: string, knownFixture?: string) {
    projectSelection.current = id;
    const generation = ++projectRequest.current;
    compareRequest.current++;
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
      setRunMode("mock"); setSourceRunId(""); setLiveConsent(false); setExportAcknowledged(false);
      setWorkflowDraft(fullW);
      setSuiteDraft(fullS);
      setText(pretty(fullW.definition));
      setLayout(fullW.layout ?? {});
      undoStack.current = []; redoStack.current = []; setHistoryIndex(0);
      setSuiteText(pretty(fullS.definition));
      setSelectedCase(fullS.definition.scenarios?.[0]?.id ?? "");
      setSelectedNode("");
      setView("graph");
    setRun(null);
      setSnapshot(null);
      setCaseRuns([]);
      setCaseTotal(0);
      setTrace(null);
      setCoverage(null);
      setSelectedHistoricalNode("");
      setComparison(null);
      setBaselineId(""); setCandidateId("");
      setComparisonSnapshots(null); setComparisonTraces(null); setSelectedComparisonCase("");
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
  async function loadClassification() {
    setBusy(true); setMessage("");
    try {
      const loaded = await api<{ project: Project; fixtureSetId: string }>("/examples/classification/load", "POST");
      await refreshProjects();
      await openProject(loaded.project.id, loaded.fixtureSetId);
      setMessage("Loaded the chat abuse classification example.");
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  const validation = useMemo(() => {
    try {
      const value = parseJson(text, 512 * 1024);
      const result = validateWorkflow(value);
      return {
        result,
        workflow: !result.diagnostics.some((item) => item.code === "SCHEMA_INVALID" || item.code === "UNSUPPORTED_FORMAT") && graphable(value) ? value : null,
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
  function editDefinition(value: string) {
    undoStack.current.push({ text, layout });
    redoStack.current = [];
    setText(value); setHistoryIndex((index) => index + 1);
  }
  function editLayout(value: Layout) {
    undoStack.current.push({ text, layout });
    redoStack.current = [];
    setLayout(value); setHistoryIndex((index) => index + 1);
  }
  function travel(direction: "undo" | "redo") {
    const source = direction === "undo" ? undoStack : redoStack;
    const target = direction === "undo" ? redoStack : undoStack;
    const previous = source.current.pop();
    if (!previous) return;
    target.current.push({ text, layout });
    setText(previous.text); setLayout(previous.layout);
    setHistoryIndex((index) => index + 1);
  }
  async function saveWorkflow() {
    if (!workflowDraft) return;
    setMessage("");
    setConflict("");
    try {
      const definition = parseJson(text, 512 * 1024);
      const saved = await api<Draft<Workflow>>(
        `/workflows/${workflowDraft.id}/draft`,
        "PUT",
        { expectedRevision: workflowDraft.draftRevision, definition, layout },
      );
      setWorkflowDraft(saved);
      setText(pretty(saved.definition));
      setLayout(saved.layout ?? layout);
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
    if (runMode === "live" && (!liveConsent || !providerStatus?.allowedModes.includes("live") || !preflight)) return;
    if (runMode === "replay" && !sourceRunId) return;
    setMessage("");
    try {
      const queued = await api<Run>("/runs", "POST", {
        workflowVersionId,
        suiteVersionId,
        mode: runMode,
        ...(runMode === "mock" ? { fixtureSetId } : {}),
        ...(runMode === "replay" ? { sourceRunId } : {}),
        ...(runMode === "live" ? { confirmLive: true, concurrency: liveConcurrency, httpAttemptLimit } : {}),
        ...(single ? { selectedScenarioIds: [selectedCase] } : {}),
      });
      if (runMode === "live") setLiveConsent(false);
      await refreshRuns(projectId, queued.id);
      setMessage(
        `Queued ${modeLabel(runMode)} ${single ? "case" : "suite"} run. Edits after publication are not included.`,
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
  async function compare() {
    if (!baselineId || !candidateId) return;
    const generation = ++compareRequest.current;
    setComparison(null); setComparisonSnapshots(null); setSelectedComparisonCase(""); setComparisonTraces(null);
    try {
      const result = await api<Comparison>("/comparisons", "POST", { baselineRunId: baselineId, candidateRunId: candidateId, policy: { strict: strictGate, acceptMixedModel } });
      const [baseline, candidate] = await Promise.all([api<Snapshot>(`/runs/${baselineId}/snapshot`), api<Snapshot>(`/runs/${candidateId}/snapshot`)]);
      if (compareRequest.current !== generation) return;
      setComparison(result); setComparisonSnapshots({ baseline, candidate });
      setMessage("");
    } catch (error) { if (compareRequest.current === generation) setMessage(String(error)); }
  }
  function clearComparison() {
    compareRequest.current++;
    setComparison(null);
    setComparisonSnapshots(null);
    setSelectedComparisonCase("");
    setComparisonTraces(null);
  }
  async function selectComparisonCase(id: string) {
    if (!comparison) return;
    setSelectedComparisonCase(id); setComparisonTraces(null);
    const generation = ++compareRequest.current;
    try {
      const [a, b] = await Promise.all([
        fetchPages<CaseRun>(`/runs/${comparison.baselineRunId}/scenarios`, 1000),
        fetchPages<CaseRun>(`/runs/${comparison.candidateRunId}/scenarios`, 1000),
      ]);
      const ids = [a.items.find((item) => item.scenarioId === id)?.id, b.items.find((item) => item.scenarioId === id)?.id];
      const [baseline, candidate] = await Promise.all(ids.map((caseId) => caseId ? api(`/scenario-runs/${caseId}/trace`) : Promise.resolve(null)));
      if (compareRequest.current === generation) setComparisonTraces({ baseline, candidate });
    } catch (error) { if (compareRequest.current === generation) setMessage(String(error)); }
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
          <p>M5 · guided classification tests</p>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="breadcrumb">
              {projectId
                ? projects.find((item) => item.id === projectId)?.name
                : "Pathsmith / Local workspace"}
            </span>
            <h1>Test how your classifier performs.</h1>
          </div>
          <span className={`mode mode-${runMode}`}>● {modeLabel(runMode).toUpperCase()}{runMode === "mock" ? " · OFFLINE" : runMode === "replay" ? " · NO NEW HTTP" : " · EXTERNAL REQUESTS"}</span>
        </header>
        <GuidedClassification projectId={projectId} projects={projects} suiteDraft={suiteDraft} suiteDirty={suiteDirty} workflowVersionId={workflowVersionId} suiteVersionId={suiteVersionId} run={run} runs={runs} providerStatus={providerStatus}
          onLoadStarter={loadClassification} onOpenProject={openProject}
          onSuitePublished={(draft, version) => { setSuiteDraft((current) => current ? { ...current, ...draft } : current); setSuiteText(pretty(draft.definition)); setSuiteVersions((current) => [version, ...current]); setSuiteVersionId(version.id); }}
          onRunQueued={async (id) => { if (projectId) await refreshRuns(projectId, id); }} onSelectRun={openRun} />
        <details className="advanced" open={advancedOpen} onToggle={(event) => { const open = event.currentTarget.open; setAdvancedOpen(open); window.localStorage.setItem("pathsmith.advancedOpen", open ? "1" : "0"); }}><summary>Advanced: graph, JSON, versions, traces and comparisons</summary>
        {advancedOpen && <>
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
              <button disabled={!validation.result.valid || !workflow} onClick={exportFile}>
                Export workflow
              </button>
              <button aria-label="Undo edit" disabled={undoStack.current.length === 0} onClick={() => travel("undo")}>Undo</button>
              <button aria-label="Redo edit" disabled={redoStack.current.length === 0} onClick={() => travel("redo")}>Redo</button>
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
              Graph editor
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
          {view === "json" ? <div className="editor"><div className="canvas"><textarea aria-label="Workflow JSON" spellCheck={false} value={text} onChange={(event) => editDefinition(event.target.value)} /></div><aside className="inspector"><span className="eyebrow">CANONICAL DEFINITION</span><p>JSON edits and graph edits update the same draft. Invalid JSON stays in this editor until corrected.</p></aside></div>
            : workflow ? <WorkflowEditor key={workflowDraft?.id ?? "preview"} workflow={workflow} layout={layout} selectedNode={selectedNode} onSelect={setSelectedNode} onEdit={(value) => editDefinition(pretty(value))} onLayout={editLayout} />
            : <div className="empty"><strong>Resolve definition errors</strong><button onClick={() => setView("json")}>Open JSON definition</button></div>}
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
              <span className="eyebrow">IMMUTABLE VERSIONS · EXPLICIT EXECUTION MODE</span>
              <h2>Run and inspect</h2>
            </div>
            <div className="row">
              <button
                disabled={!suiteVersionId || !workflowVersionId || !selectedCase || runMode === "replay" && !sourceRunId || runMode === "live" && (!providerStatus?.allowedModes.includes("live") || !liveConsent || !preflight)}
                onClick={() => void startRun(true)}
              >
                Run selected case
              </button>
              <button
                disabled={!suiteVersionId || !workflowVersionId || runMode === "replay" && !sourceRunId || runMode === "live" && (!providerStatus?.allowedModes.includes("live") || !liveConsent || !preflight)}
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
            <label>Execution mode<select aria-label="Execution mode" value={runMode} onChange={(event) => { setRunMode(event.target.value as "mock" | "replay" | "live"); setLiveConsent(false); }}>
              <option value="mock">Mock (offline)</option><option value="replay">Recorded Replay (offline)</option><option value="live">Live Jev</option>
            </select></label>
            {runMode === "mock" && <label>
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
            </label>}
          </div>
          {runMode === "replay" && <div className="run-mode-panel">
            <label>Source run from this project<select aria-label="Replay source run" value={sourceRunId} onChange={(event) => setSourceRunId(event.target.value)}><option value="">Select a saved recording</option>{runs.filter((item) => ["completed", "failed", "canceled"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{modeLabel(item.mode)} · {item.status}{item.status === "canceled" ? ` (partial: ${item.progress.persisted}/${item.progress.selected} saved)` : ""} · {item.id.slice(0, 8)} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
            <p className="hint">The source recording supplies the provider profile and exact responses. Canceled runs are usable only if a final recording was saved; the server verifies this. Missing requests fail with REPLAY_MISS. Replay sends zero new provider requests.</p>
            {sourceRunId && <p className="hint">Source provenance: {modeLabel(runs.find((item) => item.id === sourceRunId)?.mode ?? "mock")} · {runs.find((item) => item.id === sourceRunId)?.origin ?? "synthetic"}.</p>}
          </div>}
          {runMode === "live" && <div className="run-mode-panel live-preflight">
            <strong>Live Jev preflight</strong>
            <p className="notice conflict">Scenario state and question text leave this computer. Provider usage may be billed. No exact token or dollar cost is available before execution.</p>
            {!providerStatus?.allowedModes.includes("live") && <p role="alert">Live mode is unavailable: the server needs both an enabled live flag and a configured Jev API key.</p>}
            {preflightError && <p role="alert">Preflight failed: {preflightError}</p>}
            {preflight && <p>Published suite: {preflight.scenarios} scenarios (selected case: 1) · Provider/model: Jev / {preflight.model} · Longest judgment path: {preflight.maxJudgments} calls per scenario · Full suite upper bound: {preflight.maxLogicalCalls} logical calls, {preflight.maxAttempts} HTTP attempts at 3 per judgment · Selected case upper bound: {preflight.maxJudgments} logical calls, {preflight.maxJudgments * 3} attempts.</p>}
            {preflight && preflight.maxAttempts > httpAttemptLimit && <p className="notice conflict">The full suite conservative upper bound exceeds the configured attempt budget. Execution may stop when that budget is exhausted.</p>}
            <div className="row"><label>Live request concurrency<input aria-label="Live request concurrency" type="number" min={1} max={4} value={liveConcurrency} onChange={(event) => setLiveConcurrency(Math.max(1, Math.min(4, Number(event.target.value) || 1)))} /></label><label>Maximum HTTP attempts<input aria-label="Maximum HTTP attempts" type="number" min={1} max={providerStatus?.maximumHttpAttemptLimit ?? 2000} value={httpAttemptLimit} onChange={(event) => setHttpAttemptLimit(Math.max(1, Math.min(providerStatus?.maximumHttpAttemptLimit ?? 2000, Number(event.target.value) || 1)))} /></label></div>
            <p className="hint">At most 4 live requests are in flight process-wide. The attempt budget bounds dispatch; token totals depend on provider responses.</p>
            <label className="check"><input type="checkbox" aria-label="Confirm live run" checked={liveConsent} disabled={!providerStatus?.allowedModes.includes("live") || !preflight} onChange={(event) => setLiveConsent(event.target.checked)} /> I consent to sending the selected scenario data and questions to Jev and possible usage charges.</label>
          </div>}
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
        <section className="m2-panel" id="comparisons">
          <div className="section-heading"><div><span className="eyebrow">IMMUTABLE RUNS</span><h2>Compare baseline and candidate</h2></div></div>
          <p className="hint">Choose completed runs with the same suite snapshot and selected case IDs. The gate is inconclusive for incomplete or incompatible pairs.</p>
          <div className="row comparison-controls">
            <label>Baseline run<select aria-label="Baseline run" value={baselineId} onChange={(event) => { clearComparison(); setBaselineId(event.target.value); }}><option value="">Select baseline</option>{comparisonRuns.map((item) => <option key={item.id} value={item.id}>{item.workflowName} · {item.status} · {item.id.slice(0, 8)} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
            <label>Candidate run<select aria-label="Candidate run" value={candidateId} onChange={(event) => { clearComparison(); setCandidateId(event.target.value); }}><option value="">Select candidate</option>{comparisonRuns.map((item) => <option key={item.id} value={item.id}>{item.workflowName} · {item.status} · {item.id.slice(0, 8)} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
            <label className="check"><input type="checkbox" checked={strictGate} onChange={(event) => { clearComparison(); setStrictGate(event.target.checked); }} /> Strict gate: any candidate assertion failure fails</label>
            <label className="check"><input type="checkbox" checked={acceptMixedModel} onChange={(event) => { clearComparison(); setAcceptMixedModel(event.target.checked); }} /> Accept mixed model provenance</label>
            <button disabled={!baselineId || !candidateId || baselineId === candidateId} onClick={() => void compare()}>Compare runs</button>
          </div>
          {comparison && <div className="comparison-report">
            <div className="section-heading"><h3>Gate: <strong className={`gate-${comparison.gate}`}>{comparison.gate}</strong></h3><span className="hint">Baseline {comparison.baselineStatus} · Candidate {comparison.candidateStatus}</span></div>
            <p className="hint">Run IDs: {comparison.baselineRunId} → {comparison.candidateRunId} · Strict gate: {String(comparison.policy.strict)} · Accept mixed model: {String(comparison.policy.acceptMixedModel)}</p>
            <p className="hint">Baseline: {modeLabel(comparisonRuns.find((item) => item.id === comparison.baselineRunId)?.mode ?? "mock")} / {comparisonRuns.find((item) => item.id === comparison.baselineRunId)?.origin ?? "unknown"} · Candidate: {modeLabel(comparisonRuns.find((item) => item.id === comparison.candidateRunId)?.mode ?? "mock")} / {comparisonRuns.find((item) => item.id === comparison.candidateRunId)?.origin ?? "unknown"}. Replay preserves source provenance.</p>
            <div className="comparison-metrics"><span>{comparison.newAssertionRegressions ?? "N/A"} new assertion regressions</span><span>{comparison.assertionImprovements ?? "N/A"} assertion improvements</span><span>{comparison.changedCases ?? "N/A"} changed behavior</span><span>{comparison.newExecutionRegressions ?? "N/A"} new execution regressions</span></div>
            {comparison.issues.length > 0 && <div className="notice conflict"><strong>Gate reasons</strong><ul>{comparison.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
            <p className="hint">Workflow changed: {String(comparison.workflowChanged)} · Model changed: {comparison.modelChanged === null ? "N/A" : String(comparison.modelChanged)} · Confounded: {comparison.confounded === null ? "N/A" : String(comparison.confounded)}. Improvements do not cancel regressions.</p>
            <details><summary>Workflow and configuration diff</summary><div className="diff-grid"><div><h4>Nodes</h4><p>Added: {comparison.workflowDiff.nodes.added.join(", ") || "none"}</p><p>Removed: {comparison.workflowDiff.nodes.removed.join(", ") || "none"}</p>{comparison.workflowDiff.nodes.changed.map((item) => <details key={item.id}><summary>Changed {item.id}</summary><div className="diff-grid"><pre>Before\n{pretty(item.before)}</pre><pre>After\n{pretty(item.after)}</pre></div></details>)}</div><div><h4>Edges and schema</h4><p>Added edges: {comparison.workflowDiff.edges.added.join(", ") || "none"}</p><p>Removed edges: {comparison.workflowDiff.edges.removed.join(", ") || "none"}</p><p>Changed edges: {comparison.workflowDiff.edges.changed.map((item) => item.id).join(", ") || "none"}</p><p>Input schema: {comparison.workflowDiff.inputSchemaChanged ? "changed" : "same"} · Output schema: {comparison.workflowDiff.outputSchemaChanged ? "changed" : "same"} · Bindings: {comparison.workflowDiff.bindingsChanged ? "changed" : "same"}</p><h4>Execution configuration</h4>{comparison.configurationDiff.length ? comparison.configurationDiff.map((item) => <details key={item.key}><summary>{item.key}</summary><div className="diff-grid"><pre>Before\n{pretty(item.before)}</pre><pre>After\n{pretty(item.after)}</pre></div></details>) : <p>No configuration changes.</p>}</div></div></details>
            <div className="row"><label>Case filter<select aria-label="Comparison case filter" value={comparisonFilter} onChange={(event) => setComparisonFilter(event.target.value)}><option value="all">All paired cases</option><option value="regression">New assertion regressions</option><option value="improvement">Improvements</option><option value="change">Changed behavior</option><option value="error">Execution regressions</option></select></label></div>
            <div className="comparison-cases">{comparison.cases.filter((item) => comparisonFilter === "all" || comparisonFilter === "regression" && item.newAssertionRegression || comparisonFilter === "improvement" && item.assertionImprovement || comparisonFilter === "change" && item.behaviorChanged || comparisonFilter === "error" && item.newExecutionRegression).map((item) => <button key={item.scenarioId} className={selectedComparisonCase === item.scenarioId ? "selected-run" : ""} onClick={() => void selectComparisonCase(item.scenarioId)}><strong>{item.scenarioId}</strong><span>{item.newAssertionRegression ? "Regression" : item.assertionImprovement ? "Improvement" : item.newExecutionRegression ? "Execution regression" : item.unchangedFailure ? "Unchanged failure" : item.behaviorChanged ? "Behavior changed" : "No change"}</span><span>{item.baseline.outcome ?? "N/A"} → {item.candidate.outcome ?? "N/A"}</span></button>)}</div>
            {selectedComparisonCase && comparisonSnapshots && (() => { const item = comparison.cases.find((entry) => entry.scenarioId === selectedComparisonCase); if (!item) return null; return <div className="case-comparison"><h3>{item.scenarioId}</h3><p>First observed divergence: {item.firstDivergence ? `edge ${item.firstDivergence.index + 1}: ${item.firstDivergence.baselineEdge ?? "end"} → ${item.firstDivergence.candidateEdge ?? "end"}` : "none in selected edges"}</p><div className="diff-grid"><div><h4>Baseline · {item.baseline.assertionStatus}</h4><p>{item.baseline.status} · {item.baseline.outcome ?? "N/A"}</p><WorkflowEditor workflow={comparisonSnapshots.baseline.workflow} layout={comparisonSnapshots.baseline.layout ?? {}} selectedNode="" onSelect={() => {}} selectedEdges={item.baseline.selectedEdges} visitedNodes={item.baseline.visitedNodes} /><pre>{comparisonTraces ? pretty(comparisonTraces.baseline) : "Loading baseline trace…"}</pre></div><div><h4>Candidate · {item.candidate.assertionStatus}</h4><p>{item.candidate.status} · {item.candidate.outcome ?? "N/A"}</p><WorkflowEditor workflow={comparisonSnapshots.candidate.workflow} layout={comparisonSnapshots.candidate.layout ?? {}} selectedNode="" onSelect={() => {}} selectedEdges={item.candidate.selectedEdges} visitedNodes={item.candidate.visitedNodes} /><pre>{comparisonTraces ? pretty(comparisonTraces.candidate) : "Loading candidate trace…"}</pre></div></div></div>; })()}
          </div>}
        </section>
        </>}
        </details>
      </main>
    </div>
  );
}
