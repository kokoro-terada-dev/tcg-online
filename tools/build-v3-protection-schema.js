import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function protectionSchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:36";
  s.title = "V3 subset 36: cause-aware continuous protection";
  s.properties.schemaVersion.const = "3.0.0-subset.36";
  const node = s.$defs.continuousEffect;
  const type = { const: "RESTRICT" }, by = { enum: ["SELF", "OPPONENT", "ANY"] };
  const variant = (policy, by, extra = {}, required = []) => ({ type: "object", additionalProperties: false,
    required: ["type", "policy", "by", ...required], properties: { type, policy, by, ...extra } });
  node.properties.operation.oneOf.push(
    variant({ enum: ["CANNOT_TARGET", "PREVENT_MOVE"] }, by),
    variant({ const: "UNAFFECTED_BY" }, { const: "OPPONENT" }),
    variant({ const: "CANNOT_KO" }, by, { cause: { const: "EFFECT" } }, ["cause"]),
    variant({ const: "CANNOT_KO" }, by, { cause: { const: "BATTLE" }, sourceAttribute: { type: "string", minLength: 1, maxLength: 80, pattern: "^\\S(?:.*\\S)?$" } }, ["cause"])
  );
  node.allOf.push(
    { if: { properties: { operation: { properties: { type } } } }, then: { properties: { affectedQuery: { properties: { owner: { const: "SELF" }, controller: { const: "SELF" } } } } } },
    { if: { properties: { operation: { required: ["policy"], properties: { policy: { const: "CANNOT_KO" } } } } },
      then: { properties: { affectedQuery: { properties: { zone: { const: "character" } } } } } }
  );
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url);
  const base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset35.schema.json", root), "utf8"));
  const output = JSON.stringify(protectionSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset36.schema.json", "docs/card-effect-protection.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) {
      if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`);
    } else fs.writeFileSync(target, output);
  }
}
