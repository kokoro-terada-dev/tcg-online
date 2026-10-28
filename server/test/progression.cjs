const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createProgression, playerTurnNumber, phaseWork, checkTiming, checkChoiceResponder, ProgressionError } = require("../dist/test/progression/state.js");
const { applySystemEvent, applyPlayerIntent } = require("../dist/test/progression/transitions.js");
const system = (state, event) => applySystemEvent(state, state.revision, event);
const player = (state, actor, intent) => applyPlayerIntent(state, state.revision, actor, intent);
const settle = state => system(state, { kind: "settlePhase", phaseToken: state.phaseToken });
const advance = state => system(state, { kind: "advancePhase", phaseToken: state.phaseToken });
function toMain(state) { while (state.phase !== "main") state = advance(state.phaseSettled ? state : settle(state)); return state.phaseSettled ? state : settle(state); }
function nextTurn(state) { return advance(settle(player(toMain(state), state.activePlayer, "endMain"))); }
function attackReady(first = 0) { let state = createProgression(first); state = nextTurn(state); state = nextTurn(state); return toMain(state); }
function start(state, id = "battle-1") { return system(state, { kind: "startBattle", battleId: id, source: { instanceId: "source", generation: 1 }, target: { instanceId: "target", generation: 2 } }); }
function settleBattle(state) { return system(state, { kind: "settleBattleStep", battleId: state.battle.battleId, step: state.battle.step }); }
function advanceBattle(state, present = true) { return system(state, { kind: "advanceBattle", battleId: state.battle.battleId, step: state.battle.step, participantsPresent: present }); }

