const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, start, frame, play, finish, selector, id, always } = require('./helpers/v3-effect-play.cjs');
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
function approve(raw, template) {
  const p = compileV3CardJson(JSON.stringify(raw)), a = { status: 'approved', cardId: raw.cardId, cardVersion: raw.cardVersion, definitionHash: p.definitionHash, sourceHash: p.sourceHash,
    compilerVersion: p.compilerVersion, registryHash: p.registryHash, rulesetVersion: template.rulesetVersion, reviewer: 'synthetic-only', approvedAt: '2026-10-30T00:00:00.000Z', ruleEvidence: ['synthetic-not-real-card-approval'] };
  return new ApprovedV3Catalog([p], [a], a.rulesetVersion).get(raw.cardId);
}
const noDon = board => { for (const actor of [0, 1]) { board.players[actor].restDon.push(...board.players[actor].activeDon); for (const id of board.players[actor].activeDon) board.cards[id].rotated = true; board.players[actor].activeDon = []; } };
const colored = colors => ({ type: 'CARD_METADATA', subject: 'CANDIDATE', basis: 'CURRENT', field: 'colors', match: 'ANY', comparison: 'EXACT', values: colors });
function selectFirst(h, n = 1) {
  h.c.activate(h.actor, id(), h.c.context(), h.source, 'watch-0'); finish(h.c, h.actor);
  const q = h.c.viewFor(h.actor).frame.choice;
  h.c.answer(h.actor, id(), h.c.context(), q.selectionId, q.options.slice(0, n).map(r => r.token));
  h.c.advance(h.actor, id(), h.c.context());
}
for (const actor of [0, 1]) for (const enterState of ['ACTIVE', 'REST']) test(`hand effect play into first empty slot without printed DON payment (${actor}/${enterState})`, () => {
  const h = setup({ actor, enterState, board: noDon }), before = h.c.snapshotForCoordinator().movement, chosen = before.players[actor].hand[0];
  assert.equal(h.c.playableCardsFor(actor).find(r => r.card.instanceId === chosen).enabled, false);
  start(h); const after = h.c.snapshotForCoordinator().movement;
  assert.equal(after.players[actor].character[3], chosen); assert.equal(after.players[actor].hand.length, before.players[actor].hand.length - 1);
  assert.equal(after.cards[chosen].generation, before.cards[chosen].generation + 1); assert.equal(after.cards[chosen].faceUp, true);
  assert.equal(after.cards[chosen].rotated, enterState === 'REST'); assert.equal(after.cards[chosen].enteredTurn, after.turnNumber);
  for (const zone of ['activeDon', 'restDon', 'donDeck', 'attachedDon']) assert.deepEqual(after.players[actor][zone], before.players[actor][zone]);
  const event = h.c.snapshotForCoordinator().active.movementEvents.find(e => e.after?.instanceId === chosen);
  assert.equal(event.cause.kind, 'EFFECT_MOVE'); assert.equal(event.cause.effectController, actor);
});
test('sufficient DON is also left untouched by effect play', () => {
  const h = setup(), before = h.c.snapshotForCoordinator().movement; start(h); const after = h.c.snapshotForCoordinator().movement;
  assert.deepEqual(after.players[0].activeDon, before.players[0].activeDon); assert.deepEqual(after.players[0].restDon, before.players[0].restDon);
});
test('selection filters and playback conditions reject mismatching cards', () => {
  const h = setup({ condition: colored(['Blue']) }), before = h.c.snapshotForCoordinator().movement; start(h);
  assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(h.c.snapshotForCoordinator().movement, before);
  const empty = setup({ filter: colored(['Blue']), min: 0 }); empty.c.activate(0, id(), empty.c.context(), empty.source, 'watch-0'); finish(empty.c, 0);
  assert.equal(empty.c.viewFor(0).frame.choice, null); assert.equal(empty.c.viewFor(0).frame.status, 'completed');
});
test('optional selection of zero candidates completes without movement, reveal or fake trigger', () => {
  const h = setup({ filter: colored(['Blue']), min: 0 }), before = h.c.snapshotForCoordinator().movement; start(h, 0);
  assert.deepEqual(h.c.snapshotForCoordinator().movement, before); assert.deepEqual(h.c.viewFor(0).triggerChoices, []); assert.equal(h.c.viewFor(0).frame.status, 'completed');
});
test('unknown facts stop safely and never count as zero or a matching card', () => {
  const h = setup({ condition: { type: 'compare', left: { ref: 'CANDIDATE.current.power' }, op: 'gt', right: 0 }, definitions: cards => cards.map(card => {
    if (card.definition.cardId !== 'RED') return card; const raw = structuredClone(card.definition); raw.baseStats.power = null; return approve(raw, card);
  }) }), before = h.c.snapshotForCoordinator().movement;
  assert.throws(() => start(h), /unknown-predicate/); assert.deepEqual(h.c.snapshotForCoordinator().movement, before);
});
test('multiple selected cards enter distinct empty slots atomically in canonical server order', () => {
  const h = setup({ count: 2 }), before = h.c.snapshotForCoordinator().movement, ids = before.players[0].hand.slice(0, 2); start(h, 2);
  assert.deepEqual(h.c.snapshotForCoordinator().movement.players[0].character.slice(3), ids);
  assert.equal(new Set(h.c.snapshotForCoordinator().active.movementEvents.map(e => e.eventId)).size, 2);
});
test('insufficient or full slots refuse the whole work, never replace or partially enter', () => {
  for (const full of [false, true]) {
    const h = setup({ count: full ? 1 : 3, board: board => { if (full) for (const slot of [3, 4]) { const id = board.players[0].hand.shift(); board.players[0].character[slot] = id; board.cards[id].faceUp = true; } } });
    const before = h.c.snapshotForCoordinator().movement; start(h, full ? 1 : 3);
    assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(h.c.snapshotForCoordinator().movement, before);
    assert.deepEqual(h.c.viewFor(0).triggerChoices, []);
  }
});
test('wrong source zone, opponent card, and wrong kind cannot enter using effect play', () => {
  for (const owner of ['SELF', 'OPPONENT']) {
    const h = setup({ mutate: raw => { const s = selector(owner); Object.assign(s, { min: 1, max: 1, excludeSource: false }); raw.effects[0].actions[0].selector = s; } });
    const before = h.c.snapshotForCoordinator().movement; start(h); assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(h.c.snapshotForCoordinator().movement, before);
  }
  const h = setup({ mutate: raw => { raw.effects[0].actions[0].selector.cardTypes = ['event']; }, board: board => {
    for (const id of board.players[0].hand) Object.assign(board.cards[id], { kind: 'event', cardId: 'MAIN-EVENT-FIXTURE' });
  } }); const before = h.c.snapshotForCoordinator().movement; start(h); assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(h.c.snapshotForCoordinator().movement, before);
});
test('unknown card definition cannot be played by treating its missing values as unrestricted', () => {
  const h = setup({ definitions: cards => cards.filter(c => c.definition.cardId !== 'RED') }), before = h.c.snapshotForCoordinator().movement;
  start(h); assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(h.c.snapshotForCoordinator().movement, before);
});
test('effect play integrates MOVE_RESULT and AFTER public color memory without exposing private BEFORE', () => {
  const h = setup({ mutate: raw => raw.effects[0].actions.push({ type: 'MOVE_RESULT', bindAs: 'played' },
    { type: 'REMEMBER_FACTS', result: 'played', cards: { ref: 'bindings.chosen' }, snapshot: 'AFTER', basis: 'CURRENT', field: 'colors', bindAs: 'colors' }) }); start(h);
  const f = frame(h); assert.equal(f.resultScopes[0].played.rows[0].beforeColors.status, 'UNKNOWN'); assert.deepEqual(f.factScopes[0].colors.rows[0].value.value, ['Red']);
});
function withEntry(card) {
  if (card.definition.cardId !== 'RED') return card; const raw = structuredClone(card.definition); raw.source.text = 'Synthetic entry draw, no actual card approval.';
  raw.effects = ['entry-a', 'entry-b'].map(effectId => ({ id: effectId, kind: 'triggered', timing: { type: 'ON_PLAY' }, sourceZones: ['character'], optional: false, usageLimit: null,
    activationConditions: always(), resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }));
  return approve(raw, card);
}
test('ON_PLAY uses the new generation, waits for parent completion, and allows existing order selection', () => {
  const h = setup({ definitions: cards => cards.map(withEntry), mutate: raw => raw.effects[0].actions.push({ type: 'DRAW', player: 'SELF', count: 1 }) });
  selectFirst(h); h.c.applyPendingWork(0, id(), h.c.context()); const after = h.c.snapshotForCoordinator(); assert.equal(after.pendingTriggers.length, 2);
  assert.equal(after.active.frame.includes('completed'), false);
  const token = after.pendingTriggers[0].token; assert.throws(() => h.c.resolveTrigger(0, id(), h.c.context(), token)); finish(h.c, 0);
  const choices = h.c.viewFor(0).triggerChoices; assert.equal(choices.length, 2);
  const second = choices.find(c => c.effectId === 'entry-b'); h.c.resolveTrigger(0, id(), h.c.context(), second.token); finish(h.c, 0);
  const first = h.c.viewFor(0).triggerChoices.find(c => c.effectId === 'entry-a'); h.c.resolveTrigger(0, id(), h.c.context(), first.token); finish(h.c, 0);
  assert.equal(h.c.viewFor(0).triggerChoices.length, 0);
  const played = after.pendingTriggers[0].source; assert.equal(played.generation, after.movement.cards[played.instanceId].generation);
});
test('work replay is idempotent; stale request and duplicate card selection are refused', () => {
  const h = setup(); selectFirst(h); const context = h.c.context(), request = id(); h.c.applyPendingWork(0, request, context); const after = h.c.snapshotForCoordinator();
  assert.equal(h.c.applyPendingWork(0, request, context).replayed, true); assert.deepEqual(h.c.snapshotForCoordinator(), after);
  assert.throws(() => h.c.applyPendingWork(0, id(), context));
});
test('a stale hand ref is not followed to the trash or another generation', () => {
  const h = setup({ mutate: raw => raw.effects[0].actions.splice(1, 0, { type: 'MOVE_CARD', cards: { ref: 'bindings.chosen' }, destination: { owner: 'SELF', zone: 'trash', position: 'append', faceUp: true }, cause: 'EFFECT' }) }); start(h);
  assert.equal(h.c.viewFor(0).frame.status, 'blocked'); assert.equal(h.c.snapshotForCoordinator().movement.players[0].character.filter(Boolean).length, 3);
});
test('choice wait keeps hidden candidates private, locks other MAIN actions, and rejects forged replies', () => {
  const h = setup(); h.c.activate(0, id(), h.c.context(), h.source, 'watch-0'); finish(h.c, 0);
  const q = h.c.viewFor(0).frame.choice; assert.equal(q.options.length, 5); assert.deepEqual(h.c.viewFor(1).frame.choice.options, []);
  assert.throws(() => h.c.activate(0, id(), h.c.context(), h.source, 'watch-0'));
  assert.throws(() => h.c.answer(1, id(), h.c.context(), q.selectionId, [q.options[0].token]));
  assert.throws(() => h.c.answer(0, id(), h.c.context(), q.selectionId, ['forged']));
  assert.throws(() => h.c.answer(0, id(), h.c.context(), q.selectionId, [q.options[0].token, q.options[0].token]));
  const context = h.c.context(), request = id(), tokens = [q.options[0].token]; h.c.answer(0, request, context, q.selectionId, tokens);
  assert.equal(h.c.answer(0, request, context, q.selectionId, tokens).replayed, true); finish(h.c, 0);
  for (const actor of [0, 1]) for (const key of ['lastMoveResult', 'beforeColors', 'afterPrintedColors', 'factScopes']) assert.equal(JSON.stringify(h.c.viewFor(actor)).includes(key), false);
});
test('compiler rejects deck/life/opponent/invalid slot/implicit cost and old26 DSL', () => {
  const h = setup();
  for (const mutate of [r => { r.schemaVersion = '3.0.0-subset.26'; }, r => { r.effects[0].actions[1].from = 'deck'; }, r => { r.effects[0].actions[1].from = 'life'; },
    r => { r.effects[0].actions[1].destination.owner = 'OPPONENT'; }, r => { r.effects[0].actions[1].destination.slotPolicy = 'REPLACE'; },
    r => { r.effects[0].actions[1].destination.zone = 'stage'; }, r => { r.effects[0].actions[1].enterState = 'UNKNOWN'; }, r => { r.effects[0].actions[1].payCost = true; },
    r => { delete r.effects[0].actions[1].condition; }, r => { r.effects[0].actions[0].selector.max = 6; }]) {
    const raw = structuredClone(h.raw); mutate(raw); assert.throws(() => compileV3CardJson(JSON.stringify(raw)));
  }
  assert.equal(v3RegistryHash(builtinV3Registries('3.0.0-subset.26')), '711fa5cfeda8c91b84dc1ac7f955a52f5a0b9da4ddb46cb18d1f794595b9bc2d');
});
test('MAIN event uses the same work and pays its own printed cost, not the played character cost', () => {
  const { setup: eventBase } = require('./helpers/v3-event.cjs');
  const h = eventBase({ cost: 2, don: 2, mutate: raw => {
    raw.schemaVersion = '3.0.0-subset.27';
    const s = selector('SELF'); Object.assign(s, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, min: 1, max: 1, excludeSource: false });
    raw.effects[0].actions = [{ type: 'SELECT', selector: s, bindAs: 'chosen' }, play()];
  } });
  const board = structuredClone(h.options.movement);
  for (const instanceId of board.players[0].hand.slice(1)) Object.assign(board.cards[instanceId], { cardId: 'TARGET', kind: 'character' });
  const c = new V3SyntheticMatchCoordinator({ ...h.options, movement: board });
  const choice = c.mainEventChoicesFor(0).find(row => row.enabled); assert(choice);
  c.useMainEvent(0, id(), c.context(), choice.sourceToken, choice.effectId);
  assert.equal(c.snapshotForCoordinator().movement.players[0].restDon.length, 2);
  const q = c.viewFor(0).frame.choice; assert.equal(q.options.length, 4); assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  c.answer(0, id(), c.context(), q.selectionId, [q.options[0].token]); finish(c, 0);
  const after = c.snapshotForCoordinator().movement;
  assert.equal(after.players[0].character.filter(Boolean).length, 1); assert.equal(after.players[0].restDon.length, 2); assert.equal(after.players[0].activeDon.length, 0);
  assert.equal(after.cards[after.players[0].trash[0]].kind, 'event');
});
test('conditional other-entry watcher reuses transaction evidence and the existing trigger queue', () => {
  const h = setup({ mutate: raw => raw.effects.push({ id: 'watch-entry', kind: 'triggered', timing: { type: 'ON_EVENT', event: 'CARD_ENTERED',
    snapshot: 'TRANSACTION_AFTER', relation: 'OTHER', owner: 'SELF', controller: 'SELF', fromZones: ['hand'], toZones: ['character'], cardTypes: ['character'], filters: colored(['Red']) },
    sourceZones: ['leader'], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }) });
  start(h); const q = h.c.viewFor(0).triggerChoices.find(row => row.effectId === 'watch-entry'); assert(q);
  const record = h.c.snapshotForCoordinator().triggerObservations.records.find(row => row.effectId === 'watch-entry');
  assert.equal(record.result, true); assert.equal(record.context.cause.kind, 'EFFECT_MOVE');
  h.c.resolveTrigger(0, id(), h.c.context(), q.token); finish(h.c, 0); assert.equal(h.c.viewFor(0).triggerChoices.length, 0);
});
test('ON_PLAY can select and play a second hand character without recursive auto-resolution', () => {
  const h = setup({ definitions: cards => cards.map(card => {
    if (card.definition.cardId !== 'RED') return card; const raw = structuredClone(card.definition); raw.schemaVersion = '3.0.0-subset.27'; raw.source.text = 'Synthetic chained entry.';
    const s = selector('SELF'); Object.assign(s, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, min: 0, max: 1, excludeSource: false });
    raw.effects = [{ id: 'chain-entry', kind: 'triggered', timing: { type: 'ON_PLAY' }, sourceZones: ['character'], optional: false, usageLimit: null,
      activationConditions: always(), resolutionConditions: always(), costs: [], actions: [{ type: 'SELECT', selector: s, bindAs: 'chosen' }, play()] }];
    return approve(raw, card);
  }) }); start(h);
  const q = h.c.viewFor(0).triggerChoices[0]; h.c.resolveTrigger(0, id(), h.c.context(), q.token); finish(h.c, 0);
  const choice = h.c.viewFor(0).frame.choice; h.c.answer(0, id(), h.c.context(), choice.selectionId, [choice.options[0].token]); finish(h.c, 0);
  assert.equal(h.c.snapshotForCoordinator().movement.players[0].character.filter(Boolean).length, 5);
  assert.equal(h.c.viewFor(0).triggerChoices.length, 1); assert.equal(h.c.viewFor(0).frame.status, 'completed');
});
test('multiple instances with identical card numbers create distinct self-entry triggers only once', () => {
  const h = setup({ count: 2, definitions: cards => cards.map(withEntry) }); selectFirst(h, 2);
  const context = h.c.context(), request = id(); h.c.applyPendingWork(0, request, context); finish(h.c, 0);
  const triggers = h.c.snapshotForCoordinator().pendingTriggers;
  assert.equal(triggers.length, 4); assert.equal(new Set(triggers.map(row => row.source.instanceId)).size, 2);
  assert.equal(h.c.applyPendingWork(0, request, context).replayed, true); assert.equal(h.c.snapshotForCoordinator().pendingTriggers.length, 4);
});
test('opponent sees the played public card but none of the remaining hand refs or card IDs', () => {
  const h = setup(); start(h); const visible = h.c.viewFor(1).movement.players[0];
  assert.equal(visible.character[3].cardId, 'RED');
  for (const card of visible.hand) { assert.equal(card.cardId, null); assert.equal(card.ref, null); }
});
test('required selection with no eligible candidates stops without fabricating a card', () => {
  const h = setup({ filter: colored(['Blue']) }), before = h.c.snapshotForCoordinator().movement;
  h.c.activate(0, id(), h.c.context(), h.source, 'watch-0'); assert.throws(() => finish(h.c, 0), /insufficient-candidates/);
  assert.equal(h.c.viewFor(0).frame.status, 'ready'); assert.deepEqual(h.c.snapshotForCoordinator().movement, before);
});
