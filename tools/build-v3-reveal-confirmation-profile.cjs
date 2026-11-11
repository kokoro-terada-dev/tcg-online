const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.56", previous = "3.0.0-subset.55";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset55.schema.json");
schema.$id = "urn:tcg:effect-v3-subset:56";
schema.title = "V3 subset 56: opponent confirmation of revealed hand cards";
schema.properties.schemaVersion.const = version;
schema.$defs.cost.oneOf.find(node => node.properties.type.const === "REVEAL_CARDS").properties.confirmation = { const: "OPPONENT" };
write("schemas/effect-v3-subset56.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
inventory.operations = inventory.operations.filter(op => op.name !== "REVEAL_CARDS" || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (op.name !== "REVEAL_CARDS" && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
inventory.operations.push({ name: "REVEAL_CARDS", category: "cost", handlerVersion: "2", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset56.schema.json#/$defs/cost",
  runtimeConstraints: "With confirmation OPPONENT, wait for the opposing player after the exact eligible hand selection is publicly revealed." });
write(file, inventory);
