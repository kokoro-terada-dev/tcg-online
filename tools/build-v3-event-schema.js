import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function interactiveEventSchema(base) {
  const schema = structuredClone(base);
  schema.$id = "urn:tcg:effect-v3-subset:20";
  schema.title = "V3 subset 20: resumable event MAIN; compilation is not approval";
  schema.properties.schemaVersion.const = "3.0.0-subset.20";
  const allowed = new Set(["DRAW", "SEQUENCE", "IF", "SELECT", "KO", "REST", "SET_ACTIVE", "MODIFY_STAT", "GRANT_KEYWORD", "MOVE_CARD", "REVEAL"]);
  const action = structuredClone(schema.$defs.action);
  action.oneOf = action.oneOf.filter(node => (node.properties.type.enum ?? [node.properties.type.const]).every(type => allowed.has(type)));
  for (const node of action.oneOf) {
    const p = node.properties, type = p.type.const;
    if (type === "DRAW") p.player = { const: "SELF" };
    if (type === "SEQUENCE") p.actions = { $ref: "#/$defs/interactiveMainEventActions", minItems: 1 };
    if (type === "IF") { p.then = { $ref: "#/$defs/interactiveMainEventActions" }; p.else = { $ref: "#/$defs/interactiveMainEventActions" }; }
    if (type === "SELECT") p.selector = { allOf: [{ $ref: "#/$defs/areaSelector" }], properties: { zone: { enum: ["leader", "character", "stage", "hand"] }, cardTypes: { items: { enum: ["leader", "character", "stage", "event"] } } } };
    if (type === "MODIFY_STAT" || type === "GRANT_KEYWORD") p.duration = { allOf: [{ $ref: "#/$defs/duration" }], properties: { type: { const: "TURN_END" } } };
    if (type === "MOVE_CARD") p.destination = { allOf: [{ $ref: "#/$defs/destination" }], properties: { zone: { enum: ["hand", "trash", "public"] }, position: { const: "append" } } };
  }
  schema.$defs.interactiveMainEventAction = action;
  schema.$defs.interactiveMainEventActions = { type: "array", maxItems: 128, items: { $ref: "#/$defs/interactiveMainEventAction" } };
  const event = schema.allOf.find(node => node.if?.properties?.cardType?.const === "event");
  event.then.properties.effects.items.allOf[0].then.properties.actions = { $ref: "#/$defs/interactiveMainEventActions", minItems: 1 };
  return schema;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--check")) throw Error("Only --check is supported");
  const root = new URL("../", import.meta.url), base = JSON.parse(fs.readFileSync(new URL("schemas/effect-v3-subset19.schema.json", root), "utf8"));
  const output = JSON.stringify(interactiveEventSchema(base), null, 2) + "\n";
  for (const file of ["schemas/effect-v3-subset20.schema.json", "docs/card-effect-interactive-event.schema.json"]) {
    const target = new URL(file, root);
    if (process.argv.includes("--check")) { if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated generated schema: ${file}`); }
    else fs.writeFileSync(target, output);
  }
}
