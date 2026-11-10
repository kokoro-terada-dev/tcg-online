const fs = require("node:fs");
const path = require("node:path");
const { DON_COUNT_SCOPES } = require("../server/dist/test/effects/v3/dsl.js");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");

const schema = "3.0.0-subset.47", previous = "3.0.0-subset.46";
const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
const emit = (file, data) => {
  const target = path.join(__dirname, "..", file), output = JSON.stringify(data, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated ${file}`);
  } else fs.writeFileSync(target, output);
};

const definition = read("schemas/effect-v3-subset46.schema.json");
const references = DON_COUNT_SCOPES.flatMap(scope => [`SELF.don.${scope}`, `OPPONENT.don.${scope}`]);
definition.$id = "urn:tcg:effect-v3-subset:47";
definition.title = "V3 subset 47: field DON count comparisons";
definition.properties.schemaVersion.const = schema;
definition.$defs.value.oneOf.find(node => node.properties?.ref).properties.ref.anyOf.push({ enum: references });
emit("schemas/effect-v3-subset47.schema.json", definition);

const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
const newer = Object.keys(inventory.profiles).some(version => Number(version.split(".").at(-1)) > 47);
inventory.profiles[schema] = profile;
if (!newer) Object.assign(inventory, { basedOnCommit: "ca7c063", ...profile });
const legacyCompare = inventory.operations.find(op => op.category === "predicate" && op.name === "compare" && op.availableIn.includes(previous));
for (const op of inventory.operations) if (op !== legacyCompare && op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const index = inventory.operations.findIndex(op => op.category === "predicate" && op.name === "compare" && op.availableIn.includes(schema));
const compare = { ...legacyCompare, handlerVersion: "4", availableIn: inventory.operations[index]?.availableIn ?? [schema],
  schemaRef: "../schemas/effect-v3-subset47.schema.json#/$defs/predicate", valueReferences: references,
  runtimeConstraints: "DON count references read public state only. Field includes cost area plus given DON; given DON is neither active nor rested. Unavailable or inconsistent counts are UNKNOWN. Continuous and replacement conditions remain out of scope.",
  example: { type: "compare", left: { ref: "SELF.don.fieldCount" }, op: "lte", right: { ref: "OPPONENT.don.fieldCount" } } };
if (index < 0) inventory.operations.push(compare); else inventory.operations[index] = compare;
emit(file, inventory);
