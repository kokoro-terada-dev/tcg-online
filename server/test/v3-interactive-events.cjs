const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, always } = require('./helpers/v3-event.cjs');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { V3ResolutionMachine } = require('../dist/test/effects/v3/resolution.js');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
let n = 0; const id = () => `interactive-${++n}`;
function selector({ chooser = 'SELF', min = 0, privateHand = false } = {}) {
  return { type: 'CARDS', owner: privateHand ? 'SELF' : 'OPPONENT', controller: privateHand ? 'SELF' : 'OPPONENT', chooser,
    zone: privateHand ? 'hand' : 'character', visibility: privateHand ? 'OWNER_ONLY' : 'PUBLIC', faceUpOnly: !privateHand,
    cardTypes: [privateHand ? 'event' : 'character'], filters: always(), excludeSource: false, min, max: 1,
    selectionMode: 'SELECT', order: 'UNORDERED', onInsufficient: 'fail' };
}
function fixture({ actor = 0, field = 2, chooser = 'SELF', min = 0, privateHand = false, mutate = () => {} } = {}) {
  return setup({ actor, field, mutate: d => {
    d.schemaVersion = '3.0.0-subset.20'; d.effects[0].actions = [
      { type: 'SELECT', selector: selector({ chooser, min, privateHand }), bindAs: 'target' },
      { type: 'IF', condition: { type: 'compare', left: { ref: 'bindings.target.count' }, op: 'gt', right: 0 },
        then: [privateHand ? { type: 'MOVE_CARD', cards: { ref: 'bindings.target' }, destination: { owner: 'SELF', zone: 'trash', position: 'append', faceUp: true }, cause: 'EFFECT' } : { type: 'REST', cards: { ref: 'bindings.target' } }], else: [] },
      { type: 'DRAW', player: 'SELF', count: 1 }]; mutate(d);
  } });
}
function declare(c, actor) { const e = c.mainEventChoicesFor(actor)[0]; c.useMainEvent(actor, id(), c.context(), e.sourceToken, e.effectId); return e; }
function finish(c, actor) {
  for (let i = 0; i < 20; i++) {
    const frame = c.viewFor(actor).frame;
    if (frame.status === 'completed') return;
    if (frame.status === 'ready') c.advance(actor, id(), c.context());
    else if (frame.status === 'waitingForWork') c.applyPendingWork(actor, id(), c.context());
    else throw Error('Unexpected choice or blocked frame');
  }
  throw Error('Not completed');
}

for (const actor of [0, 1]) for (const opponentChooses of [false, true]) test(`event declaration publishes paid source, keeps selection private and resumes (actor=${actor}, opponentChooses=${opponentChooses})`, () => {
  const { c } = fixture({ actor, chooser: opponentChooses ? 'OPPONENT' : 'SELF' }), chooser = opponentChooses ? 1 - actor : actor;
  const original = c.context(), e = c.mainEventChoicesFor(actor)[0], requestId = id(); c.useMainEvent(actor, requestId, original, e.sourceToken, e.effectId);
  assert.equal(c.useMainEvent(actor, requestId, original, e.sourceToken, e.effectId).replayed, true);
  const paid = c.snapshotForCoordinator(), v = c.viewFor(chooser), other = c.viewFor(1 - chooser);
  assert.equal(v.frame.status, 'waitingForChoice'); assert.equal(v.frame.choice.chooser, chooser); assert.equal(v.resolutionActor, actor);
  assert.equal(v.mainEvent.paidCost, 2); assert.deepEqual(other.mainEvent, v.mainEvent); assert.equal(paid.movement.players[actor].restDon.length, 2);
  assert.equal(paid.movement.players[actor].trash[0], e.source.instanceId); assert.equal(paid.movement.players[actor].hand.length, 4);
  assert.equal(v.frame.choice.options.length, 2); assert.deepEqual(other.frame.choice.options, []);
  assert.equal(c.mainEventChoicesFor(actor).length, 0); assert.equal(c.mainEffectsFor(actor).every(e => !e.enabled), true);
  assert.throws(() => c.endTurn(actor, id(), c.context())); assert.throws(() => c.useMainEvent(actor, id(), c.context(), e.sourceToken, e.effectId));
  const choice = v.frame.choice, before = c.snapshotForCoordinator();
  for (const [who, tokens] of [[1 - chooser, [choice.options[0].token]], [chooser, ['fake-target']], [chooser, [choice.options[0].token, choice.options[0].token]]]) assert.throws(() => c.answer(who, id(), c.context(), choice.selectionId, tokens));
  assert.deepEqual(c.snapshotForCoordinator(), before);
  const context = c.context(), answerId = id(); c.answer(chooser, answerId, context, choice.selectionId, [choice.options[0].token]);
  assert.equal(c.answer(chooser, answerId, context, choice.selectionId, [choice.options[0].token]).replayed, true);
  assert.throws(() => c.answer(chooser, answerId, context, choice.selectionId, []));
  assert.throws(() => c.answer(chooser, id(), context, choice.selectionId, [choice.options[0].token]));
  if (chooser !== actor) assert.throws(() => c.advance(chooser, id(), c.context()));
  finish(c, actor);
  assert.equal(c.viewFor(actor).mainEvent, null); assert.equal(c.viewFor(actor).gate, 'idle');
  assert.equal(c.viewFor(actor).movement.players[1 - actor].character.filter(Boolean).filter(card => card.rotated).length, 1);
  assert.equal(c.viewFor(actor).movement.players[actor].hand.length, 5); assert.equal(c.viewFor(actor).movement.players[actor].restDon.length, 2);
});

