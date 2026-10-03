import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkflow } from "@pathsmith/contracts";
import { planWorkflowMerge, resolveWorkflowMerge } from "../apps/web/src/workflowMerge.ts";
import { minimal } from "./helpers.mjs";

const clone = structuredClone;
function document() {
  const definition = minimal();
  definition.nodes.splice(1, 0, { id: "route", label: "Route", kind: "branch", cases: [
    { id: "A", when: { op: "literal", value: true } },
    { id: "B", when: { op: "literal", value: false } },
  ] });
  definition.edges[0].target = "route";
  for (const port of ["A", "B", "default"]) definition.edges.push({ id: `route_${port}`, source: "route", port, target: "finish" });
  return { definition, layout: { positions: { start: { x: 0, y: 0 }, route: { x: 10, y: 20 } } } };
}
const branch = (doc) => doc.definition.nodes.find((node) => node.id === "route");
function addCase(doc, id, index = branch(doc).cases.length) {
  branch(doc).cases.splice(index, 0, { id, when: { op: "literal", value: true } });
  doc.definition.edges.push({ id: `route_${id}`, source: "route", port: id, target: "finish" });
}
function choose(plan, choice) {
  return resolveWorkflowMerge(plan, Object.fromEntries(plan.conflicts.map((c) => [c.key, choice])));
}
const order = (result) => branch(result.document).cases.map((c) => c.id);
const routing = (doc) => doc.definition.edges.filter((edge) => edge.source === "route");

test("merge preserves disjoint field/layout edits and treats entity arrays by stable ID", () => {
  const base = document(), local = clone(base), remote = clone(base);
  local.definition.nodes[0].label = "Local start";
  local.definition.nodes.reverse(); local.definition.edges.reverse();
  local.layout.positions.start.x = 44;
  remote.definition.description = "Remote description";
  remote.layout.positions.route.y = 88;
  const plan = planWorkflowMerge(base, local, remote), result = resolveWorkflowMerge(plan);
  assert.equal(plan.conflicts.length, 0); assert.equal(result.valid, true);
  assert.equal(result.document.definition.nodes.find((n) => n.id === "start").label, "Local start");
  assert.equal(result.document.definition.description, "Remote description");
  assert.deepEqual(result.document.definition.nodes.map((n) => n.id), local.definition.nodes.map((n) => n.id));
  assert.deepEqual(result.document.definition.edges.map((e) => e.id), local.definition.edges.map((e) => e.id));
  assert.equal(result.document.layout.positions.start.x, 44); assert.equal(result.document.layout.positions.route.y, 88);
  assert.deepEqual(plan.merged, result.document);
});

test("new ordinary object parents merge disjoint positions and nested definition fields", () => {
  const base = document(); base.layout = {};
  const local = clone(base), remote = clone(base);
  local.layout.positions = { start: { x: 1, y: 0 } };
  remote.layout.positions = { finish: { x: 2, y: 0 } };
  local.definition.inputSchema.properties.extra = { type: "object", properties: { first: { type: "string" } }, required: [], additionalProperties: false };
  remote.definition.inputSchema.properties.extra = { type: "object", properties: { second: { type: "number" } }, required: [], additionalProperties: false };
  const plan = planWorkflowMerge(base, local, remote), result = resolveWorkflowMerge(plan);
  assert.deepEqual(plan.conflicts, []); assert.equal(result.valid, true);
  assert.deepEqual(result.document.layout.positions, { start: { x: 1, y: 0 }, finish: { x: 2, y: 0 } });
  assert.deepEqual(result.document.definition.inputSchema.properties.extra.properties, { first: { type: "string" }, second: { type: "number" } });
  assert.deepEqual(base.layout, {}); assert.equal(Object.hasOwn(base.definition.inputSchema.properties, "extra"), false);
});

