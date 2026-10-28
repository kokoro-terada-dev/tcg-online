const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EffectCatalog, parseEffectCatalog, EFFECT_CATALOG_LIMITS } = require('../dist/test/effects/effectCatalog.js');
const { EffectMatchOwner } = require('../dist/test/effects/effectMatchOwner.js');
const { createMatch } = require('../dist/test/game.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const def = (effectId = 'TEST.draw', cardId = 'LEADER') => ({ dslVersion: 1, effectId, cardId, trigger: { kind: 'activate', window: 'main' }, costs: [], actions: [{ kind: 'draw', player: 'SELF', amount: 1 }] });
function setup(catalog, actor = 0) {
  const deck = { name: 'Test', leaderCardId: 'LEADER', mainDeck: Array(50).fill('CHAR'), donDeck: Array(10).fill('DON'), cardTypes: { CHAR: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(deck, deck), owner = new EffectMatchOwner(match, catalog); let p = createProgression(actor);
  while (true) { p = applySystemEvent(p, p.revision, { kind: 'settlePhase', phaseToken: p.phaseToken }); if (p.phase === 'main') break; p = applySystemEvent(p, p.revision, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
  owner.adopt(p); return { owner, match, source: { instanceId: match.players[actor].zones.leader[0].id, generation: 0 } };
}
test('catalog validates and pins definitions; input order does not change content version or listings', () => {
  const a = def('TEST.a'), b = def('TEST.b'), catalog = new EffectCatalog([a, b]);
  const reversed = new EffectCatalog([def('TEST.b'), def('TEST.a')]);
  assert.equal(catalog.version, reversed.version); assert.deepEqual(catalog.listForCard('LEADER'), reversed.listForCard('LEADER'));
  a.actions[0].amount = 100; assert.equal(catalog.resolve('TEST.a', 'LEADER').actions[0].amount, 1);
  assert.equal(Object.isFrozen(catalog.resolve('TEST.a', 'LEADER').actions), true); assert.throws(() => JSON.stringify(catalog), /server-only/);
});
test('missing effects and card mismatches never fall back to another definition', () => {
  const catalog = new EffectCatalog([def()]); assert.equal(catalog.resolve('missing', 'LEADER'), null); assert.equal(catalog.resolve('TEST.draw', 'CHAR'), null);
  assert.deepEqual(catalog.listForCard('missing'), []); assert.equal(catalog.listForCard('LEADER')[0].status, 'schemaOnly');
});
test('duplicate IDs, invalid definitions, unsafe values and size limits are rejected', () => {
  assert.throws(() => new EffectCatalog([def(), def()]), /duplicate/);
  assert.throws(() => new EffectCatalog([{ ...def(), actions: [{ kind: 'executeCode', code: 'unsafe' }] }]));
  assert.throws(() => new EffectCatalog(Array(EFFECT_CATALOG_LIMITS.definitions + 1)));
  let reads = 0; const bad = def(); Object.defineProperty(bad, 'actions', { enumerable: true, get() { reads++; return []; } });
  assert.throws(() => new EffectCatalog([bad])); assert.equal(reads, 0);
  assert.throws(() => parseEffectCatalog(' '.repeat(EFFECT_CATALOG_LIMITS.bytes + 1)), /byte-limit/);
});
test('JSON envelope is versioned and explicit; changed definitions change the version', () => {
  const catalog = parseEffectCatalog(JSON.stringify({ catalogVersion: 1, definitions: [def()] })); assert.equal(catalog.version, new EffectCatalog([def()]).version);
  assert.throws(() => parseEffectCatalog(JSON.stringify({ catalogVersion: 2, definitions: [] })), /version/);
  assert.throws(() => parseEffectCatalog(JSON.stringify({ catalogVersion: 1, definitions: [], ignored: true })));
  const changed = def(); changed.actions[0].amount = 2; assert.notEqual(new EffectCatalog([changed]).version, catalog.version);
});
test('registered effects run for either authenticated seat with server-generated resolution IDs', () => {
  for (const actor of [0, 1]) {
    const catalog = new EffectCatalog([def()]), { owner, source } = setup(catalog, actor);
    const resolutionId = owner.openRegisteredEffect('TEST.draw', actor, source, { status: 'certifiedNone' });
    assert.match(resolutionId, /^[a-f0-9-]{36}$/); assert.equal(owner.snapshot().catalogVersion, catalog.version);
    for (const [i, kind] of ['start', 'advance'].entries()) {
      const v = owner.effectViewFor(actor); assert.equal(owner.handleEffect(actor, { kind, matchId: v.matchId, resolutionId, requestId: `request-${i}`, expectedMovementRevision: v.movement.revision, expectedProgressionRevision: v.progression.revision }).ok, true);
    }
    owner.finishEffect(); assert.equal(owner.snapshot().movement.players[actor].hand.length, 6);
    assert.notEqual(owner.openRegisteredEffect('TEST.draw', actor, source, { status: 'certifiedNone' }), resolutionId);
  }
});
test('unregistered, wrong-card, stale-generation and wrong-owner activations never change the board', () => {
  const { owner, source, match } = setup(new EffectCatalog([def(), def('CHAR.only', 'CHAR')])), before = owner.snapshot().movement;
  for (const [id, actor, ref] of [['missing', 0, source], ['CHAR.only', 0, source], ['TEST.draw', 0, { ...source, generation: 1 }], ['TEST.draw', 1, source], ['TEST.draw', 0, { instanceId: match.players[0].zones.hand[0].id, generation: 0 }]]) assert.throws(() => owner.openRegisteredEffect(id, actor, ref, { status: 'certifiedNone' }));
  assert.equal(owner.snapshot().movement, before); assert.equal(owner.snapshot().activeResolutionId, null);
});
test('schema-only unsupported commands are not promoted to executable by catalog registration', () => {
  const d = def(); d.actions = [{ kind: 'modify', modifier: { kind: 'power', target: { kind: 'ref', from: 'SOURCE', field: 'id' }, amount: 1000 }, duration: { kind: 'thisTurn' } }];
  const catalog = new EffectCatalog([d]), { owner, source } = setup(catalog);
  assert.equal(catalog.listForCard('LEADER')[0].status, 'schemaOnly');
  assert.throws(() => owner.openRegisteredEffect(d.effectId, 0, source, { status: 'certifiedNone' }), /unsupported/);
  assert.equal(owner.snapshot().movement.revision, 0);
});
