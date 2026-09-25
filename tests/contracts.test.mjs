import test from "node:test";
import assert from "node:assert/strict";
import {
  validateWorkflow,
  validateSuite,
  validateFixtures,
  validateAnswers,
  parseJson,
  inspectJson,
} from "@pathsmith/contracts";
import { canonicalize, workflowHashes } from "@pathsmith/core";
import {
  baseline,
  candidate,
  suite,
  fixtures,
  minimal,
  literal,
  ref,
} from "./helpers.mjs";

test("AC-01: supplied artifacts validate without mutation", () => {
  for (const w of [baseline, candidate]) {
    assert.deepEqual(validateWorkflow(w), { valid: true, diagnostics: [] });
    assert.equal(validateSuite(suite, w).valid, true);
  }
  assert.equal(validateFixtures(fixtures).valid, true);
  for (const entry of fixtures.entries)
    assert.equal(
      validateAnswers(entry.request.questions, entry.response.answers).valid,
      true,
    );
});

test("reserved executable IDs cannot become object-map keys", () => {
  for (const key of ["constructor", "prototype"]) {
    const workflow = minimal();
    workflow.nodes[1].outcomeId = key;
    assert(
      validateWorkflow(workflow).diagnostics.some(
        (d) => d.code === "UNSAFE_IDENTIFIER",
      ),
    );
  }
});

test("statically present transform object fields and array indexes remain usable", () => {
  for (const value of [
    { op: "object", fields: { copied: ref("input", "value") } },
    { op: "array", items: [ref("input", "value")] },
  ]) {
    const workflow = minimal();
    workflow.nodes.splice(1, 0, {
      id: "copy",
      kind: "transform",
      label: "Copy",
      value,
    });
    workflow.edges[0].target = "copy";
    workflow.edges.push({
      id: "copy_next",
      source: "copy",
      port: "next",
      target: "finish",
    });
    workflow.nodes[2].value = ref(
      "outputs",
      "copy",
      value.op === "object" ? "copied" : 0,
    );
    assert.equal(validateWorkflow(workflow).valid, true);
  }
});
const invalidMutations = [
  [
    "duplicate node",
    (w) => w.nodes.push(structuredClone(w.nodes[0])),
    "DUPLICATE_ID",
  ],
  [
    "duplicate edge",
    (w) => w.edges.push(structuredClone(w.edges[0])),
    "DUPLICATE_ID",
  ],
  [
    "missing default",
    (w) =>
      (w.edges = w.edges.filter((e) => e.id !== "e_confidence_gate_default")),
    "PORT_INVALID",
  ],
  [
    "two edges on port",
    (w) => w.edges.push({ ...w.edges[0], id: "duplicate_port" }),
    "PORT_INVALID",
  ],
  [
    "unknown target",
    (w) => (w.edges[0].target = "missing"),
    "EDGE_NODE_UNKNOWN",
  ],
  ["cycle", (w) => (w.edges[0].target = "start"), "GRAPH_CYCLE"],
  [
    "disconnected node",
    (w) =>
      w.nodes.push({
        id: "orphan",
        kind: "output",
        label: "Orphan",
        outcomeId: "orphan",
        value: literal({
          queue: "manual",
          priority: "review",
          requiresReview: true,
        }),
      }),
    "NODE_DISCONNECTED",
  ],
  [
    "two starts",
    (w) => w.nodes.push({ id: "another_start", kind: "start", label: "Other" }),
    "START_INVALID",
  ],
  [
    "output edge",
    (w) =>
      w.edges.push({
        id: "output_edge",
        source: "out_manual",
        port: "next",
        target: "start",
      }),
    "PORT_INVALID",
  ],
  [
    "reserved case",
    (w) => (w.nodes.find((n) => n.kind === "branch").cases[0].id = "default"),
    "BRANCH_CASE_INVALID",
  ],
  [
    "undeclared binding",
    (w) => (w.nodes.find((n) => n.kind === "judgment").binding = "other"),
    "BINDING_UNDECLARED",
  ],
  [
    "same-judgment reference",
    (w) =>
      (w.nodes.find((n) => n.id === "assess_request").state = ref(
        "outputs",
        "assess_request",
      )),
    "OUTPUT_NOT_DOMINATING",
  ],
  [
    "whole outputs",
    (w) =>
      (w.nodes.find((n) => n.id === "assess_request").state = ref("outputs")),
    "OUTPUT_REFERENCE_INVALID",
  ],
  [
    "result in node",
    (w) =>
      (w.nodes.find((n) => n.id === "assess_request").state = ref("result")),
    "REFERENCE_ROOT_INVALID",
  ],
  [
    "nonproducer output",
    (w) =>
      (w.nodes.find((n) => n.id === "assess_request").state = ref(
        "outputs",
        "start",
      )),
    "OUTPUT_REFERENCE_INVALID",
  ],
  [
    "unknown answer field",
    (w) =>
      w.nodes
        .find((n) => n.id === "confidence_gate")
        .cases[0].when.left.path.push("unexpected"),
    "REFERENCE_PATH_INVALID",
  ],
  [
    "remote schema",
    (w) => (w.inputSchema.$ref = "https://example.com/schema"),
    "SCHEMA_INVALID",
  ],
  [
    "inapplicable schema keyword",
    (w) => (w.inputSchema.minLength = 1),
    "DATA_SCHEMA_INVALID",
  ],
  [
    "unsupported format",
    (w) => (w.formatVersion = "99.0"),
    "UNSUPPORTED_FORMAT",
  ],
  [
    "whitespace rubric",
    (w) =>
      (w.nodes.find(
        (n) => n.id === "assess_request",
      ).questions.department.options.billing = "   "),
    "QUESTION_INVALID",
  ],
];
for (const [name, mutate, code] of invalidMutations)
  test(`AC-02/06/20: rejects ${name}`, () => {
    const w = structuredClone(baseline);
    mutate(w);
    const actual = validateWorkflow(w);
    assert.equal(actual.valid, false);
    assert(
      actual.diagnostics.some((d) => d.code === code),
      JSON.stringify(actual),
    );
  });
