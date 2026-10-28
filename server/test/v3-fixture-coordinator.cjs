const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { createProgression, checkTiming } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3FixtureCoordinator } = require('../dist/test/effects/v3/fixtureCoordinator.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const key = Buffer.alloc(32, 9); // Synthetic key, not a deployment secret.
function setup({ actor = 0, don = 2, mutate = () => {}, attach = false, hidden = false, missingStats = false, deckCount, handCount, handFaceDown = false, sourceKind = 'character', sourceRotated = false, restDon = 0 } = {}) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-select-move.json'), 'utf8'));
  data.reviewStatus = 'approved'; data.baseStats.cost = 2; data.baseStats.power = 2000; mutate(data);
  data.cardType = sourceKind; data.effects[0].sourceZones = [sourceKind];
  const plan = compileV3CardJson(JSON.stringify(data)), record = { status: 'approved', cardId: data.cardId, cardVersion: data.cardVersion, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash,
    rulesetVersion: 'synthetic.1', reviewer: 'fixture', approvedAt: '2026-10-28T00:00:00.000Z', ruleEvidence: ['synthetic-test:not-official-rulings'] };
  const card = new ApprovedV3Catalog([plan], [record], 'synthetic.1').get(data.cardId);
  const recipe = { name: 'Fixture', leaderCardId: 'LEADER', mainDeck: Array(50).fill(data.cardId), donDeck: Array(10).fill('DON'), cardTypes: { [data.cardId]: 'character' }, leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe), zones = match.players[actor].zones;
  zones.character[0] = { ...zones.deck.shift(), faceUp: true, rotated: false };
  zones.character[1] = { ...zones.deck.shift(), faceUp: !hidden, rotated: false };
  if (missingStats) zones.character[1].cardId = 'UNKNOWN-CARD';
  if (hidden) { zones.public.push(zones.character[1]); zones.character[1] = null; }
  for (let i = 0; i < don; i++) zones.activeDon.push({ ...zones.donDeck.shift(), faceUp: true, rotated: false });
  for (let i = 0; i < restDon; i++) zones.restDon.push({ ...zones.activeDon.shift(), rotated: true });
  if (deckCount !== undefined) zones.trash.push(...zones.deck.splice(deckCount).map(card => ({ ...card, faceUp: true })));
  if (handCount !== undefined) zones.trash.push(...zones.hand.splice(handCount).map(card => ({ ...card, faceUp: true })));
  if (handFaceDown) zones.hand = zones.hand.map(card => ({ ...card, faceUp: false }));
  if (sourceKind === 'stage') { zones.stage[0] = { ...zones.character[0], kind: 'stage' }; zones.character[0] = null; }
  if (sourceKind === 'leader') zones.leader[0].cardId = data.cardId;
  const sourceCard = zones[sourceKind][0]; sourceCard.rotated = sourceRotated;
  let progression = createProgression(actor);
  while (true) {
    progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') break;
    progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  let movement = new MatchMovementCapture(match, 1).snapshot().movement;
  const source = { instanceId: sourceCard.id, generation: 0 }, target = { instanceId: (zones.character[1] ?? zones.public[0]).id, generation: 0 };
  if (attach) {
    const id = movement.players[actor].activeDon[0];
    movement = new MovementStore(movement).commit({ transactionId: 'seed-attach', matchId: movement.matchId, expectedRevision: movement.revision, turnNumber: 1, actor, effectController: actor, source, mode: 'rule', resolutionId: null,
      operations: [{ kind: 'attachDon', card: { instanceId: id, generation: 0 }, target }] }, { status: 'certifiedNone' }).state;
  }
  const options = { mode: 'syntheticNoAbilities', card, identity: { matchId: match.id, resolutionId: 'v3-fixture', effectId: 'main', actor, source }, movement, progression, signingKey: key, master: null, now: () => 1000 };
  return { coordinator: new V3FixtureCoordinator(options), options, actor, source, target };
}
function choose(s) {
  const c = s.coordinator, v = c.viewFor(s.actor), context = c.context();
  return { context, id: v.frame.choice.selectionId, tokens: [v.frame.choice.options[0].token] };
}
function fieldActions(...types) {
  return d => { d.effects[0].actions = [d.effects[0].actions[0], ...types.map(type => ({ type, cards: { ref: 'bindings.picked' } }))]; };
}
function beginFieldWork(s) {
  const c = s.coordinator; c.advance(s.actor, 'field-start', c.context()); const choice = choose(s);
  c.answer(s.actor, 'field-choose', choice.context, choice.id, choice.tokens); c.advance(s.actor, 'field-work', c.context()); return c;
}
function privateHand(d) {
  const select = d.effects[0].actions[0];
  Object.assign(select.selector, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, min: 1, max: 1, owner: 'SELF', controller: 'SELF', chooser: 'SELF', filters: { type: 'all', conditions: [] } });
  d.effects[0].actions = [select, { type: 'MOVE_CARD', cards: { ref: 'bindings.picked' }, destination: { owner: 'SELF', zone: 'trash', position: 'append', faceUp: true }, cause: 'EFFECT' }, { type: 'DRAW', player: 'SELF', count: 1 }];
}
function discardCosts(d) {
  d.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'DISCARD_HAND', count: 1 }];
  d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }];
}
function searchDeck(d) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-search-deck.json'), 'utf8'));
  d.effects[0].actions = data.effects[0].actions;
}

