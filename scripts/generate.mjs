import { readFile, writeFile, mkdir } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";
import assert from "node:assert/strict";
const schemas = {};
for (const name of ["workflow", "suite", "mock-fixtures"])
  schemas[name] = JSON.parse(
    await readFile(`schemas/${name}.schema.json`, "utf8"),
  );
for (const name of ["suite", "mock-fixtures"])
  assert.deepEqual(
    schemas[name].$defs.jsonValue,
    schemas.workflow.$defs.jsonValue,
    `${name}: JSON contract drift`,
  );
assert.deepEqual(
  schemas.suite.$defs.expr,
  schemas.workflow.$defs.expr,
  "Expression contract drift",
);
assert.deepEqual(
  schemas["mock-fixtures"].$defs.question,
  schemas.workflow.$defs.question,
  "Question contract drift",
);
await mkdir("packages/contracts/src/generated", { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const output = await compile(schema, name, {
    bannerComment: "/* Generated from schemas/. Do not edit. */",
    additionalProperties: false,
    unreachableDefinitions: true,
    format: true,
  });
  await emit(`packages/contracts/src/generated/${name}.ts`, output);
}
await emit(
  "packages/contracts/src/generated/schemas.ts",
  "/* Generated from schemas/. Do not edit. */\nexport const schemas = " +
    JSON.stringify(schemas, null, 2) +
    " as const;\n",
);
async function emit(path, content) {
  if (process.argv.includes("--check"))
    assert.equal(
      await readFile(path, "utf8"),
      content,
      `Generated contract drift: ${path}`,
    );
  else await writeFile(path, content);
}
console.log(
  process.argv.includes("--check")
    ? "Schema/type generation is current."
    : "Generated wire types and browser-safe schemas.",
);
