const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatch } = require('../dist/test/game.js');
const { createProgression, freezeState, phaseToken } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { EffectCatalog } = require('../dist/test/effects/effectCatalog.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { OwnedEffectEndpoint } = require('../dist/test/effects/ownedEffectEndpoint.js');
const { parseMaster } = require('../dist/test/cardMaster.js');
const { localBattlePower } = require('../dist/test/localBattle.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const master = parseMaster(JSON.stringify({ schemaVersion: 2, cards: { LEADER: { type: 'leader', power: 5000 }, CARD: { type: 'character', power: 2000 } } }));
function setup({ actor = 0, turn = 3, targetRest = null, sourceRest = false, enabled = true, sourceChar = false, life = 5, battleMaster = master } = {}) {
  const recipe = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CARD'), donDeck: Array(10).fill('DON'), cardTypes: { CARD: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe); match.players[actor].zones.leader[0].rotated = sourceRest;
  if (sourceChar) match.players[actor].zones.character[0] = { ...match.players[actor].zones.deck.shift(), faceUp: true, rotated: sourceRest };
  const lifeCards = match.players[1 - actor].zones.life.splice(life); match.players[1 - actor].zones.hand.push(...lifeCards.map(card => ({ ...card, faceUp: true })));
  if (targetRest !== null) match.players[1 - actor].zones.character[0] = { ...match.players[1 - actor].zones.deck.shift(), faceUp: true, rotated: targetRest };
  const catalog = new EffectCatalog([{ dslVersion: 1, effectId: 'TEST.counter', cardId: 'LEADER', trigger: { kind: 'activate', window: 'counter' }, costs: [], actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] }]);
  const owner = new EffectMatchOwner(match, catalog, true); let p = freezeState({ ...createProgression(actor), turnNumber: turn, phaseToken: phaseToken(turn, 'refresh') });
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  owner.adopt(p); owner.prepareRegisteredIdle({ status: 'certifiedNone' }, undefined, enabled);
  if (enabled) owner.pinLocalBattleMaster(battleMaster);
  const endpoint = new OwnedEffectEndpoint(owner), source = { instanceId: (sourceChar ? match.players[actor].zones.character[0] : match.players[actor].zones.leader[0]).id, generation: 0 };
  const target = { instanceId: (targetRest === null ? match.players[1 - actor].zones.leader[0] : match.players[1 - actor].zones.character[0]).id, generation: 0 };
  function base(seat, requestId) { const v = endpoint.viewFor(seat); return { matchId: v.matchId, resolutionId: v.effect.resolutionId, requestId, expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision }; }
  function attack(patch = {}, requestId = 'attack') { return { kind: 'testAttack', ...base(actor, requestId), source: { ...source }, target: { ...target }, ...patch }; }
  function decision(seat, action, requestId = action) { return { kind: 'testBattleDecision', ...base(seat, requestId), battleId: endpoint.viewFor(seat).battle.battleId, decision: action }; }
  function ready() { assert.equal(endpoint.handle(actor, attack()).ok, true); assert.equal(endpoint.handle(1 - actor, decision(1 - actor, 'passBlock')).ok, true); assert.equal(endpoint.handle(1 - actor, decision(1 - actor, 'endCounter')).ok, true); }
  function damage(seat = 1 - actor, requestId = 'resolve') { return { kind: 'testResolveDamage', ...base(seat, requestId), battleId: endpoint.viewFor(seat).battle.battleId }; }
  return { owner, endpoint, source, target, base, attack, decision, actor, ready, damage };
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

test('equal power deals one private life-to-hand move and repeated damage does not apply twice', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor }); s.ready(); const defender = 1 - actor, before = s.owner.snapshot(), c = s.damage();
    assert.equal(s.endpoint.viewFor(actor).testDamageAvailable, false); assert.equal(s.endpoint.viewFor(defender).testDamageAvailable, true);
    assert.equal(s.endpoint.viewFor(defender).battlePower.masterVersion, master.version);
    const r = s.endpoint.handle(defender, c); assert.equal(r.ok, true); assert.equal(r.view.battle, null);
    assert.equal(r.view.movement.players[defender].life.length, 4); assert.equal(r.view.movement.players[defender].hand.length, 6);
    const top = before.movement.players[defender].life[0]; assert.equal(s.owner.snapshot().movement.cards[top].faceUp, true);
    assert.equal(s.endpoint.viewFor(actor).movement.players[defender].hand.every(card => card.cardId === null), true);
    const after = s.owner.snapshot(); assert.equal(s.endpoint.handle(defender, c).replayed, true); assert.equal(s.owner.snapshot().movement, after.movement);
  }
});
test('lower attack power ends without damage, while a winning attack KOs a character', () => {
  const weak = setup({ sourceChar: true }); weak.ready(); const before = weak.owner.snapshot();
  assert.equal(weak.endpoint.handle(1, weak.damage()).ok, true); assert.equal(weak.endpoint.viewFor(0).battle, null);
  assert.deepEqual(weak.owner.snapshot().movement.players[1].life, before.movement.players[1].life);
  const ko = setup({ targetRest: true }); ko.ready(); assert.equal(ko.endpoint.handle(1, ko.damage()).ok, true);
  assert.equal(ko.owner.snapshot().movement.players[1].character[0], null); assert.equal(ko.owner.snapshot().movement.players[1].trash.includes(ko.target.instanceId), true);
});
test('last life is not lethal, but a leader at zero life loses and further actions are refused', () => {
  const last = setup({ life: 1 }); last.ready(); const r = last.endpoint.handle(1, last.damage()); assert.equal(r.ok, true); assert.equal(r.view.progression.finished, false); assert.equal(r.view.movement.players[1].life.length, 0);
  const lethal = setup({ life: 0 }); lethal.ready(); const c = lethal.damage(), result = lethal.endpoint.handle(1, c);
  assert.equal(result.ok, true); assert.equal(result.view.progression.finished, true); assert.equal(result.view.progression.winner, 0); assert.equal(result.view.battle, null);
  assert.equal(lethal.endpoint.viewFor(0).progression.winner, 0); assert.equal(lethal.endpoint.viewFor(0).testAttackAvailable, false);
  assert.equal(lethal.endpoint.handle(1, c).replayed, true); assert.equal(lethal.endpoint.handle(0, lethal.attack({}, 'again')).ok, false);
});
test('missing or conflicting power remains unknown; zero is valid and the master cannot be replaced', () => {
  const conflicting = parseMaster(JSON.stringify({ cards: { LEADER: { type: 'character', power: 5000 } } }));
  for (const battleMaster of [null, conflicting]) {
    const s = setup({ battleMaster }); s.ready(); const before = s.owner.snapshot();
    assert.equal(s.endpoint.viewFor(1).testDamageAvailable, false); assert.equal(s.endpoint.handle(1, s.damage()).ok, false); assert.equal(s.owner.snapshot().movement, before.movement);
  }
  const zero = setup({ battleMaster: parseMaster(JSON.stringify({ cards: { LEADER: { type: 'leader', power: 0 } } })) }); zero.ready();
  assert.equal(zero.endpoint.viewFor(1).battlePower.attack, 0); assert.equal(zero.endpoint.handle(1, zero.damage()).ok, true);
  assert.throws(() => zero.owner.pinLocalBattleMaster(master));
});
test('damage ignores defender attached DON power and rejects wrong roles or client-provided numbers', () => {
  const s = setup(); s.ready(); const state = s.owner.snapshot(), ops = [];
  for (const actor of [0, 1]) {
    const id = state.movement.players[actor].donDeck[0], card = state.movement.cards[id], target = actor === 0 ? s.source : s.target;
    ops.push({ kind: 'move', card: { instanceId: id, generation: card.generation }, from: { player: actor, zone: 'donDeck' }, to: { player: actor, zone: 'activeDon', position: 'append', faceUp: true, rotated: false }, cause: 'RULE_PROCESSING' });
    ops.push({ kind: 'attachDon', card: { instanceId: id, generation: card.generation + 1 }, target });
  }
  const modified = new MovementStore(state.movement).commit({ transactionId: 'attached', matchId: state.movement.matchId, expectedRevision: state.movement.revision, turnNumber: state.movement.turnNumber, actor: 0, source: null, effectController: null, mode: 'rule', resolutionId: null, operations: ops }, { status: 'certifiedNone' }).state;
  const powers = localBattlePower(modified, state.progression, master); assert.equal(powers.attack, 6000); assert.equal(powers.defense, 5000);
  assert.equal(s.endpoint.handle(0, s.damage(0)).ok, false); assert.equal(s.endpoint.handle(1, { ...s.damage(), attackPower: 99999 }).code, 'invalid_command');
  assert.equal(s.endpoint.handle(1, { ...s.damage(), battleId: 'old' }).ok, false);
});
