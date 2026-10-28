const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileV3CardJson, builtinV3Registries, V3Registry } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const raw = fs.readFileSync(path.join(__dirname, 'fixtures/v3-main-draw.json'), 'utf8');
const fixture = () => JSON.parse(raw);
const compile = value => compileV3CardJson(JSON.stringify(value));
function approved() { const data = fixture(); data.reviewStatus = 'approved'; return compile(data); }
function approval(plan) {
  return { status: 'approved', cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash,
    compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, rulesetVersion: 'synthetic-test.1', reviewer: 'fixture-reviewer', approvedAt: '2026-10-28T00:00:00.000Z', ruleEvidence: ['synthetic-unit-test-only:not-an-official-ruling'] };
}
test('v3 compiler produces immutable versioned non-executable plans and preserves metadata and null versus zero', () => {
  const plan = compileV3CardJson(raw);
  assert.equal(plan.status, 'compiled_not_executable'); assert.equal(plan.definition.baseStats.cost, null); assert.equal(plan.definition.baseStats.power, 0);
  assert.equal(plan.definition.attributes[0], '斬'); assert.equal(plan.definition.traits[0], 'テスト/B・W');
  assert.equal(Object.isFrozen(plan.definition.effects[0].actions), true);
  assert.deepEqual(plan.requiredHandlers, ['action:DRAW', 'action:IF', 'action:SEQUENCE', 'cost:REST_DON', 'predicate:all', 'predicate:any', 'predicate:compare', 'predicate:not', 'timing:MAIN']);
});
test('unknown instructions, undeclared bindings, legacy and draft syntax are never silently translated', () => {
  for (const mutate of [v => v.effects[0].actions[0] = { type: 'CUSTOM_HANDLER', handler: 'unreviewed' }, v => v.effects[0].costs[0].type = 'DON_RETURN', v => v.effects[0].timing.type = 'COUNTER', v => v.effects[0].kind = 'replacement', v => v.effects[0].usageLimit = { type: 'perTurn', count: 1 }, v => v.effects[0].resolutionConditions.left = { ref: 'bindings.unbound' }, v => v.effects[0].actions[0].bindAs = 'x', v => v.schemaVersion = '3.0-draft', v => v.dslVersion = 1, v => v.effects[0].sourceZones = ['hand']]) {
    const data = fixture(); mutate(data); assert.throws(() => compile(data));
  }
});
test('counts, branch types, spans, duplicate IDs and complexity are bounded', () => {
  for (const mutate of [v => v.effects[0].costs[0].count = 0, v => v.baseStats.cost = -1, v => v.effects[0].resolutionConditions.right = '2', v => v.effects[0].resolutionConditions.left = { ref: 'SOURCE.__proto__' }, v => v.effects[0].timing.sourceSpan = { start: 0, end: 99999 }, v => v.effects[0].timing.id = 'main', v => v.effects.push(structuredClone(v.effects[0]))]) {
    const data = fixture(); mutate(data); assert.throws(() => compile(data));
  }
  const data = fixture(); data.effects[0].timing.sourceSpan = { start: 0, end: 2 }; assert.equal(compile(data).definition.effects[0].timing.sourceSpan.end, 2);
  let nested = { type: 'all', conditions: [] }; for (let i = 0; i < 30; i++) nested = { type: 'not', condition: nested };
  data.effects[0].activationConditions = nested; assert.throws(() => compile(data));
  assert.throws(() => compileV3CardJson('{"__proto__":{}}')); assert.throws(() => compileV3CardJson(' '.repeat(262145)));
});
test('hashes are key-order independent, but pin source, definition and registry versions', () => {
  const data = fixture(), a = compile(data), b = compile(Object.fromEntries(Object.entries(data).reverse()));
  assert.equal(a.definitionHash, b.definitionHash); assert.equal(a.registryHash, b.registryHash);
  data.source.text += '変更'; const c = compile(data); assert.notEqual(a.sourceHash, c.sourceHash); assert.notEqual(a.definitionHash, c.definitionHash);
  const registries = builtinV3Registries(); registries.action = new V3Registry();
  registries.action.register('DRAW', '2', (node, context) => ({ type: 'DRAW', ...context.fields(node, ['player', 'count']), player: 'SELF', count: 1 }));
  const minimal = fixture(); minimal.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }];
  assert.notEqual(compile(minimal).registryHash, compileV3CardJson(JSON.stringify(minimal), registries).registryHash);
  assert.throws(() => registries.action.register('DRAW', '3', () => ({})));
  const duplicate = builtinV3Registries(); assert.throws(() => duplicate.action.register('DRAW', '1', () => ({})));
});
test('card JSON approval flag cannot substitute for trusted matching approval evidence', () => {
  const plan = approved(); assert.throws(() => new ApprovedV3Catalog([plan], [], 'synthetic-test.1'));
  const record = approval(plan), catalog = new ApprovedV3Catalog([plan], [record], 'synthetic-test.1');
  assert.equal(catalog.get(plan.definition.cardId).status, 'approved_not_executable'); assert.equal(catalog.get('missing'), null);
  assert.throws(() => catalog.requireExecution(plan.definition.cardId));
  assert.throws(() => new ApprovedV3Catalog([JSON.parse(JSON.stringify(plan))], [record], 'synthetic-test.1'));
  const unreviewed = compileV3CardJson(raw); assert.throws(() => new ApprovedV3Catalog([unreviewed], [approval(unreviewed)], 'synthetic-test.1'));
  for (const patch of [{ sourceHash: '0'.repeat(64) }, { definitionHash: '0'.repeat(64) }, { registryHash: '0'.repeat(64) }, { compilerVersion: 'other.1' }, { cardVersion: 'other.1' }, { cardId: 'OTHER' }, { rulesetVersion: 'unverified' }, { reviewer: '' }, { approvedAt: '2026-02-30T00:00:00.000Z' }, { ruleEvidence: [] }]) assert.throws(() => new ApprovedV3Catalog([plan], [{ ...record, ...patch }], 'synthetic-test.1'));
  assert.throws(() => new ApprovedV3Catalog([plan, plan], [record], 'synthetic-test.1'));
  assert.throws(() => new ApprovedV3Catalog([plan], [record, record], 'synthetic-test.1'));
});

