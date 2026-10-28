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
function setup({ actor = 0, don = 2, mutate = () => {}, attach = false, hidden = false, missingStats = false, deckCount, handCount, handFaceDown = false } = {}) {
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
  if (handCount !== undefined) zones.trash.push(...zones.hand.splice(handCount).map(card => ({ ...card, faceUp: true })));
  if (handFaceDown) zones.hand = zones.hand.map(card => ({ ...card, faceUp: false }));
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
function fieldActions(...types) {
  return d => { d.effects[0].actions = [d.effects[0].actions[0], ...types.map(type => ({ type, cards: { ref: 'bindings.picked' } }))]; };
}
function beginFieldWork(s) {
  const c = s.coordinator; c.advance(s.actor, 'field-start', c.context()); const choice = choose(s);
  c.answer(s.actor, 'field-choose', choice.context, choice.id, choice.tokens); c.advance(s.actor, 'field-work', c.context()); return c;
}
function privateHand(d) {
  const select = d.effects[0].actions[0];
  Object.assign(select.selector, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, min: 1, max: 1, owner: 'SELF', controller: 'SELF', chooser: 'SELF', filters: { type: 'all', conditions: [] } });
  d.effects[0].actions = [select, { type: 'MOVE_CARD', cards: { ref: 'bindings.picked' }, destination: { owner: 'SELF', zone: 'trash', position: 'append', faceUp: true }, cause: 'EFFECT' }, { type: 'DRAW', player: 'SELF', count: 1 }];
}

test('private hand discard is published only after the move and subsequent draw stays hidden for both actors', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor, mutate: privateHand, handFaceDown: true }), c = s.coordinator, before = c.snapshotForCoordinator(), selectedId = before.movement.players[actor].hand[0];
    assert.equal(before.movement.cards[selectedId].faceUp, false);
    c.advance(actor, 'private-start', c.context()); const choice = choose(s);
    assert.equal(c.viewFor(actor).frame.choice.options.length, 5); assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
    assert.throws(() => c.answer(1 - actor, 'foreign-hand', choice.context, choice.id, choice.tokens));
    assert.throws(() => c.answer(actor, 'cannot-skip', choice.context, choice.id, []));
    c.answer(actor, 'private-answer', choice.context, choice.id, choice.tokens); c.advance(actor, 'discard-request', c.context());
    const context = c.context(); c.applyPendingWork(actor, 'discard', context); assert.equal(c.applyPendingWork(actor, 'discard', context).replayed, true);
    const moved = c.snapshotForCoordinator(), event = moved.movementEvents.find(e => e.before?.instanceId === selectedId);
    assert.equal(moved.movement.players[actor].hand.length, 4); assert.equal(moved.movement.players[actor].trash.includes(selectedId), true);
    assert.equal(moved.movement.cards[selectedId].faceUp, true); assert.equal(event.cause.kind, 'EFFECT_MOVE'); assert.equal(event.isKO, false);
    assert.deepEqual(event.visibleBefore, [actor]); assert.deepEqual(event.visibleAfter, [0, 1]);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].trash[0].ref.instanceId, selectedId);
    c.advance(actor, 'draw-request', c.context()); c.applyPendingWork(actor, 'draw', c.context()); c.advance(actor, 'private-finish', c.context());
    const view = c.viewFor(actor); assert.equal(view.frame.status, 'completed'); assert.equal(view.movement.players[actor].hand.length, 5);
    assert.equal(view.movement.players[actor].activeDon.length, 2); assert.equal(view.movement.players[actor].restDon.length, 0);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  }
});

test('empty required hand selection stops without drawing, and allowing hand moves does not authorize hand KO', () => {
  const empty = setup({ mutate: privateHand, handCount: 0 }).coordinator, before = empty.snapshotForCoordinator();
  assert.throws(() => empty.advance(0, 'no-hand', empty.context())); assert.equal(empty.snapshotForCoordinator().movement, before.movement); assert.equal(empty.snapshotForCoordinator().frame, before.frame);
  const s = setup({ mutate: d => { privateHand(d); d.effects[0].actions[1] = { type: 'KO', cards: { ref: 'bindings.picked' } }; } }), c = beginFieldWork(s), state = c.snapshotForCoordinator().movement;
  c.applyPendingWork(0, 'illegal-hand-ko', c.context()); assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.snapshotForCoordinator().movement, state);
});

