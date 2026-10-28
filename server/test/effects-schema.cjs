const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateEffectDefinition: validate, parseEffectDefinition: parse, LIMITS } = require("../dist/test/effects/validation.js");
const { createBuiltinRegistries } = require("../dist/test/effects/builtins.js");
const { DefinitionError } = require("../dist/test/effects/registry.js");
const literal = value => ({ kind: "literal", value });
const ref = (from, field) => ({ kind: "ref", from, field });
const variable = name => ({ kind: "ref", from: "VARIABLE", name });
const selector = () => ({ kind: "cards", chooser: "SELF", owner: "OPPONENT", zones: ["character"], min: 0, max: 1, mode: "SELECT" });
const select = (name = "chosen") => ({ kind: "select", selector: selector(), saveAs: name });
const draw = () => ({ kind: "draw", player: "SELF", amount: 1 });
const destination = () => ({ owner: "SELF", zone: "hand", position: "append", visibility: "faceUp" });
const move = (name = "chosen") => ({ kind: "move", cards: variable(name), destination: destination(), cause: "EFFECT_MOVE" });
const definition = (actions = [draw()]) => ({ dslVersion: 1, effectId: "TEST-001.play", cardId: "TEST-001", trigger: { kind: "event", event: "onPlay" }, costs: [], actions });
const invalid = (value, pattern) => assert.throws(() => validate(value), error => error instanceof DefinitionError && (!pattern || pattern.test(error.message)));

test("documented example parses without touching the game or card master", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const sample = fs.readFileSync(path.join(__dirname, "fixtures/effect-schema.example.json"), "utf8");
  assert.equal(parse(sample).status, "schemaOnly");
});