test('search privately looks, reveals only the selected card, preserves chosen remainder order and closes grants before releasing the gate', () => {
  for (const actor of [0, 1]) for (const picked of [false, true]) for (const position of ['top', 'bottom']) {
    const { coordinator: c } = setup({ actor, mutate: d => { searchDeck(d); d.effects[0].actions.at(-1).position = position; } }), before = c.snapshotForCoordinator().movement, top = before.players[actor].deck.slice(0, 3);
    c.advance(actor, 'look-request', c.context()); assert.equal(c.pendingWorkKind(), 'LOOK_TOP');
    assert.equal(c.viewFor(actor).movement.players[actor].deck.every(card => card.cardId === null), true);
    c.applyPendingWork(actor, 'look', c.context()); assert.equal(c.viewFor(actor).movement.players[actor].deck.filter(card => card.cardId !== null).length, 3);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].deck.every(card => card.cardId === null && card.ref === null), true);
    c.advance(actor, 'select', c.context()); const choice = c.viewFor(actor).frame.choice;
    assert.equal(choice.options.length, 3); assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
    c.answer(actor, 'pick', c.context(), choice.selectionId, picked ? [choice.options[1].token] : []);
    if (picked) {
      c.advance(actor, 'reveal-request', c.context()); assert.equal(c.pendingWorkKind(), 'REVEAL'); c.applyPendingWork(actor, 'reveal', c.context());
      assert.equal(c.viewFor(1 - actor).movement.players[actor].deck.filter(card => card.cardId !== null).length, 1);
      c.advance(actor, 'move-request', c.context()); c.applyPendingWork(actor, 'move', c.context());
      assert.equal(c.viewFor(actor).movement.players[actor].hand.length, 6); assert.equal(c.viewFor(1 - actor).movement.players[actor].hand.every(card => card.cardId === null), true);
    }
    c.advance(actor, 'order-request', c.context()); const order = c.viewFor(actor).frame.choice;
    assert.equal(order.purpose, 'order'); assert.equal(order.min, picked ? 2 : 3); assert.equal(order.max, order.min);
    assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
    assert.throws(() => c.answer(actor, 'incomplete-order', c.context(), order.selectionId, [order.options[0].token]));
    c.answer(actor, 'ordered', c.context(), order.selectionId, [...order.options].reverse().map(option => option.token));
    c.advance(actor, 'return-request', c.context()); assert.equal(c.pendingWorkKind(), 'RETURN_TO_DECK');
    const context = c.context(); c.applyPendingWork(actor, 'return', context); assert.equal(c.applyPendingWork(actor, 'return', context).replayed, true);
    const remainder = top.filter((_, i) => !picked || i !== 1).reverse(), afterReturn = c.snapshotForCoordinator().movement;
    assert.deepEqual(afterReturn.players[actor].deck, position === 'top' ? [...remainder, ...before.players[actor].deck.slice(3)] : [...before.players[actor].deck.slice(3), ...remainder]);
    for (const id of remainder) assert.equal(afterReturn.cards[id].generation, before.cards[id].generation);
    c.advance(actor, 'cleanup-request', c.context()); assert.equal(c.pendingWorkKind(), 'CLOSE_REVEALS'); assert.notEqual(c.viewFor(actor).progression.gate, 'idle');
    c.applyPendingWork(actor, 'cleanup', c.context()); assert.deepEqual(c.snapshotForCoordinator().movement.reveals, []);
    c.advance(actor, 'complete', c.context()); assert.equal(c.viewFor(actor).frame.status, 'completed'); assert.equal(c.viewFor(actor).progression.gate, 'idle');
    assert.equal(c.viewFor(actor).movement.players[actor].deck.every(card => card.cardId === null), true);
  }
});

test('hand reveal can move to the public area, and looking again never conceals an existing public grant', () => {
  const hand = setup({ mutate: d => {
    privateHand(d); d.effects[0].actions = [d.effects[0].actions[0], { type: 'REVEAL', cards: { ref: 'bindings.picked' }, viewers: 'BOTH' },
      { type: 'MOVE_CARD', cards: { ref: 'bindings.picked' }, destination: { owner: 'SELF', zone: 'public', position: 'append', faceUp: true }, cause: 'EFFECT' }];
  } }).coordinator;
  hand.advance(0, 'select', hand.context()); const choice = hand.viewFor(0).frame.choice;
  hand.answer(0, 'pick', hand.context(), choice.selectionId, [choice.options[0].token]);
  hand.advance(0, 'reveal', hand.context()); hand.applyPendingWork(0, 'reveal-work', hand.context());
  assert.equal(hand.viewFor(1).movement.players[0].hand.filter(card => card.cardId !== null).length, 1);
  hand.advance(0, 'move', hand.context()); hand.applyPendingWork(0, 'move-work', hand.context());
  assert.equal(hand.viewFor(1).movement.players[0].public.length, 1); assert.equal(hand.viewFor(1).movement.players[0].public[0].faceUp, true);
  hand.advance(0, 'close', hand.context()); hand.applyPendingWork(0, 'close-work', hand.context()); hand.advance(0, 'complete', hand.context());
  assert.equal(hand.viewFor(0).frame.status, 'completed'); assert.equal(hand.viewFor(1).movement.players[0].public[0].cardId, choice.options[0].cardId);
  const again = setup({ mutate: d => { searchDeck(d); d.effects[0].actions.splice(3, 0, { type: 'LOOK_TOP', player: 'SELF', count: 3, bindAs: 'again', onInsufficient: 'takeAvailable' }); } }).coordinator;
  again.advance(0, 'look', again.context()); again.applyPendingWork(0, 'look-work', again.context()); again.advance(0, 'select', again.context());
  const selected = again.viewFor(0).frame.choice; again.answer(0, 'pick', again.context(), selected.selectionId, [selected.options[0].token]);
  again.advance(0, 'reveal', again.context()); again.applyPendingWork(0, 'reveal-work', again.context()); again.advance(0, 'look-again', again.context()); again.applyPendingWork(0, 'look-again-work', again.context());
  assert.equal(again.viewFor(1).movement.players[0].deck.filter(card => card.cardId !== null).length, 1);
});

