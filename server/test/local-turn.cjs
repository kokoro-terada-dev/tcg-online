const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatch } = require('../dist/test/game.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { nextLocalTurnCheckpoint } = require('../dist/test/localTurnCheckpoint.js');
const { EffectCatalog } = require('../dist/test/effects/effectCatalog.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { OwnedEffectEndpoint } = require('../dist/test/effects/ownedEffectEndpoint.js');
function setup(first = 0, enabled = true) {
  const recipe = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHAR'), donDeck: Array(10).fill('DON'), cardTypes: { CHAR: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe), catalog = new EffectCatalog([{ dslVersion: 1, effectId: 'TEST.draw', cardId: 'LEADER', trigger: { kind: 'activate', window: 'main' }, costs: [{ kind: 'moveCards', selector: { kind: 'cards', chooser: 'SELF', owner: 'SELF', zones: ['hand'], min: 1, max: 1, mode: 'SELECT' }, destination: { owner: 'SELF', zone: 'trash', position: 'append', visibility: 'faceUp' } }], actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] }]);
  const owner = new EffectMatchOwner(match, catalog, true); let p = createProgression(first);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  owner.adopt(p); owner.prepareRegisteredIdle({ status: 'certifiedNone' }, undefined, enabled);
  const endpoint = new OwnedEffectEndpoint(owner);
  function command(actor, requestId = 'turn', patch = {}) { const v = endpoint.viewFor(actor); return { kind: 'testNextTurn', matchId: v.matchId, resolutionId: v.effect.resolutionId, requestId, expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision, ...patch }; }
  function activate(actor, requestId = 'activate') { const v = endpoint.viewFor(actor); return endpoint.handle(actor, { ...command(actor, requestId), kind: 'activateRegistered', source: v.movement.players[actor].leader[0].ref, effectId: 'TEST.draw', catalogVersion: catalog.version }); }
  function step(actor, kind) { const v = endpoint.viewFor(actor); return endpoint.handle(actor, { ...command(actor, kind), kind, ...(kind === 'answerCosts' ? { selectionId: v.selection.selectionId, tokens: [v.selection.candidates[0].token] } : {}) }); }
  return { owner, match, endpoint, command, activate, step };
}
test('local turn switch alternates either first seat with matching board/progression turns and no card movement', () => {
  for (const first of [0, 1]) {
    const s = setup(first), before = s.owner.snapshot(), v = s.endpoint.viewFor(first);
    assert.equal(v.testTurnSwitchAvailable, true); assert.equal(s.endpoint.viewFor(1 - first).testTurnSwitchAvailable, false);
    const result = s.endpoint.handle(first, s.command(first)); assert.equal(result.ok, true);
    const next = s.owner.snapshot(); assert.equal(next.activeResolutionId, null); assert.equal(next.movement.turnNumber, 2); assert.equal(next.progression.turnNumber, 2);
    assert.equal(next.progression.activePlayer, 1 - first); assert.equal(next.progression.firstPlayer, first); assert.equal(next.progression.phaseSettled, true);
    assert.equal(next.movement.revision, before.movement.revision + 1); assert.notEqual(result.view.effect.resolutionId, v.effect.resolutionId);
    assert.deepEqual(next.movement.cards, before.movement.cards); assert.deepEqual(next.movement.players, before.movement.players);
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
test('checkpoint failures are atomic and never acknowledge real turn-start work', () => {
  const s = setup(), before = s.owner.snapshot();
  const locked = applySystemEvent(before.progression, before.progression.revision, { kind: 'beginResolution', resolutionId: 'pending', controller: 0 });
  assert.throws(() => nextLocalTurnCheckpoint(before.movement, locked, 0, 'tx'));
  const full = { ...before.movement, revision: 4096, appliedTransactions: Array.from({ length: 4096 }, (_, i) => `tx-${i}`) };
  assert.throws(() => nextLocalTurnCheckpoint(full, before.progression, 0, 'over-limit'));
  assert.equal(s.owner.snapshot().movement, before.movement); assert.equal(s.owner.snapshot().progression, before.progression);
});
