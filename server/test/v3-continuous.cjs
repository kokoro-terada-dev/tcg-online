const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: fixture, finish, selector, id, always } = require('./helpers/v3-observed.cjs');
const { createDerivedCardFactsReader, UNKNOWN } = require('../dist/test/effects/v3/readContext.js');
const { attackOptions, battlePower } = require('../dist/test/effects/v3/battle.js');

const query = (owner = 'SELF') => ({ type: 'QUERY_CARDS', owner, controller: owner, zone: 'character', visibility: 'PUBLIC', faceUpOnly: true,
  cardTypes: ['character'], filters: always(), excludeSource: false });
const add = (stat, amount) => ({ type: 'ADD_STAT', stat, amount });
const grant = type => ({ type: 'GRANT_KEYWORD', keyword: { type } });
const continuous = (operation, condition = always(), affectedQuery = query()) => ({ type: 'CONTINUOUS_EFFECT', condition, affectedQuery, operation });
const compare = (ref, right) => ({ type: 'compare', left: { ref }, op: 'eq', right });
const turn = player => ({ type: 'TURN_IS', player });
const draw = { type: 'DRAW', player: 'SELF', count: 1 };
const ref = ({ instanceId, generation }) => ({ instanceId, generation });
function setup(effects, { field = 1, sourceType = 'leader', actions = [draw], costs = [], prepare = () => {} } = {}) {
  return fixture({ count: 1, field, sourceType, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.34'; raw.continuousEffects = effects;
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions, costs });
  }, mutateBoard: prepare });
}
const stats = (c, player, viewer = 0) => c.viewFor(viewer).publicStats.filter(row => row.zone === 'character' && row.player === player);
const snapshot = c => c.snapshotForCoordinator();
function start(c, slot = 0) {
  const e = c.mainEffectsFor(0).find(row => row.slot === slot);
  c.activateMain(0, id(), c.context(), e.sourceToken, e.effectId);
}
function reader(board, cards, activePlayer, statEffects = [], keywordGrants = []) {
  return createDerivedCardFactsReader({ board: () => board, definitions: new Map(cards.map(card => [card.definition.cardId, card])),
    activePlayer, statEffects: () => statEffects, keywordGrants: () => keywordGrants });
}

test('turn-gated field cost is shared by current-cost choices and both views without reapplying on resume', () => {
  const { c, options } = setup([continuous(add('cost', 1), turn('OPPONENT'))], { actions: [
    { type: 'SELECT', bindAs: 'target', selector: { ...selector(), min: 1, filters: compare('CANDIDATE.current.cost', 3) } },
    { type: 'MODIFY_STAT', cards: { ref: 'bindings.target' }, stat: 'cost', amount: 2, duration: { type: 'TURN_END', player: 'SELF', occurrence: 1 } },
  ] });
  assert.equal(stats(c, 0)[0].cost, 2);
  const target = stats(c, 1)[0].card, facts = reader(snapshot(c).movement, options.cards, 0)(target, 0);
  assert.equal(facts.printed.cost, 2); assert.equal(facts.current.cost, 3);
  start(c); finish(c, 0);
  const q = c.viewFor(0).frame.choice, context = c.context(), request = id(), tokens = [q.options[0].token];
  assert.equal(q.options.length, 1);
  assert.equal(stats(c, 1)[0].cost, 3); assert.equal(stats(c, 1, 1)[0].cost, 3);
  c.answer(0, request, context, q.selectionId, tokens);
  assert.equal(c.answer(0, request, context, q.selectionId, tokens).replayed, true);
  finish(c, 0);
  assert.equal(stats(c, 1)[0].cost, 5); assert.equal(snapshot(c).statEffects.length, 1);
  c.endTurn(0, id(), c.context());
  assert.equal(stats(c, 1)[0].cost, 2); assert.equal(stats(c, 0)[0].cost, 3);
  assert.equal(snapshot(c).statEffects.length, 0);
});

test('each valid source contributes once; rested and departed sources do not leave residual grants', () => {
  const { c } = setup([continuous(add('cost', 1), compare('SOURCE.rotated', false)), continuous(grant('BLOCKER'), compare('SOURCE.rotated', false))], {
    field: 3, sourceType: 'character', costs: [{ type: 'MOVE_AS_COST', selector: 'SOURCE', destination: 'trash' }],
    prepare(b) { b.cards[b.players[0].character[2]].rotated = true; },
  });
  assert.deepEqual(stats(c, 0).map(row => row.costDelta), [2, 2, 2]);
  assert(stats(c, 0).every(row => row.keywords.filter(keyword => keyword === 'BLOCKER').length === 1));
  start(c, 0); finish(c, 0);
  assert.deepEqual(stats(c, 0).map(row => row.costDelta), [1, 1]);
  start(c, 1); finish(c, 0);
  assert.deepEqual(stats(c, 0).map(row => row.costDelta), [0]);
  assert.deepEqual(stats(c, 0)[0].keywords, []);
  assert.deepEqual(snapshot(c).keywordGrants, []);
});

test('combat reads continuous power and Rush, while printed values and hand costs stay unchanged', () => {
  const { options } = setup([continuous(add('power', 500), turn('SELF')), continuous(grant('RUSH'), turn('SELF'))]);
  const board = structuredClone(options.movement), definitions = new Map(options.cards.map(card => [card.definition.cardId, card]));
  const source = ref(board.cards[board.players[0].character[0]]), target = ref(board.cards[board.players[1].character[0]]);
  const facts = reader(board, options.cards, 0), known = facts(source, 0);
  assert.equal(known.printed.power, 2000); assert.equal(known.current.power, 2500);
  assert.equal(known.abilities.PRINTED.RUSH, false); assert.equal(known.abilities.CURRENT.RUSH, true);
  const ownHand = ref(board.cards[board.players[0].hand[0]]);
  assert.equal(facts(ownHand, 0).current.cost, 2); assert.equal(facts(ownHand, 1), UNKNOWN);
  const progression = { ...options.progression, turnNumber: 3 };
  board.turnNumber = 3;
  board.cards[source.instanceId].enteredTurn = 3;
  assert(attackOptions(board, progression, 0, definitions, []).sources.some(row => row.card.instanceId === source.instanceId));
  assert.deepEqual(battlePower(board, { ...progression, battle: { source, target, attacker: 0, defender: 1 } }, definitions, [], []), { attack: 2500, defense: 2000 });
});

test('unknown printed facts do not become a zero modifier or a granted keyword', () => {
  const condition = compare('SOURCE.printed.cost', 0);
  const { c, options } = setup([continuous(add('cost', 1), condition), continuous(grant('BLOCKER'), condition)]);
  const row = stats(c, 0)[0], facts = reader(snapshot(c).movement, options.cards, 0)(row.card, 1);
  assert.equal(facts.printed.cost, 2); assert.equal(facts.current.cost, UNKNOWN);
  assert.equal(facts.abilities.CURRENT.BLOCKER, UNKNOWN);
  assert.equal(row.cost, null); assert.equal(row.costDelta, null);
  assert.deepEqual(row.keywords, []); assert.equal(row.keywordsUnknown, true);
});