test("new-parent merging keeps null and non-object bases distinct and discriminator variants atomic", () => {
  for (const old of [null, [], "previous"]) {
    const base = document(); base.layout.panel = old;
    const local = clone(base), remote = clone(base);
    local.layout.panel = { left: 1 }; remote.layout.panel = { right: 2 };
    const plan = planWorkflowMerge(base, local, remote);
    assert.equal(plan.conflicts.length, 1); assert.deepEqual(plan.conflicts[0].path, ["layout", "panel"]);
    assert.deepEqual(choose(plan, "local").document.layout.panel, { left: 1 });
    assert.deepEqual(choose(plan, "remote").document.layout.panel, { right: 2 });
  }
  for (const discriminator of ["kind", "op"]) {
    const base = document(), local = clone(base), remote = clone(base);
    local.layout.variant = { [discriminator]: "first", local: 1 };
    remote.layout.variant = { [discriminator]: "second", remote: 2 };
    const plan = planWorkflowMerge(base, local, remote);
    assert.equal(plan.conflicts.length, 1); assert.deepEqual(plan.conflicts[0].path, ["layout", "variant"]);
    assert.deepEqual(choose(plan, "local").document.layout.variant, local.layout.variant);
  }
});

test("leaf conflicts require explicit choice and preserve unrelated merged edits", () => {
  const base = document(), local = clone(base), remote = clone(base);
  local.definition.name = "Local"; remote.definition.name = "Remote";
  local.layout.positions.start.x = 45; remote.definition.description = "Keep this";
  const plan = planWorkflowMerge(base, local, remote);
  assert.equal(plan.conflicts.length, 1); assert.deepEqual(plan.conflicts[0].path, ["definition", "name"]);
  assert.equal(plan.merged, null); assert.equal(resolveWorkflowMerge(plan).document, null);
  for (const side of ["local", "remote"]) {
    const result = choose(plan, side);
    assert.equal(result.valid, true); assert.equal(result.document.definition.name, side === "local" ? "Local" : "Remote");
    assert.equal(result.document.definition.description, "Keep this"); assert.equal(result.document.layout.positions.start.x, 45);
  }
  assert.equal(choose(plan, "combine").document, null);
  assert.equal(resolveWorkflowMerge(plan, { stale: "local" }).diagnostics[0].code, "MERGE_CHOICE_INVALID");
});

test("missing keys remain distinct from null; delete/edit and ordinary arrays are atomic", () => {
  const base = document(); base.layout.optional = 1; base.layout.panel = [1, 2];
  const local = clone(base), remote = clone(base);
  delete local.layout.optional; remote.layout.optional = null;
  local.layout.panel = [2, 1]; remote.layout.panel = [1, 2, 3];
  const plan = planWorkflowMerge(base, local, remote);
  assert.equal(plan.conflicts.length, 2);
  const deletion = plan.conflicts.find((c) => c.path.at(-1) === "optional");
  assert.equal(deletion.kind, "delete_edit"); assert.deepEqual(deletion.local, { exists: false });
  assert.deepEqual(deletion.remote, { exists: true, value: null });
  const left = choose(plan, "local"), right = choose(plan, "remote");
  assert.equal(Object.hasOwn(left.document.layout, "optional"), false);
  assert.equal(right.document.layout.optional, null);
  assert.deepEqual(left.document.layout.panel, [2, 1]); assert.deepEqual(right.document.layout.panel, [1, 2, 3]);
});

test("disjoint keys can be added and safe unknown fields survive with honest schema diagnostics", () => {
  const base = document(), local = clone(base), remote = clone(base);
  local.layout.custom = { local: true }; remote.layout.remote = null;
  local.definition.extension = { retained: true };
  const result = resolveWorkflowMerge(planWorkflowMerge(base, local, remote));
  assert.deepEqual(result.document.layout.custom, { local: true }); assert.equal(result.document.layout.remote, null);
  assert.deepEqual(result.document.definition.extension, { retained: true });
  assert.equal(result.valid, false); assert.ok(result.diagnostics.some((d) => d.code === "SCHEMA_INVALID"));
});

