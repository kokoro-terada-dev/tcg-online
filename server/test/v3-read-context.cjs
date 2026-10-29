const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDerivedCardFactsReader, readEventContext, UNKNOWN } = require('../dist/test/effects/v3/readContext.js');
const { fixtureEnvironment } = require('../dist/test/effects/v3/fixtureEnvironment.js');
const { loadReviewedV3Preset } = require('../dist/test/effects/v3/reviewedPresets.js');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { pinMasterFacts } = require('../dist/test/effects/masterFacts.js');

function setup(actor = 0) {
  const { deck, reviewed } = loadReviewedV3Preset('kid-basic'), match = createMatch(deck, deck);
  const zones = match.players[actor].zones;
  for (const zone of ['deck', 'hand', 'life']) {
    const i = zones[zone].findIndex(c => c.cardId === 'ST02-006');
    if (i >= 0) { zones.character[0] = { ...zones[zone].splice(i, 1)[0], faceUp: true }; break; }
  }
  zones.activeDon.push({ ...zones.donDeck.shift(), faceUp: true, rotated: false });
  let board = new MatchMovementCapture(match, 1).snapshot().movement;
  const source = { instanceId: board.players[actor].character[0], generation: 0 };
  const definitions = new Map(reviewed.cards.map(card => [card.definition.cardId, card]));
  const identity = { matchId: board.matchId, resolutionId: 'read-fixture', effectId: 'read', actor, source };
  const commit = operations => {
    const result = new MovementStore(board).commit({ transactionId: `read-${board.revision}`, matchId: board.matchId, expectedRevision: board.revision,
      turnNumber: board.turnNumber, actor, effectController: actor, source, mode: 'effect', resolutionId: 'read-fixture', operations }, { status: 'certifiedNone' });
    board = result.state; return result;
  };
  return { actor, source, identity, definitions, board: () => board, commit, setBoard: value => board = value,
    reader: (effects = [], activePlayer = actor, counterPower) => createDerivedCardFactsReader({ board: () => board, definitions, statEffects: () => effects, activePlayer, counterPower }) };
}

test('event context separates resolving controller, chooser, source owner and root movement cause', () => {
  for (const actor of [0, 1]) {
    const s = setup(actor), peer = 1 - actor;
    const moved = s.commit([{ kind: 'move', card: s.source, from: { player: actor, zone: 'character' }, to: { player: actor, zone: 'trash', position: 'append', faceUp: true, rotated: false }, cause: 'EFFECT_KO' }]);
    const event = structuredClone(moved.events[0]); event.cause.actor = peer; event.cause.effectController = peer;
    const identity = { ...s.identity, source: { ...s.source, generation: 1 } };
    const c = readEventContext(s.board(), identity, peer, { type: 'movement', event });
    assert.equal(c.effectController, actor); assert.equal(c.chooser, peer); assert.equal(c.sourceOwner, actor); assert.equal(c.sourceController, actor);
    assert.equal(c.cause.effectController, peer); assert.equal(c.cause.kind, 'EFFECT_KO'); assert.equal(c.eventId, event.eventId);
    event.cause.actor = actor; assert.equal(c.cause.actor, peer); assert.equal(Object.isFrozen(c.cause), true);
    const attack = readEventContext(s.board(), identity, actor, { type: 'attack', eventId: 'attack:event', battleId: 'battle', attacker: peer });
    assert.equal(attack.origin, 'attack'); assert.equal(attack.attack.attacker, peer); assert.equal(attack.cause, null);
    assert.throws(() => readEventContext(s.board(), s.identity));
    assert.throws(() => readEventContext(s.board(), { ...identity, matchId: 'other' }));
    assert.throws(() => readEventContext(s.board(), identity, 3));
  }
});

