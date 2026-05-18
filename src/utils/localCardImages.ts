import JSZip from "jszip";

import type { LocalCardImage } from "../types/deck";

let localCardImages: LocalCardImage[] = [];

let objectUrls: string[] = [];

export function getLocalCardImages() {
  return localCardImages;
}

export function hasLocalCardImages() {
  return localCardImages.length > 0;
}

export function getLocalCardImage(cardId: string) {
  return localCardImages.find((x) => x.cardId === cardId);
}

export function getCardBackImageUrl() {
  return getLocalCardImage("cardBack")?.imageUrl ?? "/cards/cardBack.png";
}

export function getDonImageUrl() {
  return getLocalCardImage("don")?.imageUrl ?? "/cards/don.png";
}

export function getDonDeckImageUrl() {
  return getLocalCardImage("donDeck")?.imageUrl ?? "/cards/donDeck.png";
}

export function clearLocalCardImages() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));

  objectUrls = [];
  localCardImages = [];
}

function parseCardImagePath(path: string) {
  const normalizedPath = path.replaceAll("\\", "/");

  if (normalizedPath.includes("__MACOSX/")) {
    return null;
  }

  const parts = normalizedPath.split("/").filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const fileName = parts[parts.length - 1];

  const fileMatch = fileName.match(
    /^(.+)\.(png|jpg|jpeg|webp)$/i
  );

  if (!fileMatch) {
    return null;
  }

  const rawCardId = fileMatch[1];
  const parentFolder = parts[parts.length - 2];

  // ZIP直下の cards/ に置く共通画像。
  // 例: cards/cardBack.png
  // 例: cards/don.png
  // 例: cards/donDeck.png
  if (
    parentFolder === "cards" &&
    (rawCardId === "cardBack" ||
      rawCardId === "don" ||
      rawCardId === "donDeck")
  ) {
    return {
      series: "system",
      cardId: rawCardId,
      path: normalizedPath,
    };
  }

  // 例: cards/OP01/OP01-001.png
  // 例: OP01/OP01-001.png
  // 例: 任意フォルダ/cards/OP01/OP01-001.png
  if (!rawCardId.startsWith(parentFolder)) {
    return null;
  }

  return {
    series: parentFolder,
    cardId: rawCardId,
    path: normalizedPath,
  };
}

export async function loadCardImagesFromZip(file: File) {
  clearLocalCardImages();

  const zip = await JSZip.loadAsync(file);

  const loaded: LocalCardImage[] = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) {
      continue;
    }

    const parsed = parseCardImagePath(entry.name);

    if (!parsed) {
      continue;
    }

    const blob = await entry.async("blob");
    const imageUrl = URL.createObjectURL(blob);

    objectUrls.push(imageUrl);

    loaded.push({
      cardId: parsed.cardId,
      series: parsed.series,
      path: parsed.path,
      imageUrl,
    });
  }

  loaded.sort((a, b) => a.cardId.localeCompare(b.cardId));

  localCardImages = loaded;

  return loaded;
}