test("same-ID additions conflict as whole entities; distinct additions preserve local then remote order", () => {
  const base = document(), local = clone(base), remote = clone(base);
  const node = { id: "extra", label: "Extra", kind: "output", outcomeId: "extra", value: { op: "literal", value: 0 } };
  local.definition.nodes.push(node); remote.definition.nodes.push({ ...node, label: "Different" });
  const collision = planWorkflowMerge(base, local, remote);
  assert.equal(collision.conflicts[0].kind, "identity");
  assert.deepEqual(choose(collision, "local").document.definition.nodes.at(-1), node);
  remote.definition.nodes.at(-1).id = "remote_extra";
  const distinct = resolveWorkflowMerge(planWorkflowMerge(base, local, remote));
  assert.deepEqual(distinct.document.definition.nodes.slice(-2).map((n) => n.id), ["extra", "remote_extra"]);
  assert.equal(distinct.valid, false); // Disconnected additions stay editable, never executable.
});

test("new same-ID edge additions remain atomic without object discriminator fields", () => {
  const base = document(), local = clone(base), remote = clone(base);
  const edge = { id: "new_edge", source: "start", port: "next", target: "finish" };
  local.definition.edges.push(edge);
  remote.definition.edges.push({ ...edge, source: "finish", target: "start" });
  const plan = planWorkflowMerge(base, local, remote);
  assert.equal(plan.conflicts.length, 1); assert.equal(plan.conflicts[0].kind, "identity");
  assert.deepEqual(plan.conflicts[0].path, ["definition", "edges", "new_edge"]);
  assert.deepEqual(choose(plan, "local").document.definition.edges.at(-1), edge);
  assert.deepEqual(choose(plan, "remote").document.definition.edges.at(-1), remote.definition.edges.at(-1));
});

test("node deletion versus edit and kind/op discriminator edits never splice incompatible shapes", () => {
  const base = document(), local = clone(base), remote = clone(base);
  local.definition.nodes = local.definition.nodes.filter((n) => n.id !== "finish");
  remote.definition.nodes.find((n) => n.id === "finish").label = "Keep me";
  let plan = planWorkflowMerge(base, local, remote);
  assert.ok(plan.conflicts.some((c) => c.kind === "delete_edit"));
  assert.equal(choose(plan, "local").valid, false);
  const l = clone(base), r = clone(base);
  l.definition.nodes[2] = { id: "finish", label: "Transform", kind: "transform", value: { op: "literal", value: 3 } };
  r.definition.nodes[2].label = "Remote output";
  plan = planWorkflowMerge(base, l, r);
  assert.deepEqual(plan.conflicts[0].path, ["definition", "nodes", "finish"]);
  assert.deepEqual(choose(plan, "local").document.definition.nodes[2], l.definition.nodes[2]);
  const x = clone(base), y = clone(base);
  x.definition.nodes[2].value = { op: "literal", value: 5 };
  y.definition.nodes[2].value.path = ["input", "other"];
  plan = planWorkflowMerge(base, x, y);
  assert.deepEqual(plan.conflicts[0].path, ["definition", "nodes", "finish", "value"]);
  assert.deepEqual(choose(plan, "local").document.definition.nodes[2].value, { op: "literal", value: 5 });
});