test("valid JSON is immutable schema-only data, never executable", () => {
  const raw = definition(); const original = JSON.stringify(raw);
  const result = parse(original);
  assert.equal(result.status, "schemaOnly");
  assert.equal(result.estimatedSteps, 1);
  assert.equal(result.execute, undefined);
  assert.equal(Object.isFrozen(result.definition.actions[0]), true);
  assert.equal(JSON.stringify(raw), original);
  assert.equal(Object.isFrozen(raw), false);
  const values = ["斬", "特"];
  const withLiteral = definition(); withLiteral.condition = { kind: "exists", value: literal(values) };
  validate(withLiteral);
  assert.equal(Object.isFrozen(values), false);
  invalid({ ...raw, dslVersion: 2 }, /version/);
  invalid({ ...raw, unexpected: true }, /unknown field/);
  assert.throws(() => parse("{"), /invalid JSON/);
});
test("unknown commands are rejected for all registry categories", () => {
  invalid({ ...definition(), trigger: { kind: "missing" } }, /unknown trigger/);
  invalid({ ...definition(), condition: { kind: "missing" } }, /unknown predicate/);
  invalid({ ...definition(), costs: [{ kind: "missing" }] }, /unknown cost/);
  invalid(definition([{ kind: "missing" }]), /unknown action/);
  invalid(definition([{ ...select(), selector: { kind: "missing" } }]), /unknown selector/);
  invalid(definition([{ kind: "modify", modifier: { kind: "missing" }, duration: { kind: "thisTurn" } }]), /unknown modifier/);
  invalid(definition([{ kind: "modify", modifier: { kind: "power", target: ref("SOURCE", "id"), amount: 1000 }, duration: { kind: "missing" } }]), /unknown duration/);
  invalid(definition([{ kind: "installReplacement", replacement: { kind: "missing" }, duration: { kind: "thisTurn" } }]), /unknown replacement/);
  invalid(definition([{ kind: "installRestriction", restriction: { kind: "missing" }, duration: { kind: "thisTurn" } }]), /unknown restriction/);
});
test("comparison operators and reference fields are validated without coercion", () => {
  for (const operator of ["EQ", "NEQ", "GT", "GTE", "LT", "LTE"]) {
    validate({ ...definition(), condition: { kind: "compare", operator, left: ref("SOURCE", "power"), right: literal(5000) } });
  }
  for (const operator of ["IN", "NOT_IN"]) validate({ ...definition(), condition: { kind: "compare", operator, left: literal("斬"), right: literal(["斬", "特"]) } });
  validate({ ...definition(), condition: { kind: "compare", operator: "CONTAINS", left: ref("SOURCE", "traits"), right: literal("麦わらの一味") } });
  validate({ ...definition(), condition: { kind: "all", conditions: [{ kind: "exists", value: ref("EVENT_SOURCE", "id") }, { kind: "not", condition: { kind: "exists", value: literal(null) } }] } });
  invalid({ ...definition(), condition: { kind: "compare", operator: "GT", left: ref("SOURCE", "name"), right: literal(1) } }, /numbers/);
  invalid({ ...definition(), condition: { kind: "exists", value: ref("SOURCE", "__proto__") } });
  invalid({ ...definition(), condition: { kind: "exists", value: ref("SELF", "privateHandContents") } });
  invalid({ ...definition(), condition: { kind: "exists", value: ref("TARGET", "id") } }, /TARGET/);
});
test("candidate TARGET, selected-card reuse and lexical scopes", () => {
  const choice = select(); choice.selector.condition = { kind: "compare", operator: "LTE", left: ref("TARGET", "cost"), right: literal(4) };
  validate(definition([choice, move()]));
  invalid(definition([move(), select()]), /unbound/);
  invalid(definition([select(), select()]), /duplicate binding/);
  invalid(definition([{ kind: "optional", player: "SELF", actions: [select()] }, move()]), /unbound/);
  invalid(definition([{ kind: "repeat", count: 2, actions: [select()] }, move()]), /unbound/);
  invalid(definition([{ kind: "if", condition: { kind: "exists", value: literal(1) }, then: [select()], else: [] }, move()]), /unbound/);
  validate(definition([{ kind: "sequence", actions: [select()] }, move()]));
});
test("choices cannot be used as card sets; selections have legal bounds", () => {
  const action = { kind: "select", selector: { kind: "choice", chooser: "SELF", options: [{ id: "one", label: "選択肢" }] }, saveAs: "chosen" };
  validate(definition([action]));
  invalid(definition([action, move()]), /selected-card/);
  invalid(definition([{ ...select(), selector: { ...selector(), min: 2, max: 1 } }]), /min exceeds/);
  invalid(definition([{ ...select(), selector: { ...selector(), zones: ["secretZone"] } }]));
  invalid(definition([{ ...select(), selector: { ...selector(), zones: ["hand", "hand"] } }]), /duplicate zones/);
  invalid(definition([{ ...select(), selector: { ...selector(), candidates: ["hidden-card-id"] } }]), /unknown field/);
});
test("costs are separate definitions with explicitly bound payment results", () => {
  const raw = definition([move("paid")]);
  raw.costs = [{ kind: "payDon", amount: 2 }, { kind: "restCards", selector: { ...selector(), owner: "SELF" }, saveAs: "paid" }];
  validate(raw);
  invalid({ ...raw, costs: [{ kind: "payDon", amount: -1 }] });
  invalid({ ...raw, costs: [{ kind: "payDon", amount: 1.5 }] });
  invalid(definition([{ ...draw(), amount: "1" }]));
});
test("modifier, duration, restriction and replacement schemas remain non-executing", () => {
  validate(definition([
    { kind: "modify", modifier: { kind: "power", target: ref("SOURCE", "id"), amount: -1000 }, duration: { kind: "nextOpponentTurnEnd" } },
    { kind: "installRestriction", restriction: { kind: "forbid", target: ref("SOURCE", "id"), operation: "attack" }, duration: { kind: "thisTurn" } },
    { kind: "installReplacement", replacement: { kind: "replaceMove", condition: { kind: "exists", value: ref("EVENT", "cause") }, actions: [draw()] }, duration: { kind: "permanent" } },
  ]));
  invalid(definition([{ kind: "modify", modifier: { kind: "power", target: literal(1), amount: 1000 }, duration: { kind: "thisTurn" } }]), /card reference/);
});
test("repeat counts and expanded action budgets are bounded", () => {
  assert.equal(validate(definition([{ kind: "repeat", count: 3, actions: [draw()] }])).estimatedSteps, 4);
  invalid(definition([{ kind: "repeat", count: LIMITS.repeat + 1, actions: [] }]));
  let action = draw();
  for (let i = 0; i < 3; i++) action = { kind: "repeat", count: 20, actions: [action] };
  invalid(definition([action]), /step/);
});
test("JSON byte, depth, string, array and structural node limits", () => {
  assert.throws(() => parse(" ".repeat(LIMITS.bytes + 1)), /byte/);
  invalid(definition(Array.from({ length: LIMITS.array + 1 }, draw)), /array/);
  invalid({ ...definition(), effectId: "a".repeat(LIMITS.string + 1) }, /string/);
  let condition = { kind: "exists", value: literal(1) };
  for (let i = 0; i < LIMITS.depth; i++) condition = { kind: "not", condition };
  invalid({ ...definition(), condition }, /complexity/);
  invalid({ ...definition(), padding: Array.from({ length: 128 }, () => Array(40).fill(1)) }, /complexity/);
});
test("prototype pollution, code, accessors, cycles and non-JSON values are rejected", () => {
  assert.throws(() => parse('{"__proto__":{"polluted":true}}'), /unsafe/);
  assert.equal({}.polluted, undefined);
  invalid({ ...definition(), execute: "process.exit()" }, /unknown field/);
  const cyclic = definition(); cyclic.loop = cyclic; invalid(cyclic, /cyclic/);
  const accessor = definition(); Object.defineProperty(accessor, "execute", { enumerable: true, get() { throw new Error("getter must not run"); } }); invalid(accessor, /accessors/);
  invalid({ ...definition(), value: () => {} }, /non-JSON/);
  invalid({ ...definition(), value: new Date() }, /non-plain/);
  invalid({ ...definition(), value: NaN }, /non-finite/);
  const sparse = []; sparse.length = 2; invalid({ ...definition(), value: sparse }, /sparse/);
});
test("registries extend predicates, actions and replacements without core changes", () => {
  const registries = createBuiltinRegistries();
  const parser = kind => raw => {
    if (Object.keys(raw).some(key => key !== "kind")) throw new Error("extra field");
    return { kind };
  };
  registries.predicate.register("customPredicate", parser("customPredicate"));
  registries.action.register("customAction", parser("customAction"));
  registries.replacement.register("customReplacement", parser("customReplacement"));
  assert.throws(() => registries.action.register("customAction", parser("customAction")), /Duplicate/);
  const raw = definition([{ kind: "customAction" }]); raw.condition = { kind: "customPredicate" };
  assert.equal(validate(raw, registries).status, "schemaOnly");
  assert.throws(() => registries.action.register("late", parser("late")), /sealed/);
  invalid(raw, /unknown predicate/);
  const replacementRegistry = createBuiltinRegistries();
  replacementRegistry.replacement.register("customReplacement", parser("customReplacement"));
  validate(definition([{ kind: "installReplacement", replacement: { kind: "customReplacement" }, duration: { kind: "thisTurn" } }]), replacementRegistry);
});
test("custom action estimators participate in safety limits", () => {
  const registries = createBuiltinRegistries();
  registries.action.register("tooExpensive", () => ({ kind: "tooExpensive" }), () => LIMITS.steps + 1);
  assert.throws(() => validate(definition([{ kind: "tooExpensive" }]), registries), /budget/);
  const mismatch = createBuiltinRegistries();
  mismatch.action.register("mismatch", () => ({ kind: "other" }));
  assert.throws(() => validate(definition([{ kind: "mismatch" }]), mismatch), /mismatched/);
});
