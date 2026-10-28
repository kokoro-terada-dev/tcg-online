const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateEffectDefinition } = require("../dist/test/effects/validation.js");
const { createBuiltinRegistries } = require("../dist/test/effects/builtins.js");
const { planCosts, CostPlanSession } = require("../dist/test/effects/costPlan.js");
const { createCostRuntimeRegistry, CostError } = require("../dist/test/effects/costs.js");
const { createSelectorRuntimeRegistry } = require("../dist/test/effects/selectors.js");
const { createPredicateRuntimeRegistry } = require("../dist/test/effects/predicates.js");
const literal = value => ({ kind: "literal", value });
const ref = (from, field) => ({ kind: "ref", from, field });
const cmp = (operator, left, right) => ({ kind: "compare", operator, left, right });
const selector = (zones, overrides = {}) => ({ kind: "cards", chooser: "SELF", owner: "SELF", zones, min: 1, max: 1, mode: "SELECT", ...overrides });
function costs(raw, schema) { return validateEffectDefinition({ dslVersion: 1, effectId: "TEST.cost", cardId: "TEST", trigger: { kind: "activate", window: "main" }, costs: raw, actions: [] }, schema).definition.costs; }
function card(instanceId, overrides = {}) { return { instanceId, generation: 1, owner: 0, controller: 0, zone: "hand", kind: "character", cardId: `TEST-${instanceId}`, faceUp: true, rotated: false, facts: { cost: 2, traits: ["麦わらの一味"] }, ...overrides }; }
const don = (id, overrides = {}) => card(id, { kind: "don", zone: "activeDon", facts: {}, ...overrides });
const snapshot = (cards, overrides = {}) => ({ matchId: "match-1", revision: 5, cards, facts: { source: { id: "source" }, self: { handCount: 2 } }, ...overrides });
function input(raw, cards, choices = [], overrides = {}) { return { resolutionId: "r1", actor: 0, semantics: "independent", costs: costs(raw), snapshot: snapshot(cards), choices, ...overrides }; }
const choice = (costIndex, ...ids) => ({ costIndex, cards: ids.map(instanceId => ({ instanceId, generation: 1 })) });
const move = (zones, zone = "trash", extra = {}) => ({ kind: "moveCards", selector: selector(zones), destination: { owner: "SELF", zone, position: zone === "donDeck" ? "top" : "append", visibility: "faceUp" }, ...extra });