test("explicit Combine preserves required local reorder and exact remote new-case routing", () => {
  const base = document(), local = clone(base), remote = clone(base);
  branch(local).cases.reverse(); addCase(remote, "R");
  local.layout.positions.route.x = 99; remote.definition.description = "Remote edit";
  const plan = planWorkflowMerge(base, local, remote), conflict = plan.conflicts[0];
  assert.equal(plan.conflicts.length, 1); assert.equal(conflict.kind, "branch"); assert.equal(conflict.combineAvailable, true);
  assert.deepEqual(conflict.branch.base.order, ["A", "B"]);
  assert.deepEqual(conflict.branch.local.order, ["B", "A"]);
  assert.deepEqual(conflict.branch.remote.order, ["A", "B", "R"]);
  assert.deepEqual(conflict.branch.combined.order, ["B", "A", "R"]);
  assert.equal(conflict.branch.combined.defaultEdges[0].id, "route_default");
  assert.deepEqual(conflict.branch.combined.destinations.find((e) => e.port === "R"), { edgeId: "route_R", port: "R", target: "finish", targetLabel: "Finish" });
  assert.equal(resolveWorkflowMerge(plan).document, null);
  const result = choose(plan, "combine");
  assert.equal(result.valid, true); assert.deepEqual(order(result), ["B", "A", "R"]);
  assert.deepEqual(routing(result.document), routing(remote));
  assert.equal(result.document.layout.positions.route.x, 99); assert.equal(result.document.definition.description, "Remote edit");
  assert.deepEqual(order(choose(plan, "local")), ["B", "A"]);
  assert.deepEqual(routing(choose(plan, "local").document), routing(local));
  assert.deepEqual(order(choose(plan, "remote")), ["A", "B", "R"]);
});

test("Combine keeps full local list then remote additions, including identical predicates with different IDs", () => {
  const base = document(), local = clone(base), remote = clone(base);
  branch(local).cases.reverse(); addCase(local, "L", 1);
  addCase(remote, "R1", 1); addCase(remote, "R2");
  const plan = planWorkflowMerge(base, local, remote), result = choose(plan, "combine");
  assert.equal(result.valid, true); assert.deepEqual(order(result), ["B", "L", "A", "R1", "R2"]);
  assert.equal(branch(result.document).cases.filter((c) => c.when.value === true).length, 4);
  assert.deepEqual(routing(result.document).map((e) => e.id), [...routing(local).map((e) => e.id), "route_R1", "route_R2"]);
});

test("identical branch units coalesce and unrelated branch labels merge independently of routing", () => {
  const base = document(), local = clone(base), remote = clone(base);
  addCase(local, "X"); addCase(remote, "X"); remote.definition.edges.reverse();
  let plan = planWorkflowMerge(base, local, remote);
  assert.equal(plan.conflicts.length, 0); assert.deepEqual(order(resolveWorkflowMerge(plan)), ["A", "B", "X"]);
  const label = clone(base); branch(label).label = "Local label";
  plan = planWorkflowMerge(base, label, remote);
  assert.equal(plan.conflicts.length, 0); assert.equal(branch(resolveWorkflowMerge(plan).document).label, "Local label");
});

test("Combine rejects edits, deletes, renamed cases, remote reorder, default changes and malformed routing", () => {
  const edits = [
    (doc) => { branch(doc).cases.reverse(); },
    (doc) => { branch(doc).cases[0].when.value = false; },
    (doc) => { branch(doc).cases.splice(0, 1); doc.definition.edges = doc.definition.edges.filter((e) => e.port !== "A"); },
    (doc) => { branch(doc).cases[0].id = "renamed"; doc.definition.edges.find((e) => e.port === "A").port = "renamed"; },
    (doc) => { doc.definition.edges.find((e) => e.port === "default").id = "new_default"; },
    (doc) => { doc.definition.edges.find((e) => e.port === "A").target = "route"; },
    (doc) => { doc.definition.edges = doc.definition.edges.filter((e) => e.port !== "R"); },
    (doc) => { doc.definition.edges.push({ id: "extra_R", source: "route", port: "R", target: "finish" }); },
    (doc) => { doc.definition.edges.push({ id: "unknown_port", source: "route", port: "unknown", target: "finish" }); },
    (doc) => { branch(doc).cases.push(clone(branch(doc).cases[0])); },
  ];
  for (const edit of edits) {
    const base = document(), local = clone(base), remote = clone(base);
    branch(local).cases.reverse(); addCase(local, "L"); addCase(remote, "R"); edit(remote);
    const plan = planWorkflowMerge(base, local, remote);
    assert.equal(plan.conflicts.length, 1); assert.equal(plan.conflicts[0].combineAvailable, false);
    assert.equal(choose(plan, "combine").document, null);
    assert.ok(choose(plan, "remote").document); // Invalid routing is retained with diagnostics, not silently fixed.
  }
});