test('registry parser bugs cannot inject non-JSON or cyclic compiler plans', () => {
  const data = fixture(); data.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }];
  for (const parse of [() => ({ type: 'WRONG' }), () => ({ type: 'DRAW', count: Infinity }), () => { const node = { type: 'DRAW' }; node.self = node; return node; }, () => ({ type: 'DRAW', handler: () => {} })]) {
    const registries = builtinV3Registries(); registries.action = new V3Registry(); registries.action.register('DRAW', 'test', parse);
    assert.throws(() => compileV3CardJson(JSON.stringify(data), registries));
  }
});

test('usage limits require an explicit supported scope and remain part of trusted approval hashes', () => {
  const data = fixture(), unlimited = compile(data); data.effects[0].usageLimit = { type: 'PER_TURN', scope: 'SOURCE_OBJECT', count: 1 };
  const once = compile(data); assert.notEqual(once.definitionHash, unlimited.definitionHash); assert.equal(once.definition.effects[0].usageLimit.count, 1);
  for (const patch of [{ count: 0 }, { count: 51 }, { count: 1.5 }, { scope: 'CARD_NAME' }, { type: 'PER_GAME' }, { optional: true }]) {
    const invalid = structuredClone(data); Object.assign(invalid.effects[0].usageLimit, patch); assert.throws(() => compile(invalid));
  }
  delete data.effects[0].usageLimit; assert.throws(() => compile(data));
  const approvedData = fixture(); approvedData.reviewStatus = 'approved'; const original = compile(approvedData), record = approval(original);
  approvedData.effects[0].usageLimit = { type: 'PER_TURN', scope: 'SOURCE_OBJECT', count: 2 };
  assert.throws(() => new ApprovedV3Catalog([compile(approvedData)], [record], 'synthetic-test.1'));
});

test('no-ability definitions accept blank source text but never silently discard remaining ability or trigger text', () => {
  const data = fixture(); data.effects = []; data.source.text = ''; data.source.triggerText = '';
  const plan = compile(data); assert.deepEqual(plan.definition.effects, []); assert.deepEqual(plan.requiredHandlers, []);
  assert.throws(() => new ApprovedV3Catalog([plan], [], 'synthetic-test.1'));
  for (const field of ['text', 'triggerText']) { const invalid = structuredClone(data); invalid.source[field] = 'Unmapped ability'; assert.throws(() => compile(invalid)); }
  const missing = fixture(); missing.source.text = ''; assert.throws(() => compile(missing));
});
