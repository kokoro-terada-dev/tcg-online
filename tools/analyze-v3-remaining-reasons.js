import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csv } from "./audit-effect-cards.js";
import { resolveReviewOutput } from "./review-v3-catalog.js";

// Match an evidenced clause, not a keyword such as "登場" or "ダメージ" alone.
const evidenceRules = [
  ["A", "single-life-edge-branch", /^・(?:自分|相手)のライフの(?:上|下)から1枚を、?(?:手札に加える|トラッシュに置く)。$/u,
    "This option alone maps to MOVE_LIFE; it does not establish that the enclosing mode is supported."],
  ["B", "leader-trait-and-field-exists", /^(?:【登場時】|〖登場時〗)自分のリーダーが『[^『』]+』を含む特徴を持ち、(?:自分|相手)のコスト[0-9]+(?:以下|以上)?のキャラがいる場合、(?:自分|相手)のリーダーを、このターン中、パワー[+-][0-9]+。$/u,
    "Both EXISTS predicates and the single-leader turn modifier exist; the shared Japanese condition connector is unparsed."],
  ["C", "opponent-cost-area-don-state", /相手の(?:アクティブの|レストの)?ドン(?:‼|[!！]{2})[1-9][0-9]?枚までを、?(?:レスト|アクティブ)にする/u,
    "CARDS and SET_DON_STATE only permit selecting and changing the actor's cost-area DON."],
  ["C", "deck-top-to-trash-without-look", /自分のデッキの上から[1-9][0-9]?枚を、?トラッシュに置(?:く。|き、|くことができる[:：])/u,
    "No direct top-deck-to-trash operation; LOOK_TOP exposes cards before the move."],
  ["C", "event-main-private-deck-program", /^(?:【メイン】|〖メイン〗).*自分のデッキの上から[1-9][0-9]?枚を見て、/u,
    "The interactive event MAIN allowlist rejects LOOK_TOP and BOUND_CARDS."],
  ["C", "event-main-mode-not-in-schema", /^(?:【メイン】|〖メイン〗)以下から1つを選ぶ。$/u,
    "The interactive event MAIN schema excludes CHOOSE_MODE."],
  ["C", "effect-play-from-trash", /自分の(?:手札か)?トラッシュから[^。:：]+?枚までを、?(?:レストで|アクティブで)?登場させる。/u,
    "PLAY_BY_EFFECT accepts hand only; PLAY_TRIGGER_SOURCE cannot play an arbitrary trash card."],
  ["C", "hand-effect-play-full-field", /自分の手札から[^。:：]+?キャラカード1枚までを、?(?:レストで|アクティブで)?登場させる。/u,
    "PLAY_BY_EFFECT requires an empty slot; exact card text lacks a guarantee of a free slot.",
    text => !/キャラが|キャラエリア|この(?:キャラ|ステージ)を(?:トラッシュ|持ち主の)|自分のキャラ.*(?:戻し|KOし|トラッシュに置き)/u.test(text)],
  ["D", "schema-compiler-mismatch", null, "Existing schema rejects this compiler-accepted definition."],
  ["D", "printed-source-review", null, "The source audit quarantined this card or reported missing/inconsistent printed metadata."]
];

const knownFeature = new Map([
  ["effect-deck-shuffle", "No runtime shuffle action for card effects."],
  ["battle-end-trigger", "No battle-end timing in the current registry."],
  ["damage-replacement", "Replacement handlers do not replace damage."]
]);

const [input, output] = process.argv.slice(2);
if (!input || !output || fs.statSync(input).size > 64 * 1024 * 1024) throw Error("Usage: analyze-v3-remaining-reasons.js <generation.json> <new-output-dir>");
const trace = JSON.parse(fs.readFileSync(input, "utf8"));
if (trace.executable !== false || trace.cards.length !== trace.totals.sourceCards ||
    new Set(trace.cards.map(card => card.cardId)).size !== trace.cards.length) throw Error("Full draft report required");
const categories = { A: new Set(), B: new Set(), C: new Set(), D: new Set() };
const details = [], groups = new Map(), unclassifiedCards = new Set();
let unclassifiedSpans = 0;
for (const card of trace.cards) {
  if (card.status === "complete") continue;
  const seen = new Set();
  const record = (category, pattern, explanation, span = null) => {
    const key = `${category}:${pattern}`;
    if (!groups.has(key)) groups.set(key, { category, pattern, explanation, cards: new Set(), example: card.cardId, quote: span?.text ?? "" });
    groups.get(key).cards.add(card.cardId);
    categories[category].add(card.cardId);
    seen.add(category);
    details.push([card.cardId, category, pattern, span?.field ?? "", span?.start ?? "", span?.end ?? "", span?.text ?? "", explanation]);
  };
  const unresolved = card.variants.flatMap(variant => variant.spans.filter(span => span.status !== "recognized"));
  if (card.status === "unassessed" && card.reasons.length) {
    const schema = card.reasons.includes("schema-validation-failed");
    const rule = evidenceRules.find(([, pattern]) => pattern === (schema ? "schema-compiler-mismatch" : "printed-source-review"));
    if (schema || card.reasons.some(reason => /^(printed-metadata-unconfirmed|raw-variant-difference:|source-audit:|text-trigger-variant-conflict|trigger-clause-in-body-needs-review|invalid-card-type|card-type-unmodeled)/u.test(reason)))
      record(rule[0], rule[1], `${rule[3]} ${card.reasons.join("; ")}`);
  }
  for (const span of unresolved) {
    let matched = false;
    for (const [category, pattern, matcher, explanation, guard] of evidenceRules) {
      if (!matcher?.test(span.text) || guard && !guard(span.text)) continue;
      record(category, pattern, explanation, span); matched = true;
    }
    for (const feature of span.features ?? []) {
      if (!knownFeature.has(feature)) continue;
      record("C", feature, knownFeature.get(feature), span); matched = true;
    }
    if (!matched) unclassifiedSpans++;
  }
  if (!seen.size) unclassifiedCards.add(card.cardId);
}
const summary = {
  version: trace.version, datasetSha256: trace.sourceCsvSha256,
  cards: Object.fromEntries(Object.entries(categories).map(([key, ids]) => [key, ids.size])),
  unclassifiedCards: unclassifiedCards.size, unclassifiedSpans,
  patterns: [...groups.values()].map(({ cards, ...row }) => ({ ...row, affectedCardCount: cards.size }))
    .sort((a, b) => b.affectedCardCount - a.affectedCardCount || a.pattern.localeCompare(b.pattern, "en"))
};
const directory = resolveReviewOutput(fileURLToPath(new URL("../server/data/effects-v3-reviewed", import.meta.url)), output);
fs.mkdirSync(directory);
fs.writeFileSync(path.join(directory, "remaining-reasons.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
fs.writeFileSync(path.join(directory, "remaining-evidence.csv"), csv([["card_id", "category", "pattern", "field", "start", "end", "source", "evidence"], ...details]), { flag: "wx" });
console.log(JSON.stringify({ ...summary, patterns: summary.patterns.map(({ category, pattern, affectedCardCount }) => [category, pattern, affectedCardCount]) }));
