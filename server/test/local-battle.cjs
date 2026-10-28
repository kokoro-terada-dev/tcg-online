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
const counterMaster = parseMaster(JSON.stringify({ cards: { LEADER: { type: 'leader', power: 5000 }, CARD: { type: 'character', power: 2000, counter: 1000 } } }));
function setup({ actor = 0, turn = 3, targetRest = null, sourceRest = false, enabled = true, sourceChar = false, life = 5, battleMaster = master, blockerRest } = {}) {
  const recipe = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CARD'), donDeck: Array(10).fill('DON'), cardTypes: { CARD: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe); match.players[actor].zones.leader[0].rotated = sourceRest;
  if (sourceChar) match.players[actor].zones.character[0] = { ...match.players[actor].zones.deck.shift(), faceUp: true, rotated: sourceRest };
  const lifeCards = match.players[1 - actor].zones.life.splice(life); match.players[1 - actor].zones.hand.push(...lifeCards.map(card => ({ ...card, faceUp: true })));
  if (targetRest !== null) match.players[1 - actor].zones.character[0] = { ...match.players[1 - actor].zones.deck.shift(), faceUp: true, rotated: targetRest };
  if (blockerRest !== undefined) match.players[1 - actor].zones.character[1] = { ...match.players[1 - actor].zones.deck.shift(), faceUp: true, rotated: blockerRest };
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
  function choice(label = '手札へ', requestId = 'choice') {
    const seat = 1 - actor, pending = endpoint.viewFor(seat).damageChoice;
    return { kind: 'testDamageChoice', ...base(seat, requestId), battleId: pending.battleId, selectionId: pending.selectionId, token: pending.options.find(option => option.label === label).token };
  }
  function block(seat = 1 - actor, requestId = 'block') {
    const v = endpoint.viewFor(seat);
    return { kind: 'testBlock', ...base(seat, requestId), battleId: v.battle?.battleId ?? 'none', blocker: { instanceId: match.players[1 - actor].zones.character[1]?.id ?? 'missing', generation: 0 } };
  }
  function counter(seat = 1 - actor, requestId = 'counter') {
    const v = endpoint.viewFor(seat);
    return { kind: 'testHandCounter', ...base(seat, requestId), battleId: v.battle?.battleId ?? 'none', card: { ...v.movement.players[seat].hand[0].ref } };
  }
  return { owner, endpoint, source, target, base, attack, decision, actor, ready, damage, choice, block, counter };
}

test('hand counters stay private until used, accumulate on both views and prevent leader damage for either defender', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor, battleMaster: counterMaster }), defender = 1 - actor;
    s.endpoint.handle(actor, s.attack()); s.endpoint.handle(defender, s.decision(defender, 'passBlock'));
    const before = s.endpoint.viewFor(defender), c = s.counter();
    assert.equal(before.testCounterCandidates.length, 5); assert.equal(before.testCounterCandidates[0].counter, 1000);
    assert.deepEqual(s.endpoint.viewFor(actor).testCounterCandidates, []);
    assert.equal(s.endpoint.viewFor(actor).movement.players[defender].hand.every(card => card.cardId === null && card.ref === null), true);
    const r = s.endpoint.handle(defender, c); assert.equal(r.ok, true); assert.equal(r.view.battleCounter, 1000); assert.equal(r.view.battlePower.defense, 6000);
    assert.equal(r.view.battle.step, 'counter'); assert.equal(r.view.movement.players[defender].hand.length, 4);
    assert.equal(r.view.movement.players[defender].trash[0].ref.instanceId, c.card.instanceId);
    assert.equal(s.endpoint.viewFor(actor).movement.players[defender].trash[0].cardId, 'CARD'); assert.equal(s.endpoint.viewFor(actor).battleCounter, 1000);
    assert.equal(s.endpoint.handle(defender, c).replayed, true); assert.equal(s.endpoint.viewFor(defender).battleCounter, 1000);
    assert.equal(s.endpoint.handle(defender, s.counter(defender, 'counter2')).view.battleCounter, 2000);
    assert.equal(s.endpoint.viewFor(actor).battlePower.defense, 7000);
    s.endpoint.handle(defender, s.decision(defender, 'endCounter'));
    assert.equal(s.endpoint.viewFor(actor).battleCounter, 2000);
    const result = s.endpoint.handle(defender, s.damage()); assert.equal(result.ok, true); assert.equal(result.view.battle, null);
    assert.equal(result.view.movement.players[defender].life.length, 5); assert.equal(result.view.damageChoice, null); assert.equal(result.view.battleCounter, 0);
    for (const seat of [actor, defender]) assert.equal(s.endpoint.handle(seat, { kind: 'testNextTurn', ...s.base(seat, `next-${seat}`) }).ok, true);
    assert.equal(s.endpoint.handle(actor, s.attack({}, 'next-attack')).ok, true); assert.equal(s.endpoint.viewFor(defender).battleCounter, 0); assert.equal(s.endpoint.viewFor(defender).battlePower.defense, 5000);
  }
});

