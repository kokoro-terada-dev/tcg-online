const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, finish, id, always, selector } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { observeConditionalTriggers } = require('../dist/test/effects/v3/conditionalTriggers.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { trackMovementOccurrences } = require('../dist/test/movement/occurrence.js');

test('ALL applies a modifier to all matching printed-power characters without prompting', () => {
  const h = setup({ field: 2, count: 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.52';
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions: [
      { type: 'SELECT', bindAs: 'all', automatic: 'ALL', selector: { ...selector('SELF'), max: 5,
        filters: { type: 'compare', left: { ref: 'CANDIDATE.printed.power' }, op: 'lte', right: 2000 } } },
      { type: 'MODIFY_STAT', cards: { ref: 'bindings.all' }, stat: 'power', amount: 1000,
        duration: { type: 'TURN_END', player: 'OPPONENT', occurrence: 1 } }
    ] });
  } });
  const row = h.c.mainEffectsFor(0)[0];
  h.c.activateMain(0, id(), h.c.context(), row.sourceToken, row.effectId);
  assert.equal(finish(h.c, 0), undefined);
  const stats = h.c.viewFor(0).publicStats.filter(row => row.zone === 'character');
  assert.deepEqual(stats.filter(row => row.player === 0).map(row => row.powerDelta), [1000, 1000]);
  assert.deepEqual(stats.filter(row => row.player === 1).map(row => row.powerDelta), [0, 0]);

  const old = structuredClone(h.raw);
  old.schemaVersion = '3.0.0-subset.51';
  assert.throws(() => compileV3CardJson(JSON.stringify(old)));
  const invalid = structuredClone(h.raw);
  invalid.effects[0].actions[0].selector.max = 1;
  assert.throws(() => compileV3CardJson(JSON.stringify(invalid)), /automatic-public-selection/);
});

test('self-entry from resolving is observed only on the required turn', () => {
  const h = setup({ count: 1, field: 1, sourceType: 'character', mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.52';
    const effect = raw.effects[0];
    effect.timing = { type: 'ON_EVENT', event: 'CARD_ENTERED', snapshot: 'TRANSACTION_AFTER', relation: 'SELF',
      owner: 'SELF', controller: 'SELF', fromZones: ['resolving'], toZones: ['character'], cardTypes: ['character'], filters: always() };
    effect.activationConditions = { type: 'TURN_IS', player: 'SELF' };
  } });
  const state = structuredClone(h.options.movement);
  const instanceId = state.players[0].hand.shift(), card = state.cards[instanceId];
  card.faceUp = true; state.players[0].resolving.push(instanceId);
  trackMovementOccurrences(state);
  const source = { instanceId, generation: card.generation };
  const moved = new MovementStore(state).commit({ transactionId: id(), matchId: state.matchId, expectedRevision: state.revision,
    turnNumber: state.turnNumber, actor: 0, effectController: 0, source, mode: 'effect', resolutionId: 'self-entry',
    operations: [{ kind: 'move', card: source, from: { player: 0, zone: 'resolving' }, to: {
      player: 0, zone: 'character', position: 'firstEmpty', faceUp: true, rotated: false
    }, cause: 'EFFECT_MOVE' }] }, { status: 'certifiedNone' });
  const definitions = new Map(h.options.cards.map(c => [c.definition.cardId, c]));
  const observe = actor => observeConditionalTriggers({ records: [], events: {} }, moved.events, definitions, actor).records;
  assert.equal(observe(0).filter(row => row.status === 'PENDING').length, 1);
  assert.equal(observe(1).filter(row => row.status === 'PENDING').length, 0);
  const invalid = structuredClone(h.raw);
  invalid.effects[0].timing.relation = 'OTHER';
  assert.throws(() => compileV3CardJson(JSON.stringify(invalid)), /v3-invalid-event-set/);
});
