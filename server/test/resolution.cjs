const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MovementResolution } = require('../dist/test/movement/resolution.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const rules = { status: 'certifiedNone' };
const ref = { instanceId: 'don', generation: 0 };
const rest = { kind: 'setRest', card: ref, rotated: true };
function session(actor = 0) {
  const players = [emptyZones(), emptyZones()];
  players[actor].activeDon.push('don');
  const cards = { don: { ...ref, cardId: 'DON', kind: 'don', owner: actor, controller: actor,
    faceUp: true, rotated: false, attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null } };
  return new MovementResolution(createMovementState({ matchId: 'match', turnNumber: 1, players, cards }),
    { resolutionId: 'resolution', actor, source: null });
}
test('payment then effects then completion; both seats use the same authorization', () => {
  for (const actor of [0, 1]) {
    const s = session(actor);
    assert.throws(() => s.pay(1 - actor, 0, [rest], rules), /wrong-resolution-actor/);
    s.pay(actor, 0, [rest], rules);
    assert.equal(s.snapshot().cards.don.rotated, true);
    s.step(actor, 1, [{ ...rest, rotated: false }], rules);
    s.complete(actor, 2);
    assert.equal(s.view().status, 'completed');
    assert.equal(s.view().completedSteps, 1);
    assert.throws(() => s.step(actor, 2, [], rules), /not-resolving/);
  }
});
test('cancel is only legal before payment and does not mutate the board', () => {
  const s = session(), before = s.snapshot();
  s.cancel(0, 0);
  assert.equal(s.snapshot(), before);
  assert.throws(() => s.pay(0, 0, [], rules), /not-prepared/);
  const paid = session(); paid.pay(0, 0, [], rules);
  assert.throws(() => paid.cancel(0, 1), /cannot-cancel/);
});
test('failed payment is atomic and can be corrected without a partial payment', () => {
  const s = session(), before = s.snapshot();
  assert.throws(() => s.pay(0, 0, [rest], { status: 'evaluate', check: () => ({ kind: 'prevent' }) }));
  assert.equal(s.snapshot(), before);
  assert.equal(s.view().status, 'prepared');
  s.pay(0, 0, [rest], rules);
  assert.equal(s.view().status, 'resolving');
});
test('an unresolved effect blocks without refunding prior payment or permitting replay', () => {
  const s = session(); s.pay(0, 0, [rest], rules);
  const paid = s.snapshot();
  assert.throws(() => s.step(0, 1, [{ ...rest, rotated: false }], { status: 'unresolved' }));
  assert.equal(s.snapshot(), paid);
  assert.equal(s.snapshot().cards.don.rotated, true);
  assert.equal(s.view().status, 'blocked');
  assert.throws(() => s.step(0, 1, [], rules), /not-resolving/);
  assert.throws(() => s.cancel(0, 1), /cannot-cancel/);
});
test('stale requests and duplicate payment cannot advance the session', () => {
  const s = session(); s.pay(0, 0, [], rules);
  assert.throws(() => s.step(0, 0, [], rules), /stale/);
  assert.equal(s.view().status, 'resolving');
  assert.throws(() => s.pay(0, 1, [], rules), /not-prepared/);
  s.step(0, 1, [], rules);
  assert.throws(() => s.step(0, 1, [], rules), /stale/);
  assert.equal(s.view().completedSteps, 1);
});
test('prevented effects are resolved without inventing movement events', () => {
  const s = session(); s.pay(0, 0, [], rules);
  const result = s.step(0, 1, [rest], { status: 'evaluate', check: () => ({ kind: 'prevent' }) });
  assert.equal(result.events.length, 0);
  assert.equal(s.snapshot().cards.don.rotated, false);
  s.complete(0, 2);
});
test('rule callbacks cannot reenter or cancel a session during its atomic commit', () => {
  const s = session();
  s.pay(0, 0, [rest], { status: 'evaluate', check() {
    assert.throws(() => s.cancel(0, 0), /reentrant/);
    assert.throws(() => s.pay(0, 0, [], rules), /reentrant/);
    return { kind: 'allow' };
  } });
  assert.equal(s.view().status, 'resolving');
});
test('private board and source are not serialized through the status view', () => {
  const s = session();
  assert.throws(() => JSON.stringify(s), /server-only/);
  assert.deepEqual(Object.keys(s.view()).sort(), ['actor', 'completedSteps', 'resolutionId', 'revision', 'status']);
  assert.equal(Object.isFrozen(s.snapshot()), true);
});
test('bounded steps prevent an unbounded resolution', () => {
  const s = session(); s.pay(0, 0, [], rules);
  for (let i = 0; i < 128; i++) s.step(0, i + 1, [], rules);
  assert.throws(() => s.step(0, 129, [], rules), /step-limit/);
  assert.equal(s.view().completedSteps, 128);
});
test('completion requires closing temporary disclosure rights', () => {
  const s = session(); s.pay(0, 0, [], rules);
  s.step(0, 1, [{ kind: 'reveal', card: ref, scopeId: 'resolution', viewers: [0, 1] }], rules);
  assert.throws(() => s.complete(0, 2), /reveals-still-open/);
  assert.equal(s.view().status, 'resolving');
  s.step(0, 2, [{ kind: 'closeReveals', scopeId: 'resolution' }], rules);
  s.complete(0, 3);
  assert.equal(s.view().status, 'completed');
});
