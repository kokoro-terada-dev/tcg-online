const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");

const root = path.join(__dirname, ".."), version = "3.0.0-subset.51", previous = "3.0.0-subset.50";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset50.schema.json");
schema.$id = "urn:tcg:effect-v3-subset:51";
schema.title = "V3 subset 51: inspected deck character play";
schema.properties.schemaVersion.const = version;
const callConstraint = schema.allOf.find(node => node.if?.properties?.effects?.contains?.properties?.actions?.items?.$ref === "#/$defs/effectBodyCall");
const timingTarget = (cardType, timings) => ({ properties: { cardType: { const: cardType },
  effects: { contains: { properties: { timing: { properties: { type: { enum: timings } } } } } } } });
callConstraint.then = { anyOf: [timingTarget("event", ["MAIN", "COUNTER"]), timingTarget("character", ["ON_PLAY", "ON_KO"])] };
for (const group of [schema.$defs.action, schema.$defs.interactiveMainEventAction]) {
  const play = group.oneOf.find(node => node.properties?.type?.const === "PLAY_BY_EFFECT");
  play.properties.from.enum.push("deck");
  play.allOf.push({ if: { required: ["from"], properties: { from: { const: "deck" } } },
    then: { properties: { destination: { properties: { slotPolicy: { const: "REPLACE_IF_FULL" } } } } } });
  group.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, properties: { type: { const: "SHUFFLE_DECK" } } });
  const move = group.oneOf.find(node => node.properties?.type?.const === "MOVE_CARD");
  move.properties.excludeCards = { $ref: "#/$defs/cardSetRef" };
  move.allOf = [{ if: { required: ["excludeCards"] },
    then: { properties: { destination: { properties: { owner: { const: "SELF" }, zone: { const: "trash" } } } } } }];
}
const main = schema.$defs.interactiveMainEventAction.oneOf;
const extra = new Set(["OFFER_PAYMENT", "IF_PAYMENT_SUCCEEDED", "CHOOSE_MODE", "MOVE_LIFE"]);
main.push(...structuredClone(schema.$defs.action.oneOf.filter(node => extra.has(node.properties?.type?.const))));
const fieldAction = structuredClone(schema.$defs.action.oneOf.find(node => node.properties?.type?.enum?.includes("KO")));
fieldAction.properties.type.enum = ["KO", "KO_STAGE", "REST", "SET_ACTIVE"];
main.push(fieldAction);
write("schemas/effect-v3-subset51.schema.json", schema);

const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
const changed = new Set(["PLAY_BY_EFFECT", "CALL_EFFECT_BODY", "MOVE_CARD", "CONTINUOUS_EFFECT"]);
inventory.operations = inventory.operations.filter(op => !changed.has(op.name) || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (!changed.has(op.name) && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
inventory.operations.push({ category: "action", name: "PLAY_BY_EFFECT", handlerVersion: "3", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset51.schema.json#/$defs/action",
  runtimeConstraints: "Adds a single inspected own-deck character to REPLACE_IF_FULL. Requires a current resolution-scoped inspection grant." });
inventory.operations.push({ category: "action", name: "CALL_EFFECT_BODY", handlerVersion: "3", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset51.schema.json#/$defs/action",
  runtimeConstraints: "Life triggers may call a same-card, source-independent ON_PLAY, ON_KO or COUNTER body with no activation costs or usage limit." });
inventory.operations = inventory.operations.filter(op => op.name !== "SHUFFLE_DECK" || !op.availableIn.includes(version));
inventory.operations.push({ category: "action", name: "SHUFFLE_DECK", handlerVersion: "1", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset51.schema.json#/$defs/action",
  runtimeConstraints: "Server-side permutation of the actor's own deck; closes inspection grants for that deck." });
inventory.operations.push({ category: "action", name: "MOVE_CARD", handlerVersion: "4", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset51.schema.json#/$defs/action",
  runtimeConstraints: "Optional excludeCards subtracts exact inspected deck references before moving the remainder to own trash." });
inventory.operations.push({ category: "action", name: "CONTINUOUS_EFFECT", handlerVersion: "4", availableIn: [version],
  schemaRef: "../schemas/effect-v3-subset51.schema.json#/$defs/continuousEffect",
  runtimeConstraints: "Allows stable player DON counts and public field name/metadata queries, not dependent current stats or abilities." });
write(file, inventory);
