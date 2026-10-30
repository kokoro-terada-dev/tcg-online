const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, start, frame, remember, predicate, finish, selector, id, always } = require('./helpers/v3-memory.cjs');
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require('../dist/test/effects/v3/compiler.js');
const { captureMoveResult, rememberMoveFacts, readRememberedColors } = require('../dist/test/effects/v3/moveResults.js');
const { UNKNOWN, createDerivedCardFactsReader } = require('../dist/test/effects/v3/readContext.js');
const { trackMovementOccurrences } = require('../dist/test/movement/occurrence.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { V3ResolutionMachine } = require('../dist/test/effects/v3/resolution.js');

for (const actor of [0, 1]) test(`BEFORE CURRENT public memory survives hidden destination and signed resume (seat=${actor})`, () => {
  const h = setup({ actor }); const hand = h.options.movement.players[actor].hand.length; start(h);
  const memory = frame(h).factScopes[0].colors;
  assert.deepEqual(memory.rows[0].value, { status: 'KNOWN', value: ['Red'] });
  assert.equal(memory.rows[0].movement.from.zone, 'character'); assert.equal(memory.rows[0].movement.to.zone, 'hand');
  assert.equal(memory.rows[0].cause.effectController, actor); assert.equal(memory.rows[0].movement.targetAfter.generation, memory.rows[0].movement.targetBefore.generation + 1);
  assert.equal(h.c.snapshotForCoordinator().movement.players[actor].hand.length, hand + 2);
});
for (const basis of ['PRINTED', 'CURRENT']) test(`AFTER ${basis} reads public destination, never upgrades hidden BEFORE`, () => {
  const h = setup({ from: 'hand', to: 'trash', mutate: r => { r.effects[0].actions[3] = remember({ snapshot: 'AFTER', basis }); } }); start(h);
  const f = frame(h); assert.equal(f.resultScopes[0].returned.rows[0].beforeColors.status, 'UNKNOWN');
  assert.deepEqual(f.factScopes[0].colors.rows[0].value.value, ['Red']); assert.equal(h.c.viewFor(0).frame.status, 'completed');
});
for (const basis of ['PRINTED', 'CURRENT']) test(`AFTER ${basis} hidden destination stays UNKNOWN, not BEFORE fallback`, () => {
  const h = setup({ mutate: r => { r.effects[0].actions[3] = remember({ snapshot: 'AFTER', basis }); } });
  assert.throws(() => start(h), /unknown-predicate/); assert.equal(h.c.viewFor(0).frame.status, 'ready');
});
test('multiple moved cards retain separate evidence; all-row memory uses the explicit union', () => {
  const h = setup({ count: 2 }); start(h, 2); const m = frame(h).factScopes[0].colors;
  assert.deepEqual(readRememberedColors(m, m.identity), ['Red', 'Blue']);
  assert.equal(new Set(m.rows.map(r => r.eventId)).size, 2); assert.equal(new Set(m.rows.map(r => r.movement.groupId)).size, 2);
});
test('a subset is identified by original refs, not number, name, array index or current generation', () => {
  const h = setup({ count: 2, mutate: raw => {
    const s = selector('SELF'); Object.assign(s, { min: 1, max: 1, excludeSource: false });
    raw.effects[0].actions.unshift({ type: 'SELECT', selector: s, bindAs: 'first' }); raw.effects[0].actions[4].cards = { ref: 'bindings.first' };
  } });
  h.c.activate(0, id(), h.c.context(), h.source, 'watch-0'); finish(h.c, 0);
  let q = h.c.viewFor(0).frame.choice; h.c.answer(0, id(), h.c.context(), q.selectionId, [q.options[1].token]); finish(h.c, 0);
  q = h.c.viewFor(0).frame.choice; h.c.answer(0, id(), h.c.context(), q.selectionId, q.options.slice(0, 2).map(r => r.token)); finish(h.c, 0);
  const f = frame(h); assert.equal(f.resultScopes[0].returned.rows.length, 2); assert.equal(f.factScopes[0].colors.rows.length, 1);
  assert.deepEqual(f.factScopes[0].colors.rows[0].value.value, ['Blue']);
});
test('remembered predicate is shared by selector/query/AND/OR/NOT and survives choice wait', () => {
  const h = setup({ mutate: raw => {
    const filter = { type: 'all', conditions: [{ type: 'any', conditions: [predicate({ subject: 'CANDIDATE' })] }, { type: 'not', condition: predicate({ subject: 'CANDIDATE', match: 'DISJOINT' }) }] };
    const s = selector('SELF'); Object.assign(s, { filters: filter, excludeSource: false });
    raw.effects[0].actions.splice(4, 0, { type: 'SELECT', selector: s, bindAs: 'next' });
    raw.effects[0].actions[5].condition = { type: 'COUNT', op: 'eq', value: 1, query: { type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', visibility: 'PUBLIC', faceUpOnly: true, cardTypes: ['character'], filters: filter, excludeSource: false } };
  } }); start(h); const q = h.c.viewFor(0).frame.choice; assert.equal(q.options.length, 1); assert.deepEqual(h.c.viewFor(1).frame.choice.options, []);
  assert.throws(() => h.c.answer(1, id(), h.c.context(), q.selectionId, [])); assert.throws(() => h.c.answer(0, id(), h.c.context(), q.selectionId, ['forged']));
  const request = id(), context = h.c.context(), tokens = [q.options[0].token]; h.c.answer(0, request, context, q.selectionId, tokens);
  assert.equal(h.c.answer(0, request, context, q.selectionId, tokens).replayed, true); finish(h.c, 0); assert.equal(h.c.viewFor(0).frame.status, 'completed');
});
test('no row identity or remembered value is included in either player DTO', () => {
  const h = setup(); start(h);
  for (const actor of [0, 1]) for (const key of ['factScopes', 'beforePrintedColors', 'afterPrintedColors', 'transactionId', 'beforeColors', 'afterColors']) assert.equal(JSON.stringify(h.c.viewFor(actor)).includes(key), false);
});
test('empty selection remains UNKNOWN instead of an empty known color set', () => {
  const h = setup({ count: 0 }); assert.throws(() => start(h, 0), /unknown-predicate/);
});
test('compiler rejects unsupported fields, missing memory/result/card binding, duplicates and branch leaks', () => {
  const h = setup();
  for (const mutate of [r => { r.effects[0].actions[3].field = 'power'; }, r => { r.effects[0].actions[3].snapshot = 'LATEST'; },
    r => { r.effects[0].actions[3].result = 'missing'; }, r => { r.effects[0].actions[3].cards = { ref: 'bindings.missing' }; },
    r => { r.effects[0].actions[3].bindAs = '__proto__'; }, r => { r.effects[0].actions.push(remember()); },
    r => { r.effects[0].actions[4].condition.memory = 'missing'; },
    r => { r.effects[0].actions[3] = { type: 'IF', condition: always(), then: [remember()], else: [] }; }]) {
    const bad = structuredClone(h.raw); mutate(bad); assert.throws(() => compileV3CardJson(JSON.stringify(bad)));
  }
});
test('old profile25 rejects new DSL and retains its exact registry hash', () => {
  const h = setup(), old = structuredClone(h.raw); old.schemaVersion = '3.0.0-subset.25'; assert.throws(() => compileV3CardJson(JSON.stringify(old)));
  assert.equal(v3RegistryHash(builtinV3Registries('3.0.0-subset.25')), 'e9765f1965231d4ec630b66d76a74b15f77ecd945c40e460df02f012714cd1a8');
});

function evidence() {
  const h = setup(), before = h.options.movement; trackMovementOccurrences(before);
  const identity = { matchId: before.matchId, resolutionId: 'facts', effectId: 'watch-0', actor: 0, source: h.source }, card = before.cards[before.players[0].character[0]], ref = { instanceId: card.instanceId, generation: card.generation };
  const result = new MovementStore(before).commit({ transactionId: 'facts-move', matchId: before.matchId, expectedRevision: before.revision, turnNumber: before.turnNumber, actor: 0, effectController: 0, source: h.source, resolutionId: 'facts', mode: 'effect',
    operations: [{ kind: 'move', card: ref, from: { player: 0, zone: 'character' }, to: { player: 0, zone: 'trash', faceUp: true, rotated: false, position: 'append' }, cause: 'EFFECT_MOVE' }] }, { status: 'certifiedNone' });
  const facts = state => createDerivedCardFactsReader({ board: () => state, definitions: new Map(h.options.cards.map(c => [c.definition.cardId, c])), statEffects: () => [], activePlayer: 0 })(ref, 0);
  return { h, before, identity, result, ref, facts };
}
test('printed and current snapshots are distinct, missing basis is UNKNOWN, not substituted', () => {
  const h = evidence(), read = state => { const card = Object.values(state.cards).find(c => c.instanceId === h.ref.instanceId), ref = { instanceId: card.instanceId, generation: card.generation };
    const f = createDerivedCardFactsReader({ board: () => state, definitions: new Map(h.h.options.cards.map(c => [c.definition.cardId, c])), statEffects: () => [], activePlayer: 0 })(ref, 0);
    return { ...f, metadata: { ...f.metadata, current: { ...f.metadata.current, colors: state.revision === h.before.revision ? ['BeforeCurrent'] : ['AfterCurrent'] } } }; };
  const r = captureMoveResult(h.before, h.result, h.identity, 'work', [h.ref], read, true);
  for (const [snapshot, basis, expected] of [['BEFORE', 'PRINTED', ['Red']], ['AFTER', 'PRINTED', ['Red']], ['BEFORE', 'CURRENT', ['BeforeCurrent']], ['AFTER', 'CURRENT', ['AfterCurrent']]]) {
    const m = rememberMoveFacts(r, h.identity, [h.ref], snapshot, basis); assert.deepEqual(readRememberedColors(m, h.identity), expected);
  }
  const old = captureMoveResult(h.before, h.result, h.identity, 'work', [h.ref], read);
  assert.equal(readRememberedColors(rememberMoveFacts(old, h.identity, null, 'BEFORE', 'PRINTED'), h.identity), UNKNOWN);
});
test('stale, foreign, duplicate, malformed or post-move refs cannot select a memory row', () => {
  const h = evidence(), r = captureMoveResult(h.before, h.result, h.identity, 'work', [h.ref], () => UNKNOWN, true);
  for (const refs of [[{ ...h.ref, generation: h.ref.generation + 1 }], [{ instanceId: 'foreign', generation: 0 }], [h.ref, h.ref], [{ ...h.ref, extra: true }]]) assert.throws(() => rememberMoveFacts(r, h.identity, refs, 'BEFORE', 'CURRENT'));
});
test('memory cannot be read under a foreign match, resolution, actor, effect or source generation', () => {
  const h = evidence(), r = captureMoveResult(h.before, h.result, h.identity, 'work', [h.ref], () => UNKNOWN, true), m = rememberMoveFacts(r, h.identity, null, 'BEFORE', 'CURRENT');
  for (const change of [{ matchId: 'other' }, { resolutionId: 'other' }, { actor: 1 }, { effectId: 'other' }, { source: { ...h.identity.source, generation: h.identity.source.generation + 1 } }]) {
    const identity = { ...h.identity, ...change }; assert.equal(readRememberedColors(m, identity), UNKNOWN); assert.throws(() => rememberMoveFacts(r, identity, null, 'BEFORE', 'CURRENT'));
  }
});
test('unsigned modifications to remembered values fail frame HMAC verification', () => {
  const h = setup(); start(h); const f = frame(h), e = JSON.parse(h.c.snapshotForCoordinator().active.frame);
  f.factScopes[0].colors.rows[0].value = { status: 'KNOWN', value: ['FORGED'] }; e.payload = JSON.stringify(f);
  assert.throws(() => V3ResolutionMachine.restore(h.approved, f.identity, h.options.signingKey, { revision: () => f.worldRevision }, JSON.stringify(e), f.revision), /signature/);
});
test('later reveal cannot upgrade an AFTER snapshot that was hidden at movement time', () => {
  const h = setup({ mutate: raw => {
    const s = selector('SELF'); Object.assign(s, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, excludeSource: false, min: 1, max: 1 });
    raw.effects[0].actions.splice(3, 0, { type: 'SELECT', selector: s, bindAs: 'revealNow' }, { type: 'REVEAL', cards: { ref: 'bindings.revealNow' }, viewers: 'BOTH' });
    raw.effects[0].actions[5] = remember({ snapshot: 'AFTER' });
  } }); start(h); const q = h.c.viewFor(0).frame.choice;
  // The moved card was appended to hand; reveal that exact current instance.
  const movedId = frame(h).resultScopes[0].returned.rows[0].event.after.instanceId;
  const board = h.c.snapshotForCoordinator().movement, slot = board.players[0].hand.indexOf(movedId);
  h.c.answer(0, id(), h.c.context(), q.selectionId, [q.options[slot].token]);
  h.c.advance(0, id(), h.c.context()); h.c.applyPendingWork(0, id(), h.c.context());
  assert.throws(() => finish(h.c, 0), /unknown-predicate/);
  assert.equal(frame(h).resultScopes[0].returned.rows[0].afterColors.status, 'UNKNOWN');
});
test('advance replay does not duplicate memories, and stale new requests do not mutate the frame', () => {
  const h = setup(); h.c.activate(0, id(), h.c.context(), h.source, 'watch-0'); finish(h.c, 0);
  const q = h.c.viewFor(0).frame.choice; h.c.answer(0, id(), h.c.context(), q.selectionId, [q.options[0].token]);
  h.c.advance(0, id(), h.c.context()); h.c.applyPendingWork(0, id(), h.c.context());
  const context = h.c.context(), request = id(); h.c.advance(0, request, context); const after = h.c.snapshotForCoordinator();
  assert.equal(h.c.advance(0, request, context).replayed, true); assert.deepEqual(h.c.snapshotForCoordinator(), after);
  assert.throws(() => h.c.advance(0, id(), context)); assert.deepEqual(h.c.snapshotForCoordinator(), after);
  assert.equal(Object.keys(frame(h).factScopes[0]).length, 1);
});
test('distinct memory names retain independent snapshots without overwriting previous values', () => {
  const h = setup({ mutate: raw => { raw.effects[0].actions.splice(4, 0, remember({ snapshot: 'AFTER', bindAs: 'hiddenAfter' })); } }); start(h);
  const m = frame(h).factScopes[0]; assert.deepEqual(m.colors.rows[0].value.value, ['Red']); assert.equal(m.hiddenAfter.rows[0].value.status, 'UNKNOWN');
});
test('remembered facts declared inside a branch are discarded on scope exit', () => {
  const h = setup({ mutate: raw => { raw.effects[0].actions.splice(3, 2, { type: 'IF', condition: always(), then: raw.effects[0].actions.slice(3), else: [] }); } });
  start(h); assert.deepEqual(frame(h).factScopes, [{}]);
});
test('compound predicates preserve UNKNOWN instead of coercing missing memory values', () => {
  for (const wrap of [p => ({ type: 'all', conditions: [p] }), p => ({ type: 'any', conditions: [p] }), p => ({ type: 'not', condition: p })]) {
    const h = setup({ mutate: raw => { raw.effects[0].actions[3].snapshot = 'AFTER'; raw.effects[0].actions[4].condition = wrap(predicate()); } });
    assert.throws(() => start(h), /unknown-predicate/);
  }
});
