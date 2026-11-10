const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, always } = require('./helpers/v3-event.cjs');
const { finish, selector, id } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { retargetBattle } = require('../dist/test/effects/v3/battle.js');
const { createProgression } = require('../dist/test/progression/state.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');

const snap = c => c.snapshotForCoordinator();
const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const refAt = (board, seat, zone, slot = 0) => ref(board.cards[board.players[seat][zone][slot]]);
const effect = (timing, zone, actions, costs = []) => ({
  id: timing.toLowerCase(), kind: ['MAIN', 'COUNTER'].includes(timing) ? 'activated' : 'triggered', timing: { type: timing },
  sourceZones: [zone], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs, actions
});
const redirect = [
  { type: 'SELECT', bindAs: 'target', selector: { ...selector('SELF'), min: 1 } },
  { type: 'RETARGET_BATTLE', cards: { ref: 'bindings.target' } }
];
const draw = { type: 'DRAW', player: 'SELF', count: 1 };
function setup({ attackRedirect = false, counter = false, banish = null, don = 1, returnCount = 1 } = {}) {
  const { options, approval } = base({ don, field: 2, cost: 1 });
  const plans = options.cards.map(card => {
    const raw = structuredClone(card.definition); raw.schemaVersion = '3.0.0-subset.42';
    if (raw.cardType === 'event') {
      raw.effects = [];
      if (counter) raw.effects.push(effect('COUNTER', 'hand', redirect, [{ type: 'DON_RETURN', count: returnCount, from: ['restDon'] }]));
      raw.effects.push(effect('TRIGGER', 'life', [draw]));
      raw.source.triggerText = 'Synthetic life trigger.';
    }
    if (raw.cardType === 'leader') {
      if (attackRedirect) raw.effects = [effect('ON_OPPONENT_ATTACK', 'leader', redirect)];
      if (banish === 'printed') raw.keywords = [{ type: 'BANISH' }];
      if (banish === 'granted') raw.effects = [effect('MAIN', 'leader', [{ type: 'BIND_SOURCE', bindAs: 'self' },
        { type: 'GRANT_KEYWORD', cards: { ref: 'bindings.self' }, keyword: { type: 'BANISH' }, duration: { type: 'TURN_END', player: 'SELF', occurrence: 1 } }])];
    }
    if (raw.cardType === 'character') {
      raw.baseStats.power = 5000;
      raw.keywords = [{ type: 'BLOCKER' }];
      raw.effects = [effect('ON_KO', 'character', [draw])];
    }
    raw.source.text = raw.effects.some(e => e.timing.type !== 'TRIGGER') || raw.keywords.length ? 'Synthetic battle effects.' : '';
    return compileV3CardJson(JSON.stringify(raw));
  });
  const catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ ...approval, cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion,
    definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash
  })), approval.rulesetVersion);
  const movement = structuredClone(options.movement); movement.turnNumber = 3;
  Object.assign(movement.cards[movement.players[1].hand[1]], { cardId: 'TARGET', kind: 'character' });
  let progression = createProgression(0);
  while (true) {
    if (!progression.phaseSettled) progression = applySystemEvent(progression, progression.revision, { kind: 'settlePhase', phaseToken: progression.phaseToken });
    if (progression.phase === 'main') {
      if (progression.turnNumber === 3) break;
      progression = applyPlayerIntent(progression, progression.revision, progression.activePlayer, 'endMain');
    } else progression = applySystemEvent(progression, progression.revision, { kind: 'advancePhase', phaseToken: progression.phaseToken });
  }
  const cards = plans.map(plan => catalog.get(plan.definition.cardId)), definitions = new Map(cards.map(card => [card.definition.cardId, card]));
  return { c: new V3SyntheticMatchCoordinator({ ...options, movement, progression, cards }), definitions };
}
function attack(c) {
  const board = snap(c).movement, attacker = refAt(board, 0, 'leader'), target = refAt(board, 1, 'leader');
  c.attack(0, id(), c.context(), attacker, target); return { attacker, target };
}
function choose(c, choice, index = 0) { return c.answer(1, id(), c.context(), choice.selectionId, [choice.options[index].token]); }

