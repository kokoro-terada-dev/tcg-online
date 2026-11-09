const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: fixture, finish, selector, id, always } = require('./helpers/v3-observed.cjs');
const { V3FixtureCoordinator } = require('../dist/test/effects/v3/fixtureCoordinator.js');

const paid = (id, cardTypes) => ({
  type: 'REPLACE_EVENT', id, match: { cause: 'EFFECT_KO', by: 'ANY', from: 'character', to: 'trash' },
  condition: always(), substitute: { type: 'PREVENT' }, optionalPayment: { type: 'MOVE_AS_COST', destination: 'trash', selector: {
    ...selector('SELF'), zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, cardTypes, min: 1, max: 1
  } }
});
const board = c => c.snapshotForCoordinator().movement;
const active = c => c.snapshotForCoordinator().active;
const state = c => JSON.parse(JSON.parse(active(c).frame).payload);
function setupFixture({ kinds = ['event', 'stage'], rules = [paid('event-payment', ['event']), paid('stage-payment', ['stage'])] } = {}) {
  return fixture({ count: 3, sourceType: 'character', mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.38'; raw.replacementEffects = rules;
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions: [
      { type: 'SELECT', bindAs: 'target', selector: { ...selector(), min: 1 } },
      { type: 'KO', cards: { ref: 'bindings.target' } }, { type: 'DRAW', player: 'SELF', count: 1 }
    ] });
    raw.effects[1].timing = { type: 'ON_KO' };
    Object.assign(raw.effects[2].timing, { event: 'CARD_MOVED', fromZones: ['hand'], toZones: ['trash'], cardTypes: ['event', 'stage'] });
  }, mutateBoard(b) {
    kinds.forEach((kind, i) => Object.assign(b.cards[b.players[1].hand[i]], { kind, cardId: kind === 'event' ? 'MAIN-EVENT-FIXTURE' : 'PRIVATE-' + kind }));
  } });
}
const setup = options => setupFixture(options).c;
function start(c) {
  const effect = c.mainEffectsFor(0)[0];
  c.activateMain(0, id(), c.context(), effect.sourceToken, effect.effectId);
  finish(c, 0);
  const choice = c.viewFor(0).frame.choice;
  c.answer(0, id(), c.context(), choice.selectionId, [choice.options[0].token]);
  c.advance(0, id(), c.context());
}

test('same-source paid alternatives bind the payment card, protect the KO target and queue only the actual discard', () => {
  const c = setup(); start(c);
  const before = board(c), target = before.players[1].character[0], [event, stage] = before.players[1].hand;
  const offer = id(), at = c.context();
  c.applyPendingWork(0, offer, at);
  assert.equal(c.applyPendingWork(0, offer, at).replayed, true);
  const choice = c.viewFor(1).frame.choice, peer = c.viewFor(0).frame.choice;
  assert.equal(choice.purpose, 'replacementPayment');
  assert.equal(choice.chooser, 1);
  assert.deepEqual(choice.options.map(option => option.cardId), ['MAIN-EVENT-FIXTURE', 'PRIVATE-stage']);
  assert.deepEqual(peer.options, []);
  const [eventToken, stageToken] = choice.options.map(option => option.token);
  assert.ok(!JSON.stringify(c.viewFor(0)).includes('PRIVATE-stage'));
  assert.ok(!JSON.stringify(peer).includes(stageToken));
  assert.ok(!Object.hasOwn(choice.options[1], 'candidateId'));
  assert.deepEqual(board(c), before);
  assert.deepEqual(active(c).movementEvents, []);
  assert.throws(() => c.answer(0, id(), c.context(), choice.selectionId, [stageToken]), /chooser/);
  assert.throws(() => c.answer(1, id(), at, choice.selectionId, [stageToken]), /stale/);
  assert.throws(() => c.answer(1, id(), c.context(), choice.selectionId, [eventToken, stageToken]), /count/);
  assert.throws(() => c.answer(1, id(), c.context(), choice.selectionId, [stage]), /token/);
  const answer = id(), waiting = c.context();
  c.answer(1, answer, waiting, choice.selectionId, [stageToken]);
  assert.equal(c.answer(1, answer, waiting, choice.selectionId, [stageToken]).replayed, true);
  assert.throws(() => c.answer(1, id(), c.context(), choice.selectionId, [stageToken]), /chooser/);
  assert.deepEqual(board(c), before);
  const work = id(), answered = c.context(), plan = state(c).replacement.plan;
  assert.equal(plan.ruleId, 'stage-payment');
  c.applyPendingWork(0, work, answered);
  assert.equal(c.applyPendingWork(0, work, answered).replayed, true);
  const after = board(c), [discard] = active(c).movementEvents;
  assert.deepEqual(state(c).appliedReplacements, [{ intentId: plan.intent.id, candidateId: plan.candidateId }]);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.players[1].character[0], target);
  assert.deepEqual(after.cards[target], before.cards[target]);
  assert.ok(after.players[1].hand.includes(event));
  assert.equal(after.players[1].trash.at(-1), stage);
  assert.equal(discard.before.instanceId, stage);
  assert.equal(discard.after.generation, before.cards[stage].generation + 1);
  assert.equal(discard.cause.kind, 'EFFECT_MOVE');
  assert.equal(discard.cause.effectController, 1);
  assert.equal(discard.cause.source.instanceId, target);
  assert.equal(active(c).movementEvents.length, 1);
  assert.equal(discard.isKO, false);
  finish(c, 0);
  assert.equal(c.viewFor(1).triggerChoices.filter(row => row.timing === 'ON_KO').length, 0);
  assert.deepEqual(c.viewFor(1).triggerChoices.map(row => row.effectId), ['watch-2']);
  assert.equal(c.snapshotForCoordinator().triggerObservations.records.find(row => row.eventId === discard.eventId).causeEffectId, 'stage-payment');
});

