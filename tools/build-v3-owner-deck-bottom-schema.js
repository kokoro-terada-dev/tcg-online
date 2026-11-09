import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function ownerDeckBottomSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:33";
  s.title = "V3 subset 33: ordered opponent-owned hand return to deck bottom";
  s.properties.schemaVersion.const = "3.0.0-subset.33";
  s.$defs.action.oneOf.push({
    allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: ["player", "chooser", "count", "destination"], properties: {
      type: { const: "ORDER_THEN_MOVE" }, player: { const: "OPPONENT" }, chooser: { const: "OPPONENT" },
      count: { type: "integer", minimum: 1, maximum: 50 }, destination: { const: "deckBottom" }
    }
  });
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset32.schema.json", root), "utf8"));
  const output = JSON.stringify(ownerDeckBottomSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset33.schema.json", "docs/card-effect-owner-deck-bottom.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`);
    } else fs.writeFileSync(target, output);
  }
}
