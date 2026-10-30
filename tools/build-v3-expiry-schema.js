import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function expirySchema(base) {
  const s = structuredClone(base); s.$id = "urn:tcg:effect-v3-subset:24";
  s.title = "V3 subset 24: applied stat/keyword effects with explicit boundary expiry; no continuous effects";
  s.properties.schemaVersion.const = "3.0.0-subset.24";
  s.$defs.duration.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["player", "boundary", "occurrence", "includeCurrent"], properties: {
    type: { const: "UNTIL_BOUNDARY" }, player: { enum: ["SELF", "OPPONENT"] }, boundary: { enum: ["TURN_START", "END_PHASE_END"] }, occurrence: { enum: [1, 2] }, includeCurrent: { type: "boolean" } } });
  return s;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url), s = expirySchema(JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset23.schema.json", root), "utf8")));
  const output = JSON.stringify(s, null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset24.schema.json", "docs/card-effect-expiry.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) { if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`); }
    else fs.writeFileSync(target, output);
  }
}