test('hand counter rejects wrong players, phases, card references, values and modified retries atomically', () => {
  const s = setup({ battleMaster: counterMaster }); s.endpoint.handle(0, s.attack());
  assert.equal(s.endpoint.handle(1, s.counter()).ok, false);
  s.endpoint.handle(1, s.decision(1, 'passBlock')); const c = s.counter(1, 'valid-counter'), before = s.owner.snapshot();
  assert.equal(s.endpoint.handle(0, s.counter(0, 'wrong-player')).ok, false);
  let n = 0;
  for (const patch of [{ card: s.target }, { card: { ...c.card, generation: 1 } }, { battleId: 'old' }, { resolutionId: 'old' }, { expectedMovementRevision: 999 }, { expectedProgressionRevision: 999 }, { counter: 99999 }]) assert.equal(s.endpoint.handle(1, { ...c, ...patch, requestId: `bad-counter-${n++}` }).ok, false);
  assert.equal(s.owner.snapshot().movement, before.movement); assert.equal(s.endpoint.viewFor(1).battleCounter, 0);
  assert.equal(s.endpoint.handle(1, c).ok, true);
  assert.equal(s.endpoint.handle(1, { ...c, card: s.target }).code, 'request_conflict');
  assert.equal(s.endpoint.handle(1, { ...c, ...s.base(1, 'used-again') }).ok, false);
  s.endpoint.handle(1, s.decision(1, 'endCounter')); assert.equal(s.endpoint.handle(1, s.counter(1, 'after-end')).ok, false);
});

test('missing, null, zero or conflicting counter metadata does not enable character hand counters', () => {
  for (const battleMaster of [null, master, ...[null, 0].map(counter => parseMaster(JSON.stringify({ cards: { LEADER: { type: 'leader', power: 5000 }, CARD: { type: 'character', counter } } }))), parseMaster(JSON.stringify({ cards: { LEADER: { type: 'leader', power: 5000 }, CARD: { type: 'event', counter: 1000 } } }))]) {
    const s = setup({ battleMaster }); s.endpoint.handle(0, s.attack()); s.endpoint.handle(1, s.decision(1, 'passBlock'));
    assert.deepEqual(s.endpoint.viewFor(1).testCounterCandidates, []);
    const before = s.owner.snapshot(); assert.equal(s.endpoint.handle(1, s.counter()).ok, false); assert.equal(s.owner.snapshot().movement, before.movement);
  }
});

