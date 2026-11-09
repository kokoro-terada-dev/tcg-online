import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function replacementSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:37";
  s.title = "V3 subset 37: single optional effect-move replacement";
  s.properties.schemaVersion.const = "3.0.0-subset.37";
  const blankCard = s.allOf.find(row => row.if?.properties?.effects?.maxItems === 0 && row.if?.properties?.keywords?.maxItems === 0);
  if (!blankCard) throw Error("Base schema has no blank-card rule");
  blankCard.if.not = { anyOf: [{ required: ["continuousEffects"] }, { required: ["replacementEffects"] }] };
  s.properties.replacementEffects = { type: "array", minItems: 1, maxItems: 8, items: { $ref: "#/$defs/replacementEffect" } };
  s.allOf.push({ if: { required: ["replacementEffects"] }, then: { properties: { cardType: { const: "character" }, source: { properties: { text: { pattern: "\\S" } } } } } });
  s.$defs.replacementEffect = {
    type: "object", unevaluatedProperties: false, required: ["id", "match", "condition", "substitute"],
    properties: {
      type: { const: "REPLACE_EVENT" },
      match: { type: "object", additionalProperties: false, required: ["cause", "by", "from", "to"], properties: {
        cause: { enum: ["EFFECT_KO", "EFFECT_MOVE"] }, by: { enum: ["SELF", "OPPONENT", "ANY"] },
        from: { const: "character" }, to: { enum: ["trash", "hand", "deck", "public"] }
      } },
      condition: { $ref: "#/$defs/predicate" },
      substitute: { type: "object", additionalProperties: false, required: ["to"], properties: { to: { enum: ["hand", "trash"] } } }
    },
    allOf: [
      { $ref: "#/$defs/meta" },
      { if: { properties: { match: { properties: { cause: { const: "EFFECT_KO" } } } } },
        then: { properties: { match: { properties: { to: { const: "trash" } } } } } },
      ...["hand", "trash"].map(zone => ({
        if: { properties: { match: { properties: { cause: { const: "EFFECT_MOVE" }, to: { const: zone } } } } },
        then: { properties: { substitute: { properties: { to: { not: { const: zone } } } } } }
      }))
    ]
  };
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset36.schema.json", root), "utf8"));
  const output = JSON.stringify(replacementSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset37.schema.json", "docs/card-effect-replacement.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error("Outdated generated schema: " + file);
    } else fs.writeFileSync(target, output);
  }
}
