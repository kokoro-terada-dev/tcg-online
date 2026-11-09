import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { baseCounterSchema } from "./build-v3-base-counter-schema.js";
const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const schema = "3.0.0-subset.35";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema35 and Compiler validate base setters, own-hand counters and nonrecursive reads", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const generated = baseCounterSchema(read("../schemas/effect-v3-subset34.schema.json"));
  assert.deepEqual(generated, read("../schemas/effect-v3-subset35.schema.json"));
  assert.deepEqual(generated, read("../docs/card-effect-base-counter.schema.json"));
  const { operations } = read("../docs/card-effect-supported-operations.json");
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  const base = operations.find(op => op.name === "CONTINUOUS_EFFECT" && op.handlerVersion === "2").example;
  const counter = { ...structuredClone(base), operation: { type: "GRANT_COUNTER", value: 1000 } };
  Object.assign(counter.affectedQuery, { zone: "hand", visibility: "OWNER_ONLY", faceUpOnly: false,
    filters: { type: "compare", left: { ref: "CANDIDATE.printed.counter" }, op: "eq", right: null } });
  card.schemaVersion = schema; card.continuousEffects = [base, counter]; card.effects = [];
  const validate = new Ajv({ strict: false }).compile(generated), compile = d => compileV3CardJson(JSON.stringify(d));
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  assert.ok(compile(card).requiredHandlers.includes("action:CONTINUOUS_EFFECT"));
  for (const mutate of [
    c => { c[0].operation.stat = "counter"; },
    c => { c[0].operation.value = -1; },
    c => { c[1].affectedQuery.owner = "OPPONENT"; },
    c => { c[1].operation = { type: "SET_BASE_STAT", stat: "cost", value: 1 }; },
  ]) {
    const invalid = structuredClone(card); mutate(invalid.continuousEffects);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  for (const ref of ["CANDIDATE.base.power", "CANDIDATE.current.counter"]) {
    const invalid = structuredClone(card);
    invalid.continuousEffects[0].affectedQuery.filters = { type: "compare", left: { ref }, op: "eq", right: 1 };
    assert.throws(() => compile(invalid), /v3-continuous-dependency-or-private-query/);
  }
  const old = structuredClone(card); old.schemaVersion = "3.0.0-subset.34";
  assert.throws(() => compile(old));
});

test("Registry35 versions the continuous handler without changing previous profiles", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  for (let i = 16; i <= 35; i++) {
    const version = `3.0.0-subset.${i}`, r = builtinV3Registries(version);
    assert.equal(profiles[version].registryHash, v3RegistryHash(r));
    assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
    if (i === 35) assert.deepEqual(
      operations.filter(op => op.availableIn.includes(version)).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
      Object.entries(r).flatMap(([category, registry]) => registry.manifest().map(handler => `${category}:${handler}`)).sort()
    );
  }
  const previous = profiles["3.0.0-subset.34"];
  assert.equal(previous.registryHash, "0fe0489f942a8b6f38c9851bd2cab2fb1ccb09a3be3d656c3fa22209aa006510");
  assert.deepEqual(profiles[schema].registries, {
    ...previous.registries, action: previous.registries.action.map(handler => handler === "CONTINUOUS_EFFECT@1" ? "CONTINUOUS_EFFECT@2" : handler),
  });
});
