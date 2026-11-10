import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { battleEffectsSchema } from "./build-v3-battle-effects-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const { selector } = require("../server/test/helpers/v3-observed.cjs");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
const previous = "3.0.0-subset.41", version = "3.0.0-subset.42";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema42 and Compiler agree on counter redirect, scope and Banish", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset41.schema.json"), schema = battleEffectsSchema(base);
  assert.deepEqual(schema, read("../schemas/effect-v3-subset42.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-battle-effects.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema), compile = card => compileV3CardJson(JSON.stringify(card));
  const card = definition(1);
  card.schemaVersion = version;
  const e = card.effects[0];
  e.timing = { type: "COUNTER" };
  e.costs = [{ type: "DON_RETURN", count: 1, from: ["restDon"] }];
  e.actions = [
    { type: "SELECT", bindAs: "target", selector: { ...selector("SELF"), min: 1 } },
    { type: "SEQUENCE", actions: [{ type: "RETARGET_BATTLE", cards: { ref: "bindings.target" } }] }
  ];
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  assert.ok(compile(card).requiredHandlers.includes("action:RETARGET_BATTLE"));
  for (const mutate of [
    c => { c.effects[0].timing.type = "MAIN"; c.effects[0].costs = []; },
    c => { c.effects[0].costs[0].from = ["donDeck"]; }
  ]) {
    const invalid = structuredClone(card); mutate(invalid);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  const multiple = structuredClone(card);
  multiple.effects[0].actions[0].selector.max = 2;
  assert.throws(() => compile(multiple));
  const banish = { ...card, cardType: "character", baseStats: { cost: 1, power: 1000, counter: null, life: null },
    keywords: [{ type: "BANISH" }], effects: [] };
  assert.equal(validate(banish), true, JSON.stringify(validate.errors));
  assert.ok(compile(banish).requiredHandlers.includes("keyword:BANISH"));
  assert.throws(() => compile({ ...banish, schemaVersion: previous }));
  assert.throws(() => compile({ ...card, schemaVersion: previous }));
});

test("Registry42 adds only battle retarget and Banish; Registry41 is unchanged", () => {
  const registry = builtinV3Registries(version);
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "6663091571271b560ff02ee7e63376c48a05d3cd3a20fbbbc1746f767c92fa7d");
  const legacy = profiles[previous].registries;
  assert.deepEqual(profiles[version].registries, { ...legacy, action: [...legacy.action, "RETARGET_BATTLE@1"].sort(), keyword: [...legacy.keyword, "BANISH@1"].sort() });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
