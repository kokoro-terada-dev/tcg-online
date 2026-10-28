import type { CardObjectRef, DeepReadonly, MoveCause, ZoneRef } from "../effects/types";
export type Player = 0 | 1;
export type MovementZone = ZoneRef | "attachedDon";
export type CardKind = "leader" | "character" | "stage" | "event" | "don" | "unknown";
export type Location = Readonly<{ player: Player; zone: MovementZone }>;
export type MovementCard = Readonly<CardObjectRef & {
  cardId: string; kind: CardKind; owner: Player; controller: Player; faceUp: boolean; rotated: boolean;
  attachedTo: Readonly<CardObjectRef> | null; modifierIds: readonly string[]; grantIds: readonly string[]; enteredTurn: number | null;
}>;
export type ZoneLists = Readonly<Record<MovementZone, readonly (string | null)[]>>;
export type RevealGrant = Readonly<{ scopeId: string; card: Readonly<CardObjectRef>; viewers: readonly Player[] }>;
export type MovementState = Readonly<{
  version: 1; matchId: string; revision: number; turnNumber: number;
  players: readonly [ZoneLists, ZoneLists]; cards: Readonly<Record<string, MovementCard>>;
  reveals: readonly RevealGrant[]; appliedTransactions: readonly string[];
}>;
export type MoveDestination = Location & Readonly<{ position: "top" | "bottom" | "append" | "firstEmpty" | "slot"; slotIndex?: number; faceUp: boolean; rotated: boolean }>;
export type MovementOperation =
  | Readonly<{ kind: "move"; card: Readonly<CardObjectRef>; from: Location; to: MoveDestination; cause: MoveCause }>
  | Readonly<{ kind: "setRest"; card: Readonly<CardObjectRef>; rotated: boolean }>
  | Readonly<{ kind: "attachDon"; card: Readonly<CardObjectRef>; target: Readonly<CardObjectRef> }>
  | Readonly<{ kind: "reorder"; location: Location; cards: readonly Readonly<CardObjectRef>[]; conceal: boolean }>
  | Readonly<{ kind: "reveal"; card: Readonly<CardObjectRef>; scopeId: string; viewers: readonly Player[] }>
  | Readonly<{ kind: "closeReveals"; scopeId: string }>;
export type MovementTransaction = Readonly<{
  transactionId: string; matchId: string; expectedRevision: number; turnNumber: number;
  actor: Player; effectController: Player | null; source: Readonly<CardObjectRef> | null;
  mode: "effect" | "cost" | "rule"; resolutionId: string | null;
  operations: readonly MovementOperation[];
}>;
export type EventCause = Readonly<{
  kind: MoveCause; actor: Player; effectController: Player | null;
  source: Readonly<CardObjectRef> | null; resolutionId: string | null; parentEventId: string | null;
}>;
export type MovementEvent = Readonly<{
  eventId: string; operationIndex: number; groupId: string;
  kind: "moved" | "restChanged" | "reordered" | "revealed" | "revealsClosed";
  before: MovementCard | null; after: MovementCard | null; from: Location | null; to: Location | null;
  cause: EventCause; isKO: boolean; visibleBefore: readonly Player[]; visibleAfter: readonly Player[];
}>;
export type Proposal = Readonly<{
  operationIndex: number; kind: MovementOperation["kind"]; card: MovementCard | null;
  from: Location | null; to: Location | null; cause: EventCause; automatic: boolean;
}>;
export type RuleDecision = Readonly<{ kind: "allow" }> | Readonly<{ kind: "prevent" }> | Readonly<{ kind: "defer" }>;
export type MovementRules =
  | Readonly<{ status: "certifiedNone" }>
  | Readonly<{ status: "unresolved" }>
  | Readonly<{ status: "evaluate"; check(proposal: DeepReadonly<Proposal>, state: MovementState): RuleDecision }>;
export type TransactionResult = Readonly<{
  state: MovementState; events: readonly MovementEvent[];
  prevented: readonly number[];
}>;
export type MovementCardView = Readonly<{
  ref: Readonly<CardObjectRef> | null; cardId: string | null; kind: CardKind | null;
  faceUp: boolean; rotated: boolean; attachedTo: Readonly<CardObjectRef> | null;
}>;
export type MovementView = Readonly<{ matchId: string; revision: number; players: readonly Readonly<Record<MovementZone, readonly (MovementCardView | null)[]>>[] }>;
export type PublicMovementEvent = Readonly<{
  revision: number; sequence: number; kind: MovementEvent["kind"];
  count: number;
  from: Location | null; to: Location | null; cardId: string | null;
  isKO: boolean; cause: Readonly<{ kind: MoveCause; actor: Player }>;
}>;