test('derived facts retain printed values and separate stat, turn-sensitive DON and counter values', () => {
  for (const actor of [0, 1]) {
    const s = setup(actor), don = { instanceId: s.board().players[actor].activeDon[0], generation: 0 };
    s.commit([{ kind: 'attachDon', card: don, target: s.source }]);
    const effects = [{ target: s.source, stat: 'power', amount: 2000 }, { target: s.source, stat: 'cost', amount: -10 }];
    const value = s.reader(effects, actor, () => 1000)(s.source, 1 - actor);
    assert.equal(value.printed.power, 6000); assert.equal(value.printed.cost, 4); assert.equal(value.current.power, 10000); assert.equal(value.current.cost, 0);
    assert.equal(s.reader(effects, 1 - actor, () => 1000)(s.source, actor).current.power, 9000);
    assert.equal(Object.isFrozen(value.printed), true); assert.equal(s.board().cards[s.source.instanceId].cardId, 'ST02-006');
    const malformed = structuredClone(s.board()); malformed.cards[s.source.instanceId].modifierIds.push('unmodeled'); s.setBoard(malformed);
    assert.equal(s.reader()(s.source, actor).printed.power, 6000); assert.equal(s.reader()(s.source, actor).current.power, UNKNOWN);
  }
});

test('known catalog entries do not reveal opponent hands, decks, face-down life or internal resolving cards', () => {
  for (const actor of [0, 1]) {
    const s = setup(actor), ref = id => ({ instanceId: id, generation: s.board().cards[id].generation }), peer = 1 - actor;
    const hand = ref(s.board().players[actor].hand[0]), deck = ref(s.board().players[actor].deck[0]), life = ref(s.board().players[actor].life[0]);
    assert.notEqual(s.reader()(hand, actor), UNKNOWN); assert.equal(s.reader()(hand, peer), UNKNOWN);
    assert.equal(s.reader()(deck, actor), UNKNOWN); assert.equal(s.reader()(deck, peer), UNKNOWN);
    assert.equal(s.reader()(life, actor), UNKNOWN); assert.equal(s.reader()(life, peer), UNKNOWN);
    s.commit([{ kind: 'reveal', card: deck, scopeId: 'read-fixture', viewers: [actor] }]);
    assert.notEqual(s.reader()(deck, actor), UNKNOWN); assert.equal(s.reader()(deck, peer), UNKNOWN);
    s.commit([{ kind: 'closeReveals', scopeId: 'read-fixture' }]); assert.equal(s.reader()(deck, actor), UNKNOWN);
    s.commit([{ kind: 'move', card: life, from: { player: actor, zone: 'life' }, to: { player: actor, zone: 'resolving', position: 'append', faceUp: true, rotated: false }, cause: 'EFFECT_MOVE' }]);
    assert.equal(s.reader()({ ...life, generation: 1 }, actor), UNKNOWN);
  }
});

test('UNKNOWN, null, zero, stale references and legacy master fallback never get conflated', () => {
  const s = setup(), leader = { instanceId: s.board().players[0].leader[0], generation: 0 };
  assert.equal(s.reader()(leader, 0).printed.cost, UNKNOWN); assert.equal(s.reader()(s.source, 0).printed.life, UNKNOWN);
  assert.equal(s.reader()({ ...s.source, generation: 9 }, 0), UNKNOWN);
  const master = { version: null, numericPolicy: 'certifiedUnmodified', cards: { 'ST02-006': { cost: 0, power: 0 } } };
  const read = createDerivedCardFactsReader({ board: s.board, definitions: new Map(), master, statEffects: () => [], activePlayer: 0 });
  assert.equal(read(s.source, 0).printed.power, 0); assert.equal(read(s.source, 0).current.power, 0);
  const noFacts = createDerivedCardFactsReader({ board: s.board, definitions: new Map(), statEffects: () => [], activePlayer: 0 });
  assert.equal(noFacts(s.source, 0).current.power, UNKNOWN);
  s.commit([{ kind: 'attachDon', card: { instanceId: s.board().players[0].activeDon[0], generation: 0 }, target: s.source }]);
  assert.equal(read(s.source, 0).current.power, UNKNOWN); // Preserve legacy uncertified attached-DON fallback.
});

