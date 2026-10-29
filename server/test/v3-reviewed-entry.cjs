const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadReviewedV3Preset } = require('../dist/test/effects/v3/reviewedPresets.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');

function prepare(cardId, actor) {
  const { deck, reviewed } = loadReviewedV3Preset('kid-basic'), match = createMatch(deck, deck), peer = 1 - actor;
  const take = (player, id) => {
    const zones = match.players[player].zones;
    for (const zone of ['deck', 'hand', 'life']) {
      const index = zones[zone].findIndex(card => card.cardId === id);
      if (index >= 0) return zones[zone].splice(index, 1)[0];
    }
    throw Error(`Missing fixture card ${id}`);
  };
  // A turn-three kernel fixture assembled from the legal preset; no room endpoint can seed a board.
  const source = take(actor, cardId); match.players[actor].zones.hand.push({ ...source, faceUp: true });
  const ko = cardId === 'OP01-054', maxCost = cardId === 'OP01-048' ? 3 : 4;
  const target = take(peer, maxCost === 3 ? 'ST02-002' : 'ST02-006');
  match.players[peer].zones.character[0] = { ...target, faceUp: true, rotated: ko || cardId === 'OP01-048' };
  match.players[peer].zones.character[1] = { ...take(peer, 'OP02-039'), faceUp: true, rotated: ko };
  if (ko) match.players[peer].zones.character[2] = { ...take(peer, 'ST02-002'), faceUp: true, rotated: false };
  for (let i = 0; i < 5; i++) match.players[actor].zones.activeDon.push({ ...match.players[actor].zones.donDeck.shift(), faceUp: true, rotated: false });
  if (ko) match.players[peer].zones.activeDon.push({ ...match.players[peer].zones.donDeck.shift(), faceUp: true, rotated: false });
  let movement = new MatchMovementCapture(match, 3).snapshot().movement;
  if (ko) movement = new MovementStore(movement).commit({ transactionId: 'seed-attachment', matchId: movement.matchId, expectedRevision: movement.revision, turnNumber: 3,
    actor: peer, effectController: null, source: null, mode: 'rule', resolutionId: null, operations: [{ kind: 'attachDon', card: { instanceId: movement.players[peer].activeDon[0], generation: 0 }, target: { instanceId: target.id, generation: 0 } }] }, { status: 'certifiedNone' }).state;
  let progression = createProgression(actor);
  while (true) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') { if (progression.turnNumber === 3) break; progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain'); }
    else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  return { c: new V3SyntheticMatchCoordinator({ mode: 'reviewedLimited', reviewed, cards: reviewed.cards, movement, progression, signingKey: Buffer.alloc(32, 19), master: null, now: () => 1000 }),
    source: { instanceId: source.id, generation: 0 }, targetId: target.id, peer, ko };
}

for (const [id, actor] of [['OP01-033', 0], ['OP01-048', 1], ['OP01-054', 0]]) for (const skip of [false, true]) test(`reviewed entry ${id} validates targets and handles selection/skip (skip=${skip})`, () => {
  const { c, source, targetId, peer, ko } = prepare(id, actor);
  c.playCard(actor, 'play', c.context(), source); assert.equal(c.viewFor(actor).pendingTriggerCount, 1);
  const pending = c.viewFor(actor).triggerChoices[0]; assert.equal(pending.cardId, id); assert.equal(pending.timing, 'ON_PLAY');
  assert.deepEqual(c.viewFor(peer).triggerChoices, []);
  c.resolveTrigger(actor, 'resolve', c.context(), pending.token); c.advance(actor, 'select', c.context());
  const choice = c.viewFor(actor).frame.choice, before = c.snapshotForCoordinator();
  assert.equal(choice.min, 0); assert.equal(choice.max, 1); assert.equal(choice.options.length, 1);
  assert.equal(choice.options[0].cardId, before.movement.cards[targetId].cardId); assert.deepEqual(c.viewFor(peer).frame.choice.options, []);
  assert.throws(() => c.answer(peer, 'foreign-choice', c.context(), choice.selectionId, [choice.options[0].token]));
  c.answer(actor, 'answer', c.context(), choice.selectionId, skip ? [] : [choice.options[0].token]);
  for (let i = 0; i < 12; i++) {
    const frame = c.viewFor(actor).frame; if (frame.status === 'completed') break;
    if (frame.status === 'ready') c.advance(actor, `advance-${i}`, c.context());
    else { assert.equal(frame.status, 'waitingForWork'); const context = c.context(); c.applyPendingWork(actor, `work-${i}`, context); assert.equal(c.applyPendingWork(actor, `work-${i}`, context).replayed, true); }
  }
  const after = c.snapshotForCoordinator(); assert.equal(c.viewFor(actor).frame.status, 'completed'); assert.equal(c.viewFor(actor).gate, 'idle');
  if (skip) {
    assert.deepEqual(after.movement.players[peer], before.movement.players[peer]); assert.deepEqual(after.movement.cards[targetId], before.movement.cards[targetId]);
  } else if (ko) {
    assert.equal(after.movement.players[peer].character[0], null); assert.equal(after.movement.players[peer].trash.includes(targetId), true);
    assert.equal(after.movement.players[peer].attachedDon.length, 0); assert.equal(after.movement.players[peer].restDon.length, 1);
    assert.equal(after.ruleEvents.filter(event => event.isKO).length, 0); // Effect events live in the active resolution, not rule events.
    assert.equal(after.active.movementEvents.some(event => event.isKO && event.after.instanceId === targetId), true);
  } else {
    assert.equal(after.movement.cards[targetId].rotated, true); assert.equal(after.movement.cards[targetId].generation, before.movement.cards[targetId].generation);
  }
  assert.deepEqual(after.movement.players[peer].character.slice(1), before.movement.players[peer].character.slice(1));
});
