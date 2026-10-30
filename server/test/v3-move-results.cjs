const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, finish, selector, id, always } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { trackMovementOccurrences } = require('../dist/test/movement/occurrence.js');
const { captureMoveResult, rememberedColors, currentMovedRef } = require('../dist/test/effects/v3/moveResults.js');
const { UNKNOWN, createDerivedCardFactsReader } = require('../dist/test/effects/v3/readContext.js');
const { V3ResolutionMachine } = require('../dist/test/effects/v3/resolution.js');
const move = (zone = 'hand') => ({ type: 'MOVE_CARD', cards: { ref: 'bindings.chosen' }, destination: { owner: 'SELF', zone, position: 'append', faceUp: true }, cause: 'EFFECT' });
const condition = (match = 'OVERLAP', subject = 'SOURCE') => ({ type: 'MOVED_COLORS', result: 'returned', subject, basis: 'CURRENT', match });
function setup({ field = 2, count = 1, owner = 'SELF', from = 'character', mutate = () => {}, targetColors = ['Blue', 'Red'] } = {}) {
  const h = base({ field, count: 1, mutate: raw => {
    raw.schemaVersion = '3.0.0-subset.25'; raw.colors = ['Red'];
    const s = selector(owner); Object.assign(s, { zone: from, excludeSource: false, min: count, max: Math.max(1, count), visibility: from === 'hand' ? 'OWNER_ONLY' : 'PUBLIC', faceUpOnly: from !== 'hand' });
    Object.assign(raw.effects[0], { kind: 'activated', timing: { type: 'MAIN' }, actions: [
      { type: 'SELECT', selector: s, bindAs: 'chosen' }, move(), { type: 'MOVE_RESULT', bindAs: 'returned' },
      { type: 'IF', condition: condition(), then: [{ type: 'DRAW', player: 'SELF', count: 1 }], else: [] }] }); mutate(raw);
  } });
  const options = { ...h.options, cards: [...h.options.cards] };
  if (targetColors !== null) {
    const raw = structuredClone(options.cards.find(c => c.definition.cardId === 'TARGET').definition); raw.colors = targetColors;
    const p = compileV3CardJson(JSON.stringify(raw)), template = h.approved;
    const a = { status: 'approved', cardId: raw.cardId, cardVersion: raw.cardVersion, definitionHash: p.definitionHash, sourceHash: p.sourceHash,
      compilerVersion: p.compilerVersion, registryHash: p.registryHash, rulesetVersion: template.rulesetVersion, reviewer: 'synthetic-only', approvedAt: '2026-10-30T00:00:00.000Z', ruleEvidence: ['synthetic'] };
    options.cards = options.cards.map(card => card.definition.cardId === 'TARGET' ? new ApprovedV3Catalog([p], [a], a.rulesetVersion).get(raw.cardId) : card);
  }
  const c = new V3SyntheticMatchCoordinator(options), board = c.snapshotForCoordinator().movement, card = board.cards[board.players[0].leader[0]];
  return { ...h, options, c, source: { instanceId: card.instanceId, generation: card.generation } };
}
function start(h, selection = 1) {
  h.c.activate(0, id(), h.c.context(), h.source, 'watch-0'); finish(h.c, 0);
  const q = h.c.viewFor(0).frame.choice;
  h.c.answer(0, id(), h.c.context(), q.selectionId, q.options.slice(0, selection).map(o => o.token));
  h.c.advance(0, id(), h.c.context());
}
const frame = c => JSON.parse(JSON.parse(c.snapshotForCoordinator().active.frame).payload);

