const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { V3FixtureCoordinator } = require('../dist/test/effects/v3/fixtureCoordinator.js');
const { setup, definition, always } = require('./helpers/v3-event.cjs');
const use = (c, actor, e, id = 'use', context = c.context()) => c.useMainEvent(actor, id, context, e.sourceToken, e.effectId);

for (const actor of [0, 1]) for (const cost of [0, 2, 3]) test(`atomic MAIN event supports exact/zero payment and rejects shortage (seat=${actor}, cost=${cost})`, () => {
  const { c } = setup({ actor, cost }), e = c.mainEventChoicesFor(actor)[0], before = c.snapshotForCoordinator();
  assert.equal(c.mainEventChoicesFor(1 - actor).length, 0); assert.equal(e.enabled, cost <= 2);
  if (cost > 2) { assert.throws(() => use(c, actor, e)); assert.deepEqual(c.snapshotForCoordinator(), before); return; }
  const context = c.context(); use(c, actor, e); const after = c.snapshotForCoordinator();
  assert.equal(c.context().revision, context.revision + 1); assert.equal(after.movement.players[actor].hand.length, 5);
  assert.equal(after.movement.players[actor].trash.length, 1); assert.equal(after.movement.players[actor].restDon.length, cost);
  assert.equal(after.movement.cards[e.source.instanceId].generation, e.source.generation + 1); assert.equal(after.movement.cards[e.source.instanceId].faceUp, true);
  assert.equal(c.viewFor(actor).frame.status, 'completed'); assert.deepEqual(after.movement.reveals, []);
  const event = after.ruleEvents.findIndex(event => event.kind === 'moved' && event.after.instanceId === e.source.instanceId);
  assert.equal(after.ruleEvents[0].kind, 'revealed'); assert.equal(after.ruleEvents.slice(1, event).every(e => e.kind === 'restChanged' && e.cause.kind === 'COST_PAYMENT'), true);
  assert.equal(after.ruleEvents.slice(event + 1).every(e => e.kind === 'moved' && e.cause.kind === 'EFFECT_MOVE'), true);
  assert.equal(use(c, actor, e, 'use', context).replayed, true); assert.deepEqual(c.snapshotForCoordinator(), after);
  assert.throws(() => use(c, actor, e, 'new-id', context)); assert.throws(() => use(c, actor, e, 'use', c.context()));
  const seen = c.viewFor(1 - actor).movement.players[actor]; assert.equal(seen.hand.every(card => card.cardId === null && card.ref === null), true);
  assert.equal(seen.trash[0].cardId, e.cardId);
});

test('same-number copies are separate tokens; wrong effect, owner, match and forged tokens are refused', () => {
  const { c } = setup({ cost: 0 }), choices = c.mainEventChoicesFor(0), before = c.snapshotForCoordinator(), other = setup().c;
  assert.equal(choices.length, 5); assert.equal(new Set(choices.map(e => e.sourceToken)).size, 5); assert.equal(new Set(choices.map(e => e.cardId)).size, 1);
  for (const [actor, token, effect] of [[1, choices[0].sourceToken, 'main'], [0, '0'.repeat(64), 'main'], [0, choices[0].sourceToken, 'counter'], [0, other.mainEventChoicesFor(0)[0].sourceToken, 'main']]) {
    assert.throws(() => c.useMainEvent(actor, 'bad', c.context(), token, effect)); assert.deepEqual(c.snapshotForCoordinator(), before);
  }
  use(c, 0, choices[0]); assert.throws(() => use(c, 0, choices[0], 'stale-token')); assert.equal(c.mainEventChoicesFor(0).some(e => e.source.instanceId === choices[0].source.instanceId), false);
  const second = c.mainEventChoicesFor(0).find(e => e.source.instanceId === choices[1].source.instanceId); assert.equal(second.enabled, true);
  use(c, 0, second, 'second-copy'); assert.equal(c.viewFor(0).movement.players[0].trash.length, 2);
});

test('compiler pins new profile and rejects old schemas, choices, extra costs, optionality and unresolved conditions', () => {
  const d = definition(); const p = compileV3CardJson(JSON.stringify(d)); assert.equal(p.compilerVersion, 'v3-subset-compiler.19.1');
  assert.equal(p.registryHash, v3RegistryHash(builtinV3Registries('3.0.0-subset.18')));
  for (const version of [16, 17, 18]) { const x = structuredClone(d); x.schemaVersion = `3.0.0-subset.${version}`; assert.throws(() => compileV3CardJson(JSON.stringify(x))); }
  for (const patch of [e => { e.optional = true; }, e => { e.costs = [{ type: 'REST_DON', count: 1 }]; },
    e => { e.actions = [{ type: 'DRAW', player: 'OPPONENT', count: 1 }]; }, e => { e.actions = [{ type: 'BIND_SOURCE', bindAs: 'self' }]; },
    e => { e.resolutionConditions = { type: 'compare', left: 1, op: 'eq', right: 1 }; }, e => { e.actions = [{ type: 'SEQUENCE', actions: [] }]; },
    e => { e.actions = [{ type: 'DRAW', player: 'SELF', count: 50 }, { type: 'DRAW', player: 'SELF', count: 1 }]; },
    e => { e.actions = [{ type: 'IF', condition: always(), then: e.actions, else: [] }]; }]) {
    const x = structuredClone(d); patch(x.effects[0]); assert.throws(() => compileV3CardJson(JSON.stringify(x)));
  }
});