for (const empty of [false, true]) test(`zero target and optional skip retain paid use without refund (empty=${empty})`, () => {
  const { c } = fixture({ field: empty ? 0 : 2 }); declare(c, 0);
  if (!empty) { const q = c.viewFor(0).frame.choice; c.answer(0, id(), c.context(), q.selectionId, []); }
  finish(c, 0); assert.equal(c.viewFor(0).movement.players[0].trash.length, 1); assert.equal(c.viewFor(0).movement.players[0].restDon.length, 2);
  assert.equal(c.viewFor(0).movement.players[1].character.filter(Boolean).every(card => !card.rotated), true);
});

test('required target shortage at declaration is refused before any use becomes public', () => {
  const { c } = fixture({ field: 0, min: 1 }), before = c.snapshotForCoordinator(); assert.throws(() => declare(c, 0), /insufficient/);
  assert.deepEqual(c.snapshotForCoordinator(), before); assert.equal(c.viewFor(1).mainEvent, null);
});

test('own private hand candidates are only sent to their chooser, excluding the already used event', () => {
  const { c } = fixture({ privateHand: true }); const used = declare(c, 0), v = c.viewFor(0);
  assert.equal(v.frame.choice.options.length, 4); assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.equal(c.viewFor(1).movement.players[0].hand.every(card => card.ref === null && card.cardId === null), true);
  const q = v.frame.choice; c.answer(0, id(), c.context(), q.selectionId, [q.options[0].token]); finish(c, 0);
  assert.equal(c.viewFor(0).movement.players[0].trash.length, 2); assert.equal(c.viewFor(0).movement.players[0].trash[0].ref.instanceId, used.source.instanceId);
});

test('stale target generations and tampered storage signatures cannot authorize a selection', () => {
  const { options } = fixture(), card = options.cards[0], source = { instanceId: options.movement.players[0].hand[0], generation: 0 };
  let patch = {};
  const environment = { revision: () => 0, now: () => 1000, evaluate: () => true,
    candidates: () => [{ ref: { instanceId: 'target', generation: 0 }, cardId: 'TARGET', owner: 1, controller: 1, zone: 'character', kind: 'character', faceUp: true, visibleTo: [0, 1], ...patch }] };
  const identity = { matchId: options.movement.matchId, resolutionId: 'resume-test', effectId: 'main', actor: 0, source };
  const machine = new V3ResolutionMachine(card, identity, options.signingKey, environment); machine.advance('select', 0);
  const view = machine.viewFor(0), stored = machine.exportForStorage(), restored = V3ResolutionMachine.restore(card, identity, options.signingKey, environment, stored, view.revision);
  assert.deepEqual(restored.viewFor(0), view);
  for (const change of [{ ref: { instanceId: 'target', generation: 1 } }, { zone: 'trash' }, { owner: 0 }, { controller: 0 }, { visibleTo: [0] }, { faceUp: false }, { kind: 'stage' }]) {
    patch = change; assert.throws(() => restored.answer(0, id(), view.revision, view.choice.selectionId, [view.choice.options[0].token]), /stale/); assert.deepEqual(restored.viewFor(0), view);
  }
  patch = {}; restored.answer(0, 'valid', view.revision, view.choice.selectionId, [view.choice.options[0].token]);
  const tampered = JSON.parse(stored); tampered.signature = '0'.repeat(64);
  assert.throws(() => V3ResolutionMachine.restore(card, identity, options.signingKey, environment, JSON.stringify(tampered), view.revision));
});

