const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadReviewedV3Catalog } = require('../dist/test/effects/v3/reviewedCatalog.js');
const { validateReviewedV3Deck } = require('../dist/test/effects/v3/reviewedDeck.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { createMatch } = require('../dist/test/game.js');
const { MatchMovementCapture } = require('../dist/test/effects/matchMovement.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');
const root = path.join(__dirname, '../data/effects-v3-reviewed');
const recipe = { name: 'Unit fixture; not a legal deck', leaderCardId: 'ST02-001', mainDeck: Array(50).fill('ST02-002'), donDeck: Array(10).fill('DON'), cardTypes: { 'ST02-002': 'character' }, leaderLifeCount: 5 };

test('reviewed ST02 definitions load with primary-source hashes and preserve absent counters', () => {
  const loaded = loadReviewedV3Catalog(); assert.equal(loaded.cards.length, 14);
  const leader = loaded.catalog.get('ST02-001'), blocker = loaded.catalog.get('ST02-004');
  assert.equal(leader.definition.baseStats.life, 5); assert.equal(leader.definition.baseStats.power, 5000);
  assert.deepEqual(leader.definition.traits, ['超新星', 'キッド海賊団']);
  assert.equal(blocker.definition.baseStats.counter, null); assert.deepEqual(blocker.definition.keywords, [{ type: 'BLOCKER' }]);
  assert.equal(loaded.catalog.get('ST02-003'), null); assert.equal(loaded.catalog.get('ST02-001_p1'), null);
});

test('edited definitions and edited source snapshots cannot inherit a reviewed approval', t => {
  const tempRoot = fs.realpathSync(os.tmpdir()), temp = fs.mkdtempSync(path.join(tempRoot, 'v3-reviewed-'));
  t.after(() => {
    const target = fs.realpathSync(temp);
    assert.equal(path.dirname(target), tempRoot); assert.equal(path.basename(target).startsWith('v3-reviewed-'), true);
    fs.rmSync(target, { recursive: true, force: true });
  });
  for (const target of ['cards/ST02-001.json', 'sources/st02-subset-20261029.json']) {
    fs.cpSync(root, temp, { recursive: true }); const file = path.join(temp, target), data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (target.startsWith('cards/')) data.effects[0].costs[0].count = 2;
    else data.cards[0].power = 6000;
    fs.writeFileSync(file, JSON.stringify(data)); assert.throws(() => loadReviewedV3Catalog(temp));
  }
});

test('the real-deck gate rejects unapproved cards, aliases, wrong metadata and excessive copies', () => {
  const { catalog } = loadReviewedV3Catalog();
  for (const mutate of [() => {}, d => d.leaderCardId = 'ST02-001_p1', d => d.leaderLifeCount = 10,
    d => { d.mainDeck[0] = 'ST02-003'; d.cardTypes['ST02-003'] = 'character'; }, d => d.cardTypes['ST02-002'] = 'event']) {
    const data = structuredClone(recipe); mutate(data); assert.throws(() => validateReviewedV3Deck(data, catalog));
  }
});

test('the reviewed Kid JSON pays three DON and one hand card once, then readies its own source', () => {
  const { cards } = loadReviewedV3Catalog(), match = createMatch(recipe, recipe);
  // Deliberately bypass deck legality only for this small kernel fixture, not through a room endpoint.
  match.players[0].zones.leader[0].rotated = true;
  for (let i = 0; i < 3; i++) match.players[0].zones.activeDon.push({ ...match.players[0].zones.donDeck.shift(), faceUp: true, rotated: false });
  const movement = new MatchMovementCapture(match, 3).snapshot().movement;
  let progression = createProgression(0);
  while (true) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') { if (progression.turnNumber === 3) break; progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain'); }
    else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  const c = new V3SyntheticMatchCoordinator({ mode: 'syntheticNoAbilities', movement, progression, cards, signingKey: Buffer.alloc(32, 17), master: null, now: () => 1000 });
  const source = { instanceId: movement.players[0].leader[0], generation: 0 }; c.activate(0, 'start', c.context(), source, 'readyLeader');
  for (let i = 0; i < 16; i++) {
    const frame = c.viewFor(0).frame; if (frame.status === 'completed') break;
    if (frame.status === 'ready') c.advance(0, `advance-${i}`, c.context());
    else if (frame.status === 'waitingForWork') {
      const context = c.context(), request = `work-${i}`; c.applyPendingWork(0, request, context); assert.equal(c.applyPendingWork(0, request, context).replayed, true);
    } else { const choice = frame.choice; assert.deepEqual(c.viewFor(1).frame.choice.options, []); c.answer(0, `choose-${i}`, c.context(), choice.selectionId, choice.options.slice(0, choice.min).map(row => row.token)); }
  }
  const done = c.snapshotForCoordinator(); assert.equal(c.viewFor(0).frame.status, 'completed');
  assert.equal(done.movement.cards[source.instanceId].rotated, false); assert.equal(done.movement.players[0].activeDon.length, 0);
  assert.equal(done.movement.players[0].restDon.length, 3); assert.equal(done.movement.players[0].hand.length, 4); assert.equal(done.movement.players[0].trash.length, 1);
  assert.throws(() => c.activate(0, 'second', c.context(), source, 'readyLeader')); assert.deepEqual(c.snapshotForCoordinator(), done);
});
