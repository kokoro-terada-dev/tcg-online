import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { ownerDiscardSchema } from "./build-v3-owner-discard-schema.js";
const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const schema = "3.0.0-subset.32";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema32 and Compiler restrict private discard to the hand owner and a public trash destination", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const generated = ownerDiscardSchema(read("../schemas/effect-v3-subset31.schema.json"));
  assert.deepEqual(generated, read("../schemas/effect-v3-subset32.schema.json"));
  assert.deepEqual(generated, read("../docs/card-effect-owner-discard.schema.json"));
  const { operations } = read("../docs/card-effect-supported-operations.json");
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  card.schemaVersion = schema;
  card.effects[0].actions = [operations.find(op => op.name === "DISCARD_BY_OWNER").example];
  const validate = new Ajv({ strict: false }).compile(generated), compile = d => compileV3CardJson(JSON.stringify(d));
  assert.equal(validate(card), true);
  assert.ok(compile(card).requiredHandlers.includes("action:DISCARD_BY_OWNER"));
  for (const patch of [{ chooser: "SELF" }, { player: "SELF" }, { count: 0 }, { count: 51 }, { bindAs: "hidden" },
    { destination: "deck" }, { filters: { type: "all", conditions: [] } }]) {
    const invalid = structuredClone(card); Object.assign(invalid.effects[0].actions[0], patch);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  const old = structuredClone(card); old.schemaVersion = "3.0.0-subset.31";
  assert.throws(() => compile(old));
});

test("Registry32 adds only DISCARD_BY_OWNER and preserves old versions and hashes", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  for (let i = 16; i <= 32; i++) {
    const version = `3.0.0-subset.${i}`, r = builtinV3Registries(version);
    assert.equal(profiles[version].registryHash, v3RegistryHash(r));
    assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
    if (i === 32) assert.deepEqual(
      operations.filter(op => op.availableIn.includes(version)).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
      Object.entries(r).flatMap(([category, registry]) => registry.manifest().map(handler => `${category}:${handler}`)).sort()
    );
  }
  const previous = profiles["3.0.0-subset.31"];
  assert.equal(previous.registryHash, "2b395b4256880b579db05f427e681b65953c451f949363565ed63f670b42cdae");
  assert.deepEqual(profiles[schema].registries, {
    ...previous.registries, action: [...previous.registries.action, "DISCARD_BY_OWNER@1"].sort(),
  });
});
