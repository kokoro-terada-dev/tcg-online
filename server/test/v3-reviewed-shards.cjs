const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { loadReviewedV3Catalog, isReviewedV3Catalog, proposeReviewedV3Index } = require('../dist/test/effects/v3/reviewedCatalog.js');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { loadReviewedV3Preset } = require('../dist/test/effects/v3/reviewedPresets.js');
const { ReviewedV3Setup } = require('../dist/test/effects/v3/reviewedSetup.js');
const { SOURCE_COLUMNS } = require('../dist/test/effects/v3/cardData.js');
const { definition } = require('./helpers/v3-event.cjs');

const root = path.resolve(__dirname, '../data/effects-v3-reviewed');
const rootName = 'catalog-root.json';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const write = (dir, file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n');
function fixture(t) {
  const base = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(base, 'v3-shards-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(dir)), base);
    assert.ok(path.basename(dir).startsWith('v3-shards-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.cpSync(root, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'shards'), { recursive: true });
  return dir;
}
function shard(dir, name, ids, alter = () => {}) {
  const rulesetVersion = read(dir, 'manifest.json').rulesetVersion;
  const cards = ids.map((cardId, i) => {
    const d = definition();
    Object.assign(d, { cardId, cardVersion: 'fixture.1', name: cardId, colors: ['green'] });
    d.source.displayIds = [cardId]; alter(d, i);
    return d;
  });
  const sourceFile = `sources/${name}.json`;
  const source = { version: 'v3-reviewed-source.2', sourceCsvSha256: hash(name), cards: cards.map((d, i) => ({
    cardId: d.cardId, name: d.name, cardType: d.cardType, ...d.baseStats, colors: d.colors, attributes: d.attributes, traits: d.traits,
    text: d.source.text, triggerText: d.source.triggerText,
    variants: d.source.displayIds.map(displayId => ({ displayId, recordNumber: i + 2, text: d.source.text, triggerText: d.source.triggerText || '-' }))
  })) };
  write(dir, sourceFile, source);
  const sha256 = hash(source);
  const entries = cards.map(d => {
    d.source.datasetSha256 = sha256;
    const plan = compileV3CardJson(JSON.stringify(d));
    const file = `cards/${name}-${d.cardId}.json`;
    write(dir, file, d);
    return { file, approval: { status: 'approved', cardId: d.cardId, cardVersion: d.cardVersion, definitionHash: plan.definitionHash,
      sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, rulesetVersion,
      reviewer: 'Synthetic only', approvedAt: '2026-11-10T00:00:00.000Z', ruleEvidence: ['Synthetic test'] },
    review: { status: 'verified', coverage: [{ field: 'text', start: 0, end: d.source.text.length, references: ['effect:main'] }] } };
  });
  const file = `shards/${name}.json`;
  write(dir, file, { version: 'v3-reviewed-shard.1', rulesetVersion, sources: [{ file: sourceFile, sha256 }], cards: entries });
  return file;
}

test('the deployed root preserves exactly the fourteen legacy approvals and hashes', () => {
  const legacy = loadReviewedV3Catalog(root, 'legacy'), indexed = loadReviewedV3Catalog(root);
  assert.equal(isReviewedV3Catalog(legacy), false);
  assert.equal(isReviewedV3Catalog(indexed), true);
  assert.equal(indexed.cards.length, 14);
  const pins = cards => cards.map(card => card.approval);
  assert.deepEqual(pins(indexed.cards), pins(legacy.cards));
  assert.deepEqual(pins(indexed.cards), read(root, 'manifest.json').cards.map(row => row.approval));
});

test('shard order does not change generation, and a large catalog only feeds deck cards into a real setup', t => {
  const dir = fixture(t);
  const a = shard(dir, 'a', Array.from({ length: 116 }, (_, i) => 'FIX-' + i)), b = shard(dir, 'b', ['FIX-B']);
  assert.deepEqual(proposeReviewedV3Index(dir, [a, b]), proposeReviewedV3Index(dir, [b, a]));
  assert.equal(loadReviewedV3Catalog(dir).catalog.get('FIX-B'), null);
  const { index } = proposeReviewedV3Index(dir, [b, a]);
  write(dir, rootName, { ...index, shards: [...index.shards].reverse() });
  const reviewed = loadReviewedV3Catalog(dir);
  assert.equal(reviewed.cards.length, 131);
  assert.equal(reviewed.sourceEvidenceFor('FIX-B').csvSha256, hash('b'));
  const { deck } = loadReviewedV3Preset('kid-basic', reviewed);
  const setup = new ReviewedV3Setup([deck, deck], reviewed, Buffer.alloc(32, 4));
  const chooser = setup.viewFor(0).choicePlayer;
  setup.chooseFirst(chooser, 'first', 0, 'first');
  setup.mulligan(chooser, 'keep-1', setup.viewFor(chooser).revision, false);
  setup.mulligan(1 - chooser, 'keep-2', setup.viewFor(1 - chooser).revision, false);
  assert.equal(setup.gameForServer().viewFor(0).mode, 'v3-reviewed-session');
});

test('loader fails closed on a missing root or shard, changed hashes, traversal, and a junction', t => {
  const dir = fixture(t), file = shard(dir, 'one', ['FIX-ONE']);
  assert.throws(() => proposeReviewedV3Index(dir, ['shards/../manifest.json']), /file-name/);
  const { index } = proposeReviewedV3Index(dir, [file]);
  write(dir, rootName, { ...index, rootHash: '0'.repeat(64) });
  assert.throws(() => loadReviewedV3Catalog(dir), /root-hash/);
  write(dir, rootName, index);
  const item = read(dir, file);
  write(dir, file, { ...item, rulesetVersion: 'modified' });
  assert.throws(() => loadReviewedV3Catalog(dir), /shard-hash/);
  fs.renameSync(path.join(dir, file), path.join(dir, 'moved.json'));
  assert.throws(() => loadReviewedV3Catalog(dir), { code: 'ENOENT' });
  fs.renameSync(path.join(dir, 'shards'), path.join(dir, 'detached'));
  write(dir, 'detached/one.json', item);
  fs.symlinkSync(path.join(dir, 'detached'), path.join(dir, 'shards'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => loadReviewedV3Catalog(dir), /directory-type/);
  fs.renameSync(path.join(dir, rootName), path.join(dir, 'moved-index.json'));
  assert.throws(() => loadReviewedV3Catalog(dir), { code: 'ENOENT' });
});

test('one-card replacement retains neighboring pins, rejects removal, duplicates and unverified abilities', t => {
  const dir = fixture(t), one = shard(dir, 'one', ['FIX-A']), two = shard(dir, 'two', ['FIX-B']);
  write(dir, rootName, proposeReviewedV3Index(dir, [one, two]).index);
  const before = loadReviewedV3Catalog(dir);
  const changed = shard(dir, 'changed', ['FIX-A'], d => { d.effects[0].actions[0].count = 2; d.cardVersion = 'fixture.2'; });
  const sameVersion = shard(dir, 'same-version', ['FIX-A'], d => { d.effects[0].actions[0].count = 2; });
  assert.throws(() => proposeReviewedV3Index(dir, [], [{ oldFile: one, newFile: sameVersion }]), /card-version-required/);
  assert.throws(() => proposeReviewedV3Index(dir, [one]), /duplicate-shard/);
  assert.throws(() => proposeReviewedV3Index(dir, [changed]), /duplicate/);
  assert.throws(() => proposeReviewedV3Index(dir, [], [{ oldFile: two, newFile: changed }]), /duplicate/);
  const replacement = [{ oldFile: one, newFile: changed }];
  const good = read(dir, changed), bad = structuredClone(good);
  bad.cards[0].approval.definitionHash = 'a'.repeat(64); write(dir, changed, bad);
  assert.throws(() => proposeReviewedV3Index(dir, [], replacement), /stale-definition/);
  bad.cards[0].approval = good.cards[0].approval;
  bad.cards[0].review.coverage = [];
  write(dir, changed, bad);
  assert.throws(() => proposeReviewedV3Index(dir, [], replacement), /coverage-incomplete/);
  const unapproved = shard(dir, 'pending', ['FIX-C'], d => { d.reviewStatus = 'needs_review'; });
  assert.throws(() => proposeReviewedV3Index(dir, [unapproved]), /unapproved/);
  const different = shard(dir, 'different', ['FIX-D']);
  assert.throws(() => proposeReviewedV3Index(dir, [], [{ oldFile: one, newFile: different }]), /card-removed/);
  write(dir, changed, good);
  const proposal = proposeReviewedV3Index(dir, [], replacement);
  assert.deepEqual(proposal.changes.map(row => row.cardId), ['FIX-A']);
  assert.deepEqual(loadReviewedV3Catalog(dir).catalog.get('FIX-A').approval, before.catalog.get('FIX-A').approval);
  write(dir, rootName, proposal.index);
  const after = loadReviewedV3Catalog(dir);
  assert.deepEqual(after.catalog.get('FIX-B').approval, before.catalog.get('FIX-B').approval);
  assert.equal(after.catalog.get('FIX-A').definition.effects[0].actions[0].count, 2);
});

test('CSV reports track raw variants and never modify approved paths', async t => {
  const dir = fixture(t), reviewed = loadReviewedV3Catalog(dir);
  const { compareReviewedV3Source, writeProposal } = await import('../../tools/review-v3-catalog.js');
  const cols = Object.fromEntries(SOURCE_COLUMNS.map(key => [key, '-']));
  const row = (id, display, text) => SOURCE_COLUMNS.map(key => ({
    ...cols, 'カード番号': id, '表示ID': display, 'カード名': 'Synthetic', '種類': 'CHARACTER', 'テキスト': text
  })[key]);
  const table = [SOURCE_COLUMNS, row('ST02-001', 'ST02-001', 'changed'), row('FIX-NEW', 'FIX-NEW', 'new'),
    row('FIX-HOLD', 'FIX-HOLD', 'original'), row('FIX-HOLD', 'FIX-HOLD-p1', 'different')];
  const bytes = Buffer.from(table.map(row => row.map(cell => JSON.stringify(cell)).join(',')).join('\n'));
  const report = compareReviewedV3Source(reviewed, bytes);
  assert.deepEqual(report, compareReviewedV3Source(reviewed, bytes));
  const byId = id => report.cards.find(card => card.cardId === id);
  assert.equal(byId('ST02-001').status, 'changed');
  assert.equal(byId('FIX-NEW').status, 'new');
  assert.equal(byId('FIX-HOLD').status, 'quarantine');
  assert.equal(byId('FIX-HOLD').candidate.variants.length, 2);
  assert.equal(byId('FIX-HOLD').currentApproval, null);
  assert.equal(byId('FIX-HOLD').candidate.sourceCsvSha256, report.sourceCsvSha256);
  assert.throws(() => writeProposal(dir, path.join(dir, rootName), report), /outside/);
  assert.equal(loadReviewedV3Catalog(dir).cards.length, 14);
});
