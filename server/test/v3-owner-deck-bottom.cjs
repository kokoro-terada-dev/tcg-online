const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: fixture, finish, id } = require('./helpers/v3-observed.cjs');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { sessionView } = require('../dist/test/effects/v3/sessionFixtures.js');
const { projectMovementEvents } = require('../dist/test/movement/projection.js');
const { getCard } = require('../dist/test/movement/state.js');

const orderedReturn = count => ({ type: 'ORDER_THEN_MOVE', player: 'OPPONENT', chooser: 'OPPONENT', count, destination: 'deckBottom' });
const draw = { type: 'DRAW', player: 'SELF', count: 1 };
const board = c => c.snapshotForCoordinator().movement;
function setup({ actor = 0, count = 2, hand = 5, watcher = false } = {}) {
  const { options } = fixture({ count: watcher ? 2 : 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.33';
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions: [orderedReturn(count), draw] });
    if (watcher) Object.assign(raw.effects[1].timing, {
      event: 'CARD_MOVED', snapshot: 'TRANSACTION_BEFORE', owner: 'SELF', controller: 'SELF', toZones: ['deck'],
      cardTypes: ['character', 'event'], filters: { type: 'compare', left: { ref: 'CANDIDATE.cardType' }, op: 'eq', right: 'event' },
    });
  }, mutateBoard(b) {
    const p = b.players[1 - actor];
    for (const card of p.hand.splice(hand)) { p.deck.push(card); b.cards[card].faceUp = false; }
    p.hand.forEach((card, i) => {
      b.cards[card].cardId = `PRIVATE-RETURN-${i}`;
      if (watcher && i === 0) b.cards[card].kind = 'event';
    });
  } });
  return new V3SyntheticMatchCoordinator({ ...options, progression: { ...options.progression, activePlayer: actor } });
}
function start(c, actor) {
  const e = c.mainEffectsFor(actor)[0]; c.activateMain(actor, id(), c.context(), e.sourceToken, e.effectId);
  return finish(c, actor);
}

test('owner submits the deck-bottom order; state, aliases and public movement log redact identities and order', () => {
  const c = setup(), before = board(c), hand = before.players[1].hand;
  const images = Object.fromEntries(hand.map(ref => [before.cards[ref].cardId, 'IMAGE-' + before.cards[ref].cardId]));
  const view = viewer => sessionView({ matchId: before.matchId, coordinator: c, imageAliases: images }, 'ROOM', viewer);
  start(c, 0);
  const q = view(1).frame.choice, context = c.context(), request = id();
  const [second, first] = [q.options[1], q.options[3]];
  const tokens = [first.token, second.token], orderedIds = [hand[3], hand[1]];
  assert.equal(q.purpose, 'ownerDeckBottom'); assert.equal(q.chooser, 1); assert.equal(view(0).resolutionActor, 0);
  assert.deepEqual(view(0).frame.choice.options, []);
  assert.equal(view(1).imageAliases[first.cardId], images[first.cardId]);
  const assertPrivate = payload => {
    const json = JSON.stringify(payload);
    for (const candidate of q.options) { assert(!json.includes(candidate.cardId)); assert(!json.includes(candidate.token)); }
    for (const ref of hand) assert(!json.includes(ref));
  };
  assertPrivate(view(0));
  assert.throws(() => c.answer(0, id(), context, q.selectionId, tokens));
  for (const invalid of [[first.token], [first.token, first.token], [first.token, 'fabricated']]) {
    assert.throws(() => c.answer(1, id(), context, q.selectionId, invalid));
  }
  assert.throws(() => c.answer(1, id(), { ...context, frameRevision: context.frameRevision - 1 }, q.selectionId, tokens));
  c.answer(1, request, context, q.selectionId, tokens);
  assert.equal(c.answer(1, request, context, q.selectionId, tokens).replayed, true);
  assert.throws(() => c.answer(1, request, context, q.selectionId, [...tokens].reverse()));
  assert.deepEqual(board(c), before); assertPrivate(view(0));
  assert.throws(() => c.applyPendingWork(1, id(), c.context()));
  const commit = c.context(), work = id();
  c.applyPendingWork(0, work, commit);
  assert.equal(c.applyPendingWork(0, work, commit).replayed, true);
  const after = board(c), events = c.snapshotForCoordinator().active.movementEvents;
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.players[1].deck, [...before.players[1].deck, ...orderedIds]);
  assert.deepEqual(after.players[1].hand, hand.filter(ref => !orderedIds.includes(ref)));
  assert.deepEqual(after.players[1].trash, before.players[1].trash);
  assert.deepEqual(events.map(e => e.after.instanceId), orderedIds);
  for (const e of events) {
    assert.equal(e.after.faceUp, false); assert.deepEqual(e.visibleAfter, []); assert.equal(e.isKO, false);
    assert.equal(e.cause.kind, 'EFFECT_MOVE'); assert.equal(e.cause.effectController, 0); assert.equal(e.from.player, 1);
    assert.throws(() => getCard(after, { instanceId: e.before.instanceId, generation: e.before.generation }));
  }
  const log = projectMovementEvents({ state: after, events, prevented: [] }, 0);
  assert.equal(log.length, 1); assert.equal(log[0].count, 2); assert.equal(log[0].cardId, null); assert.equal(log[0].from, null);
  assertPrivate(log); assertPrivate(view(0));
  const own = view(1);
  assert(own.movement.players[1].deck.every(card => card.cardId === null && card.ref === null));
  assert.equal(own.imageAliases[first.cardId], undefined); assert.equal(own.imageAliases[second.cardId], undefined);
  finish(c, 0);
  assert.equal(board(c).players[0].hand.length, before.players[0].hand.length + 1);
});

test('shortage uses only the available cards, and zero cards does not open a prompt', () => {
  for (const hand of [0, 1]) {
    const c = setup({ actor: 1, hand }), before = board(c), q = start(c, 1)?.choice;
    if (hand) {
      const own = c.viewFor(0).frame.choice;
      assert.equal(own.chooser, 0); assert.equal(own.min, hand); assert.equal(own.max, hand); assert.deepEqual(q.options, []);
      c.answer(0, id(), c.context(), own.selectionId, [own.options[0].token]); finish(c, 1);
    } else assert.equal(c.viewFor(1).frame.choice, null);
    assert.equal(board(c).players[0].hand.length, 0);
    assert.deepEqual(board(c).players[0].deck, [...before.players[0].deck, ...before.players[0].hand]);
    assert.equal(board(c).players[1].hand.length, before.players[1].hand.length + 1);
  }
});

test('a before-state observer does not expose whether a concealed return matched its card filter', () => {
  for (const selected of [0, 1]) {
    const c = setup({ count: 1, watcher: true });
    start(c, 0);
    const q = c.viewFor(1).frame.choice;
    c.answer(1, id(), c.context(), q.selectionId, [q.options[selected].token]);
    c.applyPendingWork(0, id(), c.context());
    const records = c.snapshotForCoordinator().triggerObservations.records;
    assert(records.length > 0 && records.every(record => record.result === 'unknown' && record.status === 'HELD'));
    const view = c.viewFor(0);
    assert.equal(view.conditionalTriggerHold, true); assert.deepEqual(view.triggerChoices, []);
    assert(!JSON.stringify(view).includes(q.options[selected].cardId));
  }
});
