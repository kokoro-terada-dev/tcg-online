const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadReviewedV3Preset } = require('../dist/test/effects/v3/reviewedPresets.js');
const { ReviewedV3Setup } = require('../dist/test/effects/v3/reviewedSetup.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { validateReviewedV3Deck } = require('../dist/test/effects/v3/reviewedDeck.js');

for (const first of [0, 1]) test(`reviewed setup chooses first before private hands, waits for both mulligans and starts seat ${first}`, () => {
  const { deck, reviewed } = loadReviewedV3Preset('kid-basic');
  assert.equal(new Set(deck.mainDeck).size, 13); assert.equal(deck.mainDeck.length, 50);
  const setup = new ReviewedV3Setup([deck, deck], reviewed, Buffer.alloc(32, 18));
  const initial = setup.viewFor(0), chooser = initial.choicePlayer, other = 1 - first;
  assert.equal(initial.status, 'firstChoice'); assert.equal(initial.movement.players.every(player => player.hand.length === 0 && player.life.length === 0 && player.deck.length === 50), true);
  assert.throws(() => setup.chooseFirst(1 - chooser, 'foreign', 0, 'first')); assert.deepEqual(setup.viewFor(0), initial);
  const choice = chooser === first ? 'first' : 'second'; setup.chooseFirst(chooser, 'choose', 0, choice);
  assert.equal(setup.chooseFirst(chooser, 'choose', 0, choice).replayed, true);
  const dealt = setup.viewFor(first); assert.equal(dealt.firstPlayer, first); assert.equal(dealt.mulliganPlayer, first);
  assert.equal(dealt.movement.players[first].hand.every(card => card.cardId !== null && card.ref !== null), true);
  assert.equal(dealt.movement.players[other].hand.every(card => card.cardId === null && card.ref === null), true);
  assert.throws(() => setup.mulligan(other, 'too-early', dealt.revision, false)); assert.deepEqual(setup.viewFor(first), dealt);
  setup.mulligan(first, 'redraw', dealt.revision, true); assert.equal(setup.mulligan(first, 'redraw', dealt.revision, true).replayed, true);
  const waiting = setup.viewFor(other); assert.equal(waiting.status, 'mulligan'); assert.equal(waiting.mulliganPlayer, other);
  assert.equal(waiting.movement.players.every(player => player.life.length === 0 && player.activeDon.length === 0), true);
  assert.throws(() => setup.gameForServer()); assert.throws(() => setup.mulligan(first, 'again', waiting.revision, true));
  setup.mulligan(other, 'keep', waiting.revision, false);
  const ready = setup.viewFor(first), game = setup.gameForServer(), state = game.snapshotForCoordinator().movement;
  assert.equal(ready.status, 'ready'); assert.equal(ready.mulligans[first], true); assert.equal(ready.mulligans[other], false);
  for (const actor of [0, 1]) {
    assert.equal(state.players[actor].hand.length, 5); assert.equal(state.players[actor].life.length, 5); assert.equal(state.players[actor].deck.length, 40);
    assert.equal(state.players[actor].activeDon.length, actor === first ? 1 : 0); assert.equal(state.players[actor].donDeck.length, actor === first ? 9 : 10);
    assert.equal(state.players[actor].life.every(id => !state.cards[id].faceUp), true);
  }
  assert.equal(Object.keys(state.cards).length, 122); assert.equal(game.viewFor(first).mode, 'v3-reviewed-session');
  assert.equal(game.viewFor(first).phase, 'main'); assert.equal(game.viewFor(first).turnNumber, 1);
  const source = { instanceId: state.players[first].leader[0], generation: 0 }, beforeInvalid = game.snapshotForCoordinator();
  assert.equal(game.effectsFor(first, source)[0].enabled, false);
  assert.throws(() => game.activate(first, 'cannot-pay', game.context(), source, 'readyLeader')); assert.deepEqual(game.snapshotForCoordinator(), beforeInvalid);
  assert.equal(setup.mulligan(other, 'keep', waiting.revision, false).replayed, true);
  assert.throws(() => setup.mulligan(other, 'extra', ready.revision, true)); assert.throws(() => JSON.stringify(setup));
  game.endTurn(first, 'end', game.context());
  assert.equal(game.viewFor(other).turnNumber, 2); assert.equal(game.viewFor(other).movement.players[other].hand.length, 6);
  assert.equal(game.viewFor(other).movement.players[other].activeDon.length, 2);
  const snapshot = game.snapshotForCoordinator();
  assert.throws(() => new V3SyntheticMatchCoordinator({ mode: 'reviewedLimited', reviewed: { ...reviewed }, cards: reviewed.cards, movement: snapshot.movement, progression: snapshot.progression, signingKey: Buffer.alloc(32, 18), master: null }));
});

test('reviewed presets validate every card and do not permit caller-selected file paths', () => {
  const { deck, reviewed } = loadReviewedV3Preset('kid-basic'); assert.doesNotThrow(() => validateReviewedV3Deck(deck, reviewed.catalog));
  assert.throws(() => loadReviewedV3Preset('../cards/ST02-001', reviewed));
  const wrong = structuredClone(deck); wrong.mainDeck[0] = 'ST02-003'; wrong.cardTypes['ST02-003'] = 'character';
  assert.throws(() => new ReviewedV3Setup([wrong, deck], reviewed, Buffer.alloc(32, 18)));
});
