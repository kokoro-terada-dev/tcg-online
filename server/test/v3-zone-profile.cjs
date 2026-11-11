const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, finish, id, always } = require('./helpers/v3-observed.cjs');
const { setup: eventSetup } = require('./helpers/v3-event.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { readSourceAttachmentCount } = require('../dist/test/effects/v3/fixtureEnvironment.js');
const { UNKNOWN } = require('../dist/test/effects/v3/readContext.js');
const { enqueueAttackTriggers } = require('../dist/test/effects/v3/triggerScheduler.js');
const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const select = (from = 'hand') => ({ type: 'SELECT', bindAs: 'target', selector: {
  type: 'CARDS', owner: 'SELF', controller: 'SELF', chooser: 'SELF', zone: from, cardTypes: ['character'],
  filters: always(), excludeSource: false, faceUpOnly: from !== 'hand', min: 0, max: 1,
  visibility: from === 'hand' ? 'OWNER_ONLY' : 'PUBLIC', selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail'
} });
const play = from => [select(from), { type: 'PLAY_BY_EFFECT', cards: { ref: 'bindings.target' }, from,
  destination: { owner: 'SELF', zone: 'character', slotPolicy: 'REPLACE_IF_FULL' }, enterState: 'REST', provenance: 'EFFECT', condition: always() }];
function fixture(actions, opts = {}) {
  return setup({ count: 1, ...opts, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.50';
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions });
    if (opts.withOnPlay) raw.effects.push({ ...structuredClone(raw.effects[0]), id: 'entry', kind: 'triggered',
      timing: { type: 'ON_PLAY' }, actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] });
  } });
}
const state = c => c.snapshotForCoordinator().movement;
function activate(h) {
  const choice = h.c.mainEffectsFor(0).find(row => row.effectId === 'watch-0');
  h.c.activateMain(0, id(), h.c.context(), choice.sourceToken, choice.effectId);
}
function answer(c, index = 0, replay = false) {
  const q = c.viewFor(0).frame.choice, context = c.context(), request = id(), tokens = q.options[index] ? [q.options[index].token] : [];
  c.answer(0, request, context, q.selectionId, tokens);
  if (replay) assert.equal(c.answer(0, request, context, q.selectionId, tokens).replayed, true);
}
test('source attachment read separates instances and rejects stale generations', () => {
  const h = fixture([{ type: 'DRAW', player: 'SELF', count: 1 }]);
  const b = structuredClone(h.options.movement), p = b.players[0], source = ref(b.cards[p.leader[0]]), other = ref(b.cards[p.character[0]]);
  for (const target of [source, source, other]) {
    const don = p.donDeck.shift(); Object.assign(b.cards[don], { faceUp: true, attachedTo: target }); p.attachedDon.push(don);
  }
  assert.equal(readSourceAttachmentCount(b, source, 0), 2);
  assert.equal(readSourceAttachmentCount(b, other, 0), 1);
  assert.equal(readSourceAttachmentCount(b, { ...source, generation: source.generation + 1 }, 0), UNKNOWN);
  b.cards[p.attachedDon[0]].attachedTo = { ...source, generation: source.generation + 1 };
  assert.equal(readSourceAttachmentCount(b, source, 0), UNKNOWN);
});
test('deck-to-trash does not reveal a peek and moves exactly one top batch', () => {
  const h = fixture([{ type: 'TRASH_DECK_TOP', count: 3 }]); activate(h);
  const before = state(h.c), expected = before.players[0].deck.slice(0, 3);
  h.c.advance(0, id(), h.c.context());
  assert.deepEqual(state(h.c), before);
  assert.ok(h.c.viewFor(1).movement.players[0].deck.every(card => card.cardId === null));
  h.c.applyPendingWork(0, id(), h.c.context()); finish(h.c, 0);
  assert.deepEqual(state(h.c).players[0].trash.slice(-3), expected);
  assert.equal(state(h.c).players[0].deck.length, before.players[0].deck.length - 3);
  assert.throws(() => h.c.applyPendingWork(0, id(), h.c.context()));
});
for (const from of ['hand', 'trash']) for (const field of [1, 5]) test('effect play ' + from + '/' + field, () => {
  const h = fixture(play(from), { field, mutateBoard(b) {
    if (from === 'trash') { const card = b.players[0].hand.shift(); b.cards[card].faceUp = true; b.players[0].trash.push(card); }
  } });
  activate(h); const before = state(h.c); finish(h.c, 0);
  const q = h.c.viewFor(0).frame.choice;
  assert.ok(q.options.length);
  assert.deepEqual(h.c.viewFor(1).frame.choice.options, []);
  assert.throws(() => h.c.answer(1, id(), h.c.context(), q.selectionId, [q.options[0].token]));
  assert.throws(() => h.c.answer(0, id(), h.c.context(), q.selectionId, ['forged']));
  assert.deepEqual(state(h.c), before);
  h.c.answer(0, id(), h.c.context(), q.selectionId, [q.options[0].token]); finish(h.c, 0);
  let discarded;
  if (field === 5) {
    const slot = h.c.viewFor(0).frame.choice;
    assert.equal(slot.options.length, 5);
    assert.equal(state(h.c).players[0].character.filter(Boolean).length, 5);
    discarded = state(h.c).players[0].character[0];
    answer(h.c, 0, true); finish(h.c, 0);
  }
  const after = state(h.c);
  assert.equal(after.players[0].character.filter(Boolean).length, field === 5 ? 5 : field + 1);
  assert.ok(after.players[0].character.some(card => !before.players[0].character.includes(card) && after.cards[card].rotated));
  if (discarded) assert.ok(after.players[0].trash.includes(discarded));
});
test('zero selection and stale revision cannot discard a full field', () => {
  const h = fixture(play('hand'), { field: 5 }); activate(h); finish(h.c, 0);
  const before = state(h.c), q = h.c.viewFor(0).frame.choice;
  assert.throws(() => h.c.answer(0, id(), { ...h.c.context(), frameRevision: -1 }, q.selectionId, [q.options[0].token]));
  h.c.answer(0, id(), h.c.context(), q.selectionId, []); finish(h.c, 0);
  assert.deepEqual(state(h.c), before);
});
test('new declarations are rejected under the old profile', () => {
  const h = fixture([{ type: 'TRASH_DECK_TOP', count: 1 }]);
  const d = structuredClone(h.raw); d.schemaVersion = '3.0.0-subset.49';
  assert.throws(() => compileV3CardJson(JSON.stringify(d)));
  d.effects[0].actions = [{ type: 'IF', condition: { type: 'compare', left: { ref: 'SOURCE.attachedDonCount' }, op: 'gte', right: 1 },
    then: [{ type: 'DRAW', player: 'SELF', count: 1 }], else: [] }];
  assert.throws(() => compileV3CardJson(JSON.stringify(d)));
});
test('event MAIN search hides all private candidates and remainder', () => {
  const actions = [
    { type: 'LOOK_TOP', player: 'SELF', count: 3, bindAs: 'seen', onInsufficient: 'takeAvailable' },
    { type: 'ORDER_CARDS', cards: { ref: 'bindings.seen' }, excludeCards: null, bindAs: 'ordered', chooser: 'SELF' },
    { type: 'RETURN_TO_DECK', cards: { ref: 'bindings.ordered' }, player: 'SELF', position: 'bottom' }
  ];
  const h = eventSetup({ cost: 0, mutate(d) { d.schemaVersion = '3.0.0-subset.50'; d.effects[0].actions = actions; } });
  const choice = h.c.mainEventChoicesFor(0)[0]; assert.ok(choice.enabled);
  h.c.useMainEvent(0, id(), h.c.context(), choice.sourceToken, choice.effectId); finish(h.c, 0);
  const q = h.c.viewFor(0).frame.choice;
  assert.equal(q.options.length, 3);
  assert.deepEqual(h.c.viewFor(1).frame.choice.options, []);
  assert.ok(h.c.viewFor(1).movement.players[0].deck.every(card => card.cardId === null));
  h.c.answer(0, id(), h.c.context(), q.selectionId, [...q.options].reverse().map(row => row.token)); finish(h.c, 0);
  assert.ok(h.c.viewFor(1).movement.players[0].deck.every(card => card.cardId === null));
});
test('effect entry feeds the existing ON_PLAY queue after a full-slot replacement', () => {
  const h = fixture(play('hand'), { sourceType: 'character', field: 5, withOnPlay: true });
  activate(h); finish(h.c, 0); answer(h.c); finish(h.c, 0); answer(h.c); finish(h.c, 0);
  assert.ok(h.c.viewFor(0).triggerChoices.some(choice => choice.effectId === 'entry'));
});
test('attack attachment requirement is captured at occurrence and excludes another instance', () => {
  const h = setup({ count: 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.50';
    Object.assign(raw.effects[0], { kind: 'triggered', timing: { type: 'ON_ATTACK' },
      activationConditions: { type: 'compare', left: { ref: 'SOURCE.attachedDonCount' }, op: 'gte', right: 1 },
      actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] });
  } });
  const b = structuredClone(h.options.movement), source = ref(b.cards[b.players[0].leader[0]]);
  const progression = { ...h.options.progression, battle: { step: 'attack', attacker: 0, defender: 1, source, battleId: 'attachment-battle' } };
  const definitions = new Map(h.options.cards.map(card => [card.definition.cardId, card]));
  assert.equal(enqueueAttackTriggers(b, progression, definitions).length, 0);
  const p = b.players[0], don = p.donDeck.shift();
  Object.assign(b.cards[don], { faceUp: true, attachedTo: source }); p.attachedDon.push(don);
  const queue = enqueueAttackTriggers(b, progression, definitions);
  assert.equal(queue.length, 1); assert.equal(queue[0].cause.attachmentQualified, true);
  b.cards[don].attachedTo = ref(b.cards[p.character[0]]);
  assert.equal(enqueueAttackTriggers(b, progression, definitions).length, 0);
});
test('attached DON quantity resolves against the current source without borrowing another card count', () => {
  const h = fixture([{ type: 'TRASH_DECK_TOP', count: { ref: 'SOURCE.attachedDonCount' } }], { mutateBoard(b) {
    const p = b.players[0], leader = ref(b.cards[p.leader[0]]);
    for (let i = 0; i < 2; i++) {
      const don = p.donDeck.shift(); Object.assign(b.cards[don], { faceUp: true, attachedTo: leader }); p.attachedDon.push(don);
    }
  } });
  activate(h); const before = state(h.c).players[0].deck.length; finish(h.c, 0);
  assert.equal(state(h.c).players[0].deck.length, before - 2);
});
test('rejected full-slot play cannot publish its staged rule discard', () => {
  const h = fixture(play('hand'), { field: 5, mutateBoard(b) {
    for (const instance of b.players[0].hand) b.cards[instance].cardId = 'UNAPPROVED-TARGET';
  } });
  activate(h); finish(h.c, 0);
  const before = state(h.c); answer(h.c); finish(h.c, 0);
  assert.equal(h.c.viewFor(0).frame.status, 'blocked');
  assert.deepEqual(state(h.c), before);
});
test('continuous identity and attachment count do not grant a same-name copy the source bonus', () => {
  const h = setup({ sourceType: 'character', field: 2, count: 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.50';
    raw.continuousEffects = [{ type: 'CONTINUOUS_EFFECT',
      condition: { type: 'compare', left: { ref: 'SOURCE.attachedDonCount' }, op: 'gte', right: 1 },
      affectedQuery: { type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', cardTypes: ['character'],
        visibility: 'PUBLIC', faceUpOnly: true, excludeSource: false, filters: { type: 'IS_SOURCE' } },
      operation: { type: 'ADD_STAT', stat: 'power', amount: 1000 } }];
  }, mutateBoard(b) {
    const p = b.players[0], don = p.donDeck.shift();
    Object.assign(b.cards[don], { faceUp: true, attachedTo: ref(b.cards[p.character[0]]) }); p.attachedDon.push(don);
  } });
  const stats = h.c.viewFor(0).publicStats.filter(row => row.player === 0 && row.zone === 'character');
  assert.deepEqual(stats.map(row => row.powerDelta), [1000, 0]);
});
