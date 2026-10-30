const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, always } = require('./helpers/v3-event.cjs');
const { compileV3CardJson, builtinV3Registries, v3RegistryHash } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { trackMovementOccurrences, movementOccurrence } = require('../dist/test/movement/occurrence.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { observeConditionalTriggers, emptyTriggerObservations, validateObservedSource } = require('../dist/test/effects/v3/conditionalTriggers.js');
const timing = () => ({ type: 'ON_EVENT', event: 'CARD_ENTERED', snapshot: 'TRANSACTION_AFTER', relation: 'OTHER',
  owner: 'SELF', controller: 'SELF', fromZones: ['hand'], toZones: ['character'], cardTypes: ['character'], filters: always() });
function harness({ condition = always(), mutateTiming = () => {}, sourceType = 'leader', activePlayer = 0, field = 1, eventMutate = () => {}, mutateTarget = () => {} } = {}) {
  const { options, approval } = setup({ field, mutate: eventMutate });
  const approve = raw => {
    const p = compileV3CardJson(JSON.stringify(raw));
    return new ApprovedV3Catalog([p], [{ ...approval, cardId: raw.cardId, definitionHash: p.definitionHash, sourceHash: p.sourceHash,
      compilerVersion: p.compilerVersion, registryHash: p.registryHash }], approval.rulesetVersion).get(raw.cardId);
  };
  const definitions = new Map(options.cards.map(card => [card.definition.cardId, card]));
  const target = structuredClone(definitions.get('TARGET').definition); mutateTarget(target); definitions.set('TARGET', approve(target));
  const raw = structuredClone([...definitions.values()].find(c => c.definition.cardType === sourceType).definition);
  raw.schemaVersion = '3.0.0-subset.21'; raw.source.text = 'Synthetic conditional observer, not a complete official card.';
  const t = timing(); mutateTiming(t);
  raw.effects = [{ id: 'observe', kind: 'triggered', timing: t, sourceZones: [sourceType], optional: false, usageLimit: null,
    activationConditions: condition, resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }];
  const plan = compileV3CardJson(JSON.stringify(raw));
  definitions.set(raw.cardId, approve(raw));
  const board = structuredClone(options.movement);
  for (const player of [0, 1]) for (const id of board.players[player].hand) Object.assign(board.cards[id], { cardId: 'TARGET', kind: 'character' });
  trackMovementOccurrences(board);
  return { board, definitions, raw, plan, options: { ...options, movement: board, cards: [...definitions.values()] }, activePlayer };
}
function move(h, player = 0, { from = 'hand', to = 'character', cause = 'EFFECT_MOVE', ids, transactionId = 'conditional-move' } = {}) {
  ids ??= [h.board.players[player][from].find(Boolean)];
  return new MovementStore(h.board).commit({ transactionId, matchId: h.board.matchId, expectedRevision: h.board.revision, turnNumber: h.board.turnNumber,
    actor: player, effectController: player, source: null, mode: 'effect', resolutionId: 'conditional-test', operations: ids.map(id => ({ kind: 'move',
      card: { instanceId: id, generation: h.board.cards[id].generation }, from: { player, zone: from },
      to: { player, zone: to, position: to === 'character' ? 'firstEmpty' : 'append', faceUp: true, rotated: false }, cause })) }, { status: 'certifiedNone' });
}
const observe = (h, result, ledger = emptyTriggerObservations()) => observeConditionalTriggers(ledger, result.events, h.definitions, h.activePlayer);

test('own and opponent entry use source controller, not screen position', () => {
  for (const player of [0, 1]) {
    const h = harness(), rows = observe(h, move(h, player)).records;
    assert.equal(rows.find(r => r.context.effectController === player).result, true);
    assert.equal(rows.find(r => r.context.effectController !== player).result, false);
    assert(rows.every(r => r.context.chooser === null));
  }
});
test('SELF entry uses the new generation; OTHER excludes that instance', () => {
  const h = harness({ sourceType: 'character', mutateTiming: t => { t.relation = 'SELF'; } });
  const result = move(h), rows = observe(h, result).records;
  assert.equal(rows.length, 1); assert.equal(rows[0].result, true);
  assert.deepEqual(rows[0].source, rows[0].target); assert.equal(validateObservedSource(rows[0], result.state, h.definitions), 'CURRENT');
});
test('printed trait filter reuses PR02 metadata evaluator with literal Japanese strings', () => {
  for (const name of ['麦わらの一味', '麦わらの一味 ']) {
    const h = harness({ mutateTarget: d => { d.traits = ['超新星', '麦わらの一味']; }, mutateTiming: t => { t.filters = { type: 'CARD_METADATA', subject: 'CANDIDATE', basis: 'PRINTED', field: 'traits', match: 'ANY', comparison: 'EXACT', values: [name] }; } });
    assert.equal(observe(h, move(h)).records.find(r => r.context.effectController === 0).result, name === '麦わらの一味');
  }
});
test('own/opponent turn conditions are relative to each observer', () => {
  for (const activePlayer of [0, 1]) {
    const h = harness({ activePlayer, condition: { type: 'TURN_IS', player: 'SELF' }, mutateTiming: t => { t.owner = t.controller = 'ANY'; } });
    const rows = observe(h, move(h)).records;
    assert.equal(rows.find(r => r.context.effectController === activePlayer).result, true);
    assert.equal(rows.find(r => r.context.effectController !== activePlayer).result, false);
  }
});
test('KO detection distinguishes KO from direct trash and preserves old source facts', () => {
  for (const cause of ['EFFECT_KO', 'EFFECT_MOVE']) {
    const h = harness({ sourceType: 'character', mutateTiming: t => { Object.assign(t, { event: 'CARD_KO', snapshot: 'TRANSACTION_BEFORE', relation: 'SELF', fromZones: ['character'], toZones: ['trash'] }); } });
    const result = move(h, 0, { from: 'character', to: 'trash', cause }), rows = observe(h, result).records;
    assert.equal(rows.length, cause === 'EFFECT_KO' ? 1 : 0);
    if (rows.length) { assert.equal(rows[0].result, true); assert.equal(validateObservedSource(rows[0], result.state, h.definitions), 'STALE'); }
  }
});
test('movement observes before and after instance generations and cause separately', () => {
  const h = harness({ mutateTiming: t => { Object.assign(t, { event: 'CARD_MOVED', snapshot: 'TRANSACTION_BEFORE', fromZones: ['character'], toZones: ['hand'] }); } });
  const result = move(h, 0, { from: 'character', to: 'hand' }), rows = observe(h, result).records;
  const r = rows.find(r => r.result === true);
  assert.equal(r.context.cause.kind, 'EFFECT_MOVE'); assert.equal(r.context.cause.actor, 0);
  assert.equal(r.context.movement.targetAfter.generation, r.context.movement.targetBefore.generation + 1);
  assert.equal(r.context.movement.from.zone, 'character'); assert.equal(r.context.movement.to.zone, 'hand');
});
test('multiple movement events retain batch/operation evidence but hold ambiguous timing', () => {
  const h = harness(), ids = h.board.players[0].hand.slice(0, 2), result = move(h, 0, { ids });
  const rows = observe(h, result).records;
  assert.equal(new Set(rows.map(r => r.eventId)).size, 2); assert.equal(new Set(rows.map(r => r.groupId)).size, 2);
  assert(rows.every(r => r.result === 'unknown' && r.reason === 'MULTI_MOVE_TIMING_UNRESOLVED'));
  assert.equal(movementOccurrence(result.events[0]), movementOccurrence(result.events[1]));
  assert.equal(new Set(rows.map(r => r.transactionId)).size, 1);
});
test('event replay is idempotent; conflicting or fabricated evidence is rejected', () => {
  const h = harness(), result = move(h), first = observe(h, result), second = observe(h, result, first);
  assert.deepEqual(first, second);
  assert.throws(() => observe(h, { events: [{ ...result.events[0], isKO: true }] }, first), /event-conflict/);
  assert.throws(() => observe(h, { events: structuredClone(result.events) }), /occurrence-evidence-required/);
});
test('unknown printed power is not false or zero', () => {
  const h = harness({ mutateTiming: t => { t.filters = { type: 'compare', left: { ref: 'CANDIDATE.printed.power' }, op: 'gte', right: 0 }; } });
  h.board.cards[h.board.players[0].hand[0]].cardId = 'MISSING-METADATA';
  const rows = observe(h, move(h)).records;
  assert.equal(rows.find(r => r.context.effectController === 0).result, 'unknown');
});
test('hidden moved card is UNKNOWN to opponent, not a readable metadata candidate', () => {
  const h = harness({ mutateTiming: t => { Object.assign(t, { event: 'CARD_MOVED', owner: 'ANY', controller: 'ANY', fromZones: ['character'], toZones: ['hand'] }); } });
  const rows = observe(h, move(h, 0, { from: 'character', to: 'hand' })).records;
  assert.equal(rows.find(r => r.context.effectController === 0).result, true);
  assert.equal(rows.find(r => r.context.effectController === 1).result, 'unknown');
});
test('later movement does not retarget or recompute an occurrence-time condition', () => {
  const h = harness(), first = move(h), ledger = observe(h, first), row = ledger.records.find(r => r.result === true);
  const sourceId = row.source.instanceId, later = structuredClone(first.state); later.cards[sourceId].generation++;
  assert.equal(validateObservedSource(row, later, h.definitions), 'STALE'); assert.equal(row.result, true);
});
test('coordinator commits held candidate and blocks further MAIN without leaking ledger', () => {
  const h = harness(), c = new V3SyntheticMatchCoordinator(h.options), card = c.playableCardsFor(0).find(r => r.enabled).card;
  const expected = c.context(); c.playCard(0, 'play-held', expected, card);
  assert.equal(c.viewFor(0).conditionalTriggerHold, true); assert.equal(c.viewFor(1).conditionalTriggerHold, true);
  assert(c.snapshotForCoordinator().triggerObservations.records.some(r => r.result === true));
  assert(!JSON.stringify(c.viewFor(1)).includes('triggerObservations'));
  const after = c.snapshotForCoordinator(); assert.throws(() => c.endTurn(0, 'held-turn', c.context()), /held-pr06b/);
  assert.deepEqual(c.snapshotForCoordinator(), after); assert.equal(c.playCard(0, 'play-held', expected, card).replayed, true);
});
test('stale revision is rejected before payment or trigger recording', () => {
  const h = harness(), c = new V3SyntheticMatchCoordinator(h.options), card = c.playableCardsFor(0).find(r => r.enabled).card;
  const expected = { ...c.context(), revision: 999 }, before = c.snapshotForCoordinator();
  assert.throws(() => c.playCard(0, 'stale-event', expected, card), /stale/); assert.deepEqual(c.snapshotForCoordinator(), before);
});
test('unsupported timing parameters and old profile conditional nodes are rejected', () => {
  const { raw } = harness();
  for (const mutate of [d => { d.schemaVersion = '3.0.0-subset.20'; }, d => { d.effects[0].timing.event = 'ON_BLOCK'; },
    d => { d.effects[0].timing.fromZones = ['resolving']; }, d => { d.effects[0].timing.cardTypes = ['don']; },
    d => { d.effects[0].activationConditions = { type: 'TURN_IS', player: 'BOTH' }; }]) {
    const d = structuredClone(raw); mutate(d); assert.throws(() => compileV3CardJson(JSON.stringify(d)));
  }
});
test('old registry hashes are preserved, new handlers exist only in profile21', () => {
  for (const [version, hash] of [[16, '44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763'], [17, 'd18b0e340ce690d8a7e864aacf7c41974d8a9b9d233766afc512a795e6abf8d9'],
    ...[18, 19, 20].map(v => [v, 'ca4ae5ac8cc70eefa20ee7411ce0e54a305a07b43fd503f6a387ef0b5dd80916'])]) assert.equal(v3RegistryHash(builtinV3Registries(`3.0.0-subset.${version}`)), hash);
  assert(builtinV3Registries('3.0.0-subset.21').timing.manifest().includes('ON_EVENT@candidate.1'));
});

test('QUERY/COUNT reuse occurrence snapshot instead of the subsequent board', () => {
  for (const snapshot of ['TRANSACTION_BEFORE', 'TRANSACTION_AFTER']) {
    const condition = { type: 'COUNT', query: { type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', visibility: 'PUBLIC',
      faceUpOnly: true, cardTypes: ['character'], filters: always(), excludeSource: false }, op: 'gte', value: 1 };
    const h = harness({ field: 0, condition, mutateTiming: t => { t.snapshot = snapshot; } });
    assert.equal(observe(h, move(h)).records.find(r => r.context.effectController === 0).result, snapshot === 'TRANSACTION_AFTER');
  }
});
test('HAS_ABILITY uses printed/granted facts without inventing ability tags', () => {
  const h = harness({ mutateTarget: d => { d.keywords = [{ type: 'BLOCKER' }]; d.source.text = 'Synthetic blocker'; },
    mutateTiming: t => { t.filters = { type: 'HAS_ABILITY', subject: 'CANDIDATE', basis: 'PRINTED', ability: 'BLOCKER' }; } });
  assert.equal(observe(h, move(h)).records.find(r => r.context.effectController === 0).result, true);
});
test('private-query truth is held UNKNOWN rather than leaking through a public flag', () => {
  const condition = { type: 'COUNT', query: { type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'hand', visibility: 'OWNER_ONLY',
    faceUpOnly: false, cardTypes: ['character'], filters: always(), excludeSource: false }, op: 'eq', value: 0 };
  const h = harness({ condition });
  assert.equal(observe(h, move(h)).records.find(r => r.context.effectController === 0).result, 'unknown');
});
test('events generated while a PR05b selection resumes are retained and never paid twice', () => {
  const h = harness({ mutateTiming: t => { Object.assign(t, { event: 'CARD_KO', snapshot: 'TRANSACTION_BEFORE', fromZones: ['character'], toZones: ['trash'], owner: 'ANY', controller: 'ANY' }); },
    eventMutate: d => {
      d.schemaVersion = '3.0.0-subset.20'; d.effects[0].actions = [
        { type: 'SELECT', selector: { type: 'CARDS', owner: 'OPPONENT', controller: 'OPPONENT', chooser: 'OPPONENT', zone: 'character', visibility: 'PUBLIC',
          faceUpOnly: true, cardTypes: ['character'], filters: always(), excludeSource: false, min: 1, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' }, bindAs: 'target' },
        { type: 'KO', cards: { ref: 'bindings.target' } }, { type: 'DRAW', player: 'SELF', count: 1 }];
    } });
  // Restore one real event in hand; the rest remain synthetic characters.
  const eventId = h.options.movement.players[0].hand[0]; Object.assign(h.options.movement.cards[eventId], { cardId: 'MAIN-EVENT-FIXTURE', kind: 'event' });
  const c = new V3SyntheticMatchCoordinator(h.options), e = c.mainEventChoicesFor(0)[0];
  c.useMainEvent(0, 'declare-interrupted', c.context(), e.sourceToken, e.effectId);
  const choice = c.viewFor(1).frame.choice, before = c.snapshotForCoordinator();
  assert.equal(choice.chooser, 1); assert.deepEqual(c.viewFor(0).frame.choice.options, []);
  assert.throws(() => c.answer(0, 'wrong-chooser', c.context(), choice.selectionId, [choice.options[0].token]));
  assert.deepEqual(c.snapshotForCoordinator(), before);
  c.answer(1, 'answer-interrupted', c.context(), choice.selectionId, [choice.options[0].token]);
  let heldDuringWork = false;
  for (let i = 0; i < 20 && c.viewFor(0).frame.status !== 'completed'; i++) {
    const status = c.viewFor(0).frame.status, context = c.context(), request = `resume-observer-${i}`;
    if (status === 'ready') c.advance(0, request, context);
    else { c.applyPendingWork(0, request, context); assert.equal(c.applyPendingWork(0, request, context).replayed, true); }
    heldDuringWork ||= c.viewFor(0).conditionalTriggerHold;
  }
  assert.equal(c.viewFor(0).frame.status, 'completed'); assert.equal(heldDuringWork, true);
  assert.equal(c.snapshotForCoordinator().movement.players[0].restDon.length, 2);
  assert.equal(c.snapshotForCoordinator().triggerObservations.records.filter(r => r.result === true).length, 2);
  assert(c.snapshotForCoordinator().triggerObservations.records.every(r => r.causeEffectId === 'main'));
  assert.throws(() => c.endTurn(0, 'after-observer', c.context()), /held-pr06b/);
});
test('conditional observation cannot bypass PR06b by directly invoking the resolution machine', () => {
  const { V3ResolutionMachine } = require('../dist/test/effects/v3/resolution.js');
  const h = harness(), source = h.board.cards[h.board.players[0].leader[0]], card = h.definitions.get(source.cardId);
  assert.throws(() => new V3ResolutionMachine(card, { matchId: h.board.matchId, actor: 0, source: { instanceId: source.instanceId, generation: source.generation },
    resolutionId: 'bypass-held', effectId: 'observe' }, Buffer.alloc(32, 1), {}), /resolution-deferred-pr06b/);
});
test('failed movement and capacity preflight retain the original match and ledger', () => {
  const h = harness(), c = new V3SyntheticMatchCoordinator(h.options), before = c.snapshotForCoordinator();
  const card = c.playableCardsFor(0).find(r => r.enabled).card;
  assert.throws(() => c.playCard(0, 'bad-slot', c.context(), card, 0)); assert.deepEqual(c.snapshotForCoordinator(), before);
  const result = move(h), full = { events: Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`seen-${i}`, 'hash'])), records: [] };
  assert.throws(() => observe(h, result, full), /event-limit/); assert.equal(full.records.length, 0);
  const fullRows = { events: {}, records: Array(4096).fill({ status: 'NOT_MATCHED' }) };
  assert.throws(() => observe(h, result, fullRows), /observation-limit/); assert.equal(fullRows.records.length, 4096);
});
test('turn-boundary movement uses the incoming active player and is not silently lost', () => {
  const h = harness({ mutateTiming: t => { Object.assign(t, { event: 'CARD_MOVED', fromZones: ['deck'], toZones: ['hand'], owner: 'SELF', controller: 'SELF', cardTypes: ['event', 'character'] }); }, condition: { type: 'TURN_IS', player: 'SELF' } });
  const c = new V3SyntheticMatchCoordinator(h.options); c.endTurn(0, 'turn-with-observer', c.context());
  const records = c.snapshotForCoordinator().triggerObservations.records;
  assert(records.length > 0); assert(records.every(row => row.activePlayer === 1));
  assert.equal(records.find(row => row.context.effectController === 1).result, true);
  assert.equal(records.find(row => row.context.effectController === 0).result, 'unknown');
});
test('existing deck-out outcome takes precedence over a newly held draw observation', () => {
  const h = harness({ mutateTiming: t => { Object.assign(t, { event: 'CARD_MOVED', fromZones: ['deck'], toZones: ['hand'], cardTypes: ['event', 'character'] }); } });
  for (const id of h.board.players[1].deck.splice(1)) delete h.board.cards[id];
  const c = new V3SyntheticMatchCoordinator(h.options); c.endTurn(0, 'deck-out-observer', c.context());
  assert.equal(c.viewFor(0).outcome.winner, 0); assert(c.snapshotForCoordinator().triggerObservations.records.length > 0);
});