test('returned public colors are frozen before movement into hidden hand and used by later IF', () => {
  const h = setup(); const before = h.c.snapshotForCoordinator().movement.players[0].hand.length; start(h);
  h.c.applyPendingWork(0, id(), h.c.context()); const f = frame(h.c), r = f.lastMoveResult;
  assert.equal(r.rows.length, 1); assert.deepEqual(r.rows[0].beforeColors, { status: 'KNOWN', value: ['Blue', 'Red'] });
  assert.deepEqual(r.rows[0].afterColors, { status: 'UNKNOWN' });
  assert.equal(r.rows[0].event.after.generation, r.rows[0].event.before.generation + 1);
  assert.equal(r.rows[0].event.from.zone, 'character'); assert.equal(r.rows[0].event.to.zone, 'hand');
  finish(h.c, 0); assert.equal(h.c.snapshotForCoordinator().movement.players[0].hand.length, before + 2);
  assert.deepEqual(frame(h.c).resultScopes[0].returned.rows[0].beforeColors.value, ['Blue', 'Red']);
});
test('disjoint colors use literal values without case or width normalization', () => {
  const h = setup({ targetColors: ['Ｒｅｄ', 'red'], mutate: raw => { raw.effects[0].actions[3].condition.match = 'DISJOINT'; } });
  const before = h.c.snapshotForCoordinator().movement.players[0].hand.length; start(h); finish(h.c, 0);
  assert.equal(h.c.snapshotForCoordinator().movement.players[0].hand.length, before + 2);
});
test('multiple moved instances share transaction but retain separate operation/group/event IDs', () => {
  const h = setup({ count: 2 }); start(h, 2); h.c.applyPendingWork(0, id(), h.c.context());
  const r = frame(h.c).lastMoveResult; assert.equal(r.rows.length, 2);
  for (const key of ['eventId', 'groupId', 'operationIndex']) assert.equal(new Set(r.rows.map(row => row.event[key])).size, 2);
  assert.equal(new Set(r.rows.map(row => row.event.before.instanceId)).size, 2);
  finish(h.c, 0); assert.equal(h.c.viewFor(0).frame.status, 'completed');
});
test('empty optional selection remembers an empty result, never invents colors', () => {
  const h = setup({ count: 0 });
  assert.throws(() => start(h, 0), /unknown-predicate/);
  // advance is atomic: failed IF leaves the preceding signed frame unchanged.
  assert.equal(frame(h.c).lastMoveResult, undefined);
});
test('private hand color does not become public memory merely by moving to trash', () => {
  const h = setup({ from: 'hand', mutate: raw => { raw.effects[0].actions[1].destination.zone = 'trash'; } }); start(h);
  h.c.applyPendingWork(0, id(), h.c.context()); const r = frame(h.c).lastMoveResult;
  assert.equal(r.rows[0].beforeColors.status, 'UNKNOWN'); assert.equal(r.rows[0].afterColors.status, 'KNOWN');
  assert.throws(() => finish(h.c, 0), /unknown-predicate/);
});
test('memory does not leak through either player view while selection/work is pending', () => {
  const h = setup(); start(h); h.c.applyPendingWork(0, id(), h.c.context());
  for (const actor of [0, 1]) {
    const json = JSON.stringify(h.c.viewFor(actor));
    for (const key of ['beforeColors', 'afterColors', 'resultScopes', 'lastMoveResult', 'beforeRevision', 'transactionId']) assert.equal(json.includes(key), false, key);
  }
});
test('movement work replay preserves one receipt and one generation transition', () => {
  const h = setup(); start(h); const context = h.c.context(), request = id();
  h.c.applyPendingWork(0, request, context); const snapshot = h.c.snapshotForCoordinator();
  assert.equal(h.c.applyPendingWork(0, request, context).replayed, true); assert.deepEqual(h.c.snapshotForCoordinator(), snapshot);
  assert.throws(() => h.c.applyPendingWork(0, id(), context));
});
test('post-movement selection wait restores signed memory, rejects forged choices and keeps opponent options hidden', () => {
  const h = setup({ mutate: raw => {
    const s = selector('SELF'); s.excludeSource = false; s.filters = condition('OVERLAP', 'CANDIDATE');
    raw.effects[0].actions.splice(3, 0, { type: 'SELECT', selector: s, bindAs: 'other' });
  } }); start(h); finish(h.c, 0); const q = h.c.viewFor(0).frame.choice;
  assert.equal(q.options.length, 1); assert.deepEqual(h.c.viewFor(1).frame.choice.options, []);
  assert.throws(() => h.c.answer(1, id(), h.c.context(), q.selectionId, []));
  assert.throws(() => h.c.answer(0, id(), h.c.context(), q.selectionId, ['forged']));
  const context = h.c.context(), request = id(), tokens = q.options.map(o => o.token);
  h.c.answer(0, request, context, q.selectionId, tokens);
  assert.equal(h.c.answer(0, request, context, q.selectionId, tokens).replayed, true); finish(h.c, 0);
});
test('Query and Selector reuse the remembered-color evaluator', () => {
  const h = setup({ mutate: raw => { raw.effects[0].actions[3].condition = { type: 'COUNT', op: 'eq', value: 1, query: {
    type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', visibility: 'PUBLIC', faceUpOnly: true,
    cardTypes: ['character'], excludeSource: false, filters: condition('OVERLAP', 'CANDIDATE') } }; } });
  start(h); finish(h.c, 0); assert.equal(h.c.viewFor(0).frame.status, 'completed');
});
test('compiler rejects undeclared, duplicate, out-of-branch memory and invalid MOVE_RESULT placement', () => {
  const h = setup(), raw = h.raw;
  for (const mutate of [r => { r.effects[0].actions.shift(); }, r => { r.effects[0].actions[3].condition.result = 'missing'; },
    r => { r.effects[0].actions[2].bindAs = '__proto__'; },
    r => { r.effects[0].actions.splice(2, 0, { type: 'DRAW', player: 'SELF', count: 1 }); },
    r => { r.effects[0].actions.push(move(), { type: 'MOVE_RESULT', bindAs: 'returned' }); },
    r => { r.effects[0].actions = [{ type: 'IF', condition: always(), then: r.effects[0].actions.slice(0, 3), else: [] }, r.effects[0].actions[3]]; }]) {
    const bad = structuredClone(raw); mutate(bad); assert.throws(() => compileV3CardJson(JSON.stringify(bad)));
  }
});
test('old profiles reject new operations; old Registry24 hash is unchanged', () => {
  const h = setup(), old = structuredClone(h.raw); old.schemaVersion = '3.0.0-subset.24';
  assert.throws(() => compileV3CardJson(JSON.stringify(old)));
  assert.equal(v3RegistryHash(builtinV3Registries('3.0.0-subset.24')), '3780ed0fdeb5c26d43c2f7093e3d767933bfe305094290646fd5943d5cc54af1');
});

