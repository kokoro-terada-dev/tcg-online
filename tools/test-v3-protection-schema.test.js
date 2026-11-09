import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { protectionSchema } from "./build-v3-protection-schema.js";
const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const schema = "3.0.0-subset.36";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema36 and Compiler keep each protection policy separate and reject unsupported causes or recipients", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const generated = protectionSchema(read("../schemas/effect-v3-subset35.schema.json"));
  assert.deepEqual(generated, read("../schemas/effect-v3-subset36.schema.json"));
  assert.deepEqual(generated, read("../docs/card-effect-protection.schema.json"));
  const { operations } = read("../docs/card-effect-supported-operations.json");
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  const base = operations.find(op => op.name === "CONTINUOUS_EFFECT" && op.handlerVersion === "3").example;
  card.schemaVersion = schema; card.continuousEffects = [base]; card.effects = [];
  const validate = new Ajv({ strict: false }).compile(generated), compile = d => compileV3CardJson(JSON.stringify(d));
  for (const policy of ["CANNOT_TARGET", "PREVENT_MOVE", "UNAFFECTED_BY", "CANNOT_KO"]) {
    const d = structuredClone(card);
    d.continuousEffects[0].operation = { type: "RESTRICT", by: "OPPONENT", policy, ...(policy === "CANNOT_KO" ? { cause: "BATTLE", sourceAttribute: "Slash" } : {}) };
    assert.equal(validate(d), true, JSON.stringify(validate.errors));
    assert.ok(compile(d).requiredHandlers.includes("action:CONTINUOUS_EFFECT"));
  }
  for (const mutate of [
    c => { c.operation.cause = "COST_PAYMENT"; },
    c => { c.operation.sourceAttribute = "Slash"; },
    c => { c.affectedQuery.owner = "OPPONENT"; },
    c => { c.operation = { type: "RESTRICT", policy: "UNAFFECTED_BY", by: "ANY" }; },
  ]) {
    const invalid = structuredClone(card); mutate(invalid.continuousEffects[0]);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  const old = structuredClone(card); old.schemaVersion = "3.0.0-subset.35";
  assert.throws(() => compile(old));
});

test("Registry36 versions the continuous handler without changing previous profiles", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  for (let i = 16; i <= 36; i++) {
    const version = `3.0.0-subset.${i}`, r = builtinV3Registries(version);
    assert.equal(profiles[version].registryHash, v3RegistryHash(r));
    assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
    if (i === 36) assert.deepEqual(
      operations.filter(op => op.availableIn.includes(version)).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
      Object.entries(r).flatMap(([category, registry]) => registry.manifest().map(handler => `${category}:${handler}`)).sort()
    );
  }
  const previous = profiles["3.0.0-subset.35"];
  assert.equal(previous.registryHash, "62763fa2904fae291db5af7940bfd1574aa0276c9eea63c306634ea3b5b44b32");
  assert.deepEqual(profiles[schema].registries, {
    ...previous.registries, action: previous.registries.action.map(handler => handler === "CONTINUOUS_EFFECT@2" ? "CONTINUOUS_EFFECT@3" : handler),
  });
});
