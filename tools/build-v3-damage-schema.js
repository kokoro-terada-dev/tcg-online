import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function damageSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:43";
  s.title = "V3 subset 43: stage KO, life movement and double attack";
  s.properties.schemaVersion.const = "3.0.0-subset.43";
  const d = s.$defs;
  d.action.oneOf.find(row => row.properties?.type?.enum?.includes("KO")).properties.type.enum.push("KO_STAGE");
  d.keyword.properties.type.enum.push("DOUBLE_ATTACK");
  const ability = d.predicate.oneOf.find(row => row.properties?.type?.const === "HAS_ABILITY");
  ability.properties.ability.enum.push("DOUBLE_ATTACK");
  ability.allOf[0].then.properties.ability.enum.push("DOUBLE_ATTACK");
  const lifeEnds = ["LIFE_TOP", "LIFE_BOTTOM"];
  for (const from of ["DECK_TOP", "BOUND", ...lifeEnds]) {
    const toLife = !lifeEnds.includes(from), bound = from === "BOUND";
    d.action.oneOf.push({
      allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
      required: ["player", "from", "to", ...(toLife ? ["faceUp"] : []), ...(bound ? ["cards"] : [])],
      properties: {
        type: { const: "MOVE_LIFE" }, player: { enum: ["SELF", "OPPONENT"] }, from: { const: from },
        to: { enum: toLife ? lifeEnds : ["HAND", "TRASH", "DECK_BOTTOM"] },
        ...(toLife ? { faceUp: { type: "boolean" } } : {}),
        ...(bound ? { cards: { $ref: "#/$defs/cardSetRef" } } : {})
      }
    });
  }
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset42.schema.json", root), "utf8"));
  const output = JSON.stringify(damageSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset43.schema.json", "docs/card-effect-damage.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error("Outdated generated schema: " + file);
    } else fs.writeFileSync(target, output);
  }
}
