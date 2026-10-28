const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const key = Buffer.alloc(32, 11); // Synthetic test key only.
function setup({ actor = 0, optional = false, costs = [], max = null, nextDeckCount, refreshSeed = false, cardType = 'character', don = 2, mutate = () => {} } = {}) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-select-move.json'), 'utf8'));
  data.reviewStatus = 'approved'; data.effects[0].optional = optional; data.effects[0].costs = costs;
  data.effects[0].usageLimit = max === null ? null : { type: 'PER_TURN', scope: 'SOURCE_OBJECT', count: max };
  data.cardType = cardType; data.effects[0].sourceZones = [cardType];
  data.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }]; mutate(data);
  const plan = compileV3CardJson(JSON.stringify(data));
  const record = { status: 'approved', cardId: data.cardId, cardVersion: data.cardVersion, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash,
    compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, rulesetVersion: 'synthetic-session.1', reviewer: 'fixture', approvedAt: '2026-10-29T00:00:00.000Z', ruleEvidence: ['synthetic:not-official-rulings'] };
  const card = new ApprovedV3Catalog([plan], [record], record.rulesetVersion).get(data.cardId);
  const recipe = { name: 'Synthetic session', leaderCardId: 'LEADER', mainDeck: Array(50).fill(data.cardId), donDeck: Array(10).fill('DON'), cardTypes: { [data.cardId]: cardType }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe);
  for (const player of [0, 1]) {
    const z = match.players[player].zones;
    for (let i = 0; i < 2; i++) z.character[i] = { ...z.deck.shift(), cardId: cardType === 'character' ? data.cardId : 'SEED-CHARACTER', kind: 'character', faceUp: true, rotated: false };
    for (let i = 0; i < don; i++) z.activeDon.push({ ...z.donDeck.shift(), faceUp: true, rotated: false });
  }
  const next = 1 - actor;
  if (nextDeckCount !== undefined) match.players[next].zones.trash.push(...match.players[next].zones.deck.splice(nextDeckCount).map(card => ({ ...card, faceUp: true })));
  if (refreshSeed) {
    const z = match.players[next].zones; z.restDon.push({ ...z.activeDon.shift(), rotated: true }); z.character[0].rotated = true; z.leader[0].rotated = true;
  }
  let progression = createProgression(actor);
  while (true) {
    progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') break;
    progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  let movement = new MatchMovementCapture(match, 1).snapshot().movement;
  if (refreshSeed) {
    movement = new MovementStore(movement).commit({ transactionId: 'seed-attachment', matchId: match.id, expectedRevision: movement.revision, turnNumber: 1,
      actor: next, effectController: next, source: null, mode: 'rule', resolutionId: null,
      operations: [{ kind: 'attachDon', card: { instanceId: movement.players[next].activeDon[0], generation: 0 }, target: { instanceId: movement.players[next].character[1], generation: 0 } }] }, { status: 'certifiedNone' }).state;
  }
  const options = { mode: 'syntheticNoAbilities', movement, progression, cards: [card], signingKey: key, master: null, now: () => 1000 };
  const coordinator = new V3SyntheticMatchCoordinator(options);
  const sources = [0, 1].map(player => ({ instanceId: movement.players[player].character[0], generation: 0 }));
  return { c: coordinator, actor, sources, options, data };
}
let request = 0;
const id = prefix => `${prefix}-${++request}`;
function complete(c, actor) {
  for (let i = 0; i < 20; i++) {
    const view = c.viewFor(actor);
    if (view.frame.status === 'completed' || view.frame.status === 'blocked') return view;
    if (view.frame.status === 'ready') c.advance(actor, id('advance'), c.context());
    else if (view.frame.status === 'waitingForWork') c.applyPendingWork(actor, id('work'), c.context());
    else {
      const choice = view.frame.choice;
      c.answer(actor, id('answer'), c.context(), choice.selectionId, choice.options.slice(0, choice.min).map(option => option.token));
    }
  }
  throw Error('Resolution did not finish');
}

