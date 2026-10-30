import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function boundarySchema(base) {
  const s = structuredClone(base), d = s.$defs;
  s.$id = "urn:tcg:effect-v3-subset:23"; s.title = "V3 subset 23: block and main/end phase timing; no new durations";
  s.properties.schemaVersion.const = "3.0.0-subset.23";
  for (const type of ["ON_BLOCK", "MAIN_START", "TURN_END"]) d.timing.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    ...(type === "ON_BLOCK" ? {} : { required: ["player"] }), properties: { type: { const: type }, ...(type === "ON_BLOCK" ? {} : { player: { enum: ["SELF", "OPPONENT"] } }) } });
  const trigger = d.effect.allOf[0].then;
  trigger.properties.timing.properties.type.enum.push("ON_BLOCK", "MAIN_START", "TURN_END");
  trigger.allOf[0].if.properties.timing.properties.type.not = { enum: ["ON_EVENT", "ON_BLOCK", "MAIN_START", "TURN_END"] };
  d.effect.allOf.push({ if: { properties: { timing: { properties: { type: { const: "ON_BLOCK" } } } } }, then: { properties: { sourceZones: { const: ["character"] } } } });
  return s;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url), s = boundarySchema(JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset22.schema.json", root), "utf8")));
  const output = JSON.stringify(s, null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset23.schema.json", "docs/card-effect-boundary.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) { if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`); }
    else fs.writeFileSync(target, output);
  }
}
