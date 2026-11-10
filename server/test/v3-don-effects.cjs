const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, finish, selector, id, always } = require('./helpers/v3-memory.cjs');
const { setup: boardFixture, play, select } = require('./helpers/v3-observed.cjs');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { getCard } = require('../dist/test/movement/state.js');
const { movementReadContext } = require('../dist/test/effects/v3/readContext.js');

const add = (count = 1, state = 'ACTIVE') => ({ type: 'ADD_DON', player: 'SELF', count, state, onInsufficient: 'fail' });
const addUpTo = (max, state = 'ACTIVE') => ({ type: 'ADD_DON_UP_TO', player: 'SELF', max, state });
const set = (from = 'REST', to = 'ACTIVE') => ({ type: 'SET_DON_STATE', cards: { ref: 'bindings.don' }, from, to });
const choose = (zone = 'restDon', min = 1, max = min) => ({ type: 'SELECT', bindAs: 'don',
  selector: { ...selector('SELF'), zone, min, max, cardTypes: ['don'], excludeSource: false } });
function setup(actions, { actor = 0, costs = [], prepare = () => {}, effects = [], schema = '3.0.0-subset.28' } = {}) {
  const h = base({ actor, mutate: raw => {
    raw.schemaVersion = schema;
    Object.assign(raw.effects[0], { actions, costs });
    raw.effects.push(...effects);
  } });
  prepare(h.options.movement, actor);
  return { ...h, c: new V3SyntheticMatchCoordinator(h.options) };
}
const board = h => h.c.snapshotForCoordinator().movement;
const events = h => h.c.snapshotForCoordinator().active.movementEvents;
const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const donIds = (state, actor) => ['donDeck', 'activeDon', 'restDon', 'attachedDon'].flatMap(zone => state.players[actor][zone]).sort();
function rest(state, actor, count = 2) {
  const p = state.players[actor], ids = p.activeDon.splice(0, count);
  for (const id of ids) state.cards[id].rotated = true;
  p.restDon.push(...ids);
}
function attach(state, actor) {
  const p = state.players[actor], id = p.activeDon.shift();
  state.cards[id].attachedTo = ref(state.cards[p.leader[0]]);
  p.attachedDon.push(id);
}
function activate(h) { h.c.activate(h.actor, id(), h.c.context(), h.source, 'watch-0'); }
function accept(h, count = 1) {
  const q = h.c.viewFor(h.actor).frame.choice;
  h.c.answer(h.actor, id(), h.c.context(), q.selectionId, q.options.slice(0, count).map(row => row.token));
}
function run(h, count = 1) {
  activate(h); finish(h.c, h.actor);
  if (h.c.viewFor(h.actor).frame.choice) { accept(h, count); finish(h.c, h.actor); }
}
for (const actor of [0, 1]) for (const state of ['ACTIVE', 'REST']) test(`ADD_DON moves existing deck objects only (${actor}/${state})`, () => {
  const h = setup([add(2, state)], { actor, prepare: attach }), before = board(h), ids = before.players[actor].donDeck.slice(0, 2);
  run(h);
  const after = board(h), zone = state === 'ACTIVE' ? 'activeDon' : 'restDon';
  assert.deepEqual(after.players[actor][zone].slice(-2), ids);
  assert.deepEqual(after.players[actor].donDeck, before.players[actor].donDeck.slice(2));
  assert.equal(donIds(after, actor).length, 10);
  assert.deepEqual(donIds(after, actor), donIds(before, actor));
  assert.deepEqual(after.players[actor].attachedDon, before.players[actor].attachedDon);
  assert.deepEqual(after.players[1 - actor], before.players[1 - actor]);
  for (const instanceId of ids) {
    assert.equal(after.cards[instanceId].faceUp, true);
    assert.equal(after.cards[instanceId].rotated, state === 'REST');
    assert.equal(after.cards[instanceId].generation, before.cards[instanceId].generation + 1);
    assert.throws(() => getCard(after, ref(before.cards[instanceId])));
  }
  assert.equal(events(h).length, 2);
  for (const e of events(h)) {
    assert.equal(e.kind, 'moved'); assert.equal(e.cause.kind, 'EFFECT_MOVE'); assert.equal(e.cause.effectController, actor);
    assert.deepEqual(e.cause.source, h.source); assert.equal(e.from.zone, 'donDeck'); assert.equal(e.to.zone, zone);
    assert.equal(movementReadContext(e).targetAfter.generation, e.after.generation);
  }
});
for (const from of ['ACTIVE', 'REST']) test(`SET_DON_STATE ${from} changes state without creating a new object`, () => {
  const to = from === 'ACTIVE' ? 'REST' : 'ACTIVE', fromZone = from === 'ACTIVE' ? 'activeDon' : 'restDon', toZone = to === 'ACTIVE' ? 'activeDon' : 'restDon';
  const h = setup([choose(fromZone, 2), set(from, to)], { prepare: from === 'REST' ? rest : undefined }), before = board(h);
  run(h, 2);
  assert.deepEqual(board(h).players[0][toZone].slice(-2), before.players[0][fromZone]);
  assert.deepEqual(donIds(board(h), 0), donIds(before, 0));
  for (const e of events(h)) {
    assert.equal(e.kind, 'restChanged'); assert.equal(e.cause.kind, 'EFFECT_MOVE'); assert.equal(e.before.generation, e.after.generation);
    assert.equal(e.from.zone, fromZone); assert.equal(e.to.zone, toZone);
  }
});
test('ADD_DON accepts the exact remaining count; rejects shortages and an empty deck atomically', () => {
  for (const [actions, expected] of [[[add(8)], 'completed'], [[add(9)], 'blocked'], [[add(8), add(1)], 'blocked']]) {
    const h = setup(actions), before = board(h); run(h);
    assert.equal(h.c.viewFor(0).frame.status, expected);
    assert.equal(board(h).players[0].donDeck.length, actions[0].count === 8 ? 0 : 8);
    assert.equal(events(h).length, actions[0].count === 8 ? 8 : 0);
    assert.deepEqual(donIds(board(h), 0), donIds(before, 0));
    if (actions[0].count === 9) assert.deepEqual(board(h), before);
  }
});
test('ADD_DON supports all ten cards with no added objects', () => {
  const h = setup([add(10)], { prepare(state, actor) {
    const p = state.players[actor];
    for (const id of p.activeDon) state.cards[id].faceUp = false;
    p.donDeck.push(...p.activeDon.splice(0));
  } });
  run(h); assert.equal(board(h).players[0].activeDon.length, 10); assert.equal(board(h).players[0].donDeck.length, 0);
});

