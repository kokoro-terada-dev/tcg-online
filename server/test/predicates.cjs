const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateEffectDefinition } = require("../dist/test/effects/validation.js");
const { createBuiltinRegistries } = require("../dist/test/effects/builtins.js");
const { resolveValue, ConditionError, known, unknown } = require("../dist/test/effects/facts.js");
const { evaluateCondition: evaluate, createPredicateRuntimeRegistry, EVALUATION_LIMITS } = require("../dist/test/effects/predicates.js");
const literal = value => ({ kind: "literal", value });
const ref = (from, field) => ({ kind: "ref", from, field });
const compare = (operator, left, right) => ({ kind: "compare", operator, left, right });
const exists = value => ({ kind: "exists", value });
const variable = name => ({ kind: "ref", from: "VARIABLE", name });
const parsed = condition => validateEffectDefinition({ dslVersion: 1, effectId: "TEST.effect", cardId: "TEST", trigger: { kind: "event", event: "onPlay" }, condition, costs: [], actions: [] }).definition.condition;
const isUnknown = result => assert.equal(result.state, "unknown");

test("known zero, false and empty arrays are not missing facts", () => {
  const facts = { self: { lifeCount: 0 }, source: { rotated: false, traits: [] } };
  assert.deepEqual(evaluate(parsed(compare("EQ", ref("SELF", "lifeCount"), literal(0))), facts), known(true));
  assert.deepEqual(evaluate(parsed(exists(ref("SOURCE", "rotated"))), facts), known(true));
  assert.deepEqual(evaluate(parsed(exists(ref("SOURCE", "traits"))), facts), known(true));
  assert.deepEqual(evaluate(parsed(compare("CONTAINS", ref("SOURCE", "traits"), literal("crew"))), facts), known(false));
});
test("missing and null master values do not become zero or false", () => {
  for (const source of [{}, { power: null }]) {
    isUnknown(evaluate(parsed(compare("GTE", ref("SOURCE", "power"), literal(0))), { source }));
    isUnknown(evaluate(parsed(exists(ref("SOURCE", "power"))), { source }));
    isUnknown(evaluate(parsed({ kind: "not", condition: exists(ref("SOURCE", "power")) }), { source }));
  }
  isUnknown(evaluate(parsed(exists(ref("SOURCE", "id"))), {}));
  assert.deepEqual(evaluate(parsed(exists(ref("EVENT_SOURCE", "id"))), { eventSource: null }), known(false));
});
test("all comparison operators have strict, deterministic semantics", () => {
  for (const [operator, result] of [["EQ", false], ["NEQ", true], ["GT", true], ["GTE", true], ["LT", false], ["LTE", false]]) {
    assert.deepEqual(evaluate(parsed(compare(operator, literal(5000), literal(4000))), {}), known(result));
  }
  assert.deepEqual(evaluate(parsed(compare("IN", literal("斬"), literal(["斬", "特"]))), {}), known(true));
  assert.deepEqual(evaluate(parsed(compare("NOT_IN", literal("特"), literal(["斬"]))), {}), known(true));
  assert.deepEqual(evaluate(parsed(compare("CONTAINS", literal("シッケアール王国"), literal("王国"))), {}), known(true));
  assert.deepEqual(evaluate(parsed(compare("CONTAINS", ref("SOURCE", "traits"), literal("B・W"))), { source: { traits: ["B・W", "超新星"] } }), known(true));
});
test("numeric facts are validated and power alone may be negative", () => {
  assert.deepEqual(evaluate(parsed(compare("LT", ref("SOURCE", "power"), literal(0))), { source: { power: -1000 } }), known(true));
  for (const value of ["5000", NaN, Infinity, 1.5]) isUnknown(resolveValue(ref("SOURCE", "power"), { source: { power: value } }));
  isUnknown(resolveValue(ref("SOURCE", "cost"), { source: { cost: -1 } }));
  isUnknown(resolveValue(ref("SELF", "handCount"), { self: { handCount: -1 } }));
  isUnknown(resolveValue(ref("GAME", "activePlayer"), { game: { activePlayer: 2 } }));
  isUnknown(resolveValue(ref("GAME", "turnNumber"), { game: { turnNumber: 0 } }));
});
test("three-valued boolean logic never turns unknown into an automatic success", () => {
  const t = exists(literal(0)), f = exists(literal(null)), u = exists(ref("SOURCE", "power"));
  const cases = [
    [{ kind: "all", conditions: [t, u] }, "unknown"],
    [{ kind: "all", conditions: [u, f] }, false],
    [{ kind: "any", conditions: [f, u] }, "unknown"],
    [{ kind: "any", conditions: [u, t] }, true],
    [{ kind: "not", condition: u }, "unknown"],
  ];
  for (const [node, expected] of cases) {
    const result = evaluate(parsed(node), {});
    if (expected === "unknown") isUnknown(result); else assert.deepEqual(result, known(expected));
  }
});
test("non-master context absence is distinct from missing facts", () => {
  assert.deepEqual(evaluate(parsed(exists(literal(null))), {}), known(false));
  isUnknown(evaluate(parsed(exists(ref("EVENT", "sourceId"))), {}));
  assert.deepEqual(resolveValue(ref("EVENT_SOURCE", "id"), { eventSource: null }), known(null));
  isUnknown(resolveValue(ref("EVENT_SOURCE", "id"), {}));
});
test("variables preserve their explicit known/unknown state", () => {
  const facts = { variables: new Map([["zero", known(0)], ["missing", unknown("not-resolved")], ["flag", known(false)]]) };
  assert.deepEqual(resolveValue(variable("zero"), facts), known(0));
  assert.deepEqual(resolveValue(variable("flag"), facts), known(false));
  isUnknown(resolveValue(variable("missing"), facts)); isUnknown(resolveValue(variable("absent"), facts));
});
test("references use only own data properties without invoking getters", () => {
  const source = Object.create({ power: 5000 });
  isUnknown(resolveValue(ref("SOURCE", "power"), { source }));
  Object.defineProperty(source, "power", { get() { throw new Error("must not execute"); } });
  isUnknown(resolveValue(ref("SOURCE", "power"), { source }));
  assert.throws(() => resolveValue(ref("SOURCE", "constructor"), { source: {} }), ConditionError);
  assert.throws(() => resolveValue(ref("__proto__", "id"), {}), ConditionError);
});
test("readers do not freeze or mutate authoritative snapshots", () => {
  const traits = ["麦わらの一味"], facts = { source: { traits } };
  const result = resolveValue(ref("SOURCE", "traits"), facts);
  assert.equal(Object.isFrozen(traits), false);
  assert.equal(Object.isFrozen(result.value), true);
  traits.push("超新星");
  assert.deepEqual(result.value, ["麦わらの一味"]);
});
test("source, target, opponent, game and event read independent facts", () => {
  const facts = { self: { lifeCount: 1 }, opponent: { lifeCount: 4 }, source: { power: 3000 }, target: { power: 5000 }, game: { turnNumber: 3, phase: "main", activePlayer: 0 }, event: { type: "onPlay", cause: "EFFECT_MOVE", controller: 1 } };
  assert.deepEqual(resolveValue(ref("OPPONENT", "lifeCount"), facts), known(4));
  assert.deepEqual(resolveValue(ref("TARGET", "power"), facts), known(5000));
  assert.deepEqual(resolveValue(ref("GAME", "turnNumber"), facts), known(3));
  assert.deepEqual(resolveValue(ref("EVENT", "controller"), facts), known(1));
});
test("unknown runtime commands and invalid handler results fail explicitly", () => {
  assert.throws(() => evaluate({ kind: "notRegistered" }, {}), /No runtime/);
  const registry = createPredicateRuntimeRegistry();
  registry.register("invalid", () => known(1));
  assert.throws(() => evaluate({ kind: "invalid" }, {}, registry), /invalid result/);
});
test("schema and runtime handlers must both be registered for an extension", () => {
  const schema = createBuiltinRegistries();
  schema.predicate.register("custom", raw => ({ kind: "custom" }));
  const definition = validateEffectDefinition({ dslVersion: 1, effectId: "TEST.effect", cardId: "TEST", trigger: { kind: "event", event: "onPlay" }, condition: { kind: "custom" }, costs: [], actions: [] }, schema);
  assert.throws(() => evaluate(definition.definition.condition, {}), /No runtime/);
  const runtime = createPredicateRuntimeRegistry();
  runtime.register("custom", (_node, ctx) => {
    const result = ctx.resolve(ref("SELF", "lifeCount"));
    return result.state === "known" ? known(result.value === 1) : result;
  });
  assert.deepEqual(evaluate(definition.definition.condition, { self: { lifeCount: 1 } }, runtime), known(true));
  assert.equal(definition.status, "schemaOnly");
  assert.throws(() => runtime.register("late", () => known(true)), /sealed/);
});
test("runtime depth and work budgets also constrain trusted extension handlers", () => {
  const looping = createPredicateRuntimeRegistry();
  looping.register("recursive", (node, ctx) => ctx.evaluate(node));
  assert.throws(() => evaluate({ kind: "recursive" }, {}, looping), /depth limit/);
  const busy = createPredicateRuntimeRegistry();
  busy.register("expensive", (_node, ctx) => { for (let i = 0; i <= EVALUATION_LIMITS.steps; i++) ctx.resolve(literal(1)); return known(true); });
  assert.throws(() => evaluate({ kind: "expensive" }, {}, busy), /step limit/);
});
test("no condition is true but never an action execution or a timing permission", () => {
  assert.deepEqual(evaluate(undefined, {}), known(true));
  assert.equal(evaluate(undefined, {}).execute, undefined);
  isUnknown(evaluate(parsed(compare("EQ", literal([1]), literal([1]))), {}));
});
