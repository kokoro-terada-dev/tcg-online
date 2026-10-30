import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function conditionalTriggerSchema(base) {
  const schema = structuredClone(base), defs = schema.$defs;
  schema.$id = "urn:tcg:effect-v3-subset:21";
  schema.title = "V3 subset 21: conditional trigger observation only; resolution deferred to PR06b";
  schema.properties.schemaVersion.const = "3.0.0-subset.21";
  defs.predicate.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: ["player"], properties: { type: { const: "TURN_IS" }, player: { enum: ["SELF", "OPPONENT"] } } });
  const zones = ["hand", "deck", "life", "trash", "public", "character", "stage"];
  const set = values => ({ type: "array", minItems: 1, maxItems: values.length, uniqueItems: true, items: { enum: values } });
  defs.timing = { oneOf: [defs.timing, { allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: ["event", "snapshot", "relation", "owner", "controller", "fromZones", "toZones", "cardTypes", "filters"], properties: {
      type: { const: "ON_EVENT" }, event: { enum: ["CARD_ENTERED", "CARD_KO", "CARD_MOVED"] },
      snapshot: { enum: ["TRANSACTION_BEFORE", "TRANSACTION_AFTER"] }, relation: { enum: ["SELF", "OTHER", "ANY"] },
      owner: { enum: ["SELF", "OPPONENT", "ANY"] }, controller: { enum: ["SELF", "OPPONENT", "ANY"] },
      fromZones: set(zones), toZones: set(zones), cardTypes: set(["character", "stage", "event"]), filters: { $ref: "#/$defs/predicate" }
    } }] };
  const triggered = defs.effect.allOf[0].then;
  triggered.properties.timing.properties.type.enum.push("ON_EVENT");
  const emptyActivation = triggered.properties.activationConditions;
  delete triggered.properties.activationConditions;
  triggered.allOf = [{ if: { properties: { timing: { properties: { type: { not: { const: "ON_EVENT" } } } } } },
    then: { properties: { activationConditions: emptyActivation } } }];
  return schema;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url), base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset20.schema.json", root), "utf8"));
  const output = JSON.stringify(conditionalTriggerSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset21.schema.json", "docs/card-effect-conditional-trigger.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) { if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`); }
    else fs.writeFileSync(target, output);
  }
}
