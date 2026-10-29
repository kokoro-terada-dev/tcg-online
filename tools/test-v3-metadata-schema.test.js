import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { compileV3CardJson } = require("../server/dist/test/effects/v3/compiler.js");
let Ajv;
try { Ajv = require("ajv/dist/2020"); } catch { /* Optional documentation-side dependency, not a game dependency. */ }
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const options = { skip: !Ajv ? "Set NODE_PATH to an Ajv 8 installation to validate Draft 2020-12" : false };

test("both profiles validate the documentation examples with Schema and Compiler", options, () => {
  const schemas = new Map([["3.0.0-subset.16", read("../schemas/effect-v3-subset.schema.json")], ["3.0.0-subset.17", read("../schemas/effect-v3-subset17.schema.json")]]);
  const ajv = new Ajv({ strict: false, allErrors: true }), validators = new Map([...schemas].map(([s, schema]) => [s, ajv.compile(schema)]));
  const examples = read("../docs/card-effect-json-examples.json");
  const cards = [...examples.examples, ...examples.additionalExamples].filter(e => e.card).map(e => e.card);
  assert.equal(cards.length, 14);
  for (const card of cards) { const validate = validators.get(card.schemaVersion); assert.equal(validate(card), true, JSON.stringify(validate.errors)); assert.doesNotThrow(() => compileV3CardJson(JSON.stringify(card))); }
});

test("metadata Schema and Compiler reject eight malformed queries without weakening the legacy Schema", options, () => {
  const schema = read("../schemas/effect-v3-subset17.schema.json"), ajv = new Ajv({ strict: false, allErrors: true }), validate = ajv.compile(schema);
  const legacy = ajv.compile(read("../schemas/effect-v3-subset.schema.json"));
  const base = read("../docs/card-effect-json-examples.json").additionalExamples.find(e => e.card.cardId === "EXAMPLE-META-NAMI").card;
  const name = { type: "CARD_NAME", subject: "CANDIDATE", basis: "PRINTED", op: "ne", value: "ナミ" };
  const metadata = { type: "CARD_METADATA", subject: "CANDIDATE", basis: "PRINTED", field: "traits", match: "ANY", comparison: "EXACT", values: ["麦わらの一味"] };
  const ability = { type: "HAS_ABILITY", subject: "CANDIDATE", basis: "PRINTED", ability: "TRIGGER" };
  for (const p of [{ ...name, value: "" }, { ...name, op: "contains" }, { ...metadata, values: [] }, { ...metadata, values: ["赤", "赤"] },
    { ...metadata, field: "colors", comparison: "CONTAINS" }, { ...metadata, match: "EXACT", comparison: "CONTAINS" }, { ...ability, basis: "GRANTED" }, { ...ability, ability: "DOUBLE_ATTACK" }]) {
    const card = structuredClone(base); card.effects[0].actions[1].selector.filters = p;
    assert.equal(validate(card), false); assert.throws(() => compileV3CardJson(JSON.stringify(card)));
  }
  const old = structuredClone(base); old.schemaVersion = "3.0.0-subset.16";
  assert.equal(legacy(old), false); assert.throws(() => compileV3CardJson(JSON.stringify(old)));
});
