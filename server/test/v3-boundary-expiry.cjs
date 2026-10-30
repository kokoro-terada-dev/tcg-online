const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, finish, id, always } = require('./helpers/v3-observed.cjs');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { expiryFor, expiryCheckpoint, expireAtBoundary, applicationAnchor } = require('../dist/test/effects/v3/effectExpiry.js');
const duration = (boundary = 'TURN_START', player = 'SELF', includeCurrent = false, occurrence = 1) => ({ type: 'UNTIL_BOUNDARY', boundary, player, includeCurrent, occurrence });
function setup({ d = duration(), actor = 0, sourceType = 'leader', stat = 'power', amount = 1000, mutate = () => {} } = {}) {
  const h = base({ count: 1, sourceType, mutate: raw => {
    raw.schemaVersion = '3.0.0-subset.24';
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions: [{ type: 'BIND_SOURCE', bindAs: 'self' },
      { type: 'MODIFY_STAT', cards: { ref: 'bindings.self' }, stat, amount, duration: d },
      { type: 'GRANT_KEYWORD', cards: { ref: 'bindings.self' }, keyword: { type: sourceType === 'leader' ? 'CANNOT_BE_BLOCKED' : 'BLOCKER' }, duration: d }] });
    mutate(raw);
  } });
  if (actor === 1) {
    let p = createProgression(1);
    while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
    h.options.progression = p;
  }
  const c = new V3SyntheticMatchCoordinator(h.options), card = h.options.movement.cards[h.options.movement.players[actor][sourceType][0]];
  return { ...h, c, source: { instanceId: card.instanceId, generation: card.generation }, actor };
}
function use(h) { h.c.activate(h.actor, id(), h.c.context(), h.source, 'watch-0'); return finish(h.c, h.actor); }
const deltas = h => h.c.viewFor(h.actor).publicStats.find(r => r.card.instanceId === h.source.instanceId);
function end(c) { const actor = c.viewFor(0).activePlayer; c.endTurn(actor, id(), c.context()); }

