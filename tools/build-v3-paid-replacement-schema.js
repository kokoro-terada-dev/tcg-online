import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function paidReplacementSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:38";
  s.title = "V3 subset 38: optional hand discard replacing effect KO";
  s.properties.schemaVersion.const = "3.0.0-subset.38";
  const node = s.$defs.replacementEffect, move = node.properties.substitute;
  const prevent = { type: "object", additionalProperties: false, required: ["type"], properties: { type: { const: "PREVENT" } } };
  node.properties.substitute = { oneOf: [move, prevent] };
  node.properties.optionalPayment = { $ref: "#/$defs/replacementHandPayment" };
  node.allOf.push({ if: { required: ["optionalPayment"] },
    then: { properties: { substitute: prevent, match: { properties: { cause: { const: "EFFECT_KO" } } } } },
    else: { properties: { substitute: move } } });
  s.$defs.replacementHandPayment = {
    allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["selector", "destination"],
    properties: { type: { const: "MOVE_AS_COST" }, destination: { const: "trash" }, selector: {
      allOf: [{ $ref: "#/$defs/activationHandCostSelector" }],
      properties: { min: { const: 1 }, max: { const: 1 }, cardTypes: { items: { enum: ["event", "stage"] } },
        filters: { properties: { type: { const: "all" }, conditions: { maxItems: 0 } } } }
    } }
  };
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset37.schema.json", root), "utf8"));
  const output = JSON.stringify(paidReplacementSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset38.schema.json", "docs/card-effect-paid-replacement.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error("Outdated generated schema: " + file);
    } else fs.writeFileSync(target, output);
  }
}
