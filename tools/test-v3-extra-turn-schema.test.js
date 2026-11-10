import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { extraTurnSchema } from "./build-v3-extra-turn-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
const previous = "3.0.0-subset.43", version = "3.0.0-subset.44";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema44 and Compiler allow only the supported character ON_PLAY form", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const schema = extraTurnSchema(read("../schemas/effect-v3-subset43.schema.json"));
  assert.deepEqual(schema, read("../schemas/effect-v3-subset44.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-extra-turn.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), compile = card => compileV3CardJson(JSON.stringify(card));
  const base = definition(), card = { ...base, schemaVersion: version, cardType: "character",
    baseStats: { cost: 2, power: 5000, counter: null, life: null },
    effects: [{ ...base.effects[0], kind: "triggered", timing: { type: "ON_PLAY" }, sourceZones: ["character"],
      actions: [{ type: "SEQUENCE", actions: [{ type: "EXTRA_TURN" }] }] }] };
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  assert.ok(compile(card).requiredHandlers.includes("action:EXTRA_TURN"));
  for (const mutate of [
    c => { c.effects[0].kind = "activated"; c.effects[0].timing.type = "MAIN"; },
    c => { c.cardType = "stage"; c.effects[0].sourceZones = ["stage"]; c.baseStats.power = null; },
    c => { c.effects[0].actions[0].actions[0].player = "OPPONENT"; }
  ]) {
    const invalid = structuredClone(card); mutate(invalid);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  assert.throws(() => compile({ ...card, schemaVersion: previous }));
});

test("Registry44 adds only EXTRA_TURN; Registry43 stays pinned", () => {
  const registry = builtinV3Registries(version);
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "f3e6bca8fde644d4d7a6f4b61fe5b4c5f2c0c6e3a73d630d4ed6fee763aa90f7");
  const legacy = profiles[previous].registries;
  assert.deepEqual(profiles[version].registries, { ...legacy, action: [...legacy.action, "EXTRA_TURN@1"].sort() });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
