const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, always } = require('./helpers/v3-event.cjs');
const { finish, id } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { V3ResolutionMachine } = require('../dist/test/effects/v3/resolution.js');
const { prepareLifeTrigger } = require('../dist/test/effects/v3/lifeTriggers.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');

const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const snap = c => c.snapshotForCoordinator();
function setup({ full = false, zone = 'character', double = false, generationLimit = false, condition = null, don = 0,
  cost = null, drawFirst = false, emptyHand = false, canTrigger = true } = {}) {
  const { options, approval } = base({ don, field: full && zone === 'character' ? 5 : 0 });
  const compile = raw => compileV3CardJson(JSON.stringify(raw));
  const plans = options.cards.map(card => {
    const raw = structuredClone(card.definition);
    if (raw.cardId === 'LEADER' && double) {
      raw.schemaVersion = '3.0.0-subset.43';
      raw.source.text = 'Synthetic Double Attack.';
      raw.keywords = [{ type: 'DOUBLE_ATTACK' }];
    }
    if (raw.cardId === 'TARGET') {
      raw.schemaVersion = cost || drawFirst ? '3.0.0-subset.49' : condition ? '3.0.0-subset.48' : '3.0.0-subset.45';
      raw.cardType = zone; raw.baseStats.cost = 9; raw.baseStats.counter = null;
      if (zone === 'stage') raw.baseStats.power = null;
      raw.source.text = 'Synthetic ON_PLAY and optional ON_KO test fixture.';
      raw.source.triggerText = condition ? 'Synthetic conditional self-play.' : 'Synthetic unconditional self-play.';
      const effect = { kind: 'triggered', optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [] };
      const draw = [{ type: 'DRAW', player: 'SELF', count: 1 }];
      raw.effects = [
        { ...effect, id: 'life', timing: { type: 'TRIGGER' }, sourceZones: ['life'], resolutionConditions: drawFirst ? always() : condition ?? always(), costs: cost ? [cost] : [],
          actions: drawFirst ? [...draw, { type: 'IF', condition, then: [{ type: 'PLAY_TRIGGER_SOURCE' }], else: [] }] : [{ type: 'PLAY_TRIGGER_SOURCE' }] },
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
  if (emptyHand) defender.deck.push(...defender.hand.splice(0));
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
  assert.equal(life?.canTrigger, canTrigger);
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

const compare = (ref, op, right) => ({ type: 'compare', left: { ref }, op, right });
const lastLife = compare('SELF.lifeCount', 'eq', 4);
test('conditional self-play reads the remaining Life and public opponent facts, then uses PR23 full-field entry', () => {
  const condition = { type: 'all', conditions: [lastLife, compare('OPPONENT.lifeCount', 'eq', 5),
    compare('OPPONENT.don.fieldCount', 'gte', 2), { type: 'EXISTS', query: { type: 'QUERY_CARDS',
      owner: 'OPPONENT', controller: 'OPPONENT', zone: 'leader', cardTypes: ['leader'], visibility: 'PUBLIC', faceUpOnly: true, excludeSource: false,
      filters: { type: 'CARD_NAME', subject: 'CANDIDATE', basis: 'CURRENT', op: 'eq', value: '合成イベント' } } }] };
  const { c, life, movement } = setup({ full: true, condition, don: 2 }), card = movement.players[1].life[0];
  assert.equal(c.viewFor(0).lifeChoice, null);
  const request = id(), atLife = c.context();
  c.useLifeTrigger(1, request, atLife, life.selectionId, life.token);
  assert.equal(c.useLifeTrigger(1, request, atLife, life.selectionId, life.token).replayed, true);
  const choice = finish(c, 1).choice, atSlot = c.context(), waiting = snap(c).movement;
  assert.equal(choice.options.length, 5);
  assert.throws(() => c.endTurn(0, id(), atSlot));
  assert.throws(() => c.answer(1, id(), atLife, choice.selectionId, [choice.options[0].token]));
  assert.deepEqual(snap(c).movement, waiting);
  c.answer(1, id(), atSlot, choice.selectionId, [choice.options[0].token]);
  finish(c, 1);
  const after = snap(c).movement;
  assert.equal(after.players[1].character[0], card);
  assert.deepEqual(after.players[1].activeDon, movement.players[1].activeDon);
  assert.deepEqual(c.viewFor(1).triggerChoices.map(row => row.effectId), ['enter']);
});

test('a false resolution condition skips even the slot prompt; use trashes but decline goes to the private hand', () => {
  for (const use of [true, false]) {
    const { c, life, movement } = setup({ full: true, condition: compare('SELF.lifeCount', 'lte', 3) });
    const card = movement.players[1].life[0];
    if (use) {
      c.useLifeTrigger(1, id(), c.context(), life.selectionId, life.token);
      assert.equal(finish(c, 1), undefined);
    } else c.takeDamageLife(1, id(), c.context(), life.selectionId, life.token);
    const after = snap(c).movement.players[1];
    assert.deepEqual(after.character, movement.players[1].character);
    assert.deepEqual(after.resolving, []);
    assert.equal(after.trash.includes(card), use);
    assert.equal(after.hand.includes(card), !use);
    if (!use) assert.equal(c.viewFor(0).movement.players[1].hand.at(-1).cardId, null);
    assert.equal(c.viewFor(1).pendingTriggerCount, 0);
  }
});

test('changed world revision after the condition check cannot answer the reserved slot choice', () => {
  const { movement, cards } = setup({ full: true, condition: lastLife }), source = ref(movement.cards[movement.players[1].life[0]]);
  const old = ref(movement.cards[movement.players[1].character[0]]);
  let revision = 10, resolutionChecks = 0;
  const machine = new V3ResolutionMachine(cards.get('TARGET'),
    { matchId: movement.matchId, resolutionId: 'stale-world', effectId: 'life', source, actor: 1 }, Buffer.alloc(32), {
      now: () => 1000, revision: () => revision, lifeTriggerPlay: () => 'FULL',
      evaluate(predicate) { if (predicate.type === 'compare') resolutionChecks++; return true; },
      candidates: () => [{ ref: old, cardId: 'TARGET', owner: 1, controller: 1, zone: 'character', kind: 'character', faceUp: true, visibleTo: [0, 1] }]
    });
  machine.advance(id(), 0);
  const view = machine.viewFor(1);
  assert.equal(resolutionChecks, 1);
  revision++;
  assert.throws(() => machine.answer(1, id(), view.revision, view.choice.selectionId, [view.choice.options[0].token]), /not-current-chooser/);
  assert.deepEqual(machine.viewFor(1), view);
});

test('paid self-play checks resources before reveal, and privately selects and commits costs before the condition', () => {
  const cases = [
    [{ type: 'DISCARD_HAND', count: 1 }, 'hand', compare('SELF.handCount', 'eq', 4), 0],
    [{ type: 'DON_RETURN', count: 1, from: ['activeDon', 'restDon', 'attachedDon'] }, 'activeDon', compare('SELF.don.fieldCount', 'eq', 1), 2]
  ];
  for (const [cost, zone, condition, don] of cases) {
    const { c, life, movement } = setup({ cost, condition, don });
    const card = movement.players[1].life[0], original = [...movement.players[1][zone]];
    c.useLifeTrigger(1, id(), c.context(), life.selectionId, life.token);
    const choice = finish(c, 1).choice, waiting = snap(c).movement;
    assert.equal(c.viewFor(0).frame.choice.options.length, 0);
    assert.deepEqual(waiting.players[1][zone], original);
    assert.deepEqual(waiting.players[1].character, movement.players[1].character);
    assert.throws(() => c.answer(0, id(), c.context(), choice.selectionId, [choice.options[0].token]));
    const request = id(), at = c.context(), tokens = [choice.options[0].token];
    c.answer(1, request, at, choice.selectionId, tokens);
    assert.equal(c.answer(1, request, at, choice.selectionId, tokens).replayed, true);
    assert.deepEqual(snap(c).movement, waiting);
    finish(c, 1);
    const after = snap(c).movement.players[1];
    assert.equal(after[zone].length, original.length - 1);
    assert.equal(after.character[0], card);
    assert.equal(c.viewFor(1).triggerChoices[0].effectId, 'enter');
  }
  const { c, life, movement } = setup({ cost: cases[0][0], emptyHand: true, canTrigger: false });
  const before = snap(c).movement;
  assert.throws(() => c.useLifeTrigger(1, id(), c.context(), life.selectionId, life.token), /unpayable/);
  assert.deepEqual(snap(c).movement, before);
  assert.equal(c.viewFor(0).lifeTrigger, null);
  c.takeDamageLife(1, id(), c.context(), life.selectionId, life.token);
  assert.equal(snap(c).movement.players[1].hand[0], movement.players[1].life[0]);
});

test('draw before conditional life self-play is retained even when the play condition fails', () => {
  for (const max of [8, 9]) {
    const { c, life, movement } = setup({ drawFirst: true, condition: compare('BOTH.lifeCount', 'lte', max) });
    const card = movement.players[1].life[0];
    c.useLifeTrigger(1, id(), c.context(), life.selectionId, life.token);
    finish(c, 1);
    const after = snap(c).movement.players[1];
    assert.equal(after.hand.length, movement.players[1].hand.length + 1);
    assert.equal(after.character.includes(card), max === 9);
    assert.equal(after.trash.includes(card), max === 8);
  }
});
