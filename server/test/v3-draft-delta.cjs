const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, finish, id, always } = require('./helpers/v3-observed.cjs');
const { setup: eventSetup } = require('./helpers/v3-event.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');

const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const binding = key => ({ ref: 'bindings.' + key });
const draw = { type: 'DRAW', player: 'SELF', count: 1 };
const look = { type: 'LOOK_TOP', player: 'SELF', count: 3, bindAs: 'seen', onInsufficient: 'takeAvailable' };
const play = { type: 'PLAY_BY_EFFECT', cards: binding('target'), from: 'deck', condition: always(),
  destination: { owner: 'SELF', zone: 'character', slotPolicy: 'REPLACE_IF_FULL' }, enterState: 'REST', provenance: 'EFFECT' };
const pick = { type: 'SELECT', bindAs: 'target', selector: { type: 'BOUND_CARDS', cards: binding('seen'), excludeCards: null,
  owner: 'SELF', controller: 'SELF', chooser: 'SELF', zone: 'deck', cardTypes: ['character'], filters: always(),
  visibility: 'OWNER_ONLY', faceUpOnly: false, excludeSource: false, min: 0, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' } };
const snapshot = c => c.snapshotForCoordinator().movement;
const answer = (c, actor, options) => c.answer(actor, id(), c.context(), c.viewFor(actor).frame.choice.selectionId, options);

function main(actions, field = 1) {
  const h = setup({ count: 1, field, mutateBoard(board) {
    Object.assign(board.cards[board.players[0].deck[0]], { cardId: 'TARGET', kind: 'character' });
  }, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.51';
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions });
  } });
  const choice = h.c.mainEffectsFor(0)[0];
  h.c.activateMain(0, id(), h.c.context(), choice.sourceToken, choice.effectId);
  return h;
}

for (const field of [1, 5]) test('inspected deck play preserves the private remainder, field=' + field, () => {
  const { c } = main([look, pick, play,
    { type: 'ORDER_CARDS', cards: binding('seen'), excludeCards: binding('target'), bindAs: 'ordered', chooser: 'SELF' },
    { type: 'RETURN_TO_DECK', cards: binding('ordered'), player: 'SELF', position: 'bottom' }], field);
  const before = snapshot(c), [first, second, third] = before.players[0].deck;
  const { choice } = finish(c, 0);
  assert.equal(choice.options.length, 1);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.throws(() => answer(c, 1, [choice.options[0].token]));
  answer(c, 0, [choice.options[0].token]);
  let next = finish(c, 0).choice;
  if (field === 5) {
    assert.equal(next.options.length, 5);
    assert.deepEqual(c.viewFor(1).movement.players[0].deck.slice(1).map(row => row.cardId), before.players[0].deck.slice(1).map(() => null));
    answer(c, 0, [next.options[0].token]);
    next = finish(c, 0).choice;
  }
  assert.equal(next.options.length, 2);
  answer(c, 0, [...next.options].reverse().map(row => row.token)); finish(c, 0);
  const after = snapshot(c);
  assert.ok(after.players[0].character.includes(first));
  assert.equal(after.cards[first].generation, before.cards[first].generation + 1);
  assert.ok(after.cards[first].rotated);
  assert.deepEqual(after.players[0].deck.slice(-2), [third, second]);
  assert.ok(c.viewFor(1).movement.players[0].deck.every(row => row.cardId === null));
});

test('shuffle revokes inspection grants without exposing the resulting order', () => {
  const { c } = main([look, { type: 'SHUFFLE_DECK' }]);
  const before = snapshot(c);
  c.advance(0, id(), c.context()); c.applyPendingWork(0, id(), c.context());
  assert.ok(snapshot(c).reveals.length >= 3);
  c.advance(0, id(), c.context());
  const request = id(), at = c.context();
  c.applyPendingWork(0, request, at);
  assert.ok(c.applyPendingWork(0, request, at).replayed);
  finish(c, 0);
  const after = snapshot(c);
  assert.deepEqual([...after.players[0].deck].sort(), [...before.players[0].deck].sort());
  assert.equal(after.reveals.length, 0);
  for (const seat of [0, 1]) assert.ok(c.viewFor(seat).movement.players[0].deck.every(row => row.cardId === null));
});

