const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: fixture, finish, play, select, id, always } = require('./helpers/v3-observed.cjs');
const { getCard } = require('../dist/test/movement/state.js');

const hand = (cardTypes, min, filters = always()) => ({
  type: 'CARDS', owner: 'SELF', controller: 'SELF', chooser: 'SELF', zone: 'hand', cardTypes, filters,
  excludeSource: false, faceUpOnly: false, min, max: min, visibility: 'OWNER_ONLY',
  selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail',
});
const reveal = selector => ({ type: 'REVEAL_CARDS', selector });
const move = selector => ({ type: 'MOVE_AS_COST', selector, destination: 'trash' });
const rest = { type: 'REST_DON', count: 1 };
const discard = { type: 'DISCARD_HAND', count: 1 };
const draw = { type: 'DRAW', player: 'SELF', count: 1 };
const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const trait = value => ({ type: 'CARD_METADATA', subject: 'CANDIDATE', basis: 'PRINTED', field: 'traits', match: 'ANY', comparison: 'EXACT', values: [value] });
const either = { type: 'any', conditions: [{ type: 'compare', left: { ref: 'CANDIDATE.cardType' }, op: 'eq', right: 'event' }, trait('Punk Hazard')] };
const board = c => c.snapshotForCoordinator().movement;
const event = 'MAIN-EVENT-FIXTURE';

function setup(costs, { optional = false, sourceType = 'character', types = [], onPlay = false, resolutionConditions = always(), prepare = () => {} } = {}) {
  return fixture({ sourceType, count: 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.30';
    raw.traits = ['Punk Hazard'];
    Object.assign(raw.effects[0], { kind: onPlay ? 'triggered' : 'activated', timing: { type: onPlay ? 'ON_PLAY' : 'MAIN' }, costs, optional, resolutionConditions, actions: [draw] });
  }, mutateBoard(b) {
    types.forEach((cardType, i) => Object.assign(b.cards[b.players[0].hand[i]], { cardId: cardType === 'event' ? event : 'TARGET', kind: cardType }));
    prepare(b);
  } }).c;
}
function start(c) {
  const choice = c.mainEffectsFor(0).find(row => row.effectId === 'watch-0');
  c.activateMain(0, id(), c.context(), choice.sourceToken, choice.effectId);
  return choice.source;
}
const choice = c => c.viewFor(0).frame.choice;
function answer(c, indices) {
  const q = choice(c);
  return c.answer(0, id(), c.context(), q.selectionId, indices.map(i => q.options[i].token));
}

test('on-play exact filtered reveal stays private until the whole activation payment commits', () => {
  const c = setup([rest, reveal(hand(['event', 'character'], 3, either))], { optional: true, onPlay: true, types: ['event'], prepare(b) {
    const p = b.players[0], don = p.donDeck.shift(); p.activeDon.push(don); b.cards[don].faceUp = true;
  } });
  play(c); select(c, 'watch-0', 0); finish(c, 0);
  const before = board(c);
  answer(c, [0]); finish(c, 0);
  const q = choice(c), context = c.context(), tokens = q.options.slice(0, 3).map(option => option.token), requestId = id();
  assert.equal(q.purpose, 'cost'); assert.equal(q.min, 3); assert.equal(q.max, 3);
  assert.deepEqual(q.options.slice(0, 3).map(option => option.cardId), [event, 'TARGET', 'TARGET']);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.deepEqual(c.viewFor(1).publicReveals, []);
  assert.throws(() => c.answer(1, id(), context, q.selectionId, tokens));
  assert.throws(() => c.answer(0, id(), context, q.selectionId, [tokens[0], tokens[0], tokens[2]]));
  assert.throws(() => c.answer(0, id(), context, q.selectionId, ['fabricated', ...tokens.slice(1)]));
  assert.throws(() => c.answer(0, id(), { ...context, frameRevision: context.frameRevision - 1 }, q.selectionId, tokens));
  c.answer(0, requestId, context, q.selectionId, tokens);
  assert.equal(c.answer(0, requestId, context, q.selectionId, tokens).replayed, true);
  c.advance(0, id(), c.context());
  assert.deepEqual(board(c), before);
  c.applyPendingWork(0, id(), c.context());
  const paid = board(c);
  assert.equal(paid.revision, before.revision + 1);
  assert.equal(paid.players[0].activeDon.length, before.players[0].activeDon.length - 1);
  assert.deepEqual(paid.players[0].hand, before.players[0].hand);
  assert.deepEqual(c.viewFor(1).publicReveals.map(row => row.cardId), [event, 'TARGET', 'TARGET']);
  assert(paid.reveals.every(grant => grant.viewers.includes(0) && grant.viewers.includes(1)));
  finish(c, 0);
  assert.equal(board(c).players[0].hand.length, before.players[0].hand.length + 1);
  assert.deepEqual(c.viewFor(1).publicReveals, []);
});