test('multiple resolutions use the same board, independent IDs and one session revision for each command', () => {
  for (const actor of [0, 1]) {
    const { c, sources } = setup({ actor }), initial = c.viewFor(actor), contexts = [];
    for (let i = 0; i < 3; i++) {
      const context = c.context(); contexts.push(context); c.activate(actor, id('activate'), context, sources[actor], 'main');
      const result = complete(c, actor); assert.equal(result.frame.status, 'completed');
      assert.equal(result.movement.matchId, initial.movement.matchId); assert.equal(result.movement.players[actor].hand.length, 6 + i);
      assert.equal(c.snapshotForCoordinator().usage.length, 1); assert.equal(c.snapshotForCoordinator().usage[0][1], i + 1);
    }
    assert.equal(new Set(contexts.map(context => context.resolutionId)).size, 3);
    assert.equal(c.viewFor(actor).history.length, 2); assert.equal(c.viewFor(actor).history.every(row => row.committed), true);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
    assert.throws(() => c.activate(actor, 'stale-activate', contexts[0], sources[actor], 'main'));
  }
});

test('per-object limits count only committed activation, not optional confirmation or decline', () => {
  for (const actor of [0, 1]) {
    const { c, sources } = setup({ actor, optional: true, costs: [{ type: 'REST_DON', count: 1 }], max: 1 });
    c.activate(actor, 'declined-start', c.context(), sources[actor], 'main'); c.advance(actor, 'confirm', c.context());
    const choice = c.viewFor(actor).frame.choice; c.answer(actor, 'decline', c.context(), choice.selectionId, [choice.options[1].token]);
    assert.deepEqual(c.snapshotForCoordinator().usage, []);
    c.activate(actor, 'accepted-start', c.context(), sources[actor], 'main'); c.advance(actor, 'confirm-again', c.context());
    const next = c.viewFor(actor).frame.choice; c.answer(actor, 'accept', c.context(), next.selectionId, [next.options[0].token]);
    assert.deepEqual(c.snapshotForCoordinator().usage, []); c.advance(actor, 'cost-plan', c.context()); assert.deepEqual(c.snapshotForCoordinator().usage, []);
    const context = c.context(); c.applyPendingWork(actor, 'pay-once', context); assert.equal(c.applyPendingWork(actor, 'pay-once', context).replayed, true);
    assert.equal(c.snapshotForCoordinator().usage[0][1], 1); complete(c, actor);
    const before = c.snapshotForCoordinator(); assert.throws(() => c.activate(actor, 'exhausted', c.context(), sources[actor], 'main'));
    assert.deepEqual(c.snapshotForCoordinator(), before);
    const other = { instanceId: before.movement.players[actor].character[1], generation: 0 };
    c.activate(actor, 'different-object', c.context(), other, 'main'); assert.equal(complete(c, actor).frame.status, 'completed');
  }
});

test('failed activation conditions consume no use; a paid effect with failed resolution conditions still consumes one', () => {
  const inactive = setup({ max: 1, mutate: d => d.effects[0].activationConditions = { type: 'compare', left: 1, op: 'eq', right: 0 } });
  inactive.c.activate(0, 'start', inactive.c.context(), inactive.sources[0], 'main'); complete(inactive.c, 0); assert.deepEqual(inactive.c.snapshotForCoordinator().usage, []);
  inactive.c.activate(0, 'again', inactive.c.context(), inactive.sources[0], 'main'); assert.equal(complete(inactive.c, 0).frame.status, 'completed');
  const paid = setup({ max: 1, costs: [{ type: 'REST_DON', count: 1 }], mutate: d => d.effects[0].resolutionConditions = { type: 'compare', left: 1, op: 'eq', right: 0 } });
  paid.c.activate(0, 'start', paid.c.context(), paid.sources[0], 'main'); complete(paid.c, 0);
  assert.equal(paid.c.viewFor(0).movement.players[0].hand.length, 5); assert.equal(paid.c.viewFor(0).movement.players[0].restDon.length, 1);
  assert.equal(paid.c.snapshotForCoordinator().usage[0][1], 1); assert.throws(() => paid.c.activate(0, 'again', paid.c.context(), paid.sources[0], 'main'));
});

test('pending choice and blocked work prevent another effect or turn change', () => {
  for (const costs of [[{ type: 'DISCARD_HAND', count: 1 }], [{ type: 'REST_DON', count: 50 }]]) {
    const { c, sources } = setup({ costs }); c.activate(0, 'start', c.context(), sources[0], 'main'); c.advance(0, 'wait', c.context());
    if (c.viewFor(0).frame.status === 'waitingForWork') c.applyPendingWork(0, 'fail', c.context());
    const before = c.snapshotForCoordinator(); assert.throws(() => c.activate(0, 'other', c.context(), sources[0], 'main'));
    assert.throws(() => c.endTurn(0, 'end', c.context())); assert.deepEqual(c.snapshotForCoordinator(), before);
  }
});

