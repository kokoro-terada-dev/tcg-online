const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: fixture, finish, selector, id, always, play } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { externalBodyChoices, resolveExternalBody } = require('../dist/test/effects/v3/effectBodyCalls.js');

const call = { type: 'CALL_EFFECT_BODY', from: 'OWN_TRASH', maxPrintedCost: 7 };
const snap = c => c.snapshotForCoordinator();
const eventId = 'MAIN-EVENT-FIXTURE';
function setup({ onPlay = false, leaderMatches = true, limit = true, copies = 1, cost = 1, bodyPayment = false } = {}) {
  const { options, approved } = fixture({ sourceType: 'character', count: 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.41';
    const effect = raw.effects[0]; effect.actions = [call];
    if (onPlay) {
      effect.optional = true;
      effect.timing.relation = 'SELF';
      effect.activationConditions = { type: 'TURN_IS', player: 'SELF' };
      effect.costs = [{ type: 'DON_RETURN', count: 1, from: ['restDon'] }];
      effect.resolutionConditions = { type: 'EXISTS', query: { type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'leader',
        visibility: 'PUBLIC', faceUpOnly: true, cardTypes: ['leader'], excludeSource: false,
        filters: { type: 'CARD_NAME', subject: 'CANDIDATE', basis: 'PRINTED', op: 'eq', value: leaderMatches ? '合成イベント' : 'not-the-leader' }
      } };
    } else { effect.kind = 'activated'; effect.timing = { type: 'MAIN' }; }
  }, mutateBoard(board) {
    const asEvent = id => Object.assign(board.cards[id], { cardId: eventId, kind: 'event', faceUp: true });
    for (let n = 0; n < copies; n++) { const event = board.players[0].hand.pop(); asEvent(event); board.players[0].trash.push(event); }
    asEvent(board.players[0].hand.at(-1));
    const peer = board.players[1].hand.pop(); asEvent(peer); board.players[1].trash.push(peer);
  } });
  const old = options.cards.find(card => card.definition.cardId === eventId);
  const raw = structuredClone(old.definition); raw.schemaVersion = '3.0.0-subset.41'; raw.baseStats.cost = cost;
  raw.effects[0].usageLimit = limit ? { type: 'PER_TURN', scope: 'SOURCE_OBJECT', count: 1 } : null;
  if (bodyPayment) raw.effects[0].actions = [
    { type: 'OFFER_PAYMENT', bindAs: 'paid', costs: [{ type: 'REST_DON', count: 1 }] },
    { type: 'IF_PAYMENT_SUCCEEDED', payment: 'paid', then: [{ type: 'DRAW', player: 'SELF', count: 1 }], else: [] }
  ];
  if (onPlay) raw.effects[0].actions = [
    { type: 'SELECT', bindAs: 'target', selector: selector() }, { type: 'KO', cards: { ref: 'bindings.target' } }
  ];
  const plan = compileV3CardJson(JSON.stringify(raw));
  const event = new ApprovedV3Catalog([plan], [{ status: 'approved', cardId: eventId, cardVersion: raw.cardVersion,
    definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash,
    rulesetVersion: approved.rulesetVersion, reviewer: 'synthetic-only', approvedAt: '2026-11-10T00:00:00.000Z',
    ruleEvidence: ['synthetic-not-real-card-approval'] }], approved.rulesetVersion).get(eventId);
  const cards = options.cards.map(card => card === old ? event : card);
  return { c: new V3SyntheticMatchCoordinator({ ...options, cards }), cards: new Map(cards.map(card => [card.definition.cardId, card])) };
}
function start(c) {
  const main = c.mainEffectsFor(0)[0];
  c.activateMain(0, id(), c.context(), main.sourceToken, main.effectId);
  return finish(c, 0)?.choice;
}
function choose(c, choice, options = []) { return c.answer(0, id(), c.context(), choice.selectionId, options); }

