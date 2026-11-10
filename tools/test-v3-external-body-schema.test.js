import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { externalBodySchema } from "./build-v3-external-body-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
const previous = "3.0.0-subset.40", version = "3.0.0-subset.41";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema41 and Compiler accept only bounded trash calls and one explicit shared MAIN use", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset40.schema.json"), schema = externalBodySchema(base);
  assert.deepEqual(schema, read("../schemas/effect-v3-subset41.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-external-body.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), compile = d => compileV3CardJson(JSON.stringify(d));
  const event = definition(); event.schemaVersion = version;
  event.effects[0].usageLimit = { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 };
  const call = operations.find(row => row.name === "CALL_EFFECT_BODY" && row.handlerVersion === "2").example;
  const caller = structuredClone(event);
  Object.assign(caller, { cardType: "character", baseStats: { cost: 5, power: 5000, counter: 1000, life: null } });
  Object.assign(caller.effects[0], { sourceZones: ["character"], actions: [call] });
  assert.equal(validate(event), true, JSON.stringify(validate.errors)); compile(event);
  assert.equal(validate(caller), true, JSON.stringify(validate.errors));
  assert.ok(compile(caller).requiredHandlers.includes("action:CALL_EFFECT_BODY"));
  for (const mutate of [
    d => { d.effects[0].actions[0].from = "OPPONENT_TRASH"; },
    d => { d.effects[0].actions[0].maxPrintedCost = -1; },
    d => { d.effects[0].actions[0].definitionHash = "0".repeat(64); },
    d => { d.effects[0].actions = [{ type: "SEQUENCE", actions: d.effects[0].actions }]; },
    d => { Object.assign(d.effects[0], { kind: "triggered", timing: { type: "ON_KO" } }); },
    d => { d.effects[0].actions.push({ type: "DRAW", player: "SELF", count: 1 }); }
  ]) {
    const invalid = structuredClone(caller); mutate(invalid);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  const recursive = structuredClone(event); recursive.effects[0].actions = [call];
  assert.equal(validate(recursive), false); assert.throws(() => compile(recursive));
  event.effects[0].usageLimit.count = 2;
  assert.equal(validate(event), false); assert.throws(() => compile(event));
  assert.throws(() => compile({ ...caller, schemaVersion: previous }));
});

test("Registry41 versions only CALL_EFFECT_BODY and retains Registry40", () => {
  const registry = builtinV3Registries(version);
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "c3014d8b02675feaf6ab72484d1a6ff6f19f6391f3a249489f3f1fcc079b8c4c");
  assert.deepEqual(profiles[version].registries, { ...profiles[previous].registries,
    action: profiles[previous].registries.action.map(op => op === "CALL_EFFECT_BODY@1" ? "CALL_EFFECT_BODY@2" : op) });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