test('hand counter bonus survives counter effect resolution and applies to the redirected character target', () => {
  const s = setup({ battleMaster: counterMaster, blockerRest: false }); s.endpoint.handle(0, s.attack()); s.endpoint.handle(1, s.block());
  assert.equal(s.endpoint.handle(1, s.counter()).ok, true);
  s.owner.openRegisteredEffect('TEST.counter', 1, s.target, { status: 'certifiedNone' });
  assert.equal(s.endpoint.viewFor(0).battleCounter, 1000); assert.equal(s.endpoint.viewFor(0).battlePower.defense, 3000);
  assert.equal(s.endpoint.handle(1, s.counter(1, 'during-effect')).ok, false);
  for (const kind of ['beginCosts', 'commitCosts', 'advance']) assert.equal(s.endpoint.handle(1, { kind, ...s.base(1, `counter-effect-${kind}`) }).ok, true);
  assert.equal(s.endpoint.viewFor(1).battleCounter, 1000); assert.equal(s.endpoint.viewFor(1).testCounterCandidates.length, 5);
  s.endpoint.handle(1, s.decision(1, 'endCounter')); const r = s.endpoint.handle(1, s.damage());
  assert.equal(r.ok, true); assert.equal(r.view.movement.players[1].character[1], null); assert.equal(r.view.battleCounter, 0); assert.equal(r.view.movement.players[1].life.length, 5);
});

test('counter addition never replaces unknown printed power with zero and rejects numeric overflow before moving a card', () => {
  const missingPower = parseMaster(JSON.stringify({ cards: { LEADER: { type: 'leader' }, CARD: { type: 'character', counter: 1000 } } }));
  const s = setup({ battleMaster: missingPower }); s.endpoint.handle(0, s.attack()); s.endpoint.handle(1, s.decision(1, 'passBlock'));
  assert.equal(s.endpoint.handle(1, s.counter()).ok, true); assert.equal(s.endpoint.viewFor(1).battleCounter, 1000); assert.equal(s.endpoint.viewFor(1).battlePower.defense, null);
  s.endpoint.handle(1, s.decision(1, 'endCounter')); assert.equal(s.endpoint.viewFor(1).testDamageAvailable, false);
  assert.equal(s.endpoint.handle(1, s.damage()).ok, false);
  const huge = setup({ battleMaster: counterMaster }); huge.endpoint.handle(0, huge.attack()); huge.endpoint.handle(1, huge.decision(1, 'passBlock'));
  const state = huge.owner.snapshot(), card = huge.counter().card;
  const { counterLocalHandCard } = require('../dist/test/localBattle.js');
  assert.throws(() => counterLocalHandCard(state.movement, state.progression, 1, state.progression.battle.battleId, card, counterMaster, Number.MAX_SAFE_INTEGER, 'overflow'));
  assert.equal(huge.owner.snapshot().movement, state.movement); assert.equal(huge.endpoint.viewFor(1).movement.players[1].hand.length, 5);
});

test('local block rests only the selected defender character and keeps the original attack source for both seats', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor, blockerRest: false }), defender = 1 - actor;
    assert.deepEqual(s.endpoint.viewFor(defender).testBlockCandidateIds, []);
    assert.equal(s.endpoint.handle(actor, s.attack()).ok, true);
    const c = s.block(), before = s.owner.snapshot();
    assert.deepEqual(s.endpoint.viewFor(defender).testBlockCandidateIds, [c.blocker.instanceId]);
    assert.deepEqual(s.endpoint.viewFor(actor).testBlockCandidateIds, []);
    const r = s.endpoint.handle(defender, c); assert.equal(r.ok, true);
    assert.equal(r.view.battle.step, 'counter'); assert.deepEqual(r.view.battle.source, s.source); assert.deepEqual(r.view.battle.target, c.blocker);
    assert.deepEqual(s.endpoint.viewFor(actor).battle, r.view.battle);
    assert.equal(s.owner.snapshot().movement.cards[c.blocker.instanceId].rotated, true);
    assert.equal(s.owner.snapshot().movement.cards[s.target.instanceId].rotated, before.movement.cards[s.target.instanceId].rotated);
    assert.equal(r.view.testBattleDecision, 'endCounter'); assert.deepEqual(r.view.testBlockCandidateIds, []);
    const after = s.owner.snapshot(); assert.equal(s.endpoint.handle(defender, c).replayed, true); assert.equal(s.owner.snapshot().movement, after.movement);
    assert.equal(s.endpoint.handle(defender, s.decision(defender, 'endCounter')).ok, true);
    const damage = s.endpoint.handle(defender, s.damage()); assert.equal(damage.ok, true); assert.equal(damage.view.battle, null);
    assert.equal(damage.view.movement.players[defender].character[1], null);
    assert.equal(damage.view.movement.players[defender].trash[0].ref.instanceId, c.blocker.instanceId);
    assert.equal(damage.view.movement.players[defender].life.length, 5);
  }
});

