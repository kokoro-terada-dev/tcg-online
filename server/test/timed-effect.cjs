const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TimedMovementEffect } = require('../dist/test/effects/timedMovement.js');
const { createMovementState, emptyZones } = require('../dist/test/movement/state.js');
const { createProgression, checkTiming } = require('../dist/test/progression/state.js');
const { applySystemEvent, applyPlayerIntent } = require('../dist/test/progression/transitions.js');
const rules = { status: 'certifiedNone' };
const ref = id => ({ instanceId: id, generation: 0 });
const system = (p, event) => applySystemEvent(p, p.revision, event);
function main(first = 0) {
  let p = createProgression(first);
  while (true) {
    p = system(p, { kind: 'settlePhase', phaseToken: p.phaseToken });
    if (p.phase === 'main') return p;
    p = system(p, { kind: 'advancePhase', phaseToken: p.phaseToken });
  }
}
function counter(first = 0) {
  let p = main(first);
  for (let i = 0; i < 2; i++) {
    p = applyPlayerIntent(p, p.revision, p.activePlayer, 'endMain');
    p = system(p, { kind: 'settlePhase', phaseToken: p.phaseToken });
    p = system(p, { kind: 'advancePhase', phaseToken: p.phaseToken });
    while (p.phase !== 'main') { p = system(p, { kind: 'settlePhase', phaseToken: p.phaseToken }); p = system(p, { kind: 'advancePhase', phaseToken: p.phaseToken }); }
    p = system(p, { kind: 'settlePhase', phaseToken: p.phaseToken });
  }
  p = system(p, { kind: 'startBattle', battleId: 'battle', source: ref(`leader${first}`), target: ref(`leader${1 - first}`) });
  p = system(p, { kind: 'settleBattleStep', battleId: 'battle', step: 'attack' });
  p = system(p, { kind: 'advanceBattle', battleId: 'battle', step: 'attack', participantsPresent: true });
  p = applyPlayerIntent(p, p.revision, 1 - first, 'passBlock');
  p = system(p, { kind: 'settleBattleStep', battleId: 'battle', step: 'block' });
  return system(p, { kind: 'advanceBattle', battleId: 'battle', step: 'block', participantsPresent: true });
}
function board(p, dons = 2) {
  const players = [emptyZones(), emptyZones()], cards = {};
  for (const actor of [0, 1]) for (const [id, kind, zone] of [[`leader${actor}`, 'leader', 'leader'], [`card${actor}`, 'character', 'deck'], ...Array.from({ length: dons }, (_, i) => [`don${actor}-${i}`, 'don', 'activeDon'])]) {
    cards[id] = { ...ref(id), cardId: kind === 'leader' ? 'TEST' : id, kind, owner: actor, controller: actor, faceUp: zone !== 'deck', rotated: false, attachedTo: null, modifierIds: [], grantIds: [], enteredTurn: null };
    if (zone === 'leader') players[actor].leader[0] = id; else players[actor][zone].push(id);
  }
  return createMovementState({ matchId: 'm', turnNumber: p.turnNumber, players, cards });
}
const draw = { kind: 'draw', player: 'SELF', amount: 1 };
function runtime(p = main(), actor = p.activePlayer, patch = {}, dons = 2) {
  return new TimedMovementEffect(board(p, dons), p, { resolutionId: 'r', actor, source: ref(`leader${actor}`) },
    { dslVersion: 1, effectId: 'e', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs: [{ kind: 'payDon', amount: 1 }], actions: [draw], ...patch });
}
const revisions = r => ({ movement: r.snapshot().movement.revision, progression: r.snapshot().progression.revision });
const reply = (r, actor, tokens) => { const v = r.selectionViewFor(actor); return { matchId: v.matchId, resolutionId: v.resolutionId, selectionId: v.selectionId, revision: v.revision, tokens: tokens ?? [v.options[0].token] }; };
const choose = chooser => ({ kind: 'select', saveAs: 'choice', selector: { kind: 'choice', chooser, options: [{ id: 'yes', label: 'Yes' }] } });
const condition = (from, field, value) => ({ kind: 'compare', operator: 'EQ', left: { kind: 'ref', from, field }, right: { kind: 'literal', value } });
test('main activation locks progression before effects and unlocks only on completion for both seats', () => {
  for (const actor of [0, 1]) {
    const r = runtime(main(actor)); r.start(actor, revisions(r), rules);
    assert.equal(r.snapshot().progression.gate.kind, 'resolving');
    assert.equal(r.snapshot().movement.players[actor].restDon.length, 1);
    assert.equal(checkTiming(r.snapshot().progression, actor, 'endMain').allowed, false);
    r.advance(actor, revisions(r), rules);
    assert.equal(r.snapshot().progression.gate.kind, 'idle');
    assert.equal(r.view().status, 'completed');
    assert.equal(checkTiming(r.snapshot().progression, actor, 'endMain').allowed, true);
  }
});
test('wrong player and non-main/unfinished windows cannot charge DON', () => {
  for (const p of [main(), createProgression(0), { ...main(), phaseSettled: false }]) {
    const actor = p.phase === 'main' && p.phaseSettled ? 1 : 0, r = runtime(p, actor), before = r.snapshot();
    assert.throws(() => r.start(actor, revisions(r), rules), /window-unavailable/);
    assert.equal(r.snapshot().movement, before.movement); assert.equal(r.snapshot().progression, before.progression);
  }
  const r = runtime(); assert.throws(() => r.start(1, revisions(r), rules), /wrong-timed-effect-actor/);
});
test('top-level false or unknown conditions do not consume DON or reserve the gate', () => {
  for (const predicate of [condition('SELF', 'handCount', 1), condition('SOURCE', 'power', 5000)]) {
    const r = runtime(main(), 0, { condition: predicate }), before = r.snapshot();
    assert.throws(() => r.start(0, revisions(r), rules), /activation-/);
    assert.equal(r.snapshot().movement, before.movement); assert.equal(r.snapshot().progression, before.progression);
    assert.equal(r.view().status, 'prepared');
  }
});
test('authoritative phase and activePlayer facts satisfy activation and later conditions', () => {
  const predicate = { kind: 'all', conditions: [condition('GAME', 'phase', 'main'), condition('GAME', 'activePlayer', 1), condition('GAME', 'turnNumber', 1)] };
  const r = runtime(main(1), 1, { condition: predicate, actions: [{ kind: 'if', condition: structuredClone(predicate), then: [draw], else: [] }] });
  r.start(1, revisions(r), rules); r.advance(1, revisions(r), rules); r.advance(1, revisions(r), rules);
  assert.equal(r.snapshot().movement.players[1].hand.length, 1);
});
test('insufficient or prevented payment leaves both state machines unchanged', () => {
  for (const [dons, guard] of [[0, rules], [2, { status: 'evaluate', check: () => ({ kind: 'prevent' }) }]]) {
    const r = runtime(main(), 0, {}, dons), before = r.snapshot();
    assert.throws(() => r.start(0, revisions(r), guard));
    assert.equal(r.snapshot().movement, before.movement); assert.equal(r.snapshot().progression, before.progression);
    assert.equal(r.view().status, 'prepared');
  }
});
test('choice gates track opponent chooser and preserve the same turn/phase', () => {
  const r = runtime(main(), 0, { actions: [choose('OPPONENT'), draw] }); r.start(0, revisions(r), rules);
  r.advance(0, revisions(r), rules);
  assert.equal(r.snapshot().progression.gate.kind, 'choice'); assert.equal(r.snapshot().progression.gate.chooser, 1);
  const before = r.snapshot(), valid = reply(r, 1);
  assert.throws(() => r.answerSelection(0, revisions(r), valid, rules));
  assert.throws(() => r.answerSelection(1, revisions(r), { ...valid, selectionId: 'wrong' }, rules));
  assert.equal(r.snapshot().progression, before.progression); assert.equal(r.snapshot().movement, before.movement);
  assert.throws(() => r.advance(0, revisions(r), rules), /not-resolving/);
  r.answerSelection(1, revisions(r), valid, rules);
  assert.equal(r.snapshot().progression.gate.kind, 'resolving');
  r.advance(0, revisions(r), rules);
  assert.equal(r.snapshot().progression.phase, 'main'); assert.equal(r.snapshot().progression.turnNumber, 1);
  assert.equal(r.snapshot().progression.gate.kind, 'idle');
});
test('a failed effect retains payment and keeps progression locked', () => {
  const r = runtime(main(), 0, { actions: [{ ...draw, amount: 2 }] }); r.start(0, revisions(r), rules);
  const before = r.snapshot(); assert.throws(() => r.advance(0, revisions(r), rules));
  assert.equal(r.snapshot().movement, before.movement); assert.equal(r.snapshot().progression, before.progression);
  assert.equal(r.view().status, 'blocked'); assert.equal(r.snapshot().progression.gate.kind, 'resolving');
});
test('failed valid answer commit consumes choice but retains a locked resolution', () => {
  const r = runtime(main(), 0, { actions: [choose('SELF')] }); r.start(0, revisions(r), rules); r.advance(0, revisions(r), rules);
  const before = r.snapshot(), valid = reply(r, 0);
  assert.throws(() => r.answerSelection(0, revisions(r), valid, { status: 'unresolved' }));
  assert.equal(r.snapshot().movement, before.movement);
  assert.equal(r.snapshot().progression.gate.kind, 'resolving'); assert.equal(r.view().status, 'blocked');
  assert.throws(() => r.answerSelection(0, revisions(r), valid, rules));
});
test('both movement and progression revisions reject stale commands before payment', () => {
  const r = runtime(), expected = revisions(r), before = r.snapshot();
  assert.throws(() => r.start(0, { ...expected, movement: 99 }, rules), /revisions/);
  assert.throws(() => r.start(0, { ...expected, progression: 99 }, rules), /revisions/);
  assert.equal(r.snapshot().movement, before.movement); r.start(0, expected, rules);
  assert.throws(() => r.start(0, expected, rules), /revisions/);
});
test('counter timing belongs to the defender, never the attacker', () => {
  for (const first of [0, 1]) {
    const p = counter(first), patch = { trigger: { kind: 'activate', window: 'counter' } };
    const defender = runtime(p, 1 - first, patch); defender.start(1 - first, revisions(defender), rules);
    defender.advance(1 - first, revisions(defender), rules);
    assert.equal(defender.snapshot().progression.battle.step, 'counter');
    assert.equal(defender.snapshot().progression.gate.kind, 'idle');
    const attacker = runtime(p, first, patch); assert.throws(() => attacker.start(first, revisions(attacker), rules), /window-unavailable/);
    const wrongWindow = runtime(p, 1 - first); assert.throws(() => wrongWindow.start(1 - first, revisions(wrongWindow), rules), /window-unavailable/);
  }
});
test('triggered events, damage triggers and off-board sources are explicitly unsupported', () => {
  assert.throws(() => runtime(main(), 0, { trigger: { kind: 'event', event: 'onPlay' } }), /trigger-not-supported/);
  assert.throws(() => runtime(main(), 0, { trigger: { kind: 'activate', window: 'trigger' } }), /trigger-not-supported/);
  const p = main();
  assert.throws(() => new TimedMovementEffect(board(p), p, { resolutionId: 'r', actor: 0, source: ref('card0') },
    { dslVersion: 1, effectId: 'e', cardId: 'card0', trigger: { kind: 'activate', window: 'main' }, costs: [], actions: [] }), /board-source-required/);
});
test('game over and occupied gates reject new activations', () => {
  for (const p of [system(main(), { kind: 'finishGame', winner: 0, reason: 'test' }), system(main(), { kind: 'beginResolution', resolutionId: 'other', controller: 0 })]) {
    const r = runtime(p), before = r.snapshot(); assert.throws(() => r.start(0, revisions(r), rules), /window-unavailable/);
    assert.equal(r.snapshot().movement, before.movement);
  }
});
test('revision overflow is refused before payment, including empty effects', () => {
  const p = { ...main(), revision: Number.MAX_SAFE_INTEGER - 1 }, r = runtime(p, 0, { actions: [] }), before = r.snapshot();
  assert.throws(() => r.start(0, revisions(r), rules), /revision-limit/);
  assert.equal(r.snapshot().movement, before.movement);
});
test('empty effects open and close the gate in the same call', () => {
  const r = runtime(main(), 0, { actions: [] }), before = revisions(r); r.start(0, before, rules);
  assert.equal(r.snapshot().progression.gate.kind, 'idle'); assert.equal(r.snapshot().progression.revision, before.progression + 2);
  assert.equal(r.snapshot().movement.revision, 1); assert.equal(r.view().status, 'completed');
});
test('reentrant rule callbacks cannot split board payment from progression publication', () => {
  const r = runtime(), expected = revisions(r);
  r.start(0, expected, { status: 'evaluate', check() {
    assert.throws(() => r.start(0, expected, rules), /reentrant/);
    assert.throws(() => r.advance(0, expected, rules), /reentrant/);
    assert.equal(r.snapshot().progression.gate.kind, 'idle');
    return { kind: 'allow' };
  } });
  assert.equal(r.snapshot().progression.gate.kind, 'resolving');
  assert.throws(() => JSON.stringify(r), /server-only/);
});
test('stale battle references and mismatched turn contexts are refused before activation', () => {
  const p = counter(), stale = { ...p, battle: { ...p.battle, source: { ...p.battle.source, generation: 1 } } };
  assert.throws(() => runtime(stale, 1, { trigger: { kind: 'activate', window: 'counter' } }), /stale-or-missing/);
  const m = main();
  assert.throws(() => new TimedMovementEffect(board(m), { ...m, turnNumber: 99 }, { resolutionId: 'r', actor: 0, source: ref('leader0') },
    { dslVersion: 1, effectId: 'e', cardId: 'TEST', trigger: { kind: 'activate', window: 'main' }, costs: [], actions: [] }), /context-mismatch/);
});
test('caller mutation cannot change a captured timing window or condition', () => {
  const p = structuredClone(main()), predicate = condition('GAME', 'activePlayer', 0), r = runtime(p, 0, { condition: predicate });
  p.activePlayer = 1; p.phase = 'end'; predicate.right.value = 1;
  r.start(0, revisions(r), rules); r.advance(0, revisions(r), rules);
  assert.equal(r.view().status, 'completed'); assert.equal(r.snapshot().progression.activePlayer, 0);
});
test('counter cost planning locks the defender window without advancing the battle', () => {
  for (const first of [0, 1]) {
    const actor = 1 - first, r = runtime(counter(first), actor, {
      trigger: { kind: 'activate', window: 'counter' }, actions: [],
      costs: [{ kind: 'payDon', amount: 1 }, { kind: 'restCards', selector: { kind: 'cards', owner: 'SELF', chooser: 'SELF', zones: ['leader'], min: 1, max: 1, mode: 'SELECT' } }]
    });
    const battle = r.snapshot().progression.battle; r.beginCostSelection(actor, revisions(r));
    assert.equal(r.snapshot().progression.gate.kind, 'choice'); assert.equal(r.selectionViewFor(first), null);
    const view = r.selectionViewFor(actor);
    r.answerCostSelection(actor, revisions(r), { matchId: view.matchId, resolutionId: view.resolutionId, selectionId: view.selectionId,
      revision: view.revision, tokens: [view.candidates[0].token] });
    r.commitCostSelection(actor, revisions(r), rules);
    assert.deepEqual(r.snapshot().progression.battle, battle); assert.equal(r.snapshot().progression.gate.kind, 'idle');
    assert.equal(r.snapshot().movement.cards[`leader${actor}`].rotated, true);
  }
});
test('cost planning reserves enough revision headroom for replies, cancellation and effects', () => {
  const p = { ...main(), revision: Number.MAX_SAFE_INTEGER - 389 }, r = runtime(p), before = r.snapshot();
  assert.throws(() => r.beginCostSelection(0, revisions(r)), /revision-limit/);
  assert.equal(r.snapshot().movement, before.movement); assert.equal(r.snapshot().progression, before.progression);
});
