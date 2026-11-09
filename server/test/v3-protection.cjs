const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: fixture, finish, selector, id, always } = require('./helpers/v3-observed.cjs');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { protectionReader } = require('../dist/test/effects/v3/protectionRules.js');

const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const field = (b, p, slot = 0) => ref(b.cards[b.players[p].character[slot]]);
const compare = (ref, right) => ({ type: 'compare', left: { ref }, op: 'eq', right });
const query = filters => ({ type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', visibility: 'PUBLIC', faceUpOnly: true,
  cardTypes: ['character'], excludeSource: false, filters });
const protect = (policy, extra = {}, filters = always(), condition = always()) => ({ type: 'CONTINUOUS_EFFECT',
  affectedQuery: query(filters), condition, operation: { type: 'RESTRICT', policy, by: 'OPPONENT', ...extra } });
const select = (name, { chooser = 'SELF', min = 1, max = min } = {}) => ({ type: 'SELECT', bindAs: name, selector: { ...selector('OPPONENT', chooser), min, max } });
const action = (type, binding, extra = {}) => ({ type, cards: { ref: 'bindings.' + binding }, ...extra });
const draw = { type: 'DRAW', player: 'SELF', count: 1 };
const rotated = compare('CANDIDATE.rotated', true);
const board = c => c.snapshotForCoordinator().movement;
const logs = c => c.snapshotForCoordinator().active.movementEvents;
const stats = (c, card) => c.viewFor(0).publicStats.find(row => row.card.instanceId === card.instanceId);
function setup(continuousEffects, actions, { count = 2, attributes = [], prepare = () => {}, sourceType = 'leader', costs = [] } = {}) {
  return fixture({ count: 1, field: count, sourceType, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.36'; raw.continuousEffects = continuousEffects; raw.attributes = attributes;
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions, costs });
  }, mutateBoard: prepare });
}
function start(c) { const e = c.mainEffectsFor(0)[0]; c.activateMain(0, id(), c.context(), e.sourceToken, e.effectId); return finish(c, 0); }
function answer(c, actor, indices) {
  const q = c.viewFor(actor).frame.choice;
  c.answer(actor, id(), c.context(), q.selectionId, indices.map(i => q.options[i].token));
}
function apply(c) { c.advance(0, id(), c.context()); c.applyPendingWork(0, id(), c.context()); }

test('target legality uses the effect controller, then a later state change protects only one selected card from KO', () => {
  const { c, options } = setup([protect('CANNOT_TARGET', {}, rotated),
    protect('CANNOT_KO', { cause: 'EFFECT' }, rotated, { type: 'TURN_IS', player: 'OPPONENT' })], [
    select('original', { chooser: 'OPPONENT', min: 2 }), select('rested'), action('REST', 'rested'), action('KO', 'original'), draw,
  ], { count: 3, prepare(b) { b.cards[b.players[1].character[2]].rotated = true; } });
  const initial = board(c), [willRest, willKO, excluded] = initial.players[1].character;
  start(c);
  assert.deepEqual(c.viewFor(0).frame.choice.options, []);
  assert.equal(c.viewFor(1).frame.choice.options.length, 2);
  answer(c, 1, [0, 1]); finish(c, 0);
  answer(c, 0, [0]); finish(c, 0);
  const after = board(c);
  assert.equal(after.cards[willRest].rotated, true);
  assert.deepEqual(after.players[1].character.slice(0, 3), [willRest, null, excluded]);
  assert.deepEqual(logs(c).filter(e => e.isKO).map(e => e.before.instanceId), [willKO]);
  assert.equal(after.players[0].hand.length, initial.players[0].hand.length + 1);
  const definitions = new Map(options.cards.map(card => [card.definition.cardId, card]));
  const saved = field(after, 1);
  assert.equal(protectionReader(after, definitions, 0)(saved, 0, 'CANNOT_KO', 'EFFECT'), true);
  c.endTurn(0, id(), c.context());
  assert.equal(protectionReader(board(c), definitions, 1)(saved, 0, 'CANNOT_KO', 'EFFECT'), false);
});

