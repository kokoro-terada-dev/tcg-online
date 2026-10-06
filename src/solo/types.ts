export type CardType = "LEADER" | "CHARACTER" | "EVENT" | "STAGE";

export type Card = {
  id: string;
  name: string;
  type: CardType;
  cost?: number;
  power?: number;
  color?: string;
  imageUrl: string;
};

export type ZoneType =
  | "deck"
  | "hand"
  | "field"
  | "trash"
  | "life";

export type PlayerState = {
  deck: Card[];
  hand: Card[];
  field: Card[];
  trash: Card[];
  life: Card[];
  don: number;
};

export type GameState = {
  players: PlayerState[];
  turnPlayer: 0 | 1;
};

export type ZoneKey = "deck" | "hand" | "field" | "trash" | "life";