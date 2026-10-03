import { inspectJson } from "./safety.js";
import type { Diagnostic, Json } from "./types.js";

export const MAX_PROJECT_FILE_BYTES = 8 * 1024 * 1024;
export interface ProjectFile {
  formatVersion: "0.1";
  artifactType: "pathsmith_project";
  name: string;
  workflows: { key: string; name: string; definition: Json; layout: Json }[];
  suites: { key: string; name: string; definition: Json }[];
}
/** A content-only portable draft bundle. Keys are opaque IDs, never paths. */
export function validateProjectFile(value: unknown): { valid: boolean; diagnostics: Diagnostic[] } {
  const diagnostics = inspectJson(value, MAX_PROJECT_FILE_BYTES);
  const fail = (message: string, pointer = "") => diagnostics.push({ code: "PROJECT_FILE_INVALID", message, pointer, severity: "error" });
  if (diagnostics.length) return { valid: false, diagnostics };
  const object = (v: unknown): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);
  const keys = (v: Record<string, Json>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k)) && allowed.every((k) => Object.hasOwn(v, k));
  const name = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
  if (!object(value) || !keys(value, ["formatVersion", "artifactType", "name", "workflows", "suites"]) ||
    value.formatVersion !== "0.1" || value.artifactType !== "pathsmith_project" || !name(value.name)) {
    fail("Expected a version 0.1 project document with content-only workflow and suite drafts");
    return { valid: false, diagnostics };
  }
  for (const kind of ["workflows", "suites"] as const) {
    const rows = value[kind];
    if (!Array.isArray(rows) || rows.length > 100) { fail("Expected at most 100 drafts", `/${kind}`); continue; }
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const at = `/${kind}/${index}`;
      if (!object(row) || !keys(row, kind === "workflows" ? ["key", "name", "definition", "layout"] : ["key", "name", "definition"]) ||
        typeof row.key !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(row.key) || seen.has(row.key) || !name(row.name)) {
        fail("Each draft requires a unique opaque key, name and definition", at); return;
      }
      seen.add(row.key);
      if (!object(row.definition)) fail("Draft definition must be a JSON object", `${at}/definition`);
      for (const d of inspectJson(row.definition, kind === "workflows" ? 512 * 1024 : 8 * 1024 * 1024))
        fail(d.message, `${at}/definition${d.pointer}`);
      if (kind === "workflows") for (const d of inspectJson(row.layout, 512 * 1024)) fail(d.message, `${at}/layout${d.pointer}`);
    });
  }
  return { valid: !diagnostics.length, diagnostics };
}
