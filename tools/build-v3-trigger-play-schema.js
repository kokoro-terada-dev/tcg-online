import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function triggerPlaySchema(base) {
  const s = structuredClone(base);
  s.$id = "urn:tcg:effect-v3-subset:45";
  s.title = "V3 subset 45: unconditional life trigger self-play";
  s.properties.schemaVersion.const = "3.0.0-subset.45";
  const d = s.$defs, action = { required: ["type"], properties: { type: { const: "PLAY_TRIGGER_SOURCE" } } };
  d.action.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, properties: action.properties });
  const contains = { contains: { $ref: "#/$defs/containsTriggerPlay" } };
  d.containsTriggerPlay = { anyOf: [
    action, ...["actions", "then", "else"].map(key => ({ required: [key], properties: { [key]: contains } })),
    { required: ["modes"], properties: { modes: { contains: { required: ["actions"], properties: { actions: contains } } } } }
  ] };
  const uses = { properties: { actions: contains } };
  const always = { properties: { type: { const: "all" }, conditions: { maxItems: 0 } } };
  d.effect.allOf.push({ if: uses, then: { properties: {
    kind: { const: "triggered" }, timing: { properties: { type: { const: "TRIGGER" } } }, sourceZones: { const: ["life"] },
    optional: { const: false }, usageLimit: { type: "null" }, costs: { maxItems: 0 }, activationConditions: always, resolutionConditions: always,
    actions: { minItems: 1, maxItems: 1, items: action }
  } } });
  s.allOf.push({ if: { not: { properties: { cardType: { enum: ["character", "stage"] } } } }, then: { properties: { effects: { not: { contains: uses } } } } });
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const base = JSON.parse(fs.readFileSync(new URL("../schemas/effect-v3-subset44.schema.json", import.meta.url), "utf8"));
  const output = JSON.stringify(triggerPlaySchema(base), null, 2) + "\n";
  const target = new URL("../schemas/effect-v3-subset45.schema.json", import.meta.url);
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error("Outdated trigger play schema");
  } else fs.writeFileSync(target, output);
}
