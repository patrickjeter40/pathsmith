import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { schemas } from "./generated/schemas.js";
import {
  byteLength,
  forbiddenKeys,
  inspectJson,
  pointerPart,
} from "./safety.js";
import type {
  DataSchema,
  Diagnostic,
  ExecutionProfile,
  Expr,
  Suite,
  ValidationResult,
  Workflow,
  WorkflowNode,
} from "./types.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: false,
});
const validators = {
  workflow: ajv.compile(schemas.workflow),
  suite: ajv.compile(schemas.suite),
  fixtures: ajv.compile(schemas["mock-fixtures"]),
};
const error = (
  code: string,
  message: string,
  pointer = "",
  nodeId?: string,
): Diagnostic => ({
  code,
  message,
  pointer,
  ...(nodeId ? { nodeId } : {}),
  severity: "error",
});
const result = (diagnostics: Diagnostic[]): ValidationResult => ({
  valid: !diagnostics.some((d) => d.severity === "error"),
  diagnostics,
});
function shape(
  value: unknown,
  validator: ValidateFunction,
  maxBytes: number,
): Diagnostic[] {
  const diagnostics = inspectJson(value, maxBytes);
  if (diagnostics.length) return diagnostics;
  if (
    value &&
    typeof value === "object" &&
    "formatVersion" in value &&
    value.formatVersion !== "0.1"
  )
    return [
      error(
        "UNSUPPORTED_FORMAT",
        "Only formatVersion 0.1 is supported",
        "/formatVersion",
      ),
    ];
  if (!validator(value))
    diagnostics.push(
      ...(validator.errors ?? [])
        .slice(0, 50)
        .map((e) =>
          error(
            "SCHEMA_INVALID",
            `${e.message ?? "Invalid shape"} (${e.schemaPath})`,
            e.instancePath,
          ),
        ),
    );
  return diagnostics;
}
export function validateFixtures(value: unknown): ValidationResult {
  return result(shape(value, validators.fixtures, 8 * 1024 * 1024));
}

export function requiredPorts(node: WorkflowNode): string[] {
  return node.kind === "output"
    ? []
    : node.kind === "branch"
      ? [...node.cases.map((c) => c.id), "default"]
      : ["next"];
}
export function nodeExpressions(
  node: WorkflowNode,
): { expression: Expr; pointer: string }[] {
  if (node.kind === "judgment")
    return [{ expression: node.state, pointer: "/state" }];
  if (node.kind === "transform" || node.kind === "output")
    return [{ expression: node.value, pointer: "/value" }];
  if (node.kind === "branch")
    return node.cases.map((c, i) => ({
      expression: c.when,
      pointer: `/cases/${i}/when`,
    }));
  return [];
}
function schemaSemantics(
  schema: DataSchema,
  pointer: string,
  diagnostics: Diagnostic[],
) {
  const groups = [
    [["properties", "required", "additionalProperties"], ["object"]],
    [["items", "minItems", "maxItems"], ["array"]],
    [["minLength", "maxLength"], ["string"]],
    [
      ["minimum", "maximum"],
      ["number", "integer"],
    ],
  ];
  for (const [keys, types] of groups)
    for (const key of keys)
      if (key in schema && !types.includes(schema.type))
        diagnostics.push(
          error(
            "DATA_SCHEMA_INVALID",
            `${key} does not apply to ${schema.type}`,
            `${pointer}/${key}`,
          ),
        );
  for (const [lower, upper] of [
    ["minimum", "maximum"],
    ["minLength", "maxLength"],
    ["minItems", "maxItems"],
  ] as const)
    if (
      schema[lower] !== undefined &&
      schema[upper] !== undefined &&
      schema[lower]! > schema[upper]!
    )
      diagnostics.push(
        error("DATA_SCHEMA_INVALID", `${lower} exceeds ${upper}`, pointer),
      );
  if (
    schema.required?.some((key) => !Object.hasOwn(schema.properties ?? {}, key))
  )
    diagnostics.push(
      error(
        "DATA_SCHEMA_INVALID",
        "Required fields must be declared in properties",
        `${pointer}/required`,
      ),
    );
  if (schema.type === "array" && !schema.items)
    diagnostics.push(
      error(
        "DATA_SCHEMA_INVALID",
        "Array schemas require items",
        `${pointer}/items`,
      ),
    );
  if (schema.enum) {
    const { enum: values, ...withoutEnum } = schema;
    try {
      const valid = ajv.compile(withoutEnum);
      if (
        values.some((v) => !valid(v)) ||
        new Set(values.map((v) => JSON.stringify(v))).size !== values.length
      )
        diagnostics.push(
          error(
            "DATA_SCHEMA_INVALID",
            "Enum values must be unique and conform to the schema",
            `${pointer}/enum`,
          ),
        );
    } catch {
      diagnostics.push(
        error("DATA_SCHEMA_INVALID", "Invalid data schema", pointer),
      );
    }
  }
  for (const [key, child] of Object.entries(schema.properties ?? {}))
    schemaSemantics(
      child,
      `${pointer}/properties/${pointerPart(key)}`,
      diagnostics,
    );
  if (schema.items)
    schemaSemantics(schema.items, `${pointer}/items`, diagnostics);
}
export function validateData(
  schema: DataSchema,
  value: unknown,
): ValidationResult {
  const diagnostics = inspectJson(value);
  if (diagnostics.length) return result(diagnostics);
  try {
    const validate = ajv.compile(schema);
    if (!validate(value))
      diagnostics.push(
        ...(validate.errors ?? []).map((e) =>
          error("INPUT_INVALID", e.message ?? "Invalid data", e.instancePath),
        ),
      );
  } catch {
    diagnostics.push(
      error("DATA_SCHEMA_INVALID", "Data schema cannot be compiled"),
    );
  }
  return result(diagnostics);
}

