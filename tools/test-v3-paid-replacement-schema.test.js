import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { paidReplacementSchema } from "./build-v3-paid-replacement-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
const version = "3.0.0-subset.38", previous = "3.0.0-subset.37";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema38 and Compiler restrict paid replacement to the single approved operation shape", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset37.schema.json"), schema = paidReplacementSchema(base);
  assert.deepEqual(schema, read("../schemas/effect-v3-subset38.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-paid-replacement.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), compile = d => compileV3CardJson(JSON.stringify(d));
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  const op = handler => operations.find(row => row.name === "REPLACE_EVENT" && row.handlerVersion === handler).example;
  Object.assign(card, { schemaVersion: version, cardType: "character", baseStats: { cost: 6, power: 7000, counter: 1000, life: null },
    keywords: [], effects: [], replacementEffects: [op("2")] });
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  assert.ok(compile(card).requiredHandlers.includes("cost:MOVE_AS_COST"));
  const free = { ...card, replacementEffects: [op("1")] };
  assert.equal(validate(free), true, JSON.stringify(validate.errors));
  assert.ok(compile(free).requiredHandlers.includes("replacement:REPLACE_EVENT"));
  for (const mutate of [
    r => { delete r.optionalPayment; },
    r => { r.substitute = { to: "hand" }; },
    r => { r.match.cause = "EFFECT_MOVE"; },
    r => { r.optionalPayment.type = "REVEAL_CARDS"; },
    r => { r.optionalPayment.selector = "SOURCE"; },
    r => { r.optionalPayment.selector.chooser = "OPPONENT"; },
    r => { Object.assign(r.optionalPayment.selector, { min: 2, max: 2 }); },
    r => { r.optionalPayment.selector.cardTypes = ["character"]; },
    r => { r.optionalPayment.selector.filters = { type: "TURN_IS", player: "SELF" }; }
  ]) {
    const invalid = structuredClone(card); mutate(invalid.replacementEffects[0]);
    assert.equal(validate(invalid), false);
    assert.throws(() => compile(invalid));
  }
  const old = { ...card, schemaVersion: previous };
  assert.equal(new Ajv({ strict: false }).compile(base)(old), false);
  assert.throws(() => compile(old));
});

test("Registry38 only versions REPLACE_EVENT and keeps Registry37 intact", () => {
  const registry = builtinV3Registries(version);
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "822223dbb3aaf5bae763432e7a4993bdc74da7b558b57eecf1c6b710e6fb8808");
  assert.deepEqual(profiles[version].registries, { ...profiles[previous].registries, replacement: ["REPLACE_EVENT@2"] });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
