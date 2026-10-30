import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { moveResultSchema } from "./build-v3-move-result-schema.js";
const require = createRequire(import.meta.url), { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }
test("Schema25 is reproducible and structurally matches Compiler for move results", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset24.schema.json"), copy = structuredClone(base), s = moveResultSchema(base);
  assert.deepEqual(base, copy); assert.deepEqual(s, read("../schemas/effect-v3-subset25.schema.json")); assert.deepEqual(s, read("../docs/card-effect-move-result.schema.json"));
  const validate = new Ajv({ strict: false }).compile(s);
  const c = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card; c.schemaVersion = "3.0.0-subset.25";
  c.effects[0].actions = [{ type: "BIND_SOURCE", bindAs: "self" }, { type: "MOVE_CARD", cards: { ref: "bindings.self" }, destination: { owner: "SELF", zone: "hand", position: "append", faceUp: true }, cause: "EFFECT" },
    { type: "MOVE_RESULT", bindAs: "returned" }, { type: "IF", condition: { type: "MOVED_COLORS", result: "returned", subject: "SOURCE", basis: "CURRENT", match: "DISJOINT" }, then: [{ type: "DRAW", count: 1, player: "SELF" }], else: [] }];
  assert.equal(validate(c), true); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(c)));
  for (const mutate of [r => delete r.effects[0].actions[2].bindAs, r => { r.effects[0].actions[2].bindAs = "__proto__"; },
    r => { r.effects[0].actions[3].condition.basis = "UNKNOWN"; }, r => { r.effects[0].actions[3].condition.match = "ANY"; },
    r => { r.effects[0].actions[3].condition.subject = "EVENT"; }, r => { r.effects[0].actions[3].condition.extra = true; }]) {
    const bad = structuredClone(c); mutate(bad); assert.equal(validate(bad), false); assert.throws(() => compileV3CardJson(JSON.stringify(bad)));
  }
  const old = structuredClone(c); old.schemaVersion = "3.0.0-subset.24"; assert.throws(() => compileV3CardJson(JSON.stringify(old)));
});
test("new inventory exactly matches implemented Registry25 and retains every old profile hash", () => {
  const data = read("../docs/card-effect-supported-operations.json"), r = builtinV3Registries("3.0.0-subset.25");
  assert.equal(data.profiles["3.0.0-subset.25"].registryHash, v3RegistryHash(r));
  for (let n = 16; n < 25; n++) assert.equal(data.profiles[`3.0.0-subset.${n}`].registryHash, v3RegistryHash(builtinV3Registries(`3.0.0-subset.${n}`)));
  assert.deepEqual(data.operations.filter(op => op.availableIn.includes("3.0.0-subset.25")).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(), Object.entries(r).flatMap(([k, v]) => v.manifest().map(x => `${k}:${x}`)).sort());
});
