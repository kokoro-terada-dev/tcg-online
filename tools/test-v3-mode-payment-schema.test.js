import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { modePaymentSchema } from "./build-v3-mode-payment-schema.js";
const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, compilerVersionForSchema, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const schema = "3.0.0-subset.31";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema31 and Compiler accept the new grammar and reject malformed choices or escaped payment results", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const generated = modePaymentSchema(read("../schemas/effect-v3-subset30.schema.json"));
  assert.deepEqual(generated, read("../schemas/effect-v3-subset31.schema.json"));
  assert.deepEqual(generated, read("../docs/card-effect-mode-payment.schema.json"));
  const { operations } = read("../docs/card-effect-supported-operations.json");
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card;
  card.schemaVersion = schema;
  const names = ["CHOOSE_MODE", "OFFER_PAYMENT", "IF_PAYMENT_SUCCEEDED"];
  card.effects[0].actions = names.map(name => operations.find(op => op.name === name).example);
  const validate = new Ajv({ strict: false }).compile(generated), compile = d => compileV3CardJson(JSON.stringify(d));
  assert.equal(validate(card), true);
  for (const name of names) assert.ok(compile(card).requiredHandlers.includes("action:" + name));
  for (const mutate of [a => a[0].modes.pop(), a => { a[0].modes[0].label = "bad\n"; }, a => { a[1].costs = []; }]) {
    const invalid = structuredClone(card); mutate(invalid.effects[0].actions);
    assert.equal(validate(invalid), false); assert.throws(() => compile(invalid));
  }
  const invalidCases = [
    [a => { a[0].modes[1].label = a[0].modes[0].label; }, /v3-invalid-mode-label/],
    [a => { a[0].modes[0].actions.push(a.splice(1, 1)[0]); }, /v3-duplicate-or-undefined-payment/],
    [a => { a.splice(2, 0, structuredClone(a[1])); }, /v3-duplicate-or-undefined-payment/],
    [a => { a[1].costs.push({ type: "REST_SOURCE" }, { type: "REST_SOURCE" }); }, /v3-duplicate-rest-source-cost/],
  ];
  for (const [mutate, error] of invalidCases) {
    const invalid = structuredClone(card); mutate(invalid.effects[0].actions);
    assert.equal(validate(invalid), true);
    assert.throws(() => compile(invalid), error);
  }
  const old = structuredClone(card); old.schemaVersion = "3.0.0-subset.30";
  assert.throws(() => compile(old));
});

test("Registry31 adds only the three actions; all prior compiler profiles and hashes remain unchanged", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  for (let i = 16; i <= 31; i++) {
    const version = `3.0.0-subset.${i}`, r = builtinV3Registries(version);
    assert.equal(profiles[version].registryHash, v3RegistryHash(r));
    assert.equal(profiles[version].compilerVersion, compilerVersionForSchema(version));
    if (i === 31) assert.deepEqual(
      operations.filter(op => op.availableIn.includes(version)).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
      Object.entries(r).flatMap(([category, registry]) => registry.manifest().map(handler => `${category}:${handler}`)).sort()
    );
  }
  const previous = profiles["3.0.0-subset.30"];
  assert.equal(previous.registryHash, "c7b008458ad6bf0ce3804cb173aec5676dc57ef2568eb6adc876afd3b67c5bc5");
  assert.deepEqual(profiles[schema].registries, {
    ...previous.registries,
    action: [...previous.registries.action, "CHOOSE_MODE@1", "IF_PAYMENT_SUCCEEDED@1", "OFFER_PAYMENT@1"].sort(),
  });
});
