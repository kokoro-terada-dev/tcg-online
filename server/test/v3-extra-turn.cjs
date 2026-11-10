const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup: base, always } = require('./helpers/v3-event.cjs');
const { finish, id, select } = require('./helpers/v3-observed.cjs');
const { compileV3CardJson } = require('../dist/test/effects/v3/compiler.js');
const { ApprovedV3Catalog } = require('../dist/test/effects/v3/approval.js');
const { V3SyntheticMatchCoordinator } = require('../dist/test/effects/v3/matchCoordinator.js');
const { createProgression, playerTurnNumber, checkTiming } = require('../dist/test/progression/state.js');
const { applyPlayerIntent, applySystemEvent } = require('../dist/test/progression/transitions.js');

const snap = c => c.snapshotForCoordinator();
const ref = ({ instanceId, generation }) => ({ instanceId, generation });
const grant = { type: 'EXTRA_TURN' }, draw = { type: 'DRAW', player: 'SELF', count: 1 };
const leaderEffect = (id, timing, actions) => ({ id, kind: timing === 'MAIN' ? 'activated' : 'triggered',
  timing: timing === 'MAIN' ? { type: timing } : { type: timing, player: 'SELF' },
  sourceZones: ['leader'], optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions });
const duration = (boundary, player) => ({ type: 'UNTIL_BOUNDARY', boundary, player, occurrence: 1, includeCurrent: false });
const self = { ref: 'bindings.self' };
const mod = (amount, d) => ({ type: 'MODIFY_STAT', cards: self, stat: 'power', amount, duration: d });
const buff = { ...leaderEffect('buff', 'MAIN', [{ type: 'BIND_SOURCE', bindAs: 'self' },
  mod(1000, duration('TURN_START', 'SELF')), mod(2000, duration('TURN_START', 'OPPONENT')),
  { type: 'GRANT_KEYWORD', cards: self, keyword: { type: 'CANNOT_BE_BLOCKED' }, duration: duration('END_PHASE_END', 'OPPONENT') }
]), usageLimit: { type: 'PER_TURN', scope: 'SOURCE_OBJECT', count: 1 } };

function setup({ boundaries = false, deckOut = false } = {}) {
  const { options, approval } = base({ don: 2, field: 1 });
  const plans = options.cards.map(row => {
    const raw = structuredClone(row.definition);
    if (raw.cardType === 'event') return compileV3CardJson(JSON.stringify(raw));
    raw.schemaVersion = '3.0.0-subset.44';
    if (raw.cardType === 'leader' && boundaries) raw.effects = [buff, leaderEffect('end', 'TURN_END', [draw]), leaderEffect('start', 'MAIN_START', [draw])];
    if (raw.cardType === 'character') {
      raw.baseStats.cost = 1;
      raw.effects = [{ id: 'extra', kind: 'triggered', timing: { type: 'ON_PLAY' }, sourceZones: ['character'],
        optional: true, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: [], actions: deckOut ? [grant, draw] : [grant] }];
    }
    raw.source.text = raw.effects.length ? 'Synthetic extra turn fixture.' : '';
    return compileV3CardJson(JSON.stringify(raw));
  });
  const catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ ...approval, cardId: plan.definition.cardId, definitionHash: plan.definitionHash,
    sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash })), approval.rulesetVersion);
  const movement = structuredClone(options.movement), own = movement.players[0];
  for (const id of own.hand.slice(0, 2)) Object.assign(movement.cards[id], { cardId: 'TARGET', kind: 'character' });
  movement.cards[own.character[0]].rotated = true;
  if (deckOut) for (const id of own.deck.splice(1)) { own.trash.push(id); movement.cards[id].faceUp = true; }
  return new V3SyntheticMatchCoordinator({ ...options, movement, cards: plans.map(plan => catalog.get(plan.definition.cardId)) });
}
function useBuff(c) {
  const entry = c.mainEffectsFor(0).find(row => row.effectId === 'buff');
  assert.ok(entry.enabled);
  c.activateMain(0, id(), c.context(), entry.sourceToken, entry.effectId);
  finish(c, 0);
}
function playExtra(c) {
  const card = c.playableCardsFor(0).find(row => row.cardId === 'TARGET' && row.enabled);
  assert.ok(card, 'extra turn source must be playable');
  c.playCard(0, id(), c.context(), card.card);
  select(c, 'extra', 0);
  return finish(c, 0).choice;
}
function completePhases(c) {
  const steps = [];
  for (let i = 0; i < 8; i++) {
    const view = c.viewFor(0);
    if (view.triggerChooser !== null) {
      const actor = view.triggerChooser;
      const choice = c.viewFor(actor).triggerChoices[0];
      steps.push([view.turnNumber, actor, choice.effectId]);
      c.resolveTrigger(actor, id(), c.context(), choice.token); finish(c, actor);
    } else if (view.phaseContinuation) c.advance(view.activePlayer, id(), c.context());
    else return steps;
  }
  throw Error('Phase continuation did not finish');
}

