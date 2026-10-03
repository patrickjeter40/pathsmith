import { useEffect, useMemo, useRef, useState } from "react";
import { downloadText, query, request } from "./apiClient";
import { Icon, ModeBadge, Panel, StatusPill } from "./ScreenUi";
import { SavedTrace, type SavedTraceResult } from "./SavedTrace";
import { WorkflowEditor } from "./WorkflowEditor";
import type { ClassificationReport, Page, ResultRow, Run, Scoring, Snapshot } from "./screenTypes";

type CaseRun = { id: string; scenarioId: string; result: { started?: boolean; status: string; assertionStatus: string; result?: { outcomeId: string; value: unknown }; error?: { code: string; message: string }; assertions: { label?: string; passed?: boolean; kind?: string; message?: string }[]; visitedNodes: string[]; selectedEdges: string[] } };
type Trace = SavedTraceResult;
type TraceRecord = { id: string; runId: string; scenarioId: string; position: number; result: Trace };
type GroupKey = "missed_positive" | "false_alarm" | "unknown" | "error";
const groupDefs: { key: GroupKey; label: string; kind: "regress" | "warn" | "unknown" | "error" }[] = [
  { key: "missed_positive", label: "Missed positives", kind: "regress" },
  { key: "false_alarm", label: "False alarms", kind: "warn" },
  { key: "unknown", label: "Unclear / provisional references", kind: "unknown" },
  { key: "error", label: "Execution errors", kind: "error" },
];
type Props = {
  run: Run | null; runs: Run[]; snapshot: Snapshot | null; caseRuns: CaseRun[]; caseTotal: number; focusCaseId?: string;
  scoreVersionId: string; startedRunId: string;
  onSelectRun: (id: string) => Promise<void>; onCancelRun: () => Promise<void>; onLoadMoreCases: () => Promise<void>;
  onReviewLabel: (caseId: string) => void; onConfigureRun: (run: Run, latest: boolean) => void;
  onCompare: (id: string) => void; onUseOriginalLabels: () => void; onViewWorkflow: (scenarioId: string, traceId?: string | null) => void; onResume: (run: Run) => void;
};
const terminal = (status: string) => ["completed", "failed", "canceled", "interrupted"].includes(status);
const verdictMeta = (value: string): { label: string; kind: "success" | "regress" | "error" | "warn" | "unknown" | "unvisited" } => {
  if (["agree", "true_positive", "true_negative"].includes(value)) return { label: "Agrees", kind: "success" };
  if (["missed_positive", "false_negative"].includes(value)) return { label: "Missed positive", kind: "regress" };
  if (["false_alarm", "false_positive"].includes(value)) return { label: "False alarm", kind: "warn" };
  if (value === "error") return { label: "Execution error", kind: "error" };
  if (value === "not_run") return { label: "Not run", kind: "unvisited" };
  return { label: value.replaceAll("_", " "), kind: "unknown" };
};
const inputText = (value: unknown, fallback: string) => {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).content === "string") return (value as { content: string }).content;
  return value === undefined ? fallback : typeof value === "string" ? value : JSON.stringify(value);
};
const referenceState = (row: ResultRow) => !row.referenceLabel ? "unlabeled" : row.referenceLabel.value === null ? `unclear · ${row.referenceLabel.review}` : `${row.referenceLabel.review} · ${row.referenceLabel.source}`;
export function ResultsScreen(props: Props) {
  const { run, snapshot } = props;
  const classification = !!snapshot?.suite.classification;
  const [report, setReport] = useState<ClassificationReport | null>(null);
  const [rows, setRows] = useState<Page<ResultRow> | null>(null);
  const [reportError, setReportError] = useState("");
  const [rowsError, setRowsError] = useState("");
  const [offset, setOffset] = useState(0);
  const [quick, setQuick] = useState("");
  const [verdict, setVerdict] = useState("");
  const [review, setReview] = useState("");
  const [tag, setTag] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [pinnedRow, setPinnedRow] = useState<ResultRow | null>(null);
  const [focusedGeneric, setFocusedGeneric] = useState<CaseRun | null>(null);
  const [genericFocusLoading, setGenericFocusLoading] = useState(false);
  const [offPageRow, setOffPageRow] = useState<ResultRow | null>(null);
  const [groupPages, setGroupPages] = useState<Record<GroupKey, Page<ResultRow>> | null>(null);
  const [groupError, setGroupError] = useState("");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [traceError, setTraceError] = useState("");
  const [exportAck, setExportAck] = useState(false);
  const [dismissedStart, setDismissedStart] = useState("");
  const reportRequest = useRef(0);
  const groupRequest = useRef(0);
  const rowsRequest = useRef(0);
  const traceRequest = useRef(0);
  const offPageRequest = useRef(0);
  const focusRequest = useRef(0);
  const genericFocusRequest = useRef(0);
  const appliedGenericFocus = useRef("");
  const scoringQuery = props.scoreVersionId && props.scoreVersionId !== run?.suiteVersionId ? props.scoreVersionId : "";
  useEffect(() => { setOffset(0); setSelectedId(""); setPinnedRow(null); setOffPageRow(null); setTrace(null); setExportAck(false); }, [run?.id, scoringQuery]);
  useEffect(() => { if (!classification && props.focusCaseId && snapshot?.selectedScenarioIds.includes(props.focusCaseId)) { appliedGenericFocus.current = `${run?.id}:${props.focusCaseId}`; setSelectedId(props.focusCaseId); } }, [classification, props.focusCaseId, run?.id, snapshot]);
  useEffect(() => {
    const generation = ++genericFocusRequest.current;
    setFocusedGeneric(null); setGenericFocusLoading(false);
    const id = props.focusCaseId;
    if (!run || classification || !snapshot || !id || !snapshot.selectedScenarioIds.includes(id)) return;
    if (props.caseRuns.some((item) => item.scenarioId === id)) return;
    setGenericFocusLoading(true);
    void (async () => {
      for (let offset = 0; offset < Math.min(run.progress.persisted, snapshot.selectedScenarioIds.length); offset += 100) {
        const page = await request<Page<CaseRun>>(`/runs/${run.id}/scenarios?offset=${offset}&limit=100`);
        if (genericFocusRequest.current !== generation) return;
        const found = page.items.find((item) => item.scenarioId === id);
        if (found) { setFocusedGeneric(found); return; }
        if (page.items.length < 100 || offset + page.items.length >= page.total) return;
      }
    })().catch(() => { /* A missing saved result remains pending in the detail view. */ }).finally(() => { if (genericFocusRequest.current === generation) setGenericFocusLoading(false); });
    return () => { genericFocusRequest.current++; };
  }, [props.focusCaseId, props.caseRuns, run?.id, run?.progress.persisted, classification, snapshot, scoringQuery]);
  useEffect(() => {
    const generation = ++focusRequest.current;
    const id = props.focusCaseId;
    if (!run || !classification || !snapshot || !id) return;
    const selected = new Set(snapshot.selectedScenarioIds);
    const position = snapshot.suite.scenarios.filter((item) => selected.has(item.id)).findIndex((item) => item.id === id);
    if (position < 0) return;
    const params = query({ offset: position, limit: 1, labelsSuiteVersionId: scoringQuery });
    void request<Page<ResultRow>>(`/runs/${run.id}/classification/rows?${params}`).then((page) => {
      if (focusRequest.current === generation && page.items[0]?.scenarioId === id) { setSelectedId(id); setPinnedRow(page.items[0]); document.getElementById("results-detail")?.scrollIntoView({ block: "nearest" }); }
    }).catch(() => { /* The normal rows error state reports incompatible scoring. */ });
    return () => { focusRequest.current++; };
  }, [props.focusCaseId, run?.id, scoringQuery, classification, snapshot]);
  useEffect(() => { setOffset(0); }, [quick, verdict, review, tag]);
  useEffect(() => {
    const generation = ++reportRequest.current;
    setReport(null); setReportError("");
    if (!run || !classification) return;
    const suffix = query({ labelsSuiteVersionId: scoringQuery });
    void request<ClassificationReport>(`/runs/${run.id}/classification${suffix ? `?${suffix}` : ""}`).then((value) => { if (generation === reportRequest.current) setReport(value); }).catch((error) => { if (generation === reportRequest.current) setReportError(String(error)); });
    return () => { reportRequest.current++; };
  }, [run?.id, run?.status, run?.progress.persisted, classification, scoringQuery]);
  useEffect(() => {
    const generation = ++rowsRequest.current;
    setRows(null); setRowsError("");
    if (!run || !classification) return;
    const params = query({ offset, limit: 50, reviewedVerdict: quick, verdict, review, tag, labelsSuiteVersionId: scoringQuery });
    void request<Page<ResultRow>>(`/runs/${run.id}/classification/rows?${params}`).then((value) => { if (generation === rowsRequest.current) setRows(value); }).catch((error) => { if (generation === rowsRequest.current) setRowsError(String(error)); });
    return () => { rowsRequest.current++; };
  }, [run?.id, run?.status, run?.progress.persisted, classification, scoringQuery, offset, quick, verdict, review, tag]);
  useEffect(() => {
    const generation = ++groupRequest.current;
    setGroupPages(null); setGroupError("");
    if (!run || !classification) return;
    void Promise.all(groupDefs.map(async (group) => {
      const params = query({ offset: 0, limit: 3, reviewedVerdict: group.key, labelsSuiteVersionId: scoringQuery });
      return [group.key, await request<Page<ResultRow>>(`/runs/${run.id}/classification/rows?${params}`)] as const;
    })).then((pairs) => { if (generation === groupRequest.current) setGroupPages(Object.fromEntries(pairs) as Record<GroupKey, Page<ResultRow>>); })
      .catch((error) => { if (generation === groupRequest.current) setGroupError(String(error)); });
    return () => { groupRequest.current++; };
  }, [run?.id, run?.status, run?.progress.persisted, classification, scoringQuery]);
  useEffect(() => {
    const generation = ++offPageRequest.current;
    if (!run || !classification || !selectedId || !rows || rows.items.some((row) => row.scenarioId === selectedId)) return;
    const selected = new Set(snapshot?.selectedScenarioIds ?? []);
    const position = snapshot?.suite.scenarios.filter((item) => selected.has(item.id)).findIndex((item) => item.id === selectedId) ?? -1;
    if (position < 0) return;
    const params = query({ offset: position, limit: 1, labelsSuiteVersionId: scoringQuery });
    void request<Page<ResultRow>>(`/runs/${run.id}/classification/rows?${params}`).then((page) => {
      if (generation === offPageRequest.current && page.items[0]?.scenarioId === selectedId) setOffPageRow(page.items[0]);
    }).catch(() => { /* The pinned evidence remains visible until the next successful poll. */ });
    return () => { offPageRequest.current++; };
  }, [run?.id, run?.status, run?.progress.persisted, classification, scoringQuery, selectedId, rows, snapshot]);
  const selected = useMemo(() => {
    if (!selectedId) return rows?.items[0] ?? null;
    return rows?.items.find((row) => row.scenarioId === selectedId) ?? (offPageRow?.scenarioId === selectedId ? offPageRow : null) ?? (pinnedRow?.scenarioId === selectedId ? pinnedRow : null);
  }, [rows, selectedId, pinnedRow, offPageRow]);
  const inspect = (row: ResultRow) => { setSelectedId(row.scenarioId); setPinnedRow(row); setOffPageRow(null); document.getElementById("results-detail")?.scrollIntoView({ block: "nearest" }); };
  const activateQuick = (key: string) => { setQuick(key); setVerdict(""); setReview(""); setTag(""); setOffset(0); };
  const genericSelectedId = !classification && props.focusCaseId && appliedGenericFocus.current !== `${run?.id}:${props.focusCaseId}`
    ? props.focusCaseId : (selected?.scenarioId ?? selectedId) || props.focusCaseId;
  const selectedCaseRun = props.caseRuns.find((item) => item.scenarioId === genericSelectedId) ?? (focusedGeneric?.scenarioId === genericSelectedId ? focusedGeneric : null) ?? (!classification && !genericSelectedId ? props.caseRuns[0] : undefined);
  useEffect(() => {
    const generation = ++traceRequest.current;
    setTrace(null); setTraceError("");
    const traceId = selected?.traceId ?? selectedCaseRun?.id;
    if (!traceId) return;
    void request<TraceRecord>(`/scenario-runs/${traceId}/trace`).then((value) => {
      if (generation === traceRequest.current && value.id === traceId && value.runId === run?.id && value.scenarioId === (selected?.scenarioId ?? selectedCaseRun?.scenarioId)) setTrace(value.result);
    }).catch((error) => { if (generation === traceRequest.current) setTraceError(String(error)); });
    return () => { traceRequest.current++; };
  }, [run?.id, selected?.scenarioId, selected?.traceId, selectedCaseRun?.id]);
  async function exportClassification(format: "json" | "csv") {
    if (!run || !exportAck) return;
    try {
      const params = query({ format, labelsSuiteVersionId: scoringQuery });
      const result = await request<{ filename: string; mediaType: string; content: string; scoring: Scoring }>(`/runs/${run.id}/classification/export?${params}`);
      downloadText(result.content, result.filename, result.mediaType); setExportAck(false);
    } catch (error) { setReportError(String(error)); }
  }
  if (!run) return <div className="results-screen"><div className="screen-top"><div><h2>Results</h2><p>Select a saved run to inspect actual case results.</p></div></div>{props.runs.length ? <div className="results-run-picker"><label>Saved run<select aria-label="Saved run" value="" onChange={(event) => void props.onSelectRun(event.target.value)}><option value="">Choose a run</option>{props.runs.map((item) => <option key={item.id} value={item.id}>{item.id.slice(0, 8)} · {item.mode} · {item.status}</option>)}</select></label></div> : <div className="screen-empty">No runs in this project yet. Configure a run in Test set.</div>}</div>;
  return <div className="results-screen">
    <div className="screen-top results-head"><div><h2>Results · <code>{run.id.slice(0, 8)}</code></h2><p><ModeBadge mode={run.mode} /> <span>workflow <code>{run.workflowVersionId.slice(0, 8)}</code></span><span>·</span><span>test set <code>{run.suiteName} {run.suiteVersionId.slice(0, 8)}</code></span><span>·</span><span className="model-identity">{run.adapters && Object.values(run.adapters).length ? Object.values(run.adapters).map((item) => `${item.providerId}/${item.requestedModel}`).join(", ") : run.mode === "mock" ? "Exact mock responses" : "Model identity unavailable"}</span></p></div><div className="inline-actions"><label className="compact-select">Run<select aria-label="Saved run" value={run.id} onChange={(event) => void props.onSelectRun(event.target.value)}>{props.runs.map((item) => <option key={item.id} value={item.id}>{item.id.slice(0, 8)} · {item.mode} · {item.status}</option>)}</select></label><button onClick={() => props.onConfigureRun(run, true)}>Re-run latest versions</button><button onClick={() => props.onCompare(run.id)}>Compare with baseline</button></div></div>
    {props.startedRunId === run.id && dismissedStart !== run.id && <div className={`started-notice ${run.mode === "live" ? "started-notice-live" : ""}`} role="status"><div><ModeBadge mode={run.mode} /><strong>Started {run.id.slice(0, 8)}</strong><StatusPill kind={run.status === "completed" ? "success" : terminal(run.status) ? "warn" : "accent"}>{run.status}</StatusPill></div><p>{run.progress.persisted} of {run.progress.selected} case results persisted. {run.progress.pending} pending. Results below belong to this run.</p><div className="inline-actions"><button onClick={() => document.getElementById("results-cases")?.scrollIntoView()}>Review this run</button><button onClick={() => props.onCompare(run.id)}>Compare</button><button onClick={() => props.onConfigureRun(run, false)}>Change run setup</button><button onClick={() => setDismissedStart(run.id)}>Dismiss</button></div></div>}
    {run.stopReason && <p className="screen-banner tone-warn" role="alert"><Icon name="alert" />Stopped at {run.stopReason.code.replaceAll("_", " ").toLowerCase()}. Completed results remain saved; unfinished cases are separate.</p>}
    {run.error && <p className="screen-banner tone-error" role="alert"><Icon name="bang" />{run.error.code}: {run.error.message}</p>}
    {run.mixedModel && <p className="screen-banner tone-warn" role="alert"><Icon name="alert" />Multiple resolved model versions were observed. Check provenance before comparing.</p>}
    {scoringQuery && <div className="screen-banner"><Icon name={report ? "check" : "alert"} /><span>{report ? <>Re-scored against published labels <code>{report.scoring.labelsSuiteVersionId.slice(0, 8)}</code> · {report.scoring.changedReferenceCount} references changed. Saved predictions and traces are unchanged; no provider calls were made.</> : <>Viewing requested label version <code>{scoringQuery.slice(0, 8)}</code>. {reportError ? "This version cannot score the selected run; the original view is still available." : "Checking compatibility with this run…"}</>}</span><button onClick={props.onUseOriginalLabels}>Use original labels</button></div>}
    {reportError && <p className="screen-banner tone-error" role="alert">{reportError}</p>}
    <div className="results-grid"><div className="results-main">
      {classification && <>
        <Panel title="Cases needing review"><div className="review-groups">
          {groupPages ? groupDefs.map((group) => { const page = groupPages[group.key]; return <div className="review-group" key={group.key}>
            <button className="review-group-heading" onClick={() => { setQuick(group.key); setVerdict(""); setReview(group.key === "missed_positive" || group.key === "false_alarm" ? "reviewed" : ""); setTag(""); setOffset(0); document.getElementById("results-cases")?.scrollIntoView(); }}><StatusPill kind={group.kind}>{group.label}</StatusPill><strong>{page.total}</strong></button>
            {page.items.length ? <ul>{page.items.map((row) => <li key={row.scenarioId}><button className="review-preview" onClick={() => inspect(row)}><code>{row.scenarioId}</code><span>{inputText(row.input, row.name)}</span><small>{referenceState(row)}</small><em>Inspect trace</em></button></li>)}</ul> : <p className="subtle">No cases in this group.</p>}
            {page.total > page.items.length && <button className="review-group-more" onClick={() => { setQuick(group.key); setVerdict(""); setReview(group.key === "missed_positive" || group.key === "false_alarm" ? "reviewed" : ""); setTag(""); setOffset(0); document.getElementById("results-cases")?.scrollIntoView(); }}>View all {page.total} cases</button>}
          </div>; }) : <p className="screen-empty-small">{groupError || reportError || "Loading saved review groups…"}</p>}
        </div></Panel>
        <section className="results-summary-joined" aria-label="Run summary">{report ? <><div className="results-summary-counts"><div><small>Completed</small><strong>{report.summary.all.completed}<span>/{report.selected}</span></strong></div><div><small>Errors</small><strong>{report.summary.all.errors}</strong></div><div><small>Not run</small><strong>{report.summary.all.notRun}</strong></div><div><small>Selected</small><strong>{report.selected}</strong></div></div><div className="results-summary-rates"><div><span>Reviewed agreement <code>{report.summary.reviewed.agreement.numerator} of {report.summary.reviewed.agreement.denominator} evaluated</code></span><strong>{report.summary.reviewed.agreement.denominator ? `${Math.round(100 * report.summary.reviewed.agreement.numerator / report.summary.reviewed.agreement.denominator)}%` : "N/A"}</strong><div className="rate-track"><i style={{ width: `${report.summary.reviewed.agreement.denominator ? 100 * report.summary.reviewed.agreement.numerator / report.summary.reviewed.agreement.denominator : 0}%` }} /></div></div><div><span>Unreviewed references <code>{report.selected - report.summary.reviewed.selected} of {report.selected}</code></span><strong>{report.selected ? `${Math.round(100 * (report.selected - report.summary.reviewed.selected) / report.selected)}%` : "N/A"}</strong><div className="rate-track unknown"><i style={{ width: `${report.selected ? 100 * (report.selected - report.summary.reviewed.selected) / report.selected : 0}%` }} /></div></div></div><p>{report.summary.reviewed.selected} of {report.selected} selected cases have reviewed references. Unreviewed includes provisional and unlabeled references; not run can overlap execution states.</p></> : <p className="screen-empty-small">{reportError || "Loading measured summary…"}</p>}</section>
        {report && <details className="secondary-tools"><summary>Detailed scoring and tag slices</summary><p>Provisional agreement: {report.summary.provisional.agreement.denominator ? `${report.summary.provisional.agreement.numerator} of ${report.summary.provisional.agreement.denominator}` : "N/A"} · unverified labels. Unclear references: {report.summary.all.unclear}; unlabeled: {report.summary.all.unlabeled}.</p>{report.summary.slices.length ? <ul>{report.summary.slices.map((slice) => <li key={slice.tag}><code>{slice.tag}</code> · {slice.all.selected} selected · {slice.all.completed} completed · {slice.all.errors} errors</li>)}</ul> : <p>No tag slices saved.</p>}</details>}
      </>}
      {!classification && <Panel title="Run summary"><div className="count-strip generic"><div><small>Completed</small><strong>{run.summary.completed}</strong></div><div><small>Execution failures</small><strong>{run.summary.failedExecution}</strong></div><div><small>Not run</small><strong>{run.summary.notRun ?? "unknown"}</strong></div><div><small>Selected</small><strong>{run.progress.selected}</strong></div><p>Assertions: {run.summary.assertionPassed} passed · {run.summary.assertionFailed} failed. Not run can overlap historical canceled or interrupted execution states.</p></div></Panel>}
      <Panel title={<>All cases {classification && <code>{rows?.total ?? "…"}</code>}</>} className="results-cases-panel"><div id="results-cases" className="results-table-wrap">{classification ? <><div className="result-quickfilters" role="group" aria-label="Filter cases">{([ ["", "All"], ["missed_positive", "Missed"], ["false_alarm", "False alarms"], ["error", "Errors"], ["agree", "Agrees"] ] as const).map(([key, label]) => <button key={label} aria-pressed={quick === key} onClick={() => activateQuick(key)}>{label}</button>)}</div><details className="result-detail-filters"><summary>Detailed filters</summary><div className="results-filters"><label>Raw verdict<select aria-label="Result verdict" value={verdict} onChange={(event) => setVerdict(event.target.value)}><option value="">All raw verdicts</option>{["false_negative", "false_positive", "true_positive", "true_negative", "unlabeled", "unclear", "error", "not_run", "missing_prediction"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label><label>Review<select aria-label="Result review" value={review} onChange={(event) => setReview(event.target.value)}><option value="">All labels</option><option value="reviewed">Reviewed</option><option value="provisional">Provisional</option></select></label><label>Tag<input aria-label="Result tag" value={tag} onChange={(event) => setTag(event.target.value)} /></label></div></details>{rowsError && <p role="alert" className="tone-error">{rowsError}</p>}{rows ? <><table className="results-table"><thead><tr><th>Case</th><th>Input</th><th>Reference</th><th>Prediction</th><th>Finding</th></tr></thead><tbody>{rows.items.map((item) => { const meta = verdictMeta(item.reviewedVerdict); return <tr key={item.scenarioId} className={selected?.scenarioId === item.scenarioId ? "selected" : ""}><td><button onClick={() => inspect(item)}><code>{item.scenarioId}</code></button></td><td><button onClick={() => inspect(item)}>{inputText(item.input, item.name)}</button></td><td><code>{item.referenceLabel?.value ?? "N/A"}</code></td><td><code>{item.predictedLabel ?? "N/A"}</code></td><td><StatusPill kind={meta.kind}>{meta.label}</StatusPill></td></tr>; })}</tbody></table>{!rows.items.length && <p className="screen-empty-small">No cases match these filters.</p>}<div className="inline-actions page-controls"><span>{rows.total ? `${offset + 1}–${Math.min(offset + rows.items.length, rows.total)}` : "0"} of {rows.total}</span><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><button disabled={offset + rows.items.length >= rows.total} onClick={() => setOffset(offset + 50)}>Next</button></div></> : <p className="screen-empty-small">Loading cases…</p>}</> : <><div className="generic-case-list">{props.caseRuns.map((item) => <button key={item.id} className={selectedCaseRun?.scenarioId === item.scenarioId ? "selected" : ""} onClick={() => setSelectedId(item.scenarioId)}><code>{item.scenarioId}</code><StatusPill kind={item.result.status === "completed" ? "success" : "error"}>{item.result.status}</StatusPill><span>{item.result.result?.outcomeId ?? item.result.error?.code ?? item.result.assertionStatus}</span></button>)}</div>{!props.caseRuns.length && <p className="screen-empty-small">No case results persisted yet.</p>}{props.caseRuns.length < props.caseTotal && <button onClick={() => void props.onLoadMoreCases()}>Load more cases ({props.caseRuns.length} of {props.caseTotal})</button>}</>}</div></Panel>
    </div><Panel title={<>Case detail {selected?.scenarioId ?? (selectedCaseRun?.scenarioId ?? genericSelectedId ?? "")}</>} className="results-detail"><div id="results-detail" className="panel-body">{selected ? <><div className="detail-input">{inputText(selected.input, selected.name)}</div><dl className="detail-facts"><div><dt>Reference</dt><dd>{selected.referenceLabel?.value ?? (selected.referenceLabel ? "Unclear" : "Unlabeled")} · {selected.referenceLabel?.review ?? "unlabeled"} · {selected.referenceLabel?.source ?? "unknown"}</dd></div><div><dt>Prediction</dt><dd>{selected.predictedLabel ?? "N/A"}</dd></div><div><dt>Execution</dt><dd>{selected.status === "not_run" ? `Not run · original ${selected.executionStatus}` : selected.executionStatus}{selected.started === null ? " · start unknown" : ""}</dd></div><div><dt>HTTP attempts</dt><dd>{selected.actualHttpAttempts ?? "unknown"}</dd></div></dl><div className="inline-actions"><button onClick={() => props.onReviewLabel(selected.scenarioId)}>Review label</button><button onClick={() => props.onViewWorkflow(selected.scenarioId, selected.traceId)}>Workflow</button></div></> : selectedCaseRun ? <><div className="detail-input">{inputText(snapshot?.suite.scenarios.find((item) => item.id === selectedCaseRun.scenarioId)?.input, selectedCaseRun.scenarioId)}</div><p>{selectedCaseRun.result.status} · {selectedCaseRun.result.assertionStatus} · {selectedCaseRun.result.result?.outcomeId ?? selectedCaseRun.result.error?.code ?? "N/A"}</p><button onClick={() => props.onViewWorkflow(selectedCaseRun.scenarioId, selectedCaseRun.id)}>Workflow</button></> : <p className="screen-empty-small">{genericSelectedId ? genericFocusLoading ? `Loading saved result for ${genericSelectedId}…` : `No persisted result is available yet for ${genericSelectedId}.` : "Choose a case to inspect its saved trace."}</p>}{(selected || selectedCaseRun) && <div className="trace-view"><h4>Trace · saved snapshot <code>{run.workflowVersionId.slice(0, 8)}</code></h4>{selected?.status === "not_run" ? <p>Case did not run; no path is available.</p> : traceError ? <p role="alert" className="tone-error">{traceError}</p> : trace ? <SavedTrace trace={trace} workflow={snapshot?.workflow} /> : <p>Loading saved trace or no trace was saved for this case.</p>}{trace && <details><summary>Raw trace JSON</summary><pre>{JSON.stringify(trace, null, 2)}</pre></details>}{snapshot && selectedCaseRun && <details><summary>Open path on saved workflow snapshot</summary><WorkflowEditor workflow={snapshot.workflow} layout={snapshot.layout ?? {}} selectedNode="" onSelect={() => {}} selectedEdges={selectedCaseRun.result.selectedEdges} visitedNodes={selectedCaseRun.result.visitedNodes} /></details>}</div>}</div></Panel></div>
    {!terminal(run.status) && <button onClick={() => void props.onCancelRun()}>Cancel run</button>}
    {terminal(run.status) && run.summary.completed < run.progress.selected && <div className="screen-banner tone-warn"><span>{run.progress.selected - run.summary.completed} selected cases did not complete successfully. The server will identify exact remaining IDs, including saved failures or missing case results. A remainder run gets its own ID; the original stays unchanged.</span><button onClick={() => props.onResume(run)}>Run remaining cases</button></div>}
    {classification && <details className="secondary-tools"><summary>Export classification results</summary><p>Exports include message text, labels and model answers. The selected scoring version is included.</p><label><input type="checkbox" checked={exportAck} onChange={(event) => setExportAck(event.target.checked)} /> I understand this export may contain sensitive data.</label><div className="inline-actions"><button disabled={!exportAck} onClick={() => void exportClassification("csv")}>Download CSV</button><button disabled={!exportAck} onClick={() => void exportClassification("json")}>Download JSON</button></div></details>}
  </div>;
}
