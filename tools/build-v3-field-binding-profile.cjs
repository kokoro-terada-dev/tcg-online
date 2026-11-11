const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.52", previous = "3.0.0-subset.51";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset51.schema.json");
schema.$id = "urn:tcg:effect-v3-subset:52";
schema.title = "V3 subset 52: public field binding and resolving entry observation";
schema.properties.schemaVersion.const = version;
for (const group of [schema.$defs.action, schema.$defs.interactiveMainEventAction]) {
  const select = group.oneOf.find(node => node.properties?.type?.const === "SELECT");
  select.properties.automatic = { const: "ALL" };
  (select.allOf ??= []).push({ if: { required: ["automatic"] }, then: { properties: { selector: {
    required: ["zone", "cardTypes", "visibility", "chooser", "min", "max", "faceUpOnly", "owner", "controller"],
    properties: { zone: { const: "character" }, cardTypes: { const: ["character"] }, visibility: { const: "PUBLIC" },
      chooser: { const: "SELF" }, min: { const: 0 }, max: { const: 5 }, faceUpOnly: { const: true } },
    anyOf: ["SELF", "OPPONENT"].map(side => ({ properties: { owner: { const: side }, controller: { const: side } } }))
  } } } });
}
const event = schema.$defs.timing.oneOf.find(node => node.properties?.type?.const === "ON_EVENT" && node.properties.fromZones);
event.properties.fromZones.items.enum.push("resolving");
event.properties.fromZones.maxItems++;
(event.allOf ??= []).push({ if: { properties: { fromZones: { contains: { const: "resolving" } } } },
  then: { properties: { event: { const: "CARD_ENTERED" }, snapshot: { const: "TRANSACTION_AFTER" }, relation: { const: "SELF" },
    owner: { const: "SELF" }, controller: { const: "SELF" } } } });
write("schemas/effect-v3-subset52.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
const changes = { SELECT: ["action", "2", "ALL binds every eligible public character of one player, without a choice."],
  ON_EVENT: ["timing", "3", "An own self-entry observer may match resolving as a move origin."] };
inventory.operations = inventory.operations.filter(op => !Object.hasOwn(changes, op.name) || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (!Object.hasOwn(changes, op.name) && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
for (const [name, [category, handlerVersion, runtimeConstraints]] of Object.entries(changes))
  inventory.operations.push({ category, name, handlerVersion, availableIn: [version],
    schemaRef: `../schemas/effect-v3-subset52.schema.json#/$defs/${category}`, runtimeConstraints });
write(file, inventory);
