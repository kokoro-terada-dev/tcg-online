const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EffectCommandHost, EFFECT_RECEIPT_LIMIT } = require('../dist/test/effects/effectCommandHost.js');
const { parseEffectCommand } = require('../dist/test/effects/effectCommands.js');
const { TimedMovementEffect } = require('../dist/test/effects/timedMovement.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const rules = { status: 'certifiedNone' };
const pay = { kind: 'payDon', amount: 1 };
const discard = { kind: 'moveCards', selector: { kind: 'cards', chooser: 'SELF', owner: 'SELF', zones: ['hand'], min: 1, max: 1, mode: 'SELECT' },
  destination: { owner: 'SELF', zone: 'trash', position: 'append', visibility: 'faceUp' } };
const choice = { kind: 'select', saveAs: 'option', selector: { kind: 'choice', chooser: 'OPPONENT', options: [{ id: 'internal-yes', label: 'Yes' }] } };
const draw = { kind: 'draw', player: 'SELF', amount: 1 };
function fixture(actor = 0, costs = [pay], actions = [draw], guard = rules) {
  let p = createProgression(actor);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  const players = [emptyZones(), emptyZones()], cards = {};
  for (const seat of [0, 1]) for (const [suffix, kind, zone] of [['l', 'leader', 'leader'], ['h', 'character', 'hand'], ['deck', 'character', 'deck'], ['don', 'don', 'activeDon']]) {
    const id = `${seat}-${suffix}`;
    cards[id] = { instanceId: id, generation: 0, cardId: kind === 'leader' ? 'TEST' : `PRIVATE-${id}`, kind, owner: seat, controller: seat,
      faceUp: zone !== 'deck', rotated: false, attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null };
    if (zone === 'leader') players[seat].leader[0] = id; else players[seat][zone].push(id);
  }
  const runtime = new TimedMovementEffect(createMovementState({ matchId: 'm', turnNumber: 1, players, cards }), p,
    { resolutionId: 'r', actor, source: { instanceId: `${actor}-l`, generation: 0 } },
    { dslVersion: 1, effectId: 'e', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs, actions });
  return new EffectCommandHost(runtime, guard);
}
function command(host, kind, requestId, actor = 0, patch = {}) {
  const v = host.viewFor(actor), common = { kind, matchId: v.matchId, resolutionId: v.effect.resolutionId, requestId,
    expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision };
  if (kind === 'answerCosts' || kind === 'answerEffect') {
    common.selectionId = v.selection.selectionId;
    common.tokens = [v.selection.kind === 'cards' ? v.selection.candidates[0].token : v.selection.options[0].token];
  }
  return { ...common, ...patch };
}
test('server-authenticated seats can execute a complete private composite-cost and choice flow', () => {
  for (const actor of [0, 1]) {
    const host = fixture(actor, [pay, discard], [choice, draw]), other = 1 - actor;
    for (const [kind, id, seat] of [['beginCosts', 'a', actor], ['answerCosts', 'b', actor], ['commitCosts', 'c', actor], ['advance', 'd', actor], ['answerEffect', 'e', other], ['advance', 'f', actor]]) {
      const response = host.handle(seat, command(host, kind, id, seat)); assert.equal(response.ok, true, kind);
      assert.equal(response.view.localPlayerIndex, seat);
    }
    assert.equal(host.viewFor(actor).effect.status, 'completed');
    assert.equal(host.viewFor(actor).movement.players[actor].hand[0].cardId, `PRIVATE-${actor}-deck`);
    assert.equal(host.viewFor(other).movement.players[actor].hand[0].cardId, null);
    assert.equal(host.viewFor(other).selection, null);
  }
});
test('same request ID and body replay never charge DON or draw twice, and return the latest view', () => {
  const h = fixture(), start = command(h, 'start', 'start');
  assert.equal(h.handle(0, start).ok, true);
  assert.equal(h.handle(0, command(h, 'advance', 'draw')).ok, true);
  const replay = h.handle(0, start);
  assert.equal(replay.replayed, true); assert.equal(replay.ok, true); assert.equal(replay.view.effect.status, 'completed');
  assert.equal(replay.view.movement.revision, 2); assert.equal(replay.view.movement.players[0].restDon.length, 1);
  assert.equal(replay.view.movement.players[0].hand.length, 2);
});
test('reusing a request ID with changed content is a conflict, including failed requests', () => {
  const h = fixture(), rejected = command(h, 'advance', 'request');
  assert.equal(h.handle(0, rejected).code, 'operation_rejected');
  assert.equal(h.handle(0, rejected).replayed, true);
  const before = h.viewFor(0);
  assert.equal(h.handle(0, command(h, 'start', 'request')).code, 'request_conflict');
  assert.deepEqual(h.viewFor(0), before);
});
test('JSON field order does not change request identity', () => {
  const h = fixture(), c = command(h, 'start', 'request'); h.handle(0, c);
  const reordered = Object.fromEntries(Object.entries(c).reverse());
  assert.equal(h.handle(0, reordered).replayed, true);
});
test('request IDs are scoped by seat and wrong actors cannot impersonate the owner', () => {
  const h = fixture(), foreign = command(h, 'start', 'shared', 1);
  assert.equal(h.handle(1, foreign).code, 'operation_rejected');
  assert.equal(h.handle(0, command(h, 'start', 'shared')).ok, true);
  const spoof = command(h, 'advance', 'spoof', 1, { actor: 0 });
  assert.equal(h.handle(1, spoof).code, 'invalid_command');
});
test('wrong match/resolution and stale movement/progression revisions never mutate the state', () => {
  const h = fixture(), before = h.viewFor(0);
  for (const patch of [{ matchId: 'elsewhere' }, { resolutionId: 'other' }]) assert.equal(h.handle(0, command(h, 'start', 'wrong-context', 0, patch)).code, 'wrong_context');
  for (const [id, patch] of [['stale-board', { expectedMovementRevision: 99 }], ['stale-phase', { expectedProgressionRevision: 99 }]]) assert.equal(h.handle(0, command(h, 'start', id, 0, patch)).code, 'operation_rejected');
  assert.deepEqual(h.viewFor(0), before);
});
test('host views never serialize hidden identities, source refs, private journals or definitions', () => {
  const h = fixture(), v = h.viewFor(1), json = JSON.stringify(v);
  assert.equal(json.includes('PRIVATE-0-h'), false); assert.equal(json.includes('PRIVATE-0-deck'), false);
  assert.equal(v.movement.players[0].hand[0].ref, null); assert.equal(v.movement.players[0].deck[0].ref, null);
  for (const field of ['appliedTransactions', 'modifierIds', 'sourceFacts', 'effectId', 'bindings']) assert.equal(json.includes(field), false);
  assert.equal(Object.isFrozen(v), true); assert.throws(() => JSON.stringify(h), /server-only/);
});
test('cost candidates only reach the chooser and stale replies cannot target a new plan', () => {
  const h = fixture(0, [discard], []), begin = command(h, 'beginCosts', 'begin'); h.handle(0, begin);
  const oldAnswer = command(h, 'answerCosts', 'old-answer'); assert.equal(h.viewFor(1).selection, null);
  h.handle(0, command(h, 'cancelCosts', 'cancel')); h.handle(0, command(h, 'beginCosts', 'new-begin'));
  assert.equal(h.handle(0, oldAnswer).code, 'operation_rejected');
  const oldReplayed = h.handle(0, begin); assert.equal(oldReplayed.replayed, true);
  assert.notEqual(oldReplayed.view.selection.selectionId, oldAnswer.selectionId);
});
test('requests with effect definitions, source IDs or rule flags are rejected, not executed', () => {
  const h = fixture();
  for (const extra of [{ definition: {} }, { sourceId: '0-l' }, { rules: { status: 'certifiedNone' } }, { amount: 100 }, { kind: 'evaluate' }]) {
    assert.equal(h.handle(0, command(h, 'start', 'bad', 0, extra)).code, 'invalid_command');
  }
  assert.equal(h.viewFor(0).movement.revision, 0);
});
test('malformed arrays, accessors, cycles and oversized values fail before reading unsafe fields', () => {
  const h = fixture(0, [discard], []); h.handle(0, command(h, 'beginCosts', 'begin'));
  const valid = command(h, 'answerCosts', 'answer');
  let reads = 0; const getter = { ...valid }; Object.defineProperty(getter, 'tokens', { enumerable: true, get() { reads++; throw Error('unsafe'); } });
  const sparse = { ...valid, tokens: Array(1) }, cyclic = { ...valid }; cyclic.tokens = [cyclic];
  for (const input of [getter, sparse, cyclic, { ...valid, tokens: Array(129).fill('x') }, { ...valid, tokens: ['x'.repeat(101)] }, { ...valid, tokens: [valid.tokens[0], valid.tokens[0]] }, { ...valid, expectedMovementRevision: NaN }]) {
    assert.equal(h.handle(0, input).code, 'invalid_command');
  }
  assert.equal(reads, 0); assert.equal(h.viewFor(0).movement.revision, 0);
});
test('parser detaches input and rejects answer-only fields on other commands', () => {
  const h = fixture(0, [discard], []); h.handle(0, command(h, 'beginCosts', 'begin'));
  const raw = command(h, 'answerCosts', 'answer'), parsed = parseEffectCommand(raw); raw.tokens[0] = 'changed';
  assert.notEqual(parsed.tokens[0], 'changed'); assert.equal(Object.isFrozen(parsed.tokens), true);
  assert.throws(() => parseEffectCommand(command(h, 'start', 'extra', 0, { tokens: [] })));
});
test('error responses contain no internal exception text and still project current state', () => {
  const h = fixture(0, [pay], [], { status: 'evaluate', check() { throw Error('SECRET-private-card-id'); } });
  const response = h.handle(0, command(h, 'start', 'error'));
  assert.equal(response.code, 'operation_rejected'); assert.equal(JSON.stringify(response).includes('SECRET'), false);
  assert.equal(response.view.movement.revision, 0); assert.equal(response.view.progression.gate, 'idle');
});
test('a post-payment effect failure is visible as blocked rather than assumed rollback', () => {
  const h = fixture(0, [pay], [{ ...draw, amount: 2 }]); h.handle(0, command(h, 'start', 'start'));
  const failed = h.handle(0, command(h, 'advance', 'fail'));
  assert.equal(failed.ok, false); assert.equal(failed.view.effect.status, 'blocked');
  assert.equal(failed.view.movement.players[0].restDon.length, 1); assert.equal(failed.view.progression.gate, 'resolving');
});
test('reentrant commands cannot split execution or write a second receipt', () => {
  let h; h = fixture(0, [pay], [draw], { status: 'evaluate', check() {
    const nested = h.handle(0, command(h, 'start', 'nested')); assert.equal(nested.code, 'busy'); return { kind: 'allow' };
  } });
  assert.equal(h.handle(0, command(h, 'start', 'outer')).ok, true);
  assert.equal(h.handle(0, command(h, 'advance', 'nested')).ok, true);
});
test('receipt budgets are bounded, never evict replay protection, and are independent per player', () => {
  const h = fixture(), first = command(h, 'advance', 'request-0');
  for (let i = 0; i < EFFECT_RECEIPT_LIMIT; i++) assert.equal(h.handle(0, command(h, 'advance', `request-${i}`)).code, 'operation_rejected');
  assert.equal(h.handle(0, command(h, 'start', 'overflow')).code, 'request_limit');
  assert.equal(h.handle(0, first).replayed, true);
  assert.equal(h.handle(1, command(h, 'start', 'other-player', 1)).code, 'operation_rejected');
});
test('an infeasible cost answer reports selection_retry with fresh tokens and replay protection', () => {
  const rest = { kind: 'restCards', selector: { kind: 'cards', chooser: 'SELF', owner: 'SELF', zones: ['leader', 'activeDon'], min: 1, max: 1, mode: 'SELECT' } };
  const h = fixture(0, [pay, rest], []); h.handle(0, command(h, 'beginCosts', 'begin'));
  const view = h.viewFor(0), token = view.selection.candidates.find(c => c.cardId === 'PRIVATE-0-don').token;
  const invalid = command(h, 'answerCosts', 'choose-don', 0, { tokens: [token] });
  const retry = h.handle(0, invalid);
  assert.equal(retry.ok, false); assert.equal(retry.code, 'selection_retry'); assert.equal(retry.view.movement.revision, 0);
  assert.notEqual(retry.view.selection.selectionId, invalid.selectionId);
  assert.equal(h.handle(0, invalid).replayed, true);
  assert.equal(h.handle(0, command(h, 'answerCosts', 'choose-leader')).ok, true);
  assert.equal(h.handle(0, command(h, 'commitCosts', 'commit')).view.effect.status, 'completed');
});
test('an unauthenticated or invalid seat is not accepted as a player', () => {
  const h = fixture(), before = h.viewFor(0), c = command(h, 'start', 'request');
  for (const actor of [null, undefined, 2, '0']) assert.throws(() => h.handle(actor, c), /invalid-movement-player/);
  assert.throws(() => h.viewFor(2), /invalid-movement-player/); assert.deepEqual(h.viewFor(0), before);
});