function answerSchema(
  node: Extract<WorkflowNode, { kind: "judgment" }>,
): DataSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(node.questions),
    properties: Object.fromEntries(
      Object.entries(node.questions).map(([key, q]) => {
        const fields: Record<string, DataSchema> =
          q.kind === "binary"
            ? { kind: { type: "string" }, probabilityTrue: { type: "number" } }
            : {
                kind: { type: "string" },
                value: { type: q.kind === "choice" ? "string" : "number" },
                confidence: { type: "number" },
                probabilities: {
                  type: "object",
                  additionalProperties: false,
                  properties: Object.fromEntries(
                    (q.kind === "choice"
                      ? Object.keys(q.options)
                      : q.levels.map((_, i) => String(i))
                    ).map((k) => [k, { type: "number" }]),
                  ),
                  required:
                    q.kind === "choice"
                      ? Object.keys(q.options)
                      : q.levels.map((_, i) => String(i)),
                },
              };
        return [
          key,
          {
            type: "object",
            properties: fields,
            required: Object.keys(fields),
            additionalProperties: false,
          },
        ];
      }),
    ),
  };
}
function inferSchema(expr: Expr): DataSchema | undefined {
  if (expr.op === "object")
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(expr.fields).flatMap(([k, v]) => {
          const s = inferSchema(v);
          return s ? [[k, s]] : [];
        }),
      ),
      required: Object.keys(expr.fields),
      additionalProperties: true,
    };
  if (expr.op === "literal") {
    const value = expr.value;
    if (value === null) return { type: "null" };
    if (Array.isArray(value))
      return { type: "array", minItems: value.length, maxItems: value.length };
    if (typeof value === "object")
      return {
        type: "object",
        additionalProperties: false,
        required: Object.keys(value),
        properties: Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k,
            inferSchema({ op: "literal", value: v })!,
          ]),
        ),
      };
    return { type: typeof value as "string" | "number" | "boolean" };
  }
  if (
    [
      "eq",
      "ne",
      "gt",
      "gte",
      "lt",
      "lte",
      "in",
      "and",
      "or",
      "not",
      "exists",
    ].includes(expr.op)
  )
    return { type: "boolean" };
  if (["add", "sub", "mul", "div"].includes(expr.op)) return { type: "number" };
  if (expr.op === "array")
    return {
      type: "array",
      minItems: expr.items.length,
      maxItems: expr.items.length,
    };
  return undefined;
}
type ExprContext = {
  workflow: Workflow;
  node?: WorkflowNode;
  dominators?: Map<string, Set<string>>;
  assertions?: boolean;
  count: { value: number };
};
function checkExpr(
  expr: Expr,
  pointer: string,
  context: ExprContext,
  diagnostics: Diagnostic[],
  depth = 1,
  handlesMissing = false,
  known = new Set<string>(),
) {
  const fail = (code: string, message: string) =>
    diagnostics.push(error(code, message, pointer, context.node?.id));
  if (++context.count.value > 2000) {
    if (context.count.value === 2001)
      fail("RUN_LIMIT_EXCEEDED", "At most 2,000 AST nodes are allowed");
    return;
  }
  if (depth > 16) {
    fail("RUN_LIMIT_EXCEEDED", "Expression depth exceeds 16");
    return;
  }
  const child = (e: Expr, p: string, safe = handlesMissing, guards = known) =>
    checkExpr(
      e,
      `${pointer}/${p}`,
      context,
      diagnostics,
      depth + 1,
      safe,
      guards,
    );
  if (expr.op === "ref") {
    if (expr.path.some((p) => typeof p === "string" && forbiddenKeys.has(p))) {
      fail("UNSAFE_REFERENCE", "Unsafe path key");
      return;
    }
    const [root, producerId, ...rest] = expr.path;
    let schema: DataSchema | undefined;
    let tail: (string | number)[] = expr.path.slice(1);
    if (root === "input") schema = context.workflow.inputSchema;
    else if (root === "result" && context.assertions)
      schema = {
        type: "object",
        properties: {
          outcomeId: { type: "string" },
          value: context.workflow.outputSchema,
        },
        required: ["outcomeId", "value"],
        additionalProperties: false,
      };
    else if (root === "outputs") {
      if (typeof producerId !== "string") {
        fail(
          "OUTPUT_REFERENCE_INVALID",
          "Output references require a producer node ID",
        );
        return;
      }
      const producer = context.workflow.nodes.find((n) => n.id === producerId);
      if (
        !producer ||
        (producer.kind !== "judgment" && producer.kind !== "transform")
      ) {
        fail(
          "OUTPUT_REFERENCE_INVALID",
          "Only judgments and transforms produce reusable outputs",
        );
        return;
      }
      if (
        !context.assertions &&
        (producerId === context.node?.id ||
          !context.dominators?.get(context.node!.id)?.has(producerId))
      )
        fail(
          "OUTPUT_NOT_DOMINATING",
          `${producerId} must strictly dominate ${context.node?.id}`,
        );
      schema =
        producer.kind === "judgment"
          ? answerSchema(producer)
          : inferSchema(producer.value);
      tail = rest;
    } else {
      fail(
        "REFERENCE_ROOT_INVALID",
        "Reference root must be input or outputs (or result in assertions)",
      );
      return;
    }
    let optional = false;
    for (const segment of tail) {
      if (!schema) break;
      if (schema.type === "object" && typeof segment === "string") {
        if (!Object.hasOwn(schema.properties ?? {}, segment)) {
          if (schema.additionalProperties === false)
            fail("REFERENCE_PATH_INVALID", `Unknown field: ${segment}`);
          optional ||= !(schema.required ?? []).includes(segment);
          schema = undefined;
        } else {
          optional ||= !(schema.required ?? []).includes(segment);
          schema = schema.properties![segment];
        }
      } else if (schema.type === "array" && typeof segment === "number") {
        optional ||=
          schema.minItems === undefined || segment >= schema.minItems;
        schema = schema.items;
      } else {
        fail(
          "REFERENCE_PATH_INVALID",
          "Path segment does not match its container type",
        );
        break;
      }
    }
    if (optional && !handlesMissing && !known.has(JSON.stringify(expr.path)))
      fail(
        "OPTIONAL_REFERENCE_UNGUARDED",
        "Optional fields require exists or coalesce handling",
      );
  } else if (expr.op === "object")
    for (const [key, value] of Object.entries(expr.fields))
      child(value, `fields/${pointerPart(key)}`, false);
  else if (expr.op === "array")
    expr.items.forEach((v, i) => child(v, `items/${i}`, false));
  else if ("left" in expr) {
    child(expr.left, "left", false);
    child(expr.right, "right", false);
  } else if ("args" in expr) {
    const guards = new Set(known);
    expr.args.forEach((arg, i) => {
      child(arg, `args/${i}`, expr.op === "coalesce", guards);
      if (expr.op === "and" && arg.op === "exists" && arg.value.op === "ref")
        guards.add(JSON.stringify(arg.value.path));
    });
  } else if (expr.op === "not" || expr.op === "exists")
    child(expr.value, "value", expr.op === "exists");
}

