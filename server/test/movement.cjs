const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createMovementState, emptyZones, validateMovementState, getCard } = require("../dist/test/movement/state.js");
const { MovementStore } = require("../dist/test/movement/engine.js");
const { projectMovementState, projectMovementEvents } = require("../dist/test/movement/projection.js");
let sequence = 0;
const rules = { status: "certifiedNone" };
const ref = (id, generation = 0) => ({ instanceId: id, generation });
const at = (zone, player = 0) => ({ player, zone });
const card = (id, kind = "character", owner = 0, patch = {}) => ({ instanceId: id, generation: 0, cardId: `TEST-${id}`, kind, owner, controller: owner, faceUp: true, rotated: false, attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null, ...patch });
function state(entries = [], turnNumber = 3) {
  const players = [emptyZones(), emptyZones()], cards = Object.create(null);
  const all = [{ card: card("leader0", "leader", 0), zone: "leader" }, { card: card("leader1", "leader", 1), zone: "leader" }, ...entries];
  for (const entry of all) {
    cards[entry.card.instanceId] = entry.card;
    const zones = players[entry.player ?? entry.card.owner];
    if (["character", "leader", "stage"].includes(entry.zone)) zones[entry.zone][entry.slot ?? zones[entry.zone].indexOf(null)] = entry.card.instanceId;
    else zones[entry.zone].push(entry.card.instanceId);
  }
  return createMovementState({ matchId: "match-1", turnNumber, players, cards });
}
function store(entries = [], turnNumber = 3) { return new MovementStore(state(entries, turnNumber)); }
function tx(s, operations, patch = {}) { return { transactionId: `tx-${++sequence}`, matchId: "match-1", expectedRevision: s.snapshot().revision, turnNumber: s.snapshot().turnNumber, actor: 0, effectController: 0, source: ref("leader0"), mode: "effect", resolutionId: "r1", operations, ...patch }; }
const to = (zone, player = 0, patch = {}) => ({ player, zone, position: ["character", "stage"].includes(zone) ? "firstEmpty" : "append", faceUp: zone !== "deck" && zone !== "life" && zone !== "donDeck", rotated: zone === "restDon", ...patch });
const move = (id, from, zone, patch = {}) => ({ kind: "move", card: ref(id), from: at(from), to: to(zone), cause: "EFFECT_MOVE", ...patch });
const parentEntries = () => [
  { card: card("c1", "character", 0, { modifierIds: ["m1"], grantIds: ["g1"], enteredTurn: 2 }), zone: "character", slot: 2 },
  { card: card("d1", "don", 0, { attachedTo: ref("c1"), modifierIds: ["dm"] }), zone: "attachedDon" },
  { card: card("d2", "don", 0, { attachedTo: ref("c1") }), zone: "attachedDon" },
];

