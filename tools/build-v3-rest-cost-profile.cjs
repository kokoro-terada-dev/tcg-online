const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.55", previous = "3.0.0-subset.54";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset54.schema.json"), defs = schema.$defs;
schema.$id = "urn:tcg:effect-v3-subset:55";
schema.title = "V3 subset 55: rest a selected card as a cost";
schema.properties.schemaVersion.const = version;
const mixedZones = { type: "array", minItems: 2, maxItems: 4, uniqueItems: true,
  contains: { const: "activeDon" }, items: { enum: ["leader", "character", "stage", "activeDon"] } };
defs.areaSelector.properties.zone.oneOf.push(mixedZones);
defs.areaSelector.allOf[1].oneOf[0].properties.zone.anyOf.push(mixedZones);
defs.cost.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["selector"],
  properties: { type: { const: "REST_AS_COST" }, selector: { $ref: "#/$defs/areaSelector" } } });
const eventEffect = schema.allOf.find(rule => rule.if.properties.cardType?.const === "event").then.properties.effects.items;
delete eventEffect.properties.optional;
eventEffect.allOf.push({ if: { properties: { optional: { const: true } } }, then: { properties: {
  costs: { minItems: 1, maxItems: 1, items: { properties: { type: { const: "REST_AS_COST" } } } }
} } });
const eventCost = eventEffect.allOf
  .find(rule => rule.if?.properties?.timing?.properties?.type?.const === "COUNTER");
eventCost.then.properties.costs.items.properties.type.enum.push("REST_AS_COST");
eventCost.else.properties.costs.items = { anyOf: [eventCost.else.properties.costs.items, { properties: { type: { const: "REST_AS_COST" } } }] };
write("schemas/effect-v3-subset55.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
inventory.operations = inventory.operations.filter(op => !["CARDS", "REST_AS_COST"].includes(op.name) || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (op.name !== "CARDS" && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
inventory.operations.push(
  { name: "CARDS", category: "selector", handlerVersion: "6", availableIn: [version], schemaRef: "../schemas/effect-v3-subset55.schema.json#/$defs/selector" },
  { name: "REST_AS_COST", category: "cost", handlerVersion: "1", availableIn: [version], schemaRef: "../schemas/effect-v3-subset55.schema.json#/$defs/cost",
    runtimeConstraints: "Rest one matching active card from the actor's public field or active DON." }
);
write(file, inventory);