test('block rejects wrong roles, rested/foreign/stale cards and extra authority fields without changing the board', () => {
  const s = setup({ blockerRest: false }); s.endpoint.handle(0, s.attack()); const before = s.owner.snapshot();
  assert.equal(s.endpoint.handle(0, s.block(0)).ok, false);
  const c = s.block();
  let invalid = 0;
  for (const patch of [{ blocker: s.source }, { blocker: s.target }, { blocker: { ...c.blocker, generation: 1 } }, { battleId: 'old' }, { expectedMovementRevision: 999 }, { expectedProgressionRevision: 999 }, { resolutionId: 'old' }, { target: s.target }]) {
    assert.equal(s.endpoint.handle(1, { ...c, ...patch, requestId: `invalid-${invalid++}` }).ok, false);
  }
  assert.equal(s.owner.snapshot().movement, before.movement); assert.equal(s.owner.snapshot().progression, before.progression);
  assert.equal(s.endpoint.handle(1, c).ok, true);
  assert.equal(s.endpoint.handle(1, { ...c, blocker: s.target }).code, 'request_conflict');
  assert.equal(s.endpoint.handle(1, { ...s.block(), ...s.base(1, 'block-again') }).ok, false);
  const rested = setup({ blockerRest: true }); rested.endpoint.handle(0, rested.attack());
  assert.deepEqual(rested.endpoint.viewFor(1).testBlockCandidateIds, []); assert.equal(rested.endpoint.handle(1, rested.block()).ok, false);
  const disabled = setup({ blockerRest: false, enabled: false }); assert.equal(disabled.endpoint.handle(1, disabled.block()).ok, false);
});

test('block is rejected while an effect or life choice is pending and after passing the block window', () => {
  const s = setup({ blockerRest: false }); s.endpoint.handle(0, s.attack());
  s.owner.openRegisteredEffect('TEST.counter', 1, s.target, { status: 'certifiedNone' });
  assert.equal(s.endpoint.handle(1, s.block()).ok, false); assert.equal(s.endpoint.viewFor(1).testBlockCandidateIds, undefined);
  const passed = setup({ blockerRest: false }); passed.ready();
  assert.equal(passed.endpoint.handle(1, passed.block()).ok, false);
  assert.equal(passed.endpoint.handle(1, passed.damage()).ok, true);
  const before = passed.owner.snapshot(); assert.equal(passed.endpoint.handle(1, passed.block(1, 'during-choice')).ok, false);
  assert.equal(passed.owner.snapshot().movement, before.movement); assert.equal(passed.owner.snapshot().progression, before.progression);
});
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
    const pending = s.endpoint.handle(defender, c); assert.equal(pending.ok, true); assert.equal(pending.view.progression.gate, 'choice');
    assert.equal(pending.view.movement.players[defender].life.length, 5);
    assert.equal(pending.view.movement.players[defender].life[0].cardId, 'CARD');
    assert.equal(s.owner.snapshot().movement.cards[before.movement.players[defender].life[0]].faceUp, false);
    const hidden = s.endpoint.viewFor(actor); assert.equal(hidden.movement.players[defender].life[0].cardId, null); assert.equal(hidden.movement.players[defender].life[0].ref, null); assert.deepEqual(hidden.damageChoice.options, []);
    const choice = s.choice(), r = s.endpoint.handle(defender, choice); assert.equal(r.ok, true); assert.equal(r.view.battle, null); assert.equal(r.view.damageChoice, null);
    assert.equal(r.view.movement.players[defender].life.length, 4); assert.equal(r.view.movement.players[defender].hand.length, 6);
    const top = before.movement.players[defender].life[0]; assert.equal(s.owner.snapshot().movement.cards[top].faceUp, true);
    assert.equal(s.endpoint.viewFor(actor).movement.players[defender].hand.every(card => card.cardId === null), true);
    const after = s.owner.snapshot(); assert.equal(s.endpoint.handle(defender, c).replayed, true); assert.equal(s.owner.snapshot().movement, after.movement);
    assert.equal(s.endpoint.handle(defender, choice).replayed, true); assert.equal(s.owner.snapshot().movement, after.movement);
    assert.equal(r.view.progression.gate, 'idle'); assert.equal(after.movement.reveals.length, 0);
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
  const last = setup({ life: 1 }); last.ready(); assert.equal(last.endpoint.handle(1, last.damage()).ok, true); const r = last.endpoint.handle(1, last.choice()); assert.equal(r.ok, true); assert.equal(r.view.progression.finished, false); assert.equal(r.view.movement.players[1].life.length, 0);
  const lethal = setup({ life: 0 }); lethal.ready(); const c = lethal.damage(), result = lethal.endpoint.handle(1, c);
  assert.equal(result.ok, true); assert.equal(result.view.progression.finished, true); assert.equal(result.view.progression.winner, 0); assert.equal(result.view.battle, null);
  assert.equal(lethal.endpoint.viewFor(0).progression.winner, 0); assert.equal(lethal.endpoint.viewFor(0).testAttackAvailable, false);
  assert.equal(lethal.endpoint.handle(1, c).replayed, true); assert.equal(lethal.endpoint.handle(0, lethal.attack({}, 'again')).ok, false);
});

