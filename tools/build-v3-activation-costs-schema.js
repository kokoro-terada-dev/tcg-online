import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function activationCostsSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:30";
  s.title = "V3 subset 30: atomic filtered reveal and movement activation costs";
  s.properties.schemaVersion.const = "3.0.0-subset.30";
  s.$defs.activationHandCostSelector = {
    allOf: [{ $ref: "#/$defs/selector" }],
    properties: {
      type: { const: "CARDS" }, zone: { const: "hand" }, visibility: { const: "OWNER_ONLY" },
      owner: { const: "SELF" }, controller: { const: "SELF" }, chooser: { const: "SELF" }, faceUpOnly: { const: false },
      min: { type: "integer", minimum: 1 }, cardTypes: { type: "array", items: { enum: ["character", "stage", "event"] } }
    },
    $comment: "The Compiler requires min === max and validates compound-cost combinations."
  };
  const selector = { $ref: "#/$defs/activationHandCostSelector" };
  for (const [type, properties] of [
    ["REVEAL_CARDS", { selector }],
    ["MOVE_AS_COST", { selector: { oneOf: [{ const: "SOURCE" }, selector] }, destination: { const: "trash" } }]
  ]) s.$defs.cost.oneOf.push({
    allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: Object.keys(properties), properties: { type: { const: type }, ...properties }
  });
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset29.schema.json", root), "utf8"));
  const output = JSON.stringify(activationCostsSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset30.schema.json", "docs/card-effect-activation-costs.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`);
    } else fs.writeFileSync(target, output);
  }
}
