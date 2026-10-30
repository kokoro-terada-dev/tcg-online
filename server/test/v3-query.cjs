const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileV3CardJson, builtinV3Registries, v3RegistryHash, supportsV3RuntimeProfile } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { loadReviewedV3Catalog } = require('../dist/test/effects/v3/reviewedCatalog.js');
const { fixtureEnvironment } = require('../dist/test/effects/v3/fixtureEnvironment.js');
const { readEventContext } = require('../dist/test/effects/v3/readContext.js');
const { V3FixtureCoordinator } = require('../dist/test/effects/v3/fixtureCoordinator.js');
const { V3ResolutionMachine } = require('../dist/test/effects/v3/resolution.js');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { pinMasterFacts } = require('../dist/test/effects/masterFacts.js');
const { MovementStore } = require('../dist/test/movement/engine.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applySystemEvent } = require('../dist/test/progression/transitions.js');
const { addStatEffects } = require('../dist/test/effects/v3/statEffects.js');
const { addKeywordGrants } = require('../dist/test/effects/v3/keywordEffects.js');
const always = () => ({ type: 'all', conditions: [] });
const name = (value, op = 'eq') => ({ type: 'CARD_NAME', subject: 'CANDIDATE', basis: 'PRINTED', op, value });
const trait = () => ({ type: 'CARD_METADATA', subject: 'CANDIDATE', basis: 'PRINTED', field: 'traits', comparison: 'EXACT', match: 'ANY', values: ['超新星'] });
const ability = (basis = 'PRINTED') => ({ type: 'HAS_ABILITY', subject: 'CANDIDATE', basis, ability: 'BLOCKER' });
const query = (patch = {}) => ({ type: 'QUERY_CARDS', owner: 'SELF', controller: 'SELF', zone: 'character', visibility: 'PUBLIC', faceUpOnly: true,
  cardTypes: ['character'], filters: always(), excludeSource: false, ...patch });
const count = (value, op = 'eq', q = query()) => ({ type: 'COUNT', query: q, op, value });
const exists = (q = query()) => ({ type: 'EXISTS', query: q });
function definition(id, kind = 'character', patch = {}) {
  return { schemaVersion: '3.0.0-subset.18', cardId: id, cardVersion: 'synthetic.1', name: 'キャベンディッシュ', cardType: kind,
    baseStats: { cost: 3, power: 5000, counter: 1000, life: kind === 'leader' ? 5 : null }, colors: ['緑'], traits: ['超新星'], attributes: ['斬'], keywords: [],
    reviewStatus: 'approved', source: { text: '', triggerText: '', displayIds: [id], datasetSha256: '0'.repeat(64) }, effects: [], ...patch };
}
function sourceDefinition(kind = 'leader') {
  const d = definition('QUERY-SOURCE', kind); d.source.text = 'Synthetic query regression only; not a full official card.';
  d.effects = [{ id: 'main', kind: 'activated', timing: { type: 'MAIN' }, sourceZones: [kind], optional: false, usageLimit: null,
    activationConditions: always(), resolutionConditions: always(), costs: [], actions: [{ type: 'DRAW', player: 'SELF', count: 1 }] }];
  return d;
}
function setup({ actor = 0, chars = 3, sourceKind = 'leader', mutate = () => {}, names = [] } = {}) {
  const source = sourceDefinition(sourceKind); mutate(source);
  const raw = [source, definition('QUERY-CHAR'), definition('QUERY-OTHER', 'character', { name: '別名' }), definition('QUERY-LEADER', 'leader'), definition('QUERY-STAGE', 'stage')];
  const plans = raw.map(d => compileV3CardJson(JSON.stringify(d))), rulesetVersion = 'query-synthetic.1';
  const approvals = plans.map(p => ({ status: 'approved', cardId: p.definition.cardId, cardVersion: p.definition.cardVersion, definitionHash: p.definitionHash,
    sourceHash: p.sourceHash, compilerVersion: p.compilerVersion, registryHash: p.registryHash, rulesetVersion, reviewer: 'unit-test-only', approvedAt: '2026-10-30T00:00:00.000Z', ruleEvidence: ['synthetic-not-real-card-approval'] }));
  const catalog = new ApprovedV3Catalog(plans, approvals, rulesetVersion), defs = raw.map(d => catalog.get(d.cardId));
  const recipe = { name: 'Query fixture', leaderCardId: sourceKind === 'leader' ? source.cardId : 'QUERY-LEADER', mainDeck: Array(50).fill('QUERY-CHAR'),
    donDeck: Array(10).fill('DON'), cardTypes: Object.fromEntries(raw.map(d => [d.cardId, d.cardType])), leaderLifeCount: 5 };
  const match = createMatch(recipe, recipe);
  for (const side of [0, 1]) {
    const z = match.players[side].zones;
    for (let i = 0; i < (side === actor ? chars : 2); i++) {
      const card = z.deck.shift(); z.character[i] = { ...card, cardId: side === actor && i === 0 && sourceKind === 'character' ? source.cardId : names[i] || 'QUERY-CHAR', kind: 'character', faceUp: true, rotated: false };
    }
    z.stage[0] = { ...z.deck.shift(), cardId: 'QUERY-STAGE', kind: 'stage', faceUp: true, rotated: false };
  }
  let board = new MatchMovementCapture(match, 1).snapshot().movement, stats = [], grants = [];
  const ref = id => ({ instanceId: id, generation: board.cards[id].generation });
  const identity = { matchId: board.matchId, resolutionId: 'query', effectId: 'main', actor, source: ref(board.players[actor][sourceKind][0]) };
  const context = readEventContext(board, identity);
  const env = () => fixtureEnvironment(() => board, identity, defs[0], pinMasterFacts(board, { master: null, numericPolicy: 'certifiedUnmodified' }), () => 1000,
    defs, () => stats, actor, () => 0, context, () => grants);
  let progression = createProgression(actor);
  while (true) { progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') break; progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken }); }
  return { source, defs, identity, context, ref, env, board: () => board, setBoard: b => board = b,
    setStats: v => stats = v, setGrants: v => grants = v,
    commit: operations => { board = new MovementStore(board).commit({ transactionId: `query-${board.revision}`, matchId: board.matchId, expectedRevision: board.revision,
      turnNumber: board.turnNumber, actor, effectController: actor, source: identity.source, mode: 'effect', resolutionId: identity.resolutionId, operations }, { status: 'certifiedNone' }).state; },
    coordinator: () => new V3FixtureCoordinator({ mode: 'syntheticNoAbilities', card: defs[0], definitions: defs, identity, movement: board, progression,
      signingKey: Buffer.alloc(32, 20), master: null, now: () => 1000, statEffects: stats, keywordGrants: grants }) };
}

test('query profile is independently pinned; older schemas cannot publish new predicates or query nodes', () => {
  const d = sourceDefinition(); d.effects[0].resolutionConditions = count(3, 'gte');
  const p = compileV3CardJson(JSON.stringify(d)); assert.equal(p.compilerVersion, 'v3-subset-compiler.18.1'); assert.ok(supportsV3RuntimeProfile(p));
  assert.ok(p.requiredHandlers.includes('query:QUERY_CARDS')); assert.ok(p.requiredHandlers.includes('predicate:COUNT'));
  for (const version of ['3.0.0-subset.16', '3.0.0-subset.17']) {
    d.schemaVersion = version; assert.throws(() => compileV3CardJson(JSON.stringify(d))); assert.equal(builtinV3Registries(version).query, undefined);
  }
  assert.equal(v3RegistryHash(builtinV3Registries()), '44c9c6deaa3a9a9d6f7926011dad26ced77b65d6cbe81093814946fd97ad5763');
  assert.equal(v3RegistryHash(builtinV3Registries('3.0.0-subset.17')), 'd18b0e340ce690d8a7e864aacf7c41974d8a9b9d233766afc512a795e6abf8d9');
});

test('compiler rejects unsupported/private query zones, malformed scopes, unknown fields and unsafe bounds', () => {
  const invalid = [query({ zone: 'deck' }), query({ zone: 'life' }), query({ zone: 'resolving' }), query({ zone: 'activeDon' }), query({ zone: ['character', 'stage'] }),
    query({ owner: 'BOTH' }), query({ controller: 'BOTH' }), query({ cardTypes: [] }), query({ cardTypes: ['character', 'character'] }), query({ cardTypes: ['don'] }),
    query({ zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, owner: 'OPPONENT', controller: 'OPPONENT' }), query({ visibility: 'OWNER_ONLY' }),
    query({ faceUpOnly: false }), query({ excludeSource: 1 }), query({ min: 0 }), query({ bindAs: 'leak' }), query({ filters: { type: 'UNSUPPORTED' } }), query({ filters: exists() })];
  for (const q of invalid) { const d = sourceDefinition(); d.effects[0].resolutionConditions = exists(q); assert.throws(() => compileV3CardJson(JSON.stringify(d))); }
  for (const p of [count(-1), count(257), count(1.5), count('3'), count(2, 'approximately'), { ...exists(), value: 1 }]) {
    const d = sourceDefinition(); d.effects[0].resolutionConditions = p; assert.throws(() => compileV3CardJson(JSON.stringify(d)));
  }
  const d = sourceDefinition(); d.effects[0].resolutionConditions = count(0); d.effects[0].actions = [{ type: 'SELECT', selector: query(), bindAs: 'bad' }];
  assert.throws(() => compileV3CardJson(JSON.stringify(d)));
});

for (const actor of [0, 1]) for (const chars of [0, 2, 3, 4]) test(`OP01-039 condition fragment counts only characters including self when present (seat=${actor}, count=${chars})`, () => {
  const s = setup({ actor, chars, sourceKind: chars ? 'character' : 'leader' }), e = s.env();
  assert.equal(e.evaluate(count(3, 'gte'), {}), chars >= 3); assert.equal(e.evaluate(count(chars), {}), true);
  assert.equal(e.evaluate(exists(), {}), chars > 0); assert.equal(e.evaluate(count(2, 'lte'), {}), chars <= 2);
  assert.equal(e.evaluate(count(0), {}), chars === 0); assert.equal(e.evaluate(count(chars, 'ne'), {}), false);
  assert.equal(e.evaluate(count(chars + 1, 'lt'), {}), true); assert.equal(e.evaluate(count(chars, 'gt'), {}), false);
  assert.equal(e.evaluate(count(1, 'eq', query({ zone: 'leader', cardTypes: ['character'] })), {}), false);
});

test('COUNT exactly one, zero and upper boundary; EXISTS is not a choice or binding', () => {
  const s = setup({ chars: 1 }), e = s.env(); assert.equal(e.evaluate(count(1), {}), true);
  assert.equal(e.evaluate(count(256, 'lte'), {}), true); assert.equal(e.evaluate(exists(query({ filters: name('不在') })), {}), false);
  assert.equal(e.evaluate(count(0, 'eq', query({ filters: name('不在') })), {}), true);
});

for (const actor of [0, 1]) test(`EB01-012 same-name other-object exclusion does not count opponent or normalize spelling (seat=${actor})`, () => {
  const s = setup({ actor, chars: 1, sourceKind: 'character' }), q = query({ filters: name('キャベンディッシュ'), excludeSource: true });
  assert.equal(s.env().evaluate({ type: 'not', condition: exists(q) }, {}), true);
  assert.equal(s.env().evaluate(count(0, 'eq', q), {}), true);
  const board = structuredClone(s.board()), target = board.players[actor].deck.shift(); board.players[actor].character[1] = target; board.cards[target].faceUp = true; s.setBoard(board);
  assert.equal(s.env().evaluate(exists(q), {}), true); assert.equal(s.env().evaluate(count(1, 'eq', q), {}), true);
  for (const spelling of ['ｷｬﾍﾞﾝﾃﾞｨｯｼｭ', 'キャベンディッシュ ', 'キャベン・ディッシュ']) assert.equal(s.env().evaluate(exists(query({ filters: name(spelling), excludeSource: true })), {}), false);
  assert.equal(s.env().evaluate(count(2, 'eq', query({ filters: name('キャベンディッシュ'), excludeSource: false })), {}), true);
});

test('SOURCE leaving the field never follows the same instance id into a new generation', () => {
  const s = setup({ sourceKind: 'character', chars: 1 });
  s.commit([{ kind: 'move', card: s.identity.source, from: { player: 0, zone: 'character' }, to: { player: 0, zone: 'trash', position: 'append', faceUp: true, rotated: false }, cause: 'EFFECT_MOVE' }]);
  assert.notEqual(s.board().cards[s.identity.source.instanceId].generation, s.identity.source.generation);
  const p = count(0, 'eq', query({ filters: name('キャベンディッシュ'), excludeSource: true }));
  assert.equal(s.env().evaluate(p, {}), 'unknown'); assert.equal(s.env().evaluate({ type: 'not', condition: p }, {}), 'unknown');
  assert.equal(s.env().evaluate(count(0), {}), true);
});

test('compound metadata and stat filters share selector evaluation; AND OR NOT retain their meaning', () => {
  const filters = { type: 'all', conditions: [trait(), name('別名', 'ne'), { type: 'compare', left: { ref: 'CANDIDATE.current.cost' }, op: 'lte', right: 3 },
    { type: 'any', conditions: [name('キャベンディッシュ'), { type: 'not', condition: name('別名') }] }] };
  const s = setup({ names: ['QUERY-CHAR', 'QUERY-OTHER', 'QUERY-CHAR'] }), env = s.env(), q = query({ filters });
  const selection = { ...q, type: 'CARDS', chooser: 'SELF', min: 0, max: 5, selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' };
  const rows = env.candidates(selection, {}).filter(r => env.evaluate(filters, {}, r.ref) === true);
  assert.equal(rows.length, 2); assert.equal(env.evaluate(count(rows.length, 'eq', q), {}), true);
});

test('numeric PRINTED and CURRENT filter values remain distinct under effective modifiers', () => {
  const s = setup({ chars: 1 }), target = s.ref(s.board().players[0].character[0]);
  s.setStats(addStatEffects(s.board(), [], 'query-cost', s.identity.source, 0, [target], 'cost', 2, { type: 'TURN_END', player: 'SELF', occurrence: 1 }, s.defs));
  const filters = basis => ({ type: 'compare', left: { ref: `CANDIDATE.${basis}.cost` }, op: 'lte', right: 3 });
  assert.equal(s.env().evaluate(count(1, 'eq', query({ filters: filters('printed') })), {}), true);
  assert.equal(s.env().evaluate(count(0, 'eq', query({ filters: filters('current') })), {}), true);
  assert.equal(s.env().evaluate(count(0, 'eq', query({ filters: { type: 'compare', left: { ref: 'CANDIDATE.cost' }, op: 'lte', right: 3 } })), {}), true);
  for (const version of ['3.0.0-subset.16', '3.0.0-subset.17']) { const d = sourceDefinition(); d.schemaVersion = version;
    d.effects[0].resolutionConditions = { type: 'compare', left: { ref: 'SOURCE.printed.cost' }, op: 'eq', right: 3 }; assert.throws(() => compileV3CardJson(JSON.stringify(d))); }
});

test('two or more ability-tagged characters use live granted keywords rather than fabricated printed tags', () => {
  const s = setup({ chars: 3 }), refs = s.board().players[0].character.filter(Boolean).slice(0, 2).map(s.ref);
  s.setGrants(addKeywordGrants(s.board(), [], 'query-keyword', s.identity.source, 0, refs, { type: 'BLOCKER' }, { type: 'TURN_END', player: 'SELF', occurrence: 1 }, s.defs));
  assert.equal(s.env().evaluate(count(2, 'gte', query({ filters: ability('CURRENT') })), {}), true);
  assert.equal(s.env().evaluate(count(0, 'eq', query({ filters: ability('PRINTED') })), {}), true);
});

for (const actor of [0, 1]) test(`own hidden hand query stays server-only; opponent hand, deck and life cannot become queries (seat=${actor})`, () => {
  const q = query({ zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false });
  const s = setup({ actor, mutate: d => { d.effects[0].resolutionConditions = exists(q); } }), c = s.coordinator();
  assert.equal(s.env().evaluate(count(s.board().players[actor].hand.length, 'eq', q), {}), true);
  const before = c.viewFor(1 - actor); c.advance(actor, 'query-hidden', c.context());
  const after = c.viewFor(1 - actor); assert.equal(after.frame.choice, null);
  assert.deepEqual(after.movement.players[actor].hand, before.movement.players[actor].hand);
  assert.equal(after.movement.players[actor].hand.every(card => card.cardId === null && card.ref === null), true);
  assert.equal(after.frame.status, 'waitingForWork'); assert.equal(after.frame.choice, null);
});

test('unreadable public collections and unresolved metadata yield UNKNOWN, never false or zero', () => {
  const s = setup({ chars: 2 }), initial = structuredClone(s.board()), target = initial.players[0].character[0];
  for (const change of [b => { b.cards[target].faceUp = false; }, b => { b.cards[target].kind = 'unknown'; },
    b => { b.cards[target].cardId = 'MISSING-METADATA'; }, b => { b.cards[target].modifierIds = ['unmodeled']; }]) {
    const b = structuredClone(initial); change(b); s.setBoard(b);
    const p = count(0, 'eq', query({ filters: { ...name('不在'), basis: 'CURRENT' } }));
    assert.equal(s.env().evaluate(p, {}), 'unknown'); assert.equal(s.env().evaluate(exists(p.query), {}), 'unknown');
    assert.equal(s.env().evaluate({ type: 'not', condition: p }, {}), 'unknown');
  }
});

test('unknown query failure is atomic and does not expose choice tokens or hidden identifiers', () => {
  const s = setup({ mutate: d => { d.effects[0].resolutionConditions = count(0, 'eq', query({ filters: name('不在') })); } });
  const b = structuredClone(s.board()); b.cards[b.players[0].character[0]].cardId = 'MISSING-METADATA'; s.setBoard(b);
  const c = s.coordinator(), before = c.snapshotForCoordinator(); assert.throws(() => c.advance(0, 'unknown-query', c.context()), /unknown/);
  assert.deepEqual(c.snapshotForCoordinator(), before); assert.equal(c.viewFor(1).frame.choice, null);
});

test('query evaluation retains activation/resolution timing, revision and replay safeguards', () => {
  const s = setup({ mutate: d => { d.effects[0].activationConditions = count(3, 'gte'); d.effects[0].resolutionConditions = count(3, 'gte'); } });
  const c = s.coordinator(), old = c.context(); c.advance(0, 'query-plan', old);
  assert.equal(c.advance(0, 'query-plan', old).replayed, true); assert.throws(() => c.advance(0, 'stale', old));
  assert.throws(() => c.applyPendingWork(1, 'foreign', c.context()));
  c.applyPendingWork(0, 'query-draw', c.context()); c.advance(0, 'query-done', c.context()); assert.equal(c.viewFor(0).frame.status, 'completed');
  assert.equal(c.viewFor(0).frame.choice, null);
  const key = Buffer.alloc(32, 21), machine = new V3ResolutionMachine(s.defs[0], s.identity, key, s.env());
  machine.advance('stored-query', 0); const view = machine.viewFor(0), saved = machine.exportForStorage();
  const restored = V3ResolutionMachine.restore(s.defs[0], s.identity, key, s.env(), saved, view.revision);
  assert.deepEqual(restored.viewFor(0), view); assert.equal(restored.workForCoordinator().type, 'DRAW');
  assert.throws(() => V3ResolutionMachine.restore(s.defs[0], s.identity, key, s.env(), saved, view.revision - 1));
  const tampered = JSON.parse(saved); tampered.signature = '0'.repeat(64);
  assert.throws(() => V3ResolutionMachine.restore(s.defs[0], s.identity, key, s.env(), JSON.stringify(tampered), view.revision));
});

test('empty and malformed hidden scopes are UNKNOWN even when the environment is called without compilation', () => {
  const s = setup(), b = structuredClone(s.board()); b.players[1].hand = []; b.players[0].deck = []; b.players[0].life = []; s.setBoard(b);
  for (const q of [query({ zone: 'hand', owner: 'OPPONENT', controller: 'OPPONENT', visibility: 'OWNER_ONLY', faceUpOnly: false }), query({ zone: 'deck' }), query({ zone: 'life' })]) {
    assert.equal(s.env().evaluate(count(0, 'eq', q), {}), 'unknown'); assert.equal(s.env().evaluate(exists(q), {}), 'unknown');
  }
});

test('metadata colors and attributes use the identical predicate path inside queries and selections', () => {
  const s = setup(), filters = { type: 'all', conditions: [
    { type: 'CARD_METADATA', subject: 'CANDIDATE', basis: 'PRINTED', field: 'colors', comparison: 'EXACT', match: 'EXACT', values: ['緑'] },
    { type: 'CARD_METADATA', subject: 'CANDIDATE', basis: 'CURRENT', field: 'attributes', comparison: 'EXACT', match: 'NONE', values: ['打'] }] };
  assert.equal(s.env().evaluate(count(3, 'eq', query({ filters })), {}), true);
  const q = query({ owner: 'OPPONENT', controller: 'OPPONENT', filters }); assert.equal(s.env().evaluate(count(2, 'eq', q), {}), true);
});

test('a compiled query filter can run in a selector without altering its selection contract', () => {
  const q = query({ filters: trait() });
  const s = setup({ mutate: d => { d.effects[0].actions = [{ type: 'SELECT', bindAs: 'selected', selector: {
    ...query({ filters: count(3, 'gte', q) }), type: 'CARDS', min: 0, max: 1, chooser: 'SELF', selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' } }]; } });
  const c = s.coordinator(); c.advance(0, 'select-query', c.context()); assert.equal(c.viewFor(0).frame.choice.options.length, 3);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  const choice = c.viewFor(0).frame.choice; c.answer(0, 'answer-query', c.context(), choice.selectionId, [choice.options[0].token]);
  c.advance(0, 'finish-query', c.context()); assert.equal(c.viewFor(0).frame.status, 'completed');
});

test('legacy 14 approvals and all schema-17 approvals remain separate from schema-18 definitions', () => {
  const loaded = loadReviewedV3Catalog(); assert.equal(loaded.cards.length, 14);
  for (const original of loaded.cards) {
    assert.equal(supportsV3RuntimeProfile(original), true); const d = structuredClone(original.definition); d.schemaVersion = '3.0.0-subset.18';
    const plan = compileV3CardJson(JSON.stringify(d)); assert.notEqual(plan.registryHash, original.registryHash);
    assert.throws(() => new ApprovedV3Catalog([plan], [original.approval], original.rulesetVersion));
  }
  const d = sourceDefinition(); d.schemaVersion = '3.0.0-subset.17'; const old = compileV3CardJson(JSON.stringify(d));
  const record = { status: 'approved', cardId: d.cardId, cardVersion: d.cardVersion, definitionHash: old.definitionHash, sourceHash: old.sourceHash,
    compilerVersion: old.compilerVersion, registryHash: old.registryHash, rulesetVersion: 'query-synthetic.1', reviewer: 'test-only', approvedAt: '2026-10-30T00:00:00.000Z', ruleEvidence: ['synthetic-only'] };
  assert.ok(supportsV3RuntimeProfile(new ApprovedV3Catalog([old], [record], record.rulesetVersion).get(d.cardId)));
  d.schemaVersion = '3.0.0-subset.18'; const promoted = compileV3CardJson(JSON.stringify(d));
  assert.throws(() => new ApprovedV3Catalog([promoted], [record], record.rulesetVersion));
});