test('counter-only, unknown costs, opponent turn and battle timing never enter MAIN candidates', () => {
  assert.equal(setup({ mutate: d => { d.effects[0].timing.type = 'COUNTER'; } }).c.mainEventChoicesFor(0).length, 0);
  assert.equal(setup({ cost: null }).c.mainEventChoicesFor(0).length, 0);
  const { c, options } = setup(), old = c.mainEventChoicesFor(0)[0];
  assert.throws(() => new V3FixtureCoordinator({ mode: 'syntheticNoAbilities', card: options.cards[0], definitions: options.cards,
    identity: { matchId: options.movement.matchId, resolutionId: 'unauthorized-direct', effectId: old.effectId, actor: 0, source: old.source },
    movement: options.movement, progression: options.progression, signingKey: options.signingKey, master: null }), /authorization/);
  c.endTurn(0, 'end', c.context());
  assert.equal(c.mainEventChoicesFor(0).length, 0); assert.throws(() => use(c, 0, old));
  c.endTurn(1, 'back', c.context()); const e = c.mainEventChoicesFor(0)[0], attacks = c.attackChoicesFor(0);
  c.attack(0, 'attack', c.context(), attacks.sources[0].card, attacks.targets[0].card);
  assert.equal(c.mainEventChoicesFor(0).length, 0); assert.throws(() => use(c, 0, e));
});

test('invalid state after an earlier private draft draw leaves no declaration, payment or partial result', () => {
  const { c } = setup({ mutate: d => { d.effects[0].actions = [{ type: 'SEQUENCE', actions: [{ type: 'DRAW', player: 'SELF', count: 1 }, { type: 'DRAW', player: 'SELF', count: 1 }] }]; } });
  const e = c.mainEventChoicesFor(0)[0], before = c.snapshotForCoordinator(), method = V3FixtureCoordinator.prototype.applyPendingWork;
  let calls = 0;
  V3FixtureCoordinator.prototype.applyPendingWork = function(...args) { if (++calls === 2) throw Error('injected-second-work-failure'); return method.apply(this, args); };
  try { assert.throws(() => use(c, 0, e), /injected/); } finally { V3FixtureCoordinator.prototype.applyPendingWork = method; }
  assert.equal(calls, 2); assert.deepEqual(c.snapshotForCoordinator(), before);
  use(c, 0, e); assert.equal(c.viewFor(0).movement.players[0].hand.length, 6);
});

test('a hand card moved before use cannot retain its token or generation authority', () => {
  const s = setup(), e = s.c.mainEventChoicesFor(0)[0], movement = structuredClone(s.options.movement);
  movement.players[0].hand.shift(); movement.players[0].trash.push(e.source.instanceId); movement.cards[e.source.instanceId].generation++; movement.cards[e.source.instanceId].faceUp = true;
  const c = new V3SyntheticMatchCoordinator({ ...s.options, movement });
  assert.equal(c.mainEventChoicesFor(0).some(row => row.source.instanceId === e.source.instanceId), false); assert.throws(() => use(c, 0, e));
});

test('deck-out uses the shared outcome path and keeps the used event in trash', () => {
  const s = setup(), movement = structuredClone(s.options.movement), kept = movement.players[0].deck.splice(1);
  movement.players[0].trash.push(...kept); for (const id of kept) movement.cards[id].faceUp = true;
  const c = new V3SyntheticMatchCoordinator({ ...s.options, movement }); use(c, 0, c.mainEventChoicesFor(0)[0]);
  assert.equal(c.viewFor(0).outcome.winner, 1); assert.equal(c.viewFor(0).frame.status, 'completed'); assert.equal(c.mainEventChoicesFor(0).length, 0);
});

test('all 14 real approvals remain pinned and cannot be reused for schema19', () => {
  const { loadReviewedV3Catalog } = require('../dist/test/effects/v3/reviewedCatalog.js');
  const loaded = loadReviewedV3Catalog(); assert.equal(loaded.cards.length, 14);
  for (const original of loaded.cards) {
    assert.equal(original.definition.schemaVersion, '3.0.0-subset.16');
    const d = structuredClone(original.definition); d.schemaVersion = '3.0.0-subset.19'; const compiled = compileV3CardJson(JSON.stringify(d));
    assert.throws(() => new ApprovedV3Catalog([compiled], [original.approval], original.rulesetVersion));
  }
});