test('end turn atomically prepares refresh, private draw and DON addition, then allows the other seat', () => {
  for (const actor of [0, 1]) {
    const { c, sources } = setup({ actor, refreshSeed: true, max: 1 }), next = 1 - actor;
    c.activate(actor, 'start', c.context(), sources[actor], 'main'); complete(c, actor);
    const old = c.snapshotForCoordinator(), context = c.context(); c.endTurn(actor, 'end-turn', context);
    assert.equal(c.endTurn(actor, 'end-turn', context).replayed, true);
    const snapshot = c.snapshotForCoordinator(), result = c.viewFor(next);
    assert.equal(result.turnNumber, 2); assert.equal(result.activePlayer, next); assert.equal(result.phase, 'main'); assert.equal(result.gate, 'idle'); assert.equal(result.frame, null);
    assert.equal(snapshot.movement.turnNumber, 2); assert.equal(snapshot.movement.players[next].hand.length, 6);
    assert.equal(snapshot.movement.players[next].activeDon.length, 4); assert.equal(snapshot.movement.players[next].restDon.length, 0); assert.equal(snapshot.movement.players[next].attachedDon.length, 0);
    assert.equal(snapshot.movement.cards[sources[next].instanceId].rotated, false);
    assert.equal(snapshot.movement.players[actor].hand.length, old.movement.players[actor].hand.length); assert.deepEqual(snapshot.usage, []);
    assert.equal(c.viewFor(actor).movement.players[next].hand.every(card => card.cardId === null), true);
    assert.throws(() => c.activate(actor, 'wrong-turn', c.context(), sources[actor], 'main'));
    c.activate(next, 'next-start', c.context(), sources[next], 'main'); assert.equal(complete(c, next).frame.status, 'completed');
    c.endTurn(next, 'back', c.context()); c.activate(actor, 'new-turn-use', c.context(), sources[actor], 'main'); assert.equal(complete(c, actor).frame.status, 'completed');
  }
});

test('a later phase failure rolls back the entire turn, including refresh and session receipts', () => {
  const { c } = setup({ nextDeckCount: 1, refreshSeed: true }), before = c.snapshotForCoordinator();
  assert.throws(() => c.endTurn(0, 'cannot-draw', c.context())); assert.deepEqual(c.snapshotForCoordinator(), before);
  assert.equal(c.viewFor(0).turnNumber, 1); assert.equal(c.viewFor(0).activePlayer, 0);
});

test('source, controller, request conflicts, production and attempted server-policy overrides are guarded', () => {
  const { c, sources, options } = setup(); const context = c.context();
  assert.throws(() => c.activate(1, 'foreign', context, sources[0], 'main')); assert.throws(() => c.activate(0, 'unknown', context, sources[0], 'missing'));
  assert.throws(() => c.activate(0, 'generation', context, { ...sources[0], generation: 1 }, 'main'));
  c.activate(0, 'activate', Object.fromEntries(Object.entries(context).reverse()), sources[0], 'main');
  assert.equal(c.activate(0, 'activate', context, sources[0], 'main').replayed, true);
  assert.throws(() => c.activate(0, 'activate', context, sources[1], 'main'));
  assert.throws(() => new V3SyntheticMatchCoordinator({ ...options, policies: [] })); assert.throws(() => new V3SyntheticMatchCoordinator({ ...options, cards: [JSON.parse(JSON.stringify(options.cards[0]))] }));
  assert.throws(() => JSON.stringify(c));
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.throws(() => new V3SyntheticMatchCoordinator(options)); assert.throws(() => c.advance(0, 'disabled', c.context())); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test('a JSON two-use limit is enforced per source rather than replaced by a hard-coded once limit', () => {
  const { c, sources } = setup({ max: 2 });
  for (let i = 0; i < 2; i++) { c.activate(0, `use-${i}`, c.context(), sources[0], 'main'); complete(c, 0); }
  assert.equal(c.effectsFor(0, sources[0])[0].used, 2); assert.equal(c.effectsFor(0, sources[0])[0].limit, 2);
  assert.equal(c.effectsFor(0, sources[0])[0].enabled, false);
  const before = c.snapshotForCoordinator(); assert.throws(() => c.activate(0, 'third', c.context(), sources[0], 'main'));
  assert.deepEqual(c.snapshotForCoordinator(), before);
});

test('normal play pays exact known cost and enters the leftmost free field slot, publishing cost and entry causes separately', () => {
  for (const actor of [0, 1]) for (const cardType of ['character', 'stage']) {
    const { c } = setup({ actor, cardType, mutate: d => d.baseStats.cost = 2 }), before = c.snapshotForCoordinator();
    const id = before.movement.players[actor].hand[0], ref = { instanceId: id, generation: before.movement.cards[id].generation };
    assert.equal(c.effectsFor(actor, ref)[0].enabled, false);
    const offered = c.playableCardsFor(actor); assert.equal(offered.length, 5); assert.equal(offered[0].enabled, true); assert.equal(offered[0].cost, 2);
    const context = c.context(); c.playCard(actor, 'play', context, ref); assert.equal(c.playCard(actor, 'play', context, ref).replayed, true);
    const after = c.snapshotForCoordinator(), played = after.movement.cards[id], expectedSlot = cardType === 'character' ? 2 : 0;
    assert.equal(after.movement.players[actor][cardType][expectedSlot], id); assert.equal(played.faceUp, true); assert.equal(played.rotated, false);
    assert.equal(played.generation, ref.generation + 1); assert.equal(played.enteredTurn, cardType === 'character' ? 1 : null);
    assert.equal(after.movement.players[actor].hand.length, 4); assert.equal(after.movement.players[actor].activeDon.length, 0); assert.equal(after.movement.players[actor].restDon.length, 2);
    assert.equal(after.ruleEvents.filter(event => event.cause.kind === 'COST_PAYMENT').length, 2);
    assert.equal(after.ruleEvents.at(-1).cause.kind, 'RULE_PROCESSING'); assert.equal(after.ruleEvents.at(-1).to.zone, cardType);
    assert.equal(c.viewFor(1 - actor).movement.players[actor][cardType][expectedSlot].cardId, played.cardId);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].hand.every(card => card.cardId === null), true);
    assert.equal(c.effectsFor(actor, { instanceId: id, generation: played.generation })[0].enabled, true);
  }
});

