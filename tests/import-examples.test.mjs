import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExamples } from "../apps/web/src/importExamples.ts";

test("CSV import keeps quoted multiline Unicode, escaped quotes, BOM, and CRLF", () => {
  const rows = parseExamples('\uFEFFcontent,expected_label,source,tags\r\n"Hi, ""friend"".\r\nCafé",abusive,generated,quote|unicode\r\nOkay,not_abusive,human,friendly\r\n', "csv", "abusive", "not_abusive");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].content, 'Hi, "friend".\r\nCafé');
  assert.deepEqual(rows[0].tags, ["quote", "unicode"]);
  assert.equal(rows[0].issue, "");
  assert.equal(rows[1].label, "not_abusive");
});

test("CSV import exposes malformed row and wrong label instead of dropping them", () => {
  const rows = parseExamples("content,label,source\nhello,maybe,generated\nshort\n", "csv", "abusive", "not_abusive");
  assert.equal(rows.length, 2);
  assert.match(rows[0].issue, /Unknown label/);
  assert.match(rows[1].issue, /Expected 3 columns/);
});

test("line import preserves an empty middle row for preview", () => {
  const rows = parseExamples("one\n\ntwo\n", "lines", "abusive", "not_abusive");
  assert.deepEqual(rows.map((row) => row.content), ["one", "", "two"]);
});

test("JSONL preserves explicit unclear versus unlabeled and provenance", () => {
  const rows = parseExamples('{"content":"A","expected_label":null,"source":"generated","tags":["billing"]}\n{"content":"B"}\n', "jsonl", "urgent", "normal");
  assert.deepEqual(rows.map((row) => [row.label, row.source, row.issue]), [["unclear", "generated", ""], ["", "unknown", ""]]);
  assert.deepEqual(rows[0].tags, ["billing"]);
});

test("JSONL rejects unsupported fields and wrong types with line numbers", () => {
  const rows = parseExamples('{"content":"A","path":"/tmp"}\n{"content":"B","tags":"one"}\n{"content":', "jsonl", "urgent", "normal");
  assert.match(rows[0].issue, /Line 1: Unsupported field/);
  assert.match(rows[1].issue, /Line 2: Tags/);
  assert.match(rows[2].issue, /Line 3: Invalid JSON/);
});

test("JSONL rejects coerced source values and duplicate tags", () => {
  const rows = parseExamples('{"content":"A","source":["generated"]}\n{"content":"B","tags":["same","same"]}', "jsonl", "urgent", "normal");
  assert.match(rows[0].issue, /Line 1: Unknown source/);
  assert.match(rows[1].issue, /Line 2: Tags must be unique/);
});