test('extra turn waits for the choice, runs common boundaries and refresh, and resets once-per-turn use', () => {
  const c = setup({ boundaries: true }), before = snap(c).movement;
  const oldCharacter = before.players[0].character[0];
  c.attachDon(0, id(), c.context(), ref(before.cards[oldCharacter]), 1);
  useBuff(c);
  assert.equal(c.mainEffectsFor(0).find(row => row.effectId === 'buff').enabled, false);
  const choice = playExtra(c);
  assert.equal(choice.purpose, 'activation');
  assert.equal(snap(c).progression.extraTurnFor, undefined);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.throws(() => c.endTurn(0, id(), c.context()));
  assert.throws(() => c.answer(1, id(), c.context(), choice.selectionId, [choice.options[0].token]));
  c.answer(0, id(), c.context(), choice.selectionId, [choice.options[0].token]);
  const stale = c.context();
  c.advance(0, id(), c.context());
  assert.throws(() => c.applyPendingWork(0, id(), stale), /stale/);
  const request = id(), at = c.context();
  c.applyPendingWork(0, request, at);
  assert.equal(c.applyPendingWork(0, request, at).replayed, true);
  assert.equal(snap(c).active.movementEvents.length, 0);
  assert.equal(c.viewFor(1).extraTurnFor, 0);
  finish(c, 0);
  const start = id(), endContext = c.context();
  c.endTurn(0, start, endContext);
  assert.equal(c.viewFor(0).phase, 'end');
  assert.equal(c.viewFor(0).isExtraTurn, undefined);
  assert.equal(c.endTurn(0, start, endContext).replayed, true);
  assert.deepEqual(completePhases(c), [[1, 0, 'end'], [2, 0, 'start']]);
  const extra = snap(c);
  assert.equal(extra.progression.isExtraTurn, true);
  assert.equal(extra.progression.activePlayer, 0);
  assert.deepEqual(extra.progression.playerTurns, [2, 0]);
  assert.equal(extra.progression.extraTurnFor, undefined);
  assert.equal(extra.movement.turnNumber, 2);
  assert.equal(extra.movement.players[0].activeDon.length, 4);
  assert.equal(extra.movement.players[0].attachedDon.length, 0);
  assert.equal(extra.movement.cards[oldCharacter].rotated, false);
  assert.equal(extra.movement.players[0].deck.length, before.players[0].deck.length - 3);
  assert.deepEqual(extra.statEffects.map(effect => effect.amount), [2000]);
  assert.equal(extra.keywordGrants.length, 1);
  assert.ok(c.attackChoicesFor(0).pairs.length);
  useBuff(c);
  assert.equal(snap(c).statEffects.at(-1).boundary.anchor.turnOrder, 'TRACKED');
  c.endTurn(0, id(), c.context());
  assert.deepEqual(completePhases(c), [[2, 0, 'end'], [3, 1, 'start']]);
  const next = snap(c);
  assert.equal(next.progression.isExtraTurn, undefined);
  assert.deepEqual(next.progression.playerTurns, [2, 1]);
  assert.equal(next.progression.activePlayer, 1);
  assert.equal(checkTiming(next.progression, 1, 'attack').allowed, false);
  assert.deepEqual(next.statEffects.map(effect => effect.amount), [1000]);
  assert.equal(next.keywordGrants.length, 2);
  c.endTurn(1, id(), c.context());
  assert.deepEqual(completePhases(c), [[3, 1, 'end'], [4, 0, 'start']]);
  assert.equal(snap(c).keywordGrants.length, 0);
  assert.equal(snap(c).statEffects.length, 0);
});

test('wrong actor, stale reservation, stacking and chaining are rejected by shared progression', () => {
  let p = createProgression(1);
  const system = event => { p = applySystemEvent(p, p.revision, event); };
  const phase = () => system({ kind: 'settlePhase', phaseToken: p.phaseToken });
  const next = () => system({ kind: 'advancePhase', phaseToken: p.phaseToken });
  for (let i = 0; i < 3; i++) { phase(); next(); } phase();
  const start = () => system({ kind: 'beginResolution', controller: 1, resolutionId: 'r' });
  const grant = { kind: 'reserveExtraTurn', actor: 1, turnNumber: 1, resolutionId: 'r' };
  assert.throws(() => system(grant), /unavailable/);
  start();
  assert.throws(() => system({ ...grant, actor: 0 }), /unavailable/);
  assert.throws(() => system({ ...grant, turnNumber: 2 }), /unavailable/);
  system(grant);
  assert.throws(() => system(grant), /stacking/);
  system({ kind: 'finishResolution', resolutionId: 'r' });
  p = applyPlayerIntent(p, p.revision, 1, 'endMain'); phase(); next();
  assert.equal(p.activePlayer, 1); assert.equal(playerTurnNumber(p, 1), 2); assert.equal(playerTurnNumber(p, 0), 0);
  for (let i = 0; i < 3; i++) { phase(); next(); } phase();
  start();
  assert.throws(() => system({ ...grant, turnNumber: 2 }), /chaining/);
  assert.equal(p.extraTurnFor, undefined);
});

test('deck-out during a later action cancels an already reserved extra turn', () => {
  const c = setup({ deckOut: true }), choice = playExtra(c);
  c.answer(0, id(), c.context(), choice.selectionId, [choice.options[0].token]);
  c.advance(0, id(), c.context());
  c.applyPendingWork(0, id(), c.context());
  assert.equal(snap(c).progression.extraTurnFor, 0);
  finish(c, 0);
  const after = snap(c);
  assert.equal(after.progression.outcome.winner, 1);
  assert.equal(after.progression.extraTurnFor, undefined);
  assert.equal(after.progression.turnNumber, 1);
  assert.throws(() => c.endTurn(0, id(), c.context()));
});
