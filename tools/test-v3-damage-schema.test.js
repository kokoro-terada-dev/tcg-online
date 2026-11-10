import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { damageSchema } from "./build-v3-damage-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const { selector } = require("../server/test/helpers/v3-observed.cjs");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
const previous = "3.0.0-subset.42", version = "3.0.0-subset.43";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema43 and Compiler agree on supported life movement, stage K.O. and Double Attack", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const schema = damageSchema(read("../schemas/effect-v3-subset42.schema.json"));
  assert.deepEqual(schema, read("../schemas/effect-v3-subset43.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-damage.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), compile = card => compileV3CardJson(JSON.stringify(card));
  const base = { ...definition(1), schemaVersion: version };
  const card = { ...base, cardType: "leader", baseStats: { cost: null, power: 5000, counter: null, life: 5 },
    keywords: [{ type: "DOUBLE_ATTACK" }], effects: [{ ...base.effects[0], sourceZones: ["leader"], actions: [
      { type: "SELECT", bindAs: "stage", selector: { ...selector(), zone: "stage", cardTypes: ["stage"] } },
      { type: "KO_STAGE", cards: { ref: "bindings.stage" } },
      { type: "SELECT", bindAs: "target", selector: selector() },
      { type: "MOVE_LIFE", player: "OPPONENT", from: "BOUND", cards: { ref: "bindings.target" }, to: "LIFE_TOP", faceUp: false },
      { type: "MOVE_LIFE", player: "SELF", from: "DECK_TOP", to: "LIFE_BOTTOM", faceUp: true },
      { type: "MOVE_LIFE", player: "SELF", from: "LIFE_TOP", to: "DECK_BOTTOM" },
      { type: "MOVE_RESULT", bindAs: "moved" }
    ] }] };
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  for (const handler of ["action:KO_STAGE", "action:MOVE_LIFE", "keyword:DOUBLE_ATTACK"]) assert.ok(compile(card).requiredHandlers.includes(handler));
  for (const mutate of [
    actions => { delete actions[3].cards; },
    actions => { delete actions[4].faceUp; },
    actions => { actions[5].to = "LIFE_BOTTOM"; },
    actions => { actions[5].faceUp = true; },
    actions => { actions[5].player = "ANY"; }
  ]) {
    const invalid = structuredClone(card); mutate(invalid.effects[0].actions);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  const multiple = structuredClone(card);
  multiple.effects[0].actions[2].selector.max = 2;
  assert.throws(() => compile(multiple), /v3-life-single-binding/);
  assert.throws(() => compile({ ...card, schemaVersion: previous }));
});

test("Registry43 adds only stage K.O., life movement and Double Attack; Registry42 is unchanged", () => {
  const registry = builtinV3Registries(version);
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "b7a432d80d72531e86663615ecec063bfcb76f8345beeb96d0ae273a6d33541f");
  const legacy = profiles[previous].registries;
  assert.deepEqual(profiles[version].registries, { ...legacy, action: [...legacy.action, "KO_STAGE@1", "MOVE_LIFE@1"].sort(),
    keyword: [...legacy.keyword, "DOUBLE_ATTACK@1"].sort() });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