test('only the unselected inspected cards go to trash without another choice', () => {
  const { c } = main([look, pick, play, { type: 'MOVE_CARD', cards: binding('seen'), excludeCards: binding('target'),
    destination: { owner: 'SELF', zone: 'trash', position: 'append', faceUp: true }, cause: 'EFFECT' }]);
  const [selected, ...rest] = snapshot(c).players[0].deck.slice(0, 3);
  const q = finish(c, 0).choice;
  answer(c, 0, [q.options[0].token]); finish(c, 0);
  assert.ok(snapshot(c).players[0].character.includes(selected));
  assert.deepEqual(snapshot(c).players[0].trash.slice(-2), rest);
});

test('a shuffled deck invalidates an earlier play selection', () => {
  const { c } = main([look, pick, { type: 'SHUFFLE_DECK' }, play]);
  const before = snapshot(c), q = finish(c, 0).choice;
  answer(c, 0, [q.options[0].token]);
  assert.equal(finish(c, 0).status, 'blocked');
  assert.deepEqual(snapshot(c).players[0].character, before.players[0].character);
  assert.equal(snapshot(c).players[0].deck.length, before.players[0].deck.length);
});

test('new event MAIN mode remains available through the coordinator', () => {
  const { c } = eventSetup({ mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.51';
    raw.effects[0].actions = [{ type: 'CHOOSE_MODE', modes: [
      { label: 'Shuffle', actions: [{ type: 'SHUFFLE_DECK' }] }, { label: 'Draw', actions: [draw] }
    ] }];
  } });
  const row = c.mainEventChoicesFor(0)[0], before = snapshot(c);
  assert.ok(row.enabled);
  c.useMainEvent(0, id(), c.context(), row.sourceToken, row.effectId);
  const q = finish(c, 0).choice;
  answer(c, 0, [q.options.find(option => option.label === 'Draw').token]); finish(c, 0);
  assert.equal(snapshot(c).players[0].deck.length, before.players[0].deck.length - 1);
});

test('stable continuous source modifier reads the current DON field count', () => {
  const { c } = setup({ count: 1, sourceType: 'character', field: 2, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.51';
    raw.effects = [];
    raw.continuousEffects = [{ type: 'CONTINUOUS_EFFECT',
      condition: { type: 'compare', left: { ref: 'SELF.don.fieldCount' }, op: 'gte', right: 2 },
      affectedQuery: { type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', cardTypes: ['character'],
        visibility: 'PUBLIC', faceUpOnly: true, excludeSource: false, filters: { type: 'IS_SOURCE' } },
      operation: { type: 'ADD_STAT', stat: 'power', amount: 1000 } }];
  } });
  const rows = c.viewFor(0).publicStats.filter(row => row.zone === 'character');
  assert.deepEqual(rows.map(row => row.powerDelta), [1000, 1000, 1000, 1000]);
});

function battle(mutate) {
  const { options, d } = eventSetup({ actor: 0, field: 1, mutate });
  let progression = options.progression;
  while (progression.turnNumber !== 3 || progression.phase !== 'main' || !progression.phaseSettled) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    else if (progression.phase === 'main') progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain');
    else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  const movement = { ...structuredClone(options.movement), turnNumber: 3 };
  if (d.cardType === 'character') for (const object of Object.values(movement.cards)) {
    if (object.cardId === d.cardId) object.kind = 'character';
  }
  const c = new V3SyntheticMatchCoordinator({ ...options, movement, progression });
  c.attack(0, id(), c.context(), ref(movement.cards[movement.players[0].leader[0]]), ref(movement.cards[movement.players[1].leader[0]]));
  c.battleDecision(1, id(), c.context(), 'passBlock');
  return c;
}

