const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, select, finish, selector, id, always } = require('./helpers/v3-observed.cjs');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
function setup({ type = 'TURN_END', player = 'SELF', count = 1, field = 1, mutate = () => {}, initial = false } = {}) {
  const h = base({ count, field, sourceType: type === 'ON_BLOCK' ? 'character' : 'leader', mutate: raw => {
    raw.schemaVersion = '3.0.0-subset.23';
    if (type === 'ON_BLOCK') raw.keywords = [{ type: 'BLOCKER' }];
    for (const e of raw.effects) e.timing = { type, ...(type === 'ON_BLOCK' ? {} : { player }) }; mutate(raw);
  } });
  if (initial) {
    let p = createProgression(0);
    while (p.phase !== 'main') { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
    h.options.progression = p;
  }
  return { ...h, c: new V3SyntheticMatchCoordinator(h.options) };
}
function drain(c) {
  for (let n = 0; n < 50; n++) {
    const v = c.viewFor(0);
    if (v.conditionalTriggerHold || v.outcome) return;
    if (v.frame && v.frame.status !== 'completed') { const q = finish(c, v.resolutionActor); if (q?.status === 'waitingForChoice') {
      const chooser = [0, 1].find(p => c.viewFor(p).frame.choice?.options.length), choice = c.viewFor(chooser).frame.choice;
      c.answer(chooser, id(), c.context(), choice.selectionId, choice.options.slice(0, choice.min).map(o => o.token)); } }
    else if (v.pendingTriggerCount) select(c, c.viewFor(v.triggerChooser).triggerChoices[0].effectId, v.triggerChooser);
    else if (v.phaseContinuation) c.advance(v.activePlayer, id(), c.context());
    else return;
  }
  throw Error('Boundary drain limit');
}
function attackAndBlock(c) {
  c.endTurn(0, id(), c.context()); c.endTurn(1, id(), c.context());
  const source = c.attackChoicesFor(0).sources.find(row => c.snapshotForCoordinator().movement.cards[row.card.instanceId].kind === 'leader').card;
  const target = c.snapshotForCoordinator().movement.players[1].leader[0];
  c.attack(0, id(), c.context(), source, { instanceId: target, generation: 0 });
  const blocker = c.viewFor(1).blockerChoices[0].card, context = c.context(); c.block(1, 'boundary-block', context, blocker);
  return { blocker, context };
}
test('real block holds the block step until its common Runtime effects complete', () => {
  const { c } = setup({ type: 'ON_BLOCK' }); const { blocker, context } = attackAndBlock(c);
  assert.equal(c.viewFor(0).battle.step, 'block'); assert.equal(c.viewFor(0).pendingTriggerCount, 1);
  assert.equal(c.snapshotForCoordinator().movement.cards[blocker.instanceId].rotated, true);
  assert.equal(c.block(1, 'boundary-block', context, blocker).replayed, true);
  assert.deepEqual(c.viewFor(0).triggerChoices, []); select(c, 'watch-0', 1); finish(c, 1);
  assert.equal(c.viewFor(0).battle.step, 'counter'); assert.equal(c.viewFor(0).pendingTriggerCount, 0);
  assert.equal(c.snapshotForCoordinator().triggerObservations.records.filter(r => r.eventType === 'ON_BLOCK').length, 1);
});
test('passing a block or merely resting a card never generates ON_BLOCK', () => {
  const { c } = setup({ type: 'ON_BLOCK' }); c.endTurn(0, id(), c.context()); c.endTurn(1, id(), c.context());
  const source = c.attackChoicesFor(0).sources[0].card, target = c.snapshotForCoordinator().movement.players[1].leader[0];
  c.attack(0, id(), c.context(), source, { instanceId: target, generation: 0 }); c.battleDecision(1, id(), c.context(), 'passBlock');
  assert.equal(c.snapshotForCoordinator().triggerObservations.records.length, 0);
});
test('an ordinary REST_SOURCE payment is not a block declaration', () => {
  const { c } = setup({ type: 'ON_BLOCK', mutate: raw => { raw.effects.push({ id: 'rest-main', kind: 'activated', timing: { type: 'MAIN' }, sourceZones: ['character'], optional: false, usageLimit: null,
    activationConditions: always(), resolutionConditions: always(), costs: [{ type: 'REST_SOURCE' }], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }); } });
  const card = c.snapshotForCoordinator().movement.players[0].character[0];
  c.activate(0, id(), c.context(), { instanceId: card, generation: 0 }, 'rest-main'); finish(c, 0);
  assert.equal(c.snapshotForCoordinator().movement.cards[card].rotated, true); assert.equal(c.snapshotForCoordinator().triggerObservations.records.length, 0);
});
test('end boundary evaluates conditions before refresh and resumes checkpoints once', () => {
  const { c } = setup({ count: 2 }); const before = c.snapshotForCoordinator().movement.players[1];
  const context = c.context(); c.endTurn(0, 'end-boundary', context); assert.equal(c.endTurn(0, 'end-boundary', context).replayed, true);
  assert.equal(c.viewFor(0).phase, 'end'); assert.equal(c.viewFor(0).triggerChoices.length, 2);
  select(c, 'watch-1', 0); finish(c, 0); select(c, 'watch-0', 0); finish(c, 0);
  assert.equal(c.viewFor(0).phaseContinuation, true);
  const continueContext = c.context(); c.advance(0, 'continue-end', continueContext);
  assert.equal(c.advance(0, 'continue-end', continueContext).replayed, true);
  const after = c.snapshotForCoordinator(); assert.equal(after.progression.phase, 'main'); assert.equal(after.progression.activePlayer, 1);
  assert.equal(after.movement.players[1].hand.length, before.hand.length + 1); assert.equal(after.movement.players[1].activeDon.length, before.activeDon.length + 2);
  assert.throws(() => c.advance(0, id(), c.context()));
});
test('main-start boundary pauses after normal draw/DON and precedes manual MAIN', () => {
  const { c } = setup({ type: 'MAIN_START' }); c.endTurn(0, id(), c.context());
  assert.equal(c.viewFor(0).activePlayer, 1); assert.equal(c.viewFor(1).phase, 'main'); assert.equal(c.snapshotForCoordinator().progression.phaseSettled, false);
  assert.equal(c.viewFor(1).triggerChoices.length, 1);
  const before = c.snapshotForCoordinator(); assert.throws(() => c.endTurn(1, id(), c.context())); assert.deepEqual(c.snapshotForCoordinator(), before);
  drain(c); assert.equal(c.snapshotForCoordinator().progression.phaseSettled, true); assert.equal(c.viewFor(0).phaseContinuation, false);
});
test('first main-start requires an actual unsettled entry and fires only once', () => {
  const { c } = setup({ type: 'MAIN_START', initial: true }); assert.equal(c.viewFor(0).phaseContinuation, true);
  c.advance(0, id(), c.context()); drain(c);
  assert.equal(c.snapshotForCoordinator().triggerObservations.records.filter(r => r.result === true).length, 1);
  assert.equal(c.viewFor(0).pendingTriggerCount, 0); assert.throws(() => c.advance(0, id(), c.context()));
});
test('opponent end timing selects only that controller and rejects wrong/stale responses', () => {
  const { c } = setup({ player: 'OPPONENT' }); c.endTurn(0, id(), c.context());
  assert.equal(c.viewFor(1).triggerChooser, 1); const choice = c.viewFor(1).triggerChoices[0], before = c.snapshotForCoordinator();
  assert.throws(() => c.resolveTrigger(0, id(), c.context(), choice.token)); assert.throws(() => c.resolveTrigger(1, id(), { ...c.context(), revision: 0 }, choice.token));
  assert.deepEqual(c.snapshotForCoordinator(), before); select(c, 'watch-0', 1); finish(c, 1);
  assert.throws(() => c.advance(1, id(), c.context())); c.advance(0, id(), c.context());
});
test('boundary conditions reuse COUNT and distinguish false from UNKNOWN', () => {
  for (const unknown of [false, true]) {
    const { c } = setup({ mutate: raw => { raw.effects[0].activationConditions = unknown ? { type: 'compare', left: { ref: 'SOURCE.printed.cost' }, op: 'gte', right: 0 } :
      { type: 'COUNT', query: { type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', visibility: 'PUBLIC', faceUpOnly: true, cardTypes: ['character'], filters: always(), excludeSource: false }, op: 'gte', value: 3 }; } });
    c.endTurn(0, id(), c.context()); assert.equal(c.viewFor(0).conditionalTriggerHold, unknown);
    assert(c.snapshotForCoordinator().triggerObservations.records.some(r => r.result === (unknown ? 'unknown' : false)));
  }
});
test('boundary choices preserve separate chooser and do not expose private options', () => {
  const { c } = setup({ mutate: raw => { raw.effects[0].actions = [{ type: 'SELECT', selector: selector('OPPONENT', 'OPPONENT'), bindAs: 'target' }, { type: 'REST', cards: { ref: 'bindings.target' } }]; } });
  c.endTurn(0, id(), c.context()); select(c, 'watch-0', 0); finish(c, 0); const q = c.viewFor(1).frame.choice;
  assert.equal(q.chooser, 1); assert.deepEqual(c.viewFor(0).frame.choice.options, []);
  assert.throws(() => c.answer(0, id(), c.context(), q.selectionId, [])); c.answer(1, id(), c.context(), q.selectionId, []); finish(c, 0); drain(c);
});
test('block conditions reuse the character-count query at the actual block fact', () => {
  for (const field of [2, 3]) {
    const { c } = setup({ type: 'ON_BLOCK', field, mutate: raw => { raw.effects[0].activationConditions = { type: 'COUNT', query: {
      type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', visibility: 'PUBLIC', faceUpOnly: true, cardTypes: ['character'], filters: always(), excludeSource: false }, op: 'gte', value: 3 }; } });
    attackAndBlock(c); assert.equal(c.viewFor(1).pendingTriggerCount, field === 3 ? 1 : 0);
    assert.equal(c.viewFor(1).battle.step, field === 3 ? 'block' : 'counter');
  }
});
test('a blocker moved by one sibling cannot activate another sibling with the old generation', () => {
  const { c } = setup({ type: 'ON_BLOCK', count: 2, mutate: raw => { raw.effects[0].actions = [{ type: 'BIND_SOURCE', bindAs: 'self' },
    { type: 'MOVE_CARD', cards: { ref: 'bindings.self' }, destination: { owner: 'SELF', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' }]; } });
  attackAndBlock(c); const token = c.viewFor(1).triggerChoices.find(r => r.effectId === 'watch-1').token;
  select(c, 'watch-0', 1); finish(c, 1); assert.equal(c.viewFor(1).conditionalTriggerHold, true);
  assert.throws(() => c.resolveTrigger(1, id(), c.context(), token));
});
test('existing turn-end modifiers remain visible for end effects and expire only at the existing cleanup', () => {
  const { c } = setup({ mutate: raw => {
    raw.effects[0].activationConditions = { type: 'compare', left: { ref: 'SOURCE.current.power' }, op: 'gte', right: 6000 };
    raw.effects.push({ id: 'buff', kind: 'activated', timing: { type: 'MAIN' }, sourceZones: ['leader'], optional: false, usageLimit: null,
      activationConditions: always(), resolutionConditions: always(), costs: [], actions: [{ type: 'BIND_SOURCE', bindAs: 'self' },
        { type: 'MODIFY_STAT', cards: { ref: 'bindings.self' }, stat: 'power', amount: 1000, duration: { type: 'TURN_END', player: 'SELF', occurrence: 1 } }] });
  } });
  const leader = c.snapshotForCoordinator().movement.players[0].leader[0];
  c.activate(0, id(), c.context(), { instanceId: leader, generation: 0 }, 'buff'); finish(c, 0); c.endTurn(0, id(), c.context());
  assert.equal(c.viewFor(0).triggerChoices.length, 1); assert.equal(c.viewFor(0).publicStats.find(s => s.card.instanceId === leader).power, 6000);
  drain(c); assert.equal(c.viewFor(0).publicStats.find(s => s.card.instanceId === leader).power, 5000);
});
test('self-end effects precede opponent-end effects in the same boundary group', () => {
  const { c } = setup({ count: 2, mutate: raw => { raw.effects[1].timing.player = 'OPPONENT'; } });
  c.endTurn(0, id(), c.context()); assert.equal(c.viewFor(0).triggerChoices[0].effectId, 'watch-0'); assert.deepEqual(c.viewFor(1).triggerChoices, []);
  select(c, 'watch-0', 0); finish(c, 0); assert.equal(c.viewFor(1).triggerChoices[0].effectId, 'watch-1');
  assert.throws(() => c.advance(0, id(), c.context())); select(c, 'watch-1', 1); finish(c, 1); c.advance(0, id(), c.context());
});
test('private boundary selection exposes no hand references or options to the other client', () => {
  const { c } = setup({ mutate: raw => { raw.effects[0].actions = [{ type: 'SELECT', bindAs: 'hand', selector: { ...selector('SELF'), zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false } }]; } });
  c.endTurn(0, id(), c.context()); select(c, 'watch-0', 0); finish(c, 0); const q = c.viewFor(0).frame.choice;
  assert(q.options.length > 0); const peer = c.viewFor(1); assert.deepEqual(peer.frame.choice.options, []);
  assert(peer.movement.players[0].hand.every(card => card.cardId === null && card.ref === null));
  const before = c.snapshotForCoordinator(); assert.throws(() => c.answer(1, id(), c.context(), q.selectionId, [])); assert.deepEqual(c.snapshotForCoordinator(), before);
  c.answer(0, id(), c.context(), q.selectionId, []); finish(c, 0); drain(c);
});
