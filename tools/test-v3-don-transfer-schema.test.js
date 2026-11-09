import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { donTransferSchema } from "./build-v3-don-transfer-schema.js";
const require = createRequire(import.meta.url), { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }
test("DON transfer Schema29 is reproducible and agrees with the Compiler", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset28.schema.json"), copy = structuredClone(base), schema = donTransferSchema(base);
  assert.deepEqual(base, copy);
  assert.deepEqual(schema, read("../schemas/effect-v3-subset29.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-don-transfer.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  card.schemaVersion = "3.0.0-subset.29";
  card.effects[0].timing = { type: "ON_EVENT", event: "DON_RETURNED", owner: "SELF", cause: "EFFECT_MOVE", min: 1 };
  card.effects[0].actions = [
    { type: "BIND_SOURCE", bindAs: "target" },
    { type: "SELECT", bindAs: "don", selector: { type: "CARDS", owner: "SELF", controller: "SELF", chooser: "SELF", zone: ["restDon"], cardTypes: ["don"], visibility: "PUBLIC", faceUpOnly: true, excludeSource: false,
      min: 0, max: 1, selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail", filters: { type: "all", conditions: [] } } },
    { type: "ATTACH_DON", from: "REST", assignments: [{ cards: { ref: "bindings.don" }, target: { ref: "bindings.target" } }] },
    { type: "RETURN_DON_BY_EFFECT", cards: { ref: "bindings.don" }, from: ["activeDon", "restDon", "attachedDon"] }
  ];
  assert.equal(validate(card), true); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(card)));
  for (const mutate of [
    e => { e.timing.min = 0; }, e => { e.timing.cause = "RULE_PROCESSING"; }, e => { e.timing.filters = { type: "all", conditions: [] }; },
    e => { e.actions[2].from = "ATTACHED"; }, e => { e.actions[2].assignments = []; },
    e => { e.actions[3].from = ["donDeck"]; }, e => { e.actions[3].from = ["restDon", "restDon"]; }, e => { e.actions[3].cause = "COST_PAYMENT"; }
  ]) { const invalid = structuredClone(card); mutate(invalid.effects[0]); assert.equal(validate(invalid), false); assert.throws(() => compileV3CardJson(JSON.stringify(invalid))); }
});
test("Registry29 inventory includes ON_EVENT@2 and preserves the old hash for every previous profile", () => {
  const data = read("../docs/card-effect-supported-operations.json"), r = builtinV3Registries("3.0.0-subset.29");
  assert.equal(data.profiles["3.0.0-subset.29"].registryHash, v3RegistryHash(r));
  for (let n = 16; n <= 28; n++) assert.equal(data.profiles[`3.0.0-subset.${n}`].registryHash, v3RegistryHash(builtinV3Registries(`3.0.0-subset.${n}`)));
  assert.deepEqual(data.operations.filter(op => op.availableIn.includes("3.0.0-subset.29")).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
    Object.entries(r).flatMap(([key, reg]) => reg.manifest().map(x => `${key}:${x}`)).sort());
});