test('normal MAIN and copied MAIN share the per-object ledger without sharing it across same-number copies', () => {
  const { c } = setup();
  const handEvent = c.mainEventChoicesFor(0)[0];
  c.useMainEvent(0, id(), c.context(), handEvent.sourceToken, handEvent.effectId);
  finish(c, 0);
  const before = snap(c).movement;
  let choice = start(c);
  assert.equal(choice.purpose, 'effectBody');
  assert.equal(choice.options.length, 1);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  choose(c, choice);
  finish(c, 0);
  choice = start(c);
  const at = c.context(), token = choice.options[0].token, request = id();
  assert.throws(() => c.answer(1, id(), at, choice.selectionId, [token]), /chooser/);
  assert.throws(() => choose(c, choice, [handEvent.source.instanceId]), /token/);
  assert.equal(c.answer(0, request, at, choice.selectionId, [token]).replayed, false);
  assert.equal(c.answer(0, request, at, choice.selectionId, [token]).replayed, true);
  const bound = snap(c).active.externalBody;
  assert.equal(bound.identity.source.instanceId, before.players[0].trash[0]);
  assert.equal(bound.identity.effectId, 'main');
  assert.deepEqual(snap(c).movement, before);
  finish(c, 0);
  const after = snap(c);
  assert.equal(after.movement.players[0].hand.length, before.players[0].hand.length + 1);
  assert.deepEqual(after.movement.players[0].trash, before.players[0].trash);
  assert.deepEqual(after.movement.players[0].activeDon, before.players[0].activeDon);
  assert.equal(after.active.movementEvents[0].cause.source.instanceId, bound.identity.source.instanceId);
  assert.equal(after.usage.filter(([key]) => JSON.parse(key)[4] === 'main').length, 2);
  assert.equal(start(c), undefined);
  c.endTurn(0, id(), c.context()); c.endTurn(1, id(), c.context());
  assert.equal(start(c).options.length, 2);
});

test('self-entry caller pays its own DON and checks its leader before running the selected Event target choice', () => {
  for (const leaderMatches of [true, false]) {
    const { c } = setup({ onPlay: true, leaderMatches, cost: 7 });
    play(c);
    const pending = c.viewFor(0).triggerChoices[0];
    c.resolveTrigger(0, id(), c.context(), pending.token);
    let { choice } = finish(c, 0);
    assert.equal(choice.purpose, 'activation');
    choose(c, choice, [choice.options[0].token]);
    ({ choice } = finish(c, 0));
    assert.equal(choice.purpose, 'returnCost');
    choose(c, choice, [choice.options[0].token]);
    const afterCost = finish(c, 0);
    assert.equal(snap(c).movement.players[0].donDeck.length, 9);
    if (!leaderMatches) { assert.equal(afterCost, undefined); assert.equal(snap(c).active.externalBody, null); continue; }
    assert.equal(afterCost.choice.purpose, 'effectBody');
    choose(c, afterCost.choice, [afterCost.choice.options[0].token]);
    const bodyChoice = finish(c, 0).choice;
    assert.equal(bodyChoice.purpose, 'action');
    choose(c, bodyChoice, [bodyChoice.options[0].token]);
    finish(c, 0);
    assert.equal(snap(c).movement.players[0].donDeck.length, 9);
    assert.equal(snap(c).active.movementEvents.filter(event => event.isKO).length, 1);
  }
});

test('only approved matching trash instances can bind and version or generation mismatches fail closed', () => {
  const { c, cards } = setup({ cost: 8 }), board = snap(c).movement;
  assert.deepEqual(externalBodyChoices(board, 0, 7, cards, () => 0), []);
  const [choice] = externalBodyChoices(board, 0, 8, cards, () => 0);
  assert.equal(choice.source.instanceId, board.players[0].trash[0]);
  assert.equal(resolveExternalBody(board, 0, choice, cards).effect.id, 'main');
  assert.throws(() => resolveExternalBody(board, 1, choice, cards), /stale/);
  assert.throws(() => resolveExternalBody(board, 0, { ...choice, definitionHash: '0'.repeat(64) }, cards), /stale/);
  assert.throws(() => resolveExternalBody(board, 0, { ...choice, source: { ...choice.source, generation: 9 } }, cards), /stale/);
});

test('body payment is distinct from printed cost and retains the copied Event as source', () => {
  const { c } = setup({ cost: 7, bodyPayment: true }), before = snap(c).movement;
  const choice = start(c);
  choose(c, choice, [choice.options[0].token]);
  const payment = finish(c, 0).choice;
  assert.equal(payment.purpose, 'payment');
  assert.deepEqual(snap(c).movement, before);
  choose(c, payment, [payment.options[0].token]);
  finish(c, 0);
  const after = snap(c);
  assert.equal(after.movement.players[0].activeDon.length, before.players[0].activeDon.length - 1);
  assert.equal(after.movement.players[0].hand.length, before.players[0].hand.length + 1);
  assert.equal(after.active.movementEvents[0].cause.source.instanceId, before.players[0].trash[0]);
  assert.deepEqual(after.movement.players[0].trash, before.players[0].trash);
});