test("all character exits return attached DON and conserve every physical card", () => {
  for (const destination of ["hand", "trash", "deck", "life", "public"]) {
    const s = store(parentEntries()), before = s.snapshot(), original = JSON.stringify(before);
    const result = s.commit(tx(s, [move("c1", "character", destination)]), rules), next = result.state;
    assert.equal(Object.keys(next.cards).length, Object.keys(before.cards).length);
    assert.deepEqual(next.players[0].restDon, ["d1", "d2"]); assert.deepEqual(next.players[0].attachedDon, []);
    assert.equal(next.cards.c1.generation, 1); assert.equal(next.cards.c1.enteredTurn, null);
    assert.deepEqual(next.cards.c1.modifierIds, []); assert.deepEqual(next.cards.c1.grantIds, []);
    for (const id of ["d1", "d2"]) { assert.equal(next.cards[id].attachedTo, null); assert.equal(next.cards[id].rotated, true); assert.equal(next.cards[id].generation, 1); }
    assert.equal(result.events.length, 3); assert.equal(result.events[1].cause.kind, "RULE_PROCESSING");
    assert.equal(result.events[1].cause.parentEventId, result.events[0].eventId);
    assert.equal(new Set(result.events.map(event => event.groupId)).size, 1);
    assert.equal(JSON.stringify(before), original); validateMovementState(next);
  }
});
test("KO is caused only by character-to-trash battle/effect KO, never ordinary disposal", () => {
  for (const [cause, mode, expected] of [["EFFECT_KO", "effect", true], ["BATTLE_KO", "rule", true], ["EFFECT_MOVE", "effect", false], ["COST_PAYMENT", "cost", false]]) {
    const s = store([{ card: card("c1"), zone: "character" }]);
    const result = s.commit(tx(s, [move("c1", "character", "trash", { cause })], { mode }), rules);
    assert.equal(result.events[0].isKO, expected);
  }
  const s = store([{ card: card("h1"), zone: "hand" }]);
  assert.throws(() => s.commit(tx(s, [move("h1", "hand", "trash", { cause: "EFFECT_KO" })]), rules), /invalid-ko/);
});
test("prevented parent movement has no move/KO event and does not detach DON", () => {
  const s = store(parentEntries()); let checked = 0;
  const result = s.commit(tx(s, [move("c1", "character", "trash", { cause: "EFFECT_KO" })]), { status: "evaluate", check() { checked++; return { kind: "prevent" }; } });
  assert.equal(checked, 1); assert.deepEqual(result.events, []); assert.deepEqual(result.prevented, [0]);
  assert.equal(result.state.cards.c1.generation, 0); assert.deepEqual(result.state.players[0].attachedDon, ["d1", "d2"]);
});
test("missing/unresolved rule evaluation cannot silently allow a move", () => {
  const s = store([{ card: card("h1"), zone: "hand" }]), before = s.snapshot();
  for (const guard of [undefined, { status: "unresolved" }, { status: "evaluate", check() { return { kind: "defer" }; } }]) {
    assert.throws(() => s.commit(tx(s, [move("h1", "hand", "trash")]), guard)); assert.equal(s.snapshot(), before);
  }
});
test("late failure rolls back earlier rests, moves, reveals and transaction IDs", () => {
  const entries = [ { card: card("d1", "don"), zone: "activeDon" }, { card: card("h1"), zone: "hand" }, ...Array.from({ length: 5 }, (_, i) => ({ card: card(`c${i}`), zone: "character", slot: i })) ];
  const s = store(entries), before = s.snapshot();
  const request = tx(s, [{ kind: "setRest", card: ref("d1"), rotated: true }, { kind: "reveal", card: ref("h1"), scopeId: "r1", viewers: [0, 1] }, move("h1", "hand", "character")]);
  assert.throws(() => s.commit(request, rules), /no-empty/);
  assert.equal(s.snapshot(), before); assert.equal(s.snapshot().cards.d1.rotated, false); assert.deepEqual(s.snapshot().reveals, []);
  assert.equal(s.snapshot().appliedTransactions.includes(request.transactionId), false);
});
test("cost prevention aborts every operation rather than accepting partial payment", () => {
  const s = store([{ card: card("d1", "don"), zone: "activeDon" }, { card: card("h1"), zone: "hand" }]), before = s.snapshot();
  const request = tx(s, [{ kind: "setRest", card: ref("d1"), rotated: true }, move("h1", "hand", "trash", { cause: "COST_PAYMENT" })], { mode: "cost" });
  assert.throws(() => s.commit(request, { status: "evaluate", check(proposal) { return { kind: proposal.card.instanceId === "h1" ? "prevent" : "allow" }; } }), /cost-operation-prevented/);
  assert.equal(s.snapshot(), before);
});
test("a blocked automatic DON return cannot produce an orphaned attachment", () => {
  const s = store(parentEntries()), before = s.snapshot();
  assert.throws(() => s.commit(tx(s, [move("c1", "character", "hand")]), { status: "evaluate", check(proposal) { return { kind: proposal.automatic ? "prevent" : "allow" }; } }), /attached-don-return-prevented/);
  assert.equal(s.snapshot(), before);
});
test("character entry uses the leftmost empty slot, new generation and turn stamp", () => {
  const s = store([{ card: card("old0"), zone: "character", slot: 0 }, { card: card("old3"), zone: "character", slot: 3 }, { card: card("h1"), zone: "hand" }]);
  const result = s.commit(tx(s, [move("h1", "hand", "character")]), rules);
  assert.equal(result.state.players[0].character[1], "h1"); assert.equal(result.state.cards.h1.enteredTurn, 3); assert.equal(result.state.cards.h1.generation, 1);
});
test("stage replacement must be explicit and atomic, never character KO", () => {
  const s = store([{ card: card("old", "stage"), zone: "stage" }, { card: card("new", "stage"), zone: "hand" }]), before = s.snapshot();
  assert.throws(() => s.commit(tx(s, [move("new", "hand", "stage")]), rules), /empty/); assert.equal(s.snapshot(), before);
  const result = s.commit(tx(s, [move("old", "stage", "trash"), move("new", "hand", "stage")]), rules);
  assert.equal(result.state.players[0].stage[0], "new"); assert.ok(result.events.every(event => !event.isKO));
});
test("rest state changes do not create a new object or clear temporary data", () => {
  const s = store([{ card: card("d1", "don", 0, { modifierIds: ["m1"] }), zone: "activeDon" }]);
  let result = s.commit(tx(s, [{ kind: "setRest", card: ref("d1"), rotated: true }]), rules);
  assert.deepEqual(result.state.players[0].restDon, ["d1"]); assert.equal(result.state.cards.d1.generation, 0); assert.deepEqual(result.state.cards.d1.modifierIds, ["m1"]);
  assert.equal(result.events[0].kind, "restChanged"); assert.equal(result.events[0].isKO, false);
  result = s.commit(tx(s, [{ kind: "setRest", card: ref("d1"), rotated: false }]), rules);
  assert.deepEqual(result.state.players[0].activeDon, ["d1"]); assert.equal(result.state.cards.d1.generation, 0);
});
test("DON attachment and direct return to DON deck preserve parent identity", () => {
  const s = store([{ card: card("c1"), zone: "character" }, { card: card("d1", "don", 0, { grantIds: ["given"] }), zone: "activeDon" }]);
  let result = s.commit(tx(s, [{ kind: "attachDon", card: ref("d1"), target: ref("c1") }]), rules);
  assert.deepEqual(result.state.cards.d1.attachedTo, ref("c1")); assert.equal(result.state.cards.d1.generation, 1); assert.deepEqual(result.state.cards.d1.grantIds, []);
  result = s.commit(tx(s, [move("d1", "attachedDon", "donDeck", { card: ref("d1", 1) })]), rules);
  assert.equal(result.state.cards.d1.generation, 2); assert.equal(result.state.cards.d1.attachedTo, null); assert.equal(result.state.cards.c1.generation, 0);
});
test("life-to-hand normalizes face up and DAMAGE cannot select the second life", () => {
  const s = store([{ card: card("l1", "character", 0, { faceUp: false }), zone: "life" }, { card: card("l2", "character", 0, { faceUp: false }), zone: "life" }]);
  assert.throws(() => s.commit(tx(s, [move("l2", "life", "hand", { cause: "DAMAGE" })], { mode: "rule" }), rules), /top-life/);
  const result = s.commit(tx(s, [move("l1", "life", "hand", { cause: "DAMAGE", to: to("hand", 0, { faceUp: false }) })], { mode: "rule" }), rules);
  assert.equal(result.state.cards.l1.faceUp, true); assert.equal(result.state.cards.l1.rotated, false);
  assert.equal(projectMovementState(result.state, 1).players[0].hand[0].cardId, null);
});
test("independent costs reserve implicit DON returns in either operation order", () => {
  for (const reverse of [false, true]) {
    const s = store(parentEntries()), before = s.snapshot();
    let operations = [move("c1", "character", "trash", { cause: "COST_PAYMENT" }), move("d1", "attachedDon", "donDeck", { cause: "COST_PAYMENT" })];
    if (reverse) operations = operations.reverse();
    assert.throws(() => s.commit(tx(s, operations, { mode: "cost" }), rules), /cost-resource-overlap/); assert.equal(s.snapshot(), before);
  }
});
test("cost duplicate use, activation instead of rest and private reveal cannot pay", () => {
  const s = store([{ card: card("d1", "don"), zone: "activeDon" }, { card: card("h1"), zone: "hand" }]);
  assert.throws(() => s.commit(tx(s, [{ kind: "setRest", card: ref("d1"), rotated: true }, { kind: "setRest", card: ref("d1"), rotated: true }], { mode: "cost" }), rules), /overlap/);
  assert.throws(() => s.commit(tx(s, [{ kind: "setRest", card: ref("d1"), rotated: false }], { mode: "cost" }), rules), /activate/);
  assert.throws(() => s.commit(tx(s, [{ kind: "reveal", card: ref("h1"), scopeId: "r1", viewers: [0] }], { mode: "cost" }), rules), /public/);
  const result = s.commit(tx(s, [{ kind: "reveal", card: ref("h1"), scopeId: "r1", viewers: [0, 1] }], { mode: "cost" }), rules);
  assert.equal(result.state.cards.h1.generation, 0); assert.equal(result.state.players[0].hand[0], "h1"); assert.equal(projectMovementState(result.state, 1).players[0].hand[0].cardId, "TEST-h1");
});
test("transaction ID, revision and source generation prevent replay and stale operations", () => {
  const s = store([{ card: card("h1"), zone: "hand" }]), request = tx(s, [move("h1", "hand", "trash")]);
  s.commit(request, rules);
  assert.throws(() => s.commit(request, rules), /stale/);
  assert.throws(() => s.commit({ ...request, expectedRevision: 1 }, rules), /duplicate/);
  assert.throws(() => s.commit(tx(s, [move("h1", "trash", "hand")]), rules), /stale-or-missing-card/);
  assert.equal(s.snapshot().revision, 1);
});
test("rule callbacks cannot reenter a store or modify the current draft snapshot", () => {
  const s = store([{ card: card("h1"), zone: "hand" }]); let checked = false;
  const result = s.commit(tx(s, [move("h1", "hand", "trash")]), { status: "evaluate", check(_proposal, snapshot) {
    assert.equal(Object.isFrozen(snapshot.cards.h1), true); assert.throws(() => snapshot.players[0].hand.push("fake"));
    assert.throws(() => s.commit(tx(s, []), rules), /reentrant/); checked = true; return { kind: "allow" };
  } });
  assert.equal(checked, true); assert.equal(result.state.revision, 1);
});
test("public projection hides all hidden object IDs, generations and internal ledgers", () => {
  const s = store([{ card: card("h1"), zone: "hand" }, { card: card("secret", "character", 0, { faceUp: false }), zone: "deck" }]);
  const view = projectMovementState(s.snapshot(), 1), json = JSON.stringify(view);
  assert.equal(view.players[0].hand[0].ref, null); assert.equal(view.players[0].deck[0].cardId, null);
  assert.equal(json.includes("TEST-secret"), false); assert.equal(json.includes("appliedTransactions"), false);
  assert.equal(projectMovementState(s.snapshot(), 0).players[0].hand[0].cardId, "TEST-h1");
  assert.throws(() => JSON.stringify(s), /server-only/);
});
test("temporary reveal is viewer-scoped, expires and is invalidated by movement", () => {
  const s = store([{ card: card("secret", "character", 0, { faceUp: false }), zone: "deck" }]);
  let result = s.commit(tx(s, [{ kind: "reveal", card: ref("secret"), scopeId: "peek", viewers: [0] }]), rules);
  assert.equal(projectMovementState(result.state, 0).players[0].deck[0].cardId, "TEST-secret");
  assert.equal(projectMovementState(result.state, 1).players[0].deck[0].cardId, null);
  assert.deepEqual(projectMovementEvents(result, 1), []);
  result = s.commit(tx(s, [{ kind: "closeReveals", scopeId: "peek" }]), rules);
  assert.equal(projectMovementState(result.state, 0).players[0].deck[0].cardId, null);
  s.commit(tx(s, [{ kind: "reveal", card: ref("secret"), scopeId: "peek", viewers: [1] }]), rules);
  result = s.commit(tx(s, [move("secret", "deck", "hand")]), rules);
  assert.deepEqual(result.state.reveals, []); assert.equal(projectMovementState(result.state, 1).players[0].hand[0].cardId, null);
});
test("reorder preserves generations and emits no movement/KO event", () => {
  const s = store([{ card: card("d0", "character", 0, { faceUp: false }), zone: "deck" }, { card: card("d1", "character", 0, { faceUp: false }), zone: "deck" }]);
  s.commit(tx(s, [{ kind: "reveal", card: ref("d0"), scopeId: "peek", viewers: [0] }]), rules);
  const result = s.commit(tx(s, [{ kind: "reorder", location: at("deck"), cards: [ref("d1"), ref("d0")], conceal: true }]), rules);
  assert.deepEqual(result.state.players[0].deck, ["d1", "d0"]); assert.equal(result.state.cards.d0.generation, 0); assert.deepEqual(result.state.reveals, []);
  assert.equal(result.events[0].kind, "reordered"); assert.equal(result.events[0].isKO, false);
  assert.throws(() => s.commit(tx(s, [{ kind: "reorder", location: at("deck"), cards: [ref("d1"), ref("d1")], conceal: true }]), rules));
});
test("provenance is retained internally without leaking private source data in logs", () => {
  const s = store(parentEntries());
  const result = s.commit(tx(s, [move("c1", "character", "trash")], { actor: 0, effectController: 1, source: ref("leader1") }), rules);
  assert.equal(result.events[0].cause.effectController, 1); assert.deepEqual(result.events[0].cause.source, ref("leader1"));
  assert.equal(result.events[1].cause.kind, "RULE_PROCESSING"); assert.equal(result.events[1].cause.parentEventId, result.events[0].eventId);
  const projected = projectMovementEvents(result, 0);
  assert.deepEqual(Object.keys(projected[0].cause).sort(), ["actor", "kind"]);
  assert.equal(JSON.stringify(projected).includes("modifierIds"), false);
});
test("unknown off-field transient state and invalid source/destination fail closed", () => {
  const s = store([{ card: card("h1", "character", 0, { modifierIds: ["unknown-lifetime"] }), zone: "hand" }]);
  assert.throws(() => s.commit(tx(s, [move("h1", "hand", "trash")]), rules), /transient/);
  const plain = store([{ card: card("h1"), zone: "hand" }]);
  assert.throws(() => plain.commit(tx(plain, [move("h1", "trash", "hand")]), rules), /expected-source/);
  assert.throws(() => plain.commit(tx(plain, [move("h1", "hand", "deck", { to: to("deck", 0, { faceUp: true }) })]), rules), /facedown/);
  assert.throws(() => plain.commit(tx(plain, [move("h1", "hand", "trash", { cause: "COST_PAYMENT" })]), rules), /cause/);
  assert.throws(() => plain.commit(tx(plain, [{ kind: "notImplemented" }]), rules), /unknown-movement/);
});
test("state validation rejects duplicate cards, invalid attachments and stale generations", () => {
  const original = state([{ card: card("c1"), zone: "character" }]);
  const duplicate = structuredClone(original); duplicate.players[0].hand.push("c1"); assert.throws(() => validateMovementState(duplicate), /duplicate/);
  const stale = structuredClone(original); stale.cards.c1.generation = 2; assert.throws(() => getCard(stale, ref("c1")), /stale/);
  assert.throws(() => store([{ card: card("d1", "don", 0, { attachedTo: ref("missing") }), zone: "attachedDon" }]));
});
test("host and guest exits return DON to their actual owner's area", () => {
  for (const actor of [0, 1]) {
    const s = store([{ card: card("c1", "character", actor), zone: "character" }, { card: card("d1", "don", actor, { attachedTo: ref("c1") }), zone: "attachedDon" }]);
    const operation = move("c1", "character", "life", { from: at("character", actor), to: to("life", actor) });
    const result = s.commit(tx(s, [operation], { actor, effectController: actor, source: ref(`leader${actor}`) }), rules);
    assert.deepEqual(result.state.players[actor].restDon, ["d1"]); assert.deepEqual(result.state.players[1 - actor].restDon, []);
  }
});
test("oversized, cyclic, accessor and unknown-field inputs fail before cloning", () => {
  const s = store([{ card: card("h1"), zone: "hand" }]), before = s.snapshot();
  const cyclic = tx(s, []); cyclic.extra = cyclic; assert.throws(() => s.commit(cyclic, rules), /unknown-data-field/);
  const accessor = tx(s, []); Object.defineProperty(accessor, "source", { enumerable: true, get() { throw new Error("must not run getter"); } });
  assert.throws(() => s.commit(accessor, rules), /accessors/);
  assert.throws(() => s.commit(tx(s, [{ kind: "reorder", location: at("hand"), cards: Array.from({ length: 257 }, () => ref("h1")), conceal: true }]), rules), /invalid-data-array/);
  const bad = structuredClone(before); Object.defineProperty(bad.cards.h1, "owner", { enumerable: true, get() { throw new Error("must not run getter"); } });
  assert.throws(() => new MovementStore(bad), /accessors/); assert.equal(s.snapshot(), before);
});
test("generation and transaction-ledger limits stop instead of wrapping or forgetting IDs", () => {
  const s = store([{ card: card("h1", "character", 0, { generation: Number.MAX_SAFE_INTEGER }), zone: "hand" }]);
  assert.throws(() => s.commit(tx(s, [move("h1", "hand", "trash", { card: ref("h1", Number.MAX_SAFE_INTEGER) })]), rules), /generation-limit/);
  const full = structuredClone(state()); full.appliedTransactions = Array.from({ length: 4096 }, (_, i) => `old-${i}`); full.revision = 4096;
  const limited = new MovementStore(full); assert.throws(() => limited.commit(tx(limited, []), rules), /transaction-limit/);
});
test("public logs and DON positions cannot reveal a chosen hidden deck order", () => {
  const entries = [
    { card: card("a"), zone: "character", slot: 0 }, { card: card("b"), zone: "character", slot: 1 },
    { card: card("da", "don", 0, { attachedTo: ref("a") }), zone: "attachedDon" },
    { card: card("db", "don", 0, { attachedTo: ref("b") }), zone: "attachedDon" },
  ];
  const a = store(entries), b = store(entries);
  const forward = a.commit(tx(a, [move("a", "character", "deck"), move("b", "character", "deck")]), rules);
  const backward = b.commit(tx(b, [move("b", "character", "deck"), move("a", "character", "deck")]), rules);
  assert.notDeepEqual(forward.state.players[0].deck, backward.state.players[0].deck);
  assert.deepEqual(projectMovementState(forward.state, 1), projectMovementState(backward.state, 1));
  assert.deepEqual(projectMovementEvents(forward, 1), projectMovementEvents(backward, 1));
  const hidden = projectMovementEvents(forward, 1).find(event => event.to?.zone === "deck");
  assert.equal(hidden.cardId, null); assert.equal(hidden.from, null); assert.equal(hidden.count, 2);
});
