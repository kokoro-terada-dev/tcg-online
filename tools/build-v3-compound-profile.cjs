const fs = require("node:fs");
const path = require("node:path");
const { PUBLIC_FIELD_ZONES } = require("../server/dist/test/effects/v3/dsl.js");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");

const schema = "3.0.0-subset.49", previous = "3.0.0-subset.48";
const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
const emit = (file, data) => {
  const target = path.join(__dirname, "..", file), output = JSON.stringify(data, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== output) throw Error(`Outdated ${file}`);
  } else fs.writeFileSync(target, output);
};
const definition = read("schemas/effect-v3-subset48.schema.json"), d = definition.$defs;
definition.$id = "urn:tcg:effect-v3-subset:49";
definition.title = "V3 subset 49: compound effects";
definition.properties.schemaVersion.const = schema;
d.value.oneOf.find(node => node.properties?.ref).properties.ref.anyOf.push({ const: "BOTH.lifeCount" });
for (const key of ["left", "right"])
  d.triggerPlayCondition.anyOf[0].properties[key].anyOf[1].properties.ref.enum.push("BOTH.lifeCount");

const fields = { enum: PUBLIC_FIELD_ZONES }, fieldList = { type: "array", items: fields, minItems: 1, maxItems: 3, uniqueItems: true };
const fieldScope = { anyOf: [fields, fieldList] }, either = { const: "EITHER" }, skip = { const: "skip" };
const props = properties => ({ properties });
const area = d.areaSelector;
area.allOf[1].oneOf[0].properties.zone = { anyOf: [area.allOf[1].oneOf[0].properties.zone, fieldList] };
area.properties.zone.oneOf.push(fieldList);
for (const key of ["owner", "controller"]) area.properties[key] = { anyOf: [area.properties[key], either] };
area.properties.onInsufficient = { enum: ["fail", "skip"] };
area.allOf.push({
  if: { anyOf: [props({ zone: fieldList }), props({ owner: either }), props({ controller: either }), props({ onInsufficient: skip })] },
  then: { ...props({ zone: fieldScope, cardTypes: { items: fields }, visibility: { const: "PUBLIC" }, faceUpOnly: { const: true } }),
    allOf: PUBLIC_FIELD_ZONES.map(kind => ({ if: props({ cardTypes: { contains: { const: kind } } }),
      then: props({ zone: { anyOf: [{ const: kind }, { type: "array", contains: { const: kind } }] } }) })) }
}, { if: props({ onInsufficient: skip }), then: props({ min: { const: 1 }, max: { const: 1 } }) });
const owner = { const: "CARD_OWNER" }, ownerDeck = props({ owner, zone: { const: "deck" }, position: { const: "bottom" } });
d.destination.properties.owner = { anyOf: [d.destination.properties.owner, owner] };
d.destination.allOf = [{ if: props({ owner }), then: { anyOf: [props({ zone: { const: "hand" } }), ownerDeck] } }];
const main = type => d.interactiveMainEventAction.oneOf.find(node => node.properties?.type?.const === type).properties;
main("SELECT").selector.properties.zone = { anyOf: [main("SELECT").selector.properties.zone, fieldList] };
const dest = main("MOVE_CARD").destination;
dest.anyOf = [props(dest.properties), ownerDeck]; delete dest.properties;

const type = name => props({ type: { const: name } });
const single = { minItems: 1, maxItems: 1, items: type("PLAY_TRIGGER_SOURCE") };
const withDraw = { minItems: 2, maxItems: 2, prefixItems: [
  props({ type: { const: "DRAW" }, player: { const: "SELF" } }),
  props({ type: { const: "IF" }, condition: { $ref: "#/$defs/triggerPlayCondition" }, then: single, else: { maxItems: 0 } })
] };
const play = d.effect.allOf.find(rule => rule.if?.properties?.actions?.contains?.$ref === "#/$defs/containsTriggerPlay");
play.then.properties.actions = { anyOf: [single, withDraw] };
delete play.then.properties.costs;
const trigger = d.effect.allOf.find(rule => rule.if?.properties?.timing?.properties?.type?.const === "TRIGGER");
delete trigger.then.properties.costs;
trigger.then.allOf = [{ if: props({ actions: single }), then: props({ costs: { maxItems: 1, items: { anyOf: [
  props({ type: { const: "DISCARD_HAND" }, count: { maximum: 3 } }),
  props({ type: { const: "DON_RETURN" }, count: { maximum: 10 } })
] } } }), else: props({ costs: { maxItems: 0 } }) }];
emit("schemas/effect-v3-subset49.schema.json", definition);

const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(schema);
const profile = { compilerVersion: compilerVersionForSchema(schema), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
inventory.profiles[schema] = profile;
Object.assign(inventory, { basedOnCommit: "e9e06ca", ...profile });
const updated = {
  "action:PLAY_TRIGGER_SOURCE": ["3", "effect", "Optional fixed hand discard or DON return activation cost; or DRAW followed by conditional self-play."],
  "action:MOVE_CARD": ["3", "destination", "CARD_OWNER returns a public field card to its owner’s hand or (one card) deck bottom."],
  "selector:CARDS": ["5", "areaSelector", "Public field unions use one choice and cap across selected zones or seats; the chooser remains a specific seat."],
  "predicate:compare": ["5", "predicate", "BOTH.lifeCount reads the total Life count from the current board."]
};
for (const op of inventory.operations.filter(op => op.availableIn.includes(previous))) {
  const key = `${op.category}:${op.name}`, entry = updated[key];
  if (!entry) {
    if (!op.availableIn.includes(schema)) op.availableIn.push(schema);
    continue;
  }
  const [handlerVersion, anchor, runtimeConstraints] = entry;
  const next = { ...op, handlerVersion, availableIn: [schema], schemaRef: `../schemas/effect-v3-subset49.schema.json#/$defs/${anchor}`, runtimeConstraints };
  if (key === "predicate:compare") next.valueReferences = [...op.valueReferences, "BOTH.lifeCount"];
  const index = inventory.operations.findIndex(row => row.category === op.category && row.name === op.name && row.availableIn.includes(schema));
  if (index < 0) inventory.operations.push(next); else inventory.operations[index] = next;
}
emit(file, inventory);
