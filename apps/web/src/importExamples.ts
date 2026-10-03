export type ImportRow = { content: string; label: string; source: "generated" | "human" | "unknown"; tags: string[]; issue: string };

function csvCells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === ',') { row.push(cell); cell = ""; closed = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ""; closed = false;
    } else {
      if (closed && char !== ' ' && char !== '\t') throw new Error(`Unexpected text after a quoted CSV field at character ${i + 1}.`);
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (row.length || cell) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseExamples(text: string, format: "lines" | "csv" | "jsonl", positive: string, negative: string): ImportRow[] {
  const clean = text.replace(/^\uFEFF/, "");
  if (new TextEncoder().encode(clean).length > 8 * 1024 * 1024) throw new Error("Import exceeds the 8 MiB test-set limit.");
  if (format === "jsonl") {
    const lines = clean.split(/\r\n|\n|\r/);
    if (lines.at(-1) === "") lines.pop();
    if (lines.length > 10000) throw new Error("Import exceeds 10,000 JSONL rows.");
    return lines.map((line, index) => {
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
        const row = value as Record<string, unknown>;
        if (Object.keys(row).some((key) => !["content", "expected_label", "source", "tags"].includes(key))) throw new Error("Unsupported field");
        if (typeof row.content !== "string" || !row.content.trim() || row.content.length > 8000) throw new Error("Content must be 1–8,000 characters");
        if (row.expected_label !== undefined && row.expected_label !== null && (typeof row.expected_label !== "string" || ![positive, negative].includes(row.expected_label))) throw new Error("Expected label must match a classification option or be null");
        if (row.source !== undefined && (typeof row.source !== "string" || !["generated", "human", "unknown"].includes(row.source))) throw new Error("Unknown source");
        if (row.tags !== undefined && (!Array.isArray(row.tags) || row.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 200))) throw new Error("Tags must be nonempty strings of at most 200 characters");
        if (Array.isArray(row.tags) && new Set(row.tags).size !== row.tags.length) throw new Error("Tags must be unique");
        return { content: row.content, label: row.expected_label === null ? "unclear" : (row.expected_label as string | undefined) ?? "", source: (row.source ?? "unknown") as ImportRow["source"], tags: (row.tags ?? []) as string[], issue: "" };
      } catch (error) {
        return { content: "", label: "", source: "unknown", tags: [], issue: `Line ${index + 1}: ${error instanceof SyntaxError ? "Invalid JSON" : String(error instanceof Error ? error.message : error)}` };
      }
    });
  }
  if (format === "lines") {
    const lines = clean.split(/\r\n|\n|\r/);
    if (lines.at(-1) === "") lines.pop();
    if (lines.length > 10000) throw new Error("Import exceeds 10,000 rows.");
    return lines.map((content) => ({ content, label: "", source: "unknown", tags: [], issue: "" }));
  }
  const table = csvCells(clean);
  if (!table.length) return [];
  if (table.length > 10001) throw new Error("Import exceeds 10,000 CSV rows.");
  const header = table.shift()!.map((value) => value.trim().toLowerCase());
  const contentColumn = header.indexOf("content");
  if (contentColumn < 0) throw new Error("CSV needs a content column.");
  const labelColumn = header.indexOf("expected_label") >= 0 ? header.indexOf("expected_label") : header.indexOf("label");
  const sourceColumn = header.indexOf("source");
  const tagsColumn = header.indexOf("tags");
  return table.map((cells) => {
    const label = labelColumn < 0 ? "" : (cells[labelColumn] ?? "").trim();
    const source = sourceColumn < 0 ? "unknown" : (cells[sourceColumn] ?? "unknown").trim().toLowerCase();
    const content = cells[contentColumn] ?? "";
    const issue = cells.length !== header.length ? `Expected ${header.length} columns; found ${cells.length}.` :
      !content.trim() ? "Message is empty." :
      content.length > 8000 ? "Message exceeds 8,000 characters." :
      label && ![positive, negative, "unclear"].includes(label) ? `Unknown label: ${label}.` :
      !["generated", "human", "unknown"].includes(source) ? `Unknown source: ${source}.` : "";
    return { content, label, source: (["generated", "human", "unknown"].includes(source) ? source : "unknown") as ImportRow["source"], tags: tagsColumn < 0 ? [] : (cells[tagsColumn] ?? "").split("|").map((tag) => tag.trim()).filter(Boolean), issue };
  });
}
