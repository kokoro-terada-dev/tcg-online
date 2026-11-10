const fs = require("node:fs");
const path = require("node:path");
const { PUBLIC_TRIGGER_COUNT_REFS } = require("../server/dist/test/effects/v3/dsl.js");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");

const schema = "3.0.0-subset.48", previous = "3.0.0-subset.47";
const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
const emit = (file, data) => {
  const target = path.join(__dirname, "..", file), output = JSON.stringify(data, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated ${file}`);
  } else fs.writeFileSync(target, output);
};
const definition = read("schemas/effect-v3-subset47.schema.json");
definition.$id = "urn:tcg:effect-v3-subset:48";
definition.title = "V3 subset 48: conditional life trigger self-play";
definition.properties.schemaVersion.const = schema;
const d = definition.$defs, predicate = { $ref: "#/$defs/triggerPlayCondition" };
const count = { anyOf: [{ type: "integer" }, { type: "object", required: ["ref"], properties: { ref: { enum: PUBLIC_TRIGGER_COUNT_REFS } } }] };
const node = (type, fields = {}) => ({ required: ["type", ...Object.keys(fields)], properties: { type: { const: type }, ...fields } });
const candidate = { const: "CANDIDATE" };
d.triggerPlayCondition = { anyOf: [
  node("compare", { left: count, right: count }), node("TURN_IS"),
  node("all", { conditions: { items: predicate } }), node("any", { conditions: { items: predicate } }), node("not", { condition: predicate }),
  node("EXISTS", { query: {
    properties: { zone: { const: "leader" }, visibility: { const: "PUBLIC" }, faceUpOnly: { const: true },
      cardTypes: { const: ["leader"] }, excludeSource: { const: false }, filters: { anyOf: [
        node("CARD_NAME", { subject: candidate }), node("CARD_METADATA", { subject: candidate, field: { const: "traits" }, comparison: { const: "EXACT" } })
      ] } },
    anyOf: ["SELF", "OPPONENT"].map(side => ({ properties: { owner: { const: side }, controller: { const: side } } }))
  } })
] };
const effect = d.effect.allOf.find(rule => rule.if?.properties?.actions?.contains?.$ref === "#/$defs/containsTriggerPlay");
effect.then.properties.resolutionConditions = predicate;
emit("schemas/effect-v3-subset48.schema.json", definition);

const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
inventory.profiles[schema] = profile;
if (!Object.keys(inventory.profiles).some(version => Number(version.split(".").at(-1)) > 48))
  Object.assign(inventory, { basedOnCommit: "480c9a2", ...profile });
const isSelfPlay = op => op.category === "action" && op.name === "PLAY_TRIGGER_SOURCE";
const previousEntry = inventory.operations.find(op => isSelfPlay(op) && op.availableIn.includes(previous));
for (const op of inventory.operations) if (op !== previousEntry && op.availableIn.includes(previous) && !op.availableIn.includes(schema)) op.availableIn.push(schema);
const index = inventory.operations.findIndex(op => isSelfPlay(op) && op.availableIn.includes(schema));
const entry = { ...previousEntry, handlerVersion: "2", availableIn: inventory.operations[index]?.availableIn ?? [schema],
  schemaRef: "../schemas/effect-v3-subset48.schema.json#/$defs/effect",
  runtimeConstraints: "Only as the entire Character/Stage life TRIGGER program, without activation costs or conditions. Optional public resolutionConditions are checked after Life removal; false uses normal trigger cleanup. Does not pay printed DON." };
if (index < 0) inventory.operations.push(entry); else inventory.operations[index] = entry;
emit(file, inventory);
