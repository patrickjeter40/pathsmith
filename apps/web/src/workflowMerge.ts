import { inspectJson, pointerPart, validateWorkflow, type Diagnostic, type Json } from "@pathsmith/contracts";

export type MergeDocument = { definition: Json; layout: Json };
export type MergeChoice = "local" | "remote" | "combine";
export type MergeSlot = { exists: false } | { exists: true; value: Json };
export type BranchRoutingPreview = {
  nodeId: string;
  order: (string | null)[];
  cases: Json[];
  edges: Json[];
  defaultEdges: Json[];
  destinations: { edgeId: string; port: string; target: string; targetLabel: string | null }[];
};
export type MergeConflict = {
  key: string;
  /** Stable entity addresses, not array-index JSON pointers. */
  path: string[];
  kind: "value" | "delete_edit" | "identity" | "branch";
  reason: string;
  base: MergeSlot;
  local: MergeSlot;
  remote: MergeSlot;
  combineAvailable: boolean;
  combineReason?: string;
  branch?: { base: BranchRoutingPreview; local: BranchRoutingPreview; remote: BranchRoutingPreview; combined: BranchRoutingPreview | null };
};
export type WorkflowMergePlan = {
  sources: { base: MergeDocument; local: MergeDocument; remote: MergeDocument } | null;
  conflicts: MergeConflict[];
  /** Present only when no choices remain; diagnostics still govern publication. */
  merged: MergeDocument | null;
  diagnostics: Diagnostic[];
};
export type WorkflowMergeResolution = {
  document: MergeDocument | null;
  unresolved: string[];
  diagnostics: Diagnostic[];
  valid: boolean;
};
type ObjectJson = { [key: string]: Json };
type Entity = ObjectJson & { id: string };
type Graph = { definition: ObjectJson; nodes: Entity[]; edges: Entity[] };
type Sources = NonNullable<WorkflowMergePlan["sources"]>;
const missing: MergeSlot = { exists: false };
const present = (value: Json): MergeSlot => ({ exists: true, value });
const object = (value: Json | undefined): value is ObjectJson => value !== null && typeof value === "object" && !Array.isArray(value);
const slot = (value: ObjectJson, key: string): MergeSlot => Object.hasOwn(value, key) ? present(value[key]) : missing;
const diagnostic = (code: string, message: string, pointer = ""): Diagnostic => ({ code, message, pointer, severity: "error" });