export function validateWorkflow(value: unknown): ValidationResult {
  const diagnostics = shape(value, validators.workflow, 512 * 1024);
  if (diagnostics.length) return result(diagnostics);
  const workflow = value as Workflow;
  schemaSemantics(workflow.inputSchema, "/inputSchema", diagnostics);
  schemaSemantics(workflow.outputSchema, "/outputSchema", diagnostics);
  const nodes = new Map<string, WorkflowNode>();
  for (const [i, node] of workflow.nodes.entries()) {
    if (
      forbiddenKeys.has(node.id) ||
      (node.kind === "output" && forbiddenKeys.has(node.outcomeId))
    ) {
      diagnostics.push(
        error(
          "UNSAFE_IDENTIFIER",
          "Executable IDs cannot use reserved object keys",
          `/nodes/${i}`,
          node.id,
        ),
      );
    }
    if (nodes.has(node.id))
      diagnostics.push(
        error(
          "DUPLICATE_ID",
          `Duplicate node ${node.id}`,
          `/nodes/${i}/id`,
          node.id,
        ),
      );
    nodes.set(node.id, node);
    if (node.kind === "branch") {
      const ids = node.cases.map((c) => c.id);
      if (
        ids.some((id) => id === "default" || id === "next") ||
        new Set(ids).size !== ids.length
      )
        diagnostics.push(
          error(
            "BRANCH_CASE_INVALID",
            "Case IDs must be unique and cannot be default or next",
            `/nodes/${i}/cases`,
            node.id,
          ),
        );
    }
    if (node.kind === "judgment" && !workflow.bindings.includes(node.binding))
      diagnostics.push(
        error(
          "BINDING_UNDECLARED",
          `Undeclared binding ${node.binding}`,
          `/nodes/${i}/binding`,
          node.id,
        ),
      );
    if (node.kind === "judgment")
      for (const q of Object.values(node.questions))
        if (
          !q.instructions.trim() ||
          (q.kind === "choice" &&
            Object.entries(q.options).some(
              ([k, v]) => !k.trim() || !v.trim(),
            )) ||
          (q.kind === "score" && q.levels.some((v) => !v.trim())) ||
          (q.kind === "binary" &&
            [q.trueCriteria, q.falseCriteria].some(
              (v) => v !== undefined && !v.trim(),
            ))
        )
          diagnostics.push(
            error(
              "QUESTION_INVALID",
              "Question and rubric descriptions must be meaningful",
              `/nodes/${i}/questions`,
              node.id,
            ),
          );
  }
  const starts = workflow.nodes.filter((n) => n.kind === "start");
  if (starts.length !== 1)
    diagnostics.push(
      error("START_INVALID", "Exactly one start node is required", "/nodes"),
    );
  const incoming = new Map(workflow.nodes.map((n) => [n.id, [] as string[]]));
  const outgoing = new Map(workflow.nodes.map((n) => [n.id, [] as string[]]));
  const edgeIds = new Set<string>();
  for (const [i, edge] of workflow.edges.entries()) {
    if (edgeIds.has(edge.id))
      diagnostics.push(
        error("DUPLICATE_ID", `Duplicate edge ${edge.id}`, `/edges/${i}/id`),
      );
    edgeIds.add(edge.id);
    if (!nodes.has(edge.source) || !nodes.has(edge.target))
      diagnostics.push(
        error("EDGE_NODE_UNKNOWN", "Edge endpoints must exist", `/edges/${i}`),
      );
    else {
      incoming.get(edge.target)!.push(edge.source);
      outgoing.get(edge.source)!.push(edge.target);
    }
  }
  for (const [i, node] of workflow.nodes.entries()) {
    const ports = requiredPorts(node),
      edges = workflow.edges.filter((e) => e.source === node.id);
    for (const port of ports)
      if (edges.filter((e) => e.port === port).length !== 1)
        diagnostics.push(
          error(
            "PORT_INVALID",
            `Port ${port} requires exactly one edge`,
            `/nodes/${i}`,
            node.id,
          ),
        );
    if (edges.some((e) => !ports.includes(e.port)))
      diagnostics.push(
        error(
          "PORT_INVALID",
          "Unexpected outgoing port",
          `/nodes/${i}`,
          node.id,
        ),
      );
    if (node.kind === "start" && incoming.get(node.id)!.length)
      diagnostics.push(
        error(
          "START_INVALID",
          "Start cannot have incoming edges",
          `/nodes/${i}`,
          node.id,
        ),
      );
  }
  const degree = new Map([...incoming].map(([k, v]) => [k, v.length]));
  const ready = [...degree].filter(([, n]) => n === 0).map(([id]) => id),
    order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const target of outgoing.get(id) ?? []) {
      degree.set(target, degree.get(target)! - 1);
      if (degree.get(target) === 0) ready.push(target);
    }
  }
  if (order.length !== nodes.size)
    diagnostics.push(
      error("GRAPH_CYCLE", "Workflows must be acyclic", "/edges"),
    );
  const reached = new Set<string>();
  const visit = (id: string) => {
    if (reached.has(id)) return;
    reached.add(id);
    for (const child of outgoing.get(id) ?? []) visit(child);
  };
  if (starts.length === 1) visit(starts[0].id);
  for (const node of workflow.nodes)
    if (!reached.has(node.id))
      diagnostics.push(
        error(
          "NODE_DISCONNECTED",
          "Node is not reachable from start",
          "/nodes",
          node.id,
        ),
      );
  const terminates = new Set<string>();
  for (const id of [...order].reverse())
    if (
      nodes.get(id)!.kind === "output" ||
      ((outgoing.get(id)?.length ?? 0) > 0 &&
        outgoing.get(id)!.every((next) => terminates.has(next)))
    )
      terminates.add(id);
  if (order.length === nodes.size)
    for (const node of workflow.nodes)
      if (!terminates.has(node.id))
        diagnostics.push(
          error(
            "PATH_NOT_TERMINATING",
            "Every path must end at an output",
            "/nodes",
            node.id,
          ),
        );
  const dominators = new Map<string, Set<string>>();
  for (const id of order) {
    const parents = incoming.get(id)!;
    const shared = parents.length
      ? new Set(dominators.get(parents[0]) ?? [])
      : new Set<string>();
    for (const parent of parents.slice(1))
      for (const candidate of shared)
        if (!dominators.get(parent)?.has(candidate)) shared.delete(candidate);
    shared.add(id);
    dominators.set(id, shared);
  }
  const count = { value: 0 };
  workflow.nodes.forEach((node, i) =>
    nodeExpressions(node).forEach(({ expression, pointer }) =>
      checkExpr(
        expression,
        `/nodes/${i}${pointer}`,
        { workflow, node, dominators, count },
        diagnostics,
      ),
    ),
  );
  for (const binding of workflow.bindings)
    if (
      !workflow.nodes.some(
        (n) => n.kind === "judgment" && n.binding === binding,
      )
    )
      diagnostics.push({
        code: "BINDING_UNUSED",
        message: `Binding ${binding} is unused`,
        pointer: "/bindings",
        severity: "warning",
      });
  return result(diagnostics);
}

