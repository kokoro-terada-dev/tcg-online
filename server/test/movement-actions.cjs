const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PreparedMovementEffect } = require('../dist/test/effects/movementActions.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const { projectMovementState } = require('../dist/test/movement/projection.js');
const rules = { status: 'certifiedNone' };
const draw = (saveAs = 'drawn') => ({ kind: 'draw', player: 'SELF', amount: 1, saveAs });
const move = (name = 'drawn') => ({ kind: 'move', cards: { kind: 'ref', from: 'VARIABLE', name },
  destination: { owner: 'SELF', zone: 'trash', position: 'append', visibility: 'faceUp' }, cause: 'EFFECT_MOVE', saveAs: 'moved' });
function fixture(actor = 0, count = 3) {
  const players = [emptyZones(), emptyZones()], cards = {};
  function card(id, kind, faceUp) { return { instanceId: id, generation: 0, cardId: id === 'leader' ? 'TEST' : id,
    kind, owner: actor, controller: actor, faceUp, rotated: false, attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null }; }
  players[actor].leader[0] = 'leader'; cards.leader = card('leader', 'leader', true);
  for (let i = 0; i < count; i++) { const id = `card${i}`; cards[id] = card(id, 'character', false); players[actor].deck.push(id); }
  return createMovementState({ matchId: 'match', turnNumber: 1, players, cards });
}
function runtime(actions, actor = 0, count = 3, patch = {}) {
  return new PreparedMovementEffect(fixture(actor, count), { resolutionId: 'r1', actor, source: { instanceId: 'leader', generation: 0 } },
    { dslVersion: 1, effectId: 'test', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs: [], actions, ...patch });
}
test('validated DSL draws then moves the new-generation reference for both seats', () => {
  for (const actor of [0, 1]) {
    const r = runtime([draw(), move()], actor);
    r.start(0, rules); r.advance(1, rules);
    assert.deepEqual(r.snapshot().players[actor].hand, ['card0']);
    assert.equal(r.snapshot().cards.card0.generation, 1);
    const view = projectMovementState(r.snapshot(), 1 - actor);
    assert.equal(view.players[actor].hand[0].cardId, null);
    r.advance(2, rules);
    assert.deepEqual(r.snapshot().players[actor].trash, ['card0']);
    assert.equal(r.snapshot().cards.card0.generation, 2);
    assert.equal(r.view().status, 'completed');
    assert.throws(() => r.advance(3, rules));
  }
});
test('sequence shares bindings, repeat creates separate iteration scopes', () => {
  const r = runtime([{ kind: 'sequence', actions: [{ kind: 'repeat', count: 2, actions: [draw(), move()] }, draw('last')] }]);
  r.start(0, rules);
  for (let i = 1; i <= 5; i++) r.advance(i, rules);
  assert.deepEqual(r.snapshot().players[0].trash, ['card0', 'card1']);
  assert.deepEqual(r.snapshot().players[0].hand, ['card2']);
  assert.equal(r.view().status, 'completed');
});
test('unsupported actions, costs, and conditions fail before any execution', () => {
  assert.throws(() => runtime([{ kind: 'optional', player: 'SELF', actions: [draw()] }]), /unsupported/);
  assert.throws(() => runtime([], 0, 3, { costs: [{ kind: 'payDon', amount: 1 }] }), /not-supported/);
  assert.throws(() => runtime([], 0, 3, { condition: { kind: 'exists', value: { kind: 'literal', value: 1 } } }), /not-supported/);
  assert.throws(() => runtime([{ kind: 'repeat', count: 0, actions: [{ kind: 'optional', player: 'SELF', actions: [] }] }]), /unsupported/);
});
test('empty deck blocks without partial draw and never invents a game result', () => {
  const r = runtime([{ ...draw(), amount: 2 }], 0, 1); r.start(0, rules);
  const before = r.snapshot();
  assert.throws(() => r.advance(1, rules), /draw-unavailable/);
  assert.equal(r.snapshot(), before);
  assert.equal(r.view().status, 'blocked');
  assert.throws(() => r.advance(1, rules));
});
test('prevented draws bind only cards actually moved', () => {
  const r = runtime([draw(), move()]); r.start(0, rules);
  r.advance(1, { status: 'evaluate', check: () => ({ kind: 'prevent' }) });
  r.advance(2, rules);
  assert.equal(r.snapshot().players[0].deck.length, 3);
  assert.deepEqual(r.snapshot().players[0].trash, []);
});
test('stale replay does not consume the next instruction', () => {
  const r = runtime([draw(), move()]); r.start(0, rules); r.advance(1, rules);
  assert.throws(() => r.advance(1, rules), /not-current/);
  assert.equal(r.view().status, 'resolving');
  r.advance(2, rules);
  assert.equal(r.view().status, 'completed');
});
test('preflight enforces source identity and bounded expanded instruction count', () => {
  assert.throws(() => runtime([], 0, 3, { cardId: 'OTHER' }), /source-mismatch/);
  assert.throws(() => runtime([{ kind: 'repeat', count: 20, actions: [{ kind: 'repeat', count: 10, actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] }] }]), /step-limit/);
});
test('input is detached and private execution objects cannot be serialized', () => {
  const action = draw(); const r = runtime([action]); action.amount = 100;
  r.start(0, rules); r.advance(1, rules);
  assert.equal(r.snapshot().players[0].hand.length, 1);
  assert.throws(() => JSON.stringify(r), /server-only/);
});
test('reentrant callbacks cannot skip instructions or run the executor twice', () => {
  const r = runtime([draw()]); r.start(0, rules);
  r.advance(1, { status: 'evaluate', check() {
    assert.throws(() => r.advance(1, rules), /reentrant/);
    assert.throws(() => r.start(1, rules), /reentrant/);
    return { kind: 'allow' };
  } });
  assert.equal(r.snapshot().players[0].hand.length, 1);
});
test('later failure retains earlier committed actions and blocks the interpreter', () => {
  const r = runtime([draw(), { kind: 'draw', player: 'SELF', amount: 10 }]);
  r.start(0, rules); r.advance(1, rules);
  const committed = r.snapshot();
  assert.throws(() => r.advance(2, rules), /draw-unavailable/);
  assert.equal(r.snapshot(), committed);
  assert.equal(r.snapshot().players[0].hand.length, 1);
  assert.equal(r.view().status, 'blocked');
});
test('empty supported programs finish and zero repeats do not execute', () => {
  const r = runtime([{ kind: 'repeat', count: 0, actions: [draw()] }]);
  r.start(0, rules);
  assert.equal(r.view().status, 'completed');
  assert.equal(r.snapshot().players[0].deck.length, 3);
});
test('multiple-card top insertion order is not guessed', () => {
  const m = move(); m.destination = { owner: 'SELF', zone: 'deck', position: 'top', visibility: 'faceDown' };
  const r = runtime([{ ...draw(), amount: 2 }, m]); r.start(0, rules); r.advance(1, rules);
  assert.throws(() => r.advance(2, rules), /top-order-not-supported/);
  assert.equal(r.snapshot().players[0].hand.length, 2);
  assert.equal(r.view().status, 'blocked');
});
