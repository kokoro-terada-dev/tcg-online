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
const always = () => ({ type: 'all', conditions: [] });
function setup(actor, direct = false) {
  let koData;
  const plans = ['leader', 'character'].map(kind => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-main-draw.json'), 'utf8'));
    Object.assign(data, { cardId: kind.toUpperCase(), cardType: kind, reviewStatus: 'approved' }); data.baseStats.power = kind === 'leader' ? 5000 : 2000;
    data.source.text = 'Synthetic KO recovery fixture. Not an official card.';
    const actions = kind === 'leader' ? [
      { type: 'SELECT', bindAs: 'victim', selector: { type: 'CARDS', owner: 'OPPONENT', controller: 'OPPONENT', chooser: 'SELF', zone: 'character', cardTypes: ['character'], filters: always(), excludeSource: false, faceUpOnly: true, visibility: 'PUBLIC', min: 1, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' } },
      direct ? { type: 'MOVE_CARD', cards: { ref: 'bindings.victim' }, destination: { owner: 'OPPONENT', zone: 'trash', position: 'append', faceUp: true }, cause: 'EFFECT' } : { type: 'KO', cards: { ref: 'bindings.victim' } },
    ] : [{ type: 'BIND_SOURCE', bindAs: 'self' }, { type: 'MOVE_CARD', cards: { ref: 'bindings.self' }, destination: { owner: 'SELF', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' }, { type: 'DRAW', player: 'SELF', count: 1 }];
    data.effects = [{ id: 'effect', kind: kind === 'leader' ? 'activated' : 'triggered', timing: { type: kind === 'leader' ? 'MAIN' : 'ON_KO' }, sourceZones: [kind], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions }];
    if (kind === 'character') koData = data;
    return compileV3CardJson(JSON.stringify(data));
  });
  const catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ status: 'approved', cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion, definitionHash: plan.definitionHash,
    sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, rulesetVersion: 'synthetic.1', reviewer: 'fixture', approvedAt: '2026-10-29T00:00:00.000Z', ruleEvidence: ['synthetic:not-official-cards'] })), 'synthetic.1');
  const recipe = { name: 'Fixture', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHARACTER'), donDeck: Array(10).fill('DON'), cardTypes: { CHARACTER: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe), zones = match.players[1 - actor].zones; zones.character[0] = { ...zones.deck.shift(), faceUp: true, rotated: true };
  const board = new MatchMovementCapture(match, 3).snapshot().movement;
  let progression = createProgression(actor);
  while (true) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') { if (progression.turnNumber === 3) break; progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain'); }
    else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  const c = new V3SyntheticMatchCoordinator({ mode: 'syntheticNoAbilities', movement: board, progression, cards: plans.map(plan => catalog.get(plan.definition.cardId)), signingKey: Buffer.alloc(32, 13), master: null, now: () => 1000 });
  return { c, source: { instanceId: board.players[actor].leader[0], generation: 0 }, target: { instanceId: board.players[1 - actor].character[0], generation: 0 }, koData };
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
for (const [actor, battle] of [[0, true], [1, false]]) test(`KO effects resolve the current trash object, unlike direct trash moves (seat=${actor}, battle=${battle})`, () => {
  const { c, source, target, koData } = setup(actor), owner = 1 - actor;
  if (battle) {
    c.attack(actor, 'attack', c.context(), source, target); c.battleDecision(owner, 'pass', c.context(), 'passBlock'); c.battleDecision(owner, 'counter-end', c.context(), 'endCounter'); c.resolveDamage(owner, 'damage', c.context());
    assert.equal(c.viewFor(actor).damageEffectsPending, true); assert.equal(c.viewFor(actor).battle.step, 'damage');
    assert.throws(() => c.resolveDamage(owner, 'damage-again', c.context()));
  } else { c.activate(actor, 'main-ko', c.context(), source, 'effect'); complete(c, actor); }
  const pending = c.viewFor(owner).triggerChoices[0]; assert.equal(pending.timing, 'ON_KO');
  assert.equal(c.snapshotForCoordinator().movement.cards[target.instanceId].generation, 1);
  assert.throws(() => c.resolveTrigger(actor, 'wrong-controller', c.context(), pending.token));
  c.resolveTrigger(owner, 'ko-effect', c.context(), pending.token); complete(c, owner);
  assert.equal(c.viewFor(owner).pendingTriggerCount, 0); assert.equal(c.viewFor(owner).battle, null); assert.equal(c.viewFor(owner).damageEffectsPending, false);
  assert.equal(c.snapshotForCoordinator().movement.cards[target.instanceId].generation, 2); assert.equal(c.viewFor(owner).movement.players[owner].hand.length, 7);
  assert.equal(c.viewFor(actor).movement.players[owner].hand.every(card => card.cardId === null && card.ref === null), true);
  const ordinary = setup(actor, true); ordinary.c.activate(actor, 'direct', ordinary.c.context(), ordinary.source, 'effect'); complete(ordinary.c, actor);
  assert.equal(ordinary.c.viewFor(owner).pendingTriggerCount, 0); assert.equal(ordinary.c.viewFor(owner).movement.players[owner].hand.length, 5);
  const paid = structuredClone(koData); paid.effects[0].costs = [{ type: 'REST_DON', count: 1 }]; assert.throws(() => compileV3CardJson(JSON.stringify(paid)), /ko-activation-cost-unresolved/);
  const facts = structuredClone(koData); facts.effects[0].resolutionConditions = { type: 'compare', left: { ref: 'SOURCE.power' }, op: 'gte', right: 0 }; assert.throws(() => compileV3CardJson(JSON.stringify(facts)), /ko-source-facts-unresolved/);
});
