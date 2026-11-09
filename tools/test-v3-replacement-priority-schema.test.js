import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { replacementPrioritySchema } from "./build-v3-replacement-priority-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
const previous = "3.0.0-subset.38", version = "3.0.0-subset.39";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema39 and Compiler agree on supported replacement source, limit and payment forms", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset38.schema.json"), schema = replacementPrioritySchema(base);
  assert.deepEqual(schema, read("../schemas/effect-v3-subset39.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-replacement-priority.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), compile = d => compileV3CardJson(JSON.stringify(d));
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  const rule = operations.find(row => row.name === "REPLACE_EVENT" && row.handlerVersion === "3").example;
  Object.assign(card, { schemaVersion: version, effects: [], keywords: [], replacementEffects: [rule] });
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  assert.ok(compile(card).requiredHandlers.includes("cost:MOVE_AS_COST"));
  for (const mutate of [
    r => { delete r.target; },
    r => { r.target.type = "OPPONENT_CHARACTER"; },
    r => { r.target.minPrintedCost = -1; },
    r => { r.usageLimit = "ONCE_PER_GAME"; },
    r => { r.optionalPayment = { type: "DON_RETURN", count: 1, from: ["activeDon"] }; }
  ]) {
    const invalid = structuredClone(card); mutate(invalid.replacementEffects[0]);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  const don = structuredClone(card);
  Object.assign(don, { cardType: "character", baseStats: { cost: 7, power: 9000, counter: null, life: null } });
  delete don.replacementEffects[0].target;
  don.replacementEffects[0].optionalPayment = { type: "DON_RETURN", count: 1, from: ["activeDon", "restDon", "attachedDon"] };
  assert.equal(validate(don), true, JSON.stringify(validate.errors));
  assert.ok(compile(don).requiredHandlers.includes("cost:DON_RETURN"));
  don.replacementEffects[0].optionalPayment.count = 2;
  assert.equal(validate(don), false); assert.throws(() => compile(don));
  assert.throws(() => compile({ ...card, schemaVersion: previous }));
});

test("Registry39 changes only the replacement handler version", () => {
  const registry = builtinV3Registries(version);
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "ad83fc5f516b830359f5bb9980488c75278c453cb275e31429f4ee7afa11b77b");
  assert.deepEqual(profiles[version].registries, { ...profiles[previous].registries, replacement: ["REPLACE_EVENT@3"] });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler).sort()).sort());
});