test('look shortage is explicit, a one-card remainder can be ordered, and a last-card move stops without partial movement', () => {
  const strict = setup({ deckCount: 2, mutate: d => { searchDeck(d); d.effects[0].actions[0].onInsufficient = 'fail'; } }).coordinator;
  const initial = strict.snapshotForCoordinator(); assert.throws(() => strict.advance(0, 'short-look', strict.context())); assert.deepEqual(strict.snapshotForCoordinator(), initial);
  const c = setup({ deckCount: 1, mutate: searchDeck }).coordinator;
  c.advance(0, 'look-request', c.context()); c.applyPendingWork(0, 'look', c.context()); c.advance(0, 'select', c.context()); const choice = c.viewFor(0).frame.choice;
  assert.equal(choice.options.length, 1); c.answer(0, 'pick', c.context(), choice.selectionId, [choice.options[0].token]);
  c.advance(0, 'reveal-request', c.context()); c.applyPendingWork(0, 'reveal', c.context()); c.advance(0, 'move-request', c.context());
  const before = c.snapshotForCoordinator().movement; c.applyPendingWork(0, 'blocked-last-card', c.context());
  assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.snapshotForCoordinator().movement, before);
  const one = setup({ deckCount: 1, mutate: searchDeck }).coordinator;
  one.advance(0, 'look-request', one.context()); one.applyPendingWork(0, 'look', one.context()); one.advance(0, 'select', one.context());
  one.answer(0, 'skip', one.context(), one.viewFor(0).frame.choice.selectionId, []); one.advance(0, 'order-request', one.context());
  const order = one.viewFor(0).frame.choice; assert.equal(order.purpose, 'order'); assert.equal(order.min, 1);
  one.answer(0, 'order', one.context(), order.selectionId, [order.options[0].token]); one.advance(0, 'return-request', one.context()); one.applyPendingWork(0, 'return', one.context());
  one.advance(0, 'cleanup-request', one.context()); one.applyPendingWork(0, 'cleanup', one.context()); one.advance(0, 'finish', one.context());
  assert.equal(one.viewFor(0).frame.status, 'completed'); assert.deepEqual(one.snapshotForCoordinator().movement.reveals, []);
});

test('optional activation releases the gate without payment when declined, or continues through normal hand and DON costs', () => {
  for (const actor of [0, 1]) for (const accepted of [false, true]) {
    const c = setup({ actor, mutate: d => { discardCosts(d); d.effects[0].optional = true; } }).coordinator;
    const before = c.snapshotForCoordinator(); c.advance(actor, 'confirm', c.context()); const choice = c.viewFor(actor).frame.choice;
    assert.equal(choice.purpose, 'activation'); assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
    const confirmationContext = c.context(); assert.throws(() => c.applyPendingWork(actor, 'pay-too-early', confirmationContext));
    assert.deepEqual(c.context(), confirmationContext); assert.equal(c.snapshotForCoordinator().movement, before.movement);
    const tokens = [choice.options[accepted ? 0 : 1].token]; c.answer(actor, 'confirm-answer', confirmationContext, choice.selectionId, tokens);
    assert.equal(c.answer(actor, 'confirm-answer', confirmationContext, choice.selectionId, tokens).replayed, true);
    assert.equal(c.snapshotForCoordinator().movement, before.movement); assert.equal(c.snapshotForCoordinator().movementEvents.length, 0);
    assert.equal(c.viewFor(1 - actor).frame.activationDecision, accepted ? 'accepted' : 'declined');
    if (!accepted) {
      assert.equal(c.viewFor(actor).frame.status, 'completed'); assert.equal(c.viewFor(actor).progression.gate, 'idle');
      assert.equal(checkTiming(c.snapshotForCoordinator().progression, actor, 'mainEffect').allowed, true); continue;
    }
    c.advance(actor, 'choose-hand', c.context()); const hand = c.viewFor(actor).frame.choice;
    assert.equal(hand.purpose, 'cost'); c.answer(actor, 'hand', c.context(), hand.selectionId, [hand.options[0].token]);
    c.advance(actor, 'plan', c.context()); c.applyPendingWork(actor, 'pay', c.context());
    assert.equal(c.viewFor(actor).movement.players[actor].hand.length, 4); assert.equal(c.viewFor(actor).movement.players[actor].restDon.length, 1);
    c.advance(actor, 'draw-plan', c.context()); c.applyPendingWork(actor, 'draw', c.context()); c.advance(actor, 'done', c.context());
    assert.equal(c.viewFor(actor).frame.status, 'completed'); assert.equal(c.viewFor(actor).progression.gate, 'idle');
  }
});

test('declining optional activation needs no funds and cannot be turned into an automatic payment', () => {
  const c = setup({ don: 0, handCount: 0, mutate: d => { discardCosts(d); d.effects[0].optional = true; } }).coordinator;
  const before = c.snapshotForCoordinator(); c.advance(0, 'start', c.context()); const choice = c.viewFor(0).frame.choice;
  c.answer(0, 'decline', c.context(), choice.selectionId, [choice.options[1].token]);
  assert.equal(c.snapshotForCoordinator().movement, before.movement); assert.equal(c.pendingWorkKind(), null); assert.equal(c.viewFor(0).progression.gate, 'idle');
});