test("initial turns mirror both possible first players and immutable states", () => {
  for (const first of [0, 1]) {
    const state = createProgression(first);
    assert.equal(state.turnNumber, 1); assert.equal(state.activePlayer, first);
    assert.equal(state.phase, "refresh"); assert.equal(state.phaseSettled, false);
    assert.equal(playerTurnNumber(state, first), 1); assert.equal(playerTurnNumber(state, 1 - first), 0);
    assert.equal(Object.isFrozen(state), true); assert.equal(Object.isFrozen(state.gate), true);
  }
  assert.throws(() => createProgression(2), ProgressionError);
});
test("phase checkpoints cannot be skipped and do not perform card movements", () => {
  let state = createProgression(0);
  assert.equal(phaseWork(state).kind, "refreshCheckpoint");
  assert.throws(() => advance(state), /unsettled/);
  const original = state;
  state = settle(state);
  assert.equal(original.phaseSettled, false); assert.equal(phaseWork(state), null);
  assert.throws(() => settle(state), /already settled/);
  for (const phase of ["draw", "don", "main"]) { state = advance(state); assert.equal(state.phase, phase); state = settle(state); }
  assert.throws(() => advance(state), /declaration/);
  state = player(state, 0, "endMain"); assert.equal(state.phase, "end");
  assert.throws(() => advance(state), /unsettled/);
  state = advance(settle(state)); assert.equal(state.phase, "refresh"); assert.equal(state.turnNumber, 2); assert.equal(state.activePlayer, 1);
});
test("normal draw/DON descriptions distinguish the very first turn only", () => {
  for (const first of [0, 1]) {
    let state = advance(settle(createProgression(first)));
    assert.equal(phaseWork(state).normalCount, 0);
    state = advance(settle(state)); assert.equal(phaseWork(state).normalMaximum, 1);
    state = nextTurn(state); state = advance(settle(state));
    assert.equal(phaseWork(state).normalCount, 1);
    state = advance(settle(state)); assert.equal(phaseWork(state).normalMaximum, 2);
  }
});
test("only turn player has voluntary main windows and neither player's first turn permits battle", () => {
  for (const first of [0, 1]) {
    let state = toMain(createProgression(first));
    for (const action of ["playCard", "mainEffect", "attachDon", "endMain"]) {
      assert.equal(checkTiming(state, first, action).allowed, true);
      assert.equal(checkTiming(state, 1 - first, action).allowed, false);
    }
    assert.equal(checkTiming(state, first, "attack").allowed, false);
    assert.throws(() => start(state), /first turn/);
    state = toMain(nextTurn(state));
    assert.equal(checkTiming(state, 1 - first, "attack").allowed, false);
    assert.throws(() => start(state), /first turn/);
    state = toMain(nextTurn(state));
    assert.equal(checkTiming(state, first, "attack").allowed, true);
  }
});
test("battle steps keep turn player separate from defending decision player", () => {
  for (const first of [0, 1]) {
    let state = start(attackReady(first));
    assert.equal(state.battle.step, "attack");
    assert.throws(() => advanceBattle(state), /not settled/);
    state = advanceBattle(settleBattle(state)); assert.equal(state.battle.step, "block");
    assert.equal(state.activePlayer, first);
    assert.throws(() => settleBattle(state), /decision pending/);
    assert.throws(() => player(state, first, "passBlock"));
    state = player(state, 1 - first, "passBlock");
    assert.throws(() => player(state, 1 - first, "passBlock"));
    state = advanceBattle(settleBattle(state)); assert.equal(state.battle.step, "counter");
    assert.equal(checkTiming(state, 1 - first, "counterEffect").allowed, true);
    assert.equal(checkTiming(state, first, "counterEffect").allowed, false);
    assert.equal(checkTiming(state, first, "mainEffect").allowed, false);
    state = player(state, 1 - first, "endCounter");
    state = advanceBattle(settleBattle(state)); assert.equal(state.battle.step, "damage");
    state = advanceBattle(settleBattle(state)); assert.equal(state.battle.step, "end");
    state = advanceBattle(settleBattle(state)); assert.equal(state.battle, null);
    assert.equal(state.turnNumber, 3); assert.equal(checkTiming(state, first, "mainEffect").allowed, true);
  }
});
test("a missing battle participant goes to battle end without damage", () => {
  for (const step of ["attack", "block", "counter"]) {
    let state = start(attackReady());
    if (step !== "attack") state = advanceBattle(settleBattle(state));
    if (step === "counter") state = advanceBattle(settleBattle(player(state, 1, "passBlock")));
    if (step === "block") state = player(state, 1, "passBlock");
    if (step === "counter") state = player(state, 1, "endCounter");
    state = advanceBattle(settleBattle(state), false);
    assert.equal(state.battle.step, "end");
  }
});
test("block redirection preserves the original attacker and can occur once", () => {
  let state = advanceBattle(settleBattle(start(attackReady())));
  const source = state.battle.source;
  state = system(state, { kind: "redirectBattle", battleId: state.battle.battleId, target: { instanceId: "blocker", generation: 5 } });
  assert.deepEqual(state.battle.source, source);
  assert.equal(state.battle.target.instanceId, "blocker");
  assert.throws(() => system(state, { kind: "redirectBattle", battleId: state.battle.battleId, target: { instanceId: "other", generation: 1 } }));
  assert.throws(() => player(state, 1, "passBlock"));
  state = advanceBattle(settleBattle(state));
  assert.equal(state.battle.step, "counter");
  assert.equal(state.battle.target.instanceId, "blocker");
});
test("resolutions and choices block phase progress and voluntary actions", () => {
  let state = toMain(createProgression(0));
  state = system(state, { kind: "beginResolution", resolutionId: "r1", controller: 0 });
  assert.equal(checkTiming(state, 0, "playCard").allowed, false);
  assert.throws(() => player(state, 0, "endMain"));
  assert.throws(() => system(state, { kind: "beginResolution", resolutionId: "nested", controller: 1 }));
  state = system(state, { kind: "waitForChoice", resolutionId: "r1", selectionId: "s1", chooser: 1 });
  assert.equal(checkChoiceResponder(state, 0, "r1", "s1").allowed, false);
  assert.equal(checkChoiceResponder(state, 1, "r1", "s1").allowed, true);
  assert.equal(checkChoiceResponder(state, 1, "old", "s1").allowed, false);
  assert.throws(() => system(state, { kind: "finishResolution", resolutionId: "r1" }));
  assert.throws(() => system(state, { kind: "acceptChoice", resolutionId: "r1", selectionId: "s1", chooser: 0 }));
  assert.throws(() => system(state, { kind: "acceptChoice", resolutionId: "r1", selectionId: "stale", chooser: 1 }));
  state = system(state, { kind: "acceptChoice", resolutionId: "r1", selectionId: "s1", chooser: 1 });
  assert.equal(state.gate.kind, "resolving");
  assert.throws(() => system(state, { kind: "acceptChoice", resolutionId: "r1", selectionId: "s1", chooser: 1 }));
  state = system(state, { kind: "finishResolution", resolutionId: "r1" });
  assert.equal(checkTiming(state, 0, "playCard").allowed, true);
});
test("counter decision window resumes after resolution without advancing the battle", () => {
  let state = advanceBattle(settleBattle(start(attackReady())));
  state = advanceBattle(settleBattle(player(state, 1, "passBlock")));
  const step = state.battle.step;
  state = system(state, { kind: "beginResolution", resolutionId: "counter-effect", controller: 1 });
  assert.equal(checkTiming(state, 1, "counterEffect").allowed, false);
  assert.throws(() => player(state, 1, "endCounter"));
  state = system(state, { kind: "finishResolution", resolutionId: "counter-effect" });
  assert.equal(state.battle.step, step); assert.equal(checkTiming(state, 1, "counterEffect").allowed, true);
});
test("revisions and phase/battle tokens reject stale or out-of-order acknowledgements", () => {
  const initial = createProgression(0), state = settle(initial);
  assert.throws(() => applySystemEvent(state, 0, { kind: "advancePhase", phaseToken: initial.phaseToken }), /revision/);
  const next = advance(state);
  assert.throws(() => system(next, { kind: "settlePhase", phaseToken: initial.phaseToken }), /checkpoint/);
  let battle = start(attackReady()); battle = advanceBattle(settleBattle(battle));
  assert.throws(() => system(battle, { kind: "settleBattleStep", battleId: "old", step: "block" }), /Stale/);
  assert.throws(() => system(battle, { kind: "settleBattleStep", battleId: battle.battle.battleId, step: "attack" }), /Stale/);
});
test("untrusted or malformed intents never grant server capabilities", () => {
  const state = attackReady();
  for (const intent of ["advancePhase", "finishResolution", "finishGame", "unknown", "playCard"]) assert.throws(() => player(state, 0, intent));
  assert.throws(() => system(state, { kind: "unknown" }));
  assert.throws(() => system(state, { kind: "startBattle", battleId: "b", source: { instanceId: "a", generation: -1 }, target: { instanceId: "b", generation: 0 } }));
  assert.throws(() => system(state, { kind: "beginResolution", resolutionId: "r", controller: 2 }));
  assert.equal(checkTiming(state, 0, "triggerEffect").allowed, false);
});
test("game end is terminal even while awaiting a choice", () => {
  let state = createProgression(0);
  state = system(state, { kind: "beginResolution", resolutionId: "r", controller: 0 });
  state = system(state, { kind: "waitForChoice", resolutionId: "r", selectionId: "s", chooser: 1 });
  state = system(state, { kind: "finishGame", winner: 1, reason: "validated-by-rule-engine" });
  assert.equal(state.outcome.winner, 1); assert.equal(phaseWork(state), null);
  assert.equal(checkChoiceResponder(state, 1, "r", "s").allowed, false);
  assert.equal(checkTiming(state, 0, "mainEffect").allowed, false);
  assert.throws(() => system(state, { kind: "finishResolution", resolutionId: "r" }), /finished/);
});
test("card generations are copied and JSON snapshots remain deterministic", () => {
  const state = attackReady(), source = { instanceId: "source", generation: 1 }, target = { instanceId: "target", generation: 2 };
  const next = system(state, { kind: "startBattle", battleId: "b", source, target });
  source.generation = 99;
  assert.equal(next.battle.source.generation, 1); assert.equal(state.battle, null);
  assert.equal(Object.isFrozen(next.battle.source), true);
  assert.deepEqual(JSON.parse(JSON.stringify(next)).battle.target, target);
});
