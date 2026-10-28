const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMaster } = require('../dist/test/cardMaster.js');
const { PreparedMovementEffect } = require('../dist/test/effects/movementActions.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const { pinMasterFacts } = require('../dist/test/effects/masterFacts.js');
const { movementSelectionSnapshot, movementSourceFacts } = require('../dist/test/effects/movementSelection.js');
const { resolveValue } = require('../dist/test/effects/facts.js');
const rules = { status: 'certifiedNone' };
function state(actor = 0, patch = {}, attached = false) {
  const players = [emptyZones(), emptyZones()], cards = {};
  for (const [instanceId, cardId, kind, zone] of [['leader', 'L', 'leader', 'leader'], ['a', 'A', 'character', 'character'], ['b', 'B', 'character', 'character'], ['deck', 'D', 'character', 'deck']]) {
    cards[instanceId] = { instanceId, generation: 0, cardId, kind, owner: actor, controller: actor, faceUp: zone !== 'deck', rotated: false,
      attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null, ...(instanceId === 'a' ? patch : {}) };
    if (zone === 'leader') players[actor].leader[0] = instanceId;
    else if (zone === 'character') players[actor].character[instanceId === 'a' ? 0 : 1] = instanceId;
    else players[actor].deck.push(instanceId);
  }
  if (attached) {
    cards.don = { instanceId: 'don', generation: 0, cardId: 'DON', kind: 'don', owner: actor, controller: actor, faceUp: true, rotated: false,
      attachedTo: { instanceId: 'a', generation: 0 }, modifierIds: [], grantIds: [], enteredTurn: null };
    players[actor].attachedDon.push('don');
  }
  return createMovementState({ matchId: 'm', turnNumber: 1, players, cards });
}
function master(a = {}, b = {}) {
  return parseMaster(JSON.stringify({ schemaVersion: 2, cards: {
    L: { type: 'leader', name: 'Leader', cost: 0, power: 5000 },
    A: { type: 'character', name: 'テスト', cost: 3, power: 4000, attributes: ['斬', '特'], traits: ['麦わらの一味', 'B・W'], colors: ['red'], ...a },
    B: { type: 'character', name: 'Other', cost: 7, power: 7000, ...b }
  } }));
}
const condition = (field, value, operator = 'LTE', from = 'TARGET') => ({ kind: 'compare', operator, left: { kind: 'ref', from, field }, right: { kind: 'literal', value } });
const select = predicate => ({ kind: 'select', saveAs: 'chosen', selector: { kind: 'cards', owner: 'SELF', chooser: 'SELF', zones: ['character'], min: 0, max: 2, mode: 'SELECT', condition: predicate } });
function runtime(actions, m = master(), actor = 0, patch = {}, attached = false, numericPolicy = 'certifiedUnmodified') {
  return new PreparedMovementEffect(state(actor, patch, attached), { resolutionId: 'r', actor, source: { instanceId: 'leader', generation: 0 } },
    { dslVersion: 1, effectId: 'e', cardId: 'L', trigger: { kind: 'activate', window: 'main' }, costs: [], actions }, { master: m, numericPolicy });
}
function candidates(r) { r.start(0, rules); r.advance(1, rules); return r.selectionViewFor(r.view().actor).candidates; }
test('cost/power conditions use pinned master values for both actors', () => {
  for (const actor of [0, 1]) for (const [field, threshold] of [['cost', 3], ['power', 5000]]) {
    const r = runtime([select(condition(field, threshold))], master(), actor);
    assert.deepEqual(candidates(r).map(c => c.cardId), ['A']);
    assert.equal(r.view().masterVersion, master().version);
  }
});
test('Japanese attributes, mixed-script traits, names and colors remain exact', () => {
  for (const [field, value, operator] of [['attributes', '斬', 'CONTAINS'], ['traits', 'B・W', 'CONTAINS'], ['name', 'テスト', 'EQ'], ['colors', 'red', 'CONTAINS']]) {
    const r = runtime([select(condition(field, value, operator))], master({}, { attributes: [], traits: [], colors: [] }));
    assert.deepEqual(candidates(r).map(c => c.cardId), ['A']);
  }
});
test('missing master, card ID, null and omitted numeric values stay unknown', () => {
  for (const m of [null, parseMaster(JSON.stringify({ cards: { L: { type: 'leader' } } })), master({ cost: null }), master({ cost: undefined })]) {
    const r = runtime([select(condition('cost', 3))], m); r.start(0, rules);
    assert.throws(() => r.advance(1, rules), /selection-data-unavailable/);
    assert.equal(r.view().status, 'blocked');
  }
});
test('zero cost and zero power are known, not missing', () => {
  for (const field of ['cost', 'power']) {
    const r = runtime([select(condition(field, 0, 'EQ'))], master({ [field]: 0 }));
    assert.deepEqual(candidates(r).map(c => c.cardId), ['A']);
  }
});
test('omitted list differs from an explicitly empty list', () => {
  const missing = runtime([select(condition('traits', 'B・W', 'CONTAINS'))], master()); missing.start(0, rules);
  assert.throws(() => missing.advance(1, rules), /selection-data-unavailable/);
  const empty = runtime([select(condition('traits', 'B・W', 'CONTAINS'))], master({}, { traits: [] }));
  assert.deepEqual(candidates(empty).map(c => c.cardId), ['A']);
  assert.equal(Object.isFrozen(master().factPresence.A), true);
});
test('legacy manually-created snapshots without presence metadata fail closed for lists', () => {
  const m = { ...master() }; delete m.factPresence;
  const r = runtime([select(condition('traits', 'B・W', 'CONTAINS'))], m); r.start(0, rules);
  assert.throws(() => r.advance(1, rules), /selection-data-unavailable/);
});
test('numeric policy defaults to unresolved; a caller cannot silently use printed power', () => {
  const s = state(), pinned = pinMasterFacts(s, { master: master() });
  const snap = movementSelectionSnapshot(s, 0, {}, pinned);
  const facts = snap.cards.find(c => c.instanceId === 'a').facts;
  assert.equal(facts.power, undefined); assert.equal(facts.cost, undefined); assert.equal(facts.name, 'テスト');
  assert.throws(() => pinMasterFacts(s, { master: master(), numericPolicy: 'anything' }), /numeric-policy/);
});
test('modifier/grant references prevent treating base values as effective values', () => {
  for (const patch of [{ modifierIds: ['power-effect'] }, { grantIds: ['ongoing-effect'] }]) {
    for (const field of ['cost', 'power']) {
      const r = runtime([select(condition(field, 5000))], master(), 0, patch); r.start(0, rules);
      assert.throws(() => r.advance(1, rules), /selection-data-unavailable/);
    }
  }
});
test('attached DON leaves current power unknown but does not erase printed cost', () => {
  const p = runtime([select(condition('power', 5000))], master(), 0, {}, true); p.start(0, rules);
  assert.throws(() => p.advance(1, rules), /selection-data-unavailable/);
  const c = runtime([select(condition('cost', 3))], master(), 0, {}, true);
  assert.deepEqual(candidates(c).map(c => c.cardId), ['A']);
});
test('master kind conflicts are rejected before any payment or move', () => {
  assert.throws(() => runtime([], master({ type: 'event' })), /kind-mismatch/);
});
test('master input is detached and pinned, including list values and version', () => {
  const m = structuredClone(master({}, { traits: [] }));
  const r = runtime([select(condition('traits', 'B・W', 'CONTAINS'))], m);
  const version = m.version; m.version = 'changed'; m.cards.A.traits.length = 0; m.cards.A.cost = 100;
  assert.deepEqual(candidates(r).map(c => c.cardId), ['A']);
  assert.equal(r.view().masterVersion, version);
  assert.equal(r.selectionViewFor(1), null);
  assert.equal(JSON.stringify(r.view()).includes('麦わら'), false);
});
test('source conditions see metadata without confusing printed IDs and instance IDs', () => {
  const r = runtime([{ kind: 'if', condition: condition('power', 5000, 'EQ', 'SOURCE'), then: [{ kind: 'draw', player: 'SELF', amount: 1 }], else: [] }]);
  r.start(0, rules); r.advance(1, rules); r.advance(2, rules);
  assert.equal(r.snapshot().players[0].hand.length, 1);
  const s = state(), pinned = pinMasterFacts(s, { master: master(), numericPolicy: 'certifiedUnmodified' });
  assert.equal(movementSourceFacts(s, { instanceId: 'leader', generation: 0 }, pinned).id, 'leader');
});
test('effect links are not fabricated into keyword abilities', () => {
  const s = state(), pinned = pinMasterFacts(s, { master: master(), numericPolicy: 'certifiedUnmodified' });
  const snap = movementSelectionSnapshot(s, 0, {}, pinned);
  const result = resolveValue({ kind: 'ref', from: 'TARGET', field: 'abilities' }, { target: snap.cards.find(c => c.instanceId === 'a').facts });
  assert.equal(result.state, 'unknown');
});