test('DON_RETURN selects exact owned active, rested or attached DON and resets it in the DON deck for both seats', () => {
  for (const actor of [0, 1]) for (const from of ['activeDon', 'restDon', 'attachedDon']) {
    const s = setup({ actor, restDon: from === 'restDon' ? 1 : 0, attach: from === 'attachedDon', mutate: d => {
      d.effects[0].costs = [{ type: 'DON_RETURN', count: 1, from }]; d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }];
    } }), c = s.coordinator, before = c.snapshotForCoordinator();
    c.advance(actor, 'return-start', c.context()); const choice = choose(s), view = c.viewFor(actor);
    assert.equal(view.frame.choice.purpose, 'returnCost'); assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
    c.answer(actor, 'return-choice', choice.context, choice.id, choice.tokens); c.advance(actor, 'return-plan', c.context());
    assert.equal(c.snapshotForCoordinator().movement, before.movement); const context = c.context();
    c.applyPendingWork(actor, 'return-pay', context); assert.equal(c.applyPendingWork(actor, 'return-pay', context).replayed, true);
    const paid = c.snapshotForCoordinator(), event = paid.movementEvents[0], card = paid.movement.cards[event.after.instanceId];
    assert.equal(paid.movement.players[actor].donDeck.length, before.movement.players[actor].donDeck.length + 1);
    assert.equal(paid.movement.players[actor][from].length, before.movement.players[actor][from].length - 1);
    assert.equal(event.cause.kind, 'COST_PAYMENT'); assert.equal(event.isKO, false);
    assert.equal(card.generation, event.before.generation + 1); assert.equal(card.faceUp, false); assert.equal(card.rotated, false); assert.equal(card.attachedTo, null);
    assert.equal(paid.movement.cards[s.target.instanceId].generation, before.movement.cards[s.target.instanceId].generation);
    c.advance(actor, 'draw-plan', c.context()); c.applyPendingWork(actor, 'draw', c.context()); c.advance(actor, 'done', c.context());
    assert.equal(c.viewFor(actor).frame.status, 'completed');
  }
});

test('sequential hand and DON cost choices leave the board intact, then pay four costs once without reusing returned active DON', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor, mutate: d => { discardCosts(d); d.effects[0].costs.unshift({ type: 'REST_SOURCE' }); d.effects[0].costs.push({ type: 'DON_RETURN', count: 1, from: 'activeDon' }); } });
    const c = s.coordinator, before = c.snapshotForCoordinator(); c.advance(actor, 'hand-start', c.context()); const hand = choose(s);
    c.answer(actor, 'hand', hand.context, hand.id, hand.tokens); c.advance(actor, 'don-start', c.context()); const don = choose(s);
    assert.notEqual(hand.id, don.id); assert.equal(c.viewFor(actor).frame.choice.purpose, 'returnCost');
    assert.throws(() => c.answer(actor, 'old-hand-token', don.context, don.id, hand.tokens));
    c.answer(actor, 'don', don.context, don.id, don.tokens); c.advance(actor, 'all-planned', c.context());
    assert.equal(c.snapshotForCoordinator().movement, before.movement); c.applyPendingWork(actor, 'pay-all', c.context());
    const paid = c.snapshotForCoordinator(); assert.equal(paid.movement.revision, before.movement.revision + 1);
    assert.equal(paid.movement.players[actor].activeDon.length, 0); assert.equal(paid.movement.players[actor].restDon.length, 1);
    assert.equal(paid.movement.players[actor].hand.length, 4); assert.equal(paid.movement.players[actor].donDeck.length, 9);
    assert.equal(paid.movementEvents.length, 4); assert.equal(paid.movementEvents.every(event => event.cause.kind === 'COST_PAYMENT'), true);
    const rest = paid.movementEvents.find(event => event.kind === 'restChanged' && event.after.kind === 'don');
    const returned = paid.movementEvents.find(event => event.to?.zone === 'donDeck'); assert.notEqual(rest.after.instanceId, returned.after.instanceId);
  }
});

test('DON return shortage, including overlap with REST_DON, never partially pays another cost', () => {
  for (const actor of [0, 1]) for (const [from, count, don] of [['activeDon', 1, 1], ['restDon', 1, 2], ['attachedDon', 1, 2], ['activeDon', 3, 2]]) {
    const c = setup({ actor, don, mutate: d => { discardCosts(d); d.effects[0].costs.push({ type: 'DON_RETURN', count, from }); } }).coordinator;
    const before = c.snapshotForCoordinator(); c.advance(actor, 'short', c.context()); assert.equal(c.viewFor(actor).frame.status, 'blocked');
    assert.equal(c.viewFor(actor).frame.choice, null); assert.equal(c.snapshotForCoordinator().movement, before.movement); assert.equal(c.snapshotForCoordinator().movementEvents.length, 0);
  }
});

test('mixed DON return reserves active payment, rejects over-selection without leaving the choice, and allows all payable zone pairs', () => {
  for (const actor of [0, 1]) for (const pair of [['activeDon', 'restDon'], ['activeDon', 'attachedDon'], ['restDon', 'attachedDon']]) {
    const s = setup({ actor, don: 4, restDon: 1, attach: true, mutate: d => {
      d.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'DON_RETURN', count: 2, from: ['activeDon', 'restDon', 'attachedDon'] }];
      d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }];
    } }), c = s.coordinator, before = c.snapshotForCoordinator(); c.advance(actor, 'start', c.context());
    const choice = c.viewFor(actor).frame.choice; assert.equal(choice.maxActiveReturn, 1); assert.equal(choice.options.length, 4);
    assert.equal(choice.options.find(option => option.zone === 'attachedDon').label, 'キャラ2付与DON');
    assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
    const context = c.context(), active = choice.options.filter(option => option.zone === 'activeDon').map(option => option.token);
    const frame = c.snapshotForCoordinator().frame; assert.throws(() => c.answer(actor, 'two-active', context, choice.selectionId, active));
    assert.deepEqual(c.context(), context); assert.equal(c.snapshotForCoordinator().frame, frame);
    assert.equal(c.viewFor(actor).frame.status, 'waitingForChoice'); assert.equal(c.snapshotForCoordinator().movement, before.movement);
    c.answer(actor, 'valid-pair', context, choice.selectionId, pair.map(zone => choice.options.find(option => option.zone === zone).token));
    c.advance(actor, 'plan', c.context()); const payContext = c.context(); c.applyPendingWork(actor, 'pay', payContext);
    assert.equal(c.applyPendingWork(actor, 'pay', payContext).replayed, true);
    const paid = c.snapshotForCoordinator(); assert.equal(paid.movement.revision, before.movement.revision + 1);
    assert.equal(paid.movement.players[actor].donDeck.length, 8);
    assert.equal(paid.movement.players[actor].activeDon.length, pair.includes('activeDon') ? 0 : 1);
    assert.equal(paid.movement.players[actor].restDon.length, pair.includes('restDon') ? 1 : 2);
    assert.equal(paid.movement.players[actor].attachedDon.length, pair.includes('attachedDon') ? 0 : 1);
    assert.equal(paid.movementEvents.length, 3); assert.equal(paid.movementEvents.every(event => event.cause.kind === 'COST_PAYMENT'), true);
  }
});

