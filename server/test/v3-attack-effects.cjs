const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');
const { expiryFor, validateExpiry } = require('../dist/test/effects/v3/effectExpiry.js');
const always = () => ({ type: 'all', conditions: [] });
test('battle duration requires a current battle and rejects mixed expiry records', () => {
  assert.throws(() => expiryFor({ type: 'BATTLE_END' }, 0, null));
  assert.deepEqual(expiryFor({ type: 'BATTLE_END' }, 1, 'battle-1'), { endPlayer: null, remaining: null, battleId: 'battle-1' });
  assert.throws(() => validateExpiry({ endPlayer: 0, remaining: 1, battleId: 'battle-1' }));
});
function setup(actor, bounce, battleBuff = false) {
  const plans = ['character', 'leader'].map(kind => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-main-draw.json'), 'utf8'));
    Object.assign(data, { cardId: kind.toUpperCase(), cardType: kind, reviewStatus: 'approved', keywords: kind === 'character' ? [{ type: 'RUSH' }] : [] }); data.baseStats.power = 5000;
    data.source.text = 'Synthetic attack trigger test, not an official card.';
    const actions = bounce && kind === 'character' ? [
      { type: 'SELECT', bindAs: 'self', selector: { type: 'CARDS', owner: 'SELF', controller: 'SELF', chooser: 'SELF', zone: 'character', cardTypes: ['character'], filters: always(), excludeSource: false, faceUpOnly: true, visibility: 'PUBLIC', min: 1, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' } },
      { type: 'MOVE_CARD', cards: { ref: 'bindings.self' }, destination: { owner: 'SELF', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' },
    ] : [{ type: 'DRAW', player: 'SELF', count: 1 }];
    if (battleBuff && kind === 'character') actions.unshift(
      { type: 'SELECT', bindAs: 'battleTarget', selector: { type: 'CARDS', owner: 'OPPONENT', controller: 'OPPONENT', chooser: 'SELF', zone: 'leader', cardTypes: ['leader'], filters: always(), excludeSource: false, faceUpOnly: true, visibility: 'PUBLIC', min: 1, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' } },
      { type: 'MODIFY_STAT', cards: { ref: 'bindings.battleTarget' }, stat: 'power', amount: 1000, duration: { type: 'BATTLE_END' } },
      { type: 'GRANT_KEYWORD', cards: { ref: 'bindings.battleTarget' }, keyword: { type: 'BLOCKER' }, duration: { type: 'BATTLE_END' } },
      { type: 'MODIFY_STAT', cards: { ref: 'bindings.battleTarget' }, stat: 'power', amount: 1000, duration: { type: 'TURN_END', player: 'SELF', occurrence: 1 } },
    );
    data.effects = [{ id: 'attack', kind: 'triggered', timing: { type: kind === 'character' ? 'ON_ATTACK' : 'ON_OPPONENT_ATTACK' }, sourceZones: [kind], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions }];
    return compileV3CardJson(JSON.stringify(data));
  });
  const catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ status: 'approved', cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion, definitionHash: plan.definitionHash,
    sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, rulesetVersion: 'synthetic.1', reviewer: 'fixture', approvedAt: '2026-10-29T00:00:00.000Z', ruleEvidence: ['synthetic:not-official-cards'] })), 'synthetic.1');
  const recipe = { name: 'Fixture', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHARACTER'), donDeck: Array(10).fill('DON'), cardTypes: { CHARACTER: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe), zones = match.players[actor].zones; zones.character[0] = { ...zones.deck.shift(), faceUp: true, rotated: false };
  const board = structuredClone(new MatchMovementCapture(match, 3).snapshot().movement), sourceId = board.players[actor].character[0]; board.cards[sourceId].enteredTurn = 3;
  let progression = createProgression(actor);
  while (true) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') { if (progression.turnNumber === 3) break; progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain'); }
    else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  const c = new V3SyntheticMatchCoordinator({ mode: 'syntheticNoAbilities', movement: board, progression, cards: plans.map(plan => catalog.get(plan.definition.cardId)), signingKey: Buffer.alloc(32, 12), master: null, now: () => 1000 });
  const source = { instanceId: sourceId, generation: 0 }, target = { instanceId: board.players[1 - actor].leader[0], generation: 0 };
  return { c, source, target };
}
let seq = 0;
function complete(c, actor) {
  for (let i = 0; i < 20; i++) {
    const v = c.viewFor(actor); if (!v.frame || v.frame.status === 'completed') return v;
    if (v.frame.status === 'ready') c.advance(actor, `advance-${++seq}`, c.context());
    else if (v.frame.status === 'waitingForWork') c.applyPendingWork(actor, `work-${++seq}`, c.context());
    else { const choice = v.frame.choice; assert.ok(choice); c.answer(actor, `answer-${++seq}`, c.context(), choice.selectionId, choice.options.slice(0, choice.min).map(option => option.token)); }
  }
  assert.fail('Resolution did not complete');
}
for (const [actor, bounce] of [[0, false], [1, true]]) test(`attack triggers preserve priority and resume or stop after participants leave (seat=${actor}, bounce=${bounce})`, () => {
  const { c, source, target } = setup(actor, bounce), peer = 1 - actor;
  c.attack(actor, 'attack', c.context(), source, target);
  assert.equal(c.viewFor(actor).battle.step, 'attack'); assert.equal(c.viewFor(actor).pendingTriggerCount, 2);
  assert.equal(c.viewFor(actor).triggerChoices[0].timing, 'ON_ATTACK'); assert.deepEqual(c.viewFor(peer).triggerChoices, []);
  const otherToken = c.snapshotForCoordinator().pendingTriggers.find(entry => entry.actor === peer).token, before = c.context();
  assert.throws(() => c.resolveTrigger(peer, 'too-early', c.context(), otherToken)); assert.deepEqual(c.context(), before);
  c.resolveTrigger(actor, 'own-trigger', c.context(), c.viewFor(actor).triggerChoices[0].token); complete(c, actor);
  assert.equal(c.viewFor(actor).battle.step, 'attack'); assert.equal(c.viewFor(peer).triggerChoices[0].timing, 'ON_OPPONENT_ATTACK');
  c.resolveTrigger(peer, 'other-trigger', c.context(), c.viewFor(peer).triggerChoices[0].token); complete(c, peer);
  assert.equal(c.viewFor(actor).pendingTriggerCount, 0);
  assert.equal(c.viewFor(actor).battle?.step ?? null, bounce ? null : 'block');
  assert.equal(c.viewFor(actor).movement.players[actor].hand.length, 6); assert.equal(c.viewFor(peer).movement.players[peer].hand.length, 6);
  assert.equal(c.viewFor(actor).movement.players[peer].hand.every(card => card.cardId === null && card.ref === null), true);
  assert.equal(c.viewFor(actor).history.length, 2); assert.equal(c.viewFor(actor).history.every(entry => entry.triggerEventId.startsWith('attack:')), true);
  if (bounce) assert.equal(c.snapshotForCoordinator().movement.cards[source.instanceId].generation, source.generation + 1);
});

