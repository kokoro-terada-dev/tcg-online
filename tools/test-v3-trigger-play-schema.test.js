import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { triggerPlaySchema } from "./build-v3-trigger-play-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const { definition, always } = require("../server/test/helpers/v3-event.cjs");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const previous = "3.0.0-subset.44", version = "3.0.0-subset.45";
const compile = card => compileV3CardJson(JSON.stringify(card));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema and Compiler restrict self-play to a whole unconditional life TRIGGER on a field card", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const schema = triggerPlaySchema(read("../schemas/effect-v3-subset44.schema.json"));
  assert.deepEqual(schema, read("../schemas/effect-v3-subset45.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema);
  const card = definition(4);
  Object.assign(card, { schemaVersion: version, cardType: "character", baseStats: { cost: 4, power: 3000, counter: null, life: null },
    source: { ...card.source, text: "", triggerText: "Synthetic self-play." } });
  card.effects = [{ ...card.effects[0], kind: "triggered", timing: { type: "TRIGGER" }, sourceZones: ["life"], actions: [{ type: "PLAY_TRIGGER_SOURCE" }] }];
  for (const valid of [card, { ...card, cardType: "stage", baseStats: { ...card.baseStats, power: null } }]) {
    assert.equal(validate(valid), true, JSON.stringify(validate.errors));
    assert.ok(compile(valid).requiredHandlers.includes("action:PLAY_TRIGGER_SOURCE"));
  }
  for (const mutate of [
    d => { d.cardType = "event"; d.baseStats.power = null; },
    d => { d.effects[0].timing.type = "ON_PLAY"; d.effects[0].sourceZones = ["character"]; },
    d => { d.effects[0].actions = [{ type: "IF", condition: always(), then: [{ type: "PLAY_TRIGGER_SOURCE" }], else: [] }]; },
    d => { d.effects[0].costs = [{ type: "REST_DON", count: 1 }]; },
    d => { d.effects[0].resolutionConditions = { type: "TURN_IS", player: "SELF" }; },
    d => { d.effects[0].actions[0].target = "another-card"; }
  ]) {
    const invalid = structuredClone(card); mutate(invalid);
    assert.equal(validate(invalid), false);
    assert.throws(() => compile(invalid));
  }
  assert.throws(() => compile({ ...card, schemaVersion: previous }));
});

test("Registry45 adds only PLAY_TRIGGER_SOURCE and Registry44 stays pinned", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "731fa079caef72803c33c5221aa0d423c61196b3752102408985cd6c2510e852");
  const registry = builtinV3Registries(version);
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.deepEqual(profiles[version].registries, { ...profiles[previous].registries, action: [...profiles[previous].registries.action, "PLAY_TRIGGER_SOURCE@1"].sort() });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
