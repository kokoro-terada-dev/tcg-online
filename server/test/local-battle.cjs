const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatch } = require('../dist/test/game.js');
const { createProgression, freezeState, phaseToken } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { EffectCatalog } = require('../dist/test/effects/effectCatalog.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { OwnedEffectEndpoint } = require('../dist/test/effects/ownedEffectEndpoint.js');
function setup({ actor = 0, turn = 3, targetRest = null, sourceRest = false, enabled = true } = {}) {
  const recipe = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CARD'), donDeck: Array(10).fill('DON'), cardTypes: { CARD: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe); match.players[actor].zones.leader[0].rotated = sourceRest;
  if (targetRest !== null) match.players[1 - actor].zones.character[0] = { ...match.players[1 - actor].zones.deck.shift(), faceUp: true, rotated: targetRest };
  const catalog = new EffectCatalog([{ dslVersion: 1, effectId: 'TEST.counter', cardId: 'LEADER', trigger: { kind: 'activate', window: 'counter' }, costs: [], actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] }]);
  const owner = new EffectMatchOwner(match, catalog, true); let p = freezeState({ ...createProgression(actor), turnNumber: turn, phaseToken: phaseToken(turn, 'refresh') });
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  owner.adopt(p); owner.prepareRegisteredIdle({ status: 'certifiedNone' }, undefined, enabled);
  const endpoint = new OwnedEffectEndpoint(owner), source = { instanceId: match.players[actor].zones.leader[0].id, generation: 0 };
  const target = { instanceId: (targetRest === null ? match.players[1 - actor].zones.leader[0] : match.players[1 - actor].zones.character[0]).id, generation: 0 };
  function base(seat, requestId) { const v = endpoint.viewFor(seat); return { matchId: v.matchId, resolutionId: v.effect.resolutionId, requestId, expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision }; }
  function attack(patch = {}, requestId = 'attack') { return { kind: 'testAttack', ...base(actor, requestId), source: { ...source }, target: { ...target }, ...patch }; }
  function decision(seat, action, requestId = action) { return { kind: 'testBattleDecision', ...base(seat, requestId), battleId: endpoint.viewFor(seat).battle.battleId, decision: action }; }
  return { owner, endpoint, source, target, base, attack, decision, actor };
}
test('test attacks rest the source and expose the same public arrow for either attacking seat', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor }), before = s.owner.snapshot(), r = s.endpoint.handle(actor, s.attack());
    assert.equal(r.ok, true); assert.equal(r.view.battle.step, 'block'); assert.equal(r.view.battle.attacker, actor);
    assert.equal(s.owner.snapshot().movement.cards[s.source.instanceId].rotated, true);
    assert.deepEqual(r.view.battle.source, s.source); assert.deepEqual(r.view.battle.target, s.target);
    assert.equal(r.view.testBattleDecision, undefined); assert.equal(s.endpoint.viewFor(1 - actor).testBattleDecision, 'passBlock');
    assert.deepEqual(s.endpoint.viewFor(1 - actor).battle, r.view.battle); assert.deepEqual(s.owner.snapshot().movement.players, before.movement.players);
    assert.equal(r.view.testTurnSwitchAvailable, false); assert.equal(r.view.testPlayAvailable, false);
  }
});
test('first turns, rested sources and active character targets fail without resting any card', () => {
  for (const options of [{ turn: 1 }, { sourceRest: true }, { targetRest: false }]) {
    const s = setup(options), before = s.owner.snapshot(); assert.equal(s.endpoint.handle(s.actor, s.attack()).ok, false);
    assert.equal(s.owner.snapshot().movement, before.movement); assert.equal(s.owner.snapshot().progression, before.progression);
  }
  const rested = setup({ targetRest: true }); assert.equal(rested.endpoint.handle(0, rested.attack()).ok, true);
});
test('a character placed this turn is neither a candidate nor an allowed attacker', () => {
  const s = setup(), ref = s.endpoint.viewFor(0).movement.players[0].hand[0].ref;
  assert.equal(s.endpoint.handle(0, { kind: 'testPlayCard', ...s.base(0, 'play'), source: ref }).ok, true);
  const fresh = s.endpoint.viewFor(0).movement.players[0].character[0].ref;
  assert.equal(s.endpoint.viewFor(0).testAttackSourceIds.includes(fresh.instanceId), false);
  assert.equal(s.endpoint.handle(0, s.attack({ source: fresh })).ok, false);
});
test('defender decisions are ordered and cannot change the attacker or target; damage remains pending', () => {
  const s = setup(); s.endpoint.handle(0, s.attack()); const id = s.endpoint.viewFor(0).battle.battleId;
  assert.equal(s.endpoint.handle(0, s.decision(0, 'passBlock', 'wrong-seat')).ok, false);
  assert.equal(s.endpoint.handle(1, s.decision(1, 'endCounter', 'wrong-step')).ok, false);
  const pass = s.decision(1, 'passBlock'); assert.equal(s.endpoint.handle(1, pass).view.battle.step, 'counter');
  assert.equal(s.endpoint.handle(1, pass).replayed, true); assert.equal(s.endpoint.viewFor(1).testBattleDecision, 'endCounter');
  const end = s.decision(1, 'endCounter'); const r = s.endpoint.handle(1, end);
  assert.equal(r.ok, true); assert.equal(r.view.battle.step, 'damage'); assert.equal(r.view.battle.battleId, id); assert.deepEqual(r.view.battle.source, s.source); assert.deepEqual(r.view.battle.target, s.target);
  assert.equal(r.view.testBattleDecision, undefined); assert.equal(r.view.movement.players[1].life.length, 5); assert.equal(r.view.progression.finished, false);
  assert.equal(s.endpoint.handle(1, end).replayed, true); assert.equal(s.endpoint.handle(0, s.attack({}, 'overlap')).ok, false);
});
test('counter effects retain the battle arrow and lock decisions until the effect completes', () => {
  const s = setup(); s.endpoint.handle(0, s.attack()); s.endpoint.handle(1, s.decision(1, 'passBlock'));
  const leader = s.endpoint.viewFor(1).movement.players[1].leader[0].ref;
  s.owner.openRegisteredEffect('TEST.counter', 1, leader, { status: 'certifiedNone' });
  assert.deepEqual(s.endpoint.viewFor(0).battle.source, s.source); assert.equal(s.endpoint.viewFor(1).testBattleDecision, undefined);
  assert.equal(s.endpoint.handle(1, s.decision(1, 'endCounter', 'during-effect')).ok, false);
  for (const kind of ['beginCosts', 'commitCosts', 'advance']) assert.equal(s.endpoint.handle(1, { kind, ...s.base(1, kind) }).ok, true);
  assert.equal(s.endpoint.viewFor(1).testBattleDecision, 'endCounter'); assert.equal(s.endpoint.viewFor(1).battle.step, 'counter');
});
test('stale/foreign references, changed retries and authority fields are refused; default fixtures stay disabled', () => {
  const s = setup(), before = s.owner.snapshot(); let i = 0;
  for (const patch of [{ source: s.target }, { target: s.source }, { source: { ...s.source, generation: 1 } }, { resolutionId: 'old' }, { expectedMovementRevision: 99 }, { expectedProgressionRevision: 99 }]) assert.equal(s.endpoint.handle(0, s.attack(patch, `bad-${i++}`)).ok, false);
  assert.equal(s.owner.snapshot().movement, before.movement);
  assert.equal(s.endpoint.handle(0, s.attack({ actor: 1 })).code, 'invalid_command');
  const c = s.attack(); assert.equal(s.endpoint.handle(0, c).ok, true); assert.equal(s.endpoint.handle(0, c).replayed, true);
  assert.equal(s.endpoint.handle(0, { ...c, target: s.source }).code, 'request_conflict');
  const disabled = setup({ enabled: false }); assert.equal(disabled.endpoint.viewFor(0).testAttackAvailable, false); assert.equal(disabled.endpoint.handle(0, disabled.attack()).ok, false);
});
