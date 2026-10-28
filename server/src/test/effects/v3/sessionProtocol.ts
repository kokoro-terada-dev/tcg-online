import type { V3FixtureView } from "./fixtureProtocol";
export type V3SessionContext = Readonly<{ revision: number; movementRevision: number; progressionRevision: number; resolutionId: string | null; frameRevision: number | null }>;
export type V3SessionView = Readonly<{
  mode: "v3-synthetic-session"; matchId: string; roomId: string; localPlayerIndex: 0 | 1; context: V3SessionContext;
  movement: V3FixtureView["movement"]; frame: V3FixtureView["frame"] | null; imageAliases: Readonly<Record<string, string>>;
  turnNumber: number; activePlayer: 0 | 1; phase: "refresh" | "draw" | "don" | "main" | "end"; gate: "idle" | "resolving" | "choice";
  resolutionActor: 0 | 1 | null; workType: V3FixtureView["workType"];
  effects: readonly Readonly<{ effectId: string; label: string; enabled: boolean; used: number; limit: number | null }>[];
  playableCards: readonly Readonly<{ card: Readonly<{ instanceId: string; generation: number }>; cardId: string; cost: number | null; zone: "character" | "stage"; slotIndex: number; enabled: boolean }>[];
  publicReveals: readonly Readonly<{ cardId: string; owner: 0 | 1 }>[];
  history: readonly Readonly<{ turnNumber: number; actor: 0 | 1; cardId: string; effectId: string; resolutionId: string; committed: boolean; declined: boolean }>[];
}>;
export type V3SessionCommand = Readonly<{ matchId: string; requestId: string; context: V3SessionContext }> & (
  { kind: "activate"; effectId: string } | { kind: "play"; card: Readonly<{ instanceId: string; generation: number }>; slotIndex?: number } |
  { kind: "advance" | "work" | "endTurn" } | { kind: "answer"; selectionId: string; tokens: readonly string[] }
);
