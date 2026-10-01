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

export function parseExamples(text: string, format: "lines" | "csv", positive: string, negative: string): ImportRow[] {
  const clean = text.replace(/^\uFEFF/, "");
  if (format === "lines") {
    const lines = clean.split(/\r\n|\n|\r/);
    if (lines.at(-1) === "") lines.pop();
    return lines.map((content) => ({ content, label: "", source: "unknown", tags: [], issue: "" }));
  }
  const table = csvCells(clean);
  if (!table.length) return [];
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
