const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, play, finish, id, selector } = require('./helpers/v3-observed.cjs');
const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const snapshot = c => c.snapshotForCoordinator().movement;
const cards = { ref: 'bindings.chosen' };
const pick = fields => ({ type: 'SELECT', bindAs: 'chosen', selector: { ...selector(), excludeSource: false, ...fields } });
function run(actions, mutateBoard) {
  const { c, options } = setup({ count: 1, field: 2, mutateBoard, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.49';
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions });
  } });
  c.activate(0, id(), c.context(), ref(options.movement.cards[options.movement.players[0].leader[0]]), 'watch-0');
  return c;
}

test('a public cross-zone selection has one shared cap and does not expose its tokens across seats', () => {
  const c = run([pick({ owner: 'SELF', controller: 'SELF', zone: ['leader', 'character'], cardTypes: ['leader', 'character'], max: 2 }),
    { type: 'REST', cards }]);
  const before = snapshot(c), choice = finish(c, 0).choice;
  assert.deepEqual(choice.options.map(o => o.zone), ['leader', 'character', 'character']);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.throws(() => c.answer(0, id(), c.context(), choice.selectionId, choice.options.map(o => o.token)));
  assert.throws(() => c.answer(0, id(), c.context(), choice.selectionId, ['forged']));
  c.answer(0, id(), c.context(), choice.selectionId, choice.options.slice(0, 2).map(o => o.token));
  assert.deepEqual(snapshot(c), before);
  finish(c, 0);
  const after = snapshot(c), p = after.players[0];
  assert.equal(after.cards[p.leader[0]].rotated, true);
  assert.equal(after.cards[p.character[0]].rotated, true);
  assert.equal(after.cards[p.character[1]].rotated, false);
});

test('the other player chooses a controlled Character, but the destination follows its actual owner', () => {
  const move = { type: 'MOVE_CARD', cards, destination: { owner: 'CARD_OWNER', zone: 'deck', position: 'bottom', faceUp: false }, cause: 'EFFECT' };
  for (const empty of [false, true]) {
    const c = run([pick({ owner: 'EITHER', controller: 'OPPONENT', chooser: 'OPPONENT', min: 1, onInsufficient: 'skip' }), move], board => {
      if (empty) {
        for (const [i, id] of board.players[1].character.entries()) if (id) {
          board.players[1].character[i] = null;
          board.players[1].deck.push(id);
          Object.assign(board.cards[id], { faceUp: false, enteredTurn: null });
        }
      } else board.cards[board.players[1].character[0]].owner = 0;
    });
    const before = snapshot(c);
    if (empty) {
      assert.equal(finish(c, 0), undefined);
      assert.deepEqual(snapshot(c), before);
      continue;
    }
    finish(c, 0);
    const choice = c.viewFor(1).frame.choice, chosen = before.players[1].character[0];
    assert.equal(choice.options.length, 2);
    assert.deepEqual(c.viewFor(0).frame.choice.options, []);
    assert.throws(() => c.answer(0, id(), c.context(), choice.selectionId, [choice.options[0].token]));
    c.answer(1, id(), c.context(), choice.selectionId, [choice.options[0].token]);
    finish(c, 0);
    assert.equal(snapshot(c).players[0].deck.at(-1), chosen);
    assert.equal(snapshot(c).cards[chosen].faceUp, false);
  }
});

test('two independent triggers on the same object enter the queue only at their own timings', () => {
  const { c } = setup({ count: 2, sourceType: 'character', field: 0, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.49';
    raw.effects[0].timing = { type: 'ON_PLAY' };
    raw.effects[1].timing = { type: 'ON_ATTACK' };
  } });
  const source = play(c);
  const runTrigger = effectId => {
    const [choice, ...other] = c.viewFor(0).triggerChoices;
    assert.equal(choice.effectId, effectId);
    assert.deepEqual(other, []);
    const count = snapshot(c).players[0].hand.length;
    c.resolveTrigger(0, id(), c.context(), choice.token);
    finish(c, 0);
    assert.equal(snapshot(c).players[0].hand.length, count + 1);
  };
  runTrigger('watch-0');
  c.endTurn(0, id(), c.context());
  c.endTurn(1, id(), c.context());
  const board = snapshot(c);
  c.attack(0, id(), c.context(), ref(board.cards[source.instanceId]), ref(board.cards[board.players[1].leader[0]]));
  runTrigger('watch-1');
});