test("existing case edits on either side disable Combine even when both edits match", () => {
  const base = document(), local = clone(base), remote = clone(base);
  addCase(local, "L"); addCase(remote, "R");
  branch(local).cases[0].when.value = false; branch(remote).cases[0].when.value = false;
  assert.equal(planWorkflowMerge(base, local, remote).conflicts[0].combineAvailable, false);
});

test("branch deletion or kind change resolves its complete node and all outgoing edges together", () => {
  for (const change of ["delete", "kind"]) {
    const base = document(), local = clone(base), remote = clone(base);
    local.definition.edges = local.definition.edges.filter((e) => e.source !== "route");
    if (change === "delete") {
      local.definition.nodes = local.definition.nodes.filter((n) => n.id !== "route");
      local.definition.edges[0].target = "finish";
    } else {
      local.definition.nodes[1] = { id: "route", label: "Transform", kind: "transform", value: { op: "literal", value: 0 } };
      local.definition.edges.push({ id: "route_next", source: "route", port: "next", target: "finish" });
    }
    addCase(remote, "R");
    const plan = planWorkflowMerge(base, local, remote);
    assert.equal(plan.conflicts.length, 1); assert.equal(plan.conflicts[0].combineAvailable, false);
    const kept = choose(plan, "local"); assert.equal(kept.valid, true);
    assert.deepEqual(routing(kept.document), routing(local));
    assert.deepEqual(routing(choose(plan, "remote").document), routing(remote));
  }
});

test("colliding added cases/edges, duplicate IDs and moved routing ownership never auto-merge", () => {
  const base = document(), local = clone(base), remote = clone(base);
  addCase(local, "X"); addCase(remote, "X"); branch(remote).cases.at(-1).when.value = false;
  assert.equal(planWorkflowMerge(base, local, remote).conflicts[0].combineAvailable, false);
  for (const modify of [
    (doc) => { doc.definition.nodes.push(clone(doc.definition.nodes[0])); },
    (doc) => { doc.definition.edges.push(clone(doc.definition.edges[0])); },
    (doc) => { doc.definition.edges.find((e) => e.id === "route_A").source = "start"; },
    (doc) => { doc.definition.edges.find((e) => e.id === "route_X").id = "start_next"; },
  ]) {
    const modified = clone(remote); modify(modified);
    const plan = planWorkflowMerge(base, local, modified);
    assert.ok(plan.conflicts.some((c) => c.kind === "identity" && c.path.join("/") === "definition"));
    assert.equal(plan.merged, null); assert.equal(plan.conflicts.every((c) => !c.combineAvailable), true);
    assert.deepEqual(choose(plan, "remote").document.definition, modified.definition);
  }
  const otherOwner = clone(remote);
  otherOwner.definition.edges.find((e) => e.id === "route_X").source = "start";
  assert.match(planWorkflowMerge(base, local, otherOwner).conflicts[0].reason, /routing owners/);
});

test("assembled graph gets canonical cycle validation even when both edited graphs are valid", () => {
  const base = document();
  for (const id of ["left", "right"]) {
    base.definition.nodes.push({ id, label: id, kind: "transform", value: { op: "literal", value: 0 } });
    base.definition.edges.push({ id: `${id}_next`, source: id, port: "next", target: "finish" });
  }
  base.definition.edges.find((e) => e.port === "A").target = "left";
  base.definition.edges.find((e) => e.port === "B").target = "right";
  const local = clone(base), remote = clone(base);
  local.definition.edges.find((e) => e.id === "left_next").target = "right";
  remote.definition.edges.find((e) => e.id === "right_next").target = "left";
  for (const doc of [base, local, remote]) assert.equal(validateWorkflow(doc.definition).valid, true);
  const result = resolveWorkflowMerge(planWorkflowMerge(base, local, remote));
  assert.equal(result.unresolved.length, 0); assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((d) => d.code.includes("CYCLE")));
});