test('mixed zones use only declared candidates and stop before selection if no complete payment exists', () => {
  for (const [from, count] of [[['activeDon', 'restDon'], 3], [['restDon', 'attachedDon'], 2]]) {
    const c = setup({ don: 2, restDon: 1, mutate: d => {
      d.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'DON_RETURN', count, from }];
    } }).coordinator, before = c.snapshotForCoordinator(); c.advance(0, 'short', c.context());
    assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.viewFor(0).frame.choice, null);
    assert.equal(c.snapshotForCoordinator().movement, before.movement);
  }
  const c = setup({ don: 3, restDon: 1, mutate: d => { d.effects[0].costs = [{ type: 'DON_RETURN', count: 1, from: ['restDon', 'attachedDon'] }]; } }).coordinator;
  c.advance(0, 'declared-only', c.context()); assert.deepEqual(c.viewFor(0).frame.choice.options.map(option => option.zone), ['restDon']);
  assert.equal(c.viewFor(0).frame.choice.maxActiveReturn, 0);
});

test('REST_SOURCE pays an active leader, character or stage once without changing its generation', () => {
  for (const actor of [0, 1]) for (const sourceKind of ['leader', 'character', 'stage']) {
    const s = setup({ actor, sourceKind, mutate: d => { d.effects[0].costs = [{ type: 'REST_SOURCE' }]; d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }]; } });
    const c = s.coordinator, before = c.snapshotForCoordinator(); c.advance(actor, 'source-plan', c.context());
    assert.equal(c.pendingWorkKind(), 'PAY_COSTS'); assert.equal(c.viewFor(actor).frame.choice, null);
    assert.equal(c.snapshotForCoordinator().movement, before.movement);
    const context = c.context(); c.applyPendingWork(actor, 'source-pay', context); assert.equal(c.applyPendingWork(actor, 'source-pay', context).replayed, true);
    const after = c.snapshotForCoordinator(); assert.equal(after.movement.cards[s.source.instanceId].rotated, true);
    assert.equal(after.movement.cards[s.source.instanceId].generation, s.source.generation);
    assert.equal(after.movement.players[actor].activeDon.length, 2); assert.equal(after.movement.players[actor].hand.length, 5);
    assert.equal(after.movementEvents.length, 1); assert.equal(after.movementEvents[0].cause.kind, 'COST_PAYMENT');
    c.advance(actor, 'draw-plan', c.context()); c.applyPendingWork(actor, 'draw', c.context()); c.advance(actor, 'done', c.context());
    assert.equal(c.viewFor(actor).frame.status, 'completed');
  }
});

test('source, DON and hand costs commit together, while rested sources or shortages leave everything unchanged', () => {
  const costs = d => { discardCosts(d); d.effects[0].costs.unshift({ type: 'REST_SOURCE' }); };
  for (const actor of [0, 1]) {
    const s = setup({ actor, mutate: costs }), c = s.coordinator, before = c.snapshotForCoordinator();
    c.advance(actor, 'start', c.context()); const choice = choose(s);
    c.answer(actor, 'choose', choice.context, choice.id, choice.tokens); c.advance(actor, 'plan', c.context());
    assert.equal(c.snapshotForCoordinator().movement, before.movement); c.applyPendingWork(actor, 'pay', c.context());
    const paid = c.snapshotForCoordinator(); assert.equal(paid.movement.revision, before.movement.revision + 1);
    assert.equal(paid.movement.cards[s.source.instanceId].rotated, true); assert.equal(paid.movement.players[actor].restDon.length, 1);
    assert.equal(paid.movement.players[actor].hand.length, 4); assert.equal(paid.movementEvents.length, 3);
    assert.equal(paid.movementEvents.every(e => e.cause.kind === 'COST_PAYMENT'), true);
    for (const options of [{ sourceRotated: true }, { don: 0 }, { handCount: 0 }]) {
      const blocked = setup({ actor, ...options, mutate: costs }).coordinator, initial = blocked.snapshotForCoordinator();
      blocked.advance(actor, 'unpayable', blocked.context()); assert.equal(blocked.viewFor(actor).frame.status, 'blocked');
      assert.equal(blocked.snapshotForCoordinator().movement, initial.movement); assert.equal(blocked.snapshotForCoordinator().movementEvents.length, 0);
      assert.equal(blocked.viewFor(actor).frame.choice, null);
    }
  }
});