test('effect KO emits a KO event and returns attached DON, unlike a direct move to trash', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor, attach: true, mutate: fieldActions('KO') }), c = beginFieldWork(s), context = c.context();
    c.applyPendingWork(actor, 'ko', context); assert.equal(c.applyPendingWork(actor, 'ko', context).replayed, true);
    const snapshot = c.snapshotForCoordinator(), event = snapshot.movementEvents.find(e => e.before?.instanceId === s.target.instanceId);
    assert.equal(snapshot.movement.players[actor].character[1], null); assert.equal(snapshot.movement.players[actor].trash.includes(s.target.instanceId), true);
    assert.equal(event.cause.kind, 'EFFECT_KO'); assert.equal(event.isKO, true); assert.equal(event.cause.actor, actor);
    assert.equal(snapshot.movement.players[actor].attachedDon.length, 0); assert.equal(snapshot.movement.players[actor].restDon.length, 1);
    c.advance(actor, 'ko-finish', c.context()); assert.equal(c.viewFor(actor).frame.status, 'completed');
  }
  const moved = setup({ mutate: d => d.effects[0].actions[1].then[0].destination.zone = 'trash' }), c = beginFieldWork(moved);
  c.applyPendingWork(0, 'trash', c.context()); const event = c.snapshotForCoordinator().movementEvents.find(e => e.before?.instanceId === moved.target.instanceId);
  assert.equal(event.isKO, false); assert.equal(event.cause.kind, 'EFFECT_MOVE');
});

test('REST and SET_ACTIVE are absolute states, preserve object generation, and do not toggle on repeated operations', () => {
  const s = setup({ mutate: fieldActions('REST', 'REST', 'SET_ACTIVE', 'SET_ACTIVE') }), c = beginFieldWork(s);
  for (let i = 0; i < 4; i++) {
    c.applyPendingWork(0, `rest-step-${i}`, c.context()); const snapshot = c.snapshotForCoordinator();
    assert.equal(snapshot.movement.cards[s.target.instanceId].rotated, i < 2); assert.equal(snapshot.movement.cards[s.target.instanceId].generation, 0);
    c.advance(0, `rest-next-${i}`, c.context());
  }
  assert.equal(c.viewFor(0).frame.status, 'completed');
  assert.equal(c.snapshotForCoordinator().movementEvents.filter(e => e.kind === 'restChanged').length, 2);
});

test('KO refuses leaders and REST refuses trash targets without moving or changing any card', () => {
  for (const type of ['KO', 'REST']) {
    const s = setup({ deckCount: 10, mutate: d => {
      fieldActions(type)(d); const selector = d.effects[0].actions[0].selector;
      selector.zone = type === 'KO' ? 'leader' : 'trash'; selector.cardTypes = [type === 'KO' ? 'leader' : 'character']; selector.excludeSource = false; selector.filters = { type: 'all', conditions: [] };
    } }), c = beginFieldWork(s), before = c.snapshotForCoordinator();
    c.applyPendingWork(0, 'invalid-target', c.context()); assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.snapshotForCoordinator().movement, before.movement);
  }
});

test('a field reference becomes stale after KO and cannot affect the moved card in a later action', () => {
  const s = setup({ mutate: fieldActions('KO', 'SET_ACTIVE') }), c = beginFieldWork(s);
  c.applyPendingWork(0, 'ko', c.context()); c.advance(0, 'stale-request', c.context()); const before = c.snapshotForCoordinator();
  c.applyPendingWork(0, 'stale-work', c.context()); const after = c.snapshotForCoordinator();
  assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(after.movement, before.movement); assert.equal(after.movement.cards[s.target.instanceId].generation, 1);
});
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