test("assembled graph gets shared dominance validation rather than browser execution inference", () => {
  const base = document();
  base.definition.nodes.push({ id: "producer", label: "Producer", kind: "transform", value: { op: "literal", value: 1 } });
  base.definition.edges[0].target = "producer";
  base.definition.edges.push({ id: "producer_next", source: "producer", port: "next", target: "route" });
  const local = clone(base), remote = clone(base);
  local.definition.nodes.find((n) => n.id === "finish").value = { op: "ref", path: ["outputs", "producer"] };
  remote.definition.edges[0].target = "route";
  remote.definition.edges.find((e) => e.id === "producer_next").target = "finish";
  remote.definition.edges.find((e) => e.port === "A").target = "producer";
  for (const doc of [base, local, remote]) assert.equal(validateWorkflow(doc.definition).valid, true);
  const result = resolveWorkflowMerge(planWorkflowMerge(base, local, remote));
  assert.equal(result.valid, false); assert.ok(result.diagnostics.some((d) => d.code === "OUTPUT_NOT_DOMINATING"));
});

test("planning/resolution preserve inputs, isolate returned documents, and reject unsafe/over-budget JSON", () => {
  const base = document(), local = clone(base), remote = clone(base);
  branch(local).cases.reverse(); addCase(remote, "R");
  const before = JSON.stringify([base, local, remote]);
  const plan = planWorkflowMerge(base, local, remote);
  const result = choose(plan, "combine"); result.document.definition.name = "Changed returned copy";
  assert.equal(JSON.stringify([base, local, remote]), before);
  remote.definition.name = "Changed caller input";
  assert.equal(choose(plan, "combine").document.definition.name, base.definition.name);
  for (const unsafe of [JSON.parse('{"__proto__":{}}'), { value: "x".repeat(512 * 1024) }, { value: Infinity }]) {
    const invalid = planWorkflowMerge(base, { ...local, layout: unsafe }, remote);
    assert.equal(invalid.sources, null); assert.ok(invalid.diagnostics.some((d) => d.code === "UNSAFE_JSON"));
    assert.equal(resolveWorkflowMerge(invalid).document, null);
  }
});

test("safe malformed routing values are preserved instead of coerced into branch ownership", () => {
  const base = document();
  base.definition.edges.find((edge) => edge.port === "A").source = ["route"];
  const result = resolveWorkflowMerge(planWorkflowMerge(base, clone(base), clone(base)));
  assert.equal(result.valid, false); assert.ok(result.diagnostics.some((d) => d.code === "SCHEMA_INVALID"));
  assert.deepEqual(result.document.definition, base.definition);
});

test("large safe invalid edge collections reach canonical diagnostics with and without branches", () => {
  for (const withBranch of [false, true]) {
    const base = withBranch ? document() : { definition: minimal(), layout: {} };
    base.definition.edges = Array.from({ length: 30_000 }, (_, i) => ({ id: `e${i}` }));
    assert.ok(Buffer.byteLength(JSON.stringify(base.definition)) < 512 * 1024);
    const plan = planWorkflowMerge(base, clone(base), clone(base));
    assert.deepEqual(plan.conflicts, []);
    const result = resolveWorkflowMerge(plan);
    assert.equal(result.valid, false); assert.ok(result.diagnostics.some((d) => d.code === "SCHEMA_INVALID"));
    assert.deepEqual(result.document.definition.edges, base.definition.edges);
  }
});
