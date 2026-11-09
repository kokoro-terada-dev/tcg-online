const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, definition, always } = require('./helpers/v3-event.cjs');
const { finish, selector, id } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');

const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const snapshot = c => c.snapshotForCoordinator();
function eventData(payment) {
  const raw = definition(4);
  raw.schemaVersion = '3.0.0-subset.40';
  raw.source.text = 'Synthetic MAIN: K.O. up to one opposing character with current power at most 6000.';
  raw.source.triggerText = 'Synthetic TRIGGER: activate the MAIN effect of this card.';
  const main = raw.effects[0];
  main.actions = payment ? [
    { type: 'OFFER_PAYMENT', bindAs: 'paid', costs: [{ type: 'REST_DON', count: 1 }] },
    { type: 'IF_PAYMENT_SUCCEEDED', payment: 'paid', then: [{ type: 'DRAW', player: 'SELF', count: 1 }], else: [] }
  ] : [
    { type: 'SELECT', bindAs: 'victim', selector: { ...selector(), filters: { type: 'compare', left: { ref: 'CANDIDATE.current.power' }, op: 'lte', right: 6000 } } },
    { type: 'KO', cards: { ref: 'bindings.victim' } }
  ];
  raw.effects.push({ ...main, id: 'life', kind: 'triggered', timing: { type: 'TRIGGER' }, sourceZones: ['life'], actions: [{ type: 'CALL_EFFECT_BODY', effectId: 'main' }] });
  return raw;
}
function setup({ don = 1, boost = false, payment = false, noEligible = false } = {}) {
  const { options, approval } = base({ don, field: 2 });
  const compile = raw => compileV3CardJson(JSON.stringify(raw));
  const plans = options.cards.map(card => {
    const raw = structuredClone(card.definition);
    if (raw.cardType === 'event') return compile(eventData(payment));
    if (raw.cardType === 'character') raw.baseStats.power = noEligible ? 7000 : 6000;
    else {
      raw.schemaVersion = '3.0.0-subset.40';
      raw.source.text = 'Synthetic observer: draw after your character is K.O.d.';
      raw.effects = [{ ...eventData(false).effects[0], id: 'watch', kind: 'triggered', sourceZones: ['leader'],
        timing: { type: 'ON_EVENT', event: 'CARD_KO', snapshot: 'TRANSACTION_BEFORE', relation: 'OTHER', owner: 'SELF',
          controller: 'SELF', fromZones: ['character'], toZones: ['trash'], cardTypes: ['character'], filters: always() },
        actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }];
    }
    return compile(raw);
  });
  const catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ ...approval, cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion,
    definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash
  })), approval.rulesetVersion);
  let movement = structuredClone(options.movement), progression = createProgression(0);
  while (true) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') {
      if (progression.turnNumber === 3) break;
      progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain');
    } else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  movement.turnNumber = 3;
  if (boost) {
    const { cards, players, matchId, revision, turnNumber } = movement;
    movement = new MovementStore(movement).commit({ transactionId: 'boost-to-7000', matchId, expectedRevision: revision, turnNumber,
      actor: 0, effectController: null, source: null, mode: 'rule', resolutionId: null, operations: [{
        kind: 'attachDon', card: ref(cards[players[0].activeDon[0]]), target: ref(cards[players[0].character[1]])
      }] }, { status: 'certifiedNone' }).state;
  }
  return new V3SyntheticMatchCoordinator({ ...options, movement, progression, cards: plans.map(plan => catalog.get(plan.definition.cardId)) });
}
function damage(c) {
  const { cards, players } = snapshot(c).movement;
  c.attack(0, id(), c.context(), ref(cards[players[0].leader[0]]), ref(cards[players[1].leader[0]]));
  c.battleDecision(1, id(), c.context(), 'passBlock');
  c.battleDecision(1, id(), c.context(), 'endCounter');
  c.resolveDamage(1, id(), c.context());
  const choice = c.viewFor(1).lifeChoice;
  assert.ok(choice?.canTrigger);
  return choice;
}