test('composite DON and hand costs stay unchanged through choice, then commit both once in a single revision', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor, mutate: discardCosts, handFaceDown: true }), c = s.coordinator, initial = c.snapshotForCoordinator();
    c.advance(actor, 'cost-start', c.context()); const choice = choose(s); assert.equal(c.viewFor(actor).frame.choice.purpose, 'cost');
    assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []); assert.equal(c.snapshotForCoordinator().movement, initial.movement);
    assert.throws(() => c.answer(1 - actor, 'foreign-cost', choice.context, choice.id, choice.tokens));
    assert.throws(() => c.answer(actor, 'too-few', choice.context, choice.id, []));
    c.answer(actor, 'cost-choice', choice.context, choice.id, choice.tokens); assert.equal(c.snapshotForCoordinator().movement, initial.movement);
    c.advance(actor, 'cost-plan', c.context()); assert.equal(c.pendingWorkKind(), 'PAY_COSTS'); assert.equal(c.snapshotForCoordinator().movement, initial.movement);
    const context = c.context(); c.applyPendingWork(actor, 'pay-both', context); assert.equal(c.applyPendingWork(actor, 'pay-both', context).replayed, true);
    const paid = c.snapshotForCoordinator(); assert.equal(paid.movement.revision, initial.movement.revision + 1);
    assert.equal(paid.movement.players[actor].activeDon.length, 1); assert.equal(paid.movement.players[actor].restDon.length, 1);
    assert.equal(paid.movement.players[actor].hand.length, 4); assert.equal(paid.movement.players[actor].trash.length, 1);
    assert.equal(paid.movementEvents.length, 2); assert.equal(new Set(paid.movementEvents.map(e => e.eventId.split(':')[0])).size, 1);
    assert.equal(paid.movementEvents.every(e => e.cause.kind === 'COST_PAYMENT' && e.isKO === false), true);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].trash[0].cardId, c.viewFor(actor).movement.players[actor].trash[0].cardId);
    c.advance(actor, 'draw-plan', c.context()); c.applyPendingWork(actor, 'draw', c.context()); c.advance(actor, 'finish', c.context());
    assert.equal(c.viewFor(actor).frame.status, 'completed'); assert.equal(c.viewFor(actor).movement.players[actor].hand.length, 5);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  }
});

test('a shortage in either side of a composite cost causes no partial hand or DON payment', () => {
  for (const options of [{ don: 0 }, { handCount: 0 }]) {
    const c = setup({ ...options, mutate: discardCosts }).coordinator, before = c.snapshotForCoordinator(); c.advance(0, 'unpayable-cost', c.context());
    assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.snapshotForCoordinator().movement, before.movement); assert.equal(c.snapshotForCoordinator().movementEvents.length, 0);
  }
});

test('multiple discard cost nodes aggregate exact selections, and failed resolution conditions do not refund paid costs', () => {
  const c = setup({ mutate: d => {
    discardCosts(d); d.effects[0].costs = [{ type: 'DISCARD_HAND', count: 1 }, { type: 'DISCARD_HAND', count: 1 }];
    d.effects[0].resolutionConditions = { type: 'compare', left: 1, op: 'eq', right: 0 };
  } }).coordinator;
  c.advance(0, 'choose-two', c.context()); const choice = c.viewFor(0).frame.choice; assert.equal(choice.min, 2); assert.equal(choice.max, 2);
  c.answer(0, 'two', c.context(), choice.selectionId, choice.options.slice(0, 2).map(option => option.token)); c.advance(0, 'plan', c.context()); c.applyPendingWork(0, 'pay-two', c.context());
  c.advance(0, 'no-effect', c.context()); const v = c.viewFor(0);
  assert.equal(v.frame.status, 'completed'); assert.equal(v.movement.players[0].hand.length, 3); assert.equal(v.movement.players[0].trash.length, 2);
  assert.equal(v.movement.players[0].activeDon.length, 2); assert.equal(v.movement.players[0].restDon.length, 0);
});

test('private hand discard is published only after the move and subsequent draw stays hidden for both actors', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor, mutate: privateHand, handFaceDown: true }), c = s.coordinator, before = c.snapshotForCoordinator(), selectedId = before.movement.players[actor].hand[0];
    assert.equal(before.movement.cards[selectedId].faceUp, false);
    c.advance(actor, 'private-start', c.context()); const choice = choose(s);
    assert.equal(c.viewFor(actor).frame.choice.options.length, 5); assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
    assert.throws(() => c.answer(1 - actor, 'foreign-hand', choice.context, choice.id, choice.tokens));
    assert.throws(() => c.answer(actor, 'cannot-skip', choice.context, choice.id, []));
    c.answer(actor, 'private-answer', choice.context, choice.id, choice.tokens); c.advance(actor, 'discard-request', c.context());
    const context = c.context(); c.applyPendingWork(actor, 'discard', context); assert.equal(c.applyPendingWork(actor, 'discard', context).replayed, true);
    const moved = c.snapshotForCoordinator(), event = moved.movementEvents.find(e => e.before?.instanceId === selectedId);
    assert.equal(moved.movement.players[actor].hand.length, 4); assert.equal(moved.movement.players[actor].trash.includes(selectedId), true);
    assert.equal(moved.movement.cards[selectedId].faceUp, true); assert.equal(event.cause.kind, 'EFFECT_MOVE'); assert.equal(event.isKO, false);
    assert.deepEqual(event.visibleBefore, [actor]); assert.deepEqual(event.visibleAfter, [0, 1]);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].trash[0].ref.instanceId, selectedId);
    c.advance(actor, 'draw-request', c.context()); c.applyPendingWork(actor, 'draw', c.context()); c.advance(actor, 'private-finish', c.context());
    const view = c.viewFor(actor); assert.equal(view.frame.status, 'completed'); assert.equal(view.movement.players[actor].hand.length, 5);
    assert.equal(view.movement.players[actor].activeDon.length, 2); assert.equal(view.movement.players[actor].restDon.length, 0);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  }
});

test('empty required hand selection stops without drawing, and allowing hand moves does not authorize hand KO', () => {
  const empty = setup({ mutate: privateHand, handCount: 0 }).coordinator, before = empty.snapshotForCoordinator();
  assert.throws(() => empty.advance(0, 'no-hand', empty.context())); assert.equal(empty.snapshotForCoordinator().movement, before.movement); assert.equal(empty.snapshotForCoordinator().frame, before.frame);
  const s = setup({ mutate: d => { privateHand(d); d.effects[0].actions[1] = { type: 'KO', cards: { ref: 'bindings.picked' } }; } }), c = beginFieldWork(s), state = c.snapshotForCoordinator().movement;
  c.applyPendingWork(0, 'illegal-hand-ko', c.context()); assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.snapshotForCoordinator().movement, state);
});

