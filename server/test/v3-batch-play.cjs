const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, finish, id, always } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');

const snapshot = c => c.snapshotForCoordinator().movement;
const draw = { type: 'DRAW', player: 'SELF', count: 1 };
const source = { ref: 'bindings.entry' };
function start(field) {
  const h = setup({ sourceType: 'character', field, count: 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.53';
    const original = raw.effects[0];
    raw.effects = [
      { ...original, kind: 'activated', timing: { type: 'MAIN' }, actions: [
        { type: 'SELECT', bindAs: 'entry', selector: {
          type: 'CARDS', owner: 'SELF', controller: 'SELF', chooser: 'SELF', zone: 'hand', cardTypes: ['character'],
          visibility: 'OWNER_ONLY', faceUpOnly: false, excludeSource: false, min: 0, max: 2, selectionMode: 'SELECT',
          order: 'UNORDERED', onInsufficient: 'fail', filters: always()
        } },
        { type: 'PLAY_BY_EFFECT', cards: source, from: 'hand', destination: { owner: 'SELF', zone: 'character', slotPolicy: 'REPLACE_IF_FULL' },
          enterState: 'ACTIVE', provenance: 'EFFECT', condition: always() },
        draw
      ] },
      { ...original, id: 'on-play', timing: { type: 'ON_PLAY' }, actions: [draw] },
      { ...original, id: 'observed-entry', timing: { ...original.timing, relation: 'SELF' }, actions: [draw] }
    ];
  } });
  const row = h.c.mainEffectsFor(0)[0];
  h.c.activateMain(0, id(), h.c.context(), row.sourceToken, row.effectId);
  return h;
}

for (const field of [3, 4, 5]) test('batch play with ' + field + ' occupied slots', () => {
  const { c } = start(field), initial = snapshot(c), hand = initial.players[0].hand.slice(0, 2);
  const original = initial.players[0].character.filter(Boolean);
  const pick = finish(c, 0).choice;
  assert.equal(pick.max, 2);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  c.answer(0, id(), c.context(), pick.selectionId, pick.options.slice(0, 2).map(option => option.token));

  let replaced = [];
  if (field > 3) {
    const { choice } = finish(c, 0);
    assert.equal(choice.min, field - 3);
    assert.equal(choice.max, field - 3);
    assert.equal(choice.options.length, original.length);
    assert.deepEqual(snapshot(c).players[0].character.filter(Boolean), original);
    assert.ok(hand.every(card => snapshot(c).players[0].hand.includes(card)));
    assert.equal(c.viewFor(0).triggerChoices.length, 0);
    const tokens = choice.options.slice(0, choice.min).map(option => option.token);
    assert.throws(() => c.answer(0, id(), c.context(), choice.selectionId, [hand[0], ...tokens.slice(1)]));
    replaced = original.slice(0, choice.min);
    c.answer(0, id(), c.context(), choice.selectionId, tokens);
  }
  finish(c, 0);
  const after = snapshot(c);
  assert.ok(hand.every(card => after.players[0].character.includes(card) && !after.players[0].trash.includes(card)));
  assert.deepEqual(after.players[0].trash, replaced);
  assert.equal(after.players[0].deck.length, initial.players[0].deck.length - 1);
  assert.equal(c.viewFor(0).triggerChoices.filter(row => row.effectId === 'on-play').length, 2);
  assert.equal(c.viewFor(0).triggerChoices.filter(row => row.effectId === 'observed-entry').length, 2);
});

test('zero selections skip the slot choice; older profiles reject the larger binding', () => {
  const h = start(5), before = snapshot(h.c), { choice } = finish(h.c, 0);
  h.c.answer(0, id(), h.c.context(), choice.selectionId, []);
  finish(h.c, 0);
  assert.deepEqual(snapshot(h.c).players[0].character, before.players[0].character);
  assert.deepEqual(snapshot(h.c).players[0].trash, before.players[0].trash);
  const old = structuredClone(h.raw);
  old.schemaVersion = '3.0.0-subset.52';
  assert.throws(() => compileV3CardJson(JSON.stringify(old)), /v3-unsupported-effect-play/);
});

test('choosing one card from a larger binding uses the single-card replacement path', () => {
  const { c } = start(5), before = snapshot(c), pick = finish(c, 0).choice;
  c.answer(0, id(), c.context(), pick.selectionId, [pick.options[0].token]);
  const slot = finish(c, 0).choice;
  assert.deepEqual([slot.min, slot.max], [1, 1]);
  c.answer(0, id(), c.context(), slot.selectionId, [slot.options[0].token]);
  finish(c, 0);
  assert.deepEqual(snapshot(c).players[0].trash, [before.players[0].character[0]]);
  assert.ok(snapshot(c).players[0].character.includes(before.players[0].hand[0]));
  assert.equal(c.viewFor(0).triggerChoices.filter(row => row.effectId === 'on-play').length, 1);
});
