import type { CardEffect, CardType } from "../types/card";
import type {
  DeckRecipe,
  DeckRecipeCardTypeMap,
} from "../types/deck";

export type CardMasterType =
  | CardType
  | "unknown";

export type CardMasterEntry = {
  type?: CardMasterType | null;
  cost?: number | null;
  power?: number | null;
  counter?: number | null;
  effects?: CardEffect[];
};

export type CardMaster = {
  version?: number;
  cards: Record<string, CardMasterEntry>;
};

let cachedCardMaster: CardMaster | null | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function normalizeType(value: unknown): CardMasterType {
  if (
    value === "leader" ||
    value === "character" ||
    value === "event" ||
    value === "stage" ||
    value === "don"
  ) {
    return value;
  }

  return "unknown";
}

function normalizeEffects(value: unknown): CardEffect[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (effect): effect is CardEffect =>
      effect === "onPlay" ||
      effect === "onAttack" ||
      effect === "onKo"
  );
}

function normalizeCardMaster(value: unknown): CardMaster | null {
  if (!isObject(value) || !isObject(value.cards)) {
    return null;
  }

  const cards: Record<string, CardMasterEntry> = {};

  for (const [id, entry] of Object.entries(value.cards)) {
    if (!id || !isObject(entry)) {
      continue;
    }

    cards[id] = {
      type: normalizeType(entry.type),
      cost: normalizeNumber(entry.cost),
      power: normalizeNumber(entry.power),
      counter: normalizeNumber(entry.counter),
      effects: normalizeEffects(entry.effects),
    };
  }

  return {
    version:
      typeof value.version === "number" &&
      Number.isFinite(value.version)
        ? value.version
        : undefined,
    cards,
  };
}

export async function loadCardMaster() {
  if (cachedCardMaster !== undefined) {
    return cachedCardMaster;
  }

  try {
    const response = await fetch("/card-master.json", {
      cache: "no-cache",
    });

    if (!response.ok) {
      cachedCardMaster = null;
      return null;
    }

    cachedCardMaster = normalizeCardMaster(await response.json());
    return cachedCardMaster;
  } catch {
    cachedCardMaster = null;
    return null;
  }
}

export function getCardMasterEntry(
  cardMaster: CardMaster | null | undefined,
  cardId: string
) {
  return cardMaster?.cards[cardId] ?? null;
}

function getUsableCardType(
  entry: CardMasterEntry | null,
  fallback: CardType
): CardType {
  if (
    entry?.type === "leader" ||
    entry?.type === "character" ||
    entry?.type === "event" ||
    entry?.type === "stage" ||
    entry?.type === "don"
  ) {
    return entry.type;
  }

  return fallback;
}

export function applyCardMasterToDeckRecipe(
  recipe: DeckRecipe,
  cardMaster: CardMaster | null | undefined
): DeckRecipe {
  if (!cardMaster) {
    return recipe;
  }

  const cardTypes: DeckRecipeCardTypeMap = {
    ...recipe.cardTypes,
  };

  if (recipe.leaderCardId) {
    cardTypes[recipe.leaderCardId] = getUsableCardType(
      getCardMasterEntry(cardMaster, recipe.leaderCardId),
      cardTypes[recipe.leaderCardId] ?? "leader"
    );
  }

  for (const cardId of recipe.mainDeck) {
    cardTypes[cardId] = getUsableCardType(
      getCardMasterEntry(cardMaster, cardId),
      cardTypes[cardId] ?? "character"
    );
  }

  for (const cardId of recipe.donDeck) {
    cardTypes[cardId] = "don";
  }

  return {
    ...recipe,
    cardTypes,
  };
}
