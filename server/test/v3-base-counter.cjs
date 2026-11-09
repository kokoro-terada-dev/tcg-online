const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: fixture, finish, selector, id, always } = require('./helpers/v3-observed.cjs');
const { createDerivedCardFactsReader, UNKNOWN } = require('../dist/test/effects/v3/readContext.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { battlePower } = require('../dist/test/effects/v3/battle.js');

const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const compare = (ref, right) => ({ type: 'compare', left: { ref }, op: 'eq', right });
const turn = { type: 'TURN_IS', player: 'SELF' };
const query = (zone = 'character', filters = always()) => ({ type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone,
  visibility: zone === 'hand' ? 'OWNER_ONLY' : 'PUBLIC', faceUpOnly: zone !== 'hand', cardTypes: ['character'], filters, excludeSource: false });
const continuous = (operation, affectedQuery = query(), condition = turn) => ({ type: 'CONTINUOUS_EFFECT', condition, affectedQuery, operation });
const set = (stat, value) => ({ type: 'SET_BASE_STAT', stat, value });
const add = (stat, amount) => ({ type: 'ADD_STAT', stat, amount });
const grant = value => ({ type: 'GRANT_COUNTER', value });
const draw = { type: 'DRAW', player: 'SELF', count: 1 };
function setup(continuousEffects, { sourceType = 'leader', printedCounter, printedPower, actions = [draw], prepare = () => {} } = {}) {
  return fixture({ count: 1, sourceType, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.35'; raw.continuousEffects = continuousEffects;
    if (printedCounter !== undefined) raw.baseStats.counter = printedCounter;
    if (printedPower !== undefined) raw.baseStats.power = printedPower;
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions });
  }, mutateBoard: prepare });
}
const board = c => c.snapshotForCoordinator().movement;
const field = (c, seat = 0) => c.viewFor(seat).publicStats.find(row => row.player === seat && row.zone === 'character');
function read(c, cards, card, viewer) {
  const s = c.snapshotForCoordinator();
  return createDerivedCardFactsReader({ board: () => s.movement, definitions: new Map(cards.map(card => [card.definition.cardId, card])),
    activePlayer: s.progression.activePlayer, statEffects: () => s.statEffects })(card, viewer);
}

test('highest eligible setters are applied before additions and preserve independent printed/base/current reads', () => {
  const effects = [continuous(set('power', 8000), query('character', compare('CANDIDATE.printed.power', 2000))),
    continuous(set('power', 6000)), continuous(set('cost', 0)), continuous(set('cost', 1)),
    continuous(add('power', 500)), continuous(add('cost', 2))];
  const filters = { type: 'all', conditions: [compare('CANDIDATE.printed.power', 2000), compare('CANDIDATE.base.power', 8000), compare('CANDIDATE.current.power', 8500)] };
  const { c, options } = setup(effects, { actions: [
    { type: 'SELECT', bindAs: 'target', selector: { ...selector('SELF'), min: 1, filters } },
    { type: 'MODIFY_STAT', cards: { ref: 'bindings.target' }, stat: 'power', amount: 1000, duration: { type: 'TURN_END', player: 'SELF', occurrence: 1 } },
  ] });
  const row = field(c), facts = read(c, options.cards, row.card, 1);
  assert.deepEqual([facts.printed.cost, facts.base.cost, facts.current.cost], [2, 1, 3]);
  assert.deepEqual([facts.printed.power, facts.base.power, facts.current.power], [2000, 8000, 8500]);
  assert.deepEqual([row.basePower, row.power, row.baseCost, row.cost], [8000, 8500, 1, 3]);
  assert.equal(field(setup([...effects].reverse()).c).power, 8500);
  const e = c.mainEffectsFor(0)[0]; c.activateMain(0, id(), c.context(), e.sourceToken, e.effectId); finish(c, 0);
  const q = c.viewFor(0).frame.choice;
  assert.equal(q.options.length, 1); assert.equal(field(c).power, 8500);
  c.answer(0, id(), c.context(), q.selectionId, [q.options[0].token]); finish(c, 0);
  const s = c.snapshotForCoordinator(), battle = { source: row.card, target: field(c, 1).card, attacker: 0, defender: 1 };
  assert.deepEqual(battlePower(s.movement, { ...s.progression, battle }, new Map(options.cards.map(card => [card.definition.cardId, card])), s.statEffects, []),
    { attack: 9500, defense: 2000 });
  c.endTurn(0, id(), c.context());
  assert.equal(field(c).power, 2000); assert.equal(field(c).cost, 2); assert.equal(field(c).basePower, undefined);
});

