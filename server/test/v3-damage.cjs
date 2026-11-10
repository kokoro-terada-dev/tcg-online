const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, always } = require('./helpers/v3-event.cjs');
const { finish, selector, id } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');
const { MovementStore } = require('../dist/test/movement/engine.js');

const snap = c => c.snapshotForCoordinator();
const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const selection = (overrides = {}) => ({ type: 'SELECT', bindAs: 'selected', selector: { ...selector(), min: 1, ...overrides } });
const selected = { ref: 'bindings.selected' };
const effect = (actions, timing = 'MAIN', zone = 'leader') => ({
  id: timing.toLowerCase(), kind: timing === 'MAIN' ? 'activated' : 'triggered', timing: { type: timing },
  sourceZones: [zone], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions
});

function setup({ main = [], event = [], double = false, banish = false, life = 2, stage = false } = {}) {
  const { options, approval } = base({ field: 1, cost: 1, don: 3 });
  const raws = options.cards.map(card => structuredClone(card.definition));
  if (stage) raws.push({ ...structuredClone(raws.find(row => row.cardType === 'character')), cardType: 'stage', cardId: 'STAGE-ONLY',
    baseStats: { cost: 1, power: null, counter: null, life: null } });
  const plans = raws.map(raw => {
    raw.schemaVersion = '3.0.0-subset.43';
    if (raw.cardType === 'event') {
      raw.effects = [...(event.length ? [effect(event, 'MAIN', 'hand')] : []),
        effect([selection(), { type: 'KO', cards: selected }], 'TRIGGER', 'life')];
      raw.source.triggerText = 'Synthetic KO life trigger.';
    }
    if (raw.cardType === 'leader') raw.effects = main;
    if (raw.cardType === 'character') {
      raw.baseStats.power = 5000;
      if (double) raw.keywords.push({ type: 'DOUBLE_ATTACK' });
      if (banish) raw.keywords.push({ type: 'BANISH' });
    }
    raw.source.displayIds = [raw.cardId];
    raw.source.text = raw.effects.some(e => e.timing.type !== 'TRIGGER') || raw.keywords.length ? 'Synthetic PR16b.' : '';
    return compileV3CardJson(JSON.stringify(raw));
  });
  const catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ ...approval, cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion,
    definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash
  })), approval.rulesetVersion);
  const movement = structuredClone(options.movement);
  const defender = movement.players[1];
  defender.deck.push(...defender.life.splice(life));
  if (stage) {
    const instance = defender.deck.shift();
    Object.assign(movement.cards[instance], { cardId: 'STAGE-ONLY', kind: 'stage', faceUp: true });
    defender.stage[0] = instance;
  }
  let progression = options.progression;
  if (double) {
    movement.turnNumber = 3;
    while (progression.turnNumber !== 3 || progression.phase !== 'main' || !progression.phaseSettled) {
      if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
      else if (progression.phase === 'main') progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain');
      else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
    }
  }
  return new V3SyntheticMatchCoordinator({ ...options, movement, progression, cards: plans.map(plan => catalog.get(plan.definition.cardId)) });
}
function answer(c, actor, frame, index = 0) {
  return c.answer(actor, id(), c.context(), frame.choice.selectionId, [frame.choice.options[index].token]);
}
function startMain(c, effectId) {
  const row = c.mainEffectsFor(0).find(candidate => candidate.effectId === effectId);
  assert.ok(row.enabled);
  c.activateMain(0, id(), c.context(), row.sourceToken, effectId);
}
function damageWindow(c) {
  const board = snap(c).movement, source = ref(board.cards[board.players[0].character[0]]), target = ref(board.cards[board.players[1].leader[0]]);
  c.attack(0, id(), c.context(), source, target);
  c.battleDecision(1, id(), c.context(), 'passBlock');
  c.battleDecision(1, id(), c.context(), 'endCounter');
  return { board, source };
}