function equal(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
const same = (a: MergeSlot, b: MergeSlot) => a.exists === b.exists && (!a.exists || b.exists && equal(a.value, b.value));
function entities(value: Json): Entity[] | null {
  if (!Array.isArray(value) || value.some((item) => !object(item) || typeof item.id !== "string")) return null;
  const items = value as Entity[];
  return new Set(items.map((item) => item.id)).size === items.length ? items : null;
}
function graph(value: Json): Graph | null {
  if (!object(value)) return null;
  const nodes = entities(value.nodes), edges = entities(value.edges);
  return nodes && edges ? { definition: value, nodes, edges } : null;
}
const byId = (items: Entity[]) => new Map(items.map((item) => [item.id, item]));
const order = (...items: Entity[][]) => [...new Set(items.flatMap((rows) => rows.map((row) => row.id)))];
const without = (value: ObjectJson, keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const outEdges = (g: Graph, id: string) => g.edges.filter((edge) => edge.source === id).sort((a, b) => a.id.localeCompare(b.id));
function unit(g: Graph, id: string, wholeNode: boolean): ObjectJson {
  const node = g.nodes.find((item) => item.id === id);
  return { edges: outEdges(g, id), ...(node ? wholeNode ? { node } : Object.hasOwn(node, "cases") ? { cases: node.cases } : {} : {}) };
}
function preview(g: Graph, id: string, value: ObjectJson): BranchRoutingPreview {
  const rawCases = object(value.node) ? value.node.cases : value.cases;
  const cases = Array.isArray(rawCases) ? rawCases : [];
  const edges = Array.isArray(value.edges) ? value.edges : [];
  return structuredClone({ nodeId: id, order: cases.map((item) => object(item) && typeof item.id === "string" ? item.id : null), cases, edges,
    defaultEdges: edges.filter((edge) => object(edge) && edge.port === "default"),
    destinations: edges.flatMap((edge) => object(edge) && typeof edge.id === "string" && typeof edge.port === "string" && typeof edge.target === "string"
      ? [{ edgeId: edge.id, port: edge.port, target: edge.target,
          targetLabel: g.nodes.find((node) => node.id === edge.target && typeof node.label === "string")?.label as string | undefined ?? null }]
      : []) });
}

/** Structural routing checks only. Executability always uses validateWorkflow. */
function routingProblem(g: Graph, id: string, value: ObjectJson): string | null {
  const cases = entities(value.cases), edges = entities(value.edges);
  if (!cases || !cases.length || !edges || cases.some((item) => !Object.hasOwn(item, "when") || ["default", "next"].includes(item.id)))
    return "Case IDs and routing must be well formed and unique";
  const ports = [...cases.map((item) => item.id), "default"];
  if (edges.some((edge) => edge.source !== id || typeof edge.port !== "string" || !ports.includes(edge.port) ||
    typeof edge.target !== "string" || !g.nodes.some((node) => node.id === edge.target)) ||
    ports.some((port) => edges.filter((edge) => edge.port === port).length !== 1))
    return "Every case and default must own exactly one edge to an existing node";
  return null;
}
function combineBranch(graphs: Graph[], id: string, units: ObjectJson[]): { value?: ObjectJson; reason: string } {
  for (let i = 0; i < graphs.length; i++) {
    const problem = routingProblem(graphs[i], id, units[i]);
    if (problem) return { reason: problem };
  }
  const [base, local, remote] = units;
  const cases = units.map((value) => entities(value.cases)!);
  const baseIds = new Set(cases[0].map((item) => item.id));
  for (const side of [1, 2]) {
    const map = byId(cases[side]);
    if (cases[0].some((item) => !map.has(item.id) || !equal(item, map.get(item.id)!)))
      return { reason: "Existing cases were edited, deleted or renamed" };
  }
  if (!equal(cases[2].filter((item) => baseIds.has(item.id)).map((item) => item.id), cases[0].map((item) => item.id)))
    return { reason: "The other window reordered existing cases" };
  const baseEdges = entities(base.edges)!;
  for (const value of [local, remote]) {
    const edges = entities(value.edges)!;
    if (baseEdges.some((edge) => !edges.some((other) => equal(edge, other))))
      return { reason: "Existing port edges or the default routing changed" };
  }
  const localAdded = cases[1].filter((item) => !baseIds.has(item.id));
  const remoteAdded = cases[2].filter((item) => !baseIds.has(item.id));
  if (localAdded.some((item) => remoteAdded.some((other) => item.id === other.id)))
    return { reason: "Both windows added the same case ID" };
  const baseEdgeIds = new Set(baseEdges.map((edge) => edge.id));
  const additions = [local, remote].map((value) => entities(value.edges)!.filter((edge) => !baseEdgeIds.has(edge.id)));
  for (const [index, other] of [[0, 2], [1, 1]]) {
    if (additions[index].some((edge) => graphs[0].edges.some((old) => old.id === edge.id) || graphs[other].edges.some((old) => old.id === edge.id)))
      return { reason: "New edge IDs must be globally disjoint" };
  }
  if (!localAdded.length && !remoteAdded.length) return { reason: "There are no disjoint additions to combine" };
  return { value: { cases: [...cases[1], ...remoteAdded], edges: [...entities(local.edges)!, ...additions[1]] },
    reason: "Keep the complete local order, then append the other window’s new cases in their order. First true case wins." };
}

function compute(sources: Sources, choices: Record<string, MergeChoice>) {
  const conflicts: MergeConflict[] = [], unresolved: string[] = [];
  function conflict(base: MergeSlot, local: MergeSlot, remote: MergeSlot, path: string[], kind: MergeConflict["kind"], reason: string,
    extra?: { combined?: Json; combineReason: string; branch: NonNullable<MergeConflict["branch"]> }): MergeSlot {
    const key = JSON.stringify([kind, ...path]);
    conflicts.push(structuredClone({ key, path, kind, reason, base, local, remote, combineAvailable: extra?.combined !== undefined,
      ...(extra ? { combineReason: extra.combineReason, branch: extra.branch } : {}) }));
    const choice = Object.hasOwn(choices, key) ? choices[key] : undefined;
    if (choice === "local") return local;
    if (choice === "remote") return remote;
    if (choice === "combine" && extra?.combined !== undefined) return present(extra.combined);
    unresolved.push(key);
    return local;
  }
  function merge(base: MergeSlot, local: MergeSlot, remote: MergeSlot, path: string[], atomic = false, identity = false): MergeSlot {
    if (same(local, remote)) return local;
    if (same(local, base)) return remote;
    if (same(remote, base)) return local;
    if (local.exists && remote.exists && object(local.value) && object(remote.value) &&
      (!base.exists || object(base.value)) && !atomic && !identity) {
      const [b, l, r] = [base.exists ? base.value as ObjectJson : {}, local.value, remote.value];
      const variant = ["kind", "op"].some((key) => !same(slot(b, key), slot(l, key)) || !same(slot(b, key), slot(r, key)));
      if (!variant) {
        const result: ObjectJson = {};
        for (const key of new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(b)])) {
          const selected = merge(slot(b, key), slot(l, key), slot(r, key), [...path, key]);
          if (selected.exists) result[key] = selected.value;
        }
        return present(result);
      }
    }
    return conflict(base, local, remote, path, !local.exists || !remote.exists ? "delete_edit" : identity || !base.exists ? "identity" : "value",
      "Both windows changed this value differently");
  }
  function collection(base: Entity[], local: Entity[], remote: Entity[], path: string[]): Entity[] {
    const maps = [base, local, remote].map(byId);
    return order(local, remote, base).flatMap((id) => {
      const [b, l, r] = maps.map((map) => map.has(id) ? present(map.get(id)!) : missing);
      const selected = merge(b, l, r, [...path, id], false, !b.exists);
      return selected.exists ? [selected.value as Entity] : [];
    });
  }
  function definition(): Json {
    const values = [sources.base.definition, sources.local.definition, sources.remote.definition];
    const parsed = values.map(graph);
    if (parsed.some((g) => !g)) {
      const ambiguous = values.some((v) => object(v) && (Array.isArray(v.nodes) && !entities(v.nodes) || Array.isArray(v.edges) && !entities(v.edges)));
      const selected = ambiguous ? conflict(...values.map(present) as [MergeSlot, MergeSlot, MergeSlot], ["definition"], "identity", "Duplicate or malformed entity IDs prevent safe graph merging")
        : merge(...values.map(present) as [MergeSlot, MergeSlot, MergeSlot], ["definition"], true);
      return selected.exists ? selected.value : null;
    }
    const graphs = parsed as Graph[];
    const branchIds = new Set(graphs.flatMap((g) => g.nodes.filter((node) => node.kind === "branch").map((node) => node.id)));
    if (branchIds.size) {
      const edgeMaps = graphs.map((g) => byId(g.edges));
      for (const id of order(...graphs.map((g) => g.edges))) {
        const sources = new Set(edgeMaps.flatMap((map) => map.has(id) ? [map.get(id)!.source] : []));
        if (sources.size > 1 && [...sources].some((source) => typeof source === "string" && branchIds.has(source))) {
          const selected = conflict(...values.map(present) as [MergeSlot, MergeSlot, MergeSlot], ["definition"], "identity", "An edge moved between routing owners; choose a complete definition");
          return selected.exists ? selected.value : null;
        }
      }
    }
    const complex = new Set([...branchIds].filter((id) => graphs.some((g) => g.nodes.find((node) => node.id === id)?.kind !== "branch")));
    const nodeLists = graphs.map((g) => g.nodes.filter((node) => !complex.has(node.id)).map((node) =>
      branchIds.has(node.id) ? without(node, ["cases"]) as Entity : node));
    const nodes = byId(collection(nodeLists[0], nodeLists[1], nodeLists[2], ["definition", "nodes"]));
    const edgeLists = graphs.map((g) => g.edges.filter((edge) => !(typeof edge.source === "string" && branchIds.has(edge.source))));
    const edges = collection(edgeLists[0], edgeLists[1], edgeLists[2], ["definition", "edges"]);
    for (const id of branchIds) {
      const wholeNode = complex.has(id), units = graphs.map((g) => unit(g, id, wholeNode));
      const [b, l, r] = units.map(present);
      let selected: MergeSlot;
      if (same(l, r)) selected = l;
      else if (same(l, b)) selected = r;
      else if (same(r, b)) selected = l;
      else {
        const combination = wholeNode ? { reason: "The branch was added, deleted or changed kind" } : combineBranch(graphs, id, units);
        const combinedGraph = { ...graphs[1], nodes: [...nodes.values(), ...graphs[2].nodes.filter((node) => !nodes.has(node.id))] };
        selected = conflict(b, l, r, ["definition", "nodes", id, "routing"], "branch", "Ordered cases and all outgoing edges must be resolved together", {
          combined: combination.value, combineReason: combination.reason,
          branch: { base: preview(graphs[0], id, units[0]), local: preview(graphs[1], id, units[1]), remote: preview(graphs[2], id, units[2]),
            combined: combination.value ? preview(combinedGraph, id, combination.value) : null },
        });
      }
      const value = selected.exists ? selected.value as ObjectJson : {};
      if (wholeNode) { if (object(value.node)) nodes.set(id, value.node as Entity); }
      else {
        const node = nodes.get(id)!;
        nodes.set(id, { ...node, ...(Object.hasOwn(value, "cases") ? { cases: value.cases } : {}) });
      }
      if (Array.isArray(value.edges)) edges.push(...value.edges as Entity[]);
    }
    const attributes = graphs.map((g) => present(without(g.definition, ["nodes", "edges"])));
    const merged = merge(attributes[0], attributes[1], attributes[2], ["definition"]);
    const edgeMap = byId(edges);
    return { ...(merged.exists ? merged.value as ObjectJson : {}),
      nodes: order(graphs[1].nodes, graphs[2].nodes, graphs[0].nodes).flatMap((id) => nodes.has(id) ? [nodes.get(id)!] : []),
      edges: order(graphs[1].edges, graphs[2].edges, graphs[0].edges).flatMap((id) => edgeMap.has(id) ? [edgeMap.get(id)!] : []) };
  }
  const result = definition();
  const layout = merge(present(sources.base.layout), present(sources.local.layout), present(sources.remote.layout), ["layout"]);
  return { conflicts, unresolved, document: { definition: result, layout: layout.exists ? layout.value : null } };
}

