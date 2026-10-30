import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function effectPlaySchema(base) {
  const s = structuredClone(base); s.$id = "urn:tcg:effect-v3-subset:27";
  s.title = "V3 subset 27: characters played from own hand by effects into empty slots";
  s.properties.schemaVersion.const = "3.0.0-subset.27";
  s.$defs.action.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: ["cards", "from", "destination", "enterState", "provenance", "condition"], properties: {
      type: { const: "PLAY_BY_EFFECT" }, cards: { $ref: "#/$defs/cardSetRef" }, from: { const: "hand" },
      destination: { type: "object", additionalProperties: false, required: ["owner", "zone", "slotPolicy"], properties: { owner: { const: "SELF" }, zone: { const: "character" }, slotPolicy: { const: "FIRST_EMPTY" } } },
      enterState: { enum: ["ACTIVE", "REST"] }, provenance: { const: "EFFECT" }, condition: { $ref: "#/$defs/predicate" } } });
  return s;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url), schema = effectPlaySchema(JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset26.schema.json", root), "utf8")));
  const output = JSON.stringify(schema, null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset27.schema.json", "docs/card-effect-effect-play.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) { if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`); }
    else fs.writeFileSync(target, output);
  }
}
