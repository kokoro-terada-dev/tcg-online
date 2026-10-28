const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateEffectDefinition } = require("../dist/test/effects/validation.js");
const { createBuiltinRegistries } = require("../dist/test/effects/builtins.js");
const { createPredicateRuntimeRegistry } = require("../dist/test/effects/predicates.js");
const { prepareSelector, createSelectorRuntimeRegistry, SelectionError } = require("../dist/test/effects/selectors.js");
const { SelectionSession } = require("../dist/test/effects/selectionSession.js");
const literal = value => ({ kind: "literal", value });
const ref = (from, field) => ({ kind: "ref", from, field });
const compare = (operator, left, right) => ({ kind: "compare", operator, left, right });
function parsed(raw, schema = createBuiltinRegistries()) {
  return validateEffectDefinition({ dslVersion: 1, effectId: "TEST.select", cardId: "TEST", trigger: { kind: "event", event: "onPlay" }, costs: [], actions: [{ kind: "select", selector: raw, saveAs: "chosen" }] }, schema).definition.actions[0].selector;
}
const selector = (overrides = {}) => parsed({ kind: "cards", chooser: "SELF", owner: "SELF", zones: ["character"], min: 0, max: 2, mode: "SELECT", ...overrides });
const card = (instanceId, overrides = {}) => ({ instanceId, generation: 1, owner: 0, controller: 0, zone: "character", cardId: `TEST-${instanceId}`, faceUp: true, facts: { cost: 3, power: 5000, traits: ["麦わらの一味"], privateNote: "private-metadata" }, ...overrides });
const snapshot = (cards = [card("a"), card("b")], revision = 7) => ({ matchId: "match-1", revision, cards, facts: { source: { id: "a" }, self: { lifeCount: 3 }, opponent: { lifeCount: 5 } } });
function input(sel = selector(), snap = snapshot(), overrides = {}) { return { matchId: snap.matchId, resolutionId: "resolution-1", actor: 0, selector: sel, snapshot: snap, ...overrides }; }
function session(sel = selector(), snap = snapshot(), overrides = {}) { const result = SelectionSession.prepare(input(sel, snap, overrides)); assert.equal(result.state, "known"); return result.value; }
function reply(s, tokens) { return { ...s.identity, tokens }; }
const tokens = (s, viewer = 0) => s.viewFor(viewer).candidates.map(candidate => candidate.token);