test('immunity prevents state changes and modifiers, while move-only protection still permits modifiers', () => {
  for (const policy of ['UNAFFECTED_BY', 'PREVENT_MOVE']) {
    const immune = policy === 'UNAFFECTED_BY', duration = { type: 'TURN_END', player: 'SELF', occurrence: 1 };
    const opposingAura = { type: 'CONTINUOUS_EFFECT', condition: always(), affectedQuery: { ...query(always()), owner: 'OPPONENT', controller: 'OPPONENT' },
      operation: { type: 'ADD_STAT', stat: 'power', amount: -100 } };
    const { c } = setup([protect(policy, {}, rotated), opposingAura], [select('targets', { min: 2 }),
      ...(immune ? [action('SET_ACTIVE', 'targets')] : []),
      action('MODIFY_STAT', 'targets', { stat: 'power', amount: -1000, duration }),
      action('GRANT_KEYWORD', 'targets', { keyword: { type: 'BLOCKER' }, duration }),
      action('MOVE_CARD', 'targets', { destination: { owner: 'OPPONENT', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' }),
      { type: 'MOVE_RESULT', bindAs: 'moved' }, draw,
    ], { prepare(b) { b.cards[b.players[1].character[0]].rotated = true; } });
    const initial = board(c), protectedCard = field(initial, 1), freeCard = field(initial, 1, 1);
    start(c); assert.equal(c.viewFor(0).frame.choice.options.length, 2);
    answer(c, 0, [0, 1]);
    if (immune) { apply(c); assert.equal(board(c).cards[protectedCard.instanceId].rotated, true); }
    apply(c); apply(c);
    assert.equal(stats(c, protectedCard).power, immune ? 2000 : 900);
    assert.equal(stats(c, protectedCard).keywords.includes('BLOCKER'), !immune);
    assert.equal(stats(c, freeCard).power, 900);
    apply(c);
    const frame = JSON.parse(JSON.parse(c.snapshotForCoordinator().active.frame).payload);
    assert.deepEqual(frame.lastMoveResult.prevented, [protectedCard]);
    assert.deepEqual(frame.lastMoveResult.rows.map(r => r.event.before.instanceId), [freeCard.instanceId]);
    finish(c, 0);
    assert.equal(board(c).players[1].character[0], protectedCard.instanceId);
    assert(board(c).players[1].hand.includes(freeCard.instanceId));
    assert(logs(c).every(event => !event.isKO));
  }
});

test('battle KO checks the attack attribute and does not reuse effect KO immunity', () => {
  for (const [cause, attribute, saved] of [['BATTLE', 'Slash', true], ['BATTLE', 'Strike', false], ['EFFECT', 'Slash', false]]) {
    const { options } = setup([protect('CANNOT_KO', { cause, ...(cause === 'BATTLE' ? { sourceAttribute: 'Slash' } : {}) })], [draw],
      { attributes: [attribute], prepare(b) { b.cards[b.players[1].character[0]].rotated = true; } });
    const movement = structuredClone(options.movement); movement.turnNumber = 3;
    const c = new V3SyntheticMatchCoordinator({ ...options, movement, progression: { ...options.progression, turnNumber: 3 } });
    const source = ref(movement.cards[movement.players[0].leader[0]]), target = field(movement, 1);
    c.attack(0, id(), c.context(), source, target); c.battleDecision(1, id(), c.context(), 'passBlock');
    c.battleDecision(1, id(), c.context(), 'endCounter'); c.resolveDamage(1, id(), c.context());
    assert.equal(board(c).players[1].character[0] === target.instanceId, saved);
    assert.equal(c.snapshotForCoordinator().ruleEvents.some(e => e.isKO), !saved);
    assert.equal(c.viewFor(0).battle, null);
  }
});

test('effect protection does not pay or prevent costs; an unknown KO decision commits nothing', () => {
  const paid = setup([protect('PREVENT_MOVE', { by: 'ANY' })], [draw], {
    sourceType: 'character', costs: [{ type: 'MOVE_AS_COST', selector: 'SOURCE', destination: 'trash' }],
  }).c;
  const source = field(board(paid), 0); start(paid);
  assert(board(paid).players[0].trash.includes(source.instanceId));
  assert.equal(logs(paid)[0].cause.kind, 'COST_PAYMENT');
  const { c } = setup([protect('CANNOT_KO', { cause: 'EFFECT' }, always(), compare('SOURCE.printed.cost', 0))],
    [select('target'), action('KO', 'target')]);
  const initial = board(c); start(c); answer(c, 0, [0]); finish(c, 0);
  assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(board(c), initial); assert.deepEqual(logs(c), []);
});
