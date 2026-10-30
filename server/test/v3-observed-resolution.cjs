const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, play, select, finish, selector, id, always } = require('./helpers/v3-observed.cjs');

test('simultaneous observers choose any sibling order; each resolves exactly once', () => {
  const { c } = setup(); play(c);
  assert.equal(c.viewFor(0).triggerChoices.length, 2); assert.deepEqual(c.viewFor(1).triggerChoices, []);
  const context = c.context(), token = c.viewFor(0).triggerChoices[1].token;
  c.resolveTrigger(0, 'choose-second', context, token); assert.equal(c.resolveTrigger(0, 'choose-second', context, token).replayed, true);
  assert.throws(() => c.resolveTrigger(0, id(), c.context(), token));
  finish(c); assert.equal(c.viewFor(0).frame.status, 'completed');
  select(c, 'watch-0'); finish(c);
  assert.equal(c.viewFor(0).pendingTriggerCount, 0); assert.equal(c.viewFor(0).movement.players[0].hand.length, 6);
  assert.equal(c.snapshotForCoordinator().triggerObservations.records.filter(r => r.status === 'RESOLVED').length, 2);
  c.endTurn(0, id(), c.context());
});
test('both controllers resolve turn-player group first; other controller tokens stay private', () => {
  const { c } = setup({ count: 1, mutate: raw => { raw.effects[0].timing.owner = raw.effects[0].timing.controller = 'ANY'; } }); play(c);
  assert.equal(c.viewFor(0).triggerChooser, 0); assert.deepEqual(c.viewFor(1).triggerChoices, []);
  const snapshot = c.snapshotForCoordinator(); assert.throws(() => c.resolveTrigger(1, id(), c.context(), c.viewFor(0).triggerChoices[0].token));
  assert.deepEqual(c.snapshotForCoordinator(), snapshot); select(c, 'watch-0', 0); finish(c, 0);
  assert.equal(c.viewFor(0).triggerChooser, 1); assert.deepEqual(c.viewFor(0).triggerChoices, []);
  select(c, 'watch-0', 1); finish(c, 1); assert.equal(c.viewFor(0).pendingTriggerCount, 0);
});
test('activation uses occurrence facts; resolution conditions use the current board', () => {
  for (const resolutionGate of [false, true]) {
    const { c } = setup({ mutate: raw => {
      for (const effect of raw.effects) effect.activationConditions = { type: 'compare', left: { ref: 'SELF.handCount' }, op: 'eq', right: 4 };
      if (resolutionGate) raw.effects[1].resolutionConditions = { type: 'compare', left: { ref: 'SELF.handCount' }, op: 'eq', right: 4 };
    } }); play(c); select(c, 'watch-0'); finish(c); select(c, 'watch-1'); finish(c);
    assert.equal(c.viewFor(0).movement.players[0].hand.length, resolutionGate ? 5 : 6);
  }
});
test('choice resumes with distinct chooser; invalid, stale and conflicting responses change nothing', () => {
  const { c } = setup({ count: 1, mutate: raw => { raw.effects[0].actions = [
    { type: 'SELECT', selector: selector('OPPONENT', 'OPPONENT'), bindAs: 'target' }, { type: 'REST', cards: { ref: 'bindings.target' } }]; } });
  play(c); select(c, 'watch-0'); finish(c);
  const q = c.viewFor(1).frame.choice; assert.equal(q.chooser, 1); assert.deepEqual(c.viewFor(0).frame.choice.options, []);
  const before = c.snapshotForCoordinator();
  for (const [actor, tokens, expected] of [[0, [q.options[0].token], c.context()], [1, ['forged'], c.context()], [1, [q.options[0].token], { ...c.context(), revision: 0 }]])
    assert.throws(() => c.answer(actor, id(), expected, q.selectionId, tokens));
  assert.deepEqual(c.snapshotForCoordinator(), before);
  assert.throws(() => c.endTurn(0, id(), c.context()));
  const context = c.context(); c.answer(1, 'resume-selection', context, q.selectionId, [q.options[0].token]);
  assert.equal(c.answer(1, 'resume-selection', context, q.selectionId, [q.options[0].token]).replayed, true);
  assert.throws(() => c.answer(1, 'resume-selection', context, q.selectionId, []));
  finish(c, 0); assert.equal(c.viewFor(0).pendingTriggerCount, 0);
});
test('optional decline consumes the candidate but not once-per-turn usage', () => {
  const { c } = setup({ count: 1, mutate: raw => { raw.effects[0].optional = true; raw.effects[0].usageLimit = { type: 'PER_TURN', scope: 'SOURCE_OBJECT', count: 1 }; } });
  play(c); select(c, 'watch-0'); finish(c); const q = c.viewFor(0).frame.choice;
  c.answer(0, id(), c.context(), q.selectionId, [q.options.find(o => o.label === '発動しない').token]); finish(c);
  assert.equal(c.snapshotForCoordinator().usage.length, 0); assert.equal(c.viewFor(0).pendingTriggerCount, 0);
});
test('same-number observer instances are distinct and publicly located for ordering', () => {
  const { c } = setup({ sourceType: 'character', field: 2, count: 1 }); play(c);
  const choices = c.viewFor(0).triggerChoices; assert.equal(choices.length, 2);
  assert.equal(new Set(choices.map(c => c.token)).size, 2); assert.equal(new Set(choices.map(c => c.sourceLabel)).size, 2);
  select(c, 'watch-0'); finish(c); select(c, 'watch-0'); finish(c); assert.equal(c.viewFor(0).pendingTriggerCount, 0);
});
test('an event created during resolution waits behind the original sibling group', () => {
  const { c } = setup({ count: 3, mutate: raw => {
    raw.effects[0].actions = [{ type: 'SELECT', selector: selector(), bindAs: 'target' }, { type: 'KO', cards: { ref: 'bindings.target' } }];
    Object.assign(raw.effects[2].timing, { event: 'CARD_KO', snapshot: 'TRANSACTION_BEFORE', fromZones: ['character'], toZones: ['trash'] });
  } }); play(c); select(c, 'watch-0'); finish(c); const q = c.viewFor(0).frame.choice;
  c.answer(0, id(), c.context(), q.selectionId, [q.options[0].token]); finish(c);
  assert.deepEqual(c.viewFor(0).triggerChoices.map(c => c.effectId), ['watch-1']); assert.deepEqual(c.viewFor(1).triggerChoices, []);
  select(c, 'watch-1'); finish(c); assert.equal(c.viewFor(0).triggerChooser, 1);
  select(c, 'watch-2', 1); finish(c, 1); assert.equal(c.viewFor(0).pendingTriggerCount, 0);
});
test('a source moved by a sibling is held; the old token never starts a new generation', () => {
  const { c } = setup({ sourceType: 'character', field: 2, count: 1, mutate: raw => {
    raw.effects[0].actions = [{ type: 'SELECT', selector: selector('SELF'), bindAs: 'target' },
      { type: 'MOVE_CARD', cards: { ref: 'bindings.target' }, destination: { owner: 'SELF', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' }];
  } }); play(c); const old = c.viewFor(0).triggerChoices[1].token; select(c, 'watch-0'); finish(c); const q = c.viewFor(0).frame.choice;
  c.answer(0, id(), c.context(), q.selectionId, [q.options[0].token]); finish(c);
  assert.equal(c.viewFor(0).conditionalTriggerHold, true); assert.deepEqual(c.viewFor(0).triggerChoices, []);
  assert(c.snapshotForCoordinator().triggerObservations.records.some(r => r.reason === 'SOURCE_STALE'));
  const before = c.snapshotForCoordinator(); assert.throws(() => c.resolveTrigger(0, id(), c.context(), old)); assert.deepEqual(c.snapshotForCoordinator(), before);
});
test('UNKNOWN is not published as an executable candidate', () => {
  const { c } = setup({ count: 1, mutate: raw => { raw.effects[0].activationConditions = { type: 'compare', left: { ref: 'SOURCE.printed.cost' }, op: 'gte', right: 0 }; } });
  play(c); assert.equal(c.viewFor(0).conditionalTriggerHold, true); assert.deepEqual(c.viewFor(0).triggerChoices, []);
  assert(c.snapshotForCoordinator().triggerObservations.records.some(r => r.result === 'unknown'));
});
test('discard cost selection and work replay use the shared payment path once', () => {
  const { c } = setup({ count: 1, mutate: raw => { raw.effects[0].costs = [{ type: 'DISCARD_HAND', count: 1 }]; } });
  play(c); select(c, 'watch-0'); finish(c); const q = c.viewFor(0).frame.choice;
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  c.answer(0, id(), c.context(), q.selectionId, [q.options[0].token]);
  c.advance(0, id(), c.context()); const context = c.context(); c.applyPendingWork(0, 'pay-once', context);
  const paid = c.snapshotForCoordinator(); assert.equal(c.applyPendingWork(0, 'pay-once', context).replayed, true); assert.deepEqual(c.snapshotForCoordinator(), paid);
  finish(c); assert.equal(c.viewFor(0).movement.players[0].trash.length, 1); assert.equal(c.viewFor(0).movement.players[0].hand.length, 4);
});
test('captured proof cannot be forged by copying the observation fields', () => {
  const { V3FixtureCoordinator } = require('../dist/test/effects/v3/fixtureCoordinator.js');
  const { c, options, approved } = setup({ count: 1 }); play(c);
  const snapshot = c.snapshotForCoordinator(), record = snapshot.triggerObservations.records.find(r => r.status === 'PENDING');
  const base = { ...options, card: approved, identity: { matchId: snapshot.movement.matchId, resolutionId: 'proof-test', effectId: record.effectId, actor: 0, source: record.source },
    movement: snapshot.movement, progression: snapshot.progression, definitions: options.cards, checkEvents: () => {} };
  delete base.cards;
  assert.throws(() => new V3FixtureCoordinator({ ...base, triggerCause: { type: 'ON_EVENT', eventId: record.eventId, observation: structuredClone(record) } }), /observed-authorization/);
  assert.doesNotThrow(() => new V3FixtureCoordinator({ ...base, triggerCause: { type: 'ON_EVENT', eventId: record.eventId, observation: record } }));
});
test('current target generation is rechecked before accepting a selection', () => {
  const { V3ResolutionMachine } = require('../dist/test/effects/v3/resolution.js');
  const { approved } = setup({ count: 1, mutate: raw => { raw.effects[0].actions = [{ type: 'SELECT', selector: selector(), bindAs: 'target' }]; } });
  let generation = 0;
  const env = { revision: () => 0, now: () => 1, activationAtOccurrence: () => true, evaluate: () => true,
    candidates: () => [{ ref: { instanceId: 'target', generation }, cardId: 'TARGET', owner: 1, controller: 1, zone: 'character', kind: 'character', faceUp: true, visibleTo: [0, 1] }] };
  const m = new V3ResolutionMachine(approved, { matchId: 'proof-match', resolutionId: 'proof-resolution', actor: 0, source: { instanceId: 'leader', generation: 0 }, effectId: 'watch-0' }, Buffer.alloc(32, 1), env);
  m.advance('start', 0); const q = m.viewFor(0).choice, before = m.exportForStorage(); generation++;
  assert.throws(() => m.answer(0, 'stale-generation', 1, q.selectionId, [q.options[0].token]), /target-stale/);
  assert.deepEqual(m.exportForStorage(), before);
});
test('successful use consumes shared once-per-turn usage and skips a later occurrence', () => {
  const { c } = setup({ count: 1, mutate: raw => { raw.effects[0].usageLimit = { type: 'PER_TURN', scope: 'SOURCE_OBJECT', count: 1 }; raw.effects[0].costs = [{ type: 'REST_DON', count: 1 }]; },
    mutateBoard: board => { for (let i = 0; i < 4; i++) { const don = board.players[0].donDeck.shift(); board.players[0].activeDon.push(don); board.cards[don] = { ...board.cards[don], faceUp: true }; } } });
  play(c); select(c, 'watch-0'); finish(c); assert.equal(c.snapshotForCoordinator().usage[0][1], 1);
  play(c); assert.equal(c.viewFor(0).pendingTriggerCount, 0); assert.equal(c.viewFor(0).conditionalTriggerHold, false);
  assert.equal(c.viewFor(0).movement.players[0].restDon.length, 5);
  assert(c.snapshotForCoordinator().triggerObservations.records.some(r => r.status === 'SKIPPED' && r.reason === 'USAGE_EXHAUSTED'));
});
test('unpayable triggered work stays blocked without a refund or duplicate activation', () => {
  const { c } = setup({ count: 1, mutate: raw => { raw.effects[0].costs = [{ type: 'REST_DON', count: 1 }]; } });
  play(c); const token = c.viewFor(0).triggerChoices[0].token; select(c, 'watch-0'); finish(c);
  assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.viewFor(0).movement.players[0].hand.length, 4);
  assert.equal(c.viewFor(0).movement.players[0].restDon.length, 2); assert.throws(() => c.resolveTrigger(0, id(), c.context(), token));
});
test('non-MAIN boundary candidates are explicitly held rather than advancing PR07 phases', () => {
  const { c } = setup({ count: 1, mutate: raw => { Object.assign(raw.effects[0].timing, { event: 'CARD_MOVED', fromZones: ['deck'], toZones: ['hand'], cardTypes: ['event', 'character'] }); } });
  c.endTurn(0, id(), c.context()); assert.equal(c.viewFor(0).conditionalTriggerHold, true); assert.deepEqual(c.viewFor(0).triggerChoices, []);
  assert(c.snapshotForCoordinator().triggerObservations.records.some(r => r.reason === 'NON_MAIN_BOUNDARY'));
});
