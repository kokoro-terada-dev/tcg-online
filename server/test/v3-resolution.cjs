const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3ResolutionMachine } = require('../dist/test/effects/v3/resolution.js');
const key = Buffer.alloc(32, 7); // Synthetic test key only; never a deployment secret.
function setup(mutate = () => {}, actor = 0) {
  const definition = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3-select-move.json'), 'utf8'));
  definition.reviewStatus = 'approved'; mutate(definition);
  const plan = compileV3CardJson(JSON.stringify(definition));
  const approval = { status: 'approved', cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash,
    rulesetVersion: 'synthetic.1', reviewer: 'fixture', approvedAt: '2026-10-28T00:00:00.000Z', ruleEvidence: ['synthetic-control-flow-test:not-official-rulings'] };
  const card = new ApprovedV3Catalog([plan], [approval], 'synthetic.1').get(definition.cardId);
  const identity = { matchId: 'match', resolutionId: 'resolution', effectId: 'main', actor, source: { instanceId: 'source', generation: 0 } };
  let world = 0, now = 1000;
  const row = { ref: { instanceId: 'candidate', generation: 0 }, cardId: 'TEST', owner: actor, controller: actor, zone: 'character', kind: 'character', faceUp: true, visibleTo: [0, 1] };
  let rows = [row], unknown = false;
  const env = {
    revision: () => world, now: () => now,
    evaluate: (p, bindings) => {
      if (unknown) return 'unknown';
      if (p.type === 'all') return true;
      if (p.type === 'compare' && p.left?.ref === 'bindings.picked.count') return bindings.picked.length > 0;
      return true;
    }, candidates: () => rows,
  };
  const machine = new V3ResolutionMachine(card, identity, key, env);
  return { machine, card, identity, env, row, setWorld: value => world = value, setNow: value => now = value, setRows: value => rows = value, setUnknown: value => unknown = value };
}
test('selection frames survive storage and resume with unchanged tokens for both controlling seats', () => {
  for (const actor of [0, 1]) {
    const s = setup(undefined, actor), m = s.machine; m.advance('advance', 0); const view = m.viewFor(actor);
    assert.equal(view.status, 'waitingForChoice'); assert.equal(view.mode, 'work_requests_only'); assert.equal(view.choice.options[0].cardId, 'TEST');
    assert.deepEqual(m.viewFor(1 - actor).choice.options, []);
    assert.equal(JSON.stringify(m.viewFor(actor)).includes('instanceId'), false);
    const saved = m.exportForStorage(), restored = V3ResolutionMachine.restore(s.card, s.identity, key, s.env, saved, view.revision);
    assert.deepEqual(restored.viewFor(actor), view);
    restored.answer(actor, 'answer', view.revision, view.choice.selectionId, [view.choice.options[0].token]);
    assert.equal(restored.answer(actor, 'answer', view.revision, view.choice.selectionId, [view.choice.options[0].token]).replayed, true);
    restored.advance('continue', 2); const work = restored.workForCoordinator();
    assert.equal(work.type, 'MOVE_CARD'); assert.deepEqual(work.cards, [{ instanceId: 'candidate', generation: 0 }]);
    assert.equal(work.destination.zone, 'hand'); assert.equal(s.env.revision(), 0); // No board writes by this machine.
    s.setWorld(1); restored.settleWork('applied', 3, work.workId, 'applied', 1); restored.advance('finish', 4);
    assert.equal(restored.viewFor(actor).status, 'completed'); assert.equal(restored.workForCoordinator(), null);
  }
});
test('wrong actor, forged/duplicate tokens, stale revisions and changed retries do not mutate a frame', () => {
  const s = setup(), m = s.machine; m.advance('advance', 0); const v = m.viewFor(0), saved = m.exportForStorage(), id = v.choice.selectionId, token = v.choice.options[0].token;
  for (const args of [[1, 'foreign', 1, id, [token]], [0, 'forged', 1, id, ['forged']], [0, 'duplicate', 1, id, [token, token]], [0, 'stale', 0, id, [token]], [0, 'old-choice', 1, 'old', [token]]]) assert.throws(() => m.answer(...args));
  assert.equal(m.exportForStorage(), saved); assert.throws(() => m.advance('advance', 1));
  m.answer(0, 'answer', 1, id, [token]); assert.throws(() => m.answer(0, 'answer', 1, id, []));
});
test('expired choices and externally changed worlds cannot resolve old selections', () => {
  const s = setup(), m = s.machine; m.advance('advance', 0); const v = m.viewFor(0);
  s.setNow(v.choice.expiresAt); assert.throws(() => m.answer(0, 'expired', 1, v.choice.selectionId, []));
  s.setNow(1000); s.setWorld(1); assert.throws(() => m.answer(0, 'changed', 1, v.choice.selectionId, []));
  assert.throws(() => V3ResolutionMachine.restore(s.card, s.identity, key, s.env, m.exportForStorage(), 1));
});
test('saved frames reject tampering, wrong keys, contexts, definition versions and rollback heads', () => {
  const s = setup(), m = s.machine, initial = m.exportForStorage(); m.advance('advance', 0); const saved = m.exportForStorage();
  const modified = JSON.parse(saved); modified.payload = modified.payload.replace('waitingForChoice', 'completed');
  assert.throws(() => V3ResolutionMachine.restore(s.card, s.identity, key, s.env, JSON.stringify(modified), 1));
  assert.throws(() => V3ResolutionMachine.restore(s.card, s.identity, Buffer.alloc(32, 8), s.env, saved, 1));
  assert.throws(() => V3ResolutionMachine.restore(s.card, { ...s.identity, actor: 1 }, key, s.env, saved, 1));
  assert.throws(() => V3ResolutionMachine.restore(s.card, s.identity, key, s.env, initial, 1));
  const other = setup(data => data.source.text += 'changed');
  assert.throws(() => V3ResolutionMachine.restore(other.card, s.identity, key, s.env, saved, 1));
  assert.throws(() => new V3ResolutionMachine(JSON.parse(JSON.stringify(s.card)), s.identity, key, s.env));
});
test('candidate privacy and eligibility are checked even when the server candidate provider is wrong', () => {
  for (const patch of [{ visibleTo: [0] }, { faceUp: false }, { owner: 1 }, { zone: 'hand' }, { kind: 'leader' }]) {
    const s = setup(); s.setRows([{ ...s.row, ...patch }]); const before = s.machine.exportForStorage();
    assert.throws(() => s.machine.advance('bad', 0)); assert.equal(s.machine.exportForStorage(), before);
  }
  const duplicate = setup(); duplicate.setRows([duplicate.row, duplicate.row]); assert.throws(() => duplicate.machine.advance('bad', 0));
});
test('empty optional selection skips safely, while minimum shortage and unknown facts never turn into false or zero', () => {
  const s = setup(); s.setRows([]); s.machine.advance('empty', 0); assert.equal(s.machine.viewFor(0).status, 'completed');
  const mandatory = setup(d => d.effects[0].actions[0].selector.min = 1); mandatory.setRows([]); assert.throws(() => mandatory.machine.advance('shortage', 0));
  const unknown = setup(); unknown.setUnknown(true); const before = unknown.machine.exportForStorage();
  assert.throws(() => unknown.machine.advance('unknown', 0)); assert.equal(unknown.machine.exportForStorage(), before);
  const decline = setup(); decline.machine.advance('choose', 0); const choice = decline.machine.viewFor(0).choice;
  decline.machine.answer(0, 'zero', 1, choice.selectionId, []); decline.machine.advance('finish', 2);
  assert.equal(decline.machine.viewFor(0).status, 'completed'); assert.equal(decline.machine.workForCoordinator(), null);
});

