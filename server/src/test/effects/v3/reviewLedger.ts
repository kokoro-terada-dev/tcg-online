import { createHash } from "node:crypto";
import { freezeMovement } from "../../movement/state";
import { REVIEW_FIELDS, validateReviewBundle, type CardVariant } from "./cardData";

type LedgerRow = Readonly<{ sourceSha256: string; recordNumber: number; cardId: string; displayId: string; raw: CardVariant["raw"] }>;
type TextVariant = Readonly<{ pairSha256: string; text: string; triggerText: string; recordNumbers: readonly number[]; displayIds: readonly string[] }>;
export type ReviewLedger = Readonly<{
  version: "v3-review-ledger.1"; executable: false; sourceSha256: string;
  rows: readonly LedgerRow[];
  cards: readonly Readonly<{ cardId: string; reviewStatus: "needs_review"; executable: false;
    disposition: "quarantine" | "review_required"; reasons: readonly string[]; variants: readonly TextVariant[] }>[];
}>;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

// Review-only output: never imports the runtime catalog, produces plans, or creates approvals.
export function createReviewLedger(input: unknown): ReviewLedger {
  const bundle = validateReviewBundle(input), displays = new Map<string, number>();
  for (const row of bundle.variants) displays.set(row.displayId, (displays.get(row.displayId) ?? 0) + 1);
  const byCard = new Map<string, CardVariant[]>();
  for (const row of bundle.variants) {
    if (!byCard.has(row.cardId)) byCard.set(row.cardId, []);
    byCard.get(row.cardId)!.push(row);
  }
  const cards = bundle.cards.map(card => {
    const rows = byCard.get(card.cardId)!, reasons = new Set<string>(), pairs = new Map<string, CardVariant[]>();
    for (const row of rows) {
      const raw = row.raw, pair = JSON.stringify([raw["テキスト"], raw["トリガー"]]);
      if (!pairs.has(pair)) pairs.set(pair, []);
      pairs.get(pair)!.push(row);
      if (!row.displayId || displays.get(row.displayId)! > 1) reasons.add("invalid-or-duplicate-display-id");
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(row.displayId)) reasons.add("invalid-display-id");
      if (!["LEADER", "CHARACTER", "EVENT", "STAGE", "DON"].includes(raw["種類"].trim())) reasons.add("invalid-card-type");
      if (!raw["カード名"].trim()) reasons.add("missing-name");
      for (const field of ["コスト", "パワー", "カウンター", "ライフ"] as const) {
        const number = raw[field].trim();
        if (!["", "-", "null", "NULL"].includes(number) && (!/^\d+$/.test(number) || !Number.isSafeInteger(Number(number)))) reasons.add(`invalid-number:${field}`);
      }
      if (/(?:^|\r?\n)【トリガー[ \u3000]*】/.test(raw["テキスト"])) reasons.add("trigger-clause-in-body-needs-review");
      for (const issue of row.issues) reasons.add(`source-audit:${issue}`);
    }
    if (pairs.size > 1) reasons.add("text-trigger-variant-conflict");
    for (const field of REVIEW_FIELDS) if (new Set(rows.map(row => row.raw[field])).size > 1) reasons.add(`raw-variant-difference:${field}`);
    const variants = [...pairs].map(([pair, versions]) => ({ pairSha256: sha(pair), text: versions[0]!.raw["テキスト"], triggerText: versions[0]!.raw["トリガー"],
      recordNumbers: versions.map(row => row.recordNumber), displayIds: versions.map(row => row.displayId) }));
    return { cardId: card.cardId, reviewStatus: "needs_review" as const, executable: false as const,
      disposition: reasons.size ? "quarantine" as const : "review_required" as const, reasons: [...reasons].sort(), variants };
  });
  return freezeMovement({ version: "v3-review-ledger.1", executable: false, sourceSha256: bundle.sourceSha256,
    rows: bundle.variants.map(row => ({ sourceSha256: bundle.sourceSha256, recordNumber: row.recordNumber, cardId: row.cardId, displayId: row.displayId, raw: { ...row.raw } })), cards });
}
