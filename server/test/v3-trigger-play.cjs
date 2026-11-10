const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, always } = require('./helpers/v3-event.cjs');
const { finish, id } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { prepareLifeTrigger } = require('../dist/test/effects/v3/lifeTriggers.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');

const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const snap = c => c.snapshotForCoordinator();
function setup({ full = false, zone = 'character', double = false, generationLimit = false } = {}) {
  const { options, approval } = base({ don: 0, field: full && zone === 'character' ? 5 : 0 });
  const compile = raw => compileV3CardJson(JSON.stringify(raw));
  const plans = options.cards.map(card => {
    const raw = structuredClone(card.definition);
    if (raw.cardId === 'LEADER' && double) {
      raw.schemaVersion = '3.0.0-subset.43';
      raw.source.text = 'Synthetic Double Attack.';
      raw.keywords = [{ type: 'DOUBLE_ATTACK' }];
    }
    if (raw.cardId === 'TARGET') {
      raw.schemaVersion = '3.0.0-subset.45';
      raw.cardType = zone; raw.baseStats.cost = 9; raw.baseStats.counter = null;
      if (zone === 'stage') raw.baseStats.power = null;
      raw.source.text = 'Synthetic ON_PLAY and optional ON_KO test fixture.';
      raw.source.triggerText = 'Synthetic unconditional self-play.';
      const effect = { kind: 'triggered', optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [] };
      const draw = [{ type: 'DRAW', player: 'SELF', count: 1 }];
      raw.effects = [
        { ...effect, id: 'life', timing: { type: 'TRIGGER' }, sourceZones: ['life'], actions: [{ type: 'PLAY_TRIGGER_SOURCE' }] },
        { ...effect, id: 'enter', timing: { type: 'ON_PLAY' }, sourceZones: [zone], actions: draw },
        ...(zone === 'character' ? [{ ...effect, id: 'ko', timing: { type: 'ON_KO' }, sourceZones: [zone], actions: draw }] : [])
      ];
    }
    return compile(raw);
  });
  const catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ ...approval, cardId: plan.definition.cardId,
    cardVersion: plan.definition.cardVersion, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash,
    compilerVersion: plan.compilerVersion, registryHash: plan.registryHash })), approval.rulesetVersion);
  const cards = new Map(plans.map(plan => [plan.definition.cardId, catalog.get(plan.definition.cardId)]));
  const movement = structuredClone(options.movement), defender = movement.players[1];
  Object.assign(movement.cards[defender.life[0]], { cardId: 'TARGET', kind: zone });
  if (generationLimit) movement.cards[defender.life[0]].generation = Number.MAX_SAFE_INTEGER - 1;
  if (full && zone === 'stage') {
    const existing = defender.deck.shift();
    defender.stage[0] = existing;
    Object.assign(movement.cards[existing], { cardId: 'TARGET', kind: zone, faceUp: true });
  }
  let progression = createProgression(0);
  while (true) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') {
      if (progression.turnNumber === 3) break;
      progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain');
    } else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  movement.turnNumber = 3;
  const c = new V3SyntheticMatchCoordinator({ ...options, movement, progression, cards: [...cards.values()] });
  c.attack(0, id(), c.context(), ref(movement.cards[movement.players[0].leader[0]]), ref(movement.cards[defender.leader[0]]));
  c.battleDecision(1, id(), c.context(), 'passBlock');
  c.battleDecision(1, id(), c.context(), 'endCounter');
  c.resolveDamage(1, id(), c.context());
  const life = c.viewFor(1).lifeChoice;
  assert.ok(life?.canTrigger);
  return { c, life, movement, cards };
}

