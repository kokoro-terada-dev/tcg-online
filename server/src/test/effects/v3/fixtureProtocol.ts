import type { MovementView } from "../../movement/types";
export type V3Scenario = "bounce" | "payDraw" | "ko" | "rest" | "active" | "discardDraw" | "discardCostDraw" | "sourceCostDraw" | "returnCostDraw";
export type V3FixtureView = Readonly<{
  frame: Readonly<{ mode: "work_requests_only"; resolutionId: string; revision: number; worldRevision: number;
    status: "ready" | "waitingForChoice" | "waitingForWork" | "completed" | "blocked";
    choice: Readonly<{ purpose: "action" | "cost" | "returnCost"; selectionId: string; chooser: 0 | 1; min: number; max: number; expiresAt: number; options: readonly Readonly<{ token: string; cardId: string }>[] }> | null }>;
  movement: MovementView; progression: Readonly<{ revision: number; gate: "idle" | "resolving" | "choice"; chooser: 0 | 1 | null }>;
  matchId: string; roomId: string; localPlayerIndex: 0 | 1; actor: 0 | 1; scenario: V3Scenario;
  imageAliases: Readonly<Record<string, string>>; workType: "PAY_COSTS" | "DRAW" | "MOVE_CARD" | "KO" | "REST" | "SET_ACTIVE" | null;
}>;
export type V3FixtureCommand = Readonly<{ frameRevision: number; movementRevision: number; progressionRevision: number; requestId: string; matchId: string; resolutionId: string }> & (
  { kind: "advance" | "work" } | { kind: "answer"; selectionId: string; tokens: readonly string[] });
export type V3RoomView = Readonly<{ roomId: string; matchId: string | null;
  host: Readonly<{ socketId: string; ready: boolean; deckName: string | null }>;
  guest: Readonly<{ socketId: string; ready: boolean; deckName: string | null }> | null;
}>;