test('life trigger choice publishes exactly one top card, locks progression and rejects forged or foreign choices', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor }); s.ready(); const defender = 1 - actor;
    assert.equal(s.endpoint.handle(defender, s.damage()).ok, true);
    const before = s.owner.snapshot(), c = s.choice('トリガー発動');
    assert.equal(s.endpoint.handle(actor, c).ok, false);
    for (const patch of [{ token: 'forged' }, { selectionId: 'old' }, { battleId: 'old' }, { expectedMovementRevision: 999 }, { destination: 'hand' }]) {
      assert.equal(s.endpoint.handle(defender, { ...c, ...patch, requestId: `bad-${Object.keys(patch)[0]}` }).ok, false);
    }
    assert.equal(s.endpoint.handle(actor, { kind: 'testNextTurn', ...s.base(actor, 'turn') }).ok, false);
    assert.equal(s.endpoint.handle(actor, { kind: 'testPlayCard', ...s.base(actor, 'play-wait'), source: s.endpoint.viewFor(actor).movement.players[actor].hand[0].ref }).ok, false);
    assert.equal(s.owner.snapshot().movement, before.movement);
    assert.throws(() => s.owner.openRegisteredEffect('TEST.counter', defender, s.target, { status: 'certifiedNone' }));
    const r = s.endpoint.handle(defender, c); assert.equal(r.ok, true); assert.equal(r.view.battle, null); assert.equal(r.view.progression.gate, 'idle');
    assert.equal(r.view.movement.players[defender].life.length, 4); assert.equal(r.view.movement.players[defender].hand.length, 5);
    const card = r.view.movement.players[defender].public[0]; assert.equal(card.cardId, 'CARD'); assert.equal(card.faceUp, true);
    assert.deepEqual(s.endpoint.viewFor(actor).movement.players[defender].public[0], card);
    assert.equal(s.owner.snapshot().movement.reveals.length, 0);
    const after = s.owner.snapshot(); assert.equal(s.endpoint.handle(defender, c).replayed, true); assert.equal(s.owner.snapshot().movement, after.movement);
    assert.equal(s.endpoint.handle(defender, { ...c, token: 'changed' }).code, 'request_conflict');
    assert.equal(s.endpoint.handle(defender, { ...c, ...s.base(defender, 'new-request-old-token') }).ok, false);
  }
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
