export type CardType =
  | "leader"
  | "character"
  | "event"
  | "stage"
  | "don";

export type AreaType =
  | "hand"
  | "character"
  | "deck"
  | "public"
  | "trash"
  | "life"
  | "leader"
  | "don";

export interface CardLocation {
  area: AreaType;

  slotIndex?: number;
}

export interface CardData {
  id: string;
  name: string;
  image: string;
  type: CardType;
  rotated: boolean;
  attachedDonCount: number;
  isFaceUp: boolean;
  lifeCount?: number;
  powerModifier?: number;
  countModifier?: number;
  statusLabel?: string;
  donCount?: number;
}

export interface PlayerState {
  hand: CardData[];
  deck: CardData[];
  trash: CardData[];
  publicCards: CardData[];
  life: CardData[];

  leader: CardData | null;

  characters: (CardData | null)[];

  stage: CardData | null;

  donDeck: CardData[];

  activeDons: CardData[];

  restDons: CardData[];
}
