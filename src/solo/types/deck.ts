import type { CardType } from "./card";

export type DeckListItem = {
  id: string;
  name: string;
  path: string;
};

export type DeckJsonCard = {
  name: string;
  image: string;
  type: CardType;
  count: number;
};

export type DeckJson = {
  id: string;
  name: string;
  leader: {
    name: string;
    image: string;
    lifeCount: number;
    donCount?: number;
  };
  cards: DeckJsonCard[];
};

export type LocalCardImage = {
  cardId: string;
  series: string;
  path: string;
  imageUrl: string;
};

export type DeckRecipeCardTypeMap = Record<string, CardType>;

export type DeckRecipe = {
  id: string;
  name: string;

  leaderCardId: string | null;

  mainDeck: string[];

  donDeck: string[];

  cardTypes: DeckRecipeCardTypeMap;

  leaderLifeCount: number;

  createdAt: string;
  updatedAt: string;
};

export type SavedDeckListItem = {
  id: string;
  name: string;
  mainCount: number;
  hasLeader: boolean;
  leaderCardId: string | null;
  updatedAt: string;
};
