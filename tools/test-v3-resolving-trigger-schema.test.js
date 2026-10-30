import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { resolvingTriggerSchema } from "./build-v3-resolving-trigger-schema.js";
const require = createRequire(import.meta.url), { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validation dependency. */ }
test("Schema22 derives from unchanged21; known conditional programs compile without broadening old manifests", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const base = read("../schemas/effect-v3-subset21.schema.json"), before = structuredClone(base), schema = resolvingTriggerSchema(base);
  assert.deepEqual(base, before); assert.deepEqual(schema, read("../schemas/effect-v3-subset22.schema.json"));
  assert.deepEqual(schema, read("../docs/card-effect-resolving-trigger.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema);
  const card = read("../docs/card-effect-conditional-trigger-examples.json").examples[0].card; card.schemaVersion = "3.0.0-subset.22";
  assert.equal(validate(card), true); const plan = compileV3CardJson(JSON.stringify(card));
  assert.equal(plan.compilerVersion, "v3-subset-compiler.22.1");
  const bad = structuredClone(card); bad.effects[0].timing.fromZones = ["resolving"];
  assert.equal(validate(bad), false); assert.throws(() => compileV3CardJson(JSON.stringify(bad)));
  const r = builtinV3Registries(card.schemaVersion), o = read("../docs/card-effect-supported-operations.json");
  assert.equal(o.profiles[card.schemaVersion].registryHash, v3RegistryHash(r));
  assert.deepEqual(o.operations.filter(op => op.availableIn.includes(card.schemaVersion)).map(op => `${op.category}:${op.name}@${op.handlerVersion}`).sort(),
    Object.entries(r).flatMap(([key, v]) => v.manifest().map(item => `${key}:${item}`)).sort());
  assert.equal(v3RegistryHash(builtinV3Registries("3.0.0-subset.21")), "b283c93467d4f993aeb8294a8154da85476c7e8657079a45842b13f279930b2e");
});
