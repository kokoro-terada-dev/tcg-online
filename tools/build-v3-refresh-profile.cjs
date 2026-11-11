const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.57", previous = "3.0.0-subset.56";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset56.schema.json");
schema.$id = "urn:tcg:effect-v3-subset:57";
schema.title = "V3 subset 57: skip the next opponent refresh";
schema.properties.schemaVersion.const = version;
schema.$defs.action.oneOf.push({ required: ["cards", "duration"], properties: {
  type: { const: "SKIP_REFRESH" }, cards: { $ref: "#/$defs/cardSetRef" }, duration: {
    $ref: "#/$defs/duration", properties: { type: { const: "UNTIL_BOUNDARY" }, player: { const: "OPPONENT" },
      boundary: { const: "TURN_START" }, occurrence: { const: 1 }, includeCurrent: { const: false } }
  }
} });
write("schemas/effect-v3-subset57.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
inventory.operations = inventory.operations.filter(op => op.name !== "SKIP_REFRESH" || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
inventory.operations.push({ name: "SKIP_REFRESH", category: "action", handlerVersion: "1", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset57.schema.json#/$defs/action",
  runtimeConstraints: "Prevents normal activation of selected opposing character instances at their next refresh only." });
write(file, inventory);
