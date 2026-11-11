const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.58", previous = "3.0.0-subset.57";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset57.schema.json");
schema.$id = "urn:tcg:effect-v3-subset:58";
schema.title = "V3 subset 58: turn-scoped field restrictions";
schema.properties.schemaVersion.const = version;
const disable = { required: ["cards"], properties: { type: { const: "DISABLE_CARD_EFFECTS" }, cards: { $ref: "#/$defs/cardSetRef" } } };
schema.$defs.action.oneOf.push(disable, { required: ["player"], properties: { type: { const: "PREVENT_CHARACTER_PLAY" }, player: { const: "SELF" } } });
schema.$defs.interactiveMainEventAction.oneOf.push(disable);
write("schemas/effect-v3-subset58.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
const names = ["DISABLE_CARD_EFFECTS", "PREVENT_CHARACTER_PLAY"];
inventory.operations = inventory.operations.filter(op => !names.includes(op.name) || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
for (const name of names) inventory.operations.push({ name, category: "action", handlerVersion: "1", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset58.schema.json#/$defs/action" });
write(file, inventory);