function evidence() {
  const h = setup(), before = h.options.movement; trackMovementOccurrences(before);
  const source = h.source, ref = { instanceId: before.players[0].character[0], generation: before.cards[before.players[0].character[0]].generation };
  const identity = { matchId: before.matchId, resolutionId: 'memory-test', actor: 0, source, effectId: 'watch-0' };
  const tx = { transactionId: 'memory-tx', matchId: before.matchId, expectedRevision: before.revision, turnNumber: before.turnNumber, actor: 0, effectController: 0, source,
    mode: 'effect', resolutionId: identity.resolutionId, operations: [{ kind: 'move', card: ref, from: { player: 0, zone: 'character' }, to: { player: 0, zone: 'hand', position: 'append', faceUp: true, rotated: false }, cause: 'EFFECT_MOVE' }] };
  const result = new MovementStore(before).commit(tx, { status: 'certifiedNone' });
  const facts = (state, ref, viewer) => createDerivedCardFactsReader({ board: () => state, definitions: new Map(h.options.cards.map(c => [c.definition.cardId, c])), statEffects: () => [], activePlayer: 0 })(ref, viewer);
  return { before, result, identity, ref, facts, tx };
}
test('forged events, stale requested generation, wrong cause/controller and foreign resolution are refused', () => {
  const h = evidence();
  for (const [result, identity, refs] of [[structuredClone(h.result), h.identity, [h.ref]], [h.result, { ...h.identity, resolutionId: 'other' }, [h.ref]],
    [h.result, { ...h.identity, actor: 1 }, [h.ref]], [h.result, h.identity, [{ ...h.ref, generation: h.ref.generation + 1 }]]])
    assert.throws(() => captureMoveResult(h.before, result, identity, 'work', refs, h.facts));
});
test('current ref is available only to authorized viewer, fixed generation and exact destination', () => {
  const h = evidence(), r = captureMoveResult(h.before, h.result, h.identity, 'work', [h.ref], h.facts);
  const after = r.rows[0].event.after, nextRef = { instanceId: after.instanceId, generation: after.generation };
  assert.deepEqual(currentMovedRef(r, 0, h.result.state, h.identity, 0), nextRef);
  assert.equal(currentMovedRef(r, 0, h.result.state, h.identity, 1), UNKNOWN);
  assert.equal(currentMovedRef(structuredClone(r), 0, h.result.state, h.identity, 0), UNKNOWN);
  assert.equal(currentMovedRef(r, 9, h.result.state, h.identity, 0), UNKNOWN);
  const next = new MovementStore(h.result.state).commit({ ...h.tx, transactionId: 'second-move', expectedRevision: h.result.state.revision,
    operations: [{ kind: 'move', card: nextRef, from: { player: 0, zone: 'hand' }, to: { player: 0, zone: 'trash', position: 'append', faceUp: true, rotated: false }, cause: 'EFFECT_MOVE' }] }, { status: 'certifiedNone' });
  assert.equal(currentMovedRef(r, 0, next.state, h.identity, 0), UNKNOWN);
  assert.deepEqual(rememberedColors(r, h.identity), ['Blue', 'Red']);
  assert.equal(rememberedColors(r, { ...h.identity, resolutionId: 'other' }), UNKNOWN);
});
test('signed resolution frame tampering cannot inject remembered facts', () => {
  const h = setup(); start(h); h.c.applyPendingWork(0, id(), h.c.context());
  const saved = h.c.snapshotForCoordinator().active.frame, envelope = JSON.parse(saved), state = JSON.parse(envelope.payload);
  state.lastMoveResult.rows[0].beforeColors.value = ['FORGED']; envelope.payload = JSON.stringify(state);
  const env = { revision: () => state.worldRevision, now: () => 1000, evaluate: () => true, candidates: () => [] };
  assert.throws(() => V3ResolutionMachine.restore(h.approved, state.identity, h.options.signingKey, env, JSON.stringify(envelope), state.revision), /signature/);
});
test('unknown current colors are not substituted with printed colors or an empty set', () => {
  const h = evidence(), unknown = captureMoveResult(h.before, h.result, h.identity, 'work', [h.ref], () => UNKNOWN);
  assert.equal(unknown.rows[0].beforeColors.status, 'UNKNOWN'); assert.equal(rememberedColors(unknown, h.identity), UNKNOWN);
  const f = h.facts(h.before, h.ref, 0);
  const different = captureMoveResult(h.before, h.result, h.identity, 'work', [h.ref], () => ({ ...f,
    metadata: { ...f.metadata, current: { ...f.metadata.current, colors: ['CURRENT-ONLY'] } } }));
  assert.deepEqual(rememberedColors(different, h.identity), ['CURRENT-ONLY']);
  assert.deepEqual(f.metadata.printed.colors, ['Blue', 'Red']);
});
test('partial or prevented moves cannot generate a result for all requested cards', () => {
  const h = evidence(), other = h.before.cards[h.before.players[0].character[1]], ref = { instanceId: other.instanceId, generation: other.generation };
  assert.throws(() => captureMoveResult(h.before, h.result, h.identity, 'work', [h.ref, ref], h.facts), /missing-or-ambiguous/);
});
test('a stale selected ref cannot follow the card to a new generation in another movement', () => {
  const h = setup({ mutate: raw => { raw.effects[0].actions.splice(3, 0, move('trash')); } });
  start(h); h.c.applyPendingWork(0, id(), h.c.context()); const first = h.c.snapshotForCoordinator().movement;
  h.c.advance(0, id(), h.c.context()); h.c.applyPendingWork(0, id(), h.c.context());
  assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(h.c.snapshotForCoordinator().movement, first);
});
test('moving an opponent card does not grant access to its destination hand', () => {
  const h = setup({ owner: 'OPPONENT', mutate: raw => { raw.effects[0].actions[1].destination.owner = 'OPPONENT'; } }); start(h);
  h.c.applyPendingWork(0, id(), h.c.context()); const r = frame(h.c).lastMoveResult;
  assert.deepEqual(r.rows[0].beforeColors.value, ['Blue', 'Red']); assert.equal(r.rows[0].afterColors.status, 'UNKNOWN');
  finish(h.c, 0); assert.equal(h.c.viewFor(0).frame.status, 'completed');
});
test('memory ownership cannot cross match, effect or resolution boundaries', () => {
  const h = evidence(), r = captureMoveResult(h.before, h.result, h.identity, 'work', [h.ref], h.facts);
  for (const change of [{ matchId: 'foreign-match' }, { effectId: 'other-effect' }, { resolutionId: 'other-resolution' }, { actor: 1 }, { source: { ...h.identity.source, generation: h.identity.source.generation + 1 } }]) {
    assert.equal(rememberedColors(r, { ...h.identity, ...change }), UNKNOWN);
    assert.equal(currentMovedRef(r, 0, h.result.state, { ...h.identity, ...change }, 0), UNKNOWN);
  }
});
test('all, any and not preserve UNKNOWN from unavailable remembered facts', () => {
  for (const wrap of [p => ({ type: 'all', conditions: [p] }), p => ({ type: 'any', conditions: [p] }), p => ({ type: 'not', condition: p })]) {
    const h = setup({ from: 'hand', mutate: raw => { raw.effects[0].actions[1].destination.zone = 'trash'; raw.effects[0].actions[3].condition = wrap(condition()); } });
    start(h); h.c.applyPendingWork(0, id(), h.c.context()); assert.throws(() => finish(h.c, 0), /unknown-predicate/);
  }
});
