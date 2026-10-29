const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileV3CardJson, builtinV3Registries, v3RegistryHash, supportsV3RuntimeProfile } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { loadReviewedV3Catalog } = require('../dist/test/effects/v3/reviewedCatalog.js');
const { createDerivedCardFactsReader, UNKNOWN } = require('../dist/test/effects/v3/readContext.js');
const { fixtureEnvironment } = require('../dist/test/effects/v3/fixtureEnvironment.js');
const { V3FixtureCoordinator } = require('../dist/test/effects/v3/fixtureCoordinator.js');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { pinMasterFacts } = require('../dist/test/effects/masterFacts.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { addKeywordGrants, endTurnKeywordGrants } = require('../dist/test/effects/v3/keywordEffects.js');
const always = () => ({ type: 'all', conditions: [] });
const name = (value, op = 'eq', subject = 'CANDIDATE', basis = 'PRINTED') => ({ type: 'CARD_NAME', subject, basis, op, value });
const meta = (field, values, match = 'ANY', comparison = 'EXACT', basis = 'PRINTED') => ({ type: 'CARD_METADATA', subject: 'CANDIDATE', basis, field, match, comparison, values });
const ability = (tag, basis = 'PRINTED', subject = 'CANDIDATE') => ({ type: 'HAS_ABILITY', subject, basis, ability: tag });
const effect = actions => ({ id: 'main', kind: 'activated', timing: { type: 'MAIN' }, sourceZones: ['leader'], optional: false, usageLimit: null,
  activationConditions: always(), resolutionConditions: always(), costs: [], actions });
function definition(cardId, cardName, patch = {}) {
  return { schemaVersion: '3.0.0-subset.17', cardId, cardVersion: 'synthetic.1', name: cardName, cardType: 'character',
    baseStats: { cost: 2, power: 3000, counter: 1000, life: null }, colors: ['赤'], traits: ['麦わらの一味', '超新星'], attributes: ['斬'], keywords: [], reviewStatus: 'approved',
    source: { text: '', triggerText: '', displayIds: [cardId], datasetSha256: '0'.repeat(64) }, effects: [], ...patch };
}
function leader(actions = [{ type: 'DRAW', player: 'SELF', count: 1 }]) {
  return definition('META-LEADER', '合成検証専用リーダー', { cardType: 'leader', baseStats: { cost: null, power: 5000, counter: null, life: 5 },
    source: { text: 'Synthetic metadata regression only; not an official card ability.', triggerText: '', displayIds: ['META-LEADER'], datasetSha256: '0'.repeat(64) }, effects: [effect(actions)] });
}
function plans(definitions) {
  const compiled = definitions.map(d => compileV3CardJson(JSON.stringify(d)));
  const approvals = compiled.map(plan => ({ status: 'approved', cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion,
    definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash,
    rulesetVersion: 'synthetic-metadata.1', reviewer: 'unit-test-not-real-card-approval', approvedAt: '2026-10-29T00:00:00.000Z', ruleEvidence: ['synthetic-kernel-only'] }));
  return { compiled, approvals, catalog: new ApprovedV3Catalog(compiled, approvals, 'synthetic-metadata.1') };
}
function setup({ source = leader(), actor = 0, zero = false } = {}) {
  const trigger = definition('META-TRIGGER', 'トリガー実体', { source: { text: '', triggerText: 'Synthetic trigger draw.', displayIds: ['META-TRIGGER'], datasetSha256: '0'.repeat(64) },
    effects: [{ ...effect([{ type: 'DRAW', player: 'SELF', count: 1 }]), id: 'trigger', kind: 'triggered', timing: { type: 'TRIGGER' }, sourceZones: ['life'] }] });
  const mention = definition('META-MENTION', 'タグ言及のみ', { source: { text: 'Synthetic text mentions 【トリガー】 cards; no own trigger.', triggerText: '', displayIds: ['META-MENTION'], datasetSha256: '0'.repeat(64) },
    effects: [{ ...effect([{ type: 'DRAW', player: 'SELF', count: 1 }]), sourceZones: ['character'] }] });
  const raw = [source, definition('META-NAMI', 'ナミ'), definition('META-LUFFY', 'ルフィ', { schemaVersion: '3.0.0-subset.16', colors: ['赤', '緑'], attributes: ['打', '特'] }),
    definition('META-OTHER', '別特徴', { traits: ['B・Wエージェント'], colors: ['黄'], attributes: ['特'], keywords: [{ type: 'BLOCKER' }],
      source: { text: 'Synthetic printed blocker.', triggerText: '', displayIds: ['META-OTHER'], datasetSha256: '0'.repeat(64) } }), trigger, mention];
  const p = plans(raw), defs = raw.map(d => p.catalog.get(d.cardId)), definitions = new Map(defs.map(c => [c.definition.cardId, c]));
  const recipe = { name: 'Synthetic metadata', leaderCardId: source.cardId, mainDeck: Array.from({ length: 50 }, (_, i) => raw[1 + i % (raw.length - 1)].cardId), donDeck: Array(10).fill('DON'),
    cardTypes: Object.fromEntries(raw.map(d => [d.cardId, d.cardType])), leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe), zones = match.players[actor].zones;
  function take(id) {
    for (const zone of ['deck', 'hand', 'life']) {
      const i = zones[zone].findIndex(c => c.cardId === id);
      if (i >= 0) { const card = zones[zone].splice(i, 1)[0]; if (zone !== 'deck') zones[zone].splice(i, 0, { ...zones.deck.shift(), faceUp: zone === 'hand', rotated: false }); return card; }
    }
    throw Error('Missing fixture ' + id);
  }
  zones.character[0] = { ...take('META-LUFFY'), faceUp: true, rotated: false };
  zones.character[1] = { ...take('META-OTHER'), faceUp: true, rotated: false };
  const top = (zero ? Array(5).fill('META-OTHER') : ['META-NAMI', 'META-LUFFY', 'META-OTHER', 'META-TRIGGER', 'META-MENTION']).map(take);
  zones.deck.unshift(...top.map(c => ({ ...c, faceUp: false })));
  let board = new MatchMovementCapture(match, 1).snapshot().movement, grants = [];
  const ref = id => ({ instanceId: id, generation: board.cards[id].generation });
  const identity = { matchId: board.matchId, resolutionId: 'metadata', effectId: 'main', actor, source: ref(board.players[actor].leader[0]) };
  const options = { board: () => board, definitions, statEffects: () => [], keywordGrants: () => grants, activePlayer: actor };
  const environment = () => fixtureEnvironment(() => board, identity, defs[0], pinMasterFacts(board, { master: null, numericPolicy: 'certifiedUnmodified' }), () => 1000,
    defs, () => [], actor, () => 0, undefined, () => grants);
  const commit = operations => {
    const r = new MovementStore(board).commit({ transactionId: `meta-${board.revision}`, matchId: board.matchId, expectedRevision: board.revision, turnNumber: board.turnNumber,
      actor, effectController: actor, source: identity.source, mode: 'effect', resolutionId: identity.resolutionId, operations }, { status: 'certifiedNone' }); board = r.state;
  };
  let progression = createProgression(actor);
  while (true) {
    progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') break;
    progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  return { raw, defs, definitions, options, identity, ref, environment, commit, actor, board: () => board, setBoard: b => board = b,
    setGrants: g => grants = g, grants: () => grants, reader: createDerivedCardFactsReader(options),
    coordinator: () => new V3FixtureCoordinator({ mode: 'syntheticNoAbilities', card: defs[0], definitions: defs, identity, movement: board, progression,
      signingKey: Buffer.alloc(32, 32), master: null, now: () => 1000, keywordGrants: grants }) };
}
const selector = filters => ({ type: 'BOUND_CARDS', cards: { ref: 'bindings.looked' }, excludeCards: null, owner: 'SELF', controller: 'SELF', chooser: 'SELF', zone: 'deck',
  visibility: 'OWNER_ONLY', faceUpOnly: false, cardTypes: ['character'], filters, excludeSource: false, min: 0, max: 1, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' });
const namiFilter = () => ({ type: 'all', conditions: [name('ナミ', 'ne'), meta('traits', ['麦わらの一味'])] });

test('metadata profile compiles predicates with explicit parameters without changing legacy hashes', () => {
  const d = leader(); d.effects[0].resolutionConditions = name('ナミ', 'ne', 'SOURCE');
  const plan = compileV3CardJson(JSON.stringify(d)); assert.equal(plan.compilerVersion, 'v3-subset-compiler.17.1');
  assert.equal(plan.definition.schemaVersion, '3.0.0-subset.17'); assert.ok(plan.requiredHandlers.includes('predicate:CARD_NAME'));
  assert.equal(v3RegistryHash(builtinV3Registries()), '44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763');
  assert.notEqual(plan.registryHash, v3RegistryHash(builtinV3Registries()));
  d.schemaVersion = '3.0.0-subset.16'; assert.throws(() => compileV3CardJson(JSON.stringify(d)));
  assert.equal(supportsV3RuntimeProfile(plan), true);
});

test('compiler refuses malformed, out-of-scope, oversized and unsupported metadata or ability queries', () => {
  const bad = [name(''), name('x'.repeat(301)), { ...name('a'), subject: 'OPPONENT' }, name('a'), { ...name('a', 'eq', 'SOURCE'), regex: '.*' },
    meta('traits', []), meta('traits', ['a', 'a']), meta('traits', Array.from({ length: 33 }, (_, i) => String(i))), meta('colors', ['赤'], 'ANY', 'CONTAINS'),
    meta('traits', ['a'], 'EXACT', 'CONTAINS'), meta('traits', ['a'], 'BAD'), meta('bad', ['a']),
    ability('DOUBLE_ATTACK', 'CURRENT', 'SOURCE'), ability('TRIGGER', 'GRANTED', 'SOURCE'), ability('ON_ATTACK', 'GRANTED', 'SOURCE'), { ...ability('RUSH', 'PRINTED', 'SOURCE'), basis: 'ASSUME' }];
  for (const predicate of bad) { const d = leader(); d.effects[0].activationConditions = predicate; assert.throws(() => compileV3CardJson(JSON.stringify(d))); }
  for (const timing of ['ON_KO', 'TRIGGER']) {
    const d = definition('META-UNRESOLVED', '保留', { source: { text: 'Synthetic KO.', triggerText: timing === 'TRIGGER' ? 'Synthetic trigger.' : '', displayIds: ['META-UNRESOLVED'], datasetSha256: '0'.repeat(64) },
      effects: [{ ...effect([{ type: 'DRAW', player: 'SELF', count: 1 }]), kind: 'triggered', timing: { type: timing }, sourceZones: [timing === 'TRIGGER' ? 'life' : 'character'], resolutionConditions: name('保留', 'eq', 'SOURCE') }] });
    assert.throws(() => compileV3CardJson(JSON.stringify(d)));
  }
});

test('name comparisons preserve Japanese, width, case, punctuation and Unicode sequences literally', () => {
  const s = setup(), target = s.ref(s.board().players[0].character[0]), env = s.environment();
  assert.equal(env.evaluate(name('ルフィ'), {}, target), true); assert.equal(env.evaluate(name('ﾙﾌｨ'), {}, target), false);
  assert.equal(env.evaluate(name('ルフィ ', 'ne'), {}, target), true);
  for (const [a, b] of [['D', 'Ｄ'], ['ガ', 'カ\u3099'], ['B・W', 'B･W'], ['A', 'a']]) {
    const raw = leader(); raw.name = a; const x = setup({ source: raw });
    assert.equal(x.environment().evaluate(name(b, 'eq', 'SOURCE'), {}), false);
    assert.equal(x.environment().evaluate(name(b, 'ne', 'SOURCE'), {}), true);
  }
});

test('trait membership, exclusion, any/all, exact sets and literal substrings share one evaluation path', () => {
  const s = setup(), target = s.ref(s.board().players[0].character[0]), other = s.ref(s.board().players[0].character[1]), e = s.environment();
  const cases = [[meta('traits', ['麦わらの一味']), true], [meta('traits', ['海軍']), false], [meta('traits', ['海軍'], 'NONE'), true],
    [meta('traits', ['海軍', '超新星'], 'ANY'), true], [meta('traits', ['海軍', '超新星'], 'ALL'), false],
    [meta('traits', ['超新星', '麦わらの一味'], 'EXACT'), true], [meta('traits', ['麦わらの一味'], 'EXACT'), false],
    [meta('traits', ['麦わら'], 'ANY', 'CONTAINS'), true]];
  for (const [p, expected] of cases) assert.equal(e.evaluate(p, {}, target), expected);
  assert.equal(e.evaluate(meta('traits', ['B・W'], 'ANY', 'EXACT'), {}, other), false);
  assert.equal(e.evaluate(meta('traits', ['B・W'], 'ANY', 'CONTAINS'), {}, other), true);
  assert.equal(e.evaluate(meta('traits', ['B･W'], 'ANY', 'CONTAINS'), {}, other), false);
  assert.equal(e.evaluate({ type: 'not', condition: meta('traits', ['海軍']) }, {}, target), true);
  assert.equal(e.evaluate({ type: 'any', conditions: [meta('traits', ['海軍']), meta('traits', ['超新星'])] }, {}, target), true);
});

test('multicolor sets and attributes distinguish any, all, none and exact set equality', () => {
  const s = setup(), target = s.ref(s.board().players[0].character[0]), e = s.environment();
  for (const [p, expected] of [[meta('colors', ['赤']), true], [meta('colors', ['赤', '緑'], 'ALL'), true], [meta('colors', ['赤'], 'EXACT'), false],
    [meta('colors', ['緑', '赤'], 'EXACT'), true], [meta('colors', ['青'], 'NONE'), true], [meta('colors', ['赤'], 'NONE'), false],
    [meta('attributes', ['特']), true], [meta('attributes', ['斬'], 'NONE'), true], [meta('attributes', ['特', '打'], 'ALL'), true]]) assert.equal(e.evaluate(p, {}, target), expected);
});

test('printed metadata remains available but unresolved current modifications are UNKNOWN, not false', () => {
  const s = setup(), target = s.ref(s.board().players[0].character[0]);
  const board = structuredClone(s.board()); board.cards[target.instanceId].grantIds.push('unmodeled'); s.setBoard(board);
  const e = s.environment(); assert.equal(e.evaluate(meta('traits', ['麦わらの一味']), {}, target), true);
  const p = meta('traits', ['麦わらの一味'], 'ANY', 'EXACT', 'CURRENT');
  assert.equal(e.evaluate(p, {}, target), 'unknown'); assert.equal(e.evaluate({ type: 'not', condition: p }, {}, target), 'unknown');
  const fallback = createDerivedCardFactsReader({ ...s.options, definitions: new Map() });
  assert.equal(fallback(target, 0).metadata.printed.name, UNKNOWN);
  assert.equal(e.evaluate(ability('BLOCKER', 'CURRENT'), {}, target), 'unknown');
});

test('printed, granted and current keyword tags are distinct and expire with their ledger', () => {
  const s = setup(), target = s.ref(s.board().players[0].character[0]);
  s.setGrants(addKeywordGrants(s.board(), [], 'grant', s.identity.source, 0, [target], { type: 'RUSH' }, { type: 'TURN_END', player: 'SELF', occurrence: 1 }, s.defs));
  const e = s.environment();
  assert.equal(e.evaluate(ability('RUSH', 'PRINTED'), {}, target), false); assert.equal(e.evaluate(ability('RUSH', 'GRANTED'), {}, target), true); assert.equal(e.evaluate(ability('RUSH', 'CURRENT'), {}, target), true);
  s.setGrants(endTurnKeywordGrants(s.grants(), 0)); assert.equal(e.evaluate(ability('RUSH', 'CURRENT'), {}, target), false);
  assert.equal(e.evaluate(ability('UNSUPPORTED', 'CURRENT'), {}, target), 'unknown');
  const printed = s.ref(s.board().players[0].character[1]);
  assert.equal(e.evaluate(ability('BLOCKER', 'PRINTED'), {}, printed), true);
  assert.equal(e.evaluate(ability('BLOCKER', 'GRANTED'), {}, printed), false);
  assert.equal(e.evaluate(ability('BLOCKER', 'CURRENT'), {}, printed), true);
});

test('OP16-080 trigger-card condition uses the card own trigger definition, not text mentions', () => {
  const s = setup();
  const top = s.board().players[0].deck.slice(0, 5).map(s.ref);
  for (const ref of top) s.commit([{ kind: 'reveal', card: ref, scopeId: 'metadata', viewers: [0] }]);
  const actual = top.find(ref => s.board().cards[ref.instanceId].cardId === 'META-TRIGGER'), mention = top.find(ref => s.board().cards[ref.instanceId].cardId === 'META-MENTION');
  assert.equal(s.environment().evaluate(ability('TRIGGER'), {}, actual), true);
  assert.equal(s.environment().evaluate(ability('TRIGGER'), {}, mention), false);
  assert.equal(s.environment().evaluate(ability('MAIN'), {}, mention), true);
  assert.equal(s.environment().evaluate(ability('TRIGGER', 'CURRENT'), {}, actual), true);
  assert.equal(s.reader(actual, 1), UNKNOWN);
});

test('private hands, uninspected deck, hidden life and stale refs never leak metadata through NOT', () => {
  for (const actor of [0, 1]) {
    const s = setup({ actor }), env = s.environment();
    const refs = [s.ref(s.board().players[1 - actor].hand[0]), s.ref(s.board().players[actor].deck[0]), s.ref(s.board().players[actor].life[0]), { ...s.identity.source, generation: 999 }];
    for (const ref of refs) for (const p of [name('ナミ', 'ne'), meta('colors', ['赤'], 'NONE'), ability('TRIGGER')]) {
      assert.equal(env.evaluate(p, {}, ref), 'unknown'); assert.equal(env.evaluate({ type: 'not', condition: p }, {}, ref), 'unknown');
    }
  }
});

for (const actor of [0, 1]) for (const zero of [false, true]) test(`OP01-016 selection condition runs against inspected candidates with private choices (seat=${actor}, zero=${zero})`, () => {
  const source = leader([{ type: 'LOOK_TOP', player: 'SELF', count: 5, bindAs: 'looked', onInsufficient: 'takeAvailable' },
    { type: 'SELECT', bindAs: 'selected', selector: selector(namiFilter()) },
    { type: 'IF', condition: { type: 'compare', left: { ref: 'bindings.selected.count' }, op: 'gt', right: 0 }, then: [
      { type: 'REVEAL', cards: { ref: 'bindings.selected' }, viewers: 'BOTH' },
      { type: 'MOVE_CARD', cards: { ref: 'bindings.selected' }, destination: { owner: 'SELF', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' }], else: [] }]);
  const s = setup({ source, actor, zero }), c = s.coordinator(), beforeHand = s.board().players[actor].hand.length;
  const looked = s.board().players[actor].deck.slice(0, 5); let chosenId = null;
  for (let i = 0; i < 24 && c.viewFor(actor).frame.status !== 'completed'; i++) {
    const frame = c.viewFor(actor).frame, context = c.context();
    if (frame.status === 'ready') c.advance(actor, `advance-${i}`, context);
    else if (frame.status === 'waitingForWork') { c.applyPendingWork(actor, `work-${i}`, context); assert.equal(c.applyPendingWork(actor, `work-${i}`, context).replayed, true); }
    else {
      const choice = frame.choice; assert.equal(choice.options.some(o => o.cardId === 'META-NAMI'), false);
      const current = c.snapshotForCoordinator().movement;
      const inspectEnv = fixtureEnvironment(() => current, s.identity, s.defs[0], pinMasterFacts(current, { master: null, numericPolicy: 'certifiedUnmodified' }), () => 1000, s.defs);
      const expected = looked.filter(id => inspectEnv.evaluate(namiFilter(), {}, { instanceId: id, generation: current.cards[id].generation }) === true).map(id => current.cards[id].cardId).sort();
      assert.deepEqual(choice.options.map(o => o.cardId).sort(), expected);
      assert.deepEqual(c.viewFor(1 - actor).frame.choice.options, []);
      assert.equal(c.viewFor(1 - actor).movement.players[actor].deck.every(card => card.cardId === null), true);
      assert.throws(() => c.answer(1 - actor, 'foreign', context, choice.selectionId, []));
      const token = choice.options.find(o => o.cardId === 'META-LUFFY'); assert.ok(token); chosenId = token.cardId;
      c.answer(actor, `answer-${i}`, context, choice.selectionId, [token.token]);
      assert.throws(() => c.advance(actor, 'stale', context));
    }
  }
  const done = c.snapshotForCoordinator(); assert.equal(c.viewFor(actor).frame.status, 'completed');
  assert.equal(done.movement.players[actor].hand.length, beforeHand + (zero ? 0 : 1));
  assert.equal(zero ? chosenId === null : chosenId === 'META-LUFFY', true); assert.deepEqual(done.movement.reveals, []);
});

test('runtime predicates observe granted keywords in the same resolution after committed work', () => {
  const source = leader([{ type: 'BIND_SOURCE', bindAs: 'self' }, { type: 'GRANT_KEYWORD', cards: { ref: 'bindings.self' }, keyword: { type: 'BLOCKER' }, duration: { type: 'TURN_END', player: 'SELF', occurrence: 1 } },
    { type: 'IF', condition: ability('BLOCKER', 'CURRENT', 'SOURCE'), then: [{ type: 'DRAW', player: 'SELF', count: 1 }], else: [] }]);
  const s = setup({ source }), c = s.coordinator(), hand = s.board().players[0].hand.length;
  for (let i = 0; i < 12 && c.viewFor(0).frame.status !== 'completed'; i++) {
    if (c.viewFor(0).frame.status === 'ready') c.advance(0, `advance-${i}`, c.context()); else c.applyPendingWork(0, `work-${i}`, c.context());
  }
  assert.equal(c.viewFor(0).frame.status, 'completed'); assert.equal(c.snapshotForCoordinator().movement.players[0].hand.length, hand + 1);
});

test('metadata predicates also drive effect resolution conditions, not only selector filters', () => {
  for (const matches of [true, false]) {
    const source = leader(); source.effects[0].resolutionConditions = { type: 'all', conditions: [
      name(matches ? source.name : '不一致', 'eq', 'SOURCE'), { ...meta('traits', ['麦わらの一味', '超新星'], 'ALL'), subject: 'SOURCE' },
      { type: 'not', condition: ability('TRIGGER', 'PRINTED', 'SOURCE') }] };
    const s = setup({ source }), c = s.coordinator(), before = s.board().players[0].hand.length;
    for (let i = 0; i < 8 && c.viewFor(0).frame.status !== 'completed'; i++) {
      if (c.viewFor(0).frame.status === 'ready') c.advance(0, `condition-${i}`, c.context()); else c.applyPendingWork(0, `work-${i}`, c.context());
    }
    assert.equal(c.viewFor(0).frame.status, 'completed');
    assert.equal(c.snapshotForCoordinator().movement.players[0].hand.length, before + (matches ? 1 : 0));
  }
});

test('a selection with unknown metadata stops atomically instead of silently omitting the candidate', () => {
  const source = leader([{ type: 'LOOK_TOP', player: 'SELF', count: 5, bindAs: 'looked', onInsufficient: 'takeAvailable' },
    { type: 'SELECT', bindAs: 'selected', selector: selector(namiFilter()) }]);
  const s = setup({ source }), board = structuredClone(s.board());
  board.cards[board.players[0].deck[0]].cardId = 'UNKNOWN-METADATA'; s.setBoard(board);
  const c = s.coordinator(); c.advance(0, 'look-plan', c.context()); c.applyPendingWork(0, 'look', c.context());
  const before = c.snapshotForCoordinator(); assert.throws(() => c.advance(0, 'unknown-select', c.context()));
  assert.deepEqual(c.snapshotForCoordinator(), before); assert.equal(c.viewFor(1).frame.choice, null);
  assert.equal(c.viewFor(1).movement.players[0].deck.every(card => card.cardId === null), true);
});

test('legacy approvals remain pinned and new-profile definitions cannot reuse their approval hashes', () => {
  const loaded = loadReviewedV3Catalog(); assert.equal(loaded.cards.length, 14);
  assert.equal(loaded.cards.every(c => c.definition.schemaVersion === '3.0.0-subset.16' && c.compilerVersion === 'v3-subset-compiler.16.3'), true);
  const original = loaded.cards[0], next = structuredClone(original.definition); next.schemaVersion = '3.0.0-subset.17';
  const plan = compileV3CardJson(JSON.stringify(next));
  assert.throws(() => new ApprovedV3Catalog([plan], [original.approval], original.rulesetVersion));
  assert.notEqual(plan.definitionHash, original.definitionHash); assert.notEqual(plan.registryHash, original.registryHash);
});
