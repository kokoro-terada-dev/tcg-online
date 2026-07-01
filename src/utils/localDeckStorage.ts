import type { CardData, CardType } from "../types/card";

import type {
  DeckRecipe,
  SavedDeckListItem,
} from "../types/deck";

import { getLocalCardImage } from "./localCardImages";
import {
  getCardMasterEntry,
  type CardMaster,
} from "./cardMaster";

const STORAGE_KEY = "opcg-local-deck-recipes-v1";

function readDecks(): DeckRecipe[] {
  const text = localStorage.getItem(STORAGE_KEY);

  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed as DeckRecipe[];
  } catch {
    return [];
  }
}

function writeDecks(decks: DeckRecipe[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

export function listLocalDeckRecipes(): SavedDeckListItem[] {
  return readDecks()
    .filter((deck) => deck.mainDeck.length === 50)
    .map((deck) => ({
      id: deck.id,
      name: deck.name,
      mainCount: deck.mainDeck.length,
      hasLeader: deck.leaderCardId !== null,
      leaderCardId: deck.leaderCardId,
      updatedAt: deck.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getAllLocalDeckRecipes() {
  return readDecks().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getLocalDeckRecipe(id: string) {
  return readDecks().find((deck) => deck.id === id) ?? null;
}

export function saveLocalDeckRecipe(recipe: DeckRecipe) {
  const decks = readDecks();

  const index = decks.findIndex((deck) => deck.id === recipe.id);

  if (index === -1) {
    decks.push(recipe);
  } else {
    decks[index] = recipe;
  }

  writeDecks(decks);
}

export function deleteLocalDeckRecipe(id: string) {
  writeDecks(readDecks().filter((deck) => deck.id !== id));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

function isDeckRecipe(value: unknown): value is DeckRecipe {
  if (!value || typeof value !== "object") {
    return false;
  }

  const recipe = value as Partial<DeckRecipe>;

  return (
    typeof recipe.id === "string" &&
    typeof recipe.name === "string" &&
    (typeof recipe.leaderCardId === "string" ||
      recipe.leaderCardId === null) &&
    isStringArray(recipe.mainDeck) &&
    isStringArray(recipe.donDeck) &&
    recipe.cardTypes !== null &&
    typeof recipe.cardTypes === "object" &&
    typeof recipe.leaderLifeCount === "number" &&
    typeof recipe.createdAt === "string" &&
    typeof recipe.updatedAt === "string"
  );
}

function makeSafeFileName(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "deck";
  }

  return trimmed.replace(/[\\/:*?"<>|]/g, "_");
}

export function exportLocalDeckRecipeToJson(recipe: DeckRecipe) {
  const blob = new Blob([JSON.stringify(recipe, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = `${makeSafeFileName(recipe.name)}.json`;

  document.body.appendChild(link);

  link.click();

  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export async function importLocalDeckRecipeFromJsonFile(file: File) {
  const text = await file.text();

  const parsed = JSON.parse(text);

  if (!isDeckRecipe(parsed)) {
    throw new Error("デッキJSONの形式が正しくありません。");
  }

  const now = new Date().toISOString();

  const importedDeck: DeckRecipe = {
    ...parsed,
    id: crypto.randomUUID(),
    name: `${parsed.name}（取込）`,
    createdAt: now,
    updatedAt: now,
  };

  saveLocalDeckRecipe(importedDeck);

  return importedDeck;
}

function createCardData(
  cardId: string,
  type: CardType,
  isFaceUp: boolean,
  options?: {
    donFallbackImageUrl?: string;
    cardMaster?: CardMaster | null;
  }
): CardData {
  const image = getLocalCardImage(cardId);
  const imageUrl =
    image?.imageUrl ??
    (type === "don" ? options?.donFallbackImageUrl : undefined);
  const master = getCardMasterEntry(options?.cardMaster, cardId);

  if (!imageUrl) {
    throw new Error(
      `画像ZIPに ${cardId} が見つかりません。画像ZIPを読み込んでください。`
    );
  }

  return {
    id: `${cardId}-${crypto.randomUUID()}`,
    name: cardId,
    image: imageUrl,
    type,
    cost: master?.cost ?? null,
    power: master?.power ?? null,
    counter: master?.counter ?? null,
    effects: master?.effects ?? [],
    rotated: false,
    attachedDonCount: 0,
    isFaceUp,
  };
}

export function buildDeckCardsFromRecipe(
  recipe: DeckRecipe,
  options?: {
    donFallbackImageUrl?: string;
    cardMaster?: CardMaster | null;
  }
): CardData[] {
  if (!recipe.leaderCardId) {
    throw new Error("リーダーカードが設定されていません。");
  }

  if (recipe.mainDeck.length !== 50) {
    throw new Error("メインデッキが50枚ではありません。");
  }

  const leader = createCardData(
    recipe.leaderCardId,
    "leader",
    true,
    options
  );

  leader.lifeCount = recipe.leaderLifeCount;
  leader.donCount = recipe.donDeck.length;

  const mainDeck = recipe.mainDeck.map((cardId) =>
    createCardData(
      cardId,
      recipe.cardTypes[cardId] ?? "character",
      false,
      options
    )
  );

  const donDeck = recipe.donDeck.map((cardId) =>
    createCardData(cardId, "don", true, options)
  );

  return [leader, ...mainDeck, ...donDeck];
}
