const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PreparedMovementEffect } = require('../dist/test/effects/movementActions.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const rules = { status: 'certifiedNone' };
function state(actor = 0, reveals = []) {
  const players = [emptyZones(), emptyZones()], cards = {};
  for (const seat of [0, 1]) for (const [suffix, kind, zone] of [['l', 'leader', 'leader'], ['h', 'character', 'hand'], ['c', 'character', 'character'], ['d', 'character', 'deck'], ['x', 'don', 'donDeck']]) {
    const id = `${seat}${suffix}`;
    cards[id] = { instanceId: id, generation: 0, cardId: suffix === 'l' ? 'TEST' : `PRINT-${id}`, kind,
      owner: seat, controller: seat, faceUp: !['deck', 'donDeck'].includes(zone), rotated: false,
      attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null };
    if (zone === 'leader' || zone === 'character') players[seat][zone][0] = id; else players[seat][zone].push(id);
  }
  return { ...createMovementState({ matchId: 'm', turnNumber: 2, players, cards }), reveals };
}
const select = (patch = {}, saveAs = 'chosen') => ({ kind: 'select', selector: { kind: 'cards', chooser: 'SELF', owner: 'SELF', zones: ['hand'], min: 1, max: 1, mode: 'SELECT', ...patch }, saveAs });
const move = (owner = 'SELF', name = 'chosen') => ({ kind: 'move', cards: { kind: 'ref', from: 'VARIABLE', name }, destination: { zone: 'trash', owner, position: 'append', visibility: 'faceUp' }, cause: 'EFFECT_MOVE' });
function runtime(actions, actor = 0, reveals = []) {
  return new PreparedMovementEffect(state(actor, reveals), { resolutionId: 'r', actor, source: { instanceId: `${actor}l`, generation: 0 } },
    { dslVersion: 1, effectId: 'e', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs: [], actions });
}
function reply(view, tokens) { return { matchId: view.matchId, resolutionId: view.resolutionId, selectionId: view.selectionId, revision: view.revision, tokens: tokens ?? view.candidates.map(c => c.token) }; }
function wait(r) { r.start(0, rules); assert.deepEqual(r.advance(1, rules), { kind: 'selectionPending' }); }

test('select waits without moving cards, then resumes with current references for either seat', () => {
  for (const actor of [0, 1]) {
    const r = runtime([select(), move()], actor); wait(r);
    assert.equal(r.view().status, 'waitingForSelection');
    assert.equal(r.snapshot().revision, 1);
    assert.equal(r.selectionViewFor(1 - actor), null);
    const view = r.selectionViewFor(actor);
    assert.equal(view.candidates[0].cardId, `PRINT-${actor}h`);
    assert.deepEqual(Object.keys(view.candidates[0]).sort(), ['cardId', 'token']);
    assert.throws(() => r.advance(1, rules), /not-current/);
    r.answerSelection(actor, reply(view), rules);
    assert.equal(r.view().status, 'resolving');
    assert.equal(r.selectionViewFor(actor), null);
    r.advance(2, rules);
    assert.deepEqual(r.snapshot().players[actor].trash, [`${actor}h`]);
    assert.equal(r.snapshot().cards[`${actor}h`].generation, 1);
    assert.equal(r.view().status, 'completed');
  }
});
test('wrong actor, forged identity, stale revision and unknown tokens can be corrected', () => {
  const r = runtime([select()]); wait(r); const view = r.selectionViewFor(0), valid = reply(view);
  for (const [actor, response] of [[1, valid], [0, { ...valid, selectionId: 'wrong' }], [0, { ...valid, revision: 0 }], [0, { ...valid, tokens: ['wrong'] }], [0, { ...valid, tokens: [] }]]) {
    assert.throws(() => r.answerSelection(actor, response, rules));
    assert.equal(r.view().status, 'waitingForSelection');
    assert.equal(r.snapshot().revision, 1);
  }
  r.answerSelection(0, valid, rules);
  assert.equal(r.view().status, 'completed');
  assert.throws(() => r.answerSelection(0, valid, rules), /not-answerable/);
});
test('opponent chooser uses its own authority while SELF still means effect controller', () => {
  const r = runtime([select({ chooser: 'OPPONENT', owner: 'OPPONENT' }), move('OPPONENT')]); wait(r);
  assert.equal(r.selectionViewFor(0), null);
  const view = r.selectionViewFor(1);
  r.answerSelection(1, reply(view), rules); r.advance(2, rules);
  assert.deepEqual(r.snapshot().players[1].trash, ['1h']);
});
test('hidden opponent hand cannot be inspected without authority', () => {
  const r = runtime([select({ owner: 'OPPONENT' })]); r.start(0, rules);
  assert.throws(() => r.advance(1, rules), /hidden-card/);
  assert.equal(r.view().status, 'blocked');
  assert.equal(r.selectionViewFor(0), null);
});
test('blind selection reveals neither card ID nor instance ID and still moves the selected card', () => {
  const r = runtime([select({ owner: 'OPPONENT', mode: 'BLIND_SELECT' }), move('OPPONENT')]); wait(r);
  const view = r.selectionViewFor(0);
  assert.equal(view.candidates[0].cardId, null);
  assert.equal(JSON.stringify(view).includes('PRINT-1h'), false);
  assert.equal(Object.hasOwn(view.candidates[0], 'instanceId'), false);
  r.answerSelection(0, reply(view), rules); r.advance(2, rules);
  assert.deepEqual(r.snapshot().players[1].trash, ['1h']);
});
test('existing scoped reveal rights are respected but never granted by the selector', () => {
  const r = runtime([select({ owner: 'OPPONENT', zones: ['deck'] })], 0,
    [{ scopeId: 'external', card: { instanceId: '1d', generation: 0 }, viewers: [0] }]); wait(r);
  assert.equal(r.selectionViewFor(0).candidates[0].cardId, 'PRINT-1d');
  r.answerSelection(0, reply(r.selectionViewFor(0)), rules);
  assert.equal(r.snapshot().reveals.length, 1);
});
test('ALL and RANDOM resolve server-side without exposing a pending selection', () => {
  for (const mode of ['ALL', 'RANDOM']) {
    const r = runtime([select({ mode }), move()]); r.start(0, rules);
    const result = r.advance(1, rules);
    assert.equal(result.state.revision, 2);
    assert.equal(r.selectionViewFor(0), null);
    assert.equal(r.view().status, 'resolving');
    r.advance(2, rules);
    assert.deepEqual(r.snapshot().players[0].trash, ['0h']);
  }
});
test('missing printed cost stays unknown rather than selecting the wrong cards', () => {
  const r = runtime([select({ zones: ['character'], condition: { kind: 'compare', operator: 'LTE', left: { kind: 'ref', from: 'TARGET', field: 'cost' }, right: { kind: 'literal', value: 3 } } })]);
  r.start(0, rules); assert.throws(() => r.advance(1, rules), /selection-data-unavailable/);
  assert.equal(r.view().status, 'blocked');
});
test('known movement facts allow conditions without guessing printed metadata', () => {
  const r = runtime([select({ zones: ['character'], condition: { kind: 'compare', operator: 'EQ', left: { kind: 'ref', from: 'TARGET', field: 'rotated' }, right: { kind: 'literal', value: false } } })]); wait(r);
  assert.equal(r.selectionViewFor(0).candidates[0].cardId, 'PRINT-0c');
});
test('repeated selects create distinct IDs and reject replies from the previous iteration', () => {
  const r = runtime([{ kind: 'repeat', count: 2, actions: [select({ min: 0 })] }]); wait(r);
  const first = reply(r.selectionViewFor(0), []); r.answerSelection(0, first, rules);
  r.advance(2, rules); const second = reply(r.selectionViewFor(0), []);
  assert.notEqual(first.selectionId, second.selectionId);
  assert.throws(() => r.answerSelection(0, first, rules));
  r.answerSelection(0, second, rules); assert.equal(r.view().status, 'completed');
});
test('valid answer with failed commit blocks and cannot be replayed', () => {
  const r = runtime([select()]); wait(r); const response = reply(r.selectionViewFor(0));
  assert.throws(() => r.answerSelection(0, response, { status: 'unresolved' }));
  assert.equal(r.view().status, 'blocked'); assert.equal(r.snapshot().revision, 1);
  assert.equal(r.selectionViewFor(0), null);
  assert.throws(() => r.answerSelection(0, response, rules));
});
test('choice selectors expose opaque option tokens only to the chooser', () => {
  const r = runtime([{ kind: 'select', saveAs: 'option', selector: { kind: 'choice', chooser: 'OPPONENT', options: [{ id: 'internal', label: 'Yes' }] } }]); wait(r);
  const view = r.selectionViewFor(1);
  assert.equal(r.selectionViewFor(0), null); assert.equal(view.options[0].label, 'Yes');
  assert.equal(JSON.stringify(view).includes('internal'), false);
  r.answerSelection(1, reply(view, [view.options[0].token]), rules);
  assert.equal(r.view().status, 'completed');
});
test('ORDER preserves the submitted full-set order in later append moves', () => {
  const r = runtime([select({ zones: ['hand', 'character'], min: 2, max: 2, mode: 'ORDER' }), move()]); wait(r);
  const view = r.selectionViewFor(0), reversed = [...view.candidates].reverse();
  r.answerSelection(0, reply(view, reversed.map(c => c.token)), rules); r.advance(2, rules);
  assert.deepEqual(r.snapshot().players[0].trash.map(id => r.snapshot().cards[id].cardId), reversed.map(c => c.cardId));
});
test('selected references cannot be reused after their generation has changed', () => {
  const second = move(); second.destination = { zone: 'hand', owner: 'SELF', position: 'append', visibility: 'faceUp' };
  const r = runtime([select(), move(), second]); wait(r);
  r.answerSelection(0, reply(r.selectionViewFor(0)), rules); r.advance(2, rules);
  const committed = r.snapshot();
  assert.throws(() => r.advance(3, rules), /stale-or-missing-card-reference/);
  assert.equal(r.snapshot(), committed); assert.equal(r.view().status, 'blocked');
});
test('public DON deck remains selectable despite its facedown physical representation', () => {
  const r = runtime([select({ owner: 'OPPONENT', zones: ['donDeck'] })]); wait(r);
  assert.equal(r.selectionViewFor(0).candidates[0].cardId, 'PRINT-1x');
});
