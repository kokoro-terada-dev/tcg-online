const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, "..");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const emit = (file, json) => fs.writeFileSync(path.join(root, file), JSON.stringify(json, null, 2) + "\n");
const version = "3.0.0-subset.50", prev = "3.0.0-subset.49";
const schema = read("schemas/effect-v3-subset49.schema.json"), d = schema.$defs;
schema.$id = "urn:tcg:effect-v3-subset:50";
schema.title = "V3 subset 50: attached DON and effect zone moves";
schema.properties.schemaVersion.const = version;
d.value.oneOf.find(node => node.properties?.ref).properties.ref.anyOf.push({ const: "SOURCE.attachedDonCount" });
d.predicate.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false,
  properties: { type: { const: "IS_SOURCE" } } });
const attachmentGate = { type: "object", additionalProperties: false, required: ["type", "left", "op", "right"], properties: {
  type: { const: "compare" }, left: { type: "object", additionalProperties: false, required: ["ref"], properties: { ref: { const: "SOURCE.attachedDonCount" } } },
  op: { const: "gte" }, right: { type: "integer", minimum: 1, maximum: 10 }
} };
const triggerConditions = d.effect.allOf[0].then.allOf[0].then.properties;
triggerConditions.activationConditions = { anyOf: [triggerConditions.activationConditions, attachmentGate] };
d.effect.allOf.push({ if: { properties: { activationConditions: attachmentGate } },
  then: { properties: { timing: { properties: { type: { enum: ["MAIN", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK", "TURN_END"] } } } } } });
const action = type => d.action.oneOf.find(node => node.properties?.type?.const === type);
const play = action("PLAY_BY_EFFECT");
play.properties.from = { enum: ["hand", "trash"] };
play.properties.destination.properties.slotPolicy = { enum: ["FIRST_EMPTY", "REPLACE_IF_FULL"] };
const mill = { allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["count"],
  properties: { type: { const: "TRASH_DECK_TOP" }, count: { anyOf: [
    { type: "integer", minimum: 1, maximum: 50 },
    { type: "object", additionalProperties: false, required: ["ref"], properties: { ref: { const: "SOURCE.attachedDonCount" } } }
  ] } } };
d.action.oneOf.push(mill);
const main = d.interactiveMainEventAction.oneOf;
const select = main.find(node => node.properties?.type?.const === "SELECT");
select.properties.selector.properties.zone.anyOf[0].enum.push("trash");
select.properties.selector = { anyOf: [select.properties.selector, { $ref: "#/$defs/boundSelector" }] };
for (const type of ["LOOK_TOP", "ORDER_CARDS", "RETURN_TO_DECK", "TRASH_DECK_TOP", "PLAY_BY_EFFECT"]) main.push(structuredClone(action(type)));
emit("schemas/effect-v3-subset50.schema.json", schema);

const file = "docs/card-effect-supported-operations.json", inventory = read(file);
const registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
for (const op of inventory.operations.filter(row => row.availableIn.includes(prev) && !["compare", "PLAY_BY_EFFECT"].includes(row.name))) {
  if (!op.availableIn.includes(version)) op.availableIn.push(version);
}
inventory.operations = inventory.operations.filter(op => !op.availableIn.includes(version) || !["compare", "PLAY_BY_EFFECT", "TRASH_DECK_TOP", "IS_SOURCE"].includes(op.name));
for (const [category, name, handlerVersion, runtimeConstraints] of [
  ["predicate", "compare", "6", "SOURCE.attachedDonCount uses the current public source instance and generation."],
  ["action", "PLAY_BY_EFFECT", "2", "Own hand or public trash; single-card REPLACE_IF_FULL permits an actor-selected rule discard."],
  ["action", "TRASH_DECK_TOP", "1", "Moves up to count from the actor's deck top directly to public trash without a look or choice."],
  ["predicate", "IS_SOURCE", "1", "Candidate-only comparison of instanceId and generation, respecting source and candidate visibility."]
]) inventory.operations.push({ category, name, handlerVersion, availableIn: [version],
  schemaRef: `../schemas/effect-v3-subset50.schema.json#/$defs/${category}`, runtimeConstraints });
emit(file, inventory);