test("both seats use actor-relative owner/controller and chooser", () => {
  const snap = snapshot([card("own"), card("other", { owner: 1, controller: 1 }), card("controlled", { owner: 0, controller: 1 })]);
  for (const actor of [0, 1]) {
    const plan = prepareSelector(selector({ owner: "SELF", controller: "SELF", chooser: "OPPONENT" }), actor, snap);
    assert.equal(plan.value.chooser, 1 - actor);
    assert.deepEqual(plan.value.candidates.map(ref => ref.instanceId), actor === 0 ? ["own"] : ["other"]);
  }
});
test("TARGET predicates and SOURCE exclusion use instance IDs, not printed IDs", () => {
  const snap = snapshot([card("a", { cardId: "SAME" }), card("b", { cardId: "SAME" }), card("expensive", { facts: { cost: 8 } })]);
  const sel = selector({ condition: compare("LTE", ref("TARGET", "cost"), literal(4)), exclude: compare("EQ", ref("TARGET", "id"), ref("SOURCE", "id")) });
  assert.deepEqual(prepareSelector(sel, 0, snap).value.candidates.map(ref => ref.instanceId), ["b"]);
});
test("unknown candidate conditions block selection rather than silently hiding cards", () => {
  const snap = snapshot([card("a"), card("missing", { facts: { cost: null } })]);
  const sel = selector({ condition: compare("LTE", ref("TARGET", "cost"), literal(4)) });
  assert.deepEqual(SelectionSession.prepare(input(sel, snap)), { state: "unknown", reason: "candidate-condition-unavailable" });
});
test("view exposes only tokens/authorized identities and only to chooser", () => {
  const s = session(), view = s.viewFor(0);
  assert.equal(s.viewFor(1), null);
  assert.deepEqual(view.candidates.map(c => c.cardId), ["TEST-a", "TEST-b"]);
  for (const candidate of view.candidates) assert.deepEqual(Object.keys(candidate).sort(), ["cardId", "token"]);
  assert.equal(JSON.stringify(view).includes("private-metadata"), false);
  assert.equal(Object.isFrozen(view.candidates[0]), true);
  assert.throws(() => JSON.stringify(s), /server-only/);
});
test("opponent hand and decks cannot be inspected without authority", () => {
  for (const zone of ["hand", "deck", "life"]) {
    const snap = snapshot([card("secret", { owner: 1, controller: 1, zone, faceUp: false })]);
    assert.throws(() => session(selector({ owner: "OPPONENT", zones: [zone] }), snap), /reveal-authority/);
    const s = session(selector({ owner: "OPPONENT", zones: [zone] }), snap, { disclosure: { revealToChooser: [{ instanceId: "secret", generation: 1 }] } });
    assert.equal(s.viewFor(0).candidates[0].cardId, "TEST-secret");
    assert.throws(() => session(selector({ owner: "OPPONENT", zones: [zone] }), snap, { disclosure: { revealToChooser: [{ instanceId: "secret", generation: 2 }] } }), /disclosure/);
  }
});
test("own hand may be inspected but BLIND_SELECT conceals every identity", () => {
  const snap = snapshot([card("one", { zone: "hand", faceUp: false }), card("two", { zone: "hand", faceUp: false })]);
  assert.equal(session(selector({ zones: ["hand"] }), snap).viewFor(0).candidates[0].cardId, "TEST-one");
  const s = session(selector({ zones: ["hand"], mode: "BLIND_SELECT" }), snap);
  assert.ok(s.viewFor(0).candidates.every(c => c.cardId === null));
  const result = s.answer(0, reply(s, [tokens(s)[0]]), snap);
  assert.equal(result.cards.length, 1); assert.ok(["one", "two"].includes(result.cards[0].instanceId));
});
test("blind tokens differ across sessions, raw instance IDs and foreign tokens fail", () => {
  const snap = snapshot([card("hidden", { owner: 1, zone: "hand", faceUp: false })]);
  const sel = selector({ owner: "OPPONENT", zones: ["hand"], mode: "BLIND_SELECT" });
  const a = session(sel, snap), b = session(sel, snap);
  assert.notEqual(tokens(a)[0], tokens(b)[0]);
  assert.throws(() => a.answer(0, reply(a, ["hidden"]), snap), /unknown-selection-token/);
  assert.throws(() => a.answer(0, reply(a, tokens(b)), snap), /unknown-selection-token/);
});
test("filtered hidden selection cannot leak whether any hidden cards matched", () => {
  const snap = snapshot([card("hidden", { owner: 1, zone: "hand", faceUp: false, facts: { cost: 99 } })]);
  const sel = selector({ owner: "OPPONENT", zones: ["hand"], mode: "BLIND_SELECT", condition: compare("LTE", ref("TARGET", "cost"), literal(4)) });
  assert.throws(() => session(sel, snap), /filtered-hidden/);
  const s = session(sel, snap, { disclosure: { allowFilteredBlindSelection: true } });
  assert.deepEqual(s.viewFor(0).candidates, []);
  const visibleMode = selector({ owner: "OPPONENT", zones: ["hand"], condition: compare("LTE", ref("TARGET", "cost"), literal(4)) });
  assert.throws(() => session(visibleMode, snap), /filtered-hidden/);
  const missing = snapshot([card("hidden", { owner: 1, zone: "hand", faceUp: false, facts: { cost: null } })]);
  assert.throws(() => session(sel, missing), /filtered-hidden/);
  assert.throws(() => session(selector({ owner: "OPPONENT", zones: ["hand"], mode: "BLIND_SELECT", min: 1, max: 1, condition: compare("LTE", ref("TARGET", "cost"), literal(4)) }), snap), /filtered-hidden/);
});
test("identity, chooser, cardinality, duplicates and stale replies are rejected atomically", () => {
  const snap = snapshot(), s = session(selector({ min: 1, max: 1 }), snap), ids = tokens(s);
  for (const value of [reply(s, []), reply(s, ids), reply(s, [ids[0], ids[0]]), { ...reply(s, [ids[0]]), revision: 8 }, { ...reply(s, [ids[0]]), resolutionId: "other" }, { ...reply(s, [ids[0]]), matchId: "other" }, { ...reply(s, [ids[0]]), selectionId: "other" }]) {
    assert.throws(() => s.answer(0, value, snap)); assert.equal(s.closed, false);
  }
  assert.throws(() => s.answer(1, reply(s, [ids[0]]), snap));
  const result = s.answer(0, reply(s, [ids[0]]), snap);
  assert.deepEqual(result.cards, [{ instanceId: "a", generation: 1 }]);
  assert.equal(s.viewFor(0), null); assert.throws(() => s.answer(0, reply(s, [ids[0]]), snap));
});
test("answers recheck generation, zone, owner, controller and current predicates", () => {
  for (const patch of [{ generation: 2 }, { zone: "trash" }, { owner: 1 }, { controller: 1 }, { faceUp: false }, { cardId: "changed" }, { facts: { cost: 99 } }, { facts: { cost: null } }]) {
    const snap = snapshot([card("a")]);
    const sel = selector({ controller: "SELF", condition: compare("LTE", ref("TARGET", "cost"), literal(4)) });
    const s = session(sel, snap), answer = reply(s, tokens(s));
    assert.throws(() => s.answer(0, answer, snapshot([card("a", patch)])));
    assert.equal(s.closed, false);
  }
});
test("snapshot revision and match are revalidated independently of reply IDs", () => {
  const snap = snapshot(), s = session(selector(), snap), answer = reply(s, []);
  assert.throws(() => s.answer(0, answer, { ...snap, revision: 8 }), /revision-or-match/);
  assert.throws(() => s.answer(0, answer, { ...snap, matchId: "other" }), /revision-or-match/);
  assert.throws(() => SelectionSession.prepare(input(selector(), snap, { matchId: "wrong" })), /snapshot-match/);
});
test("ORDER preserves answer order while SELECT does not grant ordering authority", () => {
  const snap = snapshot();
  const ordered = session(selector({ mode: "ORDER", min: 2, max: 2 }), snap);
  const result = ordered.answer(0, reply(ordered, tokens(ordered).reverse()), snap);
  assert.deepEqual(result.cards.map(ref => ref.instanceId), ["b", "a"]);
  const selected = session(selector(), snap);
  assert.deepEqual(selected.answer(0, reply(selected, tokens(selected).reverse()), snap).cards.map(ref => ref.instanceId), ["a", "b"]);
  assert.throws(() => session(selector({ mode: "ORDER", min: 0 }), snap), /full-set/);
});
test("RANDOM and ALL are server-only, bounded and without replacement", () => {
  const snap = snapshot([card("a"), card("b"), card("c")]);
  for (const mode of ["RANDOM", "ALL"]) {
    const s = session(selector({ mode, min: mode === "RANDOM" ? 2 : 0, max: mode === "RANDOM" ? 2 : 3 }), snap);
    assert.equal(s.viewFor(0), null);
    assert.throws(() => s.answer(0, reply(s, []), snap));
    const result = s.resolveAutomatic(snap);
    assert.equal(result.cards.length, mode === "RANDOM" ? 2 : 3);
    assert.equal(new Set(result.cards.map(c => c.instanceId)).size, result.cards.length);
    assert.throws(() => s.resolveAutomatic(snap));
  }
  assert.throws(() => session(selector({ mode: "RANDOM", min: 0, max: 2 }), snap), /exact-count/);
  assert.throws(() => session(selector({ mode: "ALL", max: 2 }), snap), /exceeds-cardinality/);
  const s = session(selector({ mode: "ALL", max: 3 }), snap);
  assert.throws(() => s.resolveAutomatic(snapshot([card("a"), card("b")])));
});
test("CHOOSE_ONE-equivalent choices use tokens and return only internal option IDs", () => {
  const snap = snapshot(), choice = parsed({ kind: "choice", chooser: "OPPONENT", options: [{ id: "draw", label: "引く" }, { id: "skip", label: "引かない" }] });
  const s = session(choice, snap); assert.equal(s.viewFor(0), null);
  const view = s.viewFor(1);
  assert.deepEqual(view.options.map(o => o.label), ["引く", "引かない"]);
  assert.throws(() => s.answer(1, reply(s, ["draw"]), snap));
  assert.deepEqual(s.answer(1, reply(s, [view.options[1].token]), snap), { kind: "choice", optionId: "skip" });
});
test("candidate limits, duplicate instances, absent runtime handlers and cancellation", () => {
  assert.throws(() => session(selector({ min: 1 }), snapshot([])), /insufficient/);
  assert.throws(() => session(selector(), snapshot([card("a"), card("a")])));
  assert.throws(() => session(selector(), snapshot(Array.from({ length: 257 }, (_, i) => card(String(i))))), /snapshot/);
  assert.throws(() => session(selector(), snapshot(Array.from({ length: 129 }, (_, i) => card(String(i))))), /candidate-limit/);
  const s = session(); s.cancel(); assert.equal(s.viewFor(0), null); assert.throws(() => s.answer(0, reply(s, []), snapshot()));
  const schema = createBuiltinRegistries(); schema.selector.register("unimplemented", () => ({ kind: "unimplemented" }));
  const sel = parsed({ kind: "unimplemented" }, schema);
  assert.throws(() => SelectionSession.prepare(input(sel)), /unknown-runtime-selector/);
});
test("empty selection is legal when permitted and selection never moves or freezes cards", () => {
  const empty = snapshot([]), zero = session(selector({ min: 0, max: 1 }), empty);
  assert.deepEqual(zero.answer(0, reply(zero, []), empty), { kind: "cards", cards: [] });
  const snap = snapshot(), before = JSON.stringify(snap), s = session(selector(), snap);
  const result = s.answer(0, reply(s, [tokens(s)[0]]), snap);
  assert.equal(JSON.stringify(snap), before);
  assert.equal(Object.isFrozen(snap.cards), false);
  assert.equal(Object.isFrozen(snap.cards[0].facts.traits), false);
  assert.equal(Object.isFrozen(result.cards[0]), true);
});
test("selector extensions return standard plans without changes to central dispatch", () => {
  const schema = createBuiltinRegistries(); schema.selector.register("customChoice", () => ({ kind: "customChoice" }));
  const registry = createSelectorRuntimeRegistry();
  registry.register("customChoice", (_node, context) => ({ state: "known", value: { kind: "choice", chooser: context.actor, options: [{ id: "one", label: "選ぶ" }] } }));
  const result = SelectionSession.prepare(input(parsed({ kind: "customChoice" }, schema)), registry);
  assert.equal(result.value.viewFor(0).kind, "choice");
  assert.throws(() => registry.register("late", () => ({})), /sealed/);
});
test("candidate evaluation has a cumulative budget as well as per-condition limits", () => {
  const schema = createBuiltinRegistries(); schema.predicate.register("busy", () => ({ kind: "busy" }));
  const sel = parsed({ kind: "cards", chooser: "SELF", owner: "SELF", zones: ["character"], min: 0, max: 128, mode: "SELECT", condition: { kind: "busy" } }, schema);
  const runtime = createPredicateRuntimeRegistry();
  runtime.register("busy", (_node, ctx) => { for (let i = 0; i < 64; i++) ctx.resolve(literal(1)); return { state: "known", value: true }; });
  const snap = snapshot(Array.from({ length: 128 }, (_, i) => card(String(i))));
  assert.throws(() => SelectionSession.prepare(input(sel, snap), createSelectorRuntimeRegistry(), runtime), /Cumulative/);
});
test("reply accessors, extra fields and sparse tokens are rejected without invoking code", () => {
  const snap = snapshot(), s = session(), value = reply(s, []);
  Object.defineProperty(value, "tokens", { enumerable: true, get() { throw new Error("must not execute getter"); } });
  assert.throws(() => s.answer(0, value, snap), /reply-fields/);
  assert.throws(() => s.answer(0, { ...reply(s, []), cardId: "secret" }, snap), /reply-fields/);
  const sparse = []; sparse.length = 1;
  assert.throws(() => s.answer(0, reply(s, sparse), snap), /reply-token/);
});