test('stage K.O. through paid MAIN triggers only the matching observer and affects the selected stage once', () => {
  const observer = (zone) => ({ ...effect([{ type: 'DRAW', player: 'SELF', count: 1 }], 'ON_EVENT'), id: 'watch-' + zone,
    timing: { type: 'ON_EVENT', event: 'CARD_KO', snapshot: 'TRANSACTION_AFTER', relation: 'OTHER', owner: 'OPPONENT', controller: 'OPPONENT',
      fromZones: [zone], toZones: ['trash'], cardTypes: [zone], filters: always() } });
  const c = setup({ stage: true, main: [observer('stage'), observer('character')], event: [
    { type: 'OFFER_PAYMENT', bindAs: 'paid', costs: [{ type: 'REST_DON', count: 2 }] },
    { type: 'IF_PAYMENT_SUCCEEDED', payment: 'paid', then: [
      selection({ zone: 'stage', cardTypes: ['stage'], min: 0 }), { type: 'KO_STAGE', cards: selected }
    ], else: [] }
  ] });
  const before = snap(c).movement, stage = before.players[1].stage[0];
  const event = c.mainEventChoicesFor(0).find(row => row.enabled);
  c.useMainEvent(0, id(), c.context(), event.sourceToken, event.effectId);
  let frame = finish(c, 0);
  assert.equal(frame.choice.purpose, 'payment');
  answer(c, 0, frame);
  frame = finish(c, 0);
  assert.equal(frame.choice.options[0].cardId, 'STAGE-ONLY');
  answer(c, 0, frame);
  c.advance(0, id(), c.context());
  const request = id(), context = c.context();
  c.applyPendingWork(0, request, context);
  assert.equal(c.applyPendingWork(0, request, context).replayed, true);
  const after = snap(c), moved = after.active.movementEvents.find(event => event.isKO);
  assert.equal(after.movement.players[1].stage[0], null);
  assert.equal(after.movement.players[1].character[0], before.players[1].character[0]);
  assert.equal(after.movement.players[1].trash.at(-1), stage);
  assert.equal(after.movement.players[0].restDon.length, 3);
  assert.deepEqual([moved.from.zone, moved.before.kind, moved.after.kind, moved.cause.kind], ['stage', 'stage', 'stage', 'EFFECT_KO']);
  assert.equal(moved.after.generation, moved.before.generation + 1);
  finish(c, 0);
  assert.equal(c.viewFor(1).triggerChoices.length, 0);
  assert.deepEqual(c.viewFor(0).triggerChoices.map(choice => choice.effectId), ['watch-stage']);
  assert.throws(() => new MovementStore(before).commit({ transactionId: 'invalid-stage-battle-ko', matchId: before.matchId, expectedRevision: before.revision,
    turnNumber: before.turnNumber, actor: 0, effectController: null, source: null, mode: 'rule', resolutionId: null, operations: [
      { kind: 'move', card: ref(before.cards[stage]), from: { player: 1, zone: 'stage' }, to: { player: 1, zone: 'trash', position: 'append', faceUp: true, rotated: false }, cause: 'BATTLE_KO' }
    ] }, { status: 'certifiedNone' }), /invalid-ko-move/);
});

test('effect adds a hidden deck card to Life then moves it to its owner hand without a damage trigger', () => {
  const c = setup({ life: 0, main: [
    { ...effect([{ type: 'MOVE_LIFE', player: 'OPPONENT', from: 'DECK_TOP', to: 'LIFE_BOTTOM', faceUp: false },
      { type: 'MOVE_RESULT', bindAs: 'lifeAdded' }]), id: 'add' },
    { ...effect([{ type: 'MOVE_LIFE', player: 'OPPONENT', from: 'LIFE_BOTTOM', to: 'HAND' },
      { type: 'MOVE_LIFE', player: 'OPPONENT', from: 'LIFE_TOP', to: 'TRASH' }]), id: 'remove' }
  ] });
  const before = snap(c).movement, original = before.players[1].deck[0];
  startMain(c, 'add'); finish(c, 0);
  const afterAdd = snap(c);
  assert.deepEqual(afterAdd.movement.players[1].life, [original]);
  assert.equal(afterAdd.active.movementEvents[0].cause.kind, 'EFFECT_MOVE');
  for (const viewer of [0, 1]) {
    assert.equal(c.viewFor(viewer).movement.players[1].life[0].cardId, null);
    assert.equal(c.viewFor(viewer).movement.players[1].life[0].ref, null);
    assert.equal(JSON.stringify(c.viewFor(viewer)).includes(original), false);
  }
  startMain(c, 'remove'); finish(c, 0);
  const after = snap(c), move = after.active.movementEvents[0];
  assert.equal(after.active.movementEvents.length, 1);
  assert.equal(move.cause.kind, 'EFFECT_MOVE');
  assert.deepEqual(move.visibleBefore, []);
  assert.deepEqual(move.visibleAfter, [1]);
  assert.equal(after.movement.players[1].life.length, 0);
  assert.equal(after.movement.players[1].hand.at(-1), original);
  assert.equal(after.movement.cards[original].generation, before.cards[original].generation + 2);
  assert.equal(c.viewFor(0).movement.players[1].hand.at(-1).cardId, null);
  assert.equal(c.viewFor(1).lifeChoice, null);
});