test('existing predicate evaluation consumes the contract and refuses private opponent candidates', () => {
  const s = setup(), card = s.definitions.get('ST02-006');
  const env = fixtureEnvironment(s.board, s.identity, card, pinMasterFacts(s.board(), { master: null, numericPolicy: 'certifiedUnmodified' }), () => 1000, [...s.definitions.values()]);
  const compare = (ref, right) => ({ type: 'compare', left: { ref }, op: 'eq', right });
  assert.equal(env.evaluate(compare('SOURCE.power', 6000), {}), true);
  assert.equal(env.evaluate(compare('SOURCE.cost', 0), {}), false);
  const hand = { instanceId: s.board().players[1].hand[0], generation: 0 };
  assert.equal(env.evaluate(compare('CANDIDATE.cost', 0), {}, hand), 'unknown');
  assert.equal(env.evaluate(compare('bindings.missing.count', 0), {}), 'unknown');
});

test('a source moving during resolution does not rebuild its role snapshot from a stale generation', () => {
  const s = setup(), { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
  const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
  const { V3FixtureCoordinator } = require('../dist/test/effects/v3/fixtureCoordinator.js');
  const { createProgression } = require('../dist/test/progression/state.js');
  const { applySystemEvent } = require('../dist/test/progression/transitions.js');
  const definition = structuredClone(s.definitions.get('ST02-006').definition);
  definition.source.text = 'Synthetic role snapshot regression only; not an official card ability.';
  definition.effects = [{ id: 'read', kind: 'activated', timing: { type: 'MAIN' }, sourceZones: ['character'], optional: false, usageLimit: null,
    activationConditions: { type: 'all', conditions: [] }, resolutionConditions: { type: 'all', conditions: [] }, costs: [], actions: [
      { type: 'SELECT', bindAs: 'chosen', selector: { type: 'CARDS', owner: 'SELF', controller: 'SELF', chooser: 'OPPONENT', zone: 'character', cardTypes: ['character'],
        filters: { type: 'all', conditions: [] }, excludeSource: false, faceUpOnly: true, min: 0, max: 1, visibility: 'PUBLIC', selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' } },
      { type: 'BIND_SOURCE', bindAs: 'self' }, { type: 'MOVE_CARD', cards: { ref: 'bindings.self' }, destination: { owner: 'SELF', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' },
      { type: 'DRAW', player: 'SELF', count: 1 },
    ] }];
  const plan = compileV3CardJson(JSON.stringify(definition));
  const card = new ApprovedV3Catalog([plan], [{ status: 'approved', cardId: definition.cardId, cardVersion: definition.cardVersion,
    definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash,
    rulesetVersion: 'synthetic-read.1', reviewer: 'synthetic-regression-only', approvedAt: '2026-10-29T00:00:00.000Z', ruleEvidence: ['synthetic-not-official-card'] }], 'synthetic-read.1').get(definition.cardId);
  let progression = createProgression(0);
  while (true) {
    progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') break;
    progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  const c = new V3FixtureCoordinator({ mode: 'syntheticNoAbilities', card, identity: s.identity, movement: s.board(), progression, signingKey: Buffer.alloc(32, 29), master: null });
  assert.equal(c.readContextForCoordinator().chooser, null);
  for (let i = 0; i < 12 && c.viewFor(0).frame.status !== 'completed'; i++) {
    if (c.viewFor(0).frame.status === 'ready') c.advance(0, `advance-${i}`, c.context());
    else if (c.viewFor(0).frame.status === 'waitingForChoice') {
      const context = c.context(), choice = c.viewFor(1).frame.choice;
      assert.equal(c.readContextForCoordinator().chooser, 1); assert.equal(c.readContextForCoordinator().effectController, 0);
      assert.deepEqual(c.viewFor(0).frame.choice.options, []);
      assert.throws(() => c.answer(0, 'wrong-chooser', context, choice.selectionId, []));
      c.answer(1, `choice-${i}`, context, choice.selectionId, []);
      assert.throws(() => c.advance(0, 'stale-after-choice', context));
    }
    else { const context = c.context(); c.applyPendingWork(0, `work-${i}`, context); assert.equal(c.applyPendingWork(0, `work-${i}`, context).replayed, true); }
  }
  assert.equal(c.viewFor(0).frame.status, 'completed');
  assert.equal(c.snapshotForCoordinator().movement.players[0].hand.includes(s.source.instanceId), true);
  assert.equal(c.snapshotForCoordinator().movement.cards[s.source.instanceId].generation, 1);
  assert.equal(c.readContextForCoordinator().sourceOwner, 0); assert.equal(c.readContextForCoordinator().chooser, null);
});