test('effect KO emits a KO event and returns attached DON, unlike a direct move to trash', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor, attach: true, mutate: fieldActions('KO') }), c = beginFieldWork(s), context = c.context();
    c.applyPendingWork(actor, 'ko', context); assert.equal(c.applyPendingWork(actor, 'ko', context).replayed, true);
    const snapshot = c.snapshotForCoordinator(), event = snapshot.movementEvents.find(e => e.before?.instanceId === s.target.instanceId);
    assert.equal(snapshot.movement.players[actor].character[1], null); assert.equal(snapshot.movement.players[actor].trash.includes(s.target.instanceId), true);
    assert.equal(event.cause.kind, 'EFFECT_KO'); assert.equal(event.isKO, true); assert.equal(event.cause.actor, actor);
    assert.equal(snapshot.movement.players[actor].attachedDon.length, 0); assert.equal(snapshot.movement.players[actor].restDon.length, 1);
    c.advance(actor, 'ko-finish', c.context()); assert.equal(c.viewFor(actor).frame.status, 'completed');
  }
  const moved = setup({ mutate: d => d.effects[0].actions[1].then[0].destination.zone = 'trash' }), c = beginFieldWork(moved);
  c.applyPendingWork(0, 'trash', c.context()); const event = c.snapshotForCoordinator().movementEvents.find(e => e.before?.instanceId === moved.target.instanceId);
  assert.equal(event.isKO, false); assert.equal(event.cause.kind, 'EFFECT_MOVE');
});

test('REST and SET_ACTIVE are absolute states, preserve object generation, and do not toggle on repeated operations', () => {
  const s = setup({ mutate: fieldActions('REST', 'REST', 'SET_ACTIVE', 'SET_ACTIVE') }), c = beginFieldWork(s);
  for (let i = 0; i < 4; i++) {
    c.applyPendingWork(0, `rest-step-${i}`, c.context()); const snapshot = c.snapshotForCoordinator();
    assert.equal(snapshot.movement.cards[s.target.instanceId].rotated, i < 2); assert.equal(snapshot.movement.cards[s.target.instanceId].generation, 0);
    c.advance(0, `rest-next-${i}`, c.context());
  }
  assert.equal(c.viewFor(0).frame.status, 'completed');
  assert.equal(c.snapshotForCoordinator().movementEvents.filter(e => e.kind === 'restChanged').length, 2);
});

test('KO refuses leaders and REST refuses trash targets without moving or changing any card', () => {
  for (const type of ['KO', 'REST']) {
    const s = setup({ deckCount: 10, mutate: d => {
      fieldActions(type)(d); const selector = d.effects[0].actions[0].selector;
      selector.zone = type === 'KO' ? 'leader' : 'trash'; selector.cardTypes = [type === 'KO' ? 'leader' : 'character']; selector.excludeSource = false; selector.filters = { type: 'all', conditions: [] };
    } }), c = beginFieldWork(s), before = c.snapshotForCoordinator();
    c.applyPendingWork(0, 'invalid-target', c.context()); assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.snapshotForCoordinator().movement, before.movement);
  }
});

test('a field reference becomes stale after KO and cannot affect the moved card in a later action', () => {
  const s = setup({ mutate: fieldActions('KO', 'SET_ACTIVE') }), c = beginFieldWork(s);
  c.applyPendingWork(0, 'ko', c.context()); c.advance(0, 'stale-request', c.context()); const before = c.snapshotForCoordinator();
  c.applyPendingWork(0, 'stale-work', c.context()); const after = c.snapshotForCoordinator();
  assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(after.movement, before.movement); assert.equal(after.movement.cards[s.target.instanceId].generation, 1);
});
test('public selection moves a real card through MovementEngine and releases progression only on completion for both seats', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor }), c = s.coordinator;
    assert.equal(c.viewFor(actor).progression.gate, 'resolving'); assert.equal(checkTiming(c.snapshotForCoordinator().progression, actor, 'endMain').allowed, false);
    const start = c.context(); c.advance(actor, 'start', start); assert.equal(c.advance(actor, 'start', start).replayed, true);
    assert.equal(c.viewFor(actor).progression.gate, 'choice'); assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
    const choice = choose(s); assert.throws(() => c.answer(1 - actor, 'foreign', choice.context, choice.id, choice.tokens));
    c.answer(actor, 'choose', choice.context, choice.id, choice.tokens); assert.equal(c.answer(actor, 'choose', choice.context, choice.id, choice.tokens).replayed, true);
    assert.equal(c.viewFor(actor).progression.gate, 'resolving'); c.advance(actor, 'to-work', c.context());
    const workContext = c.context(), before = c.snapshotForCoordinator(); c.applyPendingWork(actor, 'move', workContext);
    assert.equal(c.applyPendingWork(actor, 'move', workContext).replayed, true);
    const after = c.snapshotForCoordinator(); assert.equal(after.movement.revision, before.movement.revision + 1);
    assert.equal(after.movement.players[actor].character[1], null); assert.equal(after.movement.players[actor].hand.includes(s.target.instanceId), true);
    assert.equal(after.movement.cards[s.target.instanceId].generation, 1); assert.equal(after.movement.cards[s.source.instanceId].generation, 0);
    assert.equal(after.movementEvents[0].cause.kind, 'EFFECT_MOVE'); assert.equal(after.movementEvents[0].isKO, false);
    assert.equal(after.movementEvents[0].cause.source.instanceId, s.source.instanceId);
    assert.equal(c.viewFor(1 - actor).movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
    assert.deepEqual(Object.keys(after.movement.cards).sort(), Object.keys(before.movement.cards).sort());
    c.advance(actor, 'finish', c.context()); assert.equal(c.viewFor(actor).frame.status, 'completed'); assert.equal(c.viewFor(actor).progression.gate, 'idle');
    assert.throws(() => JSON.stringify(c));
  }
});
test('REST_DON pays an exact aggregated amount, draws privately, and never pays twice on retry', () => {
  const s = setup({ mutate: d => { d.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'REST_DON', count: 1 }]; d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }]; } }), c = s.coordinator;
  c.advance(0, 'start', c.context()); const cost = c.context(); c.applyPendingWork(0, 'pay', cost);
  assert.equal(c.applyPendingWork(0, 'pay', cost).replayed, true);
  assert.equal(c.viewFor(0).movement.players[0].activeDon.length, 0); assert.equal(c.viewFor(0).movement.players[0].restDon.length, 2);
  assert.equal(c.snapshotForCoordinator().movementEvents.every(event => event.cause.kind === 'COST_PAYMENT'), true);
  c.advance(0, 'draw-request', c.context()); c.applyPendingWork(0, 'draw', c.context()); c.advance(0, 'finish', c.context());
  assert.equal(c.viewFor(0).movement.players[0].hand.length, 6); assert.equal(c.viewFor(1).movement.players[0].hand.at(-1).cardId, null);
  assert.equal(c.viewFor(0).frame.status, 'completed');
});
test('insufficient composite DON payment leaves all DON active and blocks further progress', () => {
  const s = setup({ don: 1, mutate: d => d.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'REST_DON', count: 1 }] }), c = s.coordinator;
  c.advance(0, 'start', c.context()); const before = c.snapshotForCoordinator(); c.applyPendingWork(0, 'cannot-pay', c.context());
  const after = c.snapshotForCoordinator(); assert.equal(after.movement, before.movement); assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.equal(c.viewFor(0).progression.gate, 'resolving');
  assert.equal(after.movement.players[0].activeDon.length, 1); assert.equal(after.movement.players[0].restDon.length, 0);
});

