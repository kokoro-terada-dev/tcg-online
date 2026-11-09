import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function replacementPrioritySchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:39";
  s.title = "V3 subset 39: replacement priority and per-turn use";
  s.properties.schemaVersion.const = "3.0.0-subset.39";
  const source = s.allOf.find(row => row.if?.required?.includes("replacementEffects"));
  source.then.properties.cardType = { enum: ["leader", "character", "stage"] };
  s.allOf.push({ if: { properties: { cardType: { enum: ["leader", "stage"] } } },
    then: { properties: { replacementEffects: { items: { required: ["target"] } } } } });
  const node = s.$defs.replacementEffect, hand = node.properties.optionalPayment;
  node.properties.target = { type: "object", additionalProperties: false, required: ["type", "minPrintedCost"],
    properties: { type: { const: "OWN_CHARACTER" }, minPrintedCost: { type: "integer", minimum: 0, maximum: 99 } } };
  node.properties.usageLimit = { const: "ONCE_PER_TURN" };
  node.properties.optionalPayment = { oneOf: [hand, { $ref: "#/$defs/replacementDonPayment" }] };
  node.allOf.push({ if: { required: ["target"] }, then: { required: ["optionalPayment"], properties: { optionalPayment: hand } } });
  s.$defs.replacementHandPayment.properties.selector.properties.cardTypes.items.enum.push("character");
  const don = structuredClone(s.$defs.cost.oneOf.find(row => row.properties?.type?.const === "DON_RETURN"));
  don.allOf = [{ $ref: "#/$defs/meta" }];
  don.unevaluatedProperties = false;
  don.properties.count = { const: 1 };
  s.$defs.replacementDonPayment = don;
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset38.schema.json", root), "utf8"));
  const output = JSON.stringify(replacementPrioritySchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset39.schema.json", "docs/card-effect-replacement-priority.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error("Outdated generated schema: " + file);
    } else fs.writeFileSync(target, output);
  }
}