test('zero-cost play works without DON, full fields or unknown/insufficient cost do not partially pay', () => {
  const free = setup({ don: 0, mutate: d => d.baseStats.cost = 0 }).c;
  for (let i = 0; i < 3; i++) { const play = free.playableCardsFor(0)[0]; free.playCard(0, `free-${i}`, free.context(), play.card); }
  const full = free.snapshotForCoordinator(); assert.equal(full.movement.players[0].activeDon.length, 0); assert.equal(full.movement.players[0].character.filter(Boolean).length, 5);
  assert.equal(free.playableCardsFor(0)[0].enabled, false);
  assert.throws(() => free.playCard(0, 'full', free.context(), free.playableCardsFor(0)[0].card)); assert.deepEqual(free.snapshotForCoordinator(), full);
  for (const cost of [null, 3]) {
    const c = setup({ mutate: d => d.baseStats.cost = cost }).c, before = c.snapshotForCoordinator(), candidate = c.playableCardsFor(0)[0];
    assert.equal(candidate.enabled, false); assert.throws(() => c.playCard(0, 'not-payable', c.context(), candidate.card)); assert.deepEqual(c.snapshotForCoordinator(), before);
  }
  const stage = setup({ cardType: 'stage', mutate: d => d.baseStats.cost = 0 }).c;
  stage.playCard(0, 'first-stage', stage.context(), stage.playableCardsFor(0)[0].card); const occupied = stage.snapshotForCoordinator();
  assert.throws(() => stage.playCard(0, 'occupied-stage', stage.context(), stage.playableCardsFor(0)[0].card)); assert.deepEqual(stage.snapshotForCoordinator(), occupied);
});

test('normal play cannot use another hand, stale generations, occupied slots, the wrong turn or an active resolution', () => {
  const { c, sources } = setup({ optional: true, mutate: d => d.baseStats.cost = 1 });
  const own = c.playableCardsFor(0)[0].card, other = c.playableCardsFor(1)[0].card, before = c.snapshotForCoordinator();
  for (const [actor, ref, slot] of [[0, other, 2], [1, other, 2], [0, { ...own, generation: 1 }, 2], [0, own, 0], [0, own, -1], [0, own, 6]]) {
    assert.throws(() => c.playCard(actor, 'invalid', c.context(), ref, slot)); assert.deepEqual(c.snapshotForCoordinator(), before);
  }
  c.activate(0, 'pending', c.context(), sources[0], 'main'); c.advance(0, 'confirm', c.context()); const pending = c.snapshotForCoordinator();
  assert.throws(() => c.playCard(0, 'during-choice', c.context(), own)); assert.deepEqual(c.snapshotForCoordinator(), pending);
});