test('attack-step effect changes the defender target, keeps the attacker and still opens the original block window', () => {
  const { c, definitions } = setup({ attackRedirect: true }), { attacker, target } = attack(c);
  const trigger = c.viewFor(1).triggerChoices[0];
  c.resolveTrigger(1, id(), c.context(), trigger.token);
  const { choice } = finish(c, 1);
  const next = refAt(snap(c).movement, 1, 'character');
  assert.deepEqual(c.viewFor(0).frame.choice.options, []);
  assert.throws(() => c.answer(0, id(), c.context(), choice.selectionId, [choice.options[0].token]), /chooser/);
  assert.throws(() => c.answer(1, id(), c.context(), choice.selectionId, [attacker.instanceId]), /token/);
  choose(c, choice);
  c.advance(1, id(), c.context());
  const before = snap(c), identity = JSON.parse(JSON.parse(before.active.frame).payload).identity;
  for (const invalid of [attacker, { ...next, generation: next.generation + 1 }])
    assert.throws(() => retargetBattle(before.movement, before.progression, identity, 'ON_OPPONENT_ATTACK', invalid, definitions));
  assert.throws(() => retargetBattle(before.movement, before.progression, identity, 'COUNTER', next, definitions), /window/);
  const at = c.context(), work = id();
  c.applyPendingWork(1, work, at);
  assert.equal(c.applyPendingWork(1, work, at).replayed, true);
  const changed = snap(c).progression.battle;
  assert.deepEqual(changed.source, attacker);
  assert.deepEqual(changed.target, next);
  assert.deepEqual(changed.lastRetarget, { previousTarget: target, source: target, effectId: 'on_opponent_attack', actor: 1 });
  assert.equal(snap(c).active.movementEvents.length, 0);
  finish(c, 1);
  assert.equal(c.viewFor(1).battle.step, 'block');
  assert.ok(c.viewFor(1).blockerChoices.every(row => row.card.instanceId !== next.instanceId));
});

test('counter redirects after block, pays DON once and leaves old counter power on the blocker', () => {
  const insufficient = setup({ counter: true, returnCount: 2 }).c;
  attack(insufficient);
  insufficient.battleDecision(1, id(), insufficient.context(), 'passBlock');
  const unavailable = insufficient.viewFor(1).counterEventChoices[0];
  const unpaid = snap(insufficient).movement;
  assert.equal(unavailable.enabled, false);
  assert.throws(() => insufficient.useCounterEvent(1, id(), insufficient.context(), unavailable.card, unavailable.effectId));
  assert.deepEqual(snap(insufficient).movement, unpaid);

  const { c } = setup({ counter: true }), { attacker } = attack(c), board = snap(c).movement;
  const blocker = refAt(board, 1, 'character'), next = refAt(board, 1, 'character', 1);
  c.block(1, id(), c.context(), blocker);
  c.counter(1, id(), c.context(), refAt(board, 1, 'hand', 1), blocker);
  assert.equal(c.viewFor(1).battle.powers.defense, 6000);
  const event = c.viewFor(1).counterEventChoices[0];
  const request = id(), at = c.context();
  c.useCounterEvent(1, request, at, event.card, event.effectId);
  assert.equal(c.useCounterEvent(1, request, at, event.card, event.effectId).replayed, true);
  let { choice } = finish(c, 1);
  assert.equal(choice.purpose, 'returnCost');
  choose(c, choice);
  ({ choice } = finish(c, 1));
  choose(c, choice, 1);
  finish(c, 1);
  const battle = c.viewFor(1).battle;
  assert.equal(battle.step, 'counter');
  assert.deepEqual(battle.source, attacker);
  assert.deepEqual(battle.target, next);
  assert.deepEqual(battle.blocker, blocker);
  assert.deepEqual(battle.lastRetarget.previousTarget, blocker);
  assert.equal(battle.lastRetarget.source.instanceId, event.card.instanceId);
  assert.equal(battle.powers.defense, 5000);
  assert.deepEqual(c.viewFor(1).blockerChoices, []);
  assert.equal(snap(c).movement.players[1].donDeck.length, 10);
  c.battleDecision(1, id(), c.context(), 'endCounter');
  c.resolveDamage(1, id(), c.context());
  assert.equal(snap(c).movement.players[1].character[1], null);
  assert.equal(c.viewFor(1).triggerChoices[0].timing, 'ON_KO');
});

test('Banish uses the current attacker ability and suppresses life choices only on a hit', () => {
  for (const [banish, miss] of [['printed', false], ['granted', false], ['printed', true], [null, false]]) {
    const { c } = setup({ banish });
    if (banish === 'granted') {
      const main = c.mainEffectsFor(0)[0];
      c.activateMain(0, id(), c.context(), main.sourceToken, main.effectId); finish(c, 0);
    }
    const { attacker, target } = attack(c), board = snap(c).movement, top = board.players[1].life[0];
    c.battleDecision(1, id(), c.context(), 'passBlock');
    if (miss) c.counter(1, id(), c.context(), refAt(board, 1, 'hand', 1), target);
    c.battleDecision(1, id(), c.context(), 'endCounter');
    const request = id(), at = c.context();
    c.resolveDamage(1, request, at);
    assert.equal(c.resolveDamage(1, request, at).replayed, true);
    const after = snap(c);
    assert.equal(after.movement.players[1].life.length, board.players[1].life.length - (banish && !miss ? 1 : 0));
    if (!banish) { assert.equal(c.viewFor(1).lifeChoice.canTrigger, true); continue; }
    assert.equal(c.viewFor(1).lifeChoice, null);
    if (!miss) {
      assert.equal(after.movement.players[1].trash.at(-1), top);
      const event = after.ruleEvents.at(-1);
      assert.equal(event.isKO, false);
      assert.equal(event.cause.kind, 'DAMAGE');
      assert.deepEqual(event.cause.source, attacker);
      assert.equal(c.viewFor(1).triggerChoices.length, 0);
    }
  }
});