test('declining activation, shortage or UNKNOWN eligibility never pays another component', () => {
  for (const scenario of ['declined', 'shortage', 'unknown']) {
    const available = scenario === 'declined';
    const selector = scenario === 'unknown' ? hand(['character'], 1, trait('Punk Hazard')) : hand(['event'], 1);
    const c = setup([rest, reveal(selector)], { optional: true, types: available ? ['event'] : [], prepare(b) {
      if (scenario === 'unknown') b.cards[b.players[0].hand[0]].cardId = 'UNCLASSIFIED-FIXTURE';
    } });
    const before = board(c), main = c.mainEffectsFor(0)[0];
    assert.equal(main.enabled, available);
    if (!available) assert.throws(() => start(c));
    else { start(c); finish(c, 0); answer(c, [1]); finish(c, 0); }
    assert.deepEqual(board(c), before); assert.deepEqual(c.viewFor(1).publicReveals, []);
  }
});

test('filtered trash and unfiltered discard choose distinct objects and move together as costs, not KO', () => {
  const c = setup([discard, move(hand(['event'], 1))], { types: ['event'] }), before = board(c);
  const [first, second] = before.players[0].hand;
  start(c); finish(c, 0);
  assert.deepEqual(choice(c).options.map(row => row.cardId), [event]);
  answer(c, [0]); finish(c, 0);
  assert(choice(c).options.every(row => row.cardId !== event));
  answer(c, [0]); c.advance(0, id(), c.context());
  assert.deepEqual(board(c), before);
  c.applyPendingWork(0, id(), c.context());
  const after = board(c);
  assert.deepEqual(after.players[0].trash.slice(-2), [second, first]);
  assert.throws(() => getCard(after, ref(before.cards[first])));
  assert(c.snapshotForCoordinator().active.movementEvents.every(row => row.cause.kind === 'COST_PAYMENT' && !row.isKO));
  finish(c, 0);
  assert.equal(board(c).players[0].hand.length, before.players[0].hand.length - 1);
});

test('source trash preserves effect resolution, but cannot also spend DON reserved for source departure', () => {
  for (const overlap of [false, true]) {
    const donReturn = { type: 'DON_RETURN', count: 1, from: ['attachedDon'] };
    const c = setup(overlap ? [move('SOURCE'), donReturn] : [move('SOURCE')], { prepare(b) {
      const p = b.players[0], don = p.activeDon.shift(); p.attachedDon.push(don);
      b.cards[don].attachedTo = ref(b.cards[p.character[0]]);
    } });
    const before = board(c);
    if (overlap) { assert.throws(() => start(c)); assert.deepEqual(board(c), before); continue; }
    const source = start(c); finish(c, 0);
    const after = board(c);
    assert.equal(after.players[0].trash.at(-1), source.instanceId);
    assert.throws(() => getCard(after, source));
    assert.deepEqual(after.players[0].restDon, before.players[0].attachedDon);
    assert.equal(after.players[0].hand.length, before.players[0].hand.length + 1);
    assert.deepEqual(c.snapshotForCoordinator().active.movementEvents.slice(0, 2).map(row => row.cause.kind), ['COST_PAYMENT', 'RULE_PROCESSING']);
  }
});

test('a false resolution condition closes already published reveals without refunding the paid cost', () => {
  const c = setup([rest, reveal(hand(['event'], 1))], {
    types: ['event'], resolutionConditions: { type: 'compare', left: 0, op: 'eq', right: 1 },
  });
  const before = board(c);
  start(c); finish(c, 0); answer(c, [0]); c.advance(0, id(), c.context());
  c.applyPendingWork(0, id(), c.context());
  assert.equal(c.viewFor(1).publicReveals.length, 1);
  finish(c, 0);
  assert.deepEqual(c.viewFor(1).publicReveals, []);
  assert.deepEqual(board(c).players[0].hand, before.players[0].hand);
  assert.equal(board(c).players[0].activeDon.length, before.players[0].activeDon.length - 1);
  assert.equal(c.viewFor(0).frame.activationCommitted, true);
});
