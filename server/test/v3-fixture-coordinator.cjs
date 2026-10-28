const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { createProgression, checkTiming } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3FixtureCoordinator } = require('../dist/test/effects/v3/fixtureCoordinator.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const key = Buffer.alloc(32, 9); // Synthetic key, not a deployment secret.
function setup({ actor = 0, don = 2, mutate = () => {}, attach = false, hidden = false, missingStats = false, deckCount } = {}) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-select-move.json'), 'utf8'));
  data.reviewStatus = 'approved'; data.baseStats.cost = 2; data.baseStats.power = 2000; mutate(data);
  const plan = compileV3CardJson(JSON.stringify(data)), record = { status: 'approved', cardId: data.cardId, cardVersion: data.cardVersion, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash,
    rulesetVersion: 'synthetic.1', reviewer: 'fixture', approvedAt: '2026-10-28T00:00:00.000Z', ruleEvidence: ['synthetic-test:not-official-rulings'] };
  const card = new ApprovedV3Catalog([plan], [record], 'synthetic.1').get(data.cardId);
  const recipe = { name: 'Fixture', leaderCardId: 'LEADER', mainDeck: Array(50).fill(data.cardId), donDeck: Array(10).fill('DON'), cardTypes: { [data.cardId]: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe), zones = match.players[actor].zones;
  zones.character[0] = { ...zones.deck.shift(), faceUp: true, rotated: false };
  zones.character[1] = { ...zones.deck.shift(), faceUp: !hidden, rotated: false };
  if (missingStats) zones.character[1].cardId = 'UNKNOWN-CARD';
  if (hidden) { zones.public.push(zones.character[1]); zones.character[1] = null; }
  for (let i = 0; i < don; i++) zones.activeDon.push({ ...zones.donDeck.shift(), faceUp: true, rotated: false });
  if (deckCount !== undefined) zones.trash.push(...zones.deck.splice(deckCount).map(card => ({ ...card, faceUp: true })));
  let progression = createProgression(actor);
  while (true) {
    progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') break;
    progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  let movement = new MatchMovementCapture(match, 1).snapshot().movement;
  const source = { instanceId: zones.character[0].id, generation: 0 }, target = { instanceId: (zones.character[1] ?? zones.public[0]).id, generation: 0 };
  if (attach) {
    const id = movement.players[actor].activeDon[0];
    movement = new MovementStore(movement).commit({ transactionId: 'seed-attach', matchId: movement.matchId, expectedRevision: movement.revision, turnNumber: 1, actor, effectController: actor, source, mode: 'rule', resolutionId: null,
      operations: [{ kind: 'attachDon', card: { instanceId: id, generation: 0 }, target }] }, { status: 'certifiedNone' }).state;
  }
  const options = { mode: 'syntheticNoAbilities', card, identity: { matchId: match.id, resolutionId: 'v3-fixture', effectId: 'main', actor, source }, movement, progression, signingKey: key, master: null, now: () => 1000 };
  return { coordinator: new V3FixtureCoordinator(options), options, actor, source, target };
}
function choose(s) {
  const c = s.coordinator, v = c.viewFor(s.actor), context = c.context();
  return { context, id: v.frame.choice.selectionId, tokens: [v.frame.choice.options[0].token] };
}
test('public selection moves a real card through MovementEngine and releases progression only on completion for both seats', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor }), c = s.coordinator;
    assert.equal(c.viewFor(actor).progression.gate, 'resolving'); assert.equal(checkTiming(c.snapshotForCoordinator().progression, actor, 'endMain').allowed, false);
    const start = c.context(); c.advance(actor, 'start', start); assert.equal(c.advance(actor, 'start', start).replayed, true);
    assert.equal(c.viewFor(actor).progression.gate, 'choice'); assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
    const choice = choose(s); assert.throws(() => c.answer(1 - actor, 'foreign', choice.context, choice.id, choice.tokens));
    c.answer(actor, 'choose', choice.context, choice.id, choice.tokens); assert.equal(c.answer(actor, 'choose', choice.context, choice.id, choice.tokens).replayed, true);
    assert.equal(c.viewFor(actor).progression.gate, 'resolving'); c.advance(actor, 'to-work', c.context());
    const workContext = c.context(), before = c.snapshotForCoordinator(); c.applyPendingWork(actor, 'move', workContext);
    assert.equal(c.applyPendingWork(actor, 'move', workContext).replayed, true);
    const after = c.snapshotForCoordinator(); assert.equal(after.movement.revision, before.movement.revision + 1);
    assert.equal(after.movement.players[actor].character[1], null); assert.equal(after.movement.players[actor].hand.includes(s.target.instanceId), true);
    assert.equal(after.movement.cards[s.target.instanceId].generation, 1); assert.equal(after.movement.cards[s.source.instanceId].generation, 0);
    assert.equal(after.movementEvents[0].cause.kind, 'EFFECT_MOVE'); assert.equal(after.movementEvents[0].isKO, false);
    assert.equal(after.movementEvents[0].cause.source.instanceId, s.source.instanceId);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
    assert.deepEqual(Object.keys(after.movement.cards).sort(), Object.keys(before.movement.cards).sort());
    c.advance(actor, 'finish', c.context()); assert.equal(c.viewFor(actor).frame.status, 'completed'); assert.equal(c.viewFor(actor).progression.gate, 'idle');
    assert.throws(() => JSON.stringify(c));
  }
});
test('REST_DON pays an exact aggregated amount, draws privately, and never pays twice on retry', () => {
  const s = setup({ mutate: d => { d.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'REST_DON', count: 1 }]; d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }]; } }), c = s.coordinator;
  c.advance(0, 'start', c.context()); const cost = c.context(); c.applyPendingWork(0, 'pay', cost);
  assert.equal(c.applyPendingWork(0, 'pay', cost).replayed, true);
  assert.equal(c.viewFor(0).movement.players[0].activeDon.length, 0); assert.equal(c.viewFor(0).movement.players[0].restDon.length, 2);
  assert.equal(c.snapshotForCoordinator().movementEvents.every(event => event.cause.kind === 'COST_PAYMENT'), true);
  c.advance(0, 'draw-request', c.context()); c.applyPendingWork(0, 'draw', c.context()); c.advance(0, 'finish', c.context());
  assert.equal(c.viewFor(0).movement.players[0].hand.length, 6); assert.equal(c.viewFor(1).movement.players[0].hand.at(-1).cardId, null);
  assert.equal(c.viewFor(0).frame.status, 'completed');
});
test('insufficient composite DON payment leaves all DON active and blocks further progress', () => {
  const s = setup({ don: 1, mutate: d => d.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'REST_DON', count: 1 }] }), c = s.coordinator;
  c.advance(0, 'start', c.context()); const before = c.snapshotForCoordinator(); c.applyPendingWork(0, 'cannot-pay', c.context());
  const after = c.snapshotForCoordinator(); assert.equal(after.movement, before.movement); assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.viewFor(0).progression.gate, 'resolving');
  assert.equal(after.movement.players[0].activeDon.length, 1); assert.equal(after.movement.players[0].restDon.length, 0);
});

