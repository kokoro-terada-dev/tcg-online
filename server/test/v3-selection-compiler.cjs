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
  assert.equal(plan.compilerVersion, 'v3-subset-compiler.12'); assert.equal(plan.status, 'compiled_not_executable');
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
  for (const version of ['3.0.0-subset.1', '3.0.0-subset.2', '3.0.0-subset.3', '3.0.0-subset.4', '3.0.0-subset.5', '3.0.0-subset.6', '3.0.0-subset.7', '3.0.0-subset.8', '3.0.0-subset.9', '3.0.0-subset.10', '3.0.0-subset.11']) { const data = fixture(); data.schemaVersion = version; assert.throws(() => compile(data)); }
});

test('KO and absolute rest actions require a defined card set and cannot masquerade as costs or battle damage', () => {
  for (const type of ['KO', 'REST', 'SET_ACTIVE']) {
    const data = fixture(); data.effects[0].actions[1].then[0] = { type, cards: { ref: 'bindings.picked' } };
    assert.ok(compile(data).requiredHandlers.includes(`action:${type}`));
    for (const patch of [{ cause: 'BATTLE_KO' }, { destination: { zone: 'trash' } }, { cards: { ref: 'SOURCE' } }, { cards: { ref: 'bindings.missing' } }]) {
      const copy = structuredClone(data); Object.assign(copy.effects[0].actions[1].then[0], patch); assert.throws(() => compile(copy));
    }
  }
});

test('owner-only hand selection cannot widen visibility, chooser, controller or hidden zones', () => {
  const data = fixture(), selector = data.effects[0].actions[0].selector;
  Object.assign(selector, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, owner: 'SELF', controller: 'SELF', chooser: 'SELF', filters: { type: 'all', conditions: [] } });
  assert.equal(compile(data).definition.effects[0].actions[0].selector.visibility, 'OWNER_ONLY');
  for (const patch of [{ owner: 'OPPONENT' }, { controller: 'OPPONENT' }, { chooser: 'OPPONENT' }, { visibility: 'PUBLIC' }, { faceUpOnly: true }, { zone: 'deck' }, { zone: 'life' }, { zone: 'public' }, { selectionMode: 'BLIND_SELECT' }]) {
    const copy = structuredClone(data); Object.assign(copy.effects[0].actions[0].selector, patch); assert.throws(() => compile(copy));
  }
});

test('hand discard costs are explicit exact counts, independent of actions and bounded as a bundle', () => {
  const data = fixture(); data.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'DISCARD_HAND', count: 2 }];
  const plan = compile(data); assert.ok(plan.requiredHandlers.includes('cost:DISCARD_HAND'));
  for (const patch of [{ count: 0 }, { count: 1.5 }, { owner: 'OPPONENT' }, { optional: true }, { bindAs: 'paid' }]) {
    const invalid = structuredClone(data); Object.assign(invalid.effects[0].costs[1], patch); assert.throws(() => compile(invalid));
  }
  data.effects[0].costs = [{ type: 'DISCARD_HAND', count: 50 }, { type: 'DISCARD_HAND', count: 1 }]; assert.throws(() => compile(data));
});

test('REST_SOURCE has no count or target override and cannot charge the same source twice', () => {
  const data = fixture(); data.effects[0].costs = [{ type: 'REST_SOURCE' }];
  assert.ok(compile(data).requiredHandlers.includes('cost:REST_SOURCE'));
  for (const patch of [{ count: 1 }, { cards: { ref: 'bindings.picked' } }, { player: 'OPPONENT' }, { optional: true }]) {
    const invalid = structuredClone(data); Object.assign(invalid.effects[0].costs[0], patch); assert.throws(() => compile(invalid));
  }
  data.effects[0].costs.push({ type: 'REST_SOURCE' }); assert.throws(() => compile(data));
});