test('work waits also survive restore and retain the same coordinator work ID', () => {
  const s = setup(d => d.effects[0].costs = [{ type: 'REST_DON', count: 1 }]); s.machine.advance('pay', 0);
  const work = s.machine.workForCoordinator();
  const restored = V3ResolutionMachine.restore(s.card, s.identity, key, s.env, s.machine.exportForStorage(), 1);
  assert.deepEqual(restored.workForCoordinator(), work); assert.equal(restored.viewFor(1).choice, null);
  s.setWorld(1); restored.settleWork('paid', 1, work.workId, 'applied', 1);
  restored.advance('select', 2); assert.equal(restored.viewFor(0).status, 'waitingForChoice');
});

test('owner-only hand candidates are projected only to the owning chooser and survive signed restore', () => {
  for (const actor of [0, 1]) {
    const s = setup(d => Object.assign(d.effects[0].actions[0].selector, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, owner: 'SELF', controller: 'SELF', chooser: 'SELF', filters: { type: 'all', conditions: [] } }), actor);
    const row = { ...s.row, zone: 'hand', faceUp: false, visibleTo: [actor] }; s.setRows([row]); s.machine.advance('hand', 0);
    const mine = s.machine.viewFor(actor), other = s.machine.viewFor(1 - actor);
    assert.equal(mine.choice.options[0].cardId, row.cardId); assert.deepEqual(other.choice.options, []);
    assert.equal(JSON.stringify(other).includes(mine.choice.options[0].token), false);
    const restored = V3ResolutionMachine.restore(s.card, s.identity, key, s.env, s.machine.exportForStorage(), 1);
    assert.deepEqual(restored.viewFor(actor), mine);
    assert.throws(() => restored.answer(1 - actor, 'foreign', 1, mine.choice.selectionId, [mine.choice.options[0].token]));
    restored.answer(actor, 'mine', 1, mine.choice.selectionId, [mine.choice.options[0].token]);
    const invalid = setup(d => Object.assign(d.effects[0].actions[0].selector, { zone: 'hand', visibility: 'OWNER_ONLY', faceUpOnly: false, owner: 'SELF', controller: 'SELF', chooser: 'SELF' }), actor);
    invalid.setRows([{ ...row, visibleTo: [0, 1] }]); assert.throws(() => invalid.machine.advance('bad-visibility', 0));
  }
});
test('costs are requested as one atomic batch and work acknowledgement is versioned and idempotent', () => {
  const s = setup(d => d.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'REST_DON', count: 2 }]), m = s.machine;
  m.advance('cost', 0); const work = m.workForCoordinator(); assert.equal(work.type, 'PAY_COSTS'); assert.equal(work.costs.length, 2);
  assert.equal(m.advance('cost', 0).replayed, true); assert.equal(m.workForCoordinator().workId, work.workId);
  assert.throws(() => m.settleWork('wrong-revision', 1, work.workId, 'applied', 1));
  s.setWorld(1); m.settleWork('settled', 1, work.workId, 'applied', 1);
  assert.equal(m.settleWork('settled', 1, work.workId, 'applied', 1).replayed, true); assert.throws(() => m.settleWork('again', 2, work.workId, 'applied', 1));
  const denied = setup(d => d.effects[0].costs = [{ type: 'REST_DON', count: 50 }]); denied.machine.advance('cost', 0);
  denied.machine.settleWork('denied', 1, denied.machine.workForCoordinator().workId, 'rejected', 0); assert.equal(denied.machine.viewFor(0).status, 'blocked');
});
test('branch-local bindings disappear after suspension and scopes exit before continuation', () => {
  const s = setup(d => {
    const actions = d.effects[0].actions; d.effects[0].actions = [{ type: 'IF', condition: { type: 'all', conditions: [] }, then: actions, else: [] }, { type: 'DRAW', player: 'OPPONENT', count: 1 }];
  });
  const m = s.machine; m.advance('start', 0); const v = m.viewFor(0); m.answer(0, 'answer', 1, v.choice.selectionId, [v.choice.options[0].token]);
  m.advance('move', 2); s.setWorld(1); m.settleWork('moved', 3, m.workForCoordinator().workId, 'applied', 1); m.advance('draw', 4);
  assert.equal(m.workForCoordinator().type, 'DRAW'); assert.equal(m.workForCoordinator().player, 1);
  const state = JSON.parse(JSON.parse(m.exportForStorage()).payload); assert.equal(state.scopes.length, 1); assert.deepEqual(state.scopes[0], {});
});

