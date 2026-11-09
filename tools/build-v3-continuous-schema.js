import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function continuousSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:34";
  s.title = "V3 subset 34: conditional public field continuous additions";
  s.properties.schemaVersion.const = "3.0.0-subset.34";
  s.properties.continuousEffects = { type: "array", minItems: 1, maxItems: 8, items: { $ref: "#/$defs/continuousEffect" } };
  const blankCard = s.allOf.find(row => row.if?.properties?.effects?.maxItems === 0 && row.if?.properties?.keywords?.maxItems === 0);
  if (!blankCard) throw Error("Base schema has no blank-card rule");
  blankCard.if.not = { required: ["continuousEffects"] };
  s.allOf.push({ if: { required: ["continuousEffects"] }, then: { properties: {
    cardType: { enum: ["leader", "character", "stage"] }, source: { properties: { text: { pattern: "\\S" } } }
  } } });
  s.$defs.continuousEffect = { allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: ["condition", "affectedQuery", "operation"], properties: {
      type: { const: "CONTINUOUS_EFFECT" }, condition: { $ref: "#/$defs/predicate" },
      affectedQuery: { allOf: [{ $ref: "#/$defs/query" }], properties: {
        zone: { enum: ["leader", "character", "stage"] }, visibility: { const: "PUBLIC" }, faceUpOnly: { const: true }
      } },
      operation: { oneOf: [
        { type: "object", additionalProperties: false, required: ["type", "stat", "amount"], properties: {
          type: { const: "ADD_STAT" }, stat: { enum: ["cost", "power"] }, amount: { type: "integer", minimum: -100000, maximum: 100000, not: { const: 0 } }
        } },
        { type: "object", additionalProperties: false, required: ["type", "keyword"], properties: {
          type: { const: "GRANT_KEYWORD" }, keyword: { $ref: "#/$defs/keyword" }
        } }
      ] }
    }, $comment: "The Compiler also checks predicate dependencies, field/card kind and operation compatibility."
  };
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset33.schema.json", root), "utf8"));
  const output = JSON.stringify(continuousSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset34.schema.json", "docs/card-effect-continuous.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`);
    } else fs.writeFileSync(target, output);
  }
}
