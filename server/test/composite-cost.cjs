const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PreparedMovementEffect } = require('../dist/test/effects/movementActions.js');
const { TimedMovementEffect } = require('../dist/test/effects/timedMovement.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const rules = { status: 'certifiedNone' };
const sel = (zones, extra = {}) => ({ kind: 'cards', chooser: 'SELF', owner: 'SELF', zones, min: 1, max: 1, mode: 'SELECT', ...extra });
const discard = (saveAs = 'discarded') => ({ kind: 'moveCards', selector: sel(['hand']), destination: { owner: 'SELF', zone: 'trash', position: 'append', visibility: 'faceUp' }, saveAs });
const rest = zones => ({ kind: 'restCards', selector: sel(zones) });
const pay = amount => ({ kind: 'payDon', amount });
function initial(actor = 0) {
  const players = [emptyZones(), emptyZones()], cards = {};
  for (const [id, kind, zone] of [['leader', 'leader', 'leader'], ['h1', 'character', 'hand'], ['h2', 'character', 'hand'], ['c', 'character', 'character'], ['d1', 'don', 'activeDon'], ['d2', 'don', 'activeDon'], ['attached', 'don', 'attachedDon']]) {
    cards[id] = { instanceId: id, generation: 0, cardId: id === 'leader' ? 'TEST' : id, kind,
      owner: actor, controller: actor, rotated: false, faceUp: true, attachedTo: id === 'attached' ? { instanceId: 'c', generation: 0 } : null,
      modifierIds: [], grantIds: [], enteredTurn: null };
    if (zone === 'leader') players[actor].leader[0] = id; else if (zone === 'character') players[actor].character[0] = id; else players[actor][zone].push(id);
  }
  return createMovementState({ matchId: 'm', turnNumber: 1, players, cards });
}
function definition(costs, actions = []) { return { dslVersion: 1, effectId: 'e', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs, actions }; }
function runtime(costs = [pay(1), discard(), rest(['character'])], actions = [], actor = 0, resolutionId = 'r') {
  return new PreparedMovementEffect(initial(actor), { resolutionId, actor, source: { instanceId: 'leader', generation: 0 } }, definition(costs, actions));
}
function reply(session, actor = 0, cardId) {
  const view = session.viewFor(actor);
  const candidate = cardId ? view.candidates.find(c => c.cardId === cardId) : view.candidates[0];
  return { matchId: view.matchId, resolutionId: view.resolutionId, selectionId: view.selectionId, revision: view.revision, tokens: [candidate.token] };
}
function ready(session, actor = 0) { while (session.view().status === 'selecting') assert.equal(session.answer(actor, reply(session, actor)), true); return session; }
test('DON, discard and rest are selected without mutation, then paid in one transaction for both seats', () => {
  for (const actor of [0, 1]) {
    const r = runtime(undefined, [], actor), before = r.snapshot(), session = r.createCostSession(0);
    assert.equal(session.viewFor(1 - actor), null);
    ready(session, actor); assert.equal(r.snapshot(), before); assert.equal(r.view().status, 'prepared');
    const receipt = r.start(0, rules, session);
    assert.equal(receipt.state.revision, 1); assert.equal(session.view().status, 'consumed');
    assert.deepEqual(r.snapshot().players[actor].trash, ['h1']);
    assert.equal(r.snapshot().cards.c.rotated, true); assert.equal(r.snapshot().players[actor].activeDon.length, 1);
    assert.equal(receipt.events.every(e => e.cause.kind === 'COST_PAYMENT' && !e.isKO), true);
    assert.equal(r.view().status, 'completed');
  }
});
test('incomplete plans and missing explicit cost selection never charge a resource', () => {
  const r = runtime(), before = r.snapshot(), session = r.createCostSession(0);
  assert.throws(() => r.start(0, rules), /cost-selection-required/);
  assert.throws(() => r.start(0, rules, session), /unready-plan/);
  assert.equal(r.snapshot(), before);
});
test('insufficient combined costs fail before asking for or paying individual costs', () => {
  const r = runtime([pay(2), pay(1), discard()]), before = r.snapshot();
  assert.throws(() => r.createCostSession(0), /not-payable/); assert.equal(r.snapshot(), before);
});
test('wrong actors, forged tokens, wrong revisions and replayed replies are rejected', () => {
  const r = runtime(), s = r.createCostSession(0), response = reply(s);
  assert.throws(() => s.answer(1, response)); assert.throws(() => s.answer(0, { ...response, revision: 99 }));
  assert.throws(() => s.answer(0, { ...response, tokens: ['forged'] }));
  assert.equal(s.answer(0, response), true); assert.throws(() => s.answer(0, response));
  assert.equal(r.snapshot().revision, 0); ready(s); r.start(0, rules, s);
});
test('a choice that prevents remaining costs from being allocated is reissued without payment', () => {
  const r = runtime([pay(2), rest(['activeDon', 'leader'])]), s = r.createCostSession(0), first = reply(s, 0, 'd1');
  assert.equal(s.answer(0, first), false);
  assert.notEqual(s.viewFor(0).selectionId, first.selectionId); assert.throws(() => s.answer(0, first));
  assert.equal(r.snapshot().revision, 0);
  assert.equal(s.answer(0, reply(s, 0, 'TEST')), true);
  r.start(0, rules, s); assert.equal(r.snapshot().players[0].activeDon.length, 0); assert.equal(r.snapshot().cards.leader.rotated, true);
});
test('one physical card cannot be selected for two independent costs', () => {
  const second = discard('other'); const r = runtime([discard(), second]), s = r.createCostSession(0);
  s.answer(0, reply(s, 0, 'h1'));
  assert.deepEqual(s.viewFor(0).candidates.map(c => c.cardId), ['h2']); ready(s); r.start(0, rules, s);
  assert.deepEqual(r.snapshot().players[0].trash, ['h1', 'h2']);
});
test('prevention of the final cost rolls back DON, hand movement and rest together', () => {
  const r = runtime(), s = ready(r.createCostSession(0)), before = r.snapshot();
  assert.throws(() => r.start(0, { status: 'evaluate', check: p => ({ kind: p.operationIndex === 2 ? 'prevent' : 'allow' }) }, s));
  assert.equal(r.snapshot(), before); assert.equal(s.view().status, 'ready'); assert.equal(r.view().status, 'prepared');
  r.start(0, rules, s); assert.equal(s.view().status, 'consumed');
});
test('cost bindings use post-move generations in later actions', () => {
  const actions = [{ kind: 'move', cards: { kind: 'ref', from: 'VARIABLE', name: 'discarded' }, destination: { owner: 'SELF', zone: 'hand', position: 'append', visibility: 'faceUp' }, cause: 'EFFECT_MOVE' }];
  const r = runtime([discard()], actions), s = ready(r.createCostSession(0)); r.start(0, rules, s);
  assert.equal(r.snapshot().cards.h1.generation, 1); r.advance(1, rules);
  assert.equal(r.snapshot().cards.h1.generation, 2); assert.deepEqual(r.snapshot().players[0].hand, ['h2', 'h1']);
});
test('moving a character as a cost returns its attached DON without generating KO', () => {
  const cost = { ...discard(), selector: sel(['character']) };
  const r = runtime([cost]), s = ready(r.createCostSession(0)), receipt = r.start(0, rules, s);
  assert.deepEqual(r.snapshot().players[0].restDon, ['attached']); assert.deepEqual(r.snapshot().players[0].trash, ['c']);
  assert.equal(receipt.events.every(e => !e.isKO), true); assert.equal(receipt.events[1].cause.kind, 'RULE_PROCESSING');
});
test('a plan is bound to its match revision, resolution, actor and exact cost definition', () => {
  const r = runtime(), s = ready(r.createCostSession(0));
  assert.throws(() => runtime(undefined, [], 0, 'other').start(0, rules, s), /wrong-or-unready/);
  assert.throws(() => runtime([discard()]).start(0, rules, s), /wrong-or-unready/);
  assert.throws(() => runtime(undefined, [], 1).start(0, rules, s), /wrong-or-unready/);
  r.start(0, rules, s); assert.throws(() => r.start(1, rules, s));
});
test('cancelled sessions leave the board unchanged and cannot be paid', () => {
  const r = runtime(), s = r.createCostSession(0), before = r.snapshot();
  assert.throws(() => s.cancel(1)); s.cancel(0); assert.equal(s.viewFor(0), null);
  assert.throws(() => r.start(0, rules, s)); assert.equal(r.snapshot(), before);
  r.start(0, rules, ready(r.createCostSession(0)));
});
test('payment sessions cannot be cancelled by a rule callback during commit', () => {
  const r = runtime(), s = ready(r.createCostSession(0));
  r.start(0, { status: 'evaluate', check() {
    assert.throws(() => s.cancel(0)); assert.throws(() => r.start(0, rules, s)); return { kind: 'allow' };
  } }, s);
  assert.equal(s.view().status, 'consumed'); assert.throws(() => JSON.stringify(s), /server-only/);
});
test('ALL costs are automatic and DON-return costs retain correct generation and face state', () => {
  const cost = { kind: 'moveCards', selector: sel(['activeDon'], { min: 2, max: 2, mode: 'ALL' }), destination: { owner: 'SELF', zone: 'donDeck', position: 'append', visibility: 'faceDown' } };
  const r = runtime([cost]), s = r.createCostSession(0); assert.equal(s.view().status, 'ready'); r.start(0, rules, s);
  assert.deepEqual(r.snapshot().players[0].donDeck, ['d1', 'd2']); assert.equal(r.snapshot().cards.d1.generation, 1); assert.equal(r.snapshot().cards.d1.faceUp, false);
});
test('timed activation commits the chosen composite plan and progression together', () => {
  let p = createProgression(0); while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  const r = new TimedMovementEffect(initial(), p, { resolutionId: 'r', actor: 0, source: { instanceId: 'leader', generation: 0 } }, definition([pay(1), discard()]));
  const rev = { movement: 0, progression: p.revision }, s = ready(r.createCostSession(0, rev));
  assert.equal(r.snapshot().progression.gate.kind, 'idle'); r.start(0, rev, rules, s);
  assert.equal(r.snapshot().progression.gate.kind, 'idle'); assert.equal(r.snapshot().movement.players[0].trash.length, 1);
  assert.equal(r.view().status, 'completed');
});
test('even a forged same-revision board change invalidates a ready plan', () => {
  const costs = [discard()], r = runtime(costs), s = ready(r.createCostSession(0)), forged = structuredClone(r.snapshot());
  forged.cards.h2.generation = 1;
  assert.throws(() => s.validateForCommit(forged, 0, 'r', costs), /snapshot-changed/);
  assert.equal(s.view().status, 'ready'); r.start(0, rules, s);
});
test('multi-card top insertion, reveal and opponent costs are refused before any payment', () => {
  const top = { ...discard(), selector: sel(['hand'], { min: 2, max: 2 }), destination: { owner: 'SELF', zone: 'trash', position: 'top', visibility: 'faceUp' } };
  assert.throws(() => runtime([top]), /multiple-top-order/);
  assert.throws(() => runtime([{ kind: 'revealCards', selector: sel(['hand']) }]), /not-supported/);
  assert.throws(() => runtime([{ ...discard(), selector: sel(['hand'], { owner: 'OPPONENT' }) }]), /unsupported/);
});