test('DON_RETURN requires explicit owned source zones and rejects deck selection or duplicate cost nodes', () => {
  for (const from of ['activeDon', 'restDon', 'attachedDon']) {
    const data = fixture(); data.effects[0].costs = [{ type: 'DON_RETURN', count: 1, from }];
    assert.ok(compile(data).requiredHandlers.includes('cost:DON_RETURN'));
    for (const patch of [{ count: 0 }, { from: 'donDeck' }, { from: ['activeDon', 'hand'] }, { player: 'OPPONENT' }, { count: 1.5 }]) {
      const invalid = structuredClone(data); Object.assign(invalid.effects[0].costs[0], patch); assert.throws(() => compile(invalid));
    }
    data.effects[0].costs.push({ type: 'DON_RETURN', count: 1, from }); assert.throws(() => compile(data));
    data.effects[0].costs = [];
    Object.assign(data.effects[0].actions[0].selector, { zone: from, owner: 'SELF', controller: 'SELF', chooser: 'SELF', cardTypes: ['don'] });
    assert.doesNotThrow(() => compile(data));
    for (const patch of [{ owner: 'OPPONENT' }, { controller: 'OPPONENT' }, { chooser: 'OPPONENT' }, { faceUpOnly: false }, { cardTypes: ['character'] }]) {
      const invalid = structuredClone(data); Object.assign(invalid.effects[0].actions[0].selector, patch); assert.throws(() => compile(invalid));
    }
  }
});

test('DON_RETURN and DON selectors accept explicit mixed zones but never empty, duplicate or hidden zones', () => {
  const zones = ['activeDon', 'restDon', 'attachedDon'], data = fixture();
  data.effects[0].costs = [{ type: 'DON_RETURN', count: 2, from: zones }];
  assert.deepEqual(compile(data).definition.effects[0].costs[0].from, zones);
  for (const invalid of [[], ['activeDon', 'activeDon'], ['donDeck'], ['restDon', 'hand'], ['attachedDon', 'life'], null]) {
    const copy = structuredClone(data); copy.effects[0].costs[0].from = invalid; assert.throws(() => compile(copy));
  }
  Object.assign(data.effects[0].actions[0].selector, { zone: zones, cardTypes: ['don'], owner: 'SELF', controller: 'SELF', chooser: 'SELF' });
  assert.doesNotThrow(() => compile(data));
  for (const zone of [[], ['activeDon', 'activeDon'], ['hand', 'restDon'], ['donDeck']]) {
    const copy = structuredClone(data); copy.effects[0].actions[0].selector.zone = zone; assert.throws(() => compile(copy));
  }
});

test('effect optionality is an explicit boolean and changes the reviewed definition hash', () => {
  const data = fixture(), required = compile(data); data.effects[0].optional = true;
  const optional = compile(data); assert.equal(optional.definition.effects[0].optional, true); assert.notEqual(optional.definitionHash, required.definitionHash);
  for (const value of [null, 'true', 1, {}, []]) { data.effects[0].optional = value; assert.throws(() => compile(data)); }
  delete data.effects[0].optional; assert.throws(() => compile(data));
});

test('look, scoped search, reveal and chosen deck order compile as explicit primitives', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-search-deck.json'), 'utf8'));
  const plan = compile(data);
  for (const handler of ['action:LOOK_TOP', 'selector:BOUND_CARDS', 'action:REVEAL', 'action:ORDER_CARDS', 'action:RETURN_TO_DECK']) assert.ok(plan.requiredHandlers.includes(handler));
  const mutations = [
    d => d.effects[0].actions[0].player = 'OPPONENT', d => d.effects[0].actions[0].count = 0,
    d => d.effects[0].actions[0].onInsufficient = 'guess', d => d.effects[0].actions[1].selector.cards.ref = 'bindings.missing',
    d => d.effects[0].actions[1].selector.max = 4, d => d.effects[0].actions[1].selector.zone = 'hand',
    d => d.effects[0].actions[1].selector.chooser = 'OPPONENT', d => d.effects[0].actions[1].selector.visibility = 'PUBLIC',
    d => d.effects[0].actions[2].viewers = 'SELF', d => d.effects[0].actions[4].excludeCards.ref = 'bindings.missing',
    d => d.effects[0].actions[4].bindAs = 'looked', d => d.effects[0].actions[5].player = 'OPPONENT',
  ];
  for (const mutate of mutations) { const invalid = structuredClone(data); mutate(invalid); assert.throws(() => compile(invalid)); }
  const branch = structuredClone(data); branch.effects[0].actions = [{ type: 'IF', condition: { type: 'all', conditions: [] }, then: [branch.effects[0].actions[0]], else: [] }, branch.effects[0].actions[1]];
  assert.throws(() => compile(branch));
  const publicMove = structuredClone(data); publicMove.effects[0].actions[3].destination.zone = 'public'; assert.doesNotThrow(() => compile(publicMove));
});
