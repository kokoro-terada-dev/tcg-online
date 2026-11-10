import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function optionalDonSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:46";
  s.title = "V3 subset 46: optional-count DON addition";
  s.properties.schemaVersion.const = "3.0.0-subset.46";
  const add = { allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
    required: ["player", "max", "state"], properties: {
      type: { const: "ADD_DON_UP_TO" }, player: { const: "SELF" },
      max: { type: "integer", minimum: 1, maximum: 10 }, state: { enum: ["ACTIVE", "REST"] }
    }
  };
  s.$defs.action.oneOf.push(add);
  s.$defs.interactiveMainEventAction.oneOf.push(structuredClone(add));
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const base = JSON.parse(fs.readFileSync(new URL("../schemas/effect-v3-subset45.schema.json", import.meta.url), "utf8"));
  const output = JSON.stringify(optionalDonSchema(base), null, 2) + "\n";
  const target = new URL("../schemas/effect-v3-subset46.schema.json", import.meta.url);
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error("Outdated optional DON schema");
  } else fs.writeFileSync(target, output);
}
