import { dataArray, dataObject, ensureMove, freezeMovement } from "../../movement/state";

export const SOURCE_COLUMNS = ["表示ID", "カード番号", "カード名", "レアリティ", "種類", "コスト", "ライフ", "属性", "パワー", "カウンター", "色", "ブロックアイコン", "特徴", "テキスト", "トリガー", "入手情報", "収録弾ID", "画像URL", "出典URL", "取得日"] as const;
export const REVIEW_FIELDS = ["カード名", "種類", "コスト", "ライフ", "属性", "パワー", "カウンター", "色", "特徴", "テキスト", "トリガー"] as const;
export type ReviewField = typeof REVIEW_FIELDS[number];
export type CardVariant = Readonly<{
  cardId: string; displayId: string; recordNumber: number;
  raw: Readonly<Record<typeof SOURCE_COLUMNS[number], string>>;
  normalized: Readonly<Record<ReviewField, string>>; issues: readonly string[];
}>;
// Audit-only definitions cannot be approved or executed. Runtime DSL is a separate phase.
export type ReviewCardDefinition = Readonly<{
  cardId: string; recordNumbers: readonly number[]; reviewStatus: "needs_review" | "unsupported";
  parseStatus: "needs_review" | "unsupported"; reasons: readonly string[];
  consensus: Readonly<Partial<Record<ReviewField, string>>>; effects: readonly never[];
}>;
export type ReviewBundle = Readonly<{
  schemaVersion: "3.0-review.1"; sourceSha256: string; normalizationVersion: "comparison-only.1";
  cards: readonly ReviewCardDefinition[]; variants: readonly CardVariant[];
}>;
function bounded(value: unknown, max = 32768): asserts value is string {
  ensureMove(typeof value === "string" && value.length <= max, "invalid-v3-text");
}
function cardId(value: unknown): asserts value is string {
  bounded(value, 100); ensureMove(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) && !["constructor", "prototype"].includes(value), "invalid-v3-card-id");
}
function strings(value: unknown): void { dataArray(value, 100); value.forEach(item => bounded(item, 300)); }
export function validateReviewBundle(input: unknown): ReviewBundle {
  dataObject(input, ["schemaVersion", "sourceSha256", "normalizationVersion", "cards", "variants"]);
  ensureMove(input.schemaVersion === "3.0-review.1" && input.normalizationVersion === "comparison-only.1", "unknown-v3-review-version");
  ensureMove(typeof input.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(input.sourceSha256), "invalid-v3-source-hash");
  dataArray(input.cards, 20000); dataArray(input.variants, 50000);
  ensureMove(input.cards.length > 0 && input.variants.length > 0, "empty-v3-review-data");
  const records = new Map<number, string>(), cards = new Set<string>(), assigned = new Set<number>();
  for (const variant of input.variants) {
    dataObject(variant, ["cardId", "displayId", "recordNumber", "raw", "normalized", "issues"]);
    cardId(variant.cardId); bounded(variant.displayId, 100);
    ensureMove(Number.isSafeInteger(variant.recordNumber) && (variant.recordNumber as number) >= 2 && !records.has(variant.recordNumber as number), "invalid-v3-record-number");
    records.set(variant.recordNumber as number, variant.cardId);
    dataObject(variant.raw, SOURCE_COLUMNS); Object.values(variant.raw).forEach(value => bounded(value));
    dataObject(variant.normalized, REVIEW_FIELDS); Object.values(variant.normalized).forEach(value => bounded(value)); strings(variant.issues);
    const rawCardId = variant.raw["カード番号"], rawDisplayId = variant.raw["表示ID"];
    bounded(rawCardId); bounded(rawDisplayId);
    ensureMove(rawCardId.trim() === variant.cardId && rawDisplayId.trim() === variant.displayId, "v3-source-id-mismatch");
  }
  for (const card of input.cards) {
    dataObject(card, ["cardId", "recordNumbers", "reviewStatus", "parseStatus", "reasons", "consensus", "effects"]);
    cardId(card.cardId); ensureMove(!cards.has(card.cardId), "duplicate-v3-card-id"); cards.add(card.cardId);
    ensureMove((card.reviewStatus === "needs_review" || card.reviewStatus === "unsupported") && card.parseStatus === card.reviewStatus, "v3-not-reviewed-or-executable");
    strings(card.reasons); dataArray(card.effects, 0); dataArray(card.recordNumbers, 50000);
    ensureMove(card.recordNumbers.length > 0, "v3-card-without-variants");
    for (const record of card.recordNumbers) {
      ensureMove(typeof record === "number" && records.get(record) === card.cardId && !assigned.has(record), "v3-variant-link-mismatch"); assigned.add(record);
    }
    dataObject(card.consensus, [], REVIEW_FIELDS); Object.values(card.consensus).forEach(value => bounded(value));
  }
  ensureMove(assigned.size === records.size, "v3-unlinked-variant");
  return freezeMovement(input as unknown as ReviewBundle);
}

export function requireExecutableV3Card(_card: ReviewCardDefinition): never {
  throw new Error("V3_REVIEW_ONLY: reviewed compiler/runtime integration is not implemented");
}
