import { useEffect, useMemo, useRef, useState } from "react";
import type { Suite } from "@pathsmith/contracts";
import { request } from "./apiClient";
import { parseExamples, type ImportRow } from "./importExamples";
import { Icon, ModeBadge, Panel, StatusPill, StepBar } from "./ScreenUi";
import type { Case, ClassificationSuite, Draft, Mode, Preflight, ProviderStatus, Reference, Run, RunControls, RunPrefill, Version } from "./screenTypes";

type Props = {
  projectId: string; projects: { id: string; name: string }[]; suiteDraft: Draft<Suite> | null; suiteDirty: boolean;
  workflowVersionId: string; suiteVersionId: string; fixtureSetId: string; fixtureSets: string[]; onFixtureSetChange: (id: string) => void; run: Run | null; runs: Run[];
  providerStatus: ProviderStatus | null; step: number; focusCaseId: string; prefill: RunPrefill | null;
  ownerGeneration: number; ownerReady: boolean; isOwnerCurrent: (generation: number, projectId: string, suiteId?: string) => boolean; onLiveModeChange: (value: boolean) => void;
  onStep: (step: number) => void; onLoadStarter: () => Promise<void>; onOpenProject: (id: string) => Promise<void>;
  onSuiteDraftSaved: (draft: Draft<Suite>, ownerGeneration: number) => void; onSuitePublished: (draft: Draft<Suite>, version: Version, ownerGeneration: number) => void;
  onRunQueued: (id: string, ownerGeneration: number) => Promise<void>; onClearPrefill: () => void; onViewResults: (labelsVersionId?: string) => void;
};
const maxSuiteBytes = 8 * 1024 * 1024;
const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const sampleIds = (cases: Case[], count: number) => Array.from({ length: Math.min(count, cases.length) }, (_, index) => cases[Math.floor(index * cases.length / Math.min(count, cases.length))].id);
const validReference = (raw: unknown): Reference | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return (typeof value.value === "string" || value.value === null) &&
    typeof value.source === "string" && ["generated", "human", "unknown"].includes(value.source) &&
    typeof value.review === "string" && ["provisional", "reviewed"].includes(value.review) ? value as Reference : null;
};
const inputContent = (raw: unknown) => raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as Record<string, unknown>).content === "string" ? (raw as { content: string }).content : "";
const inputPreview = (raw: unknown, fallback: string) => inputContent(raw) || (raw === undefined ? fallback : JSON.stringify(raw));
const stateOf = (item: Case) => !Object.hasOwn(item, "referenceLabel") ? "unlabeled" : !validReference(item.referenceLabel) ? "invalid" : item.referenceLabel!.value === null ? "unclear" : item.referenceLabel!.review;

