const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const raw = fs.readFileSync(path.join(__dirname, 'fixtures/v3-select-move.json'), 'utf8');
const fixture = () => JSON.parse(raw);
const compile = value => compileV3CardJson(JSON.stringify(value));
const predicate = (ref, op = 'gt', right = 0) => ({ type: 'compare', left: { ref }, op, right });
test('public selection compiles typed card sets, count references, filters and effect-only movement', () => {
  const plan = compileV3CardJson(raw), actions = plan.definition.effects[0].actions;
  assert.equal(plan.compilerVersion, 'v3-subset-compiler.2'); assert.equal(plan.status, 'compiled_not_executable');
  assert.equal(actions[0].selector.min, 0); assert.equal(actions[0].selector.onInsufficient, 'fail');
  assert.equal(actions[1].then[0].cards.ref, 'bindings.picked');
  assert.ok(plan.requiredHandlers.includes('selector:CARDS')); assert.ok(plan.requiredHandlers.includes('action:MOVE_CARD'));
  assert.equal(Object.isFrozen(actions[0].selector.filters), true);
});
test('hidden zones, face-down candidates, blind/random/order modes and implicit shortage policies are rejected', () => {
  for (const patch of [{ zone: 'hand' }, { zone: 'deck' }, { zone: 'life' }, { faceUpOnly: false }, { visibility: 'PRIVATE' }, { selectionMode: 'BLIND_SELECT' }, { selectionMode: 'RANDOM' }, { order: 'ORDER' }, { onInsufficient: 'clamp' }, { min: 2, max: 1 }, { min: -1 }, { max: 0 }, { max: 51 }, { chooser: 'ANYONE' }, { cardTypes: ['unknown'] }]) {
    const data = fixture(); Object.assign(data.effects[0].actions[0].selector, patch); assert.throws(() => compile(data));
  }
  const data = fixture(); delete data.effects[0].actions[0].selector.onInsufficient; assert.throws(() => compile(data));
});
test('unbound, forward, self-referential and duplicate card bindings are rejected', () => {
  for (const mutate of [v => v.effects[0].actions.reverse(), v => v.effects[0].actions[0].selector.filters = predicate('bindings.picked.count'), v => v.effects[0].actions[1].then[0].cards.ref = 'bindings.missing', v => v.effects[0].actions.push(structuredClone(v.effects[0].actions[0])), v => v.effects[0].actions[0].bindAs = 'x.y', v => v.effects[0].actions[0].bindAs = 'constructor']) {
    const data = fixture(); mutate(data); assert.throws(() => compile(data));
  }
});
test('candidate references are scoped to filters and card fields retain their scalar types', () => {
  for (const ref of ['CANDIDATE.cost', 'CANDIDATE.power', 'CANDIDATE.cardType', 'CANDIDATE.rotated']) {
    const data = fixture(); data.effects[0].activationConditions = predicate(ref); assert.throws(() => compile(data));
  }
  const data = fixture(); data.effects[0].actions[0].selector.filters = predicate('CANDIDATE.cardType', 'eq', 'character'); assert.doesNotThrow(() => compile(data));
  data.effects[0].actions[0].selector.filters = predicate('CANDIDATE.cardType', 'eq', 1); assert.throws(() => compile(data));
  data.effects[0].actions[0].selector.filters = predicate('CANDIDATE.rotated', 'lt', 1); assert.throws(() => compile(data));
  data.effects[0].actions[0].selector.filters = predicate('SOURCE.power', 'gte', 0); assert.doesNotThrow(() => compile(data));
  data.effects[0].actions[1].condition = predicate('CANDIDATE.cost'); assert.throws(() => compile(data));
});
test('branch-local bindings do not leak to siblings or continuation, but parent bindings remain usable', () => {
  const data = fixture(), effect = data.effects[0], select = effect.actions[0], conditional = effect.actions[1];
  const local = structuredClone(select); local.bindAs = 'inside';
  const move = structuredClone(conditional.then[0]); move.cards.ref = 'bindings.inside';
  conditional.then = [local, move]; assert.doesNotThrow(() => compile(data));
  conditional.else = [move]; assert.throws(() => compile(data)); conditional.else = [];
  effect.actions.push(move); assert.throws(() => compile(data)); effect.actions.pop();
  conditional.else = [structuredClone(conditional.then[0]), structuredClone(move)]; assert.doesNotThrow(() => compile(data));
  effect.actions.push(move); assert.throws(() => compile(data)); effect.actions.pop();
  conditional.then[0].bindAs = 'picked'; assert.throws(() => compile(data)); conditional.then[0].bindAs = 'inside';
  conditional.condition = predicate('bindings.inside.count'); assert.throws(() => compile(data));
});
test('effect activation/resolution conditions and other effects cannot see later action bindings', () => {
  for (const field of ['activationConditions', 'resolutionConditions']) {
    const data = fixture(); data.effects[0][field] = predicate('bindings.picked.count'); assert.throws(() => compile(data));
  }
  const data = fixture(), second = structuredClone(data.effects[0]); second.id = 'second'; second.actions.shift(); data.effects.push(second);
  assert.throws(() => compile(data));
});
test('sequences share ordered bindings; moves cannot disguise a cost, KO or reveal a hidden deck', () => {
  const data = fixture(), effect = data.effects[0]; effect.actions = [{ type: 'SEQUENCE', actions: effect.actions }]; assert.doesNotThrow(() => compile(data));
  for (const mutate of [v => v.effects[0].actions[1].then[0].cause = 'COST', v => v.effects[0].actions[1].then[0].cause = 'KO', v => v.effects[0].actions[1].then[0].cards.ref = 'bindings.picked.count', v => v.effects[0].actions[1].then[0].cards.ref = 'SOURCE', v => v.effects[0].actions[1].then[0].destination = { owner: 'SELF', zone: 'deck', position: 'top', faceUp: true }]) {
    const invalid = fixture(); mutate(invalid); assert.throws(() => compile(invalid));
  }
  const deck = fixture(); deck.effects[0].actions[1].then[0].destination = { owner: 'SELF', zone: 'deck', position: 'bottom', faceUp: false }; assert.doesNotThrow(() => compile(deck));
  deck.effects[0].actions[0].selector.max = 2; assert.throws(() => compile(deck));
});
test('old subset versions are refused rather than silently changing approval semantics', () => {
  const data = fixture(); data.schemaVersion = '3.0.0-subset.1'; assert.throws(() => compile(data));
});
