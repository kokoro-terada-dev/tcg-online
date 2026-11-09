import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function donTransferSchema(base) {
  const s = structuredClone(base); s.$id = "urn:tcg:effect-v3-subset:29";
  s.title = "V3 subset 29: effect DON attachment, return and return-batch observers";
  s.properties.schemaVersion.const = "3.0.0-subset.29";
  const ref = { $ref: "#/$defs/cardSetRef" }, meta = [{ $ref: "#/$defs/meta" }];
  s.$defs.action.oneOf.push(
    { allOf: meta, unevaluatedProperties: false, required: ["from", "assignments"], properties: { type: { const: "ATTACH_DON" },
      from: { enum: ["ACTIVE", "REST"] }, assignments: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", additionalProperties: false,
        required: ["cards", "target"], properties: { cards: ref, target: ref } } } } },
    { allOf: meta, unevaluatedProperties: false, required: ["cards", "from"], properties: { type: { const: "RETURN_DON_BY_EFFECT" }, cards: ref,
      from: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: ["activeDon", "restDon", "attachedDon"] } } } });
  s.$defs.timing.oneOf.push({ allOf: meta, unevaluatedProperties: false, required: ["event", "owner", "cause", "min"],
    properties: { type: { const: "ON_EVENT" }, event: { const: "DON_RETURNED" }, owner: { enum: ["SELF", "OPPONENT"] },
      cause: { enum: ["EFFECT_MOVE", "COST_PAYMENT", "ANY"] }, min: { type: "integer", minimum: 1, maximum: 10 } } });
  return s;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url), schema = donTransferSchema(JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset28.schema.json", root), "utf8")));
  const output = JSON.stringify(schema, null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset29.schema.json", "docs/card-effect-don-transfer.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) { if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`); }
    else fs.writeFileSync(target, output);
  }
}