export function validateSuite(
  value: unknown,
  workflow: Workflow,
  selectedIds?: string[],
): ValidationResult {
  const diagnostics = shape(value, validators.suite, 8 * 1024 * 1024);
  if (diagnostics.length) return result(diagnostics);
  const suite = value as Suite;
  const ids = new Set<string>(),
    nodeIds = new Set(workflow.nodes.map((n) => n.id)),
    outcomes = new Set(
      workflow.nodes.flatMap((n) => (n.kind === "output" ? [n.outcomeId] : [])),
    );
  for (const [i, scenario] of suite.scenarios.entries()) {
    const pointer = `/scenarios/${i}`;
    const fail = (code: string, message: string) =>
      diagnostics.push({
        ...error(code, message, pointer),
        scenarioId: scenario.id,
      });
    if (ids.has(scenario.id)) fail("DUPLICATE_ID", "Duplicate scenario ID");
    ids.add(scenario.id);
    if (!selectedIds || selectedIds.includes(scenario.id)) {
      if (byteLength(scenario.input) > 64 * 1024)
        fail("RUN_LIMIT_EXCEEDED", "Scenario input exceeds 64 KiB");
      diagnostics.push(
        ...validateData(workflow.inputSchema, scenario.input).diagnostics.map(
          (d) => ({
            ...d,
            pointer: pointer + "/input" + d.pointer,
            scenarioId: scenario.id,
          }),
        ),
      );
    }
    if (scenario.expected) {
      const expected = scenario.expected;
      if (!Object.values(expected).some((v) => v.length > 0))
        fail("EXPECTATION_EMPTY", "Omit expected for an unlabeled scenario");
      if (expected.allowedOutcomes?.some((id) => !outcomes.has(id)))
        fail("EXPECTATION_INVALID", "Unknown allowed outcome");
      if (
        [
          ...(expected.requiredNodes ?? []),
          ...(expected.forbiddenNodes ?? []),
        ].some((id) => !nodeIds.has(id))
      )
        fail("EXPECTATION_INVALID", "Unknown expected node");
      if (
        expected.requiredNodes?.some((id) =>
          expected.forbiddenNodes?.includes(id),
        )
      )
        fail(
          "EXPECTATION_INVALID",
          "Required and forbidden nodes contradict each other",
        );
      const count = { value: 0 };
      expected.assertions?.forEach((expr, j) =>
        checkExpr(
          expr,
          `${pointer}/expected/assertions/${j}`,
          { workflow, assertions: true, count },
          diagnostics,
        ),
      );
    }
  }
  if (
    selectedIds &&
    (!selectedIds.length ||
      new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.some((id) => !ids.has(id)))
  )
    diagnostics.push(
      error("SELECTION_INVALID", "Select unique existing scenario IDs"),
    );
  return result(diagnostics);
}

