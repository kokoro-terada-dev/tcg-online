const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: eventFixture, always } = require('./helpers/v3-event.cjs');
const { setup: boardFixture, finish, selector, id } = require('./helpers/v3-observed.cjs');

const draw = count => ({ type: 'DRAW', player: 'SELF', count });
const rest = { type: 'REST_DON', count: 1 };
const reveal = filters => ({ type: 'REVEAL_CARDS', selector: {
  ...selector('SELF'), zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, excludeSource: false, min: 1, max: 1, filters,
} });
const offer = (...costs) => ({ type: 'OFFER_PAYMENT', bindAs: 'extra', costs });
const branch = (then, otherwise) => ({ type: 'IF_PAYMENT_SUCCEEDED', payment: 'extra', then, else: otherwise });
const choice = c => c.viewFor(0).frame.choice;
const board = c => c.snapshotForCoordinator().movement;
const answer = (c, i) => c.answer(0, id(), c.context(), choice(c).selectionId, [choice(c).options[i].token]);
function setup(actions, { costs = [], prepare = () => {} } = {}) {
  const { c } = boardFixture({ count: 1, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.31';
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, costs, actions, usageLimit: { type: 'PER_TURN', scope: 'SOURCE_OBJECT', count: 1 } });
  }, mutateBoard: prepare });
  const main = c.mainEffectsFor(0)[0];
  c.activateMain(0, id(), c.context(), main.sourceToken, main.effectId);
  return c;
}

test('interactive MAIN event resolves exactly one signed mode and continues after it', () => {
  const { c } = eventFixture({ cost: 1, mutate(d) {
    d.schemaVersion = '3.0.0-subset.31';
    d.effects[0].actions = [{ type: 'CHOOSE_MODE', modes: [
      { label: 'Draw three', actions: [draw(3)] },
      { label: 'Pay to draw one', actions: [offer(rest), branch([draw(1)], [])] },
    ] }, draw(1)];
  } });
  const entry = c.mainEventChoicesFor(0)[0], initial = board(c);
  c.useMainEvent(0, id(), c.context(), entry.sourceToken, entry.effectId);
  const before = board(c), q = choice(c), context = c.context(), request = id(), token = q.options[1].token;
  assert.equal(before.players[0].trash.at(-1), entry.source.instanceId);
  assert.equal(before.players[0].activeDon.length, initial.players[0].activeDon.length - 1);
  assert.equal(q.purpose, 'mode'); assert.deepEqual(q.options.map(o => o.label), ['Draw three', 'Pay to draw one']);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.throws(() => c.answer(1, id(), context, q.selectionId, [token]));
  assert.throws(() => c.answer(0, id(), context, q.selectionId, q.options.map(o => o.token)));
  assert.throws(() => c.answer(0, id(), context, q.selectionId, ['fabricated']));
  assert.throws(() => c.answer(0, id(), { ...context, frameRevision: context.frameRevision - 1 }, q.selectionId, [token]));
  assert.deepEqual(board(c), before);
  c.answer(0, request, context, q.selectionId, [token]);
  assert.equal(c.answer(0, request, context, q.selectionId, [token]).replayed, true);
  finish(c, 0);
  assert.equal(choice(c).purpose, 'payment');
  assert.deepEqual(board(c), before);
  answer(c, 0); finish(c, 0);
  assert.equal(board(c).players[0].hand.length, before.players[0].hand.length + 2);
  assert.equal(board(c).players[0].activeDon.length, 0);
});

test('optional compound payment is private until commit, survives replay and is not refunded by an empty later action', () => {
  const c = setup([draw(1), offer(rest, reveal(always())), branch([
    { type: 'SELECT', bindAs: 'target', selector: selector('OPPONENT') },
    { type: 'REST', cards: { ref: 'bindings.target' } },
  ], [draw(3)]), draw(1)], { costs: [rest] });
  const initial = board(c);
  finish(c, 0);
  const before = board(c);
  assert.equal(choice(c).purpose, 'payment'); assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.equal(before.players[0].hand.length, initial.players[0].hand.length + 1);
  assert.equal(before.players[0].activeDon.length, 1);
  answer(c, 0); finish(c, 0);
  assert.equal(choice(c).revealCost, true);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []); assert.deepEqual(c.viewFor(1).publicReveals, []);
  answer(c, 0); c.advance(0, id(), c.context());
  assert.deepEqual(board(c), before);
  const context = c.context(), request = id();
  c.applyPendingWork(0, request, context);
  assert.equal(c.applyPendingWork(0, request, context).replayed, true);
  const paid = board(c);
  assert.equal(paid.revision, before.revision + 1);
  assert.equal(paid.players[0].activeDon.length, 0);
  assert.deepEqual(paid.players[0].hand, before.players[0].hand);
  assert.equal(c.viewFor(1).publicReveals.length, 1);
  finish(c, 0);
  assert.equal(choice(c).purpose, 'action');
  c.answer(0, id(), c.context(), choice(c).selectionId, []);
  finish(c, 0);
  assert.equal(board(c).players[0].activeDon.length, 0);
  assert.equal(board(c).players[0].hand.length, initial.players[0].hand.length + 2);
  assert.deepEqual(c.viewFor(1).publicReveals, []);
  assert.equal(c.viewFor(0).frame.activationDecision, null);
  assert.equal(c.snapshotForCoordinator().usage[0][1], 1);
});

test('declined or unaffordable optional payment follows only the unpaid branch and preserves prior work', () => {
  for (const enough of [true, false]) {
    const c = setup([draw(1), offer({ type: 'REST_DON', count: 2 }, reveal(always())),
      branch([draw(4)], [draw(1)]), draw(1)], { costs: enough ? [] : [rest] });
    const before = board(c);
    finish(c, 0);
    if (enough) { assert.equal(choice(c).purpose, 'payment'); answer(c, 1); finish(c, 0); }
    assert.equal(c.viewFor(0).frame.status, 'completed');
    assert.equal(c.viewFor(0).frame.activationCommitted, true);
    assert.equal(c.viewFor(0).frame.activationDecision, null);
    assert.equal(board(c).players[0].activeDon.length, enough ? 2 : 1);
    assert.equal(board(c).players[0].hand.length, before.players[0].hand.length + 3);
    assert.deepEqual(c.viewFor(1).publicReveals, []);
  }
});

test('UNKNOWN eligibility neither pays nor follows the unpaid branch', () => {
  const c = setup([draw(1), offer(rest, reveal({ type: 'CARD_NAME', subject: 'CANDIDATE', basis: 'PRINTED', op: 'eq', value: 'Target' })),
    branch([draw(2)], [draw(3)])], { prepare(b) { b.cards[b.players[0].hand[0]].cardId = 'UNCLASSIFIED-FIXTURE'; } });
  c.advance(0, id(), c.context());
  c.applyPendingWork(0, id(), c.context());
  const afterDraw = board(c);
  assert.throws(() => c.advance(0, id(), c.context()), /v3-cost-feasibility-unknown/);
  assert.deepEqual(board(c), afterDraw);
  assert.equal(c.viewFor(0).frame.status, 'ready');
  assert.deepEqual(c.viewFor(1).publicReveals, []);
});
