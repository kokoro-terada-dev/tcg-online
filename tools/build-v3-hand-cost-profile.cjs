const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.61", previous = "3.0.0-subset.60";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset60.schema.json"), continuous = schema.$defs.continuousEffect;
schema.$id = "urn:tcg:effect-v3-subset:61";
schema.title = "V3 subset 61: hand-only character cost adjustments";
schema.properties.schemaVersion.const = version;
continuous.properties.sourceZone = { const: "hand" };
const ordinaryScope = continuous.allOf[1];
continuous.allOf[1] = { if: { required: ["sourceZone"] }, then: { properties: {
  affectedQuery: { properties: { zone: { const: "hand" }, filters: { properties: { type: { const: "IS_SOURCE" } } } } },
  operation: { properties: { type: { const: "ADD_STAT" }, stat: { const: "cost" }, amount: { minimum: -99, maximum: -1 } } }
} }, else: ordinaryScope };
write("schemas/effect-v3-subset61.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
inventory.operations = inventory.operations.filter(op => op.name !== "CONTINUOUS_EFFECT" || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (op.name !== "CONTINUOUS_EFFECT" && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
inventory.operations.push({ name: "CONTINUOUS_EFFECT", category: "action", handlerVersion: "5", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset61.schema.json#/$defs/continuousEffect",
  runtimeConstraints: "A hand source may lower only its own cost using a public opponent-character current-power query." });
write(file, inventory);
