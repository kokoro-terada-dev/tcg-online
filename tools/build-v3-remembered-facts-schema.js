import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function rememberedFactsSchema(base) {
  const s = structuredClone(base); s.$id = "urn:tcg:effect-v3-subset:26";
  s.title = "V3 subset 26: explicitly scoped public color memories from movement snapshots";
  s.properties.schemaVersion.const = "3.0.0-subset.26";
  const key = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$", not: { enum: ["constructor", "prototype"] } };
  const basis = { enum: ["PRINTED", "CURRENT"] };
  s.$defs.action.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: ["result", "cards", "snapshot", "basis", "field", "bindAs"], properties: { type: { const: "REMEMBER_FACTS" }, result: key,
      cards: { oneOf: [{ type: "null" }, { $ref: "#/$defs/cardSetRef" }] }, snapshot: { enum: ["BEFORE", "AFTER"] }, basis, field: { const: "colors" }, bindAs: key } });
  s.$defs.predicate.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: ["memory", "subject", "basis", "match"], properties: { type: { const: "REMEMBERED_COLORS" }, memory: key, subject: { enum: ["SOURCE", "CANDIDATE"] }, basis, match: { enum: ["OVERLAP", "DISJOINT"] } } });
  return s;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url), schema = rememberedFactsSchema(JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset25.schema.json", root), "utf8")));
  const output = JSON.stringify(schema, null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset26.schema.json", "docs/card-effect-remembered-facts.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) { if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`); }
    else fs.writeFileSync(target, output);
  }
}