test("AC-03: ancestor that does not dominate merge cannot supply output", () => {
  const w = minimal();
  w.nodes.splice(
    1,
    0,
    {
      id: "branch",
      kind: "branch",
      label: "Branch",
      cases: [{ id: "yes", when: literal(true) }],
    },
    { id: "producer", kind: "transform", label: "Producer", value: literal(7) },
  );
  w.nodes.at(-1).value = ref("outputs", "producer");
  w.edges = [
    { id: "a", source: "start", port: "next", target: "branch" },
    { id: "b", source: "branch", port: "yes", target: "producer" },
    { id: "c", source: "branch", port: "default", target: "finish" },
    { id: "d", source: "producer", port: "next", target: "finish" },
  ];
  assert(
    validateWorkflow(w).diagnostics.some(
      (d) => d.code === "OUTPUT_NOT_DOMINATING",
    ),
  );
});
test("optional inputs need an exists/coalesce guard and array indices are numeric", () => {
  const w = minimal();
  w.inputSchema.required = [];
  assert(
    validateWorkflow(w).diagnostics.some(
      (d) => d.code === "OPTIONAL_REFERENCE_UNGUARDED",
    ),
  );
  w.nodes[1].value = {
    op: "coalesce",
    args: [ref("input", "value"), literal(0)],
  };
  assert.equal(validateWorkflow(w).valid, true);
  w.nodes[1].value = {
    op: "and",
    args: [
      { op: "exists", value: ref("input", "value") },
      { op: "gte", left: ref("input", "value"), right: literal(0) },
    ],
  };
  assert.equal(validateWorkflow(w).valid, true);
  w.inputSchema = { type: "array", items: { type: "number" } };
  w.nodes[1].value = { op: "coalesce", args: [ref("input", "0"), literal(0)] };
  assert(
    validateWorkflow(w).diagnostics.some(
      (d) => d.code === "REFERENCE_PATH_INVALID",
    ),
  );
});
test("hostile JSON, keys, depth, AST count and import bounds rejected", () => {
  for (const key of ["__proto__", "prototype", "constructor"]) {
    assert.throws(() => parseJson(`{"${key}":{}}`));
    const w = minimal();
    w.nodes[1].value = ref("input", key);
    assert.equal(validateWorkflow(w).valid, false);
  }
  assert.throws(() => canonicalize({ n: Infinity }));
  assert.throws(() => canonicalize({ n: NaN }));
  assert.throws(() => canonicalize({ n: undefined }));
  const cyclic = {};
  cyclic.self = cyclic;
  assert(inspectJson(cyclic).length);
  const w = minimal();
  let expr = literal(true);
  for (let i = 0; i < 17; i++) expr = { op: "not", value: expr };
  w.nodes[1].value = expr;
  assert(
    validateWorkflow(w).diagnostics.some(
      (d) => d.code === "RUN_LIMIT_EXCEEDED",
    ),
  );
  w.nodes[1].value = {
    op: "array",
    items: Array.from({ length: 2001 }, () => literal(1)),
  };
  assert(
    validateWorkflow(w).diagnostics.some(
      (d) => d.code === "RUN_LIMIT_EXCEEDED",
    ),
  );
  w.description = "x".repeat(512 * 1024);
  assert.equal(validateWorkflow(w).valid, false);
});
test("AC-15: semantic hash ignores labels/metadata/order, preserves expression edits", () => {
  const a = workflowHashes(baseline),
    w = structuredClone(baseline);
  w.name = "Rename";
  w.description = "New description";
  w.nodes[0].label = "Renamed";
  w.nodes.reverse();
  w.edges.reverse();
  const b = workflowHashes(w);
  assert.equal(a.workflowSemanticHash, b.workflowSemanticHash);
  assert.notEqual(a.artifactHash, b.artifactHash);
  assert.notEqual(
    a.workflowSemanticHash,
    workflowHashes(candidate).workflowSemanticHash,
  );
  assert.equal(canonicalize({ z: 2, a: 1 }), "{" + '"a":1,"z":2}');
});
test("suite empty expectations, unknown forbidden nodes, contradiction, duplicates, invalid inputs, selections fail", () => {
  const mutations = [
    (s) => (s.scenarios[0].expected = {}),
    (s) => (s.scenarios[0].expected.forbiddenNodes = ["missing"]),
    (s) => (s.scenarios[0].expected.forbiddenNodes = ["assess_request"]),
    (s) => s.scenarios.push(s.scenarios[0]),
    (s) => (s.scenarios[0].input = { message: 3 }),
    (s) => (s.scenarios[0].expected.allowedOutcomes = ["nonexistent"]),
  ];
  for (const mutate of mutations) {
    const s = structuredClone(suite);
    mutate(s);
    assert.equal(validateSuite(s, baseline).valid, false);
  }
  assert.equal(validateSuite(suite, baseline, ["missing"]).valid, false);
  assert.equal(validateSuite(suite, baseline, []).valid, false);
});
test("AC-11: fractional scores, exact keys, sums, maxima, no binary confidence", () => {
  const entry = fixtures.entries[0];
  const answer = entry.response.answers;
  assert.equal(validateAnswers(entry.request.questions, answer).valid, true);
  const mutations = [
    (a) => (a.time_sensitive.confidence = 0.9),
    (a) => (a.department.probabilities.billing = -0.1),
    (a) => (a.department.probabilities.extra = 0),
    (a) => (a.department.value = "missing"),
    (a) => (a.impact.value = 100),
    (a) => (a.impact.probabilities["0"] = 0.5),
    (a) => (a.department.confidence = Infinity),
    (a) => delete a.impact,
    (a) => (a.extra = a.department),
    (a) => (a.department.kind = "score"),
  ];
  for (const mutate of mutations) {
    const a = structuredClone(answer);
    mutate(a);
    assert.equal(validateAnswers(entry.request.questions, a).valid, false);
  }
  assert(
    fixtures.entries.some((e) =>
      Object.values(e.response.answers).some(
        (a) => a.kind === "score" && !Number.isInteger(a.value),
      ),
    ),
  );
});
