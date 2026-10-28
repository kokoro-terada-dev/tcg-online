const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PreparedMovementEffect } = require('../dist/test/effects/movementActions.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const rules = { status: 'certifiedNone' };
const literal = value => ({ kind: 'literal', value });
const variable = name => ({ kind: 'ref', from: 'VARIABLE', name });
const equals = (left, right) => ({ kind: 'compare', operator: 'EQ', left, right });
const draw = (player = 'SELF') => ({ kind: 'draw', player, amount: 1 });
const optional = (actions = [draw()], player = 'SELF') => ({ kind: 'optional', player, actions });
const branch = (condition, then = [draw()], otherwise = [draw('OPPONENT')]) => ({ kind: 'if', condition, then, else: otherwise });
function runtime(actions, actor = 0) {
  const players = [emptyZones(), emptyZones()], cards = {};
  for (const seat of [0, 1]) {
    for (let i = 0; i < 7; i++) {
      const id = `${seat}-${i}`;
      cards[id] = { instanceId: id, generation: 0, cardId: i === 0 ? 'TEST' : id,
        kind: i === 0 ? 'leader' : 'character', owner: seat, controller: seat, faceUp: i === 0,
        rotated: false, attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null };
      if (i === 0) players[seat].leader[0] = id; else players[seat].deck.push(id);
    }
  }
  return new PreparedMovementEffect(createMovementState({ matchId: 'm', turnNumber: 1, players, cards }),
    { resolutionId: 'r', actor, source: { instanceId: `${actor}-0`, generation: 0 } },
    { dslVersion: 1, effectId: 'e', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs: [], actions });
}
function answer(r, seat, index = 0) {
  const view = r.selectionViewFor(seat);
  const reply = { matchId: view.matchId, resolutionId: view.resolutionId, selectionId: view.selectionId, revision: view.revision, tokens: [view.options[index].token] };
  return r.answerSelection(seat, reply, rules);
}
const advance = r => r.advance(r.snapshot().revision, rules);
test('known true and false execute only the selected branch for both seats', () => {
  for (const actor of [0, 1]) for (const value of [true, false]) {
    const r = runtime([branch(equals(literal(value), literal(true)))], actor); r.start(0, rules);
    advance(r); assert.equal(r.view().status, 'resolving'); advance(r);
    assert.equal(r.snapshot().players[value ? actor : 1 - actor].hand.length, 1);
    assert.equal(r.snapshot().players[value ? 1 - actor : actor].hand.length, 0);
    assert.equal(r.view().status, 'completed');
  }
});
test('conditions read the current board rather than the activation snapshot', () => {
  const r = runtime([draw(), branch(equals({ kind: 'ref', from: 'SELF', field: 'handCount' }, literal(1)))]);
  r.start(0, rules); advance(r); advance(r); advance(r);
  assert.equal(r.snapshot().players[0].hand.length, 2);
  assert.equal(r.snapshot().players[1].hand.length, 0);
});
test('choice results become scalar predicate variables without exposing private mappings', () => {
  for (const index of [0, 1]) {
    const r = runtime([{ kind: 'select', saveAs: 'decision', selector: { kind: 'choice', chooser: 'SELF', options: [{ id: 'left', label: 'A' }, { id: 'right', label: 'B' }] } }, branch(equals(variable('decision'), literal('left')))]);
    r.start(0, rules); advance(r); answer(r, 0, index); advance(r); advance(r);
    assert.equal(r.snapshot().players[index].hand.length, 1);
    assert.equal(r.view().status, 'completed');
  }
});
test('optional accept runs and decline skips the entire subtree', () => {
  for (const index of [0, 1]) {
    const r = runtime([optional(), draw('OPPONENT')]); r.start(0, rules); advance(r);
    assert.equal(r.selectionViewFor(0).options.length, 2);
    assert.equal(r.selectionViewFor(1), null);
    answer(r, 0, index);
    if (index === 0) advance(r);
    advance(r);
    assert.equal(r.snapshot().players[0].hand.length, index === 0 ? 1 : 0);
    assert.equal(r.snapshot().players[1].hand.length, 1);
    assert.equal(r.view().status, 'completed');
  }
});
test('opponent decides its optional effect for either actor', () => {
  for (const actor of [0, 1]) {
    const r = runtime([optional([draw()], 'OPPONENT')], actor); r.start(0, rules); advance(r);
    assert.equal(r.selectionViewFor(actor), null);
    answer(r, 1 - actor); advance(r);
    assert.equal(r.snapshot().players[actor].hand.length, 1);
  }
});
test('nested branches and optional skip do not execute unreachable failures', () => {
  const unavailable = { kind: 'draw', player: 'SELF', amount: 64 };
  const r = runtime([branch(equals(literal(1), literal(1)), [optional([unavailable])], [{ ...unavailable }]), draw()]);
  r.start(0, rules); advance(r); advance(r); answer(r, 0, 1); advance(r);
  assert.equal(r.snapshot().players[0].hand.length, 1);
  assert.equal(r.view().status, 'completed');
});
test('each repeated optional has an independent branch decision and selection identity', () => {
  const r = runtime([{ kind: 'repeat', count: 2, actions: [optional()] }]); r.start(0, rules);
  advance(r); const first = r.selectionViewFor(0).selectionId; answer(r, 0, 1);
  advance(r); assert.notEqual(r.selectionViewFor(0).selectionId, first); answer(r, 0); advance(r);
  assert.equal(r.snapshot().players[0].hand.length, 1); assert.equal(r.view().status, 'completed');
});
test('unknown condition blocks rather than choosing else, preserving prior actions', () => {
  const r = runtime([draw(), branch(equals({ kind: 'ref', from: 'SOURCE', field: 'power' }, literal(5000)))]);
  r.start(0, rules); advance(r); const before = r.snapshot();
  assert.throws(() => advance(r), /condition-data-unavailable/);
  assert.equal(r.snapshot(), before); assert.equal(r.view().status, 'blocked');
  assert.equal(r.snapshot().players[0].hand.length, 1); assert.equal(r.snapshot().players[1].hand.length, 0);
});
test('card-set variables cannot be coerced to scalar IDs or counts', () => {
  const r = runtime([{ ...draw(), saveAs: 'cards' }, branch(equals(variable('cards'), literal('some-id')))]);
  r.start(0, rules); advance(r); assert.throws(() => advance(r), /condition-data-unavailable/);
  assert.equal(r.view().status, 'blocked');
});
test('empty chosen branches finish without exposing or executing unchosen work', () => {
  const r = runtime([branch(equals(literal(0), literal(1)), [draw()], [])]); r.start(0, rules); advance(r);
  assert.equal(r.view().status, 'completed'); assert.equal(r.snapshot().players[0].hand.length, 0);
  const opt = runtime([optional()]); opt.start(0, rules); advance(opt); answer(opt, 0, 1);
  assert.equal(opt.view().status, 'completed');
});
test('unsupported commands are rejected even in unchosen branches', () => {
  const unsupported = { kind: 'modify', modifier: { kind: 'power', target: { kind: 'ref', from: 'SOURCE', field: 'id' }, amount: 1000 }, duration: { kind: 'thisTurn' } };
  assert.throws(() => runtime([branch(equals(literal(1), literal(1)), [], [unsupported])]), /unsupported/);
  assert.throws(() => runtime([optional([unsupported])]), /unsupported/);
});
test('branch bindings do not leak into following actions', () => {
  assert.throws(() => runtime([branch(equals(literal(1), literal(1)), [{ ...draw(), saveAs: 'inside' }], []), branch(equals(variable('inside'), literal(1)))]), /unbound/);
});
test('stale branch requests do not advance the instruction cursor', () => {
  const r = runtime([branch(equals(literal(1), literal(1)))]); r.start(0, rules); advance(r);
  assert.throws(() => r.advance(1, rules), /not-current/); advance(r);
  assert.equal(r.snapshot().players[0].hand.length, 1);
});
test('nested branches inherit choice variables from their parent scope', () => {
  const r = runtime([{ kind: 'select', saveAs: 'decision', selector: { kind: 'choice', chooser: 'SELF', options: [{ id: 'yes', label: 'A' }] } },
    branch(equals(variable('decision'), literal('yes')), [branch(equals(variable('decision'), literal('yes')))], [])]);
  r.start(0, rules); advance(r); answer(r, 0); advance(r); advance(r); advance(r);
  assert.equal(r.snapshot().players[0].hand.length, 1); assert.equal(r.view().status, 'completed');
});
test('if inside repeat evaluates freshly each iteration', () => {
  const r = runtime([{ kind: 'repeat', count: 2, actions: [branch(equals({ kind: 'ref', from: 'SELF', field: 'handCount' }, literal(0)))] }]);
  r.start(0, rules); for (let i = 0; i < 4; i++) advance(r);
  assert.equal(r.snapshot().players[0].hand.length, 1); assert.equal(r.snapshot().players[1].hand.length, 1);
  assert.equal(r.view().status, 'completed');
});
