import type { CardObjectRef } from "../effects/types";

export type Player = 0 | 1;
export type Phase = "refresh" | "draw" | "don" | "main" | "end";
export type BattleStep = "attack" | "block" | "counter" | "damage" | "end";
export type Gate =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "resolving"; resolutionId: string; controller: Player }>
  | Readonly<{ kind: "choice"; resolutionId: string; controller: Player; selectionId: string; chooser: Player }>;
export type Battle = Readonly<{
  battleId: string; attacker: Player; defender: Player; source: Readonly<CardObjectRef>; target: Readonly<CardObjectRef>;
  blocker?: Readonly<CardObjectRef>;
  remainingDamage?: Readonly<{ banish: boolean }>;
  lastRetarget?: Readonly<{ previousTarget: Readonly<CardObjectRef>; source: Readonly<CardObjectRef>; effectId: string; actor: Player }>;
  step: BattleStep; decisionComplete: boolean; settled: boolean;
}>;
export type Progression = Readonly<{
  version: 1; revision: number; firstPlayer: Player; activePlayer: Player; turnNumber: number;
  playerTurns?: readonly [number, number]; extraTurnFor?: Player; isExtraTurn?: true;
  phase: Phase; phaseToken: string; phaseSettled: boolean;
  battle: Battle | null; gate: Gate;
  outcome: Readonly<{ winner: Player | null; reason: string }> | null;
}>;
export type PlayerIntent = "endMain" | "passBlock" | "endCounter";
export type TimingIntent = PlayerIntent | "playCard" | "mainEffect" | "attachDon" | "attack" | "counterEffect" | "triggerEffect";
export type Permission = Readonly<{ allowed: true; scope: "timingOnly" }> | Readonly<{ allowed: false; reason: string }>;
// These are trusted internal acknowledgements, never client-supplied commands.
export type SystemEvent =
  | { kind: "settlePhase"; phaseToken: string }
  | { kind: "advancePhase"; phaseToken: string }
  | { kind: "reserveExtraTurn"; actor: Player; turnNumber: number; resolutionId: string }
  | { kind: "startBattle"; battleId: string; source: CardObjectRef; target: CardObjectRef }
  | { kind: "redirectBattle"; battleId: string; target: CardObjectRef; recordBlocker?: true }
  | { kind: "retargetBattleByEffect"; battleId: string; step: "attack" | "counter"; resolutionId: string; actor: Player; source: CardObjectRef; effectId: string; target: CardObjectRef }
  | { kind: "settleBattleStep"; battleId: string; step: BattleStep }
  | { kind: "recordRemainingDamage"; battleId: string; banish: boolean }
  | { kind: "consumeRemainingDamage"; battleId: string }
  | { kind: "advanceBattle"; battleId: string; step: BattleStep; participantsPresent: boolean }
  | { kind: "beginResolution"; resolutionId: string; controller: Player }
  | { kind: "waitForChoice"; resolutionId: string; selectionId: string; chooser: Player }
  | { kind: "acceptChoice"; resolutionId: string; selectionId: string; chooser: Player }
  | { kind: "finishResolution"; resolutionId: string }
  | { kind: "finishGame"; winner: Player | null; reason: string };

export type PhaseWork =
  | Readonly<{ kind: "refreshCheckpoint"; player: Player; token: string }>
  | Readonly<{ kind: "drawCheckpoint"; player: Player; token: string; normalCount: 0 | 1 }>
  | Readonly<{ kind: "donCheckpoint"; player: Player; token: string; normalMaximum: 1 | 2 }>
  | Readonly<{ kind: "mainEntryCheckpoint"; player: Player; token: string }>
  | Readonly<{ kind: "endCheckpoint"; player: Player; token: string }>;