test('decline or unavailable payment keeps the same peer wait and applies the original KO only', () => {
  const projections = [];
  for (const [kinds, count] of [[['event'], 1], [[], 0], [['unknown'], 0]]) {
    const c = setup({ kinds }); start(c);
    const before = board(c), { choice } = finish(c, 0);
    const { selectionId, expiresAt, ...peer } = choice;
    projections.push(peer);
    assert.equal(c.viewFor(1).frame.choice.options.length, count);
    assert.deepEqual(board(c), before);
    if (kinds.includes('unknown')) assert.equal(state(c).replacement.plans[0].payment.candidates, 'unknown');
    c.answer(1, id(), c.context(), selectionId, []);
    finish(c, 0);
    assert.deepEqual(board(c).players[1].hand, before.players[1].hand);
    assert.equal(active(c).movementEvents.filter(event => event.isKO).length, 1);
    assert.equal(c.viewFor(1).triggerChoices.filter(row => row.timing === 'ON_KO').length, 1);
    assert.equal(state(c).appliedReplacements, undefined);
  }
  assert.deepEqual(projections[0], projections[1]);
  assert.deepEqual(projections[1], projections[2]);
});

test('paid and free candidates competing for the same KO stop before either branch mutates the board', () => {
  const rule = paid('paid', ['event']), { optionalPayment, ...free } = rule;
  for (const kinds of [['event'], []]) {
    const c = setup({ kinds, rules: [rule, { ...free, id: 'free', substitute: { to: 'hand' } }] }); start(c);
    const before = board(c); finish(c, 0);
    assert.equal(c.viewFor(0).frame.status, 'blocked');
    assert.deepEqual(board(c), before);
    assert.deepEqual(active(c).movementEvents, []);
  }
});

test('rejecting the draft discard publishes no payment or replacement receipt and allows a single safe retry', () => {
  const { options, approved } = setupFixture(), { movement } = options;
  const source = movement.cards[movement.players[0].character[0]];
  let reject = true;
  const c = new V3FixtureCoordinator({ ...options, card: approved, definitions: options.cards,
    identity: { matchId: movement.matchId, resolutionId: 'paid-replacement-rollback', effectId: 'watch-0', actor: 0,
      source: { instanceId: source.instanceId, generation: source.generation } },
    checkEvents(events) { if (reject && events.length) throw Error('test-observer-rejected'); } });
  c.advance(0, id(), c.context());
  const target = c.viewFor(0).frame.choice;
  c.answer(0, id(), c.context(), target.selectionId, [target.options[0].token]);
  c.advance(0, id(), c.context());
  c.applyPendingWork(0, id(), c.context());
  const choice = c.viewFor(1).frame.choice;
  c.answer(1, id(), c.context(), choice.selectionId, [choice.options[0].token]);
  const before = c.snapshotForCoordinator(), request = id(), context = c.context();
  assert.throws(() => c.applyPendingWork(0, request, context), /test-observer-rejected/);
  assert.deepEqual(c.snapshotForCoordinator(), before);
  reject = false;
  assert.equal(c.applyPendingWork(0, request, context).replayed, false);
  assert.equal(c.applyPendingWork(0, request, context).replayed, true);
  assert.equal(c.snapshotForCoordinator().movementEvents.length, 1);
});