test('optional DON supports zero, middle and maximum with the fixed ADD_DON movement and no false entry trigger', () => {
  const observer = { id: 'watch-entry', kind: 'triggered', timing: { type: 'ON_EVENT', event: 'CARD_ENTERED',
    snapshot: 'TRANSACTION_AFTER', relation: 'OTHER', owner: 'SELF', controller: 'SELF', fromZones: ['hand'], toZones: ['character'],
    cardTypes: ['character'], filters: always() }, sourceZones: ['leader'], optional: false, usageLimit: null, activationConditions: always(),
    resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] };
  for (const [count, state, actor] of [[0, 'ACTIVE', 0], [2, 'REST', 1], [4, 'ACTIVE', 0]]) {
    const h = setup([addUpTo(4, state)], { schema: '3.0.0-subset.46', actor, effects: [observer] }), before = board(h);
    activate(h); finish(h.c, actor);
    const q = h.c.viewFor(actor).frame.choice, at = h.c.context();
    assert.deepEqual(q.options.map(o => o.label), Array.from({ length: 5 }, (_, i) => `DON!!を${i}枚追加`));
    assert.ok(q.options.every(o => !Object.hasOwn(o, 'cardId')));
    assert.deepEqual(h.c.viewFor(1 - actor).frame.choice.options, []);
    assert.deepEqual(board(h), before);
    const token = q.options[count].token;
    const request = id();
    h.c.answer(actor, request, at, q.selectionId, [token]);
    assert.equal(h.c.answer(actor, request, at, q.selectionId, [token]).replayed, true);
    assert.deepEqual(board(h), before);
    finish(h.c, actor);
    const after = board(h), zone = state === 'ACTIVE' ? 'activeDon' : 'restDon', ids = before.players[actor].donDeck.slice(0, count);
    assert.deepEqual(after.players[actor][zone], [...before.players[actor][zone], ...ids]);
    assert.deepEqual(after.players[actor].donDeck, before.players[actor].donDeck.slice(count));
    assert.equal(after.revision, before.revision + Number(count > 0));
    assert.deepEqual(after.players[1 - actor], before.players[1 - actor]);
    assert.deepEqual(events(h).map(e => [e.kind, e.cause.kind, e.cause.effectController, e.from.zone, e.to.zone, e.after.rotated]),
      Array.from({ length: count }, () => ['moved', 'EFFECT_MOVE', actor, 'donDeck', zone, state === 'REST']));
    assert.equal(h.c.viewFor(actor).pendingTriggerCount, 0);
  }
});

