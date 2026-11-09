import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function effectBodySchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:40";
  s.title = "V3 subset 40: same-card MAIN effect body in life triggers";
  s.properties.schemaVersion.const = "3.0.0-subset.40";
  s.$defs.effectBodyCall = { allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["effectId"],
    properties: { type: { const: "CALL_EFFECT_BODY" }, effectId: { $ref: "#/$defs/id" } } };
  const effect = s.$defs.effect, call = { type: "array", minItems: 1, maxItems: 1, items: { $ref: "#/$defs/effectBodyCall" } };
  effect.properties.actions = { anyOf: [effect.properties.actions, call] };
  const callsMain = { properties: { actions: call } };
  effect.allOf.push({ if: callsMain, then: { properties: { timing: { properties: { type: { const: "TRIGGER" } } } } } });
  s.allOf.push({ if: { properties: { effects: { contains: callsMain } } }, then: { properties: {
    cardType: { const: "event" }, effects: { contains: { properties: { timing: { properties: { type: { const: "MAIN" } } } } } }
  } } });
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset39.schema.json", root), "utf8"));
  const output = JSON.stringify(effectBodySchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset40.schema.json", "docs/card-effect-body.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error("Outdated generated schema: " + file);
    } else fs.writeFileSync(target, output);
  }
}
