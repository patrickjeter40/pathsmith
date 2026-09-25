import { createHash } from "node:crypto";
import { inspectJson, type Workflow } from "@pathsmith/contracts";
import { assertValid } from "./error.js";

/** UTF-8 JSON, recursive lexicographic object-key order, preserved array order. */
export function canonicalize(value: unknown): string {
  const diagnostics = inspectJson(value, 64 * 1024 * 1024);
  assertValid(
    { valid: diagnostics.length === 0, diagnostics },
    "ARTIFACT_INVALID",
  );
  function encode(item: unknown): string {
    if (Array.isArray(item)) return "[" + item.map(encode).join(",") + "]";
    if (item && typeof item === "object")
      return (
        "{" +
        Object.keys(item)
          .sort()
          .map(
            (k) =>
              JSON.stringify(k) +
              ":" +
              encode((item as Record<string, unknown>)[k]),
          )
          .join(",") +
        "}"
      );
    return JSON.stringify(item);
  }
  return encode(value);
}
export const hash = (value: unknown) =>
  createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
export function workflowHashes(workflow: Workflow) {
  const { name: _name, description: _description, ...semantic } = workflow;
  return {
    artifactHash: hash(workflow),
    workflowSemanticHash: hash({
      ...semantic,
      nodes: workflow.nodes
        .map(({ label: _label, ...node }) => node)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      edges: [...workflow.edges].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
    }),
  };
}