test('a selected public character can become face-up life and leave for deck bottom as an effect', () => {
  const c = setup({ main: [effect([
    selection(),
    { type: 'MOVE_LIFE', player: 'OPPONENT', from: 'BOUND', cards: selected, to: 'LIFE_TOP', faceUp: true },
    { type: 'MOVE_LIFE', player: 'OPPONENT', from: 'LIFE_TOP', to: 'DECK_BOTTOM' }
  ])] });
  const before = snap(c).movement, character = before.players[1].character[0];
  startMain(c, 'main');
  answer(c, 0, finish(c, 0));
  c.advance(0, id(), c.context());
  c.applyPendingWork(0, id(), c.context());
  const visible = c.viewFor(0).movement.players[1].life[0];
  assert.equal(visible.cardId, 'TARGET');
  assert.equal(visible.ref.generation, before.cards[character].generation + 1);
  finish(c, 0);
  const after = snap(c).movement;
  assert.equal(after.players[1].character[0], null);
  assert.deepEqual(after.players[1].life, before.players[1].life);
  assert.equal(after.players[1].deck.at(-1), character);
  assert.equal(c.viewFor(0).movement.players[1].deck.at(-1).cardId, null);
});

test('Double Attack keeps the second point after the first life trigger K.O.s the attacker', () => {
  const c = setup({ double: true }), { board, source } = damageWindow(c);
  c.resolveDamage(1, id(), c.context());
  const first = c.viewFor(1).lifeChoice;
  assert.equal(c.viewFor(0).lifeChoice, null);
  assert.equal(c.viewFor(0).movement.players[1].life[1].ref, null);
  const request = id(), context = c.context();
  c.useLifeTrigger(1, request, context, first.selectionId, first.token);
  assert.equal(c.useLifeTrigger(1, request, context, first.selectionId, first.token).replayed, true);
  assert.throws(() => c.resolveDamage(1, id(), c.context()));
  answer(c, 1, finish(c, 1)); finish(c, 1);
  assert.equal(snap(c).movement.players[0].character[0], null);
  assert.equal(snap(c).movement.players[1].life.length, 1);
  assert.ok(c.viewFor(1).battle.remainingDamage);
  c.resolveDamage(1, id(), c.context());
  assert.throws(() => c.takeDamageLife(1, id(), c.context(), first.selectionId, first.token));
  const second = c.viewFor(1).lifeChoice;
  assert.notEqual(first.selectionId, second.selectionId);
  c.takeDamageLife(1, id(), c.context(), second.selectionId, second.token);
  const final = snap(c);
  assert.equal(final.movement.players[1].hand.at(-1), board.players[1].life[1]);
  assert.equal(final.movement.players[0].trash.at(-1), source.instanceId);
  assert.equal(final.progression.battle, null);
  assert.equal(final.progression.outcome, null);
});

test('Double Attack with Banish processes both top cards without triggers and excess damage does not win', () => {
  for (const life of [0, 1, 2]) {
    const c = setup({ double: true, banish: true, life }), { board } = damageWindow(c);
    const request = id(), context = c.context();
    c.resolveDamage(1, request, context);
    assert.equal(c.resolveDamage(1, request, context).replayed, true);
    assert.equal(c.viewFor(1).lifeChoice, null);
    if (life === 2) {
      assert.deepEqual(snap(c).movement.players[1].life, [board.players[1].life[1]]);
      c.resolveDamage(1, id(), c.context());
    }
    assert.deepEqual(snap(c).movement.players[1].trash, board.players[1].life);
    assert.equal(snap(c).progression.outcome?.winner, life === 0 ? 0 : undefined);
    assert.equal(c.viewFor(1).lifeChoice, null);
    assert.equal(c.viewFor(1).pendingTriggerCount, 0);
  }
});
