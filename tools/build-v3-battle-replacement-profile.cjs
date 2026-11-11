const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.60", previous = "3.0.0-subset.59";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset59.schema.json"), defs = schema.$defs;
schema.$id = "urn:tcg:effect-v3-subset:60";
schema.title = "V3 subset 60: opponent field exits and damage replacement";
schema.properties.schemaVersion.const = version;
const fixed = (values, properties = {}) => ({ type: "object", additionalProperties: false,
  required: [...Object.keys(values), ...Object.keys(properties)],
  properties: { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { const: value }])), ...properties } });
const replacement = (cause, by, from, to, extra = {}) => ({
  type: "object", allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
  required: ["id", "match", "condition", "substitute", ...Object.keys(extra)],
  properties: { type: { const: "REPLACE_EVENT" }, match: fixed({ cause, by, from: "character", to: "ANY" }),
    condition: { $ref: "#/$defs/predicate" }, substitute: fixed({ from, to }), ...extra }
});
defs.legacyReplacementEffect = defs.replacementEffect;
defs.replacementEffect = { oneOf: [
  { $ref: "#/$defs/legacyReplacementEffect" },
  replacement("DAMAGE", "ANY", "SOURCE", "trash"),
  replacement("OPPONENT_LEAVE", "OPPONENT", "LIFE_TOP", "hand", {
    target: fixed({ type: "OWN_CHARACTER" }, { maxPrintedPower: { type: "integer", minimum: 0, maximum: 100000 } }),
    usageLimit: { const: "ONCE_PER_TURN" }
  })
] };
write("schemas/effect-v3-subset60.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
inventory.operations = inventory.operations.filter(op => op.name !== "REPLACE_EVENT" || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (op.name !== "REPLACE_EVENT" && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
inventory.operations.push({ name: "REPLACE_EVENT", category: "replacement", handlerVersion: "4", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset60.schema.json#/$defs/replacementEffect",
  runtimeConstraints: "Replace incoming battle damage before life processing, or an opposing effect's single field exit / battle KO with a top-life-to-hand move." });
write(file, inventory);
