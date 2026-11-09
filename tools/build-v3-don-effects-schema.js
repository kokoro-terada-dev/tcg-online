import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function donEffectsSchema(base) {
  const s = structuredClone(base); s.$id = "urn:tcg:effect-v3-subset:28";
  s.title = "V3 subset 28: change own cost-area DON state and add from own DON deck";
  s.properties.schemaVersion.const = "3.0.0-subset.28";
  const state = { enum: ["ACTIVE", "REST"] };
  s.$defs.action.oneOf.push(
    { allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["cards", "from", "to"],
      properties: { type: { const: "SET_DON_STATE" }, cards: { $ref: "#/$defs/cardSetRef" }, from: state, to: state },
      not: { anyOf: ["ACTIVE", "REST"].map(value => ({ properties: { from: { const: value }, to: { const: value } } })) } },
    { allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["player", "count", "state", "onInsufficient"],
      properties: { type: { const: "ADD_DON" }, player: { const: "SELF" }, count: { type: "integer", minimum: 1, maximum: 10 }, state, onInsufficient: { const: "fail" } } });
  return s;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url), schema = donEffectsSchema(JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset27.schema.json", root), "utf8")));
  const output = JSON.stringify(schema, null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset28.schema.json", "docs/card-effect-don-effects.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) { if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`); }
    else fs.writeFileSync(target, output);
  }
}
