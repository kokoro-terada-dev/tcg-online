import type { MovementView, Player } from "./movement/types";
import type { CardObjectRef, DeepReadonly, Trigger } from "./effects/types";
export type EffectCatalogQuery = Readonly<{ matchId: string; expectedMovementRevision: number; expectedProgressionRevision: number; source: Readonly<CardObjectRef> }>;
export type EffectCatalogView = Readonly<{ matchId: string; movementRevision: number; progressionRevision: number; catalogVersion: string | null; activationEnabled: boolean; source: Readonly<CardObjectRef>;
  effects: readonly Readonly<{ effectId: string; trigger: DeepReadonly<Trigger>; status: "schemaOnly"; timingAvailable: boolean }>[] }>;
export type EffectSelectionView = Readonly<{ matchId: string; resolutionId: string; selectionId: string; revision: number }> & (
  { kind: "cards"; chooser: Player; mode: "SELECT" | "BLIND_SELECT" | "ORDER"; min: number; max: number; candidates: readonly Readonly<{ token: string; cardId: string | null }>[] } |
  { kind: "choice"; chooser: Player; options: readonly Readonly<{ token: string; label: string }>[] });
export type EffectTransportView = Readonly<{
  matchId: string; localPlayerIndex: Player; movement: MovementView;
  testTurnSwitchAvailable?: boolean;
  // While idle, resolutionId reserves the next resolution; there is no running effect.
  effect: Readonly<{ resolutionId: string; actor: Player; status: "idle" | "prepared" | "resolving" | "completed" | "cancelled" | "blocked" | "waitingForSelection" | "waitingForCostSelection" | "costsReady"; completedSteps: number; masterVersion: string | null }>;
  progression: Readonly<{ revision: number; turnNumber: number; activePlayer: Player; phase: string; gate: "idle" | "resolving" | "choice"; chooser: Player | null; finished: boolean; winner: Player | null }>;
  selection: EffectSelectionView | null;
}>;
export type EffectCommandKind = "beginCosts" | "answerCosts" | "commitCosts" | "cancelCosts" | "start" | "advance" | "answerEffect";
type Base = Readonly<{ matchId: string; resolutionId: string; requestId: string; expectedMovementRevision: number; expectedProgressionRevision: number }>;
export type RegisteredEffectCommand = Base & Readonly<{ kind: "activateRegistered"; catalogVersion: string; effectId: string; source: Readonly<CardObjectRef> }>;
export type TestTurnCommand = Base & Readonly<{ kind: "testNextTurn" }>;
export type EffectCommand = Base & (Readonly<{ kind: "answerCosts" | "answerEffect"; selectionId: string; tokens: readonly string[] }> | Readonly<{ kind: Exclude<EffectCommandKind, "answerCosts" | "answerEffect"> }>);
