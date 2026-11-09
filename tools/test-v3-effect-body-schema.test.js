import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { effectBodySchema } from "./build-v3-effect-body-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
const previous = "3.0.0-subset.39", version = "3.0.0-subset.40";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema40 accepts only a standalone same-card call from an Event TRIGGER; Compiler resolves the exact MAIN id", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset39.schema.json"), schema = effectBodySchema(base);
  assert.deepEqual(schema, read("../schemas/effect-v3-subset40.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-body.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), compile = d => compileV3CardJson(JSON.stringify(d));
  const card = definition();
  card.schemaVersion = version;
  card.source.triggerText = "Synthetic reference to the same card MAIN.";
  card.effects.push({ ...card.effects[0], id: "life", kind: "triggered", timing: { type: "TRIGGER" }, sourceZones: ["life"],
    actions: [operations.find(row => row.name === "CALL_EFFECT_BODY").example] });
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  assert.ok(compile(card).requiredHandlers.includes("action:CALL_EFFECT_BODY"));
  for (const mutate of [
    d => { d.effects[0].actions = [{ type: "CALL_EFFECT_BODY", effectId: "life" }]; },
    d => { d.effects[1].actions = [{ type: "SEQUENCE", actions: d.effects[1].actions }]; },
    d => { d.effects[1].actions.push({ type: "DRAW", player: "SELF", count: 1 }); },
    d => { d.effects[1].actions[0].cardId = "ANOTHER"; },
    d => { d.effects[0].costs = [{ type: "REST_DON", count: 1 }]; },
    d => { d.effects[0].resolutionConditions = { type: "TURN_IS", player: "SELF" }; },
    d => { d.effects[0].timing.type = "COUNTER"; }
  ]) {
    const invalid = structuredClone(card); mutate(invalid);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  for (const effectId of ["life", "missing"]) {
    const invalid = structuredClone(card); invalid.effects[1].actions[0].effectId = effectId;
    assert.throws(() => compile(invalid), /v3-effect-body-main-target/);
  }
  const old = { ...card, schemaVersion: previous };
  assert.equal(new Ajv({ strict: false }).compile(base)(old), false);
  assert.throws(() => compile(old));
});

test("Registry40 adds only CALL_EFFECT_BODY and leaves Registry39 intact", () => {
  const registry = builtinV3Registries(version);
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "e3d6b515bc5ffed5ba7a12fbf04470918697c8d055888285d2c1f2472bdd42c3");
  assert.deepEqual(profiles[version].registries, { ...profiles[previous].registries,
    action: [...profiles[previous].registries.action, "CALL_EFFECT_BODY@1"].sort() });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
