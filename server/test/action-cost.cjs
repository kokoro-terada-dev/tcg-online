const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PreparedMovementEffect } = require('../dist/test/effects/movementActions.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const rules = { status: 'certifiedNone' };
const pay = amount => ({ kind: 'payDon', amount });
const draw = { kind: 'draw', player: 'SELF', amount: 1 };
function initial(actor = 0, active = 4, wrongController = false) {
  const players = [emptyZones(), emptyZones()], cards = {};
  function add(id, kind, owner, zone, patch = {}) {
    cards[id] = { instanceId: id, generation: 0, cardId: kind === 'leader' ? 'TEST' : id, kind,
      owner, controller: owner, faceUp: zone !== 'deck', rotated: zone === 'restDon', attachedTo: null,
      modifierIds: [], grantIds: [], enteredTurn: null, ...patch };
    if (zone === 'leader') players[owner].leader[0] = id; else players[owner][zone].push(id);
  }
  add('leader', 'leader', actor, 'leader'); add('deck-card', 'character', actor, 'deck');
  for (let i = 0; i < active; i++) add(`don${i}`, 'don', actor, 'activeDon', wrongController && i === 0 ? { controller: 1 - actor } : {});
  add('rested', 'don', actor, 'restDon');
  add('attached', 'don', actor, 'attachedDon', { attachedTo: { instanceId: 'leader', generation: 0 } });
  for (let i = 0; i < 3; i++) add(`opponent${i}`, 'don', 1 - actor, 'activeDon');
  return createMovementState({ matchId: 'm', turnNumber: 1, players, cards });
}
function runtime(costs = [pay(2)], actions = [draw], actor = 0, active = 4, wrongController = false) {
  return new PreparedMovementEffect(initial(actor, active, wrongController), { resolutionId: 'r', actor, source: { instanceId: 'leader', generation: 0 } },
    { dslVersion: 1, effectId: 'e', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs, actions });
}
test('multiple DON costs pay unique own active resources atomically for either actor', () => {
  for (const actor of [0, 1]) {
    const r = runtime([pay(2), pay(1)], [draw], actor);
    const receipt = r.start(0, rules);
    assert.deepEqual(r.snapshot().players[actor].activeDon, ['don3']);
    assert.deepEqual(r.snapshot().players[actor].restDon, ['rested', 'don0', 'don1', 'don2']);
    assert.equal(new Set(receipt.events.map(e => e.after.instanceId)).size, 3);
    assert.equal(receipt.events.every(e => e.cause.kind === 'COST_PAYMENT' && e.cause.actor === actor && e.cause.resolutionId === 'r'), true);
    assert.equal(r.snapshot().cards.don0.generation, 0);
    assert.equal(r.snapshot().players[1 - actor].activeDon.length, 3);
    assert.deepEqual(r.snapshot().players[actor].attachedDon, ['attached']);
    r.advance(1, rules); assert.equal(r.snapshot().players[actor].hand.length, 1);
    assert.equal(r.view().status, 'completed');
  }
});
test('insufficient combined costs do not partially pay or begin effects', () => {
  const r = runtime([pay(2), pay(2)], [draw], 0, 3), before = r.snapshot();
  assert.throws(() => r.start(0, rules), /don-cost-unavailable/);
  assert.equal(r.snapshot(), before); assert.equal(r.view().status, 'prepared');
  assert.equal(r.snapshot().players[0].hand.length, 0);
  assert.throws(() => r.advance(0, rules), /not-current/);
});
test('rested, attached and opponent DON never substitute for missing active DON', () => {
  for (const actor of [0, 1]) {
    const r = runtime([pay(1)], [draw], actor, 0); const before = r.snapshot();
    assert.throws(() => r.start(0, rules), /don-cost-unavailable/);
    assert.equal(r.snapshot(), before);
  }
});
test('a malformed DON controller is rejected at the authoritative state boundary', () => {
  assert.throws(() => runtime([pay(2)], [], 0, 3, true), /invalid-off-field-owner/);
});
test('prevention of a later DON cost rolls back all payment and can be corrected', () => {
  const r = runtime([pay(1), pay(1)]), before = r.snapshot();
  assert.throws(() => r.start(0, { status: 'evaluate', check: proposal => ({ kind: proposal.operationIndex === 1 ? 'prevent' : 'allow' }) }));
  assert.equal(r.snapshot(), before); assert.equal(r.view().status, 'prepared');
  r.start(0, rules);
  assert.deepEqual(r.snapshot().players[0].activeDon, ['don2', 'don3']);
});
test('deferred or unresolved rules never consume a payment', () => {
  for (const blocked of [{ status: 'unresolved' }, { status: 'evaluate', check: () => ({ kind: 'defer' }) }]) {
    const r = runtime(), before = r.snapshot();
    assert.throws(() => r.start(0, blocked));
    assert.equal(r.snapshot(), before); assert.equal(r.view().status, 'prepared');
  }
});
test('duplicate and stale starts cannot charge DON twice', () => {
  const r = runtime(); const before = r.snapshot();
  assert.throws(() => r.start(100, rules), /not-prepared-or-current/);
  assert.equal(r.snapshot(), before); r.start(0, rules);
  const paid = r.snapshot();
  assert.throws(() => r.start(0, rules), /not-prepared-or-current/);
  assert.throws(() => r.start(1, rules), /not-prepared-or-current/);
  assert.equal(r.snapshot(), paid);
});
test('later effect failure retains committed payment instead of refunding or charging again', () => {
  const r = runtime([pay(2)], [{ ...draw, amount: 2 }]); r.start(0, rules); const paid = r.snapshot();
  assert.throws(() => r.advance(1, rules), /draw-unavailable/);
  assert.equal(r.snapshot(), paid); assert.equal(r.view().status, 'blocked');
  assert.equal(r.snapshot().players[0].activeDon.length, 2);
  assert.throws(() => r.start(1, rules));
});
test('pending target selection and invalid replies do not repeat payment', () => {
  const r = runtime([pay(2)], [{ kind: 'select', saveAs: 'option', selector: { kind: 'choice', chooser: 'SELF', options: [{ id: 'yes', label: 'Yes' }] } }]);
  r.start(0, rules); r.advance(1, rules); const view = r.selectionViewFor(0);
  const reply = { matchId: view.matchId, resolutionId: view.resolutionId, selectionId: view.selectionId, revision: view.revision, tokens: [view.options[0].token] };
  assert.throws(() => r.answerSelection(1, reply, rules));
  assert.equal(r.snapshot().players[0].activeDon.length, 2);
  r.answerSelection(0, reply, rules);
  assert.equal(r.view().status, 'completed');
  assert.equal(r.snapshot().players[0].activeDon.length, 2);
});
test('declining an optional child is not cancellation of an already paid activation', () => {
  const r = runtime([pay(2)], [{ kind: 'optional', player: 'SELF', actions: [draw] }]); r.start(0, rules); r.advance(1, rules);
  const view = r.selectionViewFor(0);
  r.answerSelection(0, { matchId: view.matchId, resolutionId: view.resolutionId, selectionId: view.selectionId, revision: view.revision, tokens: [view.options[1].token] }, rules);
  assert.equal(r.view().status, 'completed'); assert.equal(r.snapshot().players[0].hand.length, 0);
  assert.equal(r.snapshot().players[0].activeDon.length, 2);
});
test('reentrant rule callbacks cannot double charge or begin an effect', () => {
  const r = runtime();
  r.start(0, { status: 'evaluate', check() {
    assert.throws(() => r.start(0, rules), /reentrant/);
    assert.throws(() => r.advance(0, rules), /reentrant/);
    return { kind: 'allow' };
  } });
  assert.equal(r.snapshot().players[0].activeDon.length, 2);
});
test('cost and operation bounds are rejected before starting', () => {
  assert.throws(() => runtime(Array.from({ length: 17 }, () => pay(1))), /cost-count-limit/);
  assert.throws(() => runtime([pay(65)]), /cost-operation-limit/);
  assert.throws(() => runtime([pay(0)]));
});
test('empty effects can complete after payment; input definitions remain detached', () => {
  const cost = pay(1), r = runtime([cost], []); cost.amount = 4;
  r.start(0, rules);
  assert.equal(r.view().status, 'completed'); assert.equal(r.snapshot().players[0].activeDon.length, 3);
});