test('optional DON caps the prompt at the remaining deck, rejects stale or excessive answers, and continues on an empty deck', () => {
  const h = setup([add(7), addUpTo(4), addUpTo(4), { type: 'DRAW', player: 'SELF', count: 1 }], { schema: '3.0.0-subset.46' });
  activate(h); finish(h.c, 0);
  const q = h.c.viewFor(0).frame.choice, at = h.c.context(), before = board(h);
  assert.deepEqual(q.options.map(o => o.label), ['DON!!を0枚追加', 'DON!!を1枚追加']);
  const tokens = q.options.map(o => o.token);
  assert.throws(() => h.c.answer(0, id(), at, q.selectionId, tokens));
  assert.throws(() => h.c.answer(0, id(), at, q.selectionId, ['over-the-cap']));
  assert.throws(() => h.c.answer(1, id(), at, q.selectionId, [tokens[1]]));
  assert.throws(() => h.c.answer(0, id(), { ...at, movementRevision: at.movementRevision - 1 }, q.selectionId, [tokens[1]]));
  assert.throws(() => h.c.endTurn(0, id(), at));
  assert.deepEqual(board(h), before);
  h.c.answer(0, id(), at, q.selectionId, [tokens[1]]);
  assert.throws(() => h.c.answer(0, id(), h.c.context(), q.selectionId, [tokens[1]]));
  finish(h.c, 0);
  assert.equal(h.c.viewFor(0).frame.status, 'completed');
  assert.equal(board(h).players[0].donDeck.length, 0);
  assert.equal(board(h).players[0].hand.length, before.players[0].hand.length + 1);
  assert.equal(events(h).filter(e => e.from.zone === 'donDeck').length, 8);
});

