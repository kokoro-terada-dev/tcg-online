const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, finish, selector, id, always } = require('./helpers/v3-memory.cjs');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { getCard } = require('../dist/test/movement/state.js');
const { MovementStore } = require('../dist/test/movement/engine.js');

const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const binding = name => ({ ref: `bindings.${name}` });
const zones = ['activeDon', 'restDon', 'attachedDon'];
const selectDon = (name, zone, min = 1, max = min) => ({ type: 'SELECT', bindAs: name, selector: { ...selector('SELF'), zone, cardTypes: ['don'], min, max } });
const target = (owner = 'SELF') => ({ type: 'SELECT', bindAs: 'target', selector: { ...selector(owner), min: 1 } });
const source = { type: 'BIND_SOURCE', bindAs: 'leader' };
const attach = (from = 'ACTIVE', entries = [['don', 'leader']]) => ({ type: 'ATTACH_DON', from, assignments: entries.map(([cards, target]) => ({ cards: binding(cards), target: binding(target) })) });
const returnDon = (from = zones) => ({ type: 'RETURN_DON_BY_EFFECT', cards: binding('don'), from });
function watch(effectId, cause, min = 1, owner = 'SELF') {
  return { id: effectId, kind: 'triggered', timing: { type: 'ON_EVENT', event: 'DON_RETURNED', owner, cause, min }, sourceZones: ['leader'],
    optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] };
}
function setup(actions, { actor = 0, prepare = () => {}, costs = [], watchers = [] } = {}) {
  const h = base({ actor, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.29';
    Object.assign(raw.effects[0], { actions, costs }); raw.effects.push(...watchers);
  } });
  prepare(h.options.movement, actor);
  return { ...h, c: new V3SyntheticMatchCoordinator(h.options) };
}
const board = h => h.c.snapshotForCoordinator().movement;
const events = h => h.c.snapshotForCoordinator().active.movementEvents;
const donIds = (state, actor) => [...zones, 'donDeck'].flatMap(zone => state.players[actor][zone]).sort();
function rest(b, a) { const p = b.players[a], id = p.activeDon.shift(); p.restDon.push(id); b.cards[id].rotated = true; }
function attached(b, a, to = 'leader') {
  const p = b.players[a], id = p.activeDon.shift(); p.attachedDon.push(id); b.cards[id].attachedTo = ref(b.cards[p[to][0]]);
}
function start(h) { h.c.activate(h.actor, id(), h.c.context(), h.source, 'watch-0'); }
function choose(h, indices = [0]) {
  const q = h.c.viewFor(h.actor).frame.choice;
  h.c.answer(h.actor, id(), h.c.context(), q.selectionId, indices.map(i => q.options[i].token));
}
function run(h, selections = []) {
  start(h); finish(h.c, h.actor);
  for (const indices of selections) { choose(h, indices); finish(h.c, h.actor); }
}
for (const actor of [0, 1]) for (const from of ['ACTIVE', 'REST']) test(`effect attachment preserves DON objects (${actor}/${from})`, () => {
  const zone = from === 'ACTIVE' ? 'activeDon' : 'restDon', h = setup([source, selectDon('don', zone), attach(from)], { actor, prepare: from === 'REST' ? rest : undefined });
  const before = board(h), instanceId = before.players[actor][zone][0]; run(h, [[0]]);
  const after = board(h), card = after.cards[instanceId];
  assert.deepEqual(card.attachedTo, h.source); assert.equal(card.rotated, false); assert.equal(card.generation, before.cards[instanceId].generation + 1);
  assert.equal(after.players[actor].attachedDon[0], instanceId); assert.equal(events(h).length, 1);
  assert.equal(events(h)[0].from.zone, zone); assert.equal(events(h)[0].cause.kind, 'EFFECT_MOVE');
  assert.equal(events(h)[0].cause.effectController, actor); assert.deepEqual(events(h)[0].cause.source, h.source);
  assert.deepEqual(donIds(after, actor), donIds(before, actor)); assert.equal(donIds(after, actor).length, 10);
  assert.deepEqual(after.players[1 - actor], before.players[1 - actor]);
  assert.throws(() => getCard(after, ref(before.cards[instanceId])));
});
test('two explicit assignments attach one DON each to leader and character', () => {
  const h = setup([source, target(), selectDon('first', 'activeDon'), selectDon('second', 'activeDon'), attach('ACTIVE', [['first', 'leader'], ['second', 'target']])]);
  const before = board(h); run(h, [[0], [0], [1]]);
  const after = board(h), ids = after.players[0].attachedDon;
  assert.deepEqual(ids, before.players[0].activeDon);
  assert.deepEqual(ids.map(id => after.cards[id].attachedTo), [h.source, ref(before.cards[before.players[0].character[0]])]);
  assert.equal(events(h).length, 2);
});
test('multiple DON can be attached to the same target through one assignment', () => {
  const h = setup([source, selectDon('don', 'activeDon', 2), attach()]); run(h, [[0, 1]]);
  assert.equal(board(h).players[0].attachedDon.length, 2);
  assert(board(h).players[0].attachedDon.every(id => board(h).cards[id].attachedTo.instanceId === h.source.instanceId));
});
for (const zone of zones) test(`effect return from ${zone} preserves identities and clears attachment`, () => {
  const h = setup([selectDon('don', zone), returnDon([zone])], { prepare: zone === 'restDon' ? rest : zone === 'attachedDon' ? attached : undefined });
  const before = board(h), instanceId = before.players[0][zone][0]; run(h, [[0]]);
  const after = board(h), card = after.cards[instanceId], [e] = events(h);
  assert.equal(after.players[0].donDeck.at(-1), instanceId); assert.equal(card.faceUp, false); assert.equal(card.rotated, false); assert.equal(card.attachedTo, null);
  assert.equal(card.generation, before.cards[instanceId].generation + 1); assert.throws(() => getCard(after, ref(before.cards[instanceId])));
  assert.equal(e.kind, 'moved'); assert.equal(e.cause.kind, 'EFFECT_MOVE'); assert.equal(e.from.zone, zone); assert.equal(e.to.zone, 'donDeck');
  assert.deepEqual(donIds(after, 0), donIds(before, 0));
});
test('mixed state return preserves server-selected order rather than token order', () => {
  const h = setup([selectDon('don', ['restDon', 'activeDon'], 2), returnDon()], { prepare: rest }), before = board(h);
  run(h, [[1, 0]]);
  assert.deepEqual(board(h).players[0].donDeck.slice(-2), [...before.players[0].restDon, ...before.players[0].activeDon]);
});
test('duplicate DON across assignments rejects the complete transaction', () => {
  const h = setup([source, target(), selectDon('don', 'activeDon'), attach('ACTIVE', [['don', 'leader'], ['don', 'target']])]), before = board(h);
  run(h, [[0], [0]]);
  assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(board(h), before); assert.deepEqual(events(h), []);
});
test('an opponent or hidden hand target prevents every assignment from committing', () => {
  for (const hidden of [false, true]) {
    const dest = target(hidden ? 'SELF' : 'OPPONENT');
    if (hidden) Object.assign(dest.selector, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false });
    const h = setup([source, dest, selectDon('first', 'activeDon'), selectDon('second', 'activeDon'), attach('ACTIVE', [['first', 'leader'], ['second', 'target']])]), before = board(h);
    run(h, [[0], [0], [1]]);
    assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(board(h), before); assert.deepEqual(events(h), []);
  }
});
test('wrong source state or zone is rejected without implicitly activating DON', () => {
  for (const [zone, prepare, action] of [['restDon', rest, attach()], ['attachedDon', attached, attach()], ['activeDon', undefined, returnDon(['restDon'])]]) {
    const h = setup([source, selectDon('don', zone), action], { prepare }), before = board(h); run(h, [[0]]);
    assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(board(h), before);
  }
});
test('required selection shortage does not move cards and optional zero is a no-op', () => {
  const h = setup([source, selectDon('don', 'restDon', 2), attach('REST')], { prepare: rest }), before = board(h);
  start(h); assert.throws(() => finish(h.c, 0), /insufficient-candidates/); assert.deepEqual(board(h), before);
  const empty = setup([selectDon('don', 'restDon', 0, 1), returnDon()], {}), initial = board(empty);
  run(empty); assert.equal(empty.c.viewFor(0).frame.status, 'completed'); assert.deepEqual(board(empty), initial);
});
test('a target leaving the field before attachment is not followed', () => {
  const h = setup([target(), selectDon('don', 'activeDon'), { type: 'KO', cards: binding('target') }, attach('ACTIVE', [['don', 'target']])]);
  const initial = board(h); run(h, [[0], [0]]);
  assert.equal(h.c.viewFor(0).frame.status, 'blocked');
  assert.deepEqual(board(h).players[0].activeDon, initial.players[0].activeDon);
  assert.deepEqual(events(h).map(e => e.cause.kind), ['EFFECT_KO']);
});
test('KO of the attachment target invalidates the old DON ref and is not a return-to-deck trigger', () => {
  const h = setup([target(), selectDon('don', 'attachedDon'), { type: 'KO', cards: binding('target') }, returnDon()], {
    prepare: (b, a) => attached(b, a, 'character'), watchers: [watch('observe', 'ANY')]
  }); const initial = board(h); run(h, [[0], [0]]);
  assert.equal(h.c.viewFor(0).frame.status, 'blocked');
  assert.deepEqual(board(h).players[0].donDeck, initial.players[0].donDeck);
  assert.equal(board(h).players[0].restDon[0], initial.players[0].attachedDon[0]);
  assert.equal(events(h)[1].cause.kind, 'RULE_PROCESSING');
  assert.deepEqual(h.c.snapshotForCoordinator().triggerObservations.records, []);
});
test('ordinary attach does not accept rested DON or the effect-only source override', () => {
  const h = setup([source, selectDon('don', 'restDon'), attach('REST')], { prepare: rest });
  const state = board(h), card = ref(state.cards[state.players[0].restDon[0]]);
  const tx = { transactionId: 'ordinary', matchId: state.matchId, expectedRevision: state.revision, turnNumber: state.turnNumber, actor: 0,
    effectController: null, source: null, mode: 'rule', resolutionId: null, operations: [{ kind: 'attachDon', card, target: h.source }] };
  for (const operation of [tx.operations[0], { ...tx.operations[0], from: 'restDon' }]) {
    assert.throws(() => new MovementStore(state).commit({ ...tx, operations: [operation] }, { status: 'certifiedNone' }));
  }
});
test('return-batch observer distinguishes cost from effect and counts once per batch', () => {
  const h = setup([selectDon('don', 'activeDon', 2), returnDon()], {
    prepare: rest, costs: [{ type: 'DON_RETURN', count: 1, from: ['restDon'] }],
    watchers: [watch('cost', 'COST_PAYMENT'), watch('effect', 'EFFECT_MOVE', 2), watch('either', 'ANY'), watch('below', 'EFFECT_MOVE', 3), watch('opponent-watch', 'EFFECT_MOVE', 1, 'OPPONENT')]
  });
  // Extra active DON gives two distinct effect-return targets after the cost.
  const b = h.options.movement, extra = b.players[0].donDeck.shift();
  b.players[0].activeDon.push(extra); b.cards[extra].faceUp = true;
  h.c = new V3SyntheticMatchCoordinator(h.options);
  run(h, [[0], [0, 1]]);
  assert.deepEqual(events(h).map(e => e.cause.kind), ['COST_PAYMENT', 'EFFECT_MOVE', 'EFFECT_MOVE']);
  const records = h.c.snapshotForCoordinator().triggerObservations.records;
  assert.deepEqual(records.map(r => [r.effectId, r.returnedCount, r.context.cause.kind, r.context.effectController]), [
    ['cost', 1, 'COST_PAYMENT', 0], ['either', 1, 'COST_PAYMENT', 0], ['effect', 2, 'EFFECT_MOVE', 0], ['either', 2, 'EFFECT_MOVE', 0], ['opponent-watch', 2, 'EFFECT_MOVE', 1]
  ]);
  let count = 0;
  while (h.c.viewFor(0).triggerChoices.length && count < 6) {
    const q = h.c.viewFor(0).triggerChoices[0]; h.c.resolveTrigger(0, id(), h.c.context(), q.token); finish(h.c, 0); count++;
  }
  assert.equal(count, 4); assert.equal(h.c.viewFor(0).triggerChoices.length, 0);
  const opponent = h.c.viewFor(1).triggerChoices[0]; assert.equal(opponent.effectId, 'opponent-watch');
  h.c.resolveTrigger(1, id(), h.c.context(), opponent.token); finish(h.c, 1);
  assert.deepEqual(h.c.viewFor(1).triggerChoices, []);
});
for (const operation of ['attach', 'return']) test(`${operation} rejects forged replies, stale requests and replay cannot duplicate events`, () => {
  const h = setup([source, selectDon('don', 'activeDon', 0, 2), operation === 'attach' ? attach() : returnDon()], { watchers: [watch('observe', 'ANY')] });
  start(h); finish(h.c, 0);
  const q = h.c.viewFor(0).frame.choice, context = h.c.context(), token = q.options[0].token;
  assert.deepEqual(h.c.viewFor(1).frame.choice.options, []);
  assert.throws(() => h.c.answer(1, id(), context, q.selectionId, [token]));
  assert.throws(() => h.c.answer(0, id(), context, q.selectionId, ['fake']));
  assert.throws(() => h.c.answer(0, id(), context, q.selectionId, [token, token]));
  choose(h); assert.throws(() => h.c.answer(0, id(), context, q.selectionId, [token]));
  h.c.advance(0, id(), h.c.context());
  const atWork = h.c.context(), request = id(); h.c.applyPendingWork(0, request, atWork);
  const snapshot = h.c.snapshotForCoordinator();
  assert.equal(h.c.applyPendingWork(0, request, atWork).replayed, true); assert.deepEqual(h.c.snapshotForCoordinator(), snapshot);
  assert.equal(events(h).length, 1); assert.equal(snapshot.triggerObservations.records.length, operation === 'return' ? 1 : 0);
  if (operation === 'return') {
    const token = snapshot.pendingTriggers[0].token;
    assert.throws(() => h.c.resolveTrigger(0, id(), h.c.context(), token));
    finish(h.c, 0); h.c.resolveTrigger(0, id(), h.c.context(), token); finish(h.c, 0);
  }
  const otherView = h.c.viewFor(1);
  assert(!JSON.stringify(otherView).includes('returnedCount'));
  assert(otherView.movement.players[0].hand.every(card => card.cardId === null && card.ref === null));
});
test('Compiler rejects wrong mode, source, target size, invalid observer and older profile', () => {
  const h = setup([source, selectDon('don', 'activeDon'), attach(), returnDon()], { watchers: [watch('observe', 'ANY')] });
  for (const mutate of [
    raw => { raw.schemaVersion = '3.0.0-subset.28'; },
    raw => { raw.effects[0].actions[1].selector.max = 11; },
    raw => { raw.effects[0].actions[2].from = 'ATTACHED'; },
    raw => { raw.effects[0].actions[2].assignments = []; },
    raw => { raw.effects[0].actions[1].selector.max = 2; raw.effects[0].actions[2].assignments[0].target = binding('don'); },
    raw => { raw.effects[0].actions[3].from = ['donDeck']; },
    raw => { raw.effects[0].actions[3].cause = 'COST_PAYMENT'; },
    raw => { raw.effects[1].timing.cause = 'RULE_PROCESSING'; },
    raw => { raw.effects[1].timing.min = 0; }
  ]) { const invalid = structuredClone(h.raw); mutate(invalid); assert.throws(() => compileV3CardJson(JSON.stringify(invalid))); }
});