test('real predicate evaluation honors boolean composition and preserves already-paid costs when resolution conditions fail', () => {
  const s = setup({ mutate: d => {
    d.effects[0].activationConditions = { type: 'not', condition: { type: 'any', conditions: [{ type: 'compare', left: 1, op: 'ne', right: 1 }] } };
    d.effects[0].resolutionConditions = { type: 'compare', left: { ref: 'SOURCE.power' }, op: 'lt', right: 0 };
    d.effects[0].costs = [{ type: 'REST_DON', count: 1 }]; d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }];
  } }), c = s.coordinator;
  c.advance(0, 'activation', c.context()); c.applyPendingWork(0, 'pay', c.context()); c.advance(0, 'condition-false', c.context());
  assert.equal(c.viewFor(0).frame.status, 'completed'); assert.equal(c.viewFor(0).progression.gate, 'idle');
  assert.equal(c.viewFor(0).movement.players[0].restDon.length, 1); assert.equal(c.viewFor(0).movement.players[0].hand.length, 5);
});
test('unknown numeric facts stop without advancing the frame, whereas face-down public-area cards are not candidates', () => {
  const s = setup({ missingStats: true }), c = s.coordinator, before = c.snapshotForCoordinator();
  assert.throws(() => c.advance(0, 'unknown', c.context())); const after = c.snapshotForCoordinator();
  assert.equal(after.frame, before.frame); assert.equal(after.movement, before.movement); assert.equal(after.progression, before.progression);
  const hidden = setup({ hidden: true, mutate: d => d.effects[0].actions[0].selector.zone = 'public' }).coordinator; hidden.advance(0, 'empty', hidden.context()); assert.equal(hidden.viewFor(0).frame.status, 'completed');
});
test('bouncing a character returns attached DON through existing automatic movement handling', () => {
  const s = setup({ attach: true }), c = s.coordinator; c.advance(0, 'start', c.context()); const choice = choose(s);
  c.answer(0, 'choose', choice.context, choice.id, choice.tokens); c.advance(0, 'work', c.context()); c.applyPendingWork(0, 'move', c.context());
  assert.equal(c.viewFor(0).movement.players[0].attachedDon.length, 0); assert.equal(c.viewFor(0).movement.players[0].restDon.length, 1);
});
test('deck-out and wrong ownership destinations are explicitly blocked without partial moves', () => {
  const empty = setup({ deckCount: 1, mutate: d => d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }] }).coordinator;
  empty.advance(0, 'start', empty.context()); const before = empty.snapshotForCoordinator(); empty.applyPendingWork(0, 'draw', empty.context());
  assert.equal(empty.snapshotForCoordinator().movement, before.movement); assert.equal(empty.viewFor(0).frame.status, 'blocked');
  const s = setup({ mutate: d => d.effects[0].actions[1].then[0].destination.owner = 'OPPONENT' }), c = s.coordinator;
  c.advance(0, 'start', c.context()); const choice = choose(s); c.answer(0, 'choose', choice.context, choice.id, choice.tokens); c.advance(0, 'work', c.context());
  const state = c.snapshotForCoordinator().movement; c.applyPendingWork(0, 'illegal', c.context()); assert.equal(c.snapshotForCoordinator().movement, state); assert.equal(c.viewFor(0).frame.status, 'blocked');
});
test('controller, context and replay guards reject unauthorized or changed requests; production is disabled', () => {
  const s = setup(), c = s.coordinator, start = c.context(); assert.throws(() => c.advance(1, 'foreign', start));
  assert.throws(() => c.advance(0, 'stale', { ...start, movementRevision: 99 })); c.advance(0, 'start', start);
  assert.throws(() => c.advance(0, 'start', c.context())); assert.throws(() => c.applyPendingWork(1, 'foreign-work', c.context()));
  assert.throws(() => new V3FixtureCoordinator({ ...s.options, identity: { ...s.options.identity, source: { instanceId: s.options.movement.players[0].leader[0], generation: 0 } } }));
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.throws(() => new V3FixtureCoordinator(s.options)); assert.throws(() => c.advance(0, 'production', c.context())); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
