import type { Workflow } from "@pathsmith/contracts";
import { StatusPill } from "./ScreenUi";

export type SavedTraceResult = {
  events?: { sequence: number; kind: string; nodeId?: string; elapsedMs?: number; data?: unknown }[];
  logicalJudgments?: number; providerCalls?: number; actualHttpAttempts?: number; usage?: unknown;
  error?: { code: string; message: string };
};
type Event = NonNullable<SavedTraceResult["events"]>[number];
type Group = { id: string; events: Event[]; first: number | null; last: number | null };
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const stringify = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value) ?? "unknown";
function Bounded({ value, limit = 145 }: { value: unknown; limit?: number }) {
  const content = stringify(value);
  return content.length <= limit ? <span>{content}</span> : <><span>{content.slice(0, limit)}…</span><details><summary>Show full value</summary><pre>{content}</pre></details></>;
}
function groupEvents(events: Event[]): Group[] {
  const groups: Group[] = [];
  const byId = new Map<string, Group>();
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (!event.nodeId) continue;
    let group = byId.get(event.nodeId);
    if (!group) { group = { id: event.nodeId, events: [], first: Number.isFinite(event.elapsedMs) ? event.elapsedMs! : null, last: Number.isFinite(event.elapsedMs) ? event.elapsedMs! : null }; byId.set(event.nodeId, group); groups.push(group); }
    group.events.push(event); group.last = Number.isFinite(event.elapsedMs) ? event.elapsedMs! : null;
  }
  return groups;
}
function BranchCases({ value }: { value: unknown }) {
  const cases = Array.isArray(value) ? value : [];
  const row = (item: unknown, index: number) => {
    const info = object(item);
    const result = info?.result;
    const kind = result === "true" ? "success" : result === "not_evaluated" ? "unvisited" : result === "error" ? "error" : "unknown";
    return <li key={`${String(info?.id ?? index)}-${index}`}><code>{String(info?.id ?? `Case ${index + 1}`)}</code><StatusPill kind={kind}>{result === "not_evaluated" ? "Not evaluated" : result === "true" ? "True" : result === "false" ? "False" : result === "error" ? "Error" : "Unknown"}</StatusPill></li>;
  };
  return <><ul className="saved-branch-cases">{cases.slice(0, 4).map(row)}</ul>{cases.length > 4 && <details><summary>Show {cases.length - 4} more branch cases</summary><ul className="saved-branch-cases">{cases.slice(4).map((item, index) => row(item, index + 4))}</ul></details>}</>;
}
function NodeGroup({ group, workflow }: { group: Group; workflow: Workflow }) {
  const node = workflow.nodes.find((item) => item.id === group.id);
  const found = (kind: string) => group.events.find((item) => item.kind === kind);
  const judgment = object(found("judgment_completed")?.data);
  const answers = object(judgment?.answers);
  const branch = object(found("branch_selected")?.data) ?? object(found("branch_evaluation_failed")?.data);
  const edge = object(found("edge_selected")?.data);
  const failure = object(found("node_failed")?.data);
  const transform = object(found("transform_completed")?.data);
  const output = object(found("output_emitted")?.data);
  const failed = !!failure || !!found("branch_evaluation_failed");
  const target = workflow.nodes.find((item) => item.id === edge?.target);
  const duration = group.first === null || group.last === null ? null : Math.max(0, group.last - group.first);
  const answerRows = Object.entries(answers ?? {});
  const question = (key: string) => node?.kind === "judgment" ? node.questions[key] : undefined;
  const answerRow = ([key, raw]: [string, unknown]) => {
    const answer = object(raw), q = question(key);
    return <div className="saved-answer" key={key}><div><code>{key}</code><span>{q?.kind ?? String(answer?.kind ?? "answer")}</span></div>{q?.instructions && <div><Bounded value={q.instructions} /></div>}<div>Answer: <strong>{answer?.kind === "binary" ? <Bounded value={`p(true) ${stringify(answer.probabilityTrue)}`} /> : answer && Object.hasOwn(answer, "value") ? <Bounded value={answer.value} /> : "Unavailable"}</strong></div></div>;
  };
  return <li className="saved-node"><span className={`saved-node-dot ${failed ? "failed" : ""}`} aria-hidden="true" /><div className="saved-node-main"><div className="saved-node-heading"><strong>{node?.label ?? group.id}</strong><code>{group.id}</code><span>{node?.kind ?? "node"}</span><StatusPill kind={failed ? "error" : "success"}>{failed ? "Failed" : "Visited"}</StatusPill></div><div className="saved-node-facts">
    {answerRows.length > 0 && <>{answerRows.slice(0, 2).map(answerRow)}{answerRows.length > 2 && <details><summary>Show {answerRows.length - 2} more answers</summary>{answerRows.slice(2).map(answerRow)}</details>}</>}
    {transform && Object.hasOwn(transform, "value") && <div>Transform output: <Bounded value={transform.value} /></div>}
    {output && <div>Outcome <code>{String(output.outcomeId ?? "unknown")}</code>{Object.hasOwn(output, "value") && <> · <Bounded value={output.value} /></>}</div>}
    {branch && <><p>{branch.port ? <>Chosen branch <code>{String(branch.port)}</code></> : "Branch evaluation stopped"}{typeof branch.defaultReason === "string" && ` · ${branch.defaultReason}`}</p><BranchCases value={branch.cases} /></>}
    {edge && <p>Path: <code>{String(edge.port ?? "unknown")}</code> → <code>{target?.label ?? String(edge.target ?? "unknown")}</code></p>}
    {failure && <p className="tone-error">{String(failure.code ?? "Execution error")}: {String(failure.message ?? "No message saved")}</p>}
  </div><small>{duration === null ? "Timing unavailable" : `${duration.toFixed(1)} ms observed`}</small></div></li>;
}
export function SavedTrace({ trace, workflow }: { trace: SavedTraceResult; workflow?: Workflow }) {
  const groups = workflow ? groupEvents(trace.events ?? []) : [];
  return <div className="saved-trace">{groups.length && workflow ? <ol>{groups.map((group) => <NodeGroup key={group.id} group={group} workflow={workflow} />)}</ol> : <p>No visited node path was saved.</p>}{trace.error && !groups.some((group) => group.events.some((item) => item.kind === "node_failed")) && <p className="tone-error">{trace.error.code}: {trace.error.message}</p>}<div className="subtle">Logical judgments {trace.logicalJudgments ?? "unknown"} · provider calls {trace.providerCalls ?? "unknown"} · HTTP attempts {trace.actualHttpAttempts ?? "unknown"} · usage {trace.usage ? <Bounded value={trace.usage} limit={100} /> : "unknown"}</div></div>;
}
