const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { createMatch, applyCommand } = require('../dist/test/game.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const rules = { status: 'certifiedNone' };
const recipe = () => ({ name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHAR'), donDeck: Array(10).fill('DON'), cardTypes: { CHAR: 'character' }, leaderLifeCount: 5 });
function setup(actor = 0) {
  const match = createMatch(recipe(), recipe()), owner = new EffectMatchOwner(match); let p = createProgression(actor);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  return { match, owner, p, actor };
}
function definition(actions = [], cardId = 'LEADER') { return { dslVersion: 1, effectId: 'test', cardId, trigger: { kind: 'activate', window: 'main' }, costs: [], actions }; }
function open(s, resolutionId = 'r', actions = [], guard = rules, source) {
  const id = source ?? { instanceId: s.match.players[s.actor].zones.leader[0].id, generation: 0 };
  s.owner.openEffect({ resolutionId, actor: s.actor, source: id }, definition(actions, source ? 'CHAR' : 'LEADER'), guard);
}
function send(s, kind, requestId) {
  const v = s.owner.effectViewFor(s.actor), c = { kind, requestId, matchId: v.matchId, resolutionId: v.effect.resolutionId,
    expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision };
  if (kind === 'answerEffect') { c.selectionId = v.selection.selectionId; c.tokens = [v.selection.candidates[0].token]; }
  return s.owner.handleEffect(s.actor, c);
}
const select = zone => ({ kind: 'select', saveAs: 'selected', selector: { kind: 'cards', chooser: 'SELF', owner: 'SELF', zones: [zone], min: 1, max: 1, mode: 'SELECT' } });
const move = zone => ({ kind: 'move', cards: { kind: 'ref', from: 'VARIABLE', name: 'selected' }, destination: { owner: 'SELF', zone, position: zone === 'character' ? 'firstEmpty' : 'append', visibility: 'faceUp' }, cause: 'EFFECT_MOVE' });
test('legacy commands work before adoption and are disabled permanently afterward', () => {
  const s = setup();
  assert.equal(s.owner.applyLegacyCommand(0, { kind: 'draw', matchId: s.match.id, requestId: 'draw', expectedRevision: 0 }), null);
  s.owner.adopt(s.p); const before = structuredClone(s.match);
  assert.throws(() => s.owner.applyLegacyCommand(0, { kind: 'draw', matchId: s.match.id, requestId: 'draw2', expectedRevision: 1 }), /disabled/);
  assert.deepEqual(s.match, before); assert.equal(s.owner.snapshot().movement.players[0].hand.length, 6);
  assert.throws(() => s.owner.adopt(s.p), /cannot-adopt/);
});
test('successive effects preserve generations, board and revisions for either player', () => {
  for (const actor of [0, 1]) {
    const s = setup(actor), before = structuredClone(s.match); s.owner.adopt(s.p);
    open(s, 'first', [select('hand'), move('character')]);
    for (const [kind, id] of [['start', 'a'], ['advance', 'b'], ['answerEffect', 'c'], ['advance', 'd']]) assert.equal(send(s, kind, id).ok, true);
    s.owner.finishEffect(); const board = s.owner.snapshot().movement, character = board.players[actor].character[0];
    assert.equal(board.cards[character].generation, 1);
    open(s, 'second', [select('character'), move('trash')], rules, { instanceId: character, generation: 1 });
    for (const [kind, id] of [['start', 'a'], ['advance', 'b'], ['answerEffect', 'c'], ['advance', 'd']]) assert.equal(send(s, kind, id).ok, true);
    s.owner.finishEffect(); const after = s.owner.snapshot();
    assert.equal(after.movement.cards[character].generation, 2); assert.deepEqual(after.movement.players[actor].trash, [character]);
    assert.ok(after.movement.revision > board.revision); assert.deepEqual(s.match, before);
    assert.throws(() => JSON.stringify(s.owner), /server-only/);
  }
});
test('one owner cannot open overlapping effects or reuse completed resolution IDs', () => {
  const s = setup(); s.owner.adopt(s.p); open(s);
  assert.throws(() => open(s, 'other'), /cannot-open/);
  send(s, 'start', 'start'); s.owner.finishEffect();
  assert.throws(() => open(s), /id-used-or-limit/); open(s, 'new');
});
test('prepared effects may be discarded without reviving old commands or old IDs', () => {
  const s = setup(); s.owner.adopt(s.p); open(s, 'old'); const v = s.owner.effectViewFor(0);
  s.owner.discardPreparedEffect(); open(s, 'new');
  const stale = s.owner.handleEffect(0, { kind: 'start', requestId: 'late', matchId: v.matchId, resolutionId: 'old', expectedMovementRevision: 0, expectedProgressionRevision: v.progression.revision });
  assert.equal(stale.code, 'wrong_context'); assert.equal(s.owner.snapshot().movement.revision, 0);
});
test('pending or failed effects cannot be forcibly finished or discarded', () => {
  const s = setup(); s.owner.adopt(s.p); open(s, 'r', [select('hand')]); send(s, 'start', 'a'); send(s, 'advance', 'b');
  assert.throws(() => s.owner.finishEffect(), /not-complete/); assert.throws(() => s.owner.discardPreparedEffect(), /already-started/);
  assert.throws(() => open(s, 'other'), /cannot-open/);
});
test('direct legacy writes are detected before another effect command executes', () => {
  const s = setup(); s.owner.adopt(s.p); open(s);
  applyCommand(s.match, 0, { kind: 'draw', matchId: s.match.id, requestId: 'bypass', expectedRevision: 0 });
  const result = s.owner.handleEffect(0, {});
  assert.deepEqual(result, { ok: false, code: 'legacy_conflict' }); assert.equal(s.owner.snapshot().mode, 'faulted');
  assert.equal(s.owner.snapshot().movement.revision, 0); assert.equal(s.owner.effectViewFor(0), null);
});
test('conflicts during rule evaluation retain the actual committed effect state and stop future writes', () => {
  const s = setup(); s.owner.adopt(s.p);
  open(s, 'r', [{ kind: 'draw', player: 'SELF', amount: 1 }], { status: 'evaluate', check() {
    assert.throws(() => s.owner.applyLegacyCommand(0, {}), /disabled/);
    applyCommand(s.match, 0, { kind: 'draw', matchId: s.match.id, requestId: 'bypass', expectedRevision: 0 });
    return { kind: 'allow' };
  } });
  send(s, 'start', 'a'); const result = send(s, 'advance', 'b');
  assert.equal(result.code, 'legacy_conflict'); assert.equal(s.owner.snapshot().mode, 'faulted');
  assert.equal(s.owner.snapshot().movement.revision, 2); assert.equal(s.match.revision, 1);
  assert.deepEqual(s.owner.handleEffect(0, {}), { ok: false, code: 'owner_unavailable' });
});
test('adoption rejects incomplete checkpoints and cannot infer battle state', () => {
  const s = setup(); assert.throws(() => s.owner.adopt(createProgression(0)), /settled-main/);
  s.match.attack = { actor: 0, sourceId: s.match.players[0].zones.leader[0].id, targetId: s.match.players[1].zones.leader[0].id };
  assert.throws(() => s.owner.adopt(s.p), /attack-needs-progression/); assert.equal(s.owner.snapshot().mode, 'legacy');
});
test('closing prevents all operations and keeps the latest server snapshot for diagnostics', () => {
  const s = setup(); s.owner.adopt(s.p); open(s); send(s, 'start', 'a'); const before = s.owner.snapshot().movement;
  s.owner.close(); s.owner.close(); assert.equal(s.owner.snapshot().movement, before); assert.equal(s.owner.snapshot().mode, 'closed');
  assert.equal(s.owner.effectViewFor(0), null); assert.equal(s.owner.handleEffect(0, {}).code, 'owner_unavailable');
  assert.throws(() => s.owner.applyLegacyCommand(0, {})); assert.throws(() => open(s, 'new'));
});
test('public views are per player; unknown seats never receive private data', () => {
  const s = setup(); s.owner.adopt(s.p); open(s);
  assert.equal(s.owner.effectViewFor(0).movement.players[0].hand[0].cardId, 'CHAR');
  assert.equal(s.owner.effectViewFor(1).movement.players[0].hand[0].cardId, null);
  assert.throws(() => s.owner.effectViewFor(2)); assert.throws(() => s.owner.handleEffect(null, {}));
});
