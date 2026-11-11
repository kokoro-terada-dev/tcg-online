const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.53", previous = "3.0.0-subset.52";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset52.schema.json");
schema.$id = "urn:tcg:effect-v3-subset:53";
schema.title = "V3 subset 53: ordered multi-character effect entry from hand";
schema.properties.schemaVersion.const = version;
// The bound selection's maximum is validated by the Compiler, not JSON Schema.
write("schemas/effect-v3-subset53.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
inventory.operations = inventory.operations.filter(op => op.name !== "PLAY_BY_EFFECT" || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (op.name !== "PLAY_BY_EFFECT" && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
inventory.operations.push({ name: "PLAY_BY_EFFECT", category: "action", handlerVersion: "4", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset53.schema.json#/$defs/action",
  runtimeConstraints: "REPLACE_IF_FULL plays up to five own-hand characters in selection order. An earlier entrant can be displaced; its pending entry effect is skipped." });
write(file, inventory);
