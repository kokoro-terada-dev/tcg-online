import type { CardData } from "../types/card";

import type {
  DeckJson,
  DeckListItem,
} from "../types/deck";

export async function loadDeckList(): Promise<DeckListItem[]> {
  const res = await fetch("/decks/index.json");

  if (!res.ok) {
    throw new Error("デッキ一覧の読み込みに失敗しました");
  }

  return await res.json();
}

export async function loadDeck(path: string): Promise<CardData[]> {
  const res = await fetch(path);

  if (!res.ok) {
    throw new Error("デッキの読み込みに失敗しました");
  }

  const json = (await res.json()) as DeckJson;

  const leader: CardData = {
    id: Math.random().toString(36).slice(2),
    name: json.leader.name,
    image: json.leader.image,
    type: "leader",
    rotated: false,
    attachedDonCount: 0,
    lifeCount: json.leader.lifeCount,
    isFaceUp: true,
    donCount: json.leader.donCount ?? 10,
  };

  const cards: CardData[] = json.cards.flatMap((card) =>
    Array.from({ length: card.count }).map(() => ({
      id: Math.random().toString(36).slice(2),
      name: card.name,
      image: card.image,
      type: card.type,
      rotated: false,
      attachedDonCount: 0,
      isFaceUp: false,
    }))
  );

  return [leader, ...cards];
}