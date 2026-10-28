const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { createMatch, applyCommand } = require('../dist/test/game.js');
const { parseMaster } = require('../dist/test/cardMaster.js');
const { projectMovementState } = require('../dist/test/movement/projection.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const recipe = () => ({ name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHAR'), donDeck: Array(10).fill('DON'), cardTypes: { CHAR: 'character' }, leaderLifeCount: 5 });
const match = () => createMatch(recipe(), recipe());
test('existing Match imports all physical cards without changing IDs, slots or the source', () => {
  const m = match(), before = structuredClone(m), c = new MatchMovementCapture(m, 1), s = c.snapshot().movement;
  assert.deepEqual(m, before); assert.equal(Object.keys(s.cards).length, 122);
  for (const actor of [0, 1]) {
    assert.deepEqual(s.players[actor].character, [null, null, null, null, null]);
    assert.deepEqual(s.players[actor].hand, m.players[actor].zones.hand.map(c => c.id));
    assert.equal(s.cards[s.players[actor].hand[0]].owner, actor); assert.equal(s.cards[s.players[actor].hand[0]].generation, 0);
    assert.equal(s.cards[s.players[actor].donDeck[0]].faceUp, false);
    assert.equal(m.players[actor].zones.donDeck[0].faceUp, true);
  }
  c.assertCurrent(m); assert.equal(Object.isFrozen(s), true);
});
test('private views remain private for either seat; DON deck stays publicly visible', () => {
  const m = match(), s = new MatchMovementCapture(m, 1).snapshot().movement;
  for (const actor of [0, 1]) {
    const view = projectMovementState(s, actor);
    assert.equal(view.players[actor].hand[0].cardId, 'CHAR'); assert.equal(view.players[1 - actor].hand[0].cardId, null);
    assert.equal(view.players[1 - actor].hand[0].ref, null); assert.equal(view.players[actor].deck[0].cardId, null);
    assert.equal(view.players[1 - actor].donDeck[0].cardId, 'DON');
  }
});
test('legacy revision is recorded separately, not forged into the movement journal', () => {
  const m = match(); assert.equal(applyCommand(m, 0, { kind: 'draw', matchId: m.id, requestId: 'draw', expectedRevision: 0 }), null);
  const s = new MatchMovementCapture(m, 3).snapshot();
  assert.equal(s.legacyRevision, 1); assert.equal(s.movement.revision, 0); assert.deepEqual(s.movement.appliedTransactions, []);
  assert.equal(s.movement.turnNumber, 3); assert.equal(s.movement.players[0].hand.length, 6);
});
test('subsequent manual operations are detected rather than silently overwriting effect state', () => {
  const m = match(), c = new MatchMovementCapture(m, 1), captured = c.snapshot().movement;
  applyCommand(m, 1, { kind: 'draw', matchId: m.id, requestId: 'draw', expectedRevision: 0 });
  assert.throws(() => c.assertCurrent(m), /changed-during/); assert.equal(c.snapshot().movement, captured);
  assert.equal(captured.players[1].hand.length, 5);
});
test('same-revision card and replay-ledger mutations are also detected', () => {
  for (const mutate of [m => { m.players[0].zones.hand[0].faceUp = false; }, m => { m.processed.set('0:new', 0); }, m => { m.players[0].zones.hand.reverse(); }]) {
    const m = match(), c = new MatchMovementCapture(m, 1); mutate(m); assert.throws(() => c.assertCurrent(m), /changed-during/);
  }
});
test('master replacement and Match replacement are refused even with otherwise identical data', () => {
  const m = match(), c = new MatchMovementCapture(m, 1);
  assert.throws(() => c.assertCurrent(structuredClone(m)), /instance-replaced/);
  m.master = parseMaster(JSON.stringify({ cards: { LEADER: { type: 'leader' } } }));
  assert.throws(() => c.assertCurrent(m), /changed-during/);
});
test('active manual attack is not guessed into an automated battle phase', () => {
  const m = match(); m.attack = { actor: 0, sourceId: m.players[0].zones.leader[0].id, targetId: m.players[1].zones.leader[0].id };
  assert.throws(() => new MatchMovementCapture(m, 1), /attack-needs-progression/);
});
test('invalid cards, duplicate instances, malformed slots and invalid turns fail without repairing source data', () => {
  for (const mutate of [m => { m.players[0].zones.hand[0].id = m.players[0].zones.hand[1].id; }, m => { m.players[0].zones.character.pop(); }, m => { m.players[0].zones.hand[0].rotated = 'yes'; }]) {
    const m = match(); mutate(m); const before = structuredClone(m); assert.throws(() => new MatchMovementCapture(m, 1)); assert.deepEqual(m, before);
  }
  assert.throws(() => new MatchMovementCapture(match(), 0));
});
test('effects can operate on the captured model without mutating the original Match', () => {
  const m = match(), c = new MatchMovementCapture(m, 1), state = c.snapshot().movement, id = state.players[0].hand[0], store = new MovementStore(state);
  store.commit({ transactionId: 'move', matchId: m.id, expectedRevision: 0, turnNumber: 1, actor: 0, effectController: 0,
    source: null, mode: 'effect', resolutionId: 'r', operations: [{ kind: 'move', card: { instanceId: id, generation: 0 }, from: { player: 0, zone: 'hand' },
      to: { player: 0, zone: 'character', position: 'firstEmpty', faceUp: true, rotated: false }, cause: 'EFFECT_MOVE' }] }, { status: 'certifiedNone' });
  assert.equal(store.snapshot().cards[id].generation, 1); assert.equal(m.players[0].zones.character[0], null); c.assertCurrent(m);
  assert.throws(() => JSON.stringify(c), /server-only/);
});
test('accessors and unmodeled card data are rejected before reading or dropping them', () => {
  const m = match(); let reads = 0;
  Object.defineProperty(m.players[0].zones.hand[0], 'cardId', { enumerable: true, get() { reads++; return 'CHAR'; } });
  assert.throws(() => new MatchMovementCapture(m, 1), /accessors/); assert.equal(reads, 0);
  const extra = match(); extra.players[0].zones.hand[0].attachedDonCount = 1;
  assert.throws(() => new MatchMovementCapture(extra, 1), /unknown-data-field/);
});
