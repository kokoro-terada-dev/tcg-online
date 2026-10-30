import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
let Ajv;
try { Ajv = require("ajv/dist/2020"); } catch { /* Optional documentation-side dependency. */ }
const options = { skip: !Ajv ? "Set NODE_PATH to an Ajv 8 installation to validate Draft 2020-12" : false };

test("query examples pass schema-18 and Compiler; both old profiles reject them", options, () => {
  const schema = read("../schemas/effect-v3-subset18.schema.json");
  assert.deepEqual(schema, read("../docs/card-effect-query.schema.json"));
  const ajv = new Ajv({ strict: false, allErrors: true }), validate = ajv.compile(schema);
  const old = [ajv.compile(read("../schemas/effect-v3-subset.schema.json")), ajv.compile(read("../schemas/effect-v3-subset17.schema.json"))];
  for (const { card } of read("../docs/card-effect-query-examples.json").examples) {
    assert.equal(validate(card), true, JSON.stringify(validate.errors)); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(card)));
    assert.equal(card.reviewStatus, "needs_review");
    for (const [i, v] of old.entries()) { const d = structuredClone(card); d.schemaVersion = `3.0.0-subset.${16 + i}`;
      assert.equal(v(d), false); assert.throws(() => compileV3CardJson(JSON.stringify(d))); }
  }
});

test("Schema and Compiler both reject malformed bounds/scopes; contextual restrictions remain Compiler checks", options, () => {
  const validate = new Ajv({ strict: false, allErrors: true }).compile(read("../schemas/effect-v3-subset18.schema.json"));
  const base = read("../docs/card-effect-query-examples.json").examples[1].card, q = base.effects[0].resolutionConditions.query;
  for (const p of [{ type: "COUNT", query: q, op: "gte", value: -1 }, { type: "COUNT", query: q, op: "gte", value: 257 },
    { type: "COUNT", query: q, op: "gte", value: 1.5 }, { type: "COUNT", query: q, op: "approx", value: 3 },
    ...[{ zone: "deck" }, { zone: "life" }, { zone: ["character", "stage"] }, { cardTypes: ["don"] }, { cardTypes: [] },
      { cardTypes: ["character", "character"] }, { zone: "hand", owner: "OPPONENT", controller: "OPPONENT", visibility: "OWNER_ONLY", faceUpOnly: false },
      { min: 0 }, { faceUpOnly: false }].map(patch => ({ type: "EXISTS", query: { ...q, ...patch } }))]) {
    const d = structuredClone(base); d.effects[0].resolutionConditions = p;
    assert.equal(validate(d), false); assert.throws(() => compileV3CardJson(JSON.stringify(d)));
  }
  const nested = structuredClone(base); nested.effects[0].resolutionConditions.query.filters = { type: "EXISTS", query: structuredClone(q) };
  assert.throws(() => compileV3CardJson(JSON.stringify(nested)), /nested-query/);
});

test("published operation profiles match executable manifests and pin all four profiles", () => {
  const operations = read("../docs/card-effect-supported-operations.json");
  for (const schema of ["3.0.0-subset.16", "3.0.0-subset.17", "3.0.0-subset.18", "3.0.0-subset.19"]) {
    const r = builtinV3Registries(schema), published = operations.profiles[schema];
    assert.equal(published.registryHash, v3RegistryHash(r));
    assert.deepEqual(published.registries, Object.fromEntries(Object.entries(r).map(([category, registry]) => [category, registry.manifest()])));
    const actual = Object.entries(r).flatMap(([category, registry]) => registry.manifest().map(entry => `${category}:${entry}`)).sort();
    const documented = operations.operations.filter(op => op.availableIn.includes(schema)).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort();
    assert.deepEqual(documented, actual);
  }
});