test('composite hand costs restore the selected plan, then produce one payment work without paying on selection', () => {
  const s = setup(d => { d.effects[0].costs = [{ type: 'REST_DON', count: 1 }, { type: 'DISCARD_HAND', count: 1 }]; d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }]; });
  s.env.canPayCosts = () => true; s.setRows([{ ...s.row, zone: 'hand', faceUp: false, visibleTo: [0] }]);
  const m = s.machine; m.advance('start-cost', 0); const choice = m.viewFor(0).choice;
  assert.equal(choice.purpose, 'cost'); assert.equal(choice.min, 1); assert.deepEqual(m.viewFor(1).choice.options, []); assert.equal(m.workForCoordinator(), null);
  m.answer(0, 'choose-cost', 1, choice.selectionId, [choice.options[0].token]); assert.equal(m.workForCoordinator(), null); assert.equal(s.env.revision(), 0);
  const restored = V3ResolutionMachine.restore(s.card, s.identity, key, s.env, m.exportForStorage(), 2);
  restored.advance('plan-payment', 2); const work = restored.workForCoordinator();
  assert.equal(work.type, 'PAY_COSTS'); assert.equal(work.costs.length, 2); assert.deepEqual(work.discarded, [{ instanceId: 'candidate', generation: 0 }]);
  const waiting = V3ResolutionMachine.restore(s.card, s.identity, key, s.env, restored.exportForStorage(), 3); assert.deepEqual(waiting.workForCoordinator(), work);
  s.setWorld(1); waiting.settleWork('pay', 3, work.workId, 'applied', 1);
  assert.equal(waiting.settleWork('pay', 3, work.workId, 'applied', 1).replayed, true);
  const state = JSON.parse(JSON.parse(waiting.exportForStorage()).payload); assert.equal(state.costCards, null); assert.equal(state.paidCostWorkId, work.workId);
  waiting.advance('draw', 4); assert.equal(waiting.workForCoordinator().type, 'DRAW');
});

