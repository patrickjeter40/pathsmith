import { useEffect, useMemo, useRef, useState } from "react";
import type { Suite, Workflow } from "@pathsmith/contracts";
import { parseExamples, type ImportRow } from "./importExamples";

type Reference = { value: string | null; source: "generated" | "human" | "unknown"; review: "provisional" | "reviewed" };
type Scenario = Suite["scenarios"][number] & { referenceLabel?: Reference };
type ClassificationSuite = Suite & { classification?: { nodeId: string; questionId: string; positiveLabel: string; negativeLabel: string }; scenarios: Scenario[] };
type Draft = { id: string; definition: Suite; draftRevision: number };
type Version = { id: string; draftRevision: number; createdAt: string };
type Run = { id: string; status: string; mode: string; progress: { selected: number; persisted: number } };
type ProviderStatus = { allowedModes: string[]; defaultHttpAttemptLimit: number; maximumHttpAttemptLimit: number; providers: { id: string; defaultModel?: string }[] };
type Rate = { numerator: number; denominator: number; value: number | null };
type Cohort = { selected: number; completed: number; errors: number; canceled: number; interrupted: number; pending: number; notRun: number; missingPrediction: number; unlabeled: number; unclear: number; labeled: number; evaluated: number; truePositive: number; trueNegative: number; falsePositive: number; falseNegative: number; agreement: Rate; endToEndAgreement: Rate; completion: Rate };
type Report = { status: string; partial: boolean; selected: number; mode: string; origin: string; mixedModel: boolean; adapters?: Record<string, { providerId: string; requestedModel: string; resolvedModels: string[] }>; summary: { all: Cohort; reviewed: Cohort; provisional: Cohort; labelSources: Record<string, number>; slices: { tag: string; all: Cohort }[] }; execution: { actualHttpAttempts: number; usage: unknown }; error?: { code: string; message: string } | null };
type ResultRow = { scenarioId: string; name: string; input: { content?: string }; tags: string[]; referenceLabel?: Reference; predictedLabel: string | null; status: string; verdict: string; errorCode?: string | null; traceId?: string | null };
type RowPage = { total: number; items: ResultRow[] };
type Export = { filename: string; mediaType: string; content: string };

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method, headers: method === "GET" ? undefined : { "Content-Type": "application/json", "X-Pathsmith-Client": "local" }, body: method === "GET" ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${payload.error?.code ?? response.status}: ${payload.error?.message ?? response.statusText}`);
  return payload as T;
}
const rateText = (rate?: Rate) => rate?.value == null ? "N/A" : `${Math.round(rate.value * 100)}% (${rate.numerator}/${rate.denominator})`;
const sampleIds = (scenarios: Scenario[], count: number) => Array.from({ length: Math.min(count, scenarios.length) }, (_, index) => scenarios[Math.floor(index * scenarios.length / Math.min(count, scenarios.length))].id);
const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function LabelReview({ scenarios, target, saving, onSave, onContinue, onDirty }: {
  scenarios: Scenario[]; target: NonNullable<ClassificationSuite["classification"]>; saving: boolean;
  onSave: (edits: Record<string, Reference | null>) => Promise<void>; onContinue: () => void; onDirty: (dirty: boolean) => void;
}) {
  const [edits, setEdits] = useState<Record<string, Reference | null>>({});
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const current = (scenario: Scenario) => Object.hasOwn(edits, scenario.id) ? edits[scenario.id] : scenario.referenceLabel ?? null;
  const change = (scenario: Scenario, reference: Reference | null) => { onDirty(true); setEdits((previous) => ({ ...previous, [scenario.id]: reference })); };
  async function save() {
    try { await onSave(edits); setEdits({}); onDirty(false); setError(""); }
    catch (cause) { setError(String(cause)); }
  }
  return <div className="guided-body"><h3>Review expected answers</h3><p>{scenarios.length} messages. Generated answers remain provisional until a person checks them. Unlabeled and unclear messages do not count toward agreement rates.</p>
    {Object.keys(edits).length > 0 && <p className="notice">{Object.keys(edits).length} unsaved label changes. Save them before running.</p>}
    {error && <p role="alert" className="notice conflict">{error}</p>}
    <div className="guided-table-wrap"><table><thead><tr><th>Message</th><th>Expected answer</th><th>Source</th><th>Review state</th></tr></thead><tbody>{scenarios.slice(offset, offset + 100).map((scenario) => {
      const reference = current(scenario);
      return <tr key={scenario.id}><td>{String((scenario.input as { content?: string }).content ?? "")}</td><td><select aria-label={`Expected answer for ${scenario.id}`} value={reference?.value ?? (reference ? "unclear" : "")} onChange={(event) => change(scenario, event.target.value ? { value: event.target.value === "unclear" ? null : event.target.value, source: reference?.source ?? "unknown", review: "reviewed" } : null)}><option value="">No label</option><option value={target.positiveLabel}>{target.positiveLabel}</option><option value={target.negativeLabel}>{target.negativeLabel}</option><option value="unclear">Unclear</option></select></td><td>{reference?.source ?? "unknown"}</td><td><button disabled={!reference} onClick={() => { if (reference) change(scenario, { ...reference, review: reference.review === "reviewed" ? "provisional" : "reviewed" }); }}>{reference?.review ?? "unlabeled"}</button></td></tr>;
    })}</tbody></table></div>
    <div className="row"><span>Showing {offset + 1}–{Math.min(offset + 100, scenarios.length)} of {scenarios.length}</span><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous labels</button><button disabled={offset + 100 >= scenarios.length} onClick={() => setOffset(offset + 100)}>Next labels</button></div>
    <div className="row"><button disabled={saving || Object.keys(edits).length === 0} onClick={() => void save()}>Save label changes</button><button disabled={saving || Object.keys(edits).length > 0} onClick={onContinue}>Continue to run</button></div>
  </div>;
}

export function GuidedClassification(props: {
  projectId: string; projects: { id: string; name: string }[]; suiteDraft: Draft | null; suiteDirty: boolean; workflowVersionId: string; suiteVersionId: string;
  run: Run | null; runs: Run[]; providerStatus: ProviderStatus | null;
  onLoadStarter: () => Promise<void>; onOpenProject: (id: string) => Promise<void>; onSuitePublished: (draft: Draft, version: Version) => void; onRunQueued: (id: string) => Promise<void>; onSelectRun: (id: string) => Promise<void>;
}) {
  const suite = props.suiteDraft?.definition as ClassificationSuite | undefined;
  const target = suite?.classification;
  const [step, setStep] = useState<"add" | "review" | "run" | "results">("add");
  const [paste, setPaste] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [importError, setImportError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"mock" | "live">("mock");
  const [selection, setSelection] = useState<"sample" | "all">("sample");
  const [sampleCount, setSampleCount] = useState(25);
  const [consent, setConsent] = useState(false);
  const [attemptLimit, setAttemptLimit] = useState(props.providerStatus?.defaultHttpAttemptLimit ?? 200);
  const [concurrency, setConcurrency] = useState(4);
  const [report, setReport] = useState<Report | null>(null);
  const [resultRows, setResultRows] = useState<RowPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [verdict, setVerdict] = useState("false_negative");
  const [review, setReview] = useState("");
  const [tag, setTag] = useState("");
  const [detail, setDetail] = useState<ResultRow | null>(null);
  const [trace, setTrace] = useState<unknown>(null);
  const [exportConsent, setExportConsent] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [publishedSuite, setPublishedSuite] = useState<{ id: string; definition: Suite } | null>(null);
  const [publishedError, setPublishedError] = useState("");
  const [judgmentsPerCase, setJudgmentsPerCase] = useState<number | null>(null);
  const [workflowError, setWorkflowError] = useState("");
  const detailRequest = useRef(0);
  const activeRunId = useRef(props.run?.id ?? "");
  activeRunId.current = props.run?.id ?? "";
  const scenarios = target && Array.isArray(suite?.scenarios)
    ? suite.scenarios.filter((scenario): scenario is Scenario => !!scenario && typeof scenario.id === "string")
    : [];
  useEffect(() => {
    if (scenarios.length > 0) setSampleCount((current) => Math.min(current, scenarios.length));
  }, [scenarios.length]);
  const sample = useMemo(() => sampleIds(scenarios, sampleCount), [scenarios, sampleCount]);
  const selectedIds = selection === "all" ? scenarios.map((scenario) => scenario.id) : sample;
  const selected = selectedIds;
  const missingMockFixtures = mode === "mock" && selectedIds.some((id) => id.startsWith("message_"));
  const publishedMatchesDraft = !!suite && !!publishedSuite && publishedSuite.id === props.suiteVersionId && !props.suiteDirty && JSON.stringify(suite) === JSON.stringify(publishedSuite.definition);
  useEffect(() => {
    let active = true;
    setPublishedSuite(null); setPublishedError("");
    if (props.suiteVersionId) void request<{ definition: Suite }>(`/suite-versions/${props.suiteVersionId}`).then((value) => { if (active) setPublishedSuite({ id: props.suiteVersionId, definition: value.definition }); }).catch((error) => { if (active) setPublishedError(String(error)); });
    return () => { active = false; };
  }, [props.suiteVersionId]);
  useEffect(() => {
    let active = true;
    setJudgmentsPerCase(null); setWorkflowError("");
    if (props.workflowVersionId) void request<Workflow>(`/workflow-versions/${props.workflowVersionId}/export`).then((workflow) => { if (active) setJudgmentsPerCase(workflow.nodes.filter((node) => node.kind === "judgment").length); }).catch((error) => { if (active) setWorkflowError(String(error)); });
    return () => { active = false; };
  }, [props.workflowVersionId]);
  useEffect(() => { detailRequest.current++; setDetail(null); setTrace(null); setReport(null); setResultRows(null); }, [props.run?.id]);
  useEffect(() => { detailRequest.current++; setDetail(null); setTrace(null); }, [verdict, review, tag, offset]);
  const sampleKey = `${props.suiteVersionId}:${sampleCount}`;
  useEffect(() => { if (target) { setStep("add"); setReviewDirty(false); } }, [props.projectId, target?.nodeId]);
  useEffect(() => { setConsent(false); }, [mode, selection, sampleKey]);
  useEffect(() => { if (props.providerStatus) setAttemptLimit(props.providerStatus.defaultHttpAttemptLimit); }, [props.providerStatus]);
  useEffect(() => {
    if (!props.run || !target) { setReport(null); setResultRows(null); return; }
    let active = true;
    void request<Report>(`/runs/${props.run.id}/classification`).then((value) => { if (active) setReport(value); }).catch((error) => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, [props.run?.id, props.run?.status, props.run?.progress.persisted, target?.nodeId]);
  useEffect(() => {
    if (!props.run || !target) return;
    let active = true;
    const query = new URLSearchParams({ offset: String(offset), limit: "50" });
    if (verdict) query.set("verdict", verdict);
    if (review) query.set("review", review);
    if (tag) query.set("tag", tag);
    void request<RowPage>(`/runs/${props.run.id}/classification/rows?${query}`).then((value) => { if (active) setResultRows(value); }).catch((error) => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, [props.run?.id, props.run?.status, props.run?.progress.persisted, target?.nodeId, offset, verdict, review, tag]);
  function stage(text: string, format: "lines" | "csv") {
    if (!target) return;
    try {
      const parsed = parseExamples(text, format, target.positiveLabel, target.negativeLabel);
      const seen = new Set(scenarios.map((scenario) => String((scenario.input as { content?: string }).content ?? "")));
      const checked = parsed.map((row) => {
        let issue = row.issue;
        if (!issue && !row.content.trim()) issue = "Message is empty.";
        if (!issue && row.content.length > 8000) issue = "Message exceeds 8,000 characters.";
        if (!issue && seen.has(row.content)) issue = "Duplicate message in this test set or import.";
        seen.add(row.content);
        return { ...row, issue };
      });
      setRows(checked); setPreviewOffset(0); setImportError(""); setStep("add");
    } catch (error) { setImportError(String(error)); setRows([]); }
  }
  async function saveRows() {
    if (!props.suiteDraft || !suite || !target || !props.workflowVersionId || !rows.length || rows.some((row) => row.issue)) return;
    setSaving(true); setMessage("");
    try {
      const ids = new Set(scenarios.map((scenario) => scenario.id));
      let nextNumber = scenarios.length + 1;
      const imported: Scenario[] = rows.map((row) => {
        let id: string;
        do { id = `message_${nextNumber++}`; } while (ids.has(id));
        ids.add(id);
        return { id, name: row.content.slice(0, 60), input: { content: row.content }, tags: row.tags,
          ...(row.label ? { referenceLabel: { value: row.label === "unclear" ? null : row.label, source: row.source, review: "provisional" as const } } : {}) };
      });
      const definition = { ...suite, scenarios: [...scenarios, ...imported] };
      if (definition.scenarios.length > 10000) throw new Error("A test set can contain at most 10,000 messages.");
      if (encodedBytes(definition) > 8 * 1024 * 1024) throw new Error("The test set exceeds the 8 MiB JSON limit.");
      for (const item of imported) if (encodedBytes(item.input) > 64 * 1024) throw new Error(`${item.id} exceeds the 64 KiB input limit.`);
      const saved = await request<Draft>(`/suites/${props.suiteDraft.id}/draft`, "PUT", { expectedRevision: props.suiteDraft.draftRevision, definition, workflowVersionId: props.workflowVersionId });
      const version = await request<Version>(`/suites/${saved.id}/versions`, "POST", { expectedRevision: saved.draftRevision, workflowVersionId: props.workflowVersionId });
      props.onSuitePublished(saved, version); setRows([]); setPaste(""); setStep("review"); setMessage(`Saved ${imported.length} messages and published the test set.`);
    } catch (error) { setMessage(`Save failed; imported rows are still here. ${String(error)}`); }
    finally { setSaving(false); }
  }
  async function saveReview(edits: Record<string, Reference | null>) {
    if (!props.suiteDraft || !suite || !props.workflowVersionId) return;
    setSaving(true); setMessage("");
    try {
      const definition = { ...suite, scenarios: scenarios.map((scenario) => Object.hasOwn(edits, scenario.id) ? { ...scenario, referenceLabel: edits[scenario.id] ?? undefined } : scenario) };
      const saved = await request<Draft>(`/suites/${props.suiteDraft.id}/draft`, "PUT", { expectedRevision: props.suiteDraft.draftRevision, definition, workflowVersionId: props.workflowVersionId });
      const version = await request<Version>(`/suites/${saved.id}/versions`, "POST", { expectedRevision: saved.draftRevision, workflowVersionId: props.workflowVersionId });
      props.onSuitePublished(saved, version);
      setMessage(`Saved ${Object.keys(edits).length} label changes and published the test set.`);
    } catch (error) { setMessage(`Label save failed. Your pending edits are still here. Reload the project before retrying a conflict. ${String(error)}`); throw error; }
    finally { setSaving(false); }
  }
  async function run() {
    if (!props.workflowVersionId || !props.suiteVersionId || !selected.length || !target || !publishedMatchesDraft || missingMockFixtures || mode === "live" && (!consent || !props.providerStatus?.allowedModes.includes("live") || judgmentsPerCase === null)) return;
    setMessage("");
    try {
      const latest = await request<{ definition: Suite }>(`/suite-versions/${props.suiteVersionId}`);
      if (JSON.stringify(latest.definition) !== JSON.stringify(suite)) throw new Error("The selected published test set differs from the current draft. Publish the reviewed draft before running.");
      const queued = await request<Run>("/runs", "POST", { workflowVersionId: props.workflowVersionId, suiteVersionId: props.suiteVersionId, selectedScenarioIds: selection === "sample" ? sample : scenarios.map((scenario) => scenario.id), mode,
        ...(mode === "mock" ? { fixtureSetId: "classification" } : { confirmLive: true, concurrency, httpAttemptLimit: attemptLimit }) });
      setConsent(false); await props.onRunQueued(queued.id); setStep("results");
    } catch (error) { setMessage(String(error)); }
  }
  async function exportData(format: "json" | "csv", copyPrompt = false) {
    if (!props.run || !exportConsent) return;
    try {
      const result = await request<Export>(`/runs/${props.run.id}/classification/export?format=${format}`);
      if (copyPrompt) {
        const parsed = JSON.parse(result.content) as { reviewPrompt?: string; prompt?: string };
        await navigator.clipboard.writeText(parsed.reviewPrompt ?? parsed.prompt ?? "Review this exported Pathsmith classification report. Cite row IDs for every finding.");
        setMessage("Review prompt copied. Paste it with the downloaded JSON into your chosen LLM.");
      } else {
        const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }));
        const link = document.createElement("a"); link.href = url; link.download = result.filename; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setExportConsent(false);
    } catch (error) { setMessage(String(error)); }
  }
  async function openDetail(row: ResultRow) {
    const runId = props.run?.id ?? "";
    const generation = ++detailRequest.current;
    setDetail(row); setTrace(null);
    if (!row.traceId) return;
    try {
      const loaded = await request(`/scenario-runs/${row.traceId}/trace`);
      if (detailRequest.current === generation && activeRunId.current === runId) setTrace(loaded);
    } catch (error) { if (detailRequest.current === generation && activeRunId.current === runId) setMessage(String(error)); }
  }
  const previewErrors = rows.filter((row) => row.issue);
  return <section className="guided" aria-label="Guided classification test">
    <div className="guided-heading"><div><span className="eyebrow">M5 · CLASSIFICATION TESTS</span><h2>Test a classifier on real examples</h2><p>Add messages, check the expected answers, then run a sample or the full test set.</p></div><div className="guided-project"><button onClick={() => void props.onLoadStarter()}>Start chat abuse example</button><label>Open classification project <select value={props.projectId} onChange={(event) => void props.onOpenProject(event.target.value)}><option value="">Select project</option>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div></div>
    {message && <p className="notice" role="status">{message}</p>}
    {!target ? <p className="hint">Start the classification example or open a saved classification project. Other workflows remain available in Advanced.</p> : <>
      <nav className="guided-steps" aria-label="Test steps">{(["add", "review", "run", "results"] as const).map((item, index) => <button key={item} className={step === item ? "current" : ""} disabled={step === "review" && reviewDirty && item !== "review"} onClick={() => setStep(item)}>{index + 1}. {item === "add" ? "Add examples" : item === "review" ? "Review labels" : item === "run" ? "Run test" : "Results"}</button>)}</nav>
      {step === "add" && <div className="guided-body"><h3>Add messages</h3><p>Paste one message per line, or import CSV with <code>content</code> and optional <code>expected_label</code>, <code>source</code>, and <code>tags</code> columns. Separate tags with <code>|</code>.</p><label className="field">Paste messages<textarea aria-label="Paste messages" value={paste} onChange={(event) => setPaste(event.target.value)} rows={7} placeholder="One message per line" /></label><div className="row"><button onClick={() => stage(paste, "lines")}>Preview pasted messages</button><label className="button">Import CSV<input aria-label="Import CSV" type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((text) => stage(text, "csv")); event.target.value = ""; }} /></label></div>{importError && <p role="alert" className="notice conflict">{importError}</p>}{rows.length > 0 && <><h4>Preview: {rows.length} messages · {previewErrors.length} need attention</h4><p>Existing test set: {scenarios.length} messages. Nothing is saved until you select Add to test set.</p><div className="guided-table-wrap"><table><thead><tr><th>Message</th><th>Expected answer</th><th>Source</th><th>Tags</th><th>Issue</th></tr></thead><tbody>{rows.slice(previewOffset, previewOffset + 100).map((row, index) => <tr key={previewOffset + index}><td>{row.content}</td><td><select aria-label={`Imported row ${previewOffset + index + 1} label`} value={row.label} onChange={(event) => setRows(rows.map((item, i) => i === previewOffset + index ? { ...item, label: event.target.value, issue: item.issue.startsWith("Unknown label:") ? "" : item.issue } : item))}><option value="">No label</option><option value={target.positiveLabel}>{target.positiveLabel}</option><option value={target.negativeLabel}>{target.negativeLabel}</option><option value="unclear">Unclear</option></select></td><td>{row.source}</td><td>{row.tags.join(", ")}</td><td>{row.issue || "Ready"}</td></tr>)}</tbody></table></div>{rows.length > 100 && <div className="row"><span>Showing {previewOffset + 1}–{Math.min(previewOffset + 100, rows.length)} of {rows.length}</span><button disabled={previewOffset === 0} onClick={() => setPreviewOffset(Math.max(0, previewOffset - 100))}>Previous preview rows</button><button disabled={previewOffset + 100 >= rows.length} onClick={() => setPreviewOffset(previewOffset + 100)}>Next preview rows</button></div>}{previewErrors.length > 0 && <details><summary>Flagged rows ({previewErrors.length})</summary><ul>{rows.map((row, index) => row.issue ? <li key={index}><button onClick={() => setPreviewOffset(Math.floor(index / 100) * 100)}>Row {index + 1}: {row.issue}</button></li> : null)}</ul></details>}<button disabled={!previewErrors.length} onClick={() => setRows(rows.filter((row) => !row.issue))}>Remove flagged rows</button><button disabled={saving || previewErrors.length > 0 || scenarios.length + rows.length > 10000} onClick={() => void saveRows()}>Add {rows.length} to test set</button></>}</div>}
      {step === "review" && <LabelReview key={props.projectId} scenarios={scenarios} target={target} saving={saving} onSave={saveReview} onContinue={() => setStep("run")} onDirty={setReviewDirty} />}
      {step === "run" && <div className="guided-body"><h3>Run test</h3><p>Choose a sample first to check setup, then run the full set. The sample spreads evenly across the saved messages and keeps their IDs in the run record.</p><div className="row"><label>Selection<select aria-label="Test selection" value={selection} onChange={(event) => setSelection(event.target.value as "sample" | "all")}><option value="sample">Sample</option><option value="all">Full test set</option></select></label>{selection === "sample" && <label>Sample size<input aria-label="Sample size" type="number" min="1" max={scenarios.length} value={sampleCount} onChange={(event) => setSampleCount(Math.max(1, Math.min(scenarios.length, Number(event.target.value) || 1)))} /></label>}<label>Mode<select aria-label="Guided run mode" value={mode} onChange={(event) => setMode(event.target.value as "mock" | "live")}><option value="mock">Mock, offline</option><option value="live">Live Jev</option></select></label></div><p><strong>{selected.length} messages selected.</strong> {selection === "sample" && sample.length > 0 ? `First IDs: ${sample.slice(0, 5).join(", ")}${sample.length > 5 ? "…" : ""}.` : ""} Published test set version {props.suiteVersionId.slice(0, 8) || "unavailable"}.</p>{!publishedMatchesDraft && <p role="alert" className="notice conflict">The reviewed draft and selected published test set differ, or the version is still loading. Save and publish the current test set in Advanced before running. {publishedError}</p>}{mode === "mock" && <p className="hint">Mock mode has exact answers for the eight starter messages only. Imported messages need an explicit live Jev run or a matching fixture set added outside this screen.</p>}{missingMockFixtures && <p role="alert" className="notice conflict">This selection includes imported messages without mock fixtures. Choose Live Jev with explicit consent, or add matching fixtures before running offline.</p>}{mode === "live" && <div className="live-preflight"><h4>Live Jev check</h4><p>Messages and the classification question leave this computer. Provider usage may be billed. Token cost is unknown before the run.</p><p>Requested model default: {props.providerStatus?.providers.find((provider) => provider.id === "jev")?.defaultModel ?? "unknown"} · {selected.length} messages · up to {judgmentsPerCase === null ? "N/A" : selected.length * judgmentsPerCase} logical calls and {judgmentsPerCase === null ? "N/A" : selected.length * judgmentsPerCase * 3} transport attempts, using the published workflow's {judgmentsPerCase ?? "N/A"} judgment nodes as a conservative cap · concurrency {concurrency} · hard attempt budget {attemptLimit}</p>{workflowError && <p role="alert">Published workflow preflight failed: {workflowError}</p>}{!props.providerStatus?.allowedModes.includes("live") && <p role="alert">Live mode is unavailable. Configure the server live flag and Jev key.</p>}<div className="row"><label>Concurrency<input aria-label="Guided concurrency" type="number" min="1" max="4" value={concurrency} onChange={(event) => setConcurrency(Math.max(1, Math.min(4, Number(event.target.value) || 1)))} /></label><label>Maximum HTTP attempts<input aria-label="Guided attempt limit" type="number" min="1" max={props.providerStatus?.maximumHttpAttemptLimit ?? 30000} value={attemptLimit} onChange={(event) => setAttemptLimit(Math.max(1, Math.min(props.providerStatus?.maximumHttpAttemptLimit ?? 30000, Number(event.target.value) || 1)))} /></label></div>{judgmentsPerCase !== null && selected.length * judgmentsPerCase * 3 > attemptLimit && <p className="notice conflict">The conservative maximum exceeds the budget. Some messages may remain unrun if retries exhaust it.</p>}<label className="check"><input type="checkbox" aria-label="Confirm guided live run" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I agree to send these messages and the question to Jev and accept possible usage charges.</label></div>}<button disabled={!selected.length || !props.suiteVersionId || saving || !publishedMatchesDraft || missingMockFixtures || mode === "live" && (!consent || !props.providerStatus?.allowedModes.includes("live") || judgmentsPerCase === null)} onClick={() => void run()}>Run {selected.length} messages</button></div>}
      {step === "results" && <div className="guided-body"><h3>Results</h3><div className="row"><label>Saved run<select aria-label="Classification run" value={props.run?.id ?? ""} onChange={(event) => void props.onSelectRun(event.target.value)}><option value="">Select run</option>{props.runs.map((item) => <option key={item.id} value={item.id}>{item.status} · {item.mode} · {item.id.slice(0, 8)}</option>)}</select></label></div>{props.run && !report && <p>Loading report…</p>}{report && <><p className={report.partial ? "notice conflict" : "hint"}>Run {report.status} · {report.mode} · {report.origin} · {report.partial ? "Partial report: pending, failed, and unrun messages are separate from classification results." : "Complete report."} {report.error ? `${report.error.code}: ${report.error.message}` : ""}</p>{report.mixedModel && <p role="alert" className="notice conflict">Multiple resolved model versions were observed. Treat comparisons as mixed-model evidence.</p>}{report.adapters && <div className="provenance"><strong>Model provenance</strong>{Object.entries(report.adapters).map(([binding, adapter]) => <p key={binding}>{binding}: {adapter.providerId} · requested {adapter.requestedModel} · actual {adapter.resolvedModels?.length ? adapter.resolvedModels.join(", ") : "unknown until response"}</p>)}</div>}<div className="metric-grid"><div><strong>{report.summary.all.falseNegative}</strong><span>Missed abuse</span></div><div><strong>{report.summary.all.falsePositive}</strong><span>Harmless flagged</span></div><div><strong>{report.summary.all.truePositive + report.summary.all.trueNegative}</strong><span>Agreements</span></div><div><strong>{report.summary.all.errors + report.summary.all.canceled + report.summary.all.interrupted + report.summary.all.pending + report.summary.all.notRun}</strong><span>Failed or unfinished</span></div></div><div className="report-grid"><div><h4>Reviewed labels</h4><p>Agreement {rateText(report.summary.reviewed.agreement)} · {report.summary.reviewed.evaluated} evaluated</p></div><div><h4>Provisional labels</h4><p>Agreement {rateText(report.summary.provisional.agreement)} · {report.summary.provisional.evaluated} evaluated</p></div></div><p>All labeled: {report.summary.all.labeled} · Unclear: {report.summary.all.unclear} · Unlabeled: {report.summary.all.unlabeled} · Missing prediction: {report.summary.all.missingPrediction} · Actual HTTP attempts: {report.execution.actualHttpAttempts}. N/A means no valid denominator.</p>{report.summary.slices.length > 0 && <details><summary>Results by tag</summary><ul>{report.summary.slices.map((slice) => <li key={slice.tag}>{slice.tag}: {rateText(slice.all.agreement)} agreement · {slice.all.selected} selected</li>)}</ul></details>}<div className="row"><label>Show<select aria-label="Result verdict" value={verdict} onChange={(event) => { setVerdict(event.target.value); setOffset(0); }}><option value="">All results</option><option value="false_negative">Missed abuse</option><option value="false_positive">Harmless flagged</option><option value="true_positive">Correct abuse</option><option value="true_negative">Correct harmless</option><option value="error">Errors</option></select></label><label>Labels<select aria-label="Result review" value={review} onChange={(event) => { setReview(event.target.value); setOffset(0); }}><option value="">All label states</option><option value="reviewed">Reviewed</option><option value="provisional">Provisional</option></select></label><label>Tag<input aria-label="Result tag" value={tag} onChange={(event) => { setTag(event.target.value); setOffset(0); }} /></label></div>{resultRows && <><p>{resultRows.total} matching messages · showing {offset + 1}–{offset + resultRows.items.length}</p><div className="guided-table-wrap"><table><thead><tr><th>Message</th><th>Expected</th><th>Jev answer</th><th>Finding</th></tr></thead><tbody>{resultRows.items.map((row) => <tr key={row.scenarioId}><td><button className="text-button" onClick={() => void openDetail(row)}>{row.input?.content ?? row.name}</button></td><td>{row.referenceLabel?.value ?? "N/A"} {row.referenceLabel?.review === "provisional" ? "· provisional" : row.referenceLabel?.review === "reviewed" ? "· reviewed" : ""}</td><td>{row.predictedLabel ?? "N/A"}</td><td>{row.verdict.replaceAll("_", " ")}{row.errorCode ? ` · ${row.errorCode}` : ""}</td></tr>)}</tbody></table></div><div className="row"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><button disabled={offset + resultRows.items.length >= resultRows.total} onClick={() => setOffset(offset + 50)}>Next</button></div></>}{detail && <div className="trace"><h4>{detail.name}</h4><p>Expected {detail.referenceLabel?.value ?? "N/A"} · predicted {detail.predictedLabel ?? "N/A"} · {detail.verdict}</p><pre>{trace ? JSON.stringify(trace, null, 2) : detail.traceId ? "Loading saved trace…" : "No trace was saved for this message."}</pre></div>}<div className="export-warning"><label className="check"><input type="checkbox" checked={exportConsent} onChange={(event) => setExportConsent(event.target.checked)} /> I understand exports include message text and model answers.</label><div className="row"><button disabled={!exportConsent} onClick={() => void exportData("csv")}>Download CSV</button><button disabled={!exportConsent} onClick={() => void exportData("json")}>Download JSON</button><button disabled={!exportConsent} onClick={() => void exportData("json", true)}>Copy LLM review prompt</button></div></div></>}</div>}
    </>}
  </section>;
}
