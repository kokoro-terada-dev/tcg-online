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
const raw = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-main-draw.json'), 'utf8'));
function eventData(bounce) {
  const data = raw(); Object.assign(data, { cardId: 'EVENT', cardType: 'event', reviewStatus: 'approved', baseStats: { cost: 1, power: null, counter: null, life: null } });
  data.source.text = 'Synthetic counter test, not an official card.';
  const selector = { type: 'CARDS', owner: bounce ? 'OPPONENT' : 'SELF', controller: bounce ? 'OPPONENT' : 'SELF', chooser: 'SELF', zone: bounce ? 'character' : 'leader', cardTypes: [bounce ? 'character' : 'leader'],
    filters: bounce ? always() : { type: 'compare', left: { ref: 'CANDIDATE.power' }, op: 'gte', right: 6000 }, excludeSource: false, faceUpOnly: true, visibility: 'PUBLIC', min: 1, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' };
  data.effects = [{ id: 'counter', kind: 'activated', timing: { type: 'COUNTER' }, sourceZones: ['hand'], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions: [
    { type: 'SELECT', bindAs: 'target', selector },
    bounce === 'ko' ? { type: 'KO', cards: { ref: 'bindings.target' } } : bounce ? { type: 'MOVE_CARD', cards: { ref: 'bindings.target' }, destination: { owner: 'OPPONENT', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' } :
      { type: 'MODIFY_STAT', cards: { ref: 'bindings.target' }, stat: 'power', amount: 2000, duration: { type: 'BATTLE_END' } },
  ] }]; return data;
}
function setup(actor, bounce = false, activeDon = 2) {
  const plans = ['leader', 'character'].map(kind => {
    const data = raw(); Object.assign(data, { cardId: kind.toUpperCase(), cardType: kind, reviewStatus: 'approved', effects: [], keywords: [] });
    data.baseStats.power = 5000; data.baseStats.counter = kind === 'character' ? 1000 : null; data.source.text = '';
    if (bounce === 'ko' && kind === 'character') {
      data.source.text = 'Synthetic KO trigger, not an official card.';
      data.effects = [{ id: 'ko', kind: 'triggered', timing: { type: 'ON_KO' }, sourceZones: ['character'], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }];
    }
    return compileV3CardJson(JSON.stringify(data));
  }); plans.push(compileV3CardJson(JSON.stringify(eventData(bounce))));
  const catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ status: 'approved', cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion, definitionHash: plan.definitionHash,
    sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, rulesetVersion: 'synthetic.1', reviewer: 'fixture', approvedAt: '2026-10-29T00:00:00.000Z', ruleEvidence: ['synthetic:not-official-cards'] })), 'synthetic.1');
  const recipe = { name: 'Fixture', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHARACTER'), donDeck: Array(10).fill('DON'), cardTypes: { CHARACTER: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe), peer = 1 - actor;
  Object.assign(match.players[actor].zones.hand[0], { cardId: 'EVENT', kind: 'event' });
  for (let n = 0; n < activeDon; n++) match.players[actor].zones.activeDon.push({ ...match.players[actor].zones.donDeck.shift(), faceUp: true, rotated: false });
  match.players[peer].zones.character[0] = { ...match.players[peer].zones.deck.shift(), faceUp: true, rotated: false };
  const board = structuredClone(new MatchMovementCapture(match, 3).snapshot().movement);
  let progression = createProgression(peer);
  while (true) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') { if (progression.turnNumber === 3) break; progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain'); }
    else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  const c = new V3SyntheticMatchCoordinator({ mode: 'syntheticNoAbilities', movement: board, progression, cards: plans.map(plan => catalog.get(plan.definition.cardId)), signingKey: Buffer.alloc(32, 13), master: null, now: () => 1000 });
  const ref = id => ({ instanceId: id, generation: board.cards[id].generation });
  const event = ref(board.players[actor].hand[0]), target = ref(board.players[actor].leader[0]);
  c.attack(peer, 'attack', c.context(), ref(board.players[peer].character[0]), target); c.battleDecision(actor, 'pass', c.context(), 'passBlock');
  return { c, event, target, peer };
}
let seq = 0;
function complete(c, actor) {
  for (let i = 0; i < 20; i++) {
    const view = c.viewFor(actor); if (!view.frame || view.frame.status === 'completed') return;
    if (view.frame.status === 'ready') c.advance(actor, `advance-${++seq}`, c.context());
    else if (view.frame.status === 'waitingForWork') c.applyPendingWork(actor, `work-${++seq}`, c.context());
    else { assert.ok(view.frame.choice); const choice = view.frame.choice; c.answer(actor, `answer-${++seq}`, c.context(), choice.selectionId, choice.options.slice(0, choice.min).map(option => option.token)); }
  }
  assert.fail('Counter event did not complete');
}
for (const actor of [0, 1]) test(`counter event pays once, keeps hidden choices private, and returns to the counter window (seat=${actor})`, () => {
  const { c, event, target, peer } = setup(actor);
  assert.equal(c.viewFor(actor).counterEventChoices.length, 1); assert.deepEqual(c.viewFor(peer).counterEventChoices, []);
  const handCounter = c.viewFor(actor).counterChoices[0]; c.counter(actor, 'printed-counter', c.context(), handCounter.card, target);
  const before = c.snapshotForCoordinator(), context = c.context(); c.useCounterEvent(actor, 'use', context, event, 'counter');
  assert.equal(c.useCounterEvent(actor, 'use', context, event, 'counter').replayed, true);
  const used = c.snapshotForCoordinator(); assert.equal(used.movement.players[actor].hand.length, before.movement.players[actor].hand.length - 1);
  assert.equal(used.movement.players[actor].restDon.length, 1); assert.equal(used.movement.players[actor].activeDon.length, 1);
  assert.equal(c.viewFor(peer).movement.players[actor].trash.some(card => card.cardId === 'EVENT'), true);
  assert.throws(() => c.battleDecision(actor, 'too-early', c.context(), 'endCounter'));
  c.advance(actor, 'choose', c.context()); assert.equal(c.viewFor(actor).frame.choice.options.length, 1); assert.deepEqual(c.viewFor(peer).frame.choice.options, []);
  complete(c, actor); assert.equal(c.viewFor(actor).battle.powers.defense, 8000); assert.equal(c.viewFor(actor).gate, 'idle');
  const finished = c.snapshotForCoordinator(); assert.throws(() => c.useCounterEvent(actor, 'reuse', c.context(), event, 'counter')); assert.deepEqual(c.snapshotForCoordinator(), finished);
  c.battleDecision(actor, 'end-counter', c.context(), 'endCounter'); c.resolveDamage(actor, 'damage', c.context());
  assert.equal(c.viewFor(actor).battle, null); assert.deepEqual(c.snapshotForCoordinator().statEffects, []);
});
test('unpaid or foreign counter events do not move the card or consume DON', () => {
  const { c, event, peer } = setup(0, false, 0), before = c.snapshotForCoordinator();
  assert.equal(c.viewFor(0).counterEventChoices[0].enabled, false);
  assert.throws(() => c.useCounterEvent(0, 'no-don', c.context(), event, 'counter'));
  assert.throws(() => c.useCounterEvent(peer, 'foreign', c.context(), event, 'counter')); assert.deepEqual(c.snapshotForCoordinator(), before);
});
test('moving the attacker during a counter skips damage when the counter step ends', () => {
  const { c, event } = setup(0, true); c.useCounterEvent(0, 'use', c.context(), event, 'counter'); complete(c, 0);
  assert.equal(c.viewFor(0).battle.step, 'counter'); const life = c.snapshotForCoordinator().movement.players[0].life;
  c.battleDecision(0, 'end-counter', c.context(), 'endCounter'); assert.equal(c.viewFor(0).battle, null);
  assert.deepEqual(c.snapshotForCoordinator().movement.players[0].life, life); assert.equal(c.viewFor(0).lifePending, false);
});
test('counter event compiler refuses unsupported additional activation payments', () => {
  for (const mutate of [d => d.effects[0].costs.push({ type: 'DISCARD_HAND', count: 1 }), d => d.effects[0].optional = true, d => d.effects[0].activationConditions = { type: 'any', conditions: [] }]) {
    const data = eventData(false); mutate(data); assert.throws(() => compileV3CardJson(JSON.stringify(data)));
  }
});
test('KO caused by a counter waits for the owner trigger before the counter step can end', () => {
  const { c, event, peer } = setup(0, 'ko'), hand = c.snapshotForCoordinator().movement.players[peer].hand.length;
  c.useCounterEvent(0, 'use', c.context(), event, 'counter'); complete(c, 0);
  assert.equal(c.viewFor(0).gate, 'trigger'); assert.equal(c.viewFor(peer).triggerChoices[0].timing, 'ON_KO');
  assert.throws(() => c.battleDecision(0, 'pending-ko', c.context(), 'endCounter'));
  c.resolveTrigger(peer, 'resolve-ko', c.context(), c.viewFor(peer).triggerChoices[0].token); complete(c, peer);
  assert.equal(c.snapshotForCoordinator().movement.players[peer].hand.length, hand + 1);
  c.battleDecision(0, 'end-counter', c.context(), 'endCounter'); assert.equal(c.viewFor(0).battle, null);
});
