const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: fixture, finish, selector, id, always } = require('./helpers/v3-observed.cjs');

const board = c => c.snapshotForCoordinator().movement;
const events = c => c.snapshotForCoordinator().active.movementEvents;
const saved = c => JSON.parse(JSON.parse(c.snapshotForCoordinator().active.frame).payload);
const bind = { ref: 'bindings.target' };
const makeRule = (match = {}, to = 'hand', condition = always()) => ({ type: 'REPLACE_EVENT', id: 'instead',
  match: { cause: 'EFFECT_KO', by: 'OPPONENT', from: 'character', to: 'trash', ...match }, condition, substitute: { to } });
const returnToHand = { type: 'MOVE_CARD', cards: bind, destination: { owner: 'OPPONENT', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' };
function setup({ rules = [makeRule()], action = { type: 'KO', cards: bind }, count = 1, continuousEffects, unknownPower = false } = {}) {
  return fixture({ count: 2, sourceType: 'character', field: count, mutate(raw) {
    raw.schemaVersion = '3.0.0-subset.37'; raw.replacementEffects = rules;
    if (unknownPower) raw.baseStats.power = null;
    if (continuousEffects) raw.continuousEffects = continuousEffects;
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions: [
      { type: 'SELECT', bindAs: 'target', selector: { ...selector(), min: count, max: count } }, action,
      ...(action.type === 'MOVE_CARD' ? [{ type: 'MOVE_RESULT', bindAs: 'originalMove' }] : []),
      { type: 'DRAW', player: 'SELF', count: 1 }
    ] });
    raw.effects[1].timing = { type: 'ON_KO' };
  } });
}
function start(c, count = 1) {
  const main = c.mainEffectsFor(0)[0];
  c.activateMain(0, id(), c.context(), main.sourceToken, main.effectId);
  finish(c, 0);
  const target = c.viewFor(0).frame.choice;
  c.answer(0, id(), c.context(), target.selectionId, target.options.slice(0, count).map(option => option.token));
  c.advance(0, id(), c.context());
}

test('KO replacement suspends a signed intent; only its chooser can accept; no KO or duplicate move is emitted', () => {
  const { c } = setup();
  start(c);
  const before = board(c), target = before.players[1].character[0], request = id(), context = c.context();
  assert.equal(c.applyPendingWork(0, request, context).replayed, false);
  assert.equal(c.applyPendingWork(0, request, context).replayed, true);
  assert.deepEqual(board(c), before);
  assert.deepEqual(events(c), []);
  const plan = saved(c).replacement.plan;
  assert.equal(plan.intent.worldRevision, before.revision);
  assert.equal(plan.intent.operation.card.instanceId, target);
  assert.equal(plan.intent.cause.kind, 'EFFECT_KO');
  assert.equal(plan.intent.cause.actor, 0);
  assert.equal(plan.intent.operation.to.zone, 'trash');
  assert.equal(plan.substitute.to.zone, 'hand');
  const choice = c.viewFor(1).frame.choice, [token] = choice.options.map(option => option.token);
  assert.equal(choice.purpose, 'replacement');
  assert.equal(choice.chooser, 1);
  assert.deepEqual(c.viewFor(0).frame.choice.options, []);
  assert.ok(!JSON.stringify(c.viewFor(0)).includes(token));
  assert.ok(!JSON.stringify(c.viewFor(1)).includes(plan.candidateId));
  assert.throws(() => c.answer(0, id(), c.context(), choice.selectionId, [token]), /chooser/);
  assert.throws(() => c.answer(1, id(), context, choice.selectionId, [token]), /stale/);
  assert.throws(() => c.answer(1, id(), c.context(), choice.selectionId, ['forged']), /token/);
  assert.throws(() => c.applyPendingWork(0, id(), c.context()), /no-work/);
  const answer = id(), at = c.context();
  assert.equal(c.answer(1, answer, at, choice.selectionId, [token]).replayed, false);
  assert.equal(c.answer(1, answer, at, choice.selectionId, [token]).replayed, true);
  assert.throws(() => c.answer(1, id(), c.context(), choice.selectionId, [token]), /chooser/);
  assert.deepEqual(board(c), before);
  const commit = id(), answered = c.context();
  c.applyPendingWork(0, commit, answered);
  assert.equal(c.applyPendingWork(0, commit, answered).replayed, true);
  assert.deepEqual(saved(c).appliedReplacements, [{ intentId: plan.intent.id, candidateId: plan.candidateId }]);
  const [event] = events(c);
  assert.equal(events(c).length, 1);
  assert.equal(event.isKO, false);
  assert.deepEqual(event.cause, plan.cause);
  assert.equal(event.after.generation, before.cards[target].generation + 1);
  assert.equal(board(c).players[1].hand.at(-1), target);
  assert.ok(!JSON.stringify(c.viewFor(0).movement.players[1].hand).includes(target));
  finish(c, 0);
  assert.equal(c.viewFor(1).triggerChoices.length, 0);
  assert.equal(board(c).players[0].hand.length, before.players[0].hand.length + 1);
});