test('real predicate evaluation honors boolean composition and preserves already-paid costs when resolution conditions fail', () => {
  const s = setup({ mutate: d => {
    d.effects[0].activationConditions = { type: 'not', condition: { type: 'any', conditions: [{ type: 'compare', left: 1, op: 'ne', right: 1 }] } };
    d.effects[0].resolutionConditions = { type: 'compare', left: { ref: 'SOURCE.power' }, op: 'lt', right: 0 };
    d.effects[0].costs = [{ type: 'REST_DON', count: 1 }]; d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }];
  } }), c = s.coordinator;
  c.advance(0, 'activation', c.context()); c.applyPendingWork(0, 'pay', c.context()); c.advance(0, 'condition-false', c.context());
  assert.equal(c.viewFor(0).frame.status, 'completed'); assert.equal(c.viewFor(0).progression.gate, 'idle');
  assert.equal(c.viewFor(0).movement.players[0].restDon.length, 1); assert.equal(c.viewFor(0).movement.players[0].hand.length, 5);
});
test('unknown numeric facts stop without advancing the frame, whereas face-down public-area cards are not candidates', () => {
  const s = setup({ missingStats: true }), c = s.coordinator, before = c.snapshotForCoordinator();
  assert.throws(() => c.advance(0, 'unknown', c.context())); const after = c.snapshotForCoordinator();
  assert.equal(after.frame, before.frame); assert.equal(after.movement, before.movement); assert.equal(after.progression, before.progression);
  const hidden = setup({ hidden: true, mutate: d => d.effects[0].actions[0].selector.zone = 'public' }).coordinator; hidden.advance(0, 'empty', hidden.context()); assert.equal(hidden.viewFor(0).frame.status, 'completed');
});
test('bouncing a character returns attached DON through existing automatic movement handling', () => {
  const s = setup({ attach: true }), c = s.coordinator; c.advance(0, 'start', c.context()); const choice = choose(s);
  c.answer(0, 'choose', choice.context, choice.id, choice.tokens); c.advance(0, 'work', c.context()); c.applyPendingWork(0, 'move', c.context());
  assert.equal(c.viewFor(0).movement.players[0].attachedDon.length, 0); assert.equal(c.viewFor(0).movement.players[0].restDon.length, 1);
});
test('deck-out and wrong ownership destinations are explicitly blocked without partial moves', () => {
  const empty = setup({ deckCount: 1, mutate: d => d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }] }).coordinator;
  empty.advance(0, 'start', empty.context()); const before = empty.snapshotForCoordinator(); empty.applyPendingWork(0, 'draw', empty.context());
  assert.equal(empty.snapshotForCoordinator().movement, before.movement); assert.equal(empty.viewFor(0).frame.status, 'blocked');
  const s = setup({ mutate: d => d.effects[0].actions[1].then[0].destination.owner = 'OPPONENT' }), c = s.coordinator;
  c.advance(0, 'start', c.context()); const choice = choose(s); c.answer(0, 'choose', choice.context, choice.id, choice.tokens); c.advance(0, 'work', c.context());
  const state = c.snapshotForCoordinator().movement; c.applyPendingWork(0, 'illegal', c.context()); assert.equal(c.snapshotForCoordinator().movement, state); assert.equal(c.viewFor(0).frame.status, 'blocked');
});
test('controller, context and replay guards reject unauthorized or changed requests; production is disabled', () => {
  const s = setup(), c = s.coordinator, start = c.context(); assert.throws(() => c.advance(1, 'foreign', start));
  assert.throws(() => c.advance(0, 'stale', { ...start, movementRevision: 99 })); c.advance(0, 'start', start);
  assert.throws(() => c.advance(0, 'start', c.context())); assert.throws(() => c.applyPendingWork(1, 'foreign-work', c.context()));
  assert.throws(() => new V3FixtureCoordinator({ ...s.options, identity: { ...s.options.identity, source: { instanceId: s.options.movement.players[0].leader[0], generation: 0 } } }));
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.throws(() => new V3FixtureCoordinator(s.options)); assert.throws(() => c.advance(0, 'production', c.context())); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