test('a life trigger runs the source-free COUNTER body without paying its printed cost', () => {
  const c = battle(raw => {
    raw.schemaVersion = '3.0.0-subset.51';
    const body = raw.effects[0];
    body.timing = { type: 'COUNTER' };
    raw.source.triggerText = 'Synthetic same-card COUNTER call.';
    raw.effects.push({ ...body, id: 'life', timing: { type: 'TRIGGER' }, kind: 'triggered', sourceZones: ['life'],
      actions: [{ type: 'CALL_EFFECT_BODY', effectId: body.id }] });
    const cyclic = structuredClone(raw);
    cyclic.effects[1].actions[0].effectId = 'life';
    assert.throws(() => compileV3CardJson(JSON.stringify(cyclic)));
  });
  c.battleDecision(1, id(), c.context(), 'endCounter');
  c.resolveDamage(1, id(), c.context());
  const before = snapshot(c), q = c.viewFor(1).lifeChoice;
  c.useLifeTrigger(1, id(), c.context(), q.selectionId, q.token); finish(c, 1);
  const after = snapshot(c);
  assert.deepEqual(after.players[1].activeDon, before.players[1].activeDon);
  assert.equal(after.players[1].deck.length, before.players[1].deck.length - 1);
  assert.equal(after.players[1].resolving.length, 0);
});

for (const timing of ['ON_PLAY', 'ON_KO']) test('life trigger calls character ' + timing + ' without entering or being KOed', () => {
  const c = battle(raw => {
    raw.schemaVersion = '3.0.0-subset.51';
    raw.cardType = 'character'; raw.baseStats.power = 2000;
    raw.source.triggerText = 'Synthetic same-card character body call.';
    const body = raw.effects[0];
    Object.assign(body, { kind: 'triggered', sourceZones: ['character'], timing: { type: timing } });
    raw.effects.push({ ...body, id: 'life', timing: { type: 'TRIGGER' }, sourceZones: ['life'],
      actions: [{ type: 'CALL_EFFECT_BODY', effectId: body.id }] });
  });
  c.battleDecision(1, id(), c.context(), 'endCounter');
  c.resolveDamage(1, id(), c.context());
  const before = snapshot(c), q = c.viewFor(1).lifeChoice;
  c.useLifeTrigger(1, id(), c.context(), q.selectionId, q.token); finish(c, 1);
  const after = snapshot(c);
  assert.deepEqual(after.players[1].character, before.players[1].character);
  assert.equal(after.players[1].deck.length, before.players[1].deck.length - 1);
  assert.equal(after.players[1].trash.length, before.players[1].trash.length + 1);
});

for (const pay of [false, true]) test('COUNTER optional hand payment, accept=' + pay, () => {
  const c = battle(raw => {
    raw.schemaVersion = '3.0.0-subset.51';
    Object.assign(raw.effects[0], { timing: { type: 'COUNTER' }, actions: [
      { type: 'OFFER_PAYMENT', bindAs: 'paid', costs: [{ type: 'DISCARD_HAND', count: 1 }] },
      { type: 'IF_PAYMENT_SUCCEEDED', payment: 'paid', then: [draw], else: [] }
    ] });
  });
  const before = snapshot(c);
  const row = c.viewFor(1).counterEventChoices[0];
  c.useCounterEvent(1, id(), c.context(), row.card, row.effectId);
  const { choice } = finish(c, 1);
  assert.equal(snapshot(c).players[1].trash.length, before.players[1].trash.length + 1);
  answer(c, 1, [choice.options[pay ? 0 : 1].token]);
  if (pay) {
    const q = finish(c, 1).choice;
    assert.equal(q.options.length, before.players[1].hand.length - 1);
    assert.deepEqual(c.viewFor(0).frame.choice.options, []);
    answer(c, 1, [q.options[0].token]);
  }
  finish(c, 1);
  assert.equal(snapshot(c).players[1].deck.length, before.players[1].deck.length - Number(pay));
  assert.equal(snapshot(c).players[1].trash.length, before.players[1].trash.length + 1 + Number(pay));
});
