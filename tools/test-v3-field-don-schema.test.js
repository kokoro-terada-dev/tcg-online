import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const previous = "3.0.0-subset.46", version = "3.0.0-subset.47";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("field DON value references are public, exact and profile-gated by Schema and Compiler", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const validator = new Ajv({ strict: false });
  const validate = validator.compile(read("../schemas/effect-v3-subset47.schema.json"));
  const legacy = validator.compile(read("../schemas/effect-v3-subset46.schema.json"));
  const card = { ...definition(), schemaVersion: version };
  const effect = card.effects[0];
  const compare = { type: "compare", left: { ref: "SELF.don.fieldCount" }, op: "lte", right: { ref: "OPPONENT.don.costAreaCount" } };
  effect.actions = [{ type: "IF", condition: compare, then: effect.actions, else: [] }];
  const compile = value => compileV3CardJson(JSON.stringify(value));
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  assert.ok(compile(card).requiredHandlers.includes("predicate:compare"));
  assert.equal(legacy({ ...card, schemaVersion: previous }), false);
  assert.throws(() => compile({ ...card, schemaVersion: previous }), /out-of-scope/);
  for (const ref of ["SELF.don.deckCount", "SOURCE.don.fieldCount", "BOTH.don.activeCount", "SELF.don.fieldCount\n"]) {
    compare.left = { ref };
    assert.equal(validate(card), false);
    assert.throws(() => compile(card), /out-of-scope/);
  }
  compare.left = { ref: "SELF.don.attachedCount" };
  compare.right = "2";
  assert.throws(() => compile(card), /nonnumeric/);
});

test("Registry47 changes only compare while preserving Registry46 and inventory agreement", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  const registry = builtinV3Registries(version);
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "6fa4152663a7928665f6791d0ed9382f031f9c90e598b4f9c56ce5b1e2017cff");
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.deepEqual(profiles[version].registries, { ...profiles[previous].registries,
    predicate: profiles[previous].registries.predicate.map(op => op === "compare@3" ? "compare@4" : op) });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
