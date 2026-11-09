import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { continuousSchema } from "./build-v3-continuous-schema.js";
const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const schema = "3.0.0-subset.34";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema34 and Compiler restrict continuous nodes to stable public-field reads", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const generated = continuousSchema(read("../schemas/effect-v3-subset33.schema.json"));
  assert.deepEqual(generated, read("../schemas/effect-v3-subset34.schema.json"));
  assert.deepEqual(generated, read("../docs/card-effect-continuous.schema.json"));
  const { operations } = read("../docs/card-effect-supported-operations.json");
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  card.schemaVersion = schema;
  card.continuousEffects = [operations.find(op => op.name === "CONTINUOUS_EFFECT").example]; card.effects = [];
  const validate = new Ajv({ strict: false }).compile(generated), compile = d => compileV3CardJson(JSON.stringify(d));
  assert.equal(validate(card), true);
  assert.ok(compile(card).requiredHandlers.includes("action:CONTINUOUS_EFFECT"));
  for (const mutate of [
    e => { e.operation.type = "SET_BASE_STAT"; },
    e => { e.operation.amount = 0; },
    e => { e.affectedQuery.zone = "hand"; e.affectedQuery.faceUpOnly = false; e.affectedQuery.visibility = "OWNER_ONLY"; },
  ]) {
    const invalid = structuredClone(card); mutate(invalid.continuousEffects[0]);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  for (const filter of [
    { type: "compare", left: { ref: "CANDIDATE.current.cost" }, op: "eq", right: 3 },
    { type: "HAS_ABILITY", subject: "CANDIDATE", basis: "CURRENT", ability: "BLOCKER" }
  ]) {
    const invalid = structuredClone(card); invalid.continuousEffects[0].affectedQuery.filters = filter;
    assert.throws(() => compile(invalid), /v3-continuous-dependency-or-private-query/);
  }
  const timed = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  timed.schemaVersion = schema; timed.effects[0].actions = card.continuousEffects;
  assert.equal(validate(timed), false); assert.throws(() => compile(timed), /v3-continuous-action-scope/);
  const old = structuredClone(card); old.schemaVersion = "3.0.0-subset.33";
  assert.throws(() => compile(old));
});

test("Registry34 adds only the continuous node and preserves earlier compiler versions and registry hashes", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  for (let i = 16; i <= 34; i++) {
    const version = `3.0.0-subset.${i}`, r = builtinV3Registries(version);
    assert.equal(profiles[version].registryHash, v3RegistryHash(r));
    assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
    if (i === 34) assert.deepEqual(
      operations.filter(op => op.availableIn.includes(version)).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
      Object.entries(r).flatMap(([category, registry]) => registry.manifest().map(handler => `${category}:${handler}`)).sort()
    );
  }
  const previous = profiles["3.0.0-subset.33"];
  assert.equal(previous.registryHash, "6586f83bdeb67aa7cc90c1b45e8d5460053a32de34582938c5a070961150ff35");
  assert.deepEqual(profiles[schema].registries, {
    ...previous.registries, action: [...previous.registries.action, "CONTINUOUS_EFFECT@1"].sort(),
  });
});