test('declining applies the original KO and schedules its ON_KO exactly once', () => {
  const { c } = setup(); start(c); finish(c, 0);
  const choice = c.viewFor(1).frame.choice;
  c.answer(1, id(), c.context(), choice.selectionId, [choice.options[1].token]);
  finish(c, 0);
  const ko = events(c).filter(event => event.isKO);
  assert.equal(ko.length, 1);
  assert.equal(ko[0].cause.kind, 'EFFECT_KO');
  assert.equal(ko[0].cause.actor, 0);
  assert.equal(c.viewFor(1).triggerChoices.filter(t => t.timing === 'ON_KO').length, 1);
  assert.equal(saved(c).appliedReplacements, undefined);
});

test('zone-move substitution reaches only the alternate zone and is not a successful original MOVE_RESULT', () => {
  const { c } = setup({ rules: [makeRule({ cause: 'EFFECT_MOVE', to: 'hand' }, 'trash')], action: returnToHand });
  start(c); finish(c, 0);
  const target = board(c).players[1].character[0], choice = c.viewFor(1).frame.choice;
  c.answer(1, id(), c.context(), choice.selectionId, [choice.options[0].token]);
  c.applyPendingWork(0, id(), c.context());
  const memory = saved(c).lastMoveResult;
  assert.deepEqual(memory.rows, []);
  assert.deepEqual(memory.replaced.map(row => row.instanceId), [target]);
  assert.equal(board(c).players[1].trash.at(-1), target);
  assert.ok(!board(c).players[1].hand.includes(target));
  assert.equal(c.viewFor(1).triggerChoices.length, 0);
  finish(c, 0);
  assert.equal(c.viewFor(0).frame.status, 'completed');
});

test('protection takes precedence, and a false replacement condition leaves the original effect alone', () => {
  const continuousEffects = [{ type: 'CONTINUOUS_EFFECT', condition: always(), affectedQuery: {
    type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', visibility: 'PUBLIC', faceUpOnly: true, cardTypes: ['character'],
    excludeSource: false, filters: always()
  }, operation: { type: 'RESTRICT', policy: 'CANNOT_KO', by: 'OPPONENT', cause: 'EFFECT' } }];
  for (const [options, ko] of [[{ continuousEffects }, 0], [{ rules: [makeRule({}, 'hand', { type: 'TURN_IS', player: 'SELF' })] }, 1]]) {
    const { c } = setup(options); start(c); finish(c, 0);
    assert.equal(c.viewFor(0).frame.status, 'completed');
    assert.equal(events(c).filter(event => event.isKO).length, ko);
    assert.equal(saved(c).appliedReplacements, undefined);
  }
});

test('competing rules, chained substitutes, simultaneous batches and unknown conditions fail closed', () => {
  for (const options of [
    { rules: [makeRule(), { ...makeRule({}, 'trash'), id: 'other' }] },
    { rules: [makeRule(), { ...makeRule({ cause: 'EFFECT_MOVE', by: 'SELF', to: 'hand' }, 'trash'), id: 'chain' }] },
    { count: 2 },
    { unknownPower: true, rules: [makeRule({}, 'hand', { type: 'compare', left: { ref: 'SOURCE.printed.power' }, op: 'eq', right: 2000 })] }
  ]) {
    const { c } = setup(options); start(c, options.count);
    const before = board(c); finish(c, 0);
    assert.equal(c.viewFor(0).frame.status, 'blocked');
    assert.deepEqual(board(c), before);
    assert.deepEqual(events(c), []);
  }
});
