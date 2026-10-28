const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatch } = require('../dist/test/game.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { nextLocalTurnCheckpoint, openingLocalTurnCheckpoint, localDeckOutProgression } = require('../dist/test/localTurnCheckpoint.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { EffectCatalog } = require('../dist/test/effects/effectCatalog.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { OwnedEffectEndpoint } = require('../dist/test/effects/ownedEffectEndpoint.js');
function setup(first = 0, enabled = true, remaining = 40) {
  const recipe = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHAR'), donDeck: Array(10).fill('DON'), cardTypes: { CHAR: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe), catalog = new EffectCatalog([{ dslVersion: 1, effectId: 'TEST.draw', cardId: 'LEADER', trigger: { kind: 'activate', window: 'main' }, costs: [{ kind: 'moveCards', selector: { kind: 'cards', chooser: 'SELF', owner: 'SELF', zones: ['hand'], min: 1, max: 1, mode: 'SELECT' }, destination: { owner: 'SELF', zone: 'trash', position: 'append', visibility: 'faceUp' } }], actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] }]);
  const shortened = match.players[first].zones.deck.splice(remaining); match.players[first].zones.trash.push(...shortened.map(card => ({ ...card, faceUp: true })));
  const owner = new EffectMatchOwner(match, catalog, true); let p = createProgression(first);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  owner.adopt(p); owner.prepareRegisteredIdle({ status: 'certifiedNone' }, undefined, enabled);
  if (enabled) owner.initializeLocalTurnStart();
  const endpoint = new OwnedEffectEndpoint(owner);
  function command(actor, requestId = 'turn', patch = {}) { const v = endpoint.viewFor(actor); return { kind: 'testNextTurn', matchId: v.matchId, resolutionId: v.effect.resolutionId, requestId, expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision, ...patch }; }
  function activate(actor, requestId = 'activate') { const v = endpoint.viewFor(actor); return endpoint.handle(actor, { ...command(actor, requestId), kind: 'activateRegistered', source: v.movement.players[actor].leader[0].ref, effectId: 'TEST.draw', catalogVersion: catalog.version }); }
  function step(actor, kind) { const v = endpoint.viewFor(actor); return endpoint.handle(actor, { ...command(actor, kind), kind, ...(kind === 'answerCosts' ? { selectionId: v.selection.selectionId, tokens: [v.selection.candidates[0].token] } : {}) }); }
  return { owner, match, endpoint, command, activate, step };
}
test('local turns initialize either first seat and apply draw/DON only to the incoming player', () => {
  for (const first of [0, 1]) {
    const s = setup(first), before = s.owner.snapshot(), v = s.endpoint.viewFor(first);
    assert.equal(v.testTurnSwitchAvailable, true); assert.equal(s.endpoint.viewFor(1 - first).testTurnSwitchAvailable, false);
    const result = s.endpoint.handle(first, s.command(first)); assert.equal(result.ok, true);
    const next = s.owner.snapshot(); assert.equal(next.activeResolutionId, null); assert.equal(next.movement.turnNumber, 2); assert.equal(next.progression.turnNumber, 2);
    assert.equal(next.progression.activePlayer, 1 - first); assert.equal(next.progression.firstPlayer, first); assert.equal(next.progression.phaseSettled, true);
    assert.equal(next.movement.revision, before.movement.revision + 1); assert.notEqual(result.view.effect.resolutionId, v.effect.resolutionId);
    assert.equal(before.movement.players[first].activeDon.length, 1); assert.equal(before.movement.players[first].hand.length, 5);
    assert.deepEqual(next.movement.players[first], before.movement.players[first]);
    assert.equal(next.movement.players[1 - first].hand.length, 6); assert.equal(next.movement.players[1 - first].activeDon.length, 2);
    assert.equal(next.movement.players[1 - first].deck.length, before.movement.players[1 - first].deck.length - 1);
    assert.equal(s.endpoint.viewFor(1 - first).testTurnSwitchAvailable, true); assert.equal(s.activate(first).ok, false);
    assert.equal(s.activate(1 - first).ok, true);
  }
});
test('turn retries stay idempotent even after the other player switches back; content changes conflict', () => {
  const s = setup(), c = s.command(0), first = s.endpoint.handle(0, c);
  const replay = s.endpoint.handle(0, c); assert.equal(replay.replayed, true); assert.equal(replay.view.progression.turnNumber, 2);
  assert.equal(s.endpoint.handle(0, { ...c, expectedMovementRevision: 999 }).code, 'request_conflict');
  assert.equal(s.endpoint.handle(1, s.command(1)).ok, true); const before = s.owner.snapshot();
  assert.equal(s.endpoint.handle(0, c).view.progression.turnNumber, 3); assert.equal(s.owner.snapshot().movement, before.movement);
  assert.equal(s.endpoint.handle(0, { ...s.command(0), kind: 'activateRegistered', source: s.endpoint.viewFor(0).movement.players[0].leader[0].ref, catalogVersion: before.catalogVersion, effectId: 'TEST.draw' }).code, 'request_conflict');
  assert.equal(first.view.progression.activePlayer, 1);
});
test('cost selection and resolution lock turn switching until completion', () => {
  const s = setup(); assert.equal(s.activate(0).ok, true); const id = s.owner.snapshot().activeResolutionId;
  assert.equal(s.endpoint.viewFor(0).testTurnSwitchAvailable, undefined);
  assert.equal(s.endpoint.handle(0, s.command(0, 'costs')).ok, false); s.step(0, 'answerCosts'); s.step(0, 'commitCosts');
  assert.equal(s.endpoint.handle(0, s.command(0, 'resolving')).ok, false); assert.equal(s.owner.snapshot().activeResolutionId, id);
  assert.equal(s.step(0, 'advance').view.effect.status, 'idle'); assert.equal(s.endpoint.handle(0, s.command(0, 'after')).ok, true);
});
test('wrong actor, match, both revisions and reserved context are rejected without mutation', () => {
  const s = setup(), before = s.owner.snapshot(); let i = 0;
  assert.equal(s.endpoint.handle(1, s.command(1)).ok, false);
  for (const patch of [{ matchId: 'other' }, { resolutionId: 'old' }, { expectedMovementRevision: 99 }, { expectedProgressionRevision: 99 }]) assert.equal(s.endpoint.handle(0, s.command(0, `bad-${i++}`, patch)).ok, false);
  assert.equal(s.owner.snapshot().movement, before.movement); assert.equal(s.owner.snapshot().progression, before.progression);
});
test('test turn switching requires explicit non-production opt-in', () => {
  const disabled = setup(0, false); assert.equal(disabled.endpoint.viewFor(0).testTurnSwitchAvailable, false); assert.equal(disabled.endpoint.handle(0, disabled.command(0)).ok, false);
  const unresolved = new EffectMatchOwner(disabled.match, new EffectCatalog([]), true); unresolved.adopt(disabled.owner.snapshot().progression);
  assert.throws(() => unresolved.prepareRegisteredIdle({ status: 'unresolved' }, undefined, true)); assert.equal(unresolved.effectViewFor(0), null);
  const s = setup(), c = s.command(0), old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.equal(s.endpoint.viewFor(0).testTurnSwitchAvailable, false); assert.equal(s.endpoint.handle(0, c).ok, false); assert.throws(() => setup()); }
  finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});
test('client authority, accessors and malformed payloads never select a phase or player', () => {
  const s = setup();
  for (const patch of [{ actor: 1 }, { nextPlayer: 1 }, { phase: 'main' }, { turnNumber: 100 }, { expectedMovementRevision: -1 }]) assert.equal(s.endpoint.handle(0, s.command(0, 'bad', patch)).code, 'invalid_command');
  let reads = 0; const c = s.command(0); Object.defineProperty(c, 'expectedProgressionRevision', { enumerable: true, get() { reads++; return 0; } });
  assert.equal(s.endpoint.handle(0, c).code, 'invalid_command'); assert.equal(reads, 0);
});
test('checkpoint failures are atomic and preserve both prior states', () => {
  const s = setup(), before = s.owner.snapshot();
  const locked = applySystemEvent(before.progression, before.progression.revision, { kind: 'beginResolution', resolutionId: 'pending', controller: 0 });
  assert.throws(() => nextLocalTurnCheckpoint(before.movement, locked, 0, 'tx'));
  const full = { ...before.movement, revision: 4096, appliedTransactions: Array.from({ length: 4096 }, (_, i) => `tx-${i}`) };
  assert.throws(() => nextLocalTurnCheckpoint(full, before.progression, 0, 'over-limit'));
  assert.equal(s.owner.snapshot().movement, before.movement); assert.equal(s.owner.snapshot().progression, before.progression);
});

test('refresh returns attached DON and activates only the incoming player field and DON', () => {
  const s = setup(), state = s.owner.snapshot(), board = state.movement, leader = board.cards[board.players[0].leader[0]];
  const don = board.cards[board.players[0].activeDon[0]];
  const altered = new MovementStore(board).commit({ transactionId: 'refresh-fixture', matchId: board.matchId, expectedRevision: board.revision, turnNumber: 1, actor: 0, effectController: null, source: null, mode: 'rule', resolutionId: null,
    operations: [{ kind: 'attachDon', card: { instanceId: don.instanceId, generation: don.generation }, target: { instanceId: leader.instanceId, generation: leader.generation } }, { kind: 'setRest', card: { instanceId: leader.instanceId, generation: leader.generation }, rotated: true }] }, { status: 'certifiedNone' }).state;
  const guest = nextLocalTurnCheckpoint(altered, state.progression, 0, 'guest-turn');
  assert.equal(guest.movement.cards[leader.instanceId].rotated, true); assert.equal(guest.movement.players[0].attachedDon.length, 1);
  const host = nextLocalTurnCheckpoint(guest.movement, guest.progression, 1, 'host-turn');
  assert.equal(host.movement.players[0].attachedDon.length, 0); assert.equal(host.movement.cards[leader.instanceId].rotated, false);
  assert.equal(host.movement.players[0].activeDon.length, 3); assert.equal(host.movement.cards[don.instanceId].attachedTo, null);
});

test('opening cannot apply twice and remaining DON are added without fabricating cards', () => {
  const s = setup(), before = s.owner.snapshot(); assert.throws(() => s.owner.initializeLocalTurnStart());
  assert.throws(() => openingLocalTurnCheckpoint(before.movement, before.progression, 'again'));
  const altered = structuredClone(before.movement), zones = altered.players[1];
  const moved = zones.donDeck.splice(0, zones.donDeck.length - 1); zones.activeDon.push(...moved);
  for (const id of moved) altered.cards[id].faceUp = true;
  const next = nextLocalTurnCheckpoint(altered, before.progression, 0, 'last-don');
  assert.equal(next.movement.players[1].activeDon.length, 10); assert.equal(next.movement.players[1].donDeck.length, 0);
  assert.equal(Object.keys(next.movement.cards).length, Object.keys(before.movement.cards).length);
});

test('drawing the final card ends during draw without adding DON; unsupported modifiers still reject', () => {
  const s = setup(), before = s.owner.snapshot(), altered = structuredClone(before.movement), zones = altered.players[1];
  const moved = zones.deck.splice(1); zones.trash.push(...moved);
  for (const id of moved) altered.cards[id].faceUp = true;
  const copy = structuredClone(altered);
  const result = nextLocalTurnCheckpoint(altered, before.progression, 0, 'deck-out'); assert.deepEqual(altered, copy);
  assert.equal(result.progression.outcome.winner, 0); assert.equal(result.progression.phase, 'draw');
  assert.equal(result.movement.players[1].deck.length, 0); assert.equal(result.movement.players[1].hand.length, 6);
  assert.deepEqual(result.movement.players[1].donDeck, copy.players[1].donDeck); assert.equal(result.movement.players[1].activeDon.length, 0);
  const unsupported = structuredClone(before.movement); unsupported.cards[unsupported.players[1].leader[0]].modifierIds = ['unknown-modifier'];
  assert.throws(() => nextLocalTurnCheckpoint(unsupported, before.progression, 0, 'modifiers'), /transient-state/);
});

test('effect deck-out clears the runtime and exposes the same terminal result to both players', () => {
  const s = setup(0, true, 1), v = s.endpoint.viewFor(0), c = { ...s.command(0, 'last-card'), kind: 'activateRegistered', source: v.movement.players[0].leader[0].ref, effectId: 'TEST.draw', catalogVersion: s.owner.snapshot().catalogVersion };
  assert.equal(s.endpoint.handle(0, c).ok, true); s.step(0, 'answerCosts'); s.step(0, 'commitCosts');
  const result = s.step(0, 'advance'); assert.equal(result.ok, true); assert.equal(result.view.progression.finished, true);
  assert.equal(result.view.progression.winner, 1); assert.deepEqual(result.view.progression.defeatedPlayers, [0]);
  assert.equal(s.owner.snapshot().activeResolutionId, null); assert.equal(result.view.selection, null); assert.equal(result.view.testTurnSwitchAvailable, false);
  const other = s.endpoint.viewFor(1); assert.equal(other.progression.winner, 1); assert.equal(other.movement.players[0].hand.every(card => card.cardId === null), true);
  const before = s.owner.snapshot(); assert.equal(s.endpoint.handle(0, c).replayed, true);
  assert.equal(s.activate(0, 'after-end').ok, false); assert.equal(s.endpoint.handle(0, s.command(0, 'after-turn')).ok, false); assert.equal(s.step(0, 'advance').ok, false);
  assert.equal(s.owner.snapshot().movement, before.movement); assert.equal(s.owner.snapshot().progression, before.progression);
});

test('already empty decks finish without a draw and simultaneous deck-out has no winner', () => {
  const s = setup(), before = s.owner.snapshot(), altered = structuredClone(before.movement);
  for (const zones of altered.players) {
    const moved = zones.deck.splice(0); zones.trash.push(...moved); for (const id of moved) altered.cards[id].faceUp = true;
  }
  const ended = localDeckOutProgression(altered, before.progression); assert.equal(ended.outcome.winner, null); assert.equal(ended.outcome.reason, 'local-deck-out');
  assert.equal(localDeckOutProgression(altered, ended), ended);
  const result = nextLocalTurnCheckpoint(altered, before.progression, 0, 'empty'); assert.equal(result.movement, altered); assert.equal(result.progression.turnNumber, 1);
});