for (const actor of [0, 1]) test(`self start expiry is before refresh, once only, for both stats and keywords (seat=${actor})`, () => {
  const h = setup({ actor }); use(h); assert.equal(deltas(h).powerDelta, 1000); assert(deltas(h).keywords.includes('CANNOT_BE_BLOCKED'));
  const applied = h.c.snapshotForCoordinator().statEffects[0].boundary;
  assert.equal(applied.turnNumber, 3); assert.equal(applied.anchor.turnNumber, 1);
  end(h.c); assert.equal(deltas(h).powerDelta, 1000);
  const context = h.c.context(), request = id(); h.c.endTurn(1 - actor, request, context); const after = h.c.snapshotForCoordinator();
  assert.equal(deltas(h).powerDelta, 0); assert.equal(deltas(h).keywords.includes('CANNOT_BE_BLOCKED'), false);
  assert.equal(h.c.endTurn(1 - actor, request, context).replayed, true); assert.deepEqual(h.c.snapshotForCoordinator(), after);
  assert.equal(new Set(after.expiryTokens).size, after.expiryTokens.length);
});
test('next opponent end retains the effect during that end-phase resolution, then expires', () => {
  const h = setup({ d: duration('END_PHASE_END', 'OPPONENT'), mutate: raw => {
    raw.effects.push({ id: 'end-check', kind: 'triggered', timing: { type: 'TURN_END', player: 'OPPONENT' }, sourceZones: ['leader'], optional: false, usageLimit: null,
      activationConditions: { type: 'compare', left: { ref: 'SOURCE.current.power' }, op: 'gte', right: 6000 }, resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] });
  } });
  use(h); end(h.c); assert.equal(deltas(h).powerDelta, 1000); end(h.c);
  assert.equal(h.c.viewFor(0).phase, 'end'); assert.equal(deltas(h).powerDelta, 1000);
  const choice = h.c.viewFor(0).triggerChoices[0]; h.c.resolveTrigger(0, id(), h.c.context(), choice.token); finish(h.c, 0);
  assert.equal(deltas(h).powerDelta, 1000); h.c.advance(1, id(), h.c.context()); assert.equal(deltas(h).powerDelta, 0);
});
test('includeCurrent explicitly controls the matching current turn; occurrence counts matching turns only', () => {
  for (const [include, occurrence, target] of [[true, 1, 1], [false, 1, 3], [true, 2, 3], [false, 2, 5]]) {
    const h = setup({ d: duration('END_PHASE_END', 'SELF', include, occurrence) }); use(h);
    assert.equal(h.c.snapshotForCoordinator().statEffects[0].boundary.turnNumber, target);
    for (let turn = 1; turn <= target; turn++) { end(h.c); assert.equal(deltas(h).powerDelta, turn < target ? 1000 : 0); }
  }
});
test('cost changes share expiry without defaulting unknown printed values to zero', () => {
  const h = setup({ sourceType: 'character', stat: 'cost', amount: -1, d: duration('END_PHASE_END', 'OPPONENT') }); use(h);
  assert.equal(deltas(h).costDelta, -1); assert(deltas(h).keywords.includes('BLOCKER')); end(h.c); end(h.c);
  assert.equal(deltas(h).costDelta, 0); assert.equal(deltas(h).keywords.includes('BLOCKER'), false);
});
test('legacy TURN_END and BATTLE_END retain their representation and legacy cleanup', () => {
  assert.deepEqual(expiryFor({ type: 'TURN_END', player: 'SELF', occurrence: 2 }, 0, null), { endPlayer: 0, remaining: 2 });
  assert.deepEqual(expiryFor({ type: 'BATTLE_END' }, 0, 'battle'), { endPlayer: null, remaining: null, battleId: 'battle' });
  const h = setup({ mutate: raw => { raw.effects[0].actions.splice(2, 0, { type: 'MODIFY_STAT', cards: { ref: 'bindings.self' }, stat: 'power', amount: 2000,
    duration: { type: 'TURN_END', player: 'SELF', occurrence: 1 } }); } }); use(h); assert.equal(deltas(h).powerDelta, 3000);
  end(h.c); assert.equal(deltas(h).powerDelta, 1000); end(h.c); assert.equal(deltas(h).powerDelta, 0);
});
test('work replay neither duplicates effects nor restarts their duration', () => {
  const h = setup(); h.c.activate(0, id(), h.c.context(), h.source, 'watch-0'); h.c.advance(0, id(), h.c.context());
  const context = h.c.context(); h.c.applyPendingWork(0, 'apply-timed', context); const after = h.c.snapshotForCoordinator();
  assert.equal(h.c.applyPendingWork(0, 'apply-timed', context).replayed, true); assert.deepEqual(h.c.snapshotForCoordinator(), after);
  finish(h.c, 0); assert.equal(h.c.snapshotForCoordinator().statEffects.length, 1); assert.equal(h.c.snapshotForCoordinator().keywordGrants.length, 1);
});
test('old targets are pruned on generation change, not retargeted until the deadline', () => {
  const h = setup({ sourceType: 'character', mutate: raw => { raw.effects[0].actions.push({ type: 'MOVE_CARD', cards: { ref: 'bindings.self' },
    destination: { owner: 'SELF', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' }); } }); use(h);
  assert.equal(h.c.snapshotForCoordinator().statEffects.length, 0); assert.equal(h.c.snapshotForCoordinator().keywordGrants.length, 0);
});
test('selection wait leaves no timed effect applied and expiry anchors the application work', () => {
  const h = setup({ mutate: raw => { raw.effects[0].actions.splice(0, 0, { type: 'SELECT', bindAs: 'unused', selector: {
    type: 'CARDS', owner: 'SELF', controller: 'SELF', chooser: 'SELF', zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, cardTypes: ['character'], filters: always(), excludeSource: false,
    min: 0, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' } }); } });
  use(h); const q = h.c.viewFor(0).frame.choice, revision = h.c.context().movementRevision;
  assert.equal(h.c.snapshotForCoordinator().statEffects.length, 0); assert.deepEqual(h.c.viewFor(1).frame.choice.options, []);
  assert.throws(() => h.c.endTurn(0, id(), h.c.context())); assert.throws(() => h.c.answer(1, id(), h.c.context(), q.selectionId, []));
  h.c.answer(0, id(), h.c.context(), q.selectionId, []); finish(h.c, 0);
  assert.equal(h.c.snapshotForCoordinator().statEffects[0].boundary.anchor.movementRevision, revision);
});
test('unmodeled anchors, skipped boundaries, stale checkpoints and forged proof are rejected', () => {
  const h = setup(), board = h.options.movement, p = h.options.progression, anchor = applicationAnchor(board, p);
  assert.throws(() => expiryFor(duration(), 0, null), /anchor-required/);
  assert.throws(() => expiryFor(duration(), 0, null, { ...anchor, turnOrder: 'EXTRA_TURN' }), /anchor-unknown/);
  const checkpoint = expiryCheckpoint(board, { ...p, phase: 'end', phaseSettled: false }, 'END_PHASE_END');
  const effect = expiryFor(duration('END_PHASE_END', 'SELF', true), 0, null, anchor);
  assert.deepEqual(expireAtBoundary([effect], checkpoint), []); assert.deepEqual(expireAtBoundary([effect], checkpoint), []);
  assert.throws(() => expireAtBoundary([effect], structuredClone(checkpoint)), /proof-required/);
  const missed = expiryCheckpoint({ ...board, turnNumber: 3 }, { ...p, turnNumber: 3, phase: 'end', phaseSettled: false }, 'END_PHASE_END');
  assert.throws(() => expireAtBoundary([effect], missed), /boundary-missed/);
  assert.throws(() => applicationAnchor({ ...board, turnNumber: 2 }, { ...p, turnNumber: 2 }), /turn-order-unmodeled/);
  const future = expiryFor(duration(), 0, null, { ...anchor, turnNumber: 3 }); assert.throws(() => expireAtBoundary([future], checkpoint), /stale-expiry/);
});
test('opponent start expires at the incoming refresh, not one round later', () => {
  const h = setup({ d: duration('TURN_START', 'OPPONENT') }); use(h);
  assert.equal(h.c.snapshotForCoordinator().statEffects[0].boundary.turnNumber, 2); end(h.c); assert.equal(deltas(h).powerDelta, 0);
});
test('main-start trigger evaluation sees already-expired values from the preceding turn-start', () => {
  const h = setup({ mutate: raw => { raw.effects.push({ id: 'main-check', kind: 'triggered', timing: { type: 'MAIN_START', player: 'SELF' }, sourceZones: ['leader'], optional: false, usageLimit: null,
    activationConditions: { type: 'compare', left: { ref: 'SOURCE.current.power' }, op: 'gte', right: 6000 }, resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }); } });
  use(h); end(h.c); end(h.c);
  assert.equal(h.c.viewFor(0).pendingTriggerCount, 0);
  assert.equal(h.c.snapshotForCoordinator().triggerObservations.records.find(r => r.eventType === 'MAIN_START' && r.turnNumber === 3 && r.context.effectController === 0).result, false);
});
test('an effect applied within end resolution uses that application window, not a future turn by accident', () => {
  const h = setup({ d: duration('END_PHASE_END', 'SELF', true), mutate: raw => { raw.effects[0].kind = 'triggered'; raw.effects[0].timing = { type: 'TURN_END', player: 'SELF' }; } });
  end(h.c); const choice = h.c.viewFor(0).triggerChoices[0]; h.c.resolveTrigger(0, id(), h.c.context(), choice.token); finish(h.c, 0);
  const effect = h.c.snapshotForCoordinator().statEffects[0]; assert.equal(effect.boundary.anchor.phase, 'end'); assert.equal(effect.boundary.turnNumber, 1);
  assert.equal(deltas(h).powerDelta, 1000); h.c.advance(0, id(), h.c.context()); assert.equal(deltas(h).powerDelta, 0);
});
