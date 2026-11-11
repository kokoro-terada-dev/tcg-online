const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.54", previous = "3.0.0-subset.53";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset53.schema.json"), defs = schema.$defs;
schema.$id = "urn:tcg:effect-v3-subset:54";
schema.title = "V3 subset 54: top life and field activation costs";
schema.properties.schemaVersion.const = version;
delete defs.effectMode.properties.actions.minItems;
defs.activationFieldCostSelector = structuredClone(defs.activationHandCostSelector);
Object.assign(defs.activationFieldCostSelector.properties, { zone: { const: "character" }, visibility: { const: "PUBLIC" },
  faceUpOnly: { const: true }, min: { const: 1 }, max: { const: 1 }, cardTypes: { const: ["character"] } });
defs.cost.oneOf.find(node => node.properties.type.const === "MOVE_AS_COST").properties.selector.oneOf.push({ $ref: "#/$defs/activationFieldCostSelector" });
defs.cost.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["operation"],
  properties: { type: { const: "LIFE_TOP_COST" }, operation: { enum: ["TO_HAND", "FACE_UP", "FACE_DOWN"] } } });
const triggeredCondition = defs.effect.allOf[0].then.allOf[0];
triggeredCondition.then = { anyOf: [triggeredCondition.then, { properties: {
  timing: { properties: { type: { const: "ON_PLAY" } } },
  costs: { minItems: 1, maxItems: 1, items: { properties: { type: { const: "LIFE_TOP_COST" } } } }
} }] };
const eventCost = schema.allOf.find(rule => rule.if.properties.cardType?.const === "event").then.properties.effects.items.allOf
  .find(rule => rule.if?.properties?.timing?.properties?.type?.const === "COUNTER");
eventCost.then.properties.costs.items.properties.type = { enum: ["DON_RETURN", "LIFE_TOP_COST"] };
eventCost.else.properties.costs = { maxItems: 1, items: {
  properties: { type: { const: "MOVE_AS_COST" }, selector: { $ref: "#/$defs/activationFieldCostSelector" } }
} };
write("schemas/effect-v3-subset54.schema.json", schema);

const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
const changed = new Set(["LIFE_TOP_COST", "MOVE_AS_COST", "CHOOSE_MODE"]);
inventory.operations = inventory.operations.filter(op => !changed.has(op.name) || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (!changed.has(op.name) && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
for (const [name, category, handlerVersion, runtimeConstraints] of [
  ["LIFE_TOP_COST", "cost", "1", "Use only the actor's top life card. Face changes require the opposite face and retain card generation."],
  ["MOVE_AS_COST", "cost", "2", "Supports paying by moving one own public character to trash without KO."],
  ["CHOOSE_MODE", "action", "2", "Allows an empty mode to represent choosing not to perform an optional operation."]
]) inventory.operations.push({ name, category, handlerVersion, runtimeConstraints, availableIn: [version],
  schemaRef: `../schemas/effect-v3-subset54.schema.json#/$defs/${category}` });
write(file, inventory);
