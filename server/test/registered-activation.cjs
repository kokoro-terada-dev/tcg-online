const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatch } = require('../dist/test/game.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { EffectCatalog } = require('../dist/test/effects/effectCatalog.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { OwnedEffectEndpoint } = require('../dist/test/effects/ownedEffectEndpoint.js');
const definition = (effectId = 'TEST.draw', cardId = 'LEADER') => ({ dslVersion: 1, effectId, cardId, trigger: { kind: 'activate', window: 'main' }, costs: [], actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] });
function setup(actor = 0, enabled = true, extra = []) {
  const recipe = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHAR'), donDeck: Array(10).fill('DON'), cardTypes: { CHAR: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe), catalog = new EffectCatalog([definition(), definition('CHAR.only', 'CHAR'), ...extra]);
  const owner = new EffectMatchOwner(match, catalog, enabled); let p = createProgression(actor);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  owner.adopt(p); const source = { instanceId: match.players[actor].zones.leader[0].id, generation: 0 };
  owner.openRegisteredEffect('TEST.draw', actor, source, { status: 'certifiedNone' });
  const endpoint = new OwnedEffectEndpoint(owner);
  function command(patch = {}) { const v = endpoint.viewFor(actor); return { kind: 'activateRegistered', matchId: v.matchId, resolutionId: v.effect.resolutionId, requestId: 'activate', expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision, source: { ...source }, effectId: 'TEST.draw', catalogVersion: catalog.version, ...patch }; }
  function step(kind, requestId = kind) { const v = endpoint.viewFor(actor); return endpoint.handle(actor, { kind, requestId, matchId: v.matchId, resolutionId: v.effect.resolutionId, expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision }); }
  return { owner, endpoint, command, step, source, match, actor };
}
test('registered activation starts cost planning for either seat without paying or moving a card', () => {
  for (const actor of [0, 1]) {
    const s = setup(actor), before = s.owner.snapshot(), c = s.command(), r = s.endpoint.handle(actor, c);
    assert.equal(r.ok, true); assert.equal(r.view.effect.status, 'costsReady'); assert.notEqual(r.view.effect.resolutionId, c.resolutionId);
    assert.deepEqual(s.owner.snapshot().movement, before.movement); assert.equal(r.view.movement.players[actor].hand.length, 5);
    assert.equal(s.step('commitCosts').ok, true); assert.equal(s.step('advance').ok, true);
    assert.equal(s.endpoint.viewFor(actor).movement.players[actor].hand.length, 6);
    assert.equal(s.endpoint.viewFor(1 - actor).movement.players[actor].hand.every(c => c.cardId === null), true);
    const next = s.endpoint.handle(actor, s.command({ requestId: 'next' })); assert.equal(next.ok, true);
  }
});
test('duplicate activation is replayed across completion without replacing the current runtime', () => {
  const s = setup(), c = s.command(), first = s.endpoint.handle(0, c), replay = s.endpoint.handle(0, c);
  assert.equal(replay.replayed, true); assert.equal(replay.view.effect.resolutionId, first.view.effect.resolutionId);
  assert.equal(s.endpoint.handle(0, { ...c, source: { generation: c.source.generation, instanceId: c.source.instanceId } }).replayed, true);
  s.step('commitCosts'); s.step('advance'); const before = s.owner.snapshot();
  assert.equal(s.endpoint.handle(0, c).replayed, true); assert.equal(s.owner.snapshot().movement, before.movement);
  assert.equal(s.endpoint.handle(0, { ...c, effectId: 'other' }).code, 'request_conflict');
  const next = s.endpoint.handle(0, s.command({ requestId: 'next' })); assert.equal(next.ok, true);
  assert.equal(s.endpoint.handle(0, c).view.effect.resolutionId, next.view.effect.resolutionId);
});
test('bad context, registration, ownership, generation and timing leave the old runtime unchanged', () => {
  const s = setup(); let i = 0;
  const before = s.owner.snapshot();
  for (const patch of [{ matchId: 'other' }, { resolutionId: 'old' }, { expectedMovementRevision: 99 }, { expectedProgressionRevision: 99 }, { catalogVersion: 'other' }, { effectId: 'missing' }, { effectId: 'CHAR.only' }, { source: { ...s.source, generation: 1 } }, { source: { instanceId: s.match.players[1].zones.leader[0].id, generation: 0 } }, { source: { instanceId: s.match.players[0].zones.hand[0].id, generation: 0 } }]) {
    assert.equal(s.endpoint.handle(0, s.command({ ...patch, requestId: `bad-${i++}` })).ok, false);
    assert.equal(s.owner.snapshot().movement, before.movement); assert.equal(s.owner.snapshot().progression, before.progression); assert.equal(s.owner.snapshot().activeResolutionId, before.activeResolutionId);
  }
  assert.equal(s.endpoint.handle(1, s.command()).ok, false);
});
test('server opt-in is required and non-activate triggers cannot be selected', () => {
  const disabled = setup(0, false); assert.equal(disabled.endpoint.handle(0, disabled.command()).ok, false);
  const s = setup(0, true, [{ ...definition('TEST.event'), trigger: { kind: 'event', event: 'onPlay' } }, { ...definition('TEST.counter'), trigger: { kind: 'activate', window: 'counter' } }]);
  for (const id of ['TEST.event', 'TEST.counter']) assert.equal(s.endpoint.handle(0, s.command({ requestId: id, effectId: id })).ok, false);
});
test('cost selection and resolving effects cannot be replaced', () => {
  const s = setup(); assert.equal(s.endpoint.handle(0, s.command()).ok, true);
  const id = s.owner.snapshot().activeResolutionId;
  assert.equal(s.endpoint.handle(0, s.command({ requestId: 'during-costs' })).ok, false);
  s.step('commitCosts'); assert.equal(s.endpoint.handle(0, s.command({ requestId: 'during-resolution' })).ok, false);
  assert.equal(s.owner.snapshot().activeResolutionId, id);
});
test('failed conditions and unsupported actions never discard the previous effect', () => {
  const falseCondition = { kind: 'compare', operator: 'EQ', left: { kind: 'literal', value: 0 }, right: { kind: 'literal', value: 1 } };
  const unsupported = { kind: 'modify', modifier: { kind: 'power', target: { kind: 'ref', from: 'SOURCE', field: 'id' }, amount: 1000 }, duration: { kind: 'thisTurn' } };
  const s = setup(0, true, [{ ...definition('TEST.false'), condition: falseCondition }, { ...definition('TEST.unsupported'), actions: [unsupported] }]);
  const before = s.owner.snapshot();
  for (const id of ['TEST.false', 'TEST.unsupported']) assert.equal(s.endpoint.handle(0, s.command({ requestId: id, effectId: id })).ok, false);
  assert.equal(s.owner.snapshot().activeResolutionId, before.activeResolutionId); assert.equal(s.owner.snapshot().progression, before.progression);
  assert.equal(s.step('start').ok, true);
});
test('extra authority fields and accessors are rejected without invoking getters', () => {
  const s = setup(); assert.equal(s.endpoint.handle(0, s.command({ actor: 1 })).code, 'invalid_command');
  let reads = 0; const c = s.command(); Object.defineProperty(c.source, 'generation', { enumerable: true, get() { reads++; return 0; } });
  assert.equal(s.endpoint.handle(0, c).code, 'invalid_command'); assert.equal(reads, 0);
});
test('activation receipts have a per-player bounded limit', () => {
  const s = setup();
  for (let i = 0; i < 1024; i++) assert.equal(s.endpoint.handle(0, s.command({ requestId: `bad-${i}`, effectId: 'missing' })).ok, false);
  assert.equal(s.endpoint.handle(0, s.command()).code, 'request_limit');
});
