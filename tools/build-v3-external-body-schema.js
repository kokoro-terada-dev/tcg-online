import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function externalBodySchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:41";
  s.title = "V3 subset 41: approved MAIN bodies from own trash";
  s.properties.schemaVersion.const = "3.0.0-subset.41";
  s.$defs.externalBodyCall = { allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["from", "maxPrintedCost"],
    properties: { type: { const: "CALL_EFFECT_BODY" }, from: { const: "OWN_TRASH" }, maxPrintedCost: { type: "integer", minimum: 0, maximum: 99 } } };
  const external = { type: "array", minItems: 1, maxItems: 1, items: { $ref: "#/$defs/externalBodyCall" } };
  const caller = { properties: { actions: external } }, effect = s.$defs.effect;
  effect.properties.actions.anyOf.push(external);
  effect.allOf.push({ if: caller, then: {
    properties: { timing: { properties: { type: { enum: ["MAIN", "ON_PLAY", "ON_EVENT"] } } } },
    allOf: [{ if: { properties: { timing: { properties: { type: { const: "ON_EVENT" } } } } },
      then: { properties: { timing: { properties: { event: { const: "CARD_ENTERED" }, relation: { const: "SELF" },
        snapshot: { const: "TRANSACTION_AFTER" } } } } } }]
  } });
  s.allOf.push({ if: { properties: { effects: { contains: caller } } },
    then: { properties: { cardType: { enum: ["leader", "character", "stage"] } } } });
  const event = s.allOf.find(row => row.if?.properties?.cardType?.const === "event").then.properties.effects.items;
  delete event.properties.usageLimit;
  event.allOf.push({ if: { properties: { timing: { properties: { type: { const: "MAIN" } } } } },
    then: { properties: { usageLimit: { properties: { count: { const: 1 } } } } },
    else: { properties: { usageLimit: { type: "null" } } } });
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset40.schema.json", root), "utf8"));
  const output = JSON.stringify(externalBodySchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset41.schema.json", "docs/card-effect-external-body.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error("Outdated generated schema: " + file);
    } else fs.writeFileSync(target, output);
  }
}
