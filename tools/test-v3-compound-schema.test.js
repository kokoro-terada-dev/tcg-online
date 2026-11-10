import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { builtinV3Registries, compileV3CardJson, v3RegistryHash } = require("../server/dist/test/effects/v3/compiler.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const schema = "3.0.0-subset.49", previous = "3.0.0-subset.48";
let Ajv; try { Ajv = require("ajv/dist/2020"); } catch { /* External validator. */ }
const compile = value => compileV3CardJson(JSON.stringify(value));

test("Schema and Compiler agree on new public selectors and narrowly admitted paid life self-play", { skip: Ajv ? false : "Set NODE_PATH to Ajv 8" }, () => {
  const validator = new Ajv({ strict: false }), valid = validator.compile(read("../schemas/effect-v3-subset49.schema.json"));
  const old = validator.compile(read("../schemas/effect-v3-subset48.schema.json"));
  const card = { ...definition(), schemaVersion: schema };
  const compare = { type: "compare", left: { ref: "BOTH.lifeCount" }, op: "lte", right: 5 };
  const selector = { type: "CARDS", owner: "EITHER", controller: "OPPONENT", chooser: "OPPONENT", zone: ["character", "stage"],
    visibility: "PUBLIC", faceUpOnly: true, cardTypes: ["character", "stage"], filters: { type: "all", conditions: [] },
    excludeSource: false, min: 1, max: 1, selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "skip" };
  card.effects[0].actions = [{ type: "IF", condition: compare, then: [
    { type: "SELECT", selector, bindAs: "chosen" },
    { type: "MOVE_CARD", cards: { ref: "bindings.chosen" }, destination: { owner: "CARD_OWNER", zone: "deck", position: "bottom", faceUp: false }, cause: "EFFECT" }
  ], else: [] }];
  assert.equal(valid(card), true, JSON.stringify(valid.errors));
  assert.ok(compile(card).requiredHandlers.includes("selector:CARDS"));
  assert.equal(old({ ...card, schemaVersion: previous }), false);
  assert.throws(() => compile({ ...card, schemaVersion: previous }));
  for (const [key, value] of [["zone", ["character", "hand"]], ["zone", ["character", "character"]], ["zone", ["leader", "character"]],
    ["visibility", "OWNER_ONLY"], ["faceUpOnly", false], ["chooser", "EITHER"], ["max", 2]]) {
    const oldValue = selector[key]; selector[key] = value;
    assert.equal(valid(card), false);
    assert.throws(() => compile(card));
    selector[key] = oldValue;
  }
  Object.assign(card, { cardType: "character", baseStats: { cost: 2, power: 3000, counter: null, life: null },
    source: { ...card.source, text: "", triggerText: "Synthetic paid trigger." } });
  Object.assign(card.effects[0], { kind: "triggered", timing: { type: "TRIGGER" }, sourceZones: ["life"],
    costs: [{ type: "DISCARD_HAND", count: 1 }], resolutionConditions: compare, actions: [{ type: "PLAY_TRIGGER_SOURCE" }] });
  assert.equal(valid(card), true, JSON.stringify(valid.errors));
  assert.ok(compile(card).requiredHandlers.includes("cost:DISCARD_HAND"));
  card.effects[0].actions.push({ type: "DRAW", player: "SELF", count: 1 });
  assert.equal(valid(card), false);
  assert.throws(() => compile(card));
});

test("Registry49 changes only four handlers and preserves Registry48", () => {
  const { profiles, operations } = read("../docs/card-effect-supported-operations.json");
  const registry = builtinV3Registries(schema);
  assert.equal(v3RegistryHash(builtinV3Registries(previous)), "9e107c1ddf940321cce427a0bb0b3267a8d57d34e088df6e7317caab8d73de01");
  assert.equal(profiles[schema].registryHash, v3RegistryHash(registry));
  const diff = Object.entries(profiles[schema].registries).flatMap(([category, handlers]) =>
    handlers.filter(handler => !profiles[previous].registries[category].includes(handler)).map(handler => `${category}:${handler}`));
  assert.deepEqual(diff.sort(), ["action:MOVE_CARD@3", "action:PLAY_TRIGGER_SOURCE@3", "predicate:compare@5", "selector:CARDS@5"]);
  assert.deepEqual(operations.filter(op => op.availableIn.includes(schema)).map(op => op.category + ":" + op.name + "@" + op.handlerVersion).sort(),
    Object.entries(registry).flatMap(([category, handlers]) => handlers.manifest().map(handler => category + ":" + handler)).sort());
});