export function validateProfile(
  value: unknown,
  workflow: Workflow,
): ValidationResult {
  const diagnostics = inspectJson(value, 64 * 1024);
  if (diagnostics.length) return result(diagnostics);
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result([error("PROFILE_INVALID", "Expected execution profile")]);
  const profile = value as ExecutionProfile;
  if (
    profile.formatVersion !== "0.1" ||
    !profile.bindings ||
    typeof profile.bindings !== "object" ||
    Array.isArray(profile.bindings) ||
    Object.keys(profile).some((k) => !["formatVersion", "bindings"].includes(k))
  )
    return result([
      error(
        "PROFILE_INVALID",
        "Profile requires only formatVersion and bindings",
      ),
    ]);
  for (const [name, binding] of Object.entries(profile.bindings))
    if (
      !binding ||
      typeof binding !== "object" ||
      Array.isArray(binding) ||
      Object.keys(binding).sort().join(",") !== "model,providerId" ||
      typeof binding.model !== "string" ||
      !binding.model.trim() ||
      typeof binding.providerId !== "string" ||
      !binding.providerId.trim()
    )
      diagnostics.push(error("PROFILE_INVALID", `Invalid binding ${name}`));
  for (const node of workflow.nodes)
    if (
      node.kind === "judgment" &&
      !Object.hasOwn(profile.bindings, node.binding)
    )
      diagnostics.push(
        error("PROVIDER_NOT_CONFIGURED", `Missing binding ${node.binding}`),
      );
  return result(diagnostics);
}