test("two DON payments cannot reserve the same resources, even before selection", () => {
  const raw = [{ kind: "payDon", amount: 1 }, { kind: "payDon", amount: 1 }];
  assert.equal(planCosts(input(raw, [don("d1")])).state, "unavailable");
  assert.equal(planCosts(input(raw, [don("d1"), don("d2")])).state, "selectionRequired");
  assert.equal(planCosts(input(raw, [don("d1"), don("d2")], [choice(0, "d1"), choice(1, "d1")])).state, "unavailable");
  const result = planCosts(input(raw, [don("d1"), don("d2")], [choice(0, "d1"), choice(1, "d2")]));
  assert.equal(result.state, "planned"); assert.equal(result.plan.resources.length, 2);
});
test("matching handles overlapping candidate groups instead of a greedy false failure", () => {
  const raw = [{ kind: "restCards", selector: selector(["activeDon", "leader"]) }, { kind: "payDon", amount: 1 }];
  const cards = [don("d1"), card("source", { zone: "leader", kind: "leader" })];
  assert.equal(planCosts(input(raw, cards)).state, "selectionRequired");
  assert.equal(planCosts(input(raw, cards, [choice(0, "d1")])).state, "unavailable");
  assert.equal(planCosts(input(raw, cards, [choice(0, "source")])).state, "selectionRequired");
  assert.equal(planCosts(input(raw, cards, [choice(0, "source"), choice(1, "d1")])).state, "planned");
});
test("combined DON, hand discard and board rest are a single immutable resource plan", () => {
  const raw = [{ kind: "payDon", amount: 2 }, move(["hand"], "trash", { saveAs: "discarded" }), { kind: "restCards", selector: selector(["character"]), saveAs: "rested" }];
  const cards = [don("d1"), don("d2"), card("h1"), card("c1", { zone: "character" })];
  const request = input(raw, cards, [choice(0, "d1", "d2"), choice(1, "h1"), choice(2, "c1")]);
  const before = JSON.stringify(request.snapshot), result = planCosts(request);
  assert.equal(result.state, "planned"); assert.equal(result.plan.status, "resourcePlan");
  assert.deepEqual(result.plan.operations.map(op => op.kind), ["rest", "rest", "move", "rest"]);
  assert.equal(result.plan.operations[2].cause, "COST_PAYMENT");
  assert.deepEqual(result.plan.bindings.discarded, [{ instanceId: "h1", generation: 1 }]);
  assert.equal(Object.isFrozen(result.plan.operations), true);
  assert.equal(Object.isFrozen(cards), false); assert.equal(JSON.stringify(request.snapshot), before);
});
test("failure at a later cost never partially rests DON or removes hand cards", () => {
  const cards = [don("d1")], raw = [{ kind: "payDon", amount: 1 }, move(["hand"])];
  const before = JSON.stringify(cards);
  assert.equal(planCosts(input(raw, cards, [choice(0, "d1")])).state, "unavailable");
  assert.equal(JSON.stringify(cards), before); assert.equal(cards[0].rotated, false);
});
test("canonical kind/rest state is authoritative over duplicated facts", () => {
  const cards = [don("d1", { facts: { type: "event", rotated: true } })];
  assert.equal(planCosts(input([{ kind: "payDon", amount: 1 }], cards, [choice(0, "d1")])).state, "planned");
  const rested = don("d1", { zone: "restDon", rotated: true, facts: { rotated: false } });
  assert.equal(planCosts(input([{ kind: "payDon", amount: 1 }], [rested])).state, "unavailable");
});
test("opponent-owned or opponent-controlled resources cannot pay your costs", () => {
  for (const actor of [0, 1]) {
    const own = don("own", { owner: actor, controller: actor });
    const other = don("other", { owner: 1 - actor, controller: 1 - actor });
    const stolen = don("controlled", { owner: actor, controller: 1 - actor });
    assert.equal(planCosts(input([{ kind: "payDon", amount: 2 }], [own, other, stolen], [], { actor })).state, "unavailable");
    const result = planCosts(input([{ kind: "payDon", amount: 1 }], [own, other, stolen], [choice(0, "own")], { actor }));
    assert.equal(result.state, "planned");
  }
});
test("DON -1/-3 and active-only return use generic move cost selection", () => {
  for (const amount of [1, 3]) {
    const raw = move(["activeDon", "restDon"], "donDeck"); raw.selector.min = amount; raw.selector.max = amount;
    const cards = [don("d1"), don("d2", { zone: "restDon", rotated: true }), don("d3")];
    const result = planCosts(input([raw], cards, [choice(0, ...cards.slice(0, amount).map(c => c.instanceId))]));
    assert.equal(result.state, "planned"); assert.equal(result.plan.operations.length, amount);
    assert.ok(result.plan.operations.every(op => op.kind === "move" && op.destination.zone === "donDeck"));
  }
  assert.equal(planCosts(input([move(["activeDon"], "donDeck")], [don("d1", { zone: "restDon", rotated: true })], [choice(0, "d1")])).state, "unavailable");
});
test("conditional hand reveal keeps the card in hand and produces a reveal operation", () => {
  const sel = selector(["hand"], { condition: cmp("CONTAINS", ref("TARGET", "traits"), literal("麦わらの一味")) });
  const cards = [card("h1")], raw = [{ kind: "revealCards", selector: sel, saveAs: "shown" }];
  const result = planCosts(input(raw, cards, [choice(0, "h1")]));
  assert.equal(result.state, "planned"); assert.equal(result.plan.operations[0].kind, "reveal");
  assert.equal(cards[0].zone, "hand");
  const missing = card("h1", { facts: { traits: null } });
  assert.equal(planCosts(input(raw, [missing])).state, "unknown");
});
test("source exclusion and character return-to-hand are generic selectors/moves", () => {
  const raw = move(["character"], "hand"); raw.selector.exclude = cmp("EQ", ref("TARGET", "id"), ref("SOURCE", "id"));
  const cards = [card("source", { zone: "character" }), card("other", { zone: "character" })];
  assert.throws(() => planCosts(input([raw], cards, [choice(0, "source")])));
  assert.equal(planCosts(input([raw], cards, [choice(0, "other")])).state, "planned");
});
test("pending choices exclude resources reserved by other fixed costs", () => {
  const raw = [{ kind: "payDon", amount: 1 }, { kind: "payDon", amount: 1 }];
  const result = planCosts(input(raw, [don("d1"), don("d2")], [choice(0, "d1")]));
  assert.equal(result.state, "selectionRequired"); assert.equal(result.requests[0].costIndex, 1);
  const exclude = result.requests[0].selector.exclude;
  assert.ok(JSON.stringify(exclude).includes("d1"));
});
test("revalidation checks revision, generation, current state and current conditions", () => {
  const raw = [{ kind: "payDon", amount: 1 }, move(["hand"])], cards = [don("d1"), card("h1")];
  const request = input(raw, cards, [choice(0, "d1"), choice(1, "h1")]);
  const session = CostPlanSession.prepare(request); assert.ok(session instanceof CostPlanSession);
  assert.equal(session.validateForCommit(request.snapshot).status, "resourcePlan");
  assert.throws(() => JSON.stringify(session), /server-only/);
  assert.throws(() => session.validateForCommit({ ...request.snapshot, revision: 6 }), /stale/);
  assert.throws(() => session.validateForCommit({ ...request.snapshot, matchId: "other" }), /stale/);
  for (const changed of [card("h1", { generation: 2 }), card("h1", { zone: "trash" }), card("h1", { owner: 1 }), card("h1", { cardId: "changed" })]) assert.throws(() => session.validateForCommit(snapshot([don("d1"), changed])));
  assert.throws(() => session.validateForCommit(snapshot([don("d1", { zone: "restDon", rotated: true }), card("h1")])));
});
test("ordered or shared-object payment patterns are explicitly unsupported", () => {
  const raw = [{ kind: "payDon", amount: 1 }, move(["activeDon", "restDon"], "donDeck")];
  const result = planCosts(input(raw, [don("d1")], [], { semantics: "ordered" }));
  assert.equal(result.state, "unsupported");
  assert.equal(planCosts(input(raw, [don("d1")])).state, "unavailable");
  assert.throws(() => planCosts(input(raw, [don("d1")], [], { semantics: undefined })), /semantics/);
});
test("latest global conditions and missing card metadata invalidate an old plan", () => {
  const sel = selector(["hand"], { condition: { kind: "all", conditions: [cmp("GTE", ref("SELF", "handCount"), literal(2)), cmp("LTE", ref("TARGET", "cost"), literal(3))] } });
  const request = input([{ kind: "moveCards", selector: sel, destination: { owner: "SELF", zone: "trash", position: "append", visibility: "faceUp" } }], [card("h1")], [choice(0, "h1")]);
  const s = CostPlanSession.prepare(request); assert.ok(s instanceof CostPlanSession);
  assert.throws(() => s.validateForCommit({ ...request.snapshot, facts: { self: { handCount: 1 } } }));
  assert.throws(() => s.validateForCommit(snapshot([card("h1", { facts: { cost: null } })])));
  request.choices[0].cards[0].instanceId = "forged-after-preparation";
  assert.equal(s.validateForCommit(request.snapshot).resources[0].instanceId, "h1");
});
test("extension handlers receive a detached frozen snapshot, not the live card arrays", () => {
  const schema = createBuiltinRegistries(); schema.cost.register("custom", () => ({ kind: "custom" }));
  const cards = [don("d1", { facts: { traits: ["original"] } })];
  const request = input([], cards, [choice(0, "d1")], { costs: costs([{ kind: "custom" }], schema) });
  const runtime = createCostRuntimeRegistry();
  runtime.register("custom", (_node, context) => {
    assert.equal(Object.isFrozen(context.snapshot.cards[0]), true);
    assert.throws(() => context.snapshot.cards[0].facts.traits.push("mutated"));
    return { operation: "rest", selector: selector(["activeDon"], { controller: "SELF" }) };
  });
  assert.equal(planCosts(request, { costs: runtime, selectors: createSelectorRuntimeRegistry(), predicates: createPredicateRuntimeRegistry() }).state, "planned");
  assert.deepEqual(cards[0].facts.traits, ["original"]); assert.equal(Object.isFrozen(cards[0]), false);
});
test("unsupported cost modes and destination rules cannot be silently accepted", () => {
  assert.equal(planCosts(input([{ kind: "restCards", selector: selector(["character"], { owner: "OPPONENT" }) }], [])).state, "unsupported");
  assert.equal(planCosts(input([{ kind: "restCards", selector: selector(["character"], { mode: "RANDOM" }) }], [])).state, "unsupported");
  assert.equal(planCosts(input([move(["hand"], "life")], [])).state, "unsupported");
  assert.equal(planCosts(input([move(["hand"], "donDeck")], [card("h")])).state, "unavailable");
});
test("choice bounds, duplicates and stale references fail without changing data", () => {
  const raw = [{ kind: "payDon", amount: 1 }], cards = [don("d1"), don("d2")], before = JSON.stringify(cards);
  for (const choices of [[choice(0, "d1", "d1")], [choice(0)], [choice(0, "d1"), choice(0, "d2")], [choice(1, "d1")], [{ costIndex: 0, cards: [{ instanceId: "d1", generation: 2 }] }]]) assert.throws(() => planCosts(input(raw, cards, choices)));
  assert.equal(JSON.stringify(cards), before);
});
test("empty costs and explicit zero-card costs are valid resource plans", () => {
  assert.equal(planCosts(input([], [])).state, "planned");
  const raw = [{ kind: "revealCards", selector: selector(["hand"], { min: 0, max: 1 }) }];
  assert.equal(planCosts(input(raw, [], [choice(0)])).state, "planned");
});
test("registry extension needs both schema and runtime definitions", () => {
  const schema = createBuiltinRegistries(); schema.cost.register("custom", () => ({ kind: "custom" }));
  const raw = costs([{ kind: "custom" }], schema), request = input([], [don("d1")], [choice(0, "d1")], { costs: raw });
  assert.throws(() => planCosts(request), /unknown-runtime-cost/);
  const runtime = createCostRuntimeRegistry(); runtime.register("custom", () => ({ operation: "rest", selector: selector(["activeDon"], { controller: "SELF" }) }));
  assert.equal(planCosts(request, { costs: runtime, selectors: createSelectorRuntimeRegistry(), predicates: createPredicateRuntimeRegistry() }).state, "planned");
  assert.throws(() => runtime.register("late", () => ({})), /sealed/);
});
test("definition and resource safety limits are enforced", () => {
  assert.throws(() => planCosts(input(Array.from({ length: 17 }, () => ({ kind: "payDon", amount: 1 })), [])), /cost-count/);
  assert.throws(() => planCosts(input([{ kind: "payDon", amount: 1 }], [don("d1", { rotated: true })])), /active-don/);
  assert.throws(() => planCosts(input([{ kind: "payDon", amount: 1 }], [don("d1", { zone: "character" })])), /attached-or-misplaced/);
});
