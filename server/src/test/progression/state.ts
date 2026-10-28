import type { Phase, Player, Progression, TimingIntent, Permission, PhaseWork } from "./types";

export class ProgressionError extends Error {
  constructor(message: string) { super(message); this.name = "ProgressionError"; }
}
export function requirePlayer(value: unknown): asserts value is Player {
  if (value !== 0 && value !== 1) throw new ProgressionError("Invalid player");
}
export function requireId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 100 || /[\x00-\x1f]/.test(value)) throw new ProgressionError("Invalid identifier");
}
export function phaseToken(turn: number, phase: Phase): string { return `turn:${turn}:${phase}`; }
export function freezeState(value: Progression): Progression {
  if (value.battle) {
    Object.freeze(value.battle.source); Object.freeze(value.battle.target); Object.freeze(value.battle);
  }
  Object.freeze(value.gate);
  if (value.outcome) Object.freeze(value.outcome);
  return Object.freeze(value);
}
export function createProgression(firstPlayer: Player): Progression {
  requirePlayer(firstPlayer);
  return freezeState({ version: 1, revision: 0, firstPlayer, activePlayer: firstPlayer, turnNumber: 1, phase: "refresh", phaseToken: phaseToken(1, "refresh"), phaseSettled: false, battle: null, gate: { kind: "idle" }, outcome: null });
}
export function playerTurnNumber(state: Progression, player: Player): number {
  requirePlayer(player);
  return Math.floor((state.turnNumber + (player === state.firstPlayer ? 1 : 0)) / 2);
}
export function checkTiming(state: Progression, actor: Player, intent: TimingIntent): Permission {
  requirePlayer(actor);
  const deny = (reason: string): Permission => ({ allowed: false, reason });
  if (state.outcome) return deny("Game is finished");
  if (state.gate.kind !== "idle") return deny("Resolution or choice is pending");
  if (intent === "triggerEffect") return deny("A damage/trigger context is not implemented yet");
  if (state.battle) {
    const battle = state.battle;
    if (actor !== battle.defender || battle.decisionComplete) return deny("Not the defending player's decision window");
    if ((intent === "passBlock" && battle.step === "block") || ((intent === "endCounter" || intent === "counterEffect") && battle.step === "counter")) return { allowed: true, scope: "timingOnly" };
    return deny("Operation is not available during this battle step");
  }
  if (state.phase !== "main" || !state.phaseSettled || actor !== state.activePlayer) return deny("Not an available main-phase window");
  if (intent === "attack" && playerTurnNumber(state, actor) <= 1) return deny("No battle on a player's first turn");
  if (["endMain", "playCard", "mainEffect", "attachDon", "attack"].includes(intent)) return { allowed: true, scope: "timingOnly" };
  return deny("Operation is not available");
}

export function checkChoiceResponder(state: Progression, actor: Player, resolutionId: string, selectionId: string): Permission {
  requirePlayer(actor);
  if (state.outcome || state.gate.kind !== "choice" || state.gate.chooser !== actor || state.gate.resolutionId !== resolutionId || state.gate.selectionId !== selectionId) return { allowed: false, reason: "Not this player's pending choice" };
  return { allowed: true, scope: "timingOnly" };
}

// Checkpoint descriptions are not executed card movements or an effect queue.
export function phaseWork(state: Progression): PhaseWork | null {
  if (state.outcome || state.gate.kind !== "idle" || state.battle || state.phaseSettled) return null;
  const base = { player: state.activePlayer, token: state.phaseToken };
  if (state.phase === "refresh") return Object.freeze({ ...base, kind: "refreshCheckpoint" });
  if (state.phase === "draw") return Object.freeze({ ...base, kind: "drawCheckpoint", normalCount: state.turnNumber === 1 ? 0 : 1 });
  if (state.phase === "don") return Object.freeze({ ...base, kind: "donCheckpoint", normalMaximum: state.turnNumber === 1 ? 1 : 2 });
  if (state.phase === "main") return Object.freeze({ ...base, kind: "mainEntryCheckpoint" });
  return Object.freeze({ ...base, kind: "endCheckpoint" });
}
