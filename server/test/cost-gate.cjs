const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TimedMovementEffect } = require('../dist/test/effects/timedMovement.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const { createProgression, checkTiming } = require('../dist/test/progression/state.js');
const { applySystemEvent, applyPlayerIntent } = require('../dist/test/progression/transitions.js');
const rules = { status: 'certifiedNone' };
const sel = zones => ({ kind: 'cards', chooser: 'SELF', owner: 'SELF', zones, min: 1, max: 1, mode: 'SELECT' });
const discard = () => ({ kind: 'moveCards', selector: sel(['hand']), destination: { owner: 'SELF', zone: 'trash', position: 'append', visibility: 'faceUp' } });
const pay = amount => ({ kind: 'payDon', amount });
const rest = zones => ({ kind: 'restCards', selector: sel(zones) });
const effectChoice = { kind: 'select', saveAs: 'decision', selector: { kind: 'choice', chooser: 'OPPONENT', options: [{ id: 'yes', label: 'Yes' }] } };
function runtime(actor = 0, costs = [pay(1), discard(), rest(['character'])], actions = [], patch = {}, reveals = []) {
  let p = createProgression(actor);
  while (true) {
    p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken });
    if (p.phase === 'main') break;
    p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken });
  }
  const players = [emptyZones(), emptyZones()], cards = {};
  for (const [id, kind, zone] of [['leader', 'leader', 'leader'], ['h1', 'character', 'hand'], ['h2', 'character', 'hand'], ['c', 'character', 'character'], ['d1', 'don', 'activeDon'], ['d2', 'don', 'activeDon']]) {
    cards[id] = { instanceId: id, generation: 0, cardId: id === 'leader' ? 'TEST' : id, kind, owner: actor, controller: actor,
      rotated: false, faceUp: true, attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null };
    if (zone === 'leader') players[actor].leader[0] = id; else if (zone === 'character') players[actor].character[0] = id; else players[actor][zone].push(id);
  }
  const board = { ...createMovementState({ matchId: 'm', turnNumber: 1, players, cards }), reveals };
  return new TimedMovementEffect(board, p, { resolutionId: 'r', actor, source: { instanceId: 'leader', generation: 0 } },
    { dslVersion: 1, effectId: 'e', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs, actions, ...patch });
}
const revisions = r => ({ movement: r.snapshot().movement.revision, progression: r.snapshot().progression.revision });
function reply(r, actor = 0, cardId) {
  const v = r.selectionViewFor(actor);
  const token = v.kind === 'choice' ? v.options[0].token : (cardId ? v.candidates.find(c => c.cardId === cardId) : v.candidates[0]).token;
  return { matchId: v.matchId, resolutionId: v.resolutionId, selectionId: v.selectionId, revision: v.revision, tokens: [token] };
}
function ready(r, actor = 0) { while (r.view().status === 'waitingForCostSelection') assert.equal(r.answerCostSelection(actor, revisions(r), reply(r, actor)), true); }
test('cost choice gates lock progression without moving cards for both players', () => {
  for (const actor of [0, 1]) {
    const r = runtime(actor), before = r.snapshot(); r.beginCostSelection(actor, revisions(r));
    assert.equal(r.snapshot().movement, before.movement);
    assert.equal(r.snapshot().progression.gate.kind, 'choice'); assert.equal(r.view().status, 'waitingForCostSelection');
    assert.equal(r.selectionViewFor(1 - actor), null);
    assert.equal(checkTiming(r.snapshot().progression, actor, 'mainEffect').allowed, false);
    assert.throws(() => applyPlayerIntent(r.snapshot().progression, r.snapshot().progression.revision, actor, 'endMain'));
    ready(r, actor); assert.equal(r.view().status, 'costsReady'); assert.equal(r.snapshot().movement, before.movement);
    r.commitCostSelection(actor, revisions(r), rules);
    assert.equal(r.snapshot().movement.revision, 1); assert.equal(r.snapshot().progression.gate.kind, 'idle');
    assert.equal(r.view().status, 'completed');
  }
});
test('cancellation during selection releases the gate and invalidates old replies without payment', () => {
  const r = runtime(), before = r.snapshot().movement; r.beginCostSelection(0, revisions(r)); const old = reply(r);
  r.cancelCostSelection(0, revisions(r)); assert.equal(r.view().status, 'prepared'); assert.equal(r.snapshot().progression.gate.kind, 'idle');
  assert.equal(r.snapshot().movement, before); assert.equal(r.selectionViewFor(0), null);
  r.beginCostSelection(0, revisions(r)); assert.notEqual(r.selectionViewFor(0).selectionId, old.selectionId);
  assert.throws(() => r.answerCostSelection(0, revisions(r), old));
});
test('ready but unpaid costs can also be cancelled', () => {
  const r = runtime(); r.beginCostSelection(0, revisions(r)); ready(r); const before = r.snapshot().movement;
  r.cancelCostSelection(0, revisions(r)); assert.equal(r.snapshot().movement, before); assert.equal(r.snapshot().progression.gate.kind, 'idle');
  assert.throws(() => r.commitCostSelection(0, revisions(r), rules));
});
test('wrong actor, stale revisions and bad tokens do not change either state machine', () => {
  const r = runtime(); r.beginCostSelection(0, revisions(r)); const valid = reply(r), before = r.snapshot();
  assert.throws(() => r.answerCostSelection(1, revisions(r), valid));
  assert.throws(() => r.answerCostSelection(0, { ...revisions(r), progression: 0 }, valid));
  assert.throws(() => r.answerCostSelection(0, revisions(r), { ...valid, tokens: ['bad'] }));
  assert.throws(() => r.cancelCostSelection(1, revisions(r)));
  assert.equal(r.snapshot().movement, before.movement); assert.equal(r.snapshot().progression, before.progression);
});
test('old cost answers cannot target the next choice even while board revision stays zero', () => {
  const r = runtime(); r.beginCostSelection(0, revisions(r)); const old = reply(r), oldRevisions = revisions(r);
  r.answerCostSelection(0, oldRevisions, old);
  assert.equal(r.snapshot().movement.revision, 0);
  assert.throws(() => r.answerCostSelection(0, oldRevisions, old));
  assert.throws(() => r.answerCostSelection(0, revisions(r), old));
  ready(r); r.commitCostSelection(0, revisions(r), rules);
});
test('normal start, effect advance and effect-answer APIs cannot bypass an unpaid choice', () => {
  const r = runtime(); r.beginCostSelection(0, revisions(r)); const costReply = reply(r);
  assert.throws(() => r.start(0, revisions(r), rules));
  assert.throws(() => r.advance(0, revisions(r), rules));
  assert.throws(() => r.answerSelection(0, revisions(r), costReply, rules));
  ready(r); assert.throws(() => r.advance(0, revisions(r), rules)); assert.equal(r.snapshot().movement.revision, 0);
});
test('impossible costs and false or unknown activation conditions never reserve a gate', () => {
  const missing = { kind: 'exists', value: { kind: 'ref', from: 'SOURCE', field: 'power' } };
  const no = { kind: 'compare', operator: 'EQ', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 2 } };
  for (const r of [runtime(0, [pay(3), discard()]), runtime(0, undefined, [], { condition: no }), runtime(0, undefined, [], { condition: missing })]) {
    const before = r.snapshot(); assert.throws(() => r.beginCostSelection(0, revisions(r)));
    assert.equal(r.snapshot().movement, before.movement); assert.equal(r.snapshot().progression, before.progression);
  }
});
test('failed payment remains ready and locked, and can be retried or cancelled', () => {
  for (const retry of [true, false]) {
    const r = runtime(); r.beginCostSelection(0, revisions(r)); ready(r); const before = r.snapshot();
    assert.throws(() => r.commitCostSelection(0, revisions(r), { status: 'evaluate', check: p => ({ kind: p.operationIndex === 2 ? 'prevent' : 'allow' }) }));
    assert.equal(r.snapshot().movement, before.movement); assert.equal(r.snapshot().progression, before.progression); assert.equal(r.view().status, 'costsReady');
    if (retry) { r.commitCostSelection(0, revisions(r), rules); assert.equal(r.view().status, 'completed'); }
    else { r.cancelCostSelection(0, revisions(r)); assert.equal(r.view().status, 'prepared'); }
  }
});
test('paid effect selections use a separate lifecycle and cannot cancel or refund cost', () => {
  const r = runtime(0, undefined, [effectChoice]); r.beginCostSelection(0, revisions(r)); ready(r); const old = revisions(r);
  r.commitCostSelection(0, old, rules); assert.equal(r.snapshot().progression.gate.kind, 'resolving');
  assert.throws(() => r.commitCostSelection(0, old, rules)); assert.throws(() => r.cancelCostSelection(0, revisions(r)));
  r.advance(0, revisions(r), rules); assert.equal(r.view().status, 'waitingForSelection');
  assert.equal(r.selectionViewFor(0), null); const response = reply(r, 1);
  assert.throws(() => r.answerCostSelection(1, revisions(r), response));
  r.answerSelection(1, revisions(r), response, rules); assert.equal(r.view().status, 'completed');
});
test('invalid allocations get new tokens and remain locked without any payment', () => {
  const r = runtime(0, [pay(2), rest(['activeDon', 'leader'])]); r.beginCostSelection(0, revisions(r));
  const old = reply(r, 0, 'd1'); assert.equal(r.answerCostSelection(0, revisions(r), old), false);
  assert.equal(r.view().status, 'waitingForCostSelection'); assert.equal(r.snapshot().movement.revision, 0);
  assert.notEqual(r.selectionViewFor(0).selectionId, old.selectionId);
  assert.equal(r.answerCostSelection(0, revisions(r), reply(r, 0, 'TEST')), true);
  r.commitCostSelection(0, revisions(r), rules); assert.equal(r.snapshot().movement.players[0].activeDon.length, 0);
});
test('automatic all-DON planning locks the gate as ready, not as a phantom choice', () => {
  const r = runtime(0, [pay(1)]); r.beginCostSelection(0, revisions(r));
  assert.equal(r.view().status, 'costsReady'); assert.equal(r.selectionViewFor(0), null); assert.equal(r.snapshot().progression.gate.kind, 'resolving');
  r.cancelCostSelection(0, revisions(r)); assert.equal(r.snapshot().movement.revision, 0);
});
test('bounded valid cost-answer attempts still allow unpaid cancellation', () => {
  const r = runtime(0, [pay(2), rest(['activeDon', 'leader'])]); r.beginCostSelection(0, revisions(r));
  for (let i = 0; i < 64; i++) assert.equal(r.answerCostSelection(0, revisions(r), reply(r, 0, 'd1')), false);
  assert.throws(() => r.answerCostSelection(0, revisions(r), reply(r, 0, 'd1')), /answer-limit/);
  r.cancelCostSelection(0, revisions(r)); assert.equal(r.snapshot().movement.revision, 0); assert.equal(r.snapshot().progression.gate.kind, 'idle');
});
test('commit callbacks cannot cancel or reopen a planning session', () => {
  const r = runtime(); r.beginCostSelection(0, revisions(r)); ready(r); const expected = revisions(r);
  r.commitCostSelection(0, expected, { status: 'evaluate', check() {
    assert.throws(() => r.cancelCostSelection(0, expected), /reentrant/);
    assert.throws(() => r.beginCostSelection(0, expected), /reentrant/); return { kind: 'allow' };
  } });
  assert.equal(r.view().status, 'completed');
});
test('post-payment completion failure stays paid and locked, never cancellable', () => {
  const grant = [{ scopeId: 'r', card: { instanceId: 'h1', generation: 0 }, viewers: [0] }];
  for (const planned of [false, true]) {
    const r = runtime(0, [pay(1)], [], {}, grant);
    if (planned) r.beginCostSelection(0, revisions(r));
    assert.throws(() => planned ? r.commitCostSelection(0, revisions(r), rules) : r.start(0, revisions(r), rules), /reveals-still-open/);
    assert.equal(r.snapshot().movement.revision, 1); assert.equal(r.snapshot().movement.players[0].restDon.length, 1);
    assert.equal(r.view().status, 'blocked'); assert.equal(r.snapshot().progression.gate.kind, 'resolving');
    assert.throws(() => r.cancelCostSelection(0, revisions(r)));
  }
});
