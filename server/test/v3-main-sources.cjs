const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const always = () => ({ type: 'all', conditions: [] });
let sequence = 0;
const request = () => `main-${++sequence}`;
function setup({ actor = 0, mutate = () => {} } = {}) {
  const plans = ['leader', 'character', 'stage'].map(kind => {
    const id = `MAIN-${kind}`, d = { schemaVersion: '3.0.0-subset.16', cardId: id, cardVersion: 'synthetic.1', name: '同名テスト', cardType: kind,
      baseStats: { cost: kind === 'leader' ? null : 1, power: kind === 'stage' ? null : 5000, counter: kind === 'character' ? 1000 : null, life: kind === 'leader' ? 5 : null },
      colors: [], traits: [], attributes: [], keywords: [], reviewStatus: 'approved', source: { text: 'Synthetic MAIN fixture only; not a real card or ruling.', triggerText: '', displayIds: [id], datasetSha256: '0'.repeat(64) },
      effects: [{ id: 'main', kind: 'activated', timing: { type: 'MAIN' }, sourceZones: [kind], optional: false, usageLimit: { type: 'PER_TURN', scope: 'SOURCE_OBJECT', count: 1 },
        activationConditions: always(), resolutionConditions: always(), costs: kind === 'leader' ? [] : [{ type: 'REST_SOURCE' }], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }] };
    mutate(d, kind); return compileV3CardJson(JSON.stringify(d));
  });
  const rulesetVersion = 'main-source-fixture.1', catalog = new ApprovedV3Catalog(plans, plans.map(p => ({ status: 'approved', cardId: p.definition.cardId,
    cardVersion: p.definition.cardVersion, compilerVersion: p.compilerVersion, registryHash: p.registryHash, definitionHash: p.definitionHash, sourceHash: p.sourceHash,
    rulesetVersion, reviewer: 'synthetic-test-only', approvedAt: '2026-10-30T00:00:00.000Z', ruleEvidence: ['synthetic-only:not-official-card-approval'] })), rulesetVersion);
  const recipe = { name: 'Synthetic MAIN', leaderCardId: 'MAIN-leader', mainDeck: Array(50).fill('MAIN-character'), donDeck: Array(10).fill('DON'), cardTypes: { 'MAIN-character': 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe);
  for (const player of match.players) {
    const z = player.zones;
    for (let i = 0; i < 2; i++) z.character[i] = { ...z.deck.shift(), faceUp: true, rotated: false };
    z.stage[0] = { ...z.deck.shift(), cardId: 'MAIN-stage', kind: 'stage', faceUp: true, rotated: false };
    for (let i = 0; i < 2; i++) z.activeDon.push({ ...z.donDeck.shift(), faceUp: true, rotated: false });
  }
  let progression = createProgression(actor);
  while (true) { progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') break; progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken }); }
  const options = { mode: 'syntheticNoAbilities', movement: new MatchMovementCapture(match, 1).snapshot().movement, progression,
    cards: plans.map(p => catalog.get(p.definition.cardId)), signingKey: Buffer.alloc(32, 48), master: null, now: () => 1000 };
  return { c: new V3SyntheticMatchCoordinator(options), options };
}
function complete(c, actor) {
  for (let i = 0; i < 20; i++) {
    const frame = c.viewFor(actor).frame;
    if (frame.status === 'completed') return;
    if (frame.status === 'ready') c.advance(actor, request(), c.context());
    else if (frame.status === 'waitingForWork') c.applyPendingWork(actor, request(), c.context());
    else { const choice = frame.choice; c.answer(actor, request(), c.context(), choice.selectionId, choice.options.slice(0, choice.min).map(o => o.token)); }
  }
  throw Error('Incomplete MAIN resolution');
}
const choice = (c, actor, zone, slot = 0) => c.mainEffectsFor(actor).find(e => e.zone === zone && e.slot === slot);
const activate = (c, actor, e, id = request(), context = c.context()) => c.activateMain(actor, id, context, e.sourceToken, e.effectId);

for (const actor of [0, 1]) for (const zone of ['leader', 'character', 'stage']) test(`MAIN identifies and resolves ${zone} source for seat ${actor}`, () => {
  const { c } = setup({ actor }), e = choice(c, actor, zone), before = c.viewFor(actor).movement.players[actor].hand.length;
  assert.equal(e.enabled, true); assert.equal(e.source.generation, 0); assert.match(e.sourceToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(c.mainEffectsFor(actor), c.mainEffectsFor(actor));
  const context = c.context(), id = request(); activate(c, actor, e, id, context);
  assert.equal(activate(c, actor, e, id, context).replayed, true);
  assert.equal(c.mainEffectsFor(actor).every(e => !e.enabled), true);
  complete(c, actor); assert.equal(c.viewFor(actor).movement.players[actor].hand.length, before + 1);
  const after = choice(c, actor, zone); assert.equal(after.used, 1); assert.equal(after.enabled, false);
  assert.equal(c.snapshotForCoordinator().movement.cards[e.source.instanceId].rotated, zone !== 'leader');
});

test('same-name copies and multiple effects are keyed by exact source object and effectId, not cardId', () => {
  const { c } = setup({ mutate: d => d.effects.push({ ...structuredClone(d.effects[0]), id: 'second' }) });
  const first = choice(c, 0, 'character', 0), other = choice(c, 0, 'character', 1);
  assert.equal(first.cardId, other.cardId); assert.notDeepEqual(first.source, other.source); assert.notEqual(first.sourceToken, other.sourceToken);
  const before = c.snapshotForCoordinator(); assert.throws(() => c.activateMain(0, request(), c.context(), first.sourceToken, 'second'));
  assert.deepEqual(c.snapshotForCoordinator(), before);
  activate(c, 0, first); complete(c, 0); assert.equal(choice(c, 0, 'character', 1).enabled, true);
  activate(c, 0, choice(c, 0, 'character', 1)); complete(c, 0);
  assert.equal(choice(c, 0, 'character', 0).used, 1); assert.equal(choice(c, 0, 'character', 1).used, 1);
});

test('foreign, forged, cross-match and wrong-effect tokens fail without mutation', () => {
  const { c } = setup(), own = choice(c, 0, 'leader'), peer = choice(c, 1, 'leader'), otherMatch = setup().c;
  const before = c.snapshotForCoordinator();
  for (const [actor, token, effect] of [[0, peer.sourceToken, peer.effectId], [1, own.sourceToken, own.effectId], [0, '0'.repeat(64), own.effectId],
    [0, own.sourceToken, 'absent'], [0, choice(otherMatch, 0, 'leader').sourceToken, own.effectId]]) assert.throws(() => c.activateMain(actor, request(), c.context(), token, effect));
  assert.deepEqual(c.snapshotForCoordinator(), before);
});

test('old token and generation cannot follow a card that left and re-entered the field', () => {
  const { c } = setup({ mutate: (d, kind) => { if (kind === 'character') d.effects[0].actions = [
    { type: 'BIND_SOURCE', bindAs: 'source' }, { type: 'MOVE_CARD', cards: { ref: 'bindings.source' }, destination: { owner: 'SELF', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' }]; } });
  const old = choice(c, 0, 'character'); activate(c, 0, old); complete(c, 0);
  assert.equal(c.mainEffectsFor(0).some(e => e.source.instanceId === old.source.instanceId), false);
  assert.throws(() => activate(c, 0, old));
  const hand = c.viewFor(0).movement.players[0].hand.find(card => card.ref.instanceId === old.source.instanceId);
  c.playCard(0, request(), c.context(), hand.ref);
  const fresh = c.mainEffectsFor(0).find(e => e.source.instanceId === old.source.instanceId);
  assert.ok(fresh.source.generation > old.source.generation); assert.equal(fresh.enabled, true); assert.notEqual(fresh.sourceToken, old.sourceToken);
  assert.throws(() => activate(c, 0, old)); assert.throws(() => c.activate(0, request(), c.context(), old.source, old.effectId));
});

test('unpayable costs and false or UNKNOWN activation conditions do not authorize MAIN', () => {
  for (const mutate of [d => { d.effects[0].costs = [{ type: 'REST_DON', count: 3 }]; },
    d => { d.effects[0].activationConditions = { type: 'compare', left: 1, op: 'eq', right: 0 }; },
    (d, kind) => { if (kind === 'stage') d.effects[0].activationConditions = { type: 'compare', left: { ref: 'SOURCE.power' }, op: 'gt', right: 0 }; }]) {
    const { c } = setup({ mutate }), e = choice(c, 0, 'stage'); assert.equal(e.enabled, false);
    const before = c.snapshotForCoordinator(); assert.throws(() => activate(c, 0, e)); assert.deepEqual(c.snapshotForCoordinator(), before);
  }
});

test('choice waiting blocks another MAIN and keeps discard tokens private while replay stays idempotent', () => {
  const { c } = setup({ mutate: (d, kind) => { if (kind === 'leader') d.effects[0].costs = [{ type: 'DISCARD_HAND', count: 1 }]; } });
  const e = choice(c, 0, 'leader'); activate(c, 0, e); c.advance(0, request(), c.context());
  assert.equal(c.viewFor(0).frame.status, 'waitingForChoice'); assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.equal(c.mainEffectsFor(0).every(e => !e.enabled), true);
  const before = c.snapshotForCoordinator(); assert.throws(() => activate(c, 0, choice(c, 0, 'stage'))); assert.deepEqual(c.snapshotForCoordinator(), before);
  complete(c, 0); assert.equal(choice(c, 0, 'leader').used, 1);
});

test('wrong turn, battle timing and old revisions never authorize an otherwise valid MAIN', () => {
  const { c } = setup(), e = choice(c, 0, 'leader'), old = c.context();
  c.endTurn(0, request(), c.context()); assert.equal(choice(c, 0, 'leader').enabled, false); assert.throws(() => activate(c, 0, e));
  c.endTurn(1, request(), c.context()); const now = choice(c, 0, 'leader'); assert.throws(() => activate(c, 0, now, request(), old));
  const attack = c.attackChoicesFor(0); c.attack(0, request(), c.context(), attack.sources[0].card, attack.targets[0].card);
  assert.equal(c.mainEffectsFor(0).every(e => !e.enabled), true); assert.throws(() => activate(c, 0, choice(c, 0, 'leader')));
});

test('hand/trash/unregistered cards and face-down or mismatched field sources are not enumerated', () => {
  const s = setup(), movement = structuredClone(s.options.movement), hidden = movement.players[0].character[0], swapped = movement.players[0].character[1];
  movement.cards[hidden].faceUp = false; movement.cards[swapped].cardId = 'NOT-REGISTERED';
  assert.throws(() => new V3SyntheticMatchCoordinator({ ...s.options, movement }), /field-card/);
  movement.cards[hidden].faceUp = true; movement.cards[hidden].cardId = 'MAIN-stage';
  const c = new V3SyntheticMatchCoordinator({ ...s.options, movement });
  assert.deepEqual(c.mainEffectsFor(0).map(e => e.zone), ['leader', 'stage']);
  assert.equal(c.mainEffectsFor(0).some(e => movement.players[0].hand.includes(e.source.instanceId)), false);
});

test('REST_SOURCE affordability checks the current rest state independently of per-turn usage', () => {
  const s = setup({ mutate: d => { d.effects[0].usageLimit = null; } }), movement = structuredClone(s.options.movement);
  movement.cards[movement.players[0].stage[0]].rotated = true;
  const c = new V3SyntheticMatchCoordinator({ ...s.options, movement }), e = choice(c, 0, 'stage');
  assert.equal(e.used, 0); assert.equal(e.limit, null); assert.equal(e.enabled, false); assert.throws(() => activate(c, 0, e));
});
