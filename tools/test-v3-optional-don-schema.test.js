import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { optionalDonSchema } from "./build-v3-optional-don-schema.js";

const require = createRequire(import.meta.url);
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const previous = "3.0.0-subset.45", version = "3.0.0-subset.46";
const compile = card => compileV3CardJson(JSON.stringify(card));
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }

test("Schema and Compiler accept bounded optional DON as MAIN, rejecting invalid counts, states and sides", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const schema = optionalDonSchema(read("../schemas/effect-v3-subset45.schema.json"));
  assert.deepEqual(schema, read("../schemas/effect-v3-subset46.schema.json"));
  const validate = new Ajv({ strict: false }).compile(schema);
  const card = { ...definition(), schemaVersion: version };
  const action = { type: "ADD_DON_UP_TO", player: "SELF", max: 10, state: "REST" };
  card.effects[0].actions = [action];
  assert.equal(validate(card), true, JSON.stringify(validate.errors));
  assert.ok(compile(card).requiredHandlers.includes("action:ADD_DON_UP_TO"));
  for (const fields of [{ max: 0 }, { max: 11 }, { max: 1.5 }, { state: "ATTACHED" }, { player: "OPPONENT" }, { count: 1 }]) {
    const invalid = structuredClone(card);
    Object.assign(invalid.effects[0].actions[0], fields);
    assert.equal(validate(invalid), false);
    assert.throws(() => compile(invalid));
  }
  assert.throws(() => compile({ ...card, schemaVersion: previous }));
});

test("Registry46 adds only ADD_DON_UP_TO and Registry45 stays pinned", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "51aede513907ed81439477ca59f2410e2931c38f6288713439e744aef671274f");
  const registry = builtinV3Registries(version);
  assert.equal(profiles[version].registryHash, v3RegistryHash(registry));
  assert.deepEqual(profiles[version].registries, { ...profiles[previous].registries, action: [...profiles[previous].registries.action, "ADD_DON_UP_TO@1"].sort() });
  assert.deepEqual(operations.filter(op => op.availableIn.includes(version)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