test('life TRIGGER shares the current-power MAIN body, keeps the signed choice, and queues actual KO only after the body', () => {
  const c = setup({ boost: true }), initial = snapshot(c).movement;
  const [victim, excluded] = initial.players[0].character;
  const life = damage(c);
  assert.equal(c.viewFor(0).lifeChoice, null);
  const use = id(), at = c.context();
  assert.throws(() => c.useLifeTrigger(0, id(), at, life.selectionId, life.token));
  assert.equal(c.useLifeTrigger(1, use, at, life.selectionId, life.token).replayed, false);
  assert.equal(c.useLifeTrigger(1, use, at, life.selectionId, life.token).replayed, true);
  const started = snapshot(c), source = started.movement.players[1].resolving[0];
  assert.equal(started.active.bodyEffectId, 'main');
  assert.equal(c.viewFor(1).mainEvent, null);
  assert.equal(c.viewFor(0).lifeTrigger.cardId, 'MAIN-EVENT-FIXTURE');
  assert.deepEqual(started.movement.players[1].activeDon, initial.players[1].activeDon);
  assert.deepEqual(started.movement.players[1].trash, initial.players[1].trash);
  const { choice } = finish(c, 1);
  assert.equal(choice.chooser, 1);
  assert.equal(choice.options.length, 1);
  assert.deepEqual(c.viewFor(0).frame.choice.options, []);
  const token = choice.options[0].token, answer = id(), waiting = c.context();
  assert.throws(() => c.answer(1, id(), at, choice.selectionId, [token]), /stale/);
  assert.throws(() => c.answer(1, id(), waiting, choice.selectionId, [excluded]), /token/);
  assert.equal(c.answer(1, answer, waiting, choice.selectionId, [token]).replayed, false);
  assert.equal(c.answer(1, answer, waiting, choice.selectionId, [token]).replayed, true);
  c.advance(1, id(), c.context());
  const apply = id(), beforeWork = c.context();
  c.applyPendingWork(1, apply, beforeWork);
  assert.equal(c.applyPendingWork(1, apply, beforeWork).replayed, true);
  assert.equal(c.viewFor(0).triggerChoices.length, 0);
  assert.ok(snapshot(c).movement.players[1].resolving.includes(source));
  finish(c, 1);
  const done = snapshot(c), ko = done.active.movementEvents.find(event => event.isKO);
  assert.equal(ko.before.instanceId, victim);
  assert.deepEqual(ko.cause.source, ref(started.movement.cards[source]));
  assert.equal(ko.cause.effectController, 1);
  assert.equal(done.triggerObservations.records.find(row => row.eventId === ko.eventId).causeEffectId, 'main');
  assert.deepEqual(done.movement.players[0].character.slice(0, 2), [null, excluded]);
  assert.deepEqual(done.movement.players[1].activeDon, initial.players[1].activeDon);
  assert.equal(done.movement.players[1].trash.filter(card => card === source).length, 1);
  const watcher = c.viewFor(0).triggerChoices[0];
  assert.equal(watcher.effectId, 'watch');
  c.resolveTrigger(0, id(), c.context(), watcher.token);
  finish(c, 0);
  assert.equal(c.viewFor(0).battle, null);
  assert.equal(snapshot(c).movement.players[0].hand.length, initial.players[0].hand.length + 1);
});

test('life trigger with no legal target finishes without KO; normal MAIN still pays its printed cost', () => {
  const c = setup({ don: 0, noEligible: true }), life = damage(c);
  c.useLifeTrigger(1, id(), c.context(), life.selectionId, life.token);
  const source = snapshot(c).movement.players[1].resolving[0];
  finish(c, 1);
  assert.equal(c.viewFor(1).battle, null);
  assert.equal(snapshot(c).movement.players[1].trash.at(-1), source);
  assert.equal(snapshot(c).movement.players[0].trash.length, 0);
  const normal = setup({ don: 4 });
  const event = normal.mainEventChoicesFor(0).find(row => row.enabled);
  normal.useMainEvent(0, id(), normal.context(), event.sourceToken, event.effectId);
  assert.equal(normal.viewFor(0).lifeTrigger, null);
  assert.equal(normal.viewFor(0).mainEvent.paidCost, 4);
  const { choice } = finish(normal, 0);
  normal.answer(0, id(), normal.context(), choice.selectionId, [choice.options[0].token]);
  finish(normal, 0);
  assert.equal(snapshot(normal).movement.players[0].restDon.length, 4);
  assert.equal(snapshot(normal).movement.players[1].trash.length, 1);
});

test('explicit optional payment in the body is offered independently of the unpaid printed cost', () => {
  for (const accept of [true, false]) {
    const c = setup({ payment: true }), life = damage(c), before = snapshot(c).movement.players[1];
    c.useLifeTrigger(1, id(), c.context(), life.selectionId, life.token);
    const { choice } = finish(c, 1);
    assert.equal(choice.purpose, 'payment');
    assert.equal(snapshot(c).movement.players[1].activeDon.length, 1);
    c.answer(1, id(), c.context(), choice.selectionId, [choice.options[accept ? 0 : 1].token]);
    finish(c, 1);
    const after = snapshot(c).movement.players[1];
    assert.equal(after.hand.length - before.hand.length, Number(accept));
    assert.equal(after.restDon.length - before.restDon.length, Number(accept));
  }
});
