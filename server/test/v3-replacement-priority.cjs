const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: fixture, finish, selector, id, always } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { MovementStore } = require('../dist/test/movement/engine.js');

const profile = '3.0.0-subset.39';
const fieldTarget = { type: 'OWN_CHARACTER', minPrintedCost: 4 };
const hand = { type: 'MOVE_AS_COST', destination: 'trash', selector: {
  ...selector('SELF'), zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, cardTypes: ['character', 'event', 'stage'], min: 1, max: 1
} };
const shield = (id, extras) => ({ type: 'REPLACE_EVENT', id, match: { cause: 'EFFECT_KO', by: 'ANY', from: 'character', to: 'trash' },
  condition: always(), substitute: { type: 'PREVENT' }, optionalPayment: hand, usageLimit: 'ONCE_PER_TURN', ...extras });
const snap = c => c.snapshotForCoordinator();
const ref = ({ instanceId, generation }) => ({ instanceId, generation });

function setup({ leader = true, characterRules = [], printedCost = 4, attach = false } = {}) {
  const { options, approved } = fixture({ count: 1, field: 3, mutate(raw) {
    raw.schemaVersion = profile;
    if (leader) raw.replacementEffects = [shield('leader-shield', { target: fieldTarget })];
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions: [
      { type: 'SELECT', bindAs: 'victim', selector: { ...selector('SELF'), min: 1 } },
      { type: 'KO', cards: { ref: 'bindings.victim' } }
    ] });
  } });
  const card = options.cards.find(row => row.definition.cardId === 'TARGET');
  const raw = structuredClone(card.definition);
  raw.schemaVersion = profile;
  raw.baseStats.cost = printedCost;
  if (characterRules.length) {
    raw.replacementEffects = characterRules;
    raw.source.text = 'Synthetic replacement fixture.';
  }
  const compiled = compileV3CardJson(JSON.stringify(raw));
  const catalog = new ApprovedV3Catalog([compiled], [{ status: 'approved', cardId: raw.cardId, cardVersion: raw.cardVersion,
    definitionHash: compiled.definitionHash, sourceHash: compiled.sourceHash, compilerVersion: compiled.compilerVersion, registryHash: compiled.registryHash,
    rulesetVersion: approved.rulesetVersion, reviewer: 'synthetic-only', approvedAt: '2026-11-09T00:00:00.000Z', ruleEvidence: ['synthetic-not-real-card-approval']
  }], approved.rulesetVersion);
  let movement = options.movement;
  if (attach) {
    const { cards, players, matchId, revision, turnNumber } = movement;
    movement = new MovementStore(movement).commit({ transactionId: 'test-attach-before-ko', matchId, expectedRevision: revision, turnNumber,
      actor: 0, effectController: null, source: null, mode: 'rule', resolutionId: null, operations: [{
        kind: 'attachDon', card: ref(cards[players[0].activeDon[0]]), target: ref(cards[players[0].character[0]])
      }] }, { status: 'certifiedNone' }).state;
  }
  return new V3SyntheticMatchCoordinator({ ...options, movement, cards: options.cards.map(row => row === card ? catalog.get('TARGET') : row) });
}
function ko(c, slot) {
  const effect = c.mainEffectsFor(0)[0];
  c.activateMain(0, id(), c.context(), effect.sourceToken, effect.effectId);
  const { choice } = finish(c, 0);
  c.answer(0, id(), c.context(), choice.selectionId, [choice.options[slot].token]);
  return finish(c, 0)?.choice;
}
function choose(c, choice, tokens) { return c.answer(0, id(), c.context(), choice.selectionId, tokens); }