test('failed work after declaration cannot undo public use or apply a partial move', () => {
  const { c } = fixture({ mutate: d => { d.effects[0].actions[1].then[0] = { type: 'MOVE_CARD', cards: { ref: 'bindings.target' }, destination: { owner: 'SELF', zone: 'hand', position: 'append', faceUp: true }, cause: 'EFFECT' }; } });
  declare(c, 0); const q = c.viewFor(0).frame.choice; c.answer(0, id(), c.context(), q.selectionId, [q.options[0].token]); c.advance(0, id(), c.context());
  const before = c.snapshotForCoordinator().movement; c.applyPendingWork(0, id(), c.context());
  assert.equal(c.viewFor(0).frame.status, 'blocked'); assert.deepEqual(c.snapshotForCoordinator().movement, before);
  assert.equal(c.viewFor(0).movement.players[0].restDon.length, 2); assert.equal(c.mainEventChoicesFor(0).length, 0); assert.throws(() => c.endTurn(0, id(), c.context()));
});

test('unsupported additional costs, source facts, deck search and event-source movement remain rejected', () => {
  const { d } = fixture();
  for (const mutate of [d => { d.effects[0].costs = [{ type: 'DISCARD_HAND', count: 1 }]; },
    d => { d.effects[0].actions = [{ type: 'BIND_SOURCE', bindAs: 'source' }]; },
    d => { d.effects[0].actions[0].selector.filters = { type: 'compare', left: { ref: 'SOURCE.cost' }, op: 'gte', right: 0 }; },
    d => { d.effects[0].actions = [{ type: 'LOOK_TOP', player: 'SELF', count: 3, bindAs: 'looked', onInsufficient: 'takeAvailable' }]; }]) {
    const x = structuredClone(d); mutate(x); assert.throws(() => compileV3CardJson(JSON.stringify(x)));
  }
});

test('expired answers retain declaration and pending choice instead of automatically declining or repaying', () => {
  const { options } = fixture(); let now = 1000;
  const c = new V3SyntheticMatchCoordinator({ ...options, now: () => now }); declare(c, 0); const q = c.viewFor(0).frame.choice;
  const before = c.snapshotForCoordinator(); now = q.expiresAt + 1;
  assert.throws(() => c.answer(0, id(), c.context(), q.selectionId, []), /expired/); assert.deepEqual(c.snapshotForCoordinator(), before);
});

test('existing KO work resolves selected character without a new event-specific executor', () => {
  const { c } = fixture({ mutate: d => { d.effects[0].actions[1].then = [{ type: 'KO', cards: { ref: 'bindings.target' } }]; } });
  declare(c, 0); const q = c.viewFor(0).frame.choice; c.answer(0, id(), c.context(), q.selectionId, [q.options[0].token]); finish(c, 0);
  assert.equal(c.viewFor(0).movement.players[1].character.filter(Boolean).length, 1); assert.equal(c.viewFor(0).movement.players[1].trash.length, 1);
});

test('later required-selection failure preserves earlier committed work and locks instead of refunding public information', () => {
  const { c } = fixture({ field: 1, min: 1, mutate: d => {
    d.effects[0].actions[1].then = [{ type: 'MOVE_CARD', cards: { ref: 'bindings.target' }, destination: { owner: 'OPPONENT', zone: 'trash', position: 'append', faceUp: true }, cause: 'EFFECT' }];
    d.effects[0].actions.splice(2, 0, { type: 'SELECT', selector: selector({ min: 1 }), bindAs: 'again' });
  } });
  declare(c, 0); const q = c.viewFor(0).frame.choice; c.answer(0, id(), c.context(), q.selectionId, [q.options[0].token]);
  c.advance(0, id(), c.context()); c.applyPendingWork(0, id(), c.context()); const before = c.snapshotForCoordinator();
  assert.throws(() => c.advance(0, id(), c.context()), /insufficient/); assert.deepEqual(c.snapshotForCoordinator(), before);
  assert.equal(c.mainEventChoicesFor(0).length, 0); assert.equal(c.viewFor(0).movement.players[1].trash.length, 1);
});

test('all existing 14 approvals cannot be mechanically migrated to schema20', () => {
  const { loadReviewedV3Catalog } = require('../dist/test/effects/v3/reviewedCatalog.js');
  const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
  const cards = loadReviewedV3Catalog().cards; assert.equal(cards.length, 14);
  for (const card of cards) {
    const d = structuredClone(card.definition); d.schemaVersion = '3.0.0-subset.20'; const compiled = compileV3CardJson(JSON.stringify(d));
    assert.throws(() => new ApprovedV3Catalog([compiled], [card.approval], card.rulesetVersion));
  }
});
