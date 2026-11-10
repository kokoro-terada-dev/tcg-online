import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function battleEffectsSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:42";
  s.title = "V3 subset 42: battle retarget and Banish";
  s.properties.schemaVersion.const = "3.0.0-subset.42";
  const d = s.$defs;
  const action = d.action.oneOf.find(row => row.properties?.type?.enum?.includes("KO"));
  action.properties.type.enum.push("RETARGET_BATTLE");
  d.keyword.properties.type.enum.push("BANISH");
  const ability = d.predicate.oneOf.find(row => row.properties?.type?.const === "HAS_ABILITY");
  ability.properties.ability.enum.push("BANISH");
  ability.allOf[0].then.properties.ability.enum.push("BANISH");
  const contains = { contains: { $ref: "#/$defs/containsRetarget" } };
  d.containsRetarget = { anyOf: [
    { required: ["type"], properties: { type: { const: "RETARGET_BATTLE" } } },
    ...["actions", "then", "else"].map(key => ({ required: [key], properties: { [key]: contains } })),
    { required: ["modes"], properties: { modes: { contains: { required: ["actions"], properties: { actions: contains } } } } }
  ] };
  const retarget = { properties: { actions: contains } };
  d.effect.allOf.push({ if: retarget, then: { properties: { timing: { properties: { type: { enum: ["COUNTER", "ON_OPPONENT_ATTACK"] } } } } } });
  s.allOf.push({ if: { properties: { cardType: { const: "stage" } } }, then: { properties: { effects: { not: { contains: retarget } } } } });
  const event = s.allOf.find(row => row.if?.properties?.cardType?.const === "event").then.properties.effects.items;
  delete event.properties.costs;
  event.allOf.push({ if: { properties: { timing: { properties: { type: { const: "COUNTER" } } } } },
    then: { properties: { costs: { maxItems: 1, items: { properties: { type: { const: "DON_RETURN" } } } } } },
    else: { properties: { costs: { maxItems: 0 } } } });
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset41.schema.json", root), "utf8"));
  const output = JSON.stringify(battleEffectsSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset42.schema.json", "docs/card-effect-battle-effects.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error("Outdated generated schema: " + file);
    } else fs.writeFileSync(target, output);
  }
}