for (const actor of [0, 1]) for (const bounce of [false, true]) test(`battle durations expire on normal completion or participant departure (seat=${actor}, bounce=${bounce})`, () => {
  const { c, source, target } = setup(actor, bounce, true), peer = 1 - actor;
  c.attack(actor, 'attack', c.context(), source, target);
  c.resolveTrigger(actor, 'own-trigger', c.context(), c.viewFor(actor).triggerChoices[0].token); complete(c, actor);
  const during = c.snapshotForCoordinator();
  assert.equal(during.statEffects.filter(effect => effect.battleId).length, 1);
  assert.equal(during.keywordGrants.length, 1);
  assert.equal(during.statEffects.find(effect => effect.battleId).battleId, c.viewFor(actor).battle.battleId);
  c.resolveTrigger(peer, 'other-trigger', c.context(), c.viewFor(peer).triggerChoices[0].token); complete(c, peer);
  if (!bounce) {
    assert.equal(c.viewFor(actor).battle.powers.defense, 7000);
    c.battleDecision(peer, 'pass', c.context(), 'passBlock');
    c.battleDecision(peer, 'counter-end', c.context(), 'endCounter');
    c.resolveDamage(peer, 'damage', c.context());
  }
  const after = c.snapshotForCoordinator(); assert.equal(c.viewFor(actor).battle, null);
  assert.equal(after.statEffects.length, 1); assert.equal(after.statEffects[0].stat, 'power'); assert.equal(after.statEffects[0].battleId, undefined);
  assert.deepEqual(after.keywordGrants, []);
  c.endTurn(actor, 'next-turn', c.context()); assert.deepEqual(c.snapshotForCoordinator().statEffects, []);
});