export function GuidedClassification(props: Props) {
  const suite = props.suiteDraft?.definition as ClassificationSuite | undefined;
  const target = suite?.classification && typeof suite.classification.positiveLabel === "string" && typeof suite.classification.negativeLabel === "string" ? suite.classification : undefined;
  const draftCases = Array.isArray(suite?.scenarios) ? (suite.scenarios as Case[]).filter((item) => !!item && typeof item === "object" && typeof item.id === "string") : [];
  const [publishedSuite, setPublishedSuite] = useState<ClassificationSuite | null>(null);
  const [publishedError, setPublishedError] = useState("");
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [importError, setImportError] = useState("");
  const [labelEdits, setLabelEdits] = useState<Record<string, Reference | null>>({});
  const [labelFilter, setLabelFilter] = useState("all");
  const [labelOffset, setLabelOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<Mode>("mock");
  const [scope, setScope] = useState<"sample" | "full">("sample");
  const [sampleCount, setSampleCount] = useState(10);
  const [sourceRunId, setSourceRunId] = useState("");
  const [concurrency, setConcurrency] = useState(4);
  const [httpAttemptLimit, setHttpAttemptLimit] = useState(props.providerStatus?.defaultHttpAttemptLimit ?? 200);
  const [controls, setControls] = useState<RunControls | null>(null);
  const [preflightRecord, setPreflightRecord] = useState<{ key: string; value: Preflight } | null>(null);
  const [preflightError, setPreflightError] = useState("");
  const [consent, setConsent] = useState(false);
  const preflightRequest = useRef(0);
  const ownerRef = useRef({ generation: props.ownerGeneration, projectId: props.projectId, suiteId: props.suiteDraft?.id });
  ownerRef.current = { generation: props.ownerGeneration, projectId: props.projectId, suiteId: props.suiteDraft?.id };
  const owns = (token: typeof ownerRef.current) => ownerRef.current.generation === token.generation && ownerRef.current.projectId === token.projectId && ownerRef.current.suiteId === token.suiteId && props.isOwnerCurrent(token.generation, token.projectId, token.suiteId);
  const mayStart = () => props.ownerReady && owns(ownerRef.current);
  useEffect(() => { props.onLiveModeChange(props.ownerReady && props.step === 2 && mode === "live"); }, [props.ownerReady, props.step, mode, props.onLiveModeChange]);
  useEffect(() => { setConsent(false); setPreflightRecord(null); }, [props.ownerGeneration, props.ownerReady]);

  useEffect(() => {
    let active = true;
    setPublishedSuite(null); setPublishedError("");
    if (props.suiteVersionId) void request<{ definition: ClassificationSuite }>(`/suite-versions/${props.suiteVersionId}`).then((version) => { if (active) setPublishedSuite(version.definition); }).catch((error) => { if (active) setPublishedError(String(error)); });
    return () => { active = false; };
  }, [props.suiteVersionId]);
  useEffect(() => { setPreview([]); setLabelEdits({}); setMessage(""); setPaste(""); setLabelOffset(0); setBusy(false); }, [props.projectId]);
  useEffect(() => { if (props.providerStatus) setHttpAttemptLimit(props.providerStatus.defaultHttpAttemptLimit); }, [props.providerStatus]);
  useEffect(() => {
    if (!props.prefill) return;
    setMode(props.prefill.mode); setScope("full"); setSourceRunId(props.prefill.sourceRunId ?? "");
    setControls(props.prefill.rerunPlan?.controls ?? props.prefill.controls ?? null);
    if (props.prefill.rerunPlan || props.prefill.concurrency) setConcurrency(props.prefill.rerunPlan?.concurrency ?? props.prefill.concurrency ?? 4);
    setHttpAttemptLimit(props.prefill.rerunPlan?.httpAttemptLimit ?? props.prefill.httpAttemptLimit ?? props.providerStatus?.defaultHttpAttemptLimit ?? 200);
    setConsent(false);
  }, [props.prefill]);
  useEffect(() => {
    if (props.step !== 1 || !props.focusCaseId) return;
    const index = draftCases.findIndex((item) => item.id === props.focusCaseId);
    if (index >= 0) { setLabelFilter("all"); setLabelOffset(Math.floor(index / 50) * 50); }
  }, [props.step, props.focusCaseId, props.projectId, props.suiteDraft]);
  useEffect(() => {
    if (props.step !== 1 || !props.focusCaseId) return;
    const timer = window.setTimeout(() => document.getElementById(`test-case-${props.focusCaseId}`)?.scrollIntoView({ block: "center" }), 80);
    return () => window.clearTimeout(timer);
  }, [props.step, props.focusCaseId, labelFilter, labelOffset]);

  const runCases = (publishedSuite?.scenarios ?? []) as Case[];
  const selectedIds = useMemo(() => props.prefill?.selectedScenarioIds ?? (scope === "sample" ? sampleIds(runCases, sampleCount) : runCases.map((item) => item.id)), [props.prefill, scope, runCases, sampleCount]);
  const workflowVersionId = props.prefill?.workflowVersionId ?? props.workflowVersionId;
  const suiteVersionId = props.prefill?.suiteVersionId ?? props.suiteVersionId;
  const runBody = useMemo(() => ({ workflowVersionId, suiteVersionId, mode, selectedScenarioIds: selectedIds,
    ...(mode === "mock" ? { fixtureSetId: props.fixtureSetId } : {}),
    ...(mode === "replay" ? { sourceRunId } : {}),
    ...(props.prefill?.profile && mode !== "live" ? { profile: props.prefill.profile } : {}),
    ...(props.prefill?.limits ? { limits: props.prefill.limits } : {}),
    ...(mode === "live" ? { concurrency, httpAttemptLimit, ...(controls ? { controls } : {}) } : {}) }),
  [workflowVersionId, suiteVersionId, mode, selectedIds, props.fixtureSetId, sourceRunId, concurrency, httpAttemptLimit, controls, props.prefill]);
  const runKey = JSON.stringify(runBody);
  const preflightBody = { workflowVersionId, suiteVersionId, mode: "live" as const, selectedScenarioIds: selectedIds, concurrency,
    httpAttemptLimit: props.prefill?.rerunPlan?.httpAttemptLimit ?? props.prefill?.httpAttemptLimit ?? props.providerStatus?.defaultHttpAttemptLimit ?? 200,
    ...(props.prefill?.rerunPlan ? { profile: props.prefill.rerunPlan.profile, limits: props.prefill.rerunPlan.limits } : { ...(props.prefill?.profile ? { profile: props.prefill.profile } : {}), ...(props.prefill?.limits ? { limits: props.prefill.limits } : {}) }) };
  const preflightKey = JSON.stringify(preflightBody);
  const preflight = preflightRecord?.key === preflightKey ? preflightRecord.value : null;
  useEffect(() => { setConsent(false); }, [runKey, preflightKey]);
  useEffect(() => {
    const generation = ++preflightRequest.current;
    setPreflightError("");
    if (props.step !== 2 || mode !== "live" || !workflowVersionId || !suiteVersionId || !selectedIds.length || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) return;
    void request<Preflight>("/runs/preflight", "POST", preflightBody).then((value) => {
      if (generation !== preflightRequest.current) return;
      setPreflightRecord({ key: preflightKey, value }); setPreflightError(""); setConsent(false);
    }).catch((error) => { if (generation === preflightRequest.current) setPreflightError(String(error)); });
    return () => { preflightRequest.current++; };
  }, [props.step, mode, preflightKey]);
  const publishedIsDraft = !!publishedSuite && !!suite && JSON.stringify(publishedSuite) === JSON.stringify(suite) && !props.suiteDirty;
  const pendingDraft = !!props.suiteDraft && !publishedIsDraft;
  const labelChanges = Object.keys(labelEdits).length;
  const filteredLabels = draftCases.filter((item) => labelFilter === "all" || stateOf(item) === labelFilter);
  const displayedLabels = filteredLabels.slice(labelOffset, labelOffset + 50);
  const immutableRemainder = !!props.prefill?.rerunPlan;
  const savedSelection = !!props.prefill?.selectedScenarioIds;
  const capMaximum = preflight ? selectedIds.length * preflight.maxJudgmentsPerCase : 0;
  const capMinimum = capMaximum === 0 ? 0 : 1;
  const liveLimitsValid = Number.isSafeInteger(httpAttemptLimit) && httpAttemptLimit >= 1 && httpAttemptLimit <= (props.providerStatus?.maximumHttpAttemptLimit ?? 30000) &&
    Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 16 &&
    (!controls || !!preflight && Number.isSafeInteger(controls.maxProviderCalls) && controls.maxProviderCalls >= capMinimum && controls.maxProviderCalls <= capMaximum &&
      Number.isSafeInteger(controls.stopAfterConsecutiveErrors) && controls.stopAfterConsecutiveErrors >= 1 && controls.stopAfterConsecutiveErrors <= 20);
  const invalidSetup = !props.ownerReady || !workflowVersionId || !suiteVersionId || !selectedIds.length || (!savedSelection && (!runCases.length || props.suiteDirty)) ||
    (mode === "mock" && !immutableRemainder && !props.fixtureSetId) || (mode === "replay" && !sourceRunId) ||
    (mode === "live" && (!props.providerStatus?.allowedModes.includes("live") || !consent || !liveLimitsValid || !preflight));

  function stage(text: string, format: "lines" | "csv" | "jsonl") {
    if (!target || !mayStart()) return;
    try {
      const parsed = parseExamples(text, format, target.positiveLabel, target.negativeLabel);
      const seen = new Set(draftCases.map((item) => inputContent(item.input)).filter(Boolean));
      setPreview(parsed.map((row) => {
        const issue = row.issue || (seen.has(row.content) ? "Duplicate message in this test set or import." : "");
        seen.add(row.content);
        return { ...row, issue };
      }));
      setPreviewOffset(0); setImportError("");
    } catch (error) { setPreview([]); setImportError(String(error)); }
  }
  async function saveDefinition(definition: ClassificationSuite): Promise<Draft<Suite>> {
    if (!mayStart()) throw new Error("Project is changing. Wait for it to finish loading.");
    if (!props.suiteDraft || !props.workflowVersionId) throw new Error("Choose a workflow and test set first.");
    if (props.suiteDirty) throw new Error("Save or discard the unsaved JSON edits in Advanced test-set tools first.");
    if (definition.scenarios.length > 10000 || encodedBytes(definition) > maxSuiteBytes) throw new Error("Test set exceeds 10,000 cases or 8 MiB.");
    return request<Draft<Suite>>(`/suites/${props.suiteDraft.id}/draft`, "PUT", { expectedRevision: props.suiteDraft.draftRevision, definition, workflowVersionId: props.workflowVersionId });
  }
  async function saveExamples() {
    if (!mayStart() || !suite || !preview.length || preview.some((row) => row.issue)) return;
    const owner = ownerRef.current;
    setBusy(true); setMessage("");
    try {
      const ids = new Set(draftCases.map((item) => item.id));
      let index = draftCases.length + 1;
      const additions: Case[] = preview.map((row) => {
        let id: string; do { id = `message_${index++}`; } while (ids.has(id)); ids.add(id);
        const referenceLabel = row.label ? { value: row.label === "unclear" ? null : row.label, source: row.source, review: "provisional" as const } : undefined;
        return { id, name: row.content.slice(0, 60), input: { content: row.content }, tags: row.tags, ...(referenceLabel ? { referenceLabel } : {}) };
      });
      const saved = await saveDefinition({ ...suite, scenarios: [...(Array.isArray(suite.scenarios) ? suite.scenarios : []), ...additions] as ClassificationSuite["scenarios"] });
      if (!owns(owner)) return;
      props.onSuiteDraftSaved(saved, owner.generation); setPreview([]); setPaste(""); setMessage(`${additions.length} examples saved to the draft. Publish a version before they can run.`);
    } catch (error) { if (owns(owner)) setMessage(`Draft save failed. Preview retained. ${String(error)}`); }
    finally { if (owns(owner)) setBusy(false); }
  }
  async function saveLabels() {
    if (!mayStart() || !suite || !labelChanges) return;
    const owner = ownerRef.current;
    setBusy(true); setMessage("");
    try {
      const next: ClassificationSuite = { ...suite, scenarios: (Array.isArray(suite.scenarios) ? suite.scenarios : []).map((item) => item && typeof item === "object" && Object.hasOwn(labelEdits, item.id) ? { ...item, referenceLabel: labelEdits[item.id] ?? undefined } : item) as ClassificationSuite["scenarios"] };
      const saved = await saveDefinition(next);
      if (!owns(owner)) return;
      props.onSuiteDraftSaved(saved, owner.generation); setLabelEdits({}); setMessage(`${labelChanges} reference changes saved to the draft. Publish a version to use them for scoring.`);
    } catch (error) { if (owns(owner)) setMessage(`Label save failed. Changes retained. ${String(error)}`); }
    finally { if (owns(owner)) setBusy(false); }
  }
  async function publish() {
    if (!mayStart() || !props.suiteDraft || !props.workflowVersionId || props.suiteDirty || labelChanges) return;
    const owner = ownerRef.current;
    setBusy(true); setMessage("");
    try {
      const version = await request<Version>(`/suites/${props.suiteDraft.id}/versions`, "POST", { expectedRevision: props.suiteDraft.draftRevision, workflowVersionId: props.workflowVersionId });
      if (!owns(owner)) return;
      props.onSuitePublished(props.suiteDraft, version, owner.generation); setMessage("Published a new immutable test-set version. Earlier runs keep their original snapshots.");
    } catch (error) { if (owns(owner)) setMessage(`Publish failed. Draft retained. ${String(error)}`); }
    finally { if (owns(owner)) setBusy(false); }
  }
  async function start() {
    if (!mayStart() || invalidSetup || busy) return;
    const owner = ownerRef.current;
    setBusy(true); setMessage("");
    try {
      const result = props.prefill?.rerunPlan
        ? await request<Run>(`/runs/${props.prefill.rerunPlan.rerunOfRunId}/rerun`, "POST", { scope: "remaining", ...(mode === "live" ? { confirmLive: true, controls: controls ?? props.prefill.rerunPlan.controls, httpAttemptLimit } : {}) })
        : await request<Run>("/runs", "POST", { ...runBody, ...(mode === "live" && preflight ? { confirmLive: true,
          profile: { formatVersion: "0.1", bindings: Object.fromEntries(preflight.providerModels.map((item) => [item.binding, { providerId: item.providerId, model: item.model }])) } } : {}) });
      if (!owns(owner) || result.projectId !== owner.projectId) return;
      setConsent(false); props.onClearPrefill(); await props.onRunQueued(result.id, owner.generation);
    } catch (error) { if (owns(owner)) setMessage(`Run was not queued. ${String(error)}`); }
    finally { if (owns(owner)) setBusy(false); }
  }
  function changeSetup(next: () => void) { if (props.prefill) props.onClearPrefill(); next(); setConsent(false); }
  if (!props.projectId) return <div className="screen-empty"><h2>Start a local project</h2><p>Load a starter or choose a saved project to begin testing.</p><button className="primary-action" disabled={!props.ownerReady} onClick={() => void props.onLoadStarter()}>Load classification starter</button><label>Saved project<select value="" disabled={!props.ownerReady} onChange={(event) => void props.onOpenProject(event.target.value)}><option value="">Choose project</option>{props.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>;
  return <div className="test-screen">
    <fieldset className="test-owner-gate" disabled={!props.ownerReady}>
    <div className="screen-top"><div><h2>Test set · {props.suiteDraft?.name ?? "No test set"}</h2><p>Published <code>{props.suiteVersionId ? props.suiteVersionId.slice(0, 8) : "none"}</code> · {draftCases.length} examples{pendingDraft && <span className="text-warn"> · draft changes pending</span>}</p></div></div>
    <StepBar step={props.step} onStep={(step) => step === 3 ? props.onViewResults() : props.onStep(step)} />
    {message && <p className="screen-banner" role="status">{message}</p>}
    {publishedError && <p className="screen-banner tone-error" role="alert">Published test set unavailable: {publishedError}</p>}
    {pendingDraft && <div className="screen-banner tone-warn"><Icon name="alert" /><span>Draft changes are not in published version <code>{props.suiteVersionId.slice(0, 8) || "none"}</code>. Runs use the published version until you publish.</span><button disabled={busy || !!labelChanges || props.suiteDirty} onClick={() => void publish()}>Publish version</button></div>}
    {props.step === 0 && <div className="test-add-grid">
      {target ? <><Panel title="Add examples"><div className="panel-body"><label>Paste one message per line<textarea aria-label="Paste messages" disabled={busy} rows={8} value={paste} onChange={(event) => setPaste(event.target.value)} placeholder="One message per line" /></label><div className="inline-actions"><button disabled={busy} onClick={() => stage(paste, "lines")}>Preview pasted messages</button><label className="button">Import CSV or JSONL<input aria-label="Import CSV or JSONL" disabled={busy} type="file" accept=".csv,.jsonl,text/csv,application/x-ndjson" onChange={(event) => { const file = event.target.files?.[0]; if (file) { if (file.size > maxSuiteBytes) setImportError("File exceeds 8 MiB."); else void file.text().then((value) => stage(value, file.name.toLowerCase().endsWith(".jsonl") ? "jsonl" : "csv")); } event.target.value = ""; }} /></label></div><p className="subtle">CSV: content, expected_label, source, tags. JSONL: one object per line. Imported labels remain provisional; a null label means unclear.</p></div></Panel>
      <Panel title={<>Validation preview <code>{preview.length}</code></>}><div className="panel-body">{importError && <p role="alert" className="tone-error">{importError}</p>}{!preview.length ? <p className="screen-empty-small">Nothing to preview yet. Pasted or imported messages appear here first.</p> : <><ul className="preview-list">{preview.slice(previewOffset, previewOffset + 50).map((item, index) => <li key={previewOffset + index}><StatusPill kind={item.issue ? "regress" : "success"}>{item.issue ? "Issue" : "Ready"}</StatusPill><span>{item.content || "(empty)"}</span><code>{item.label || "—"}</code>{item.issue && <small>{item.issue}</small>}</li>)}</ul><div className="inline-actions"><button disabled={previewOffset === 0} onClick={() => setPreviewOffset(Math.max(0, previewOffset - 50))}>Previous</button><button disabled={previewOffset + 50 >= preview.length} onClick={() => setPreviewOffset(previewOffset + 50)}>Next</button><button className="primary-action" disabled={busy || preview.some((item) => item.issue)} onClick={() => void saveExamples()}>Add {preview.length} to draft</button></div></>}</div></Panel></> : <Panel title="General test set"><div className="panel-body"><p>This test set uses canonical scenario inputs and expectations. Edit them in Advanced test-set tools below, then publish a version before running.</p><p>{draftCases.length} draft cases · {runCases.length} published cases.</p></div></Panel>}
    </div>}
    {props.step === 1 && <div className="test-review"><div className="filter-row">{["all", "reviewed", "provisional", "unlabeled", "unclear", "invalid"].map((state) => <button key={state} aria-pressed={labelFilter === state} onClick={() => { setLabelFilter(state); setLabelOffset(0); }}>{state} · {state === "all" ? draftCases.length : draftCases.filter((item) => stateOf(item) === state).length}</button>)}</div>{target ? <><p className="subtle">A generated source remains recorded when a person marks a label reviewed. Provisional and unclear references are not verified truth.</p><ul className="label-list">{displayedLabels.map((item) => { const ref = Object.hasOwn(labelEdits, item.id) ? labelEdits[item.id] : validReference(item.referenceLabel); const invalidRef = Object.hasOwn(item, "referenceLabel") && !validReference(item.referenceLabel) && !Object.hasOwn(labelEdits, item.id); return <li key={item.id} id={`test-case-${item.id}`} className={props.focusCaseId === item.id ? "focused" : ""}><code>{item.id}</code><span className="case-input">{inputPreview(item.input, typeof item.name === "string" ? item.name : item.id)}</span><select aria-label={`Expected answer for ${item.id}`} disabled={busy} value={ref?.value ?? (ref ? "unclear" : "")} onChange={(event) => { const value = event.target.value; setLabelEdits((current) => ({ ...current, [item.id]: value ? { value: value === "unclear" ? null : value, source: ref?.source ?? "human", review: "provisional" } : null })); }}><option value="">No label</option><option value={target.positiveLabel}>{target.positiveLabel}</option><option value={target.negativeLabel}>{target.negativeLabel}</option><option value="unclear">Unclear</option></select><span className="ref-state">{invalidRef ? "invalid reference · repair JSON" : `${ref?.value === null ? "unclear" : ref?.review ?? "unlabeled"} · ${ref?.source ?? "unknown"}`}</span><button disabled={busy || !ref || ref.value === null || ref.review === "reviewed"} onClick={() => setLabelEdits((current) => ({ ...current, [item.id]: { ...ref!, review: "reviewed" } }))}>Mark reviewed</button></li>; })}</ul><div className="inline-actions"><span>{filteredLabels.length ? `${labelOffset + 1}–${Math.min(labelOffset + 50, filteredLabels.length)}` : "0"} of {filteredLabels.length}</span><button disabled={labelOffset === 0} onClick={() => setLabelOffset(Math.max(0, labelOffset - 50))}>Previous</button><button disabled={labelOffset + 50 >= filteredLabels.length} onClick={() => setLabelOffset(labelOffset + 50)}>Next</button><button disabled={busy || !labelChanges} onClick={() => void saveLabels()}>Save {labelChanges} label changes</button><button disabled={busy || !!labelChanges || props.suiteDirty || !pendingDraft} onClick={() => void publish()}>Publish labels</button></div></> : <p className="screen-empty-small">This suite has no classification target. Review expected outputs in Advanced test-set tools below.</p>}{props.run && props.suiteVersionId && props.run.suiteVersionId !== props.suiteVersionId && !pendingDraft && <div className="screen-banner"><Icon name="check" /><span>Published labels can re-score saved predictions without a provider call. Original run labels remain available.</span><button onClick={() => props.onViewResults(props.suiteVersionId)}>View re-scored results</button></div>}</div>}
    {props.step === 2 && <div className="test-run-grid"><Panel title="Run configuration"><div className="panel-body"><div className="field-title">Run mode</div><div className="mode-options" role="radiogroup" aria-label="Run mode">{(["mock", "replay", "live"] as Mode[]).map((value) => <button key={value} role="radio" aria-checked={mode === value} className={mode === value ? `selected ${value}` : ""} onClick={() => changeSetup(() => setMode(value))}><ModeBadge mode={value} /><small>{value === "mock" ? "Offline, exact fixtures" : value === "replay" ? "Saved responses only" : "External provider requests"}</small></button>)}</div><p className="subtle">Mode belongs to this run. Recorded Replay needs an exact source run.</p>{mode === "replay" && <label>Replay source<select aria-label="Replay source run" value={sourceRunId} onChange={(event) => changeSetup(() => setSourceRunId(event.target.value))}><option value="">Choose saved source</option>{props.runs.filter((item) => item.mode !== "replay").map((item) => <option key={item.id} value={item.id}>{item.id.slice(0, 8)} · {item.mode} · {item.status}</option>)}</select></label>}
        {mode === "mock" && immutableRemainder && <p className="subtle">The remaining run reuses its saved exact mock source and immutable snapshots.</p>}{mode === "mock" && !immutableRemainder && <label>Exact mock fixture set<select aria-label="Fixture set" value={props.fixtureSetId} onChange={(event) => changeSetup(() => props.onFixtureSetChange(event.target.value))}><option value="">Choose fixture set</option>{props.fixtureSets.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>}
        <div className="field-title">Selection</div><div className="scope-options">{(["sample", "full"] as const).map((value) => <button key={value} aria-pressed={scope === value} className={scope === value ? "selected" : ""} onClick={() => changeSetup(() => setScope(value))}>{value === "sample" ? "Run sample" : "Full published test set"}<small>{value === "sample" ? "Evenly spaced IDs" : `${runCases.length} saved cases`}</small></button>)}</div>{scope === "sample" && !props.prefill && <label>Sample size<input type="number" min="1" max={runCases.length || 1} value={sampleCount} onChange={(event) => changeSetup(() => setSampleCount(Math.max(1, Math.min(runCases.length || 1, Number(event.target.value) || 1))))} /></label>}
        {props.prefill && <div className="screen-banner"><Icon name="compare" /><span>{props.prefill.title} · prefilled from {props.prefill.from}. {props.prefill.rerunPlan ? `Exact remaining ${props.prefill.rerunPlan.selectedScenarioIds.length} cases on saved immutable snapshots.` : `${selectedIds.length} selected cases.`}</span><button onClick={props.onClearPrefill}>Clear</button></div>}
        {mode === "live" && <div className="live-fields"><label>Scenario concurrency<input type="number" min="1" max="16" value={concurrency} disabled={!!props.prefill?.rerunPlan} onChange={(event) => changeSetup(() => setConcurrency(Number(event.target.value) || 1))} /></label><label>Maximum HTTP attempts<input type="number" min="1" max={props.providerStatus?.maximumHttpAttemptLimit ?? 30000} value={httpAttemptLimit} onChange={(event) => { setHttpAttemptLimit(Number(event.target.value) || 1); setConsent(false); }} /></label><p className="subtle">Scenario workers can be 1–16. Jev permits at most 4 HTTP requests in flight process-wide.</p><><label>Max provider calls<input type="number" min={preflight ? capMinimum : undefined} max={preflight ? capMaximum : undefined} value={controls?.maxProviderCalls ?? props.prefill?.rerunPlan?.controls?.maxProviderCalls ?? preflight?.controls?.maxProviderCalls ?? ""} onChange={(event) => { setControls({ maxProviderCalls: Number(event.target.value), stopAfterConsecutiveErrors: controls?.stopAfterConsecutiveErrors ?? preflight?.controls?.stopAfterConsecutiveErrors ?? 5 }); setConsent(false); }} /></label><label>Stop after consecutive provider errors<input type="number" min="1" max="20" value={controls?.stopAfterConsecutiveErrors ?? preflight?.controls?.stopAfterConsecutiveErrors ?? 5} onChange={(event) => { setControls({ maxProviderCalls: controls?.maxProviderCalls ?? props.prefill?.rerunPlan?.controls?.maxProviderCalls ?? preflight?.controls?.maxProviderCalls ?? 0, stopAfterConsecutiveErrors: Number(event.target.value) }); setConsent(false); }} /></label></>{preflightError && <p className="tone-error" role="alert">{preflightError}</p>}{preflight && !liveLimitsValid && <p className="tone-error" role="alert">Provider call cap must be {capMinimum}–{capMaximum}; error stop 1–20; scenario concurrency 1–16; HTTP attempts 1–{props.providerStatus?.maximumHttpAttemptLimit ?? 30000}.</p>}</div>}
      </div></Panel><Panel title="Before you run"><div className="panel-body"><dl className="run-facts"><div><dt>Selected</dt><dd>{selectedIds.length} cases</dd></div><div><dt>Workflow</dt><dd><code>{workflowVersionId.slice(0, 8) || "unpublished"}</code></dd></div><div><dt>Test set</dt><dd><code>{suiteVersionId.slice(0, 8) || "unpublished"}</code></dd></div><div><dt>Mode</dt><dd><ModeBadge mode={mode} /></dd></div>{mode === "live" && <><div><dt>Requested models</dt><dd>{preflight?.providerModels.map((item) => `${item.binding}: ${item.providerId}/${item.model}`).join(", ") ?? (immutableRemainder ? Object.entries(props.prefill!.rerunPlan!.profile.bindings).map(([binding, item]) => `${binding}: ${item.providerId}/${item.model}`).join(", ") || "No model bindings" : "Checking server…")}</dd></div><div><dt>Path bound</dt><dd>{preflight ? `${preflight.maxJudgmentsPerCase} judgments/case · ${preflight.attemptsPerCall} attempts/call` : "Checking server…"}</dd></div><div><dt>Upper bound</dt><dd>{preflight && !liveLimitsValid ? "Fix run limits to see the bound" : preflight ? `≤ ${Math.min(capMaximum, controls?.maxProviderCalls ?? props.prefill?.rerunPlan?.controls?.maxProviderCalls ?? preflight.maxProviderCalls)} calls · ≤ ${Math.min(httpAttemptLimit, Math.min(capMaximum, controls?.maxProviderCalls ?? props.prefill?.rerunPlan?.controls?.maxProviderCalls ?? preflight.maxProviderCalls) * preflight.attemptsPerCall)} HTTP attempts` : "Checking server…"}</dd></div><div><dt>Concurrency</dt><dd>{concurrency} scenario workers · 4 HTTP requests in flight process-wide</dd></div><div><dt>Hard stops</dt><dd>{preflight ? `${controls?.maxProviderCalls ?? props.prefill?.rerunPlan?.controls?.maxProviderCalls ?? preflight.controls?.maxProviderCalls ?? preflight.maxProviderCalls} calls · ${controls?.stopAfterConsecutiveErrors ?? props.prefill?.rerunPlan?.controls?.stopAfterConsecutiveErrors ?? preflight.controls?.stopAfterConsecutiveErrors ?? 5} errors` : "Checking server…"}</dd></div></>}</dl>{mode === "live" && preflight && (controls?.maxProviderCalls ?? props.prefill?.rerunPlan?.controls?.maxProviderCalls ?? preflight.maxProviderCalls) < selectedIds.length * preflight.maxJudgmentsPerCase && <p className="subtle">The provider call cap is below the selected path bound. Some cases may remain unfinished when the cap is reached.</p>}{mode === "live" && <div className="live-consent"><p>Messages and workflow questions leave this computer. Usage may be billed; token cost is unknown before the run.</p><label><input type="checkbox" checked={consent} disabled={!preflight || !liveLimitsValid} onChange={(event) => setConsent(event.target.checked)} /> I consent to the external requests shown above.</label></div>}{!runCases.length && !savedSelection && <p className="subtle">Publish a valid test set before running.</p>}{props.suiteDirty && !savedSelection && <p className="tone-warn">Unsaved test-set edits must be saved or discarded before running.</p>}<button className={mode === "live" ? "live-action" : "primary-action"} disabled={invalidSetup || busy} onClick={() => void start()}>{busy ? "Starting…" : immutableRemainder ? `Run ${selectedIds.length} remaining cases` : props.prefill?.selectedScenarioIds ? `Run ${selectedIds.length} selected cases` : scope === "sample" ? "Run sample" : "Run full set"}</button></div></Panel></div>}
    {props.step === 3 && <div className="screen-empty"><p>Inspect the saved run in Results. It remains available when you return here.</p><button onClick={() => props.onViewResults()}>Open Results</button></div>}
    </fieldset>
  </div>;
}
