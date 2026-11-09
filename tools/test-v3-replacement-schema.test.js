import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { replacementSchema } from "./build-v3-replacement-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const inventory = read("../docs/card-effect-supported-operations.json");
const version = "3.0.0-subset.37";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema37 and Compiler accept only supported replacement shapes and fail closed on unknown scopes", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const schema = replacementSchema(read("../schemas/effect-v3-subset36.schema.json"));
  assert.deepEqual(schema, read("../schemas/effect-v3-subset37.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-replacement.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), compile = d => compileV3CardJson(JSON.stringify(d));
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  const rule = inventory.operations.find(op => op.name === "REPLACE_EVENT").example;
  Object.assign(card, { schemaVersion: version, cardType: "character", baseStats: { cost: 2, power: 2000, counter: 1000, life: null },
    keywords: [], effects: [], replacementEffects: [rule] });
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  assert.ok(compile(card).requiredHandlers.includes("replacement:REPLACE_EVENT"));
  for (const mutate of [
    d => { delete d.replacementEffects[0].id; },
    d => { d.replacementEffects[0].match.cause = "BATTLE_KO"; },
    d => { d.replacementEffects[0].match.to = "deck"; },
    d => { Object.assign(d.replacementEffects[0].match, { cause: "EFFECT_MOVE", to: "hand" }); },
    d => { d.replacementEffects[0].optionalPayment = {}; },
    d => { d.source.text = "  "; },
    d => { d.schemaVersion = "3.0.0-subset.36"; }
  ]) {
    const invalid = structuredClone(card); mutate(invalid);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  const duplicate = structuredClone(card); duplicate.replacementEffects.push(structuredClone(rule));
  assert.throws(() => compile(duplicate), /duplicate/);
  const current = structuredClone(card); current.replacementEffects[0].condition =
    { type: "compare", left: { ref: "SOURCE.current.power" }, op: "eq", right: 2000 };
  assert.throws(() => compile(current), /replacement-condition-scope/);
});

test("Registry37 adds only REPLACE_EVENT and preserves all previous registry hashes", () => {
  for (let n = 16; n <= 37; n++) {
    const version = "3.0.0-subset." + n, registries = builtinV3Registries(version), profile = inventory.profiles[version];
    assert.equal(profile.registryHash, v3RegistryHash(registries));
    assert.equal(profile.compilerVersion, compilerVersionForSchema(version));
  }
  const previous = inventory.profiles["3.0.0-subset.36"];
  assert.equal(previous.registryHash, "91b2de0e16b0259393cc336c03c2ac0eb63ea3b468a8c813832abc97948b21cf");
  const { registries } = inventory.profiles[version];
  assert.deepEqual(registries, { ...previous.registries, replacement: ["REPLACE_EVENT@1"] });
  assert.deepEqual(inventory.operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registries).flatMap(([category, handlers]) => handlers.map(handler => category + ":" + handler)).sort());
});
