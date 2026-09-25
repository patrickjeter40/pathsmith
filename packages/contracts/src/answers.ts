import { Ajv2020 } from "ajv/dist/2020.js";
import { schemas } from "./generated/schemas.js";
import { inspectJson } from "./safety.js";
import type { Answer, Question, ValidationResult } from "./types.js";
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validAnswer = ajv.compile({
  $defs: schemas["mock-fixtures"].$defs,
  $ref: "#/$defs/answer",
});

export function validateAnswers(
  questions: Record<string, Question>,
  value: unknown,
): ValidationResult {
  const diagnostics = inspectJson(value, 512 * 1024);
  const fail = (message: string, pointer = "") =>
    diagnostics.push({
      code: "PROVIDER_INVALID_RESPONSE",
      message,
      pointer,
      severity: "error",
    });
  if (diagnostics.length) return { valid: false, diagnostics };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Answers must be an object");
    return { valid: false, diagnostics };
  }
  const answers = value as Record<string, Answer>;
  if (
    Object.keys(questions).sort().join("\0") !==
    Object.keys(answers).sort().join("\0")
  )
    fail("Answer keys must exactly match question keys");
  for (const [id, q] of Object.entries(questions)) {
    const a = answers[id];
    if (!validAnswer(a) || !a || a.kind !== q.kind) {
      fail(`Invalid answer shape or kind for ${id}`, `/${id}`);
      continue;
    }
    if (q.kind === "binary" || a.kind === "binary") continue;
    const keys =
      q.kind === "choice"
        ? Object.keys(q.options)
        : q.levels.map((_, i) => String(i));
    if (
      keys.sort().join("\0") !== Object.keys(a.probabilities).sort().join("\0")
    ) {
      fail(`Probability keys differ for ${id}`, `/${id}/probabilities`);
      continue;
    }
    const total = Object.values(a.probabilities).reduce((s, n) => s + n, 0);
    if (Math.abs(total - 1) > 1e-4)
      fail(`Probabilities must sum to one for ${id}`);
    if (a.kind === "choice" && q.kind === "choice") {
      if (
        !Object.hasOwn(q.options, a.value) ||
        a.probabilities[a.value] <
          Math.max(...Object.values(a.probabilities)) - 1e-4
      )
        fail(`Selected choice must be a maximum-probability option for ${id}`);
    } else if (a.kind === "score" && q.kind === "score") {
      const mean = Object.entries(a.probabilities).reduce(
        (s, [k, n]) => s + Number(k) * n,
        0,
      );
      if (a.value > q.levels.length - 1 || Math.abs(a.value - mean) > 1e-4)
        fail(`Score must match its weighted mean for ${id}`);
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}