test('unknown cost feasibility never becomes payable, and an unpayable bundle blocks before revealing choices', () => {
  const s = setup(d => d.effects[0].costs = [{ type: 'DISCARD_HAND', count: 1 }]); const initial = s.machine.exportForStorage();
  assert.throws(() => s.machine.advance('unknown-cost', 0)); assert.equal(s.machine.exportForStorage(), initial);
  s.env.canPayCosts = () => false; s.machine.advance('not-payable', 0);
  assert.equal(s.machine.viewFor(0).status, 'blocked'); assert.equal(s.machine.viewFor(0).choice, null); assert.equal(s.machine.workForCoordinator(), null);
});

test('REST_SOURCE requires feasibility without a card choice and preserves payment identity across restore', () => {
  const s = setup(d => { d.effects[0].costs = [{ type: 'REST_SOURCE' }]; d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }]; });
  const initial = s.machine.exportForStorage(); assert.throws(() => s.machine.advance('unknown-source', 0)); assert.equal(s.machine.exportForStorage(), initial);
  s.env.canPayCosts = () => true; s.machine.advance('source-plan', 0);
  const work = s.machine.workForCoordinator(); assert.equal(work.type, 'PAY_COSTS'); assert.deepEqual(work.discarded, []);
  assert.equal(s.machine.viewFor(0).choice, null);
  const restored = V3ResolutionMachine.restore(s.card, s.identity, key, s.env, s.machine.exportForStorage(), 1);
  assert.deepEqual(restored.workForCoordinator(), work); s.setWorld(1); restored.settleWork('source-paid', 1, work.workId, 'applied', 1);
  restored.advance('after-payment', 2); assert.equal(restored.workForCoordinator().type, 'DRAW');
});

test('hand then DON choices restore independently without sharing tokens or applying payment early', () => {
  for (const actor of [0, 1]) {
    const s = setup(d => { d.effects[0].costs = [{ type: 'DISCARD_HAND', count: 1 }, { type: 'DON_RETURN', count: 1, from: 'restDon' }]; d.effects[0].actions = [{ type: 'DRAW', player: 'SELF', count: 1 }]; }, actor);
    s.env.canPayCosts = () => true;
    s.setRows([{ ...s.row, zone: 'hand', visibleTo: [actor] }]); s.machine.advance('start', 0); const hand = s.machine.viewFor(actor).choice;
    s.machine.answer(actor, 'hand', 1, hand.selectionId, [hand.options[0].token]);
    let m = V3ResolutionMachine.restore(s.card, s.identity, key, s.env, s.machine.exportForStorage(), 2);
    s.setRows([{ ...s.row, ref: { instanceId: 'don', generation: 2 }, cardId: 'DON', zone: 'restDon', kind: 'don' }]); m.advance('don-start', 2);
    const don = m.viewFor(actor).choice; assert.equal(don.purpose, 'returnCost'); assert.deepEqual(m.viewFor(1 - actor).choice.options, []);
    m = V3ResolutionMachine.restore(s.card, s.identity, key, s.env, m.exportForStorage(), 3);
    assert.deepEqual(m.viewFor(actor).choice, don); assert.throws(() => m.answer(actor, 'wrong-token', 3, don.selectionId, [hand.options[0].token]));
    m.answer(actor, 'don', 3, don.selectionId, [don.options[0].token]); m.advance('all-planned', 4);
    const work = m.workForCoordinator(); assert.equal(work.type, 'PAY_COSTS'); assert.equal(s.env.revision(), 0);
    assert.deepEqual(work.discarded, [{ instanceId: 'candidate', generation: 0 }]); assert.deepEqual(work.returned, [{ instanceId: 'don', generation: 2 }]);
    m = V3ResolutionMachine.restore(s.card, s.identity, key, s.env, m.exportForStorage(), 5); assert.deepEqual(m.workForCoordinator(), work);
    s.setWorld(1); m.settleWork('paid', 5, work.workId, 'applied', 1);
    const state = JSON.parse(JSON.parse(m.exportForStorage()).payload); assert.equal(state.costReturned, null); assert.equal(state.costCards, null);
    m.advance('draw', 6); assert.equal(m.workForCoordinator().type, 'DRAW');
  }
});