test('self-play reuses the trigger source and queues ON_PLAY only after all damage, without paying printed DON', () => {
  const { c, life, movement, cards } = setup({ double: true }), pending = snap(c);
  const card = pending.pendingLife.card, request = id(), context = c.context();
  assert.equal(c.viewFor(0).lifeChoice, null);
  assert.equal(c.viewFor(0).movement.players[1].life[0].cardId, null);
  for (const stale of [{ ...card, generation: card.generation - 1 }, ref(pending.movement.cards[movement.players[1].life[1]])]) {
    assert.throws(() => prepareLifeTrigger(pending.movement, pending.progression, 1, { ...pending.pendingLife, card: stale }, life.selectionId, life.token, id(), 1000, cards));
  }
  assert.throws(() => c.useLifeTrigger(0, id(), context, life.selectionId, life.token));
  assert.equal(c.useLifeTrigger(1, request, context, life.selectionId, life.token).replayed, false);
  assert.equal(c.useLifeTrigger(1, request, context, life.selectionId, life.token).replayed, true);
  assert.equal(c.viewFor(0).lifeTrigger.cardId, 'TARGET');
  finish(c, 1);
  const first = snap(c).movement;
  assert.equal(first.players[1].character[0], card.instanceId);
  assert.equal(first.cards[card.instanceId].generation, card.generation + 2);
  assert.equal(first.cards[card.instanceId].rotated, false);
  assert.equal(first.cards[card.instanceId].enteredTurn, 3);
  assert.deepEqual(first.players[1].activeDon, movement.players[1].activeDon);
  assert.deepEqual(first.players[1].trash, []);
  assert.deepEqual(first.players[1].resolving, []);
  assert.equal(c.viewFor(1).pendingTriggerCount, 0);
  assert.throws(() => c.useLifeTrigger(1, id(), c.context(), life.selectionId, life.token));
  c.resolveDamage(1, id(), c.context());
  const next = c.viewFor(1).lifeChoice;
  if (next) c.takeDamageLife(1, id(), c.context(), next.selectionId, next.token);
  const [onPlay] = c.viewFor(1).triggerChoices;
  assert.equal(onPlay.effectId, 'enter');
  const handSize = snap(c).movement.players[1].hand.length;
  c.resolveTrigger(1, id(), c.context(), onPlay.token); finish(c, 1);
  assert.equal(snap(c).movement.players[1].hand.length, handSize + 1);
  assert.equal(c.viewFor(1).pendingTriggerCount, 0);
});

test('full field requires a current own slot choice, publishes trash plus entry together, and does not cause KO', () => {
  for (const zone of ['character', 'stage']) {
    const { c, life, movement } = setup({ full: true, zone });
    const source = movement.players[1].life[0], old = movement.players[1][zone][0];
    c.useLifeTrigger(1, id(), c.context(), life.selectionId, life.token);
    const choice = finish(c, 1).choice, waiting = snap(c).movement, at = c.context();
    assert.equal(choice.options.length, zone === 'character' ? 5 : 1);
    assert.deepEqual(c.viewFor(0).frame.choice.options, []);
    const [token] = choice.options.map(o => o.token);
    assert.throws(() => c.answer(1, id(), at, choice.selectionId, []));
    assert.throws(() => c.answer(0, id(), at, choice.selectionId, [token]));
    assert.throws(() => c.answer(1, id(), at, choice.selectionId, ['stale-option']));
    assert.deepEqual(snap(c).movement, waiting);
    c.answer(1, id(), at, choice.selectionId, [token]);
    assert.deepEqual(snap(c).movement, waiting);
    c.advance(1, id(), c.context());
    const request = id(), ready = c.context();
    c.applyPendingWork(1, request, ready);
    assert.equal(c.applyPendingWork(1, request, ready).replayed, true);
    const applied = snap(c);
    assert.equal(applied.movement.players[1][zone][0], source);
    assert.deepEqual(applied.movement.players[1].trash, [old]);
    assert.deepEqual(applied.active.movementEvents.filter(e => e.kind === 'moved').map(e => [e.cause.kind, e.isKO]),
      [['RULE_PROCESSING', false], ['EFFECT_MOVE', false]]);
    finish(c, 1);
    assert.deepEqual(c.viewFor(1).triggerChoices.map(e => e.effectId), ['enter']);
  }
});

test('declining self-play at a full board keeps every slot and puts the Life card into the private hand', () => {
  const { c, life, movement } = setup({ full: true });
  c.takeDamageLife(1, id(), c.context(), life.selectionId, life.token);
  const after = snap(c).movement;
  assert.deepEqual(after.players[1].character, movement.players[1].character);
  assert.equal(after.players[1].hand.at(-1), movement.players[1].life[0]);
  assert.equal(c.viewFor(0).movement.players[1].hand.at(-1).cardId, null);
  assert.deepEqual(after.players[1].trash, []);
  assert.equal(c.viewFor(1).pendingTriggerCount, 0);
});

test('a failed effect move after staging the full-area rule trash leaves both cards where they were', () => {
  const { c, life } = setup({ full: true, generationLimit: true });
  c.useLifeTrigger(1, id(), c.context(), life.selectionId, life.token);
  const choice = finish(c, 1).choice;
  c.answer(1, id(), c.context(), choice.selectionId, [choice.options[0].token]);
  c.advance(1, id(), c.context());
  const before = snap(c).movement;
  c.applyPendingWork(1, id(), c.context());
  assert.equal(c.viewFor(1).frame.status, 'blocked');
  assert.deepEqual(snap(c).movement, before);
  assert.equal(c.viewFor(1).pendingTriggerCount, 0);
});