test('an absent counter can receive an explicit grant; zero and UNKNOWN are not absence', () => {
  const effects = [continuous(grant(1000), query('hand', compare('CANDIDATE.printed.counter', null)), always()), continuous(add('counter', 200), query('hand'), always())];
  for (const printedCounter of [null, 0]) {
    const { options } = setup(effects, { sourceType: 'character', printedCounter, prepare(b) { b.cards[b.players[1].hand[1]].cardId = 'UNKNOWN-FIXTURE'; } });
    const movement = structuredClone(options.movement); movement.turnNumber = 3;
    const c = new V3SyntheticMatchCoordinator({ ...options, movement, progression: { ...options.progression, turnNumber: 3 } });
    const hand = movement.players[1].hand, chosen = ref(movement.cards[hand[0]]);
    const facts = read(c, options.cards, chosen, 1), expected = printedCounter === null ? 1200 : 200;
    assert.equal(facts.printed.counter, printedCounter);
    assert.equal(facts.base.counter, printedCounter === null ? 1000 : 0);
    assert.equal(facts.current.counter, expected);
    assert.equal(read(c, options.cards, chosen, 0), UNKNOWN);
    assert.equal(read(c, options.cards, ref(movement.cards[hand[1]]), 1).current.counter, UNKNOWN);
    const attacker = ref(movement.cards[movement.players[0].leader[0]]), target = ref(movement.cards[movement.players[1].leader[0]]);
    c.attack(0, id(), c.context(), attacker, target); c.battleDecision(1, id(), c.context(), 'passBlock');
    const optionsForOwner = c.viewFor(1).counterChoices;
    assert.equal(optionsForOwner.find(row => row.card.instanceId === chosen.instanceId).amount, expected);
    assert(!optionsForOwner.some(row => row.card.instanceId === hand[1]));
    assert.deepEqual(c.viewFor(0).counterChoices, []);
    c.counter(1, id(), c.context(), chosen, target);
    assert.equal(c.viewFor(0).battle.powers.defense, 5000 + expected);
  }
});

test('unknown base values, uncertain setters and overlapping counter grants fail closed', () => {
  const unknownSetter = continuous(set('power', 9000), query(), compare('SOURCE.printed.cost', 0));
  const { c, options } = setup([continuous(set('power', 8000)), unknownSetter]);
  const row = field(c), facts = read(c, options.cards, row.card, 0);
  assert.equal(facts.printed.power, 2000); assert.equal(facts.base.power, UNKNOWN); assert.equal(row.power, null);
  const noPower = setup([continuous(set('power', 8000))], { sourceType: 'character', printedPower: null });
  assert.equal(read(noPower.c, noPower.options.cards, field(noPower.c).card, 0).base.power, UNKNOWN);
  const collision = setup([continuous(grant(1000), query('hand')), continuous(grant(2000), query('hand'))],
    { sourceType: 'character', printedCounter: null });
  const h = ref(board(collision.c).cards[board(collision.c).players[0].hand[0]]);
  assert.equal(read(collision.c, collision.options.cards, h, 0).current.counter, UNKNOWN);
  const addOnly = setup([continuous(add('counter', 500), query('hand'))], { sourceType: 'character', printedCounter: null });
  const noCounter = ref(board(addOnly.c).cards[board(addOnly.c).players[0].hand[0]]);
  assert.equal(read(addOnly.c, addOnly.options.cards, noCounter, 0).current.counter, null);
});