test('the initiating card has priority, then the controller can select a distinct same-definition source', () => {
  const c = setup({ characterRules: [shield('character-shield', { target: fieldTarget })] });
  const before = snap(c).movement, [victim, , chosenSource] = before.players[0].character;
  const first = ko(c, 0);
  assert.equal(first.purpose, 'replacementPriority');
  assert.ok(first.options.every(row => row.label.startsWith('リーダー')));
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.deepEqual(snap(c).movement, before);
  choose(c, first, []);
  const second = c.viewFor(0).frame.choice;
  assert.notEqual(second.selectionId, first.selectionId);
  const row = second.options.find(row => row.label.startsWith('キャラ3'));
  assert.ok(row);
  assert.ok(second.options.some(row => row.label.startsWith('キャラ2')));
  assert.throws(() => choose(c, second, [first.options[0].token]), /token/);
  assert.deepEqual(snap(c).replacementUsage, []);
  choose(c, second, [row.token]);
  const request = id(), at = c.context();
  assert.equal(c.applyPendingWork(0, request, at).replayed, false);
  assert.equal(c.applyPendingWork(0, request, at).replayed, true);
  finish(c, 0);
  const after = snap(c), [trace] = after.active.replacementTrace;
  assert.equal(trace.intent.operation.card.instanceId, victim);
  assert.equal(trace.intent.cause.source.instanceId, before.players[0].leader[0]);
  assert.equal(trace.cause.source.instanceId, chosenSource);
  assert.equal(trace.operation.from.zone, 'hand');
  assert.equal(after.movement.players[0].character[0], victim);
  assert.equal(after.active.movementEvents.length, 1);
  assert.equal(after.active.movementEvents[0].isKO, false);
  assert.deepEqual(after.replacementUsage.map(key => JSON.parse(key).slice(1)), [[chosenSource, before.cards[chosenSource].generation, 'character-shield']]);
  assert.ok(!Object.hasOwn(c.viewFor(0), 'replacementUsage'));
});

test('declines do not spend a use, successful use survives new resolutions and resets on turn advance', () => {
  const c = setup();
  let choice = ko(c, 0);
  choose(c, choice, []);
  finish(c, 0);
  assert.equal(snap(c).replacementUsage.length, 0);
  choice = ko(c, 0);
  choose(c, choice, [choice.options[0].token]);
  finish(c, 0);
  assert.equal(snap(c).replacementUsage.length, 1);
  assert.equal(ko(c, 0), undefined);
  assert.equal(snap(c).active.movementEvents.filter(event => event.isKO).length, 1);
  assert.equal(snap(c).replacementHistory.length, 1);
  c.endTurn(0, id(), c.context());
  assert.equal(snap(c).replacementUsage.length, 0);
  c.endTurn(1, id(), c.context());
  assert.ok(ko(c, 0).options.length);
});

test('printed-cost boundary fails closed when unknown, and self-KO can instead return attached DON', () => {
  for (const [cost, expected] of [[3, 'completed'], [null, 'blocked']]) {
    const c = setup({ printedCost: cost }); ko(c, 0);
    assert.equal(c.viewFor(0).frame.status, expected);
    assert.equal(snap(c).active.movementEvents.filter(event => event.isKO).length, cost === 3 ? 1 : 0);
  }
  const c = setup({ leader: false, attach: true, characterRules: [shield('don-shield', {
    optionalPayment: { type: 'DON_RETURN', count: 1, from: ['activeDon', 'restDon', 'attachedDon'] }
  })] });
  const before = snap(c).movement, choice = ko(c, 0);
  const don = before.players[0].attachedDon[0], victim = before.players[0].character[0];
  choose(c, choice, [choice.options.find(row => row.zone === 'attachedDon').token]);
  finish(c, 0);
  const after = snap(c), [event] = after.active.movementEvents;
  assert.equal(event.cause.kind, 'EFFECT_MOVE');
  assert.equal(event.before.instanceId, don);
  assert.equal(event.after.attachedTo, null);
  assert.equal(event.to.zone, 'donDeck');
  assert.equal(after.movement.cards[victim].generation, before.cards[victim].generation);
  assert.equal(after.active.movementEvents.length, 1);
});
