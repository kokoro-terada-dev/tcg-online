import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function resolvingTriggerSchema(base) {
  const schema = structuredClone(base);
  schema.$id = "urn:tcg:effect-v3-subset:22";
  schema.title = "V3 subset 22: reviewed conditional trigger resolution using shared runtime";
  schema.properties.schemaVersion.const = "3.0.0-subset.22";
  return schema;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url), base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset21.schema.json", root), "utf8"));
  const output = JSON.stringify(resolvingTriggerSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset22.schema.json", "docs/card-effect-resolving-trigger.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) { if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`); }
    else fs.writeFileSync(target, output);
  }
}
