import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { activationCostsSchema } from "./build-v3-activation-costs-schema.js";
const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const schema = "3.0.0-subset.30";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema30 is reproducible; Schema and Compiler reject unsupported cost syntax", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const generated = activationCostsSchema(read("../schemas/effect-v3-subset29.schema.json"));
  assert.deepEqual(generated, read("../schemas/effect-v3-subset30.schema.json"));
  assert.deepEqual(generated, read("../docs/card-effect-activation-costs.schema.json"));
  const data = read("../docs/card-effect-supported-operations.json");
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  card.schemaVersion = schema;
  card.effects[0].costs = [data.operations.find(op => op.name === "REVEAL_CARDS").example];
  const validate = new Ajv({ strict: false }).compile(generated), compile = definition => compileV3CardJson(JSON.stringify(definition));
  assert.equal(validate(card), true);
  assert.ok(compile(card).requiredHandlers.includes("cost:REVEAL_CARDS"));
  const move = structuredClone(card);
  move.effects[0].costs = [{ type: "MOVE_AS_COST", selector: card.effects[0].costs[0].selector, destination: "trash" }];
  assert.equal(validate(move), true);
  assert.ok(compile(move).requiredHandlers.includes("cost:MOVE_AS_COST"));
  for (const mutate of [
    c => { c.selector.owner = "OPPONENT"; },
    c => { c.selector.min = 0; },
    c => { c.selector.cardTypes = ["don"]; },
    c => { c.type = "MOVE_AS_COST"; c.destination = "deck"; }
  ]) {
    const invalid = structuredClone(card); mutate(invalid.effects[0].costs[0]);
    assert.equal(validate(invalid), false);
    assert.throws(() => compile(invalid));
  }
  const unequal = structuredClone(card); unequal.effects[0].costs[0].selector.max = 2;
  assert.throws(() => compile(unequal), /v3-exact-hand-cost-selector/);
  const overlap = structuredClone(card); overlap.effects[0].costs.push(move.effects[0].costs[0]);
  assert.throws(() => compile(overlap), /v3-multiple-filtered-costs-unsupported/);
  const old = structuredClone(card); old.schemaVersion = "3.0.0-subset.29";
  assert.throws(() => compile(old));
});

test("Registry30 inherits the prior handler manifest and preserves all earlier profile hashes", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  for (let i = 16; i <= 30; i++) {
    const version = `3.0.0-subset.${i}`, r = builtinV3Registries(version);
    assert.equal(profiles[version].registryHash, v3RegistryHash(r));
    assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
    if (i === 30) assert.deepEqual(
      operations.filter(op => op.availableIn.includes(version)).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
      Object.entries(r).flatMap(([category, registry]) => registry.manifest().map(handler => `${category}:${handler}`)).sort()
    );
  }
  assert.deepEqual(profiles[schema].registries, {
    ...profiles["3.0.0-subset.29"].registries,
    cost: [...profiles["3.0.0-subset.29"].registries.cost, "MOVE_AS_COST@1", "REVEAL_CARDS@1"].sort(),
  });
});
