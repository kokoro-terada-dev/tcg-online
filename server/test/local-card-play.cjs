const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatch } = require('../dist/test/game.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { EffectCatalog } = require('../dist/test/effects/effectCatalog.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { OwnedEffectEndpoint } = require('../dist/test/effects/ownedEffectEndpoint.js');
function setup(actor = 0, kind = 'character', occupied = [], enabled = true) {
  const recipe = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CARD'), donDeck: Array(10).fill('DON'), cardTypes: { CARD: kind }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe);
  for (const slot of occupied) match.players[actor].zones[kind][slot] = { ...match.players[actor].zones.deck.shift(), faceUp: true };
  const definition = { dslVersion: 1, effectId: 'TEST.draw', cardId: 'LEADER', trigger: { kind: 'activate', window: 'main' }, costs: [], actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] };
  const owner = new EffectMatchOwner(match, new EffectCatalog([definition]), true); let p = createProgression(actor);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  owner.adopt(p); owner.prepareRegisteredIdle({ status: 'certifiedNone' }, undefined, enabled); if (enabled) owner.initializeLocalTurnStart();
  const endpoint = new OwnedEffectEndpoint(owner), source = endpoint.viewFor(actor).movement.players[actor].hand[0].ref;
  function command(patch = {}, requestId = 'play') { const v = endpoint.viewFor(actor); return { kind: 'testPlayCard', requestId, matchId: v.matchId, resolutionId: v.effect.resolutionId, expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision, source: { ...source }, ...patch }; }
  return { owner, endpoint, source, command, match, actor };
}
test('local character and stage placement works for both seats and reveals only the placed card', () => {
  for (const actor of [0, 1]) for (const kind of ['character', 'stage']) {
    const s = setup(actor, kind), before = s.owner.snapshot(), old = s.endpoint.viewFor(actor), r = s.endpoint.handle(actor, s.command());
    assert.equal(r.ok, true); assert.equal(r.view.movement.players[actor].hand.length, 4);
    const card = s.owner.snapshot().movement.cards[s.source.instanceId];
    assert.equal(s.owner.snapshot().movement.players[actor][kind][0], card.instanceId); assert.equal(card.generation, s.source.generation + 1);
    assert.equal(card.faceUp, true); assert.equal(card.rotated, false); assert.equal(card.enteredTurn, kind === 'character' ? 1 : null);
    assert.notEqual(r.view.effect.resolutionId, old.effect.resolutionId); assert.equal(s.owner.snapshot().progression, before.progression);
    assert.deepEqual(s.owner.snapshot().movement.players[actor].activeDon, before.movement.players[actor].activeDon);
    const other = s.endpoint.viewFor(1 - actor); assert.equal(other.movement.players[actor][kind][0].cardId, 'CARD'); assert.equal(other.movement.players[actor].hand.every(c => c.cardId === null), true);
  }
});
test('leftmost empty character slot is used; full character and stage fields are never overwritten', () => {
  const sparse = setup(0, 'character', [0, 2]); assert.equal(sparse.endpoint.handle(0, sparse.command()).ok, true);
  assert.equal(sparse.owner.snapshot().movement.players[0].character[1], sparse.source.instanceId);
  for (const [kind, occupied] of [['character', [0, 1, 2, 3, 4]], ['stage', [0]]]) {
    const s = setup(0, kind, occupied), before = s.owner.snapshot();
    assert.equal(s.endpoint.handle(0, s.command()).ok, false); assert.equal(s.owner.snapshot().movement, before.movement);
  }
});
test('repeated requests do not play twice, conflicting content and stale generations fail', () => {
  const s = setup(), c = s.command(), first = s.endpoint.handle(0, c), before = s.owner.snapshot();
  assert.equal(first.ok, true); assert.equal(s.endpoint.handle(0, c).replayed, true); assert.equal(s.owner.snapshot().movement, before.movement);
  assert.equal(s.endpoint.handle(0, { ...c, source: { ...c.source, generation: 99 } }).code, 'request_conflict');
  assert.equal(s.endpoint.handle(0, s.command({}, 'again')).ok, false); assert.equal(s.owner.snapshot().movement, before.movement);
});
test('other seats, non-hand sources, stale context/revisions and unsupported card kinds are rejected', () => {
  const s = setup(), before = s.owner.snapshot(); let i = 0;
  assert.equal(s.endpoint.handle(1, s.command()).ok, false);
  for (const patch of [{ matchId: 'other' }, { resolutionId: 'old' }, { expectedMovementRevision: 99 }, { expectedProgressionRevision: 99 }, { source: { ...s.source, generation: 99 } }, { source: { instanceId: s.match.players[0].zones.leader[0].id, generation: 0 } }, { source: { instanceId: s.match.players[1].zones.hand[0].id, generation: 0 } }]) assert.equal(s.endpoint.handle(0, s.command(patch, `bad-${i++}`)).ok, false);
  assert.equal(s.owner.snapshot().movement, before.movement);
  const event = setup(0, 'event'); assert.equal(event.endpoint.handle(0, event.command()).ok, false);
});
test('effect processing, disabled fixtures and production do not permit free placement', () => {
  const s = setup(), leader = s.endpoint.viewFor(0).movement.players[0].leader[0];
  s.owner.openRegisteredEffect('TEST.draw', 0, leader.ref, { status: 'certifiedNone' });
  assert.equal(s.endpoint.viewFor(0).testPlayAvailable, undefined); assert.equal(s.endpoint.handle(0, s.command()).ok, false);
  const disabled = setup(0, 'character', [], false); assert.equal(disabled.endpoint.viewFor(0).testPlayAvailable, false); assert.equal(disabled.endpoint.handle(0, disabled.command()).ok, false);
  const local = setup(), old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.equal(local.endpoint.viewFor(0).testPlayAvailable, false); assert.equal(local.endpoint.handle(0, local.command()).ok, false); }
  finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});
test('client target/slot/authority fields and accessors are refused', () => {
  const s = setup();
  for (const patch of [{ actor: 1 }, { to: 'character' }, { slotIndex: 4 }, { cost: 0 }]) assert.equal(s.endpoint.handle(0, s.command(patch)).code, 'invalid_command');
  let reads = 0; const c = s.command(); Object.defineProperty(c.source, 'generation', { enumerable: true, get() { reads++; return 0; } });
  assert.equal(s.endpoint.handle(0, c).code, 'invalid_command'); assert.equal(reads, 0);
});