test('ON_PLAY resumes through the normal trigger queue after choosing the optional DON count', () => {
  const { c } = boardFixture({ sourceType: 'character', count: 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.46';
    Object.assign(raw.effects[0], { timing: { type: 'ON_PLAY' }, actions: [addUpTo(2, 'REST'), { type: 'DRAW', player: 'SELF', count: 1 }] });
  } });
  play(c); select(c, 'watch-0', 0);
  const before = board({ c }), { choice } = finish(c, 0);
  assert.deepEqual(board({ c }), before);
  const [one] = choice.options.filter(option => option.label === 'DON!!を1枚追加');
  c.answer(0, id(), c.context(), choice.selectionId, [one.token]);
  finish(c, 0);
  assert.equal(board({ c }).players[0].restDon.length, before.players[0].restDon.length + 1);
  assert.equal(board({ c }).players[0].hand.length, before.players[0].hand.length + 1);
  assert.deepEqual(events({ c }).map(e => [e.from.zone, e.to.zone]), [['donDeck', 'restDon'], ['deck', 'hand']]);
  assert.equal(c.viewFor(0).pendingTriggerCount, 0);
});
test('up to two REST DON uses the existing zero-selection path', () => {
  const h = setup([choose('restDon', 0, 2), set()]), before = board(h);
  run(h, 0); assert.equal(h.c.viewFor(0).frame.status, 'completed');
  assert.deepEqual(board(h), before); assert.deepEqual(events(h), []);
});
test('up to two can choose the only rested DON without touching attached DON', () => {
  const h = setup([choose('restDon', 0, 2), set()], { prepare(b, a) { attach(b, a); rest(b, a, 1); } });
  const before = board(h); activate(h); finish(h.c, 0);
  assert.equal(h.c.viewFor(0).frame.choice.options.length, 1);
  accept(h); finish(h.c, 0);
  assert.deepEqual(board(h).players[0].activeDon, before.players[0].restDon);
  assert.deepEqual(board(h).players[0].attachedDon, before.players[0].attachedDon);
});
test('a state mismatch in a batch rejects the entire change', () => {
  const h = setup([choose(['restDon', 'activeDon'], 2), set()], { prepare: (b, a) => rest(b, a, 1) }), before = board(h);
  run(h, 2); assert.equal(h.c.viewFor(0).frame.status, 'blocked');
  assert.deepEqual(board(h), before); assert.deepEqual(events(h), []);
});
test('attached DON and other card kinds cannot be changed with SET_DON_STATE', () => {
  const h = setup([choose('attachedDon'), set('ACTIVE', 'REST')], { prepare: attach }), before = board(h);
  run(h); assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(board(h), before);
  const other = setup([{ type: 'BIND_SOURCE', bindAs: 'don' }, set('ACTIVE', 'REST')]), initial = board(other);
  run(other); assert.equal(other.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(board(other), initial);
});
test('a later work may not reuse a selection from the wrong current state', () => {
  const h = setup([choose('activeDon'), set('ACTIVE', 'REST'), set('ACTIVE', 'REST')]); run(h);
  assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.equal(events(h).length, 1); assert.equal(board(h).players[0].restDon.length, 1);
});
test('cost events remain distinct from effect state changes and adds', () => {
  const h = setup([choose(), set(), add(1, 'REST')], { costs: [{ type: 'REST_DON', count: 1 }] });
  run(h);
  assert.deepEqual(events(h).map(e => [e.kind, e.cause.kind]), [['restChanged', 'COST_PAYMENT'], ['restChanged', 'EFFECT_MOVE'], ['moved', 'EFFECT_MOVE']]);
  assert.equal(board(h).players[0].activeDon.length, 2); assert.equal(board(h).players[0].restDon.length, 1);
});
test('selection rejects forged, cross-seat, duplicate and stale replies', () => {
  const h = setup([choose('activeDon', 0, 2), set('ACTIVE', 'REST')]); activate(h); finish(h.c, 0);
  const q = h.c.viewFor(0).frame.choice, context = h.c.context(), token = q.options[0].token;
  assert.deepEqual(h.c.viewFor(1).frame.choice.options, []);
  assert.throws(() => h.c.answer(0, id(), context, q.selectionId, ['forged']));
  assert.throws(() => h.c.answer(1, id(), context, q.selectionId, [token]));
  assert.throws(() => h.c.answer(0, id(), context, q.selectionId, [token, token]));
  const request = id(); h.c.answer(0, request, context, q.selectionId, [token]);
  assert.equal(h.c.answer(0, request, context, q.selectionId, [token]).replayed, true);
  assert.throws(() => h.c.answer(0, id(), context, q.selectionId, [token]));
  finish(h.c, 0); assert.equal(events(h).length, 1);
});
for (const action of ['ADD_DON', 'SET_DON_STATE']) test(`work replay does not repeat ${action}`, () => {
  const h = setup(action === 'ADD_DON' ? [add()] : [choose('activeDon'), set('ACTIVE', 'REST')]);
  activate(h); h.c.advance(0, id(), h.c.context());
  if (h.c.viewFor(0).frame.choice) { accept(h); h.c.advance(0, id(), h.c.context()); }
  const context = h.c.context(), request = id(); h.c.applyPendingWork(0, request, context);
  const after = h.c.snapshotForCoordinator();
  assert.equal(h.c.applyPendingWork(0, request, context).replayed, true);
  assert.throws(() => h.c.applyPendingWork(0, id(), context)); assert.deepEqual(h.c.snapshotForCoordinator(), after);
});
test('DON events do not enqueue character-entry observers', () => {
  const h = setup([add(1, 'REST'), choose(), set()], { effects: [{
    id: 'watch-entry', kind: 'triggered', timing: { type: 'ON_EVENT', event: 'CARD_ENTERED',
      snapshot: 'TRANSACTION_AFTER', relation: 'OTHER', owner: 'SELF', controller: 'SELF', fromZones: ['hand'], toZones: ['character'], cardTypes: ['character'], filters: always() },
    sourceZones: ['leader'], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }]
  }] }); run(h);
  assert.equal(events(h).length, 2); assert.deepEqual(h.c.viewFor(0).triggerChoices, []);
  assert.deepEqual(h.c.snapshotForCoordinator().triggerObservations.records, []);
});
test('an existing TURN_END trigger can resolve ADD_DON through the common queue', () => {
  const h = setup([add()], { effects: [{
    id: 'end-add', kind: 'triggered', timing: { type: 'TURN_END', player: 'SELF' }, sourceZones: ['leader'],
    optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions: [add()]
  }] });
  h.c.endTurn(0, id(), h.c.context());
  const trigger = h.c.viewFor(0).triggerChoices.find(row => row.effectId === 'end-add'); assert(trigger);
  h.c.resolveTrigger(0, id(), h.c.context(), trigger.token); finish(h.c, 0);
  assert.equal(board(h).players[0].activeDon.length, 3);
  assert.equal(events(h)[0].cause.kind, 'EFFECT_MOVE');
  assert.deepEqual(h.c.viewFor(0).triggerChoices, []);
});
test('Compiler rejects unsupported operations, destinations, insufficient policies and legacy profile access', () => {
  const h = setup([choose(), set(), add()]);
  for (const mutate of [
    raw => { raw.schemaVersion = '3.0.0-subset.27'; },
    raw => { raw.effects[0].actions[0].selector.owner = 'OPPONENT'; },
    raw => { raw.effects[0].actions[0].selector.max = 11; },
    raw => { raw.effects[0].actions[1].to = 'REST'; },
    raw => { raw.effects[0].actions[1].from = 'ATTACHED'; },
    raw => { raw.effects[0].actions[2].count = 0; },
    raw => { raw.effects[0].actions[2].count = 11; },
    raw => { raw.effects[0].actions[2].player = 'OPPONENT'; },
    raw => { raw.effects[0].actions[2].onInsufficient = 'takeAvailable'; },
    raw => { raw.effects[0].actions[2].type = 'RETURN_DON_BY_EFFECT'; }
  ]) { const invalid = structuredClone(h.raw); mutate(invalid); assert.throws(() => compileV3CardJson(JSON.stringify(invalid))); }
});
