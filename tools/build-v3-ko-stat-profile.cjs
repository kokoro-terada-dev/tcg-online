const fs = require("node:fs");
const path = require("node:path");
const { builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const root = path.join(__dirname, ".."), version = "3.0.0-subset.59", previous = "3.0.0-subset.58";
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
const schema = read("schemas/effect-v3-subset58.schema.json"), defs = schema.$defs;
schema.$id = "urn:tcg:effect-v3-subset:59";
schema.title = "V3 subset 59: KO payment, timed base stats and blocker restriction";
schema.properties.schemaVersion.const = version;
const prevent = { required: ["cards"], properties: { type: { const: "PREVENT_BLOCKER" }, cards: { $ref: "#/$defs/cardSetRef" } } };
for (const key of ["action", "interactiveMainEventAction"]) {
  const nodes = defs[key].oneOf;
  const base = structuredClone(nodes.find(node => node.properties?.type?.const === "MODIFY_STAT"));
  base.required.push("mode");
  Object.assign(base.properties, { mode: { const: "SET_BASE" }, stat: { const: "power" }, amount: { type: "integer", minimum: 0, maximum: 100000 } });
  // The action union must not match both the additive and the base-setting variants.
  nodes.find(node => node.properties?.type?.const === "MODIFY_STAT").not = { required: ["mode"] };
  nodes.push(base, prevent);
}
defs.cost.oneOf.push({ allOf: [{ $ref: "#/$defs/meta" }], unevaluatedProperties: false, required: ["selector"],
  properties: { type: { const: "KO_AS_COST" }, selector: { $ref: "#/$defs/activationFieldCostSelector" } } });
const event = schema.allOf.find(rule => rule.if.properties.cardType?.const === "event").then.properties.effects.items.allOf;
const counter = event.find(rule => rule.if?.properties?.timing?.properties?.type?.const === "COUNTER");
counter.then.properties.costs.items.properties.type.enum.push("KO_AS_COST");
event.find(rule => rule.if?.properties?.optional?.const === true).then.properties.costs.items.properties.type = { enum: ["REST_AS_COST", "KO_AS_COST"] };
write("schemas/effect-v3-subset59.schema.json", schema);
const file = "docs/card-effect-supported-operations.json", inventory = read(file), registries = builtinV3Registries(version);
inventory.profiles[version] = { compilerVersion: compilerVersionForSchema(version), registryHash: v3RegistryHash(registries),
  registries: Object.fromEntries(Object.entries(registries).map(([key, registry]) => [key, registry.manifest()])) };
const operations = [["MODIFY_STAT", "action", "2"], ["PREVENT_BLOCKER", "action", "1"], ["KO_AS_COST", "cost", "1"]];
const changed = new Set(operations.map(([name]) => name));
inventory.operations = inventory.operations.filter(op => !changed.has(op.name) || !op.availableIn.includes(version));
for (const op of inventory.operations)
  if (!changed.has(op.name) && op.availableIn.includes(previous) && !op.availableIn.includes(version)) op.availableIn.push(version);
for (const [name, category, handlerVersion] of operations) inventory.operations.push({ name, category, handlerVersion, availableIn: [version],
  schemaRef: `../schemas/effect-v3-subset59.schema.json#/$defs/${category}` });
write(file, inventory);