function validateDocument(document: MergeDocument): Diagnostic[] {
  return [...validateWorkflow(document.definition).diagnostics, ...inspectJson(document.layout, 512 * 1024).map((d) => ({ ...d, pointer: `/layout${d.pointer}` }))];
}

/** Read-only planning. No choices are silently made for conflicting values. */
export function planWorkflowMerge(base: MergeDocument, local: MergeDocument, remote: MergeDocument): WorkflowMergePlan {
  const diagnostics: Diagnostic[] = [];
  for (const [name, document] of Object.entries({ base, local, remote })) {
    for (const key of ["definition", "layout"] as const)
      diagnostics.push(...inspectJson(document[key], 512 * 1024).map((d) => ({ ...d, pointer: `/${name}/${key}${d.pointer}` })));
  }
  if (diagnostics.length) return { sources: null, conflicts: [], merged: null, diagnostics };
  const sources = structuredClone({ base, local, remote });
  const result = compute(sources, {});
  const merged = result.unresolved.length ? null : result.document;
  return structuredClone({ sources, conflicts: result.conflicts, merged, diagnostics: merged ? validateDocument(merged) : [] });
}

/** A returned document can be an editable invalid draft; valid alone permits publication. */
export function resolveWorkflowMerge(plan: WorkflowMergePlan, choices: Record<string, MergeChoice> = {}): WorkflowMergeResolution {
  if (!plan.sources) return { document: null, unresolved: [], diagnostics: structuredClone(plan.diagnostics), valid: false };
  const invalid: Diagnostic[] = [];
  for (const [key, choice] of Object.entries(choices)) {
    const conflict = plan.conflicts.find((item) => item.key === key);
    if (!conflict || !["local", "remote", "combine"].includes(choice) || choice === "combine" && !conflict.combineAvailable)
      invalid.push(diagnostic("MERGE_CHOICE_INVALID", "Choose an available resolution for a current conflict", `/${pointerPart(key)}`));
  }
  if (invalid.length) return { document: null, unresolved: plan.conflicts.map((c) => c.key), diagnostics: invalid, valid: false };
  const result = compute(plan.sources, choices);
  const document = result.unresolved.length ? null : structuredClone(result.document);
  const diagnostics = document ? validateDocument(document) : [];
  return { document, unresolved: result.unresolved, diagnostics, valid: !!document && !diagnostics.some((d) => d.severity === "error") };
}
