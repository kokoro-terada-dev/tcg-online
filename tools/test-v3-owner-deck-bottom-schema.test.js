import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { ownerDeckBottomSchema } from "./build-v3-owner-deck-bottom-schema.js";
const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const schema = "3.0.0-subset.33";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema33 and Compiler enforce the owner-selected, deck-bottom-only contract", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const generated = ownerDeckBottomSchema(read("../schemas/effect-v3-subset32.schema.json"));
  assert.deepEqual(generated, read("../schemas/effect-v3-subset33.schema.json"));
  assert.deepEqual(generated, read("../docs/card-effect-owner-deck-bottom.schema.json"));
  const { operations } = read("../docs/card-effect-supported-operations.json");
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  card.schemaVersion = schema;
  card.effects[0].actions = [operations.find(op => op.name === "ORDER_THEN_MOVE").example];
  const validate = new Ajv({ strict: false }).compile(generated), compile = d => compileV3CardJson(JSON.stringify(d));
  assert.equal(validate(card), true);
  assert.ok(compile(card).requiredHandlers.includes("action:ORDER_THEN_MOVE"));
  for (const patch of [{ chooser: "SELF" }, { player: "SELF" }, { count: 0 }, { count: 51 }, { bindAs: "hidden" },
    { destination: "deckTop" }, { selectionMode: "RANDOM" }, { visibility: "PUBLIC" }]) {
    const invalid = structuredClone(card); Object.assign(invalid.effects[0].actions[0], patch);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  const old = structuredClone(card); old.schemaVersion = "3.0.0-subset.32";
  assert.throws(() => compile(old));
});

test("Registry33 adds only ORDER_THEN_MOVE and preserves earlier compiler versions and registry hashes", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  for (let i = 16; i <= 33; i++) {
    const version = `3.0.0-subset.${i}`, r = builtinV3Registries(version);
    assert.equal(profiles[version].registryHash, v3RegistryHash(r));
    assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
    if (i === 33) assert.deepEqual(
      operations.filter(op => op.availableIn.includes(version)).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
      Object.entries(r).flatMap(([category, registry]) => registry.manifest().map(handler => `${category}:${handler}`)).sort()
    );
  }
  const previous = profiles["3.0.0-subset.32"];
  assert.equal(previous.registryHash, "07cb8f50e006b1c38ee062bf9fd2efde61373851f4d608a01652fc7544ee56b1");
  assert.deepEqual(profiles[schema].registries, {
    ...previous.registries, action: [...previous.registries.action, "ORDER_THEN_MOVE@1"].sort(),
  });
});
