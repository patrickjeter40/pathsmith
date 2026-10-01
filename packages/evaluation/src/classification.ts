import type { Json, Scenario, Suite } from "@pathsmith/contracts";
import type { ScenarioResult } from "./index.js";

export type ClassificationFacts = Pick<ScenarioResult,
  "scenarioId" | "status" | "outputs" | "error" | "actualHttpAttempts" | "elapsedMs">;
export const CLASSIFICATION_VERDICTS = ["true_positive", "true_negative", "false_positive", "false_negative", "unlabeled", "unclear", "missing_prediction", "error", "canceled", "interrupted", "pending", "not_run"] as const;
export type ClassificationVerdict = typeof CLASSIFICATION_VERDICTS[number];
export interface ClassificationRow {
  scenarioId: string;
  name: string;
  input: Json;
  tags: string[];
  referenceLabel: Scenario["referenceLabel"] | null;
  predictedLabel: string | null;
  status: string;
  verdict: ClassificationVerdict;
  errorCode: string | null;
  actualHttpAttempts: number;
  elapsedMs: number | null;
}
const object = (v: Json | undefined): Record<string, Json> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v : undefined;

/** Read the historical typed answer, never infer a classification from routing. */
export function classificationRow(suite: Suite, scenario: Scenario,
  facts: ClassificationFacts | undefined, runStatus: string): ClassificationRow {
  const target = suite.classification;
  if (!target) throw new Error("This test set has no classification target");
  const answer = object(object(facts?.outputs[target.nodeId])?.[target.questionId]);
  const value = answer?.value;
  const predictedLabel = facts?.status === "completed" && answer?.kind === "choice" &&
    typeof value === "string" && [target.positiveLabel, target.negativeLabel].includes(value) ? value : null;
  const status = facts?.status ?? (runStatus === "interrupted" ? "interrupted" :
    runStatus === "canceled" ? "canceled" : ["queued", "running", "canceling"].includes(runStatus) ? "pending" : "not_run");
  let verdict: ClassificationVerdict;
  if (status !== "completed") verdict = status === "failed" ? "error" : status as ClassificationVerdict;
  else if (predictedLabel === null) verdict = "missing_prediction";
  else if (!scenario.referenceLabel) verdict = "unlabeled";
  else if (scenario.referenceLabel.value === null) verdict = "unclear";
  else if (predictedLabel === target.positiveLabel)
    verdict = scenario.referenceLabel.value === target.positiveLabel ? "true_positive" : "false_positive";
  else verdict = scenario.referenceLabel.value === target.negativeLabel ? "true_negative" : "false_negative";
  return { scenarioId: scenario.id, name: scenario.name, input: scenario.input, tags: scenario.tags,
    referenceLabel: scenario.referenceLabel ?? null, predictedLabel, status, verdict,
    errorCode: facts?.error?.code ?? null, actualHttpAttempts: facts?.actualHttpAttempts ?? 0,
    elapsedMs: facts?.elapsedMs ?? null };
}

function counts() {
  return { selected: 0, completed: 0, errors: 0, canceled: 0, interrupted: 0, pending: 0, notRun: 0,
    missingPrediction: 0, unlabeled: 0, unclear: 0, labeled: 0, evaluated: 0,
    truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
}
type Counts = ReturnType<typeof counts>;
function add(c: Counts, row: ClassificationRow) {
  c.selected++;
  if (!row.referenceLabel) c.unlabeled++;
  else if (row.referenceLabel.value === null) c.unclear++;
  else c.labeled++;
  if (row.status === "completed") c.completed++;
  else if (row.status === "failed") c.errors++;
  else if (row.status === "canceled") c.canceled++;
  else if (row.status === "interrupted") c.interrupted++;
  else if (row.status === "pending") c.pending++;
  else c.notRun++;
  if (row.verdict === "missing_prediction") c.missingPrediction++;
  const field = { true_positive: "truePositive", true_negative: "trueNegative", false_positive: "falsePositive", false_negative: "falseNegative" } as const;
  if (Object.hasOwn(field, row.verdict)) { c[field[row.verdict as keyof typeof field]]++; c.evaluated++; }
}
function measures(c: Counts) {
  const rate = (numerator: number, denominator: number) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
  const correct = c.truePositive + c.trueNegative;
  return { ...c, agreement: rate(correct, c.evaluated), endToEndAgreement: rate(correct, c.labeled),
    completion: rate(c.completed, c.selected), precision: rate(c.truePositive, c.truePositive + c.falsePositive),
    recall: rate(c.truePositive, c.truePositive + c.falseNegative),
    falsePositiveRate: rate(c.falsePositive, c.falsePositive + c.trueNegative),
    falseNegativeRate: rate(c.falseNegative, c.falseNegative + c.truePositive) };
}
export function summarizeClassification(rows: ClassificationRow[]) {
  const all = counts(), reviewed = counts(), provisional = counts();
  const sources = { generated: 0, human: 0, unknown: 0 };
  const tags = new Map<string, { all: Counts; reviewed: Counts; provisional: Counts }>();
  for (const row of rows) {
    add(all, row);
    const review = row.referenceLabel?.review;
    if (review) add(review === "reviewed" ? reviewed : provisional, row);
    if (row.referenceLabel) sources[row.referenceLabel.source]++;
    for (const tag of row.tags) {
      let slice = tags.get(tag);
      if (!slice) { slice = { all: counts(), reviewed: counts(), provisional: counts() }; tags.set(tag, slice); }
      add(slice.all, row);
      if (review) add(slice[review], row);
    }
  }
  return { all: measures(all), reviewed: measures(reviewed), provisional: measures(provisional), labelSources: sources,
    slices: [...tags].sort(([a], [b]) => a.localeCompare(b)).map(([tag, c]) => ({ tag, all: measures(c.all), reviewed: measures(c.reviewed), provisional: measures(c.provisional) })) };
}

/** CSV escapes spreadsheet formulas as well as CSV syntax; raw values remain in JSON. */
export function classificationCsv(rows: ClassificationRow[]): string {
  const cell = (value: unknown) => {
    let s = value === null || value === undefined ? "" : String(value);
    if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const header = ["id", "name", "input_json", "expected_label", "label_source", "label_review", "predicted_label", "status", "result", "error", "tags_json", "http_attempts"];
  return [header.map(cell).join(","), ...rows.map((r) => [r.scenarioId, r.name, JSON.stringify(r.input),
    r.referenceLabel ? r.referenceLabel.value ?? "unclear" : "", r.referenceLabel?.source, r.referenceLabel?.review,
    r.predictedLabel, r.status, r.verdict, r.errorCode, JSON.stringify(r.tags), r.actualHttpAttempts].map(cell).join(","))].join("\r\n");
}
