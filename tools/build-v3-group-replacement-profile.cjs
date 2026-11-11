const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.62", previous = "3.0.0-subset.61";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset61.schema.json"), defs = schema.$defs;
schema.$id = "urn:tcg:effect-v3-subset:62";
schema.title = "V3 subset 62: simultaneous character exit replacements";
schema.properties.schemaVersion.const = version;
const fixed = values => ({ type: "object", additionalProperties: false, required: Object.keys(values),
  properties: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { const: value }])) });
defs.replacementEffect.oneOf.push({
  type: "object", allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
  required: ["id", "match", "condition", "substitute", "group"],
  properties: { type: { const: "REPLACE_EVENT" }, condition: { $ref: "#/$defs/predicate" },
    match: { oneOf: [fixed({ cause: "OPPONENT_EFFECT_LEAVE", by: "OPPONENT", from: "character", to: "ANY" }),
      fixed({ cause: "KO", by: "ANY", from: "character", to: "trash" })] },
    substitute: { oneOf: [fixed({ from: "SOURCE_KO", to: "trash" }), fixed({ from: "SOURCE_REST", to: "character" })] },
    group: { type: "object", additionalProperties: false, required: ["filters"], properties: { filters: { $ref: "#/$defs/predicate" } } } }
});
write("schemas/effect-v3-subset62.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
inventory.operations = inventory.operations.filter(op => op.name !== "REPLACE_EVENT" || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (op.name !== "REPLACE_EVENT" && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
inventory.operations.push({ name: "REPLACE_EVENT", category: "replacement", handlerVersion: "5", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset62.schema.json#/$defs/replacementEffect",
  runtimeConstraints: "One replacement may cover all matching simultaneous field exits, with one source KO or source rest as the substitute." });
write(file, inventory);
