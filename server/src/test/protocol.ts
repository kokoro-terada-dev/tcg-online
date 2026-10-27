export type CardKind = "leader" | "character" | "event" | "stage" | "don";
export type Zone = "hand" | "deck" | "life" | "trash" | "public" | "character" | "stage" | "leader" | "donDeck" | "activeDon" | "restDon";
export type DeckInput = {
  name: string; leaderCardId: string; mainDeck: string[]; donDeck: string[];
  cardTypes: Record<string, CardKind>; leaderLifeCount: number;
};
export type SeatView = { socketId: string; ready: boolean; deck: { name: string; leaderCardId: string } | null };
export type RoomView = { roomId: string; host: SeatView; guest: SeatView | null; inMatch: boolean };
export type CardView = { id: string; cardId: string | null; kind: CardKind | null; rotated: boolean; faceUp: boolean };
export type PlayerView = { zones: Record<Zone, (CardView | null)[]> };
export type AttackView = { actor: 0 | 1; sourceId: string; targetId: string };
export type MatchView = { matchId: string; revision: number; localPlayerIndex: 0 | 1; players: [PlayerView, PlayerView]; attack: AttackView | null };
export type MatchCommand = {
  matchId: string; expectedRevision: number; requestId: string;
} & (
  { kind: "draw" } |
  { kind: "attack"; cardInstanceId: string; from: "leader" | "character"; targetId: string } |
  { kind: "rotate"; cardInstanceId: string; from: Zone } |
  { kind: "move"; cardInstanceId: string; from: Zone; to: Zone; slotIndex?: number }
);
