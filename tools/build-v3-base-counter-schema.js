import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function baseCounterSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:35";
  s.title = "V3 subset 35: continuous base stat setters and counter values";
  s.properties.schemaVersion.const = "3.0.0-subset.35";
  const refs = s.$defs.value.oneOf.find(row => row.properties?.ref).properties.ref.anyOf;
  refs.push({ type: "string", pattern: "^(SOURCE|CANDIDATE)\\.(base\\.(cost|power|counter)|(printed|current)\\.counter)$" });
  const node = s.$defs.continuousEffect, fields = node.properties;
  fields.affectedQuery = { oneOf: [fields.affectedQuery, {
    allOf: [{ $ref: "#/$defs/query" }], properties: {
      zone: { const: "hand" }, owner: { const: "SELF" }, controller: { const: "SELF" }, visibility: { const: "OWNER_ONLY" },
      faceUpOnly: { const: false }, cardTypes: { type: "array", items: { const: "character" } }
    }
  }] };
  fields.operation.oneOf[0].properties.stat.enum.push("counter");
  fields.operation.oneOf.push(
    { type: "object", additionalProperties: false, required: ["type", "stat", "value"], properties: {
      type: { const: "SET_BASE_STAT" }, stat: { enum: ["power", "cost"] }, value: { type: "integer", minimum: 0, maximum: 100000 }
    } },
    { type: "object", additionalProperties: false, required: ["type", "value"], properties: {
      type: { const: "GRANT_COUNTER" }, value: { type: "integer", minimum: 1, maximum: 100000 }
    } }
  );
  node.allOf.push({
    if: { properties: { operation: { anyOf: [
      { properties: { type: { const: "GRANT_COUNTER" } } },
      { required: ["stat"], properties: { type: { const: "ADD_STAT" }, stat: { const: "counter" } } }
    ] } } },
    then: { properties: { affectedQuery: { properties: { zone: { enum: ["character", "hand"] } } } } },
    else: { properties: { affectedQuery: { properties: { zone: { enum: ["character", "leader", "stage"] } } } } }
  });
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset34.schema.json", root), "utf8"));
  const output = JSON.stringify(baseCounterSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset35.schema.json", "docs/card-effect-base-counter.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`);
    } else fs.writeFileSync(target, output);
  }
}
