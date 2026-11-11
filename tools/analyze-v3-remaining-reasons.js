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
  ["C", "opponent-mode-chooser", /相手は以下から1つを選ぶ。$/u,
    "CHOOSE_MODE does not accept an opponent chooser; routing a private selection to the opponent is not equivalent."],
  ["C", "source-specific-attached-don-count", /^(?:【ドン(?:‼|[!！]{2})×[1-9][0-9]?】|〖ドン(?:‼|[!！]{2})×[1-9][0-9]?〗)/u,
    "The player-level attachedCount is not the number attached to the effect source."],
  ["C", "life-self-play-color-guard", /^(?:【トリガー】|〖トリガー〗)(?:自分の手札[1-3]枚を捨てることができる[:：])?自分のリーダーが多色の場合、このカードを登場させる。$/u,
    "The life self-play compiler accepts a limited set of public conditions, excluding color metadata."],
  ["C", "effect-play-from-deck-search", /自分のデッキの上から[1-9][0-9]?枚を見て、[^。]+?キャラカード[1-9]枚までを、?(?:レストで|アクティブで)?登場させる。/u,
    "The inspected deck binding cannot be passed as PLAY_BY_EFFECT's hand source."],
  ["C", "counter-additional-hand-payment", /^(?:【カウンター】|〖カウンター〗)自分の手札[1-9]枚を捨てることができる[:：]/u,
    "The event counter activation compiler allows DON_RETURN, not an additional hand payment before its body."],
  ["C", "life-trigger-call-non-main-body", /^(?:【トリガー】|〖トリガー〗)このカードの(?:【(?:登場時|KO時|カウンター)】|〖(?:登場時|KO時|カウンター)〗)効果を発動する。$/u,
    "Same-card CALL_EFFECT_BODY from the life trigger only accepts a MAIN event body."],
  ["C", "continuous-source-identity", /^(?:(?:【(?:相手|自分)のターン中】|〖(?:相手|自分)のターン中〗))?このキャラ(?:の(?:パワー|コスト)[+-][0-9]+。|は(?:相手の)?効果でKOされない。)$/u,
    "A continuous public query cannot select only the source instance. Matching by printed name would include other copies."],
  ["C", "distinct-bounded-field-targets", /コスト[0-9]+以下のキャラ1枚までと、?(?:相手の)?コスト[0-9]+以下のキャラ1枚までを、?KOする。/u,
    "Two filtered field picks require excluding the first selected instance and applying a single KO batch; field CARDS cannot exclude a binding."],
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
const profiles = JSON.parse(fs.readFileSync(new URL("../docs/card-effect-supported-operations.json", import.meta.url), "utf8")).profiles;
const deltaProfile = ["3.0.0-subset.51", "3.0.0-subset.52", "3.0.0-subset.53", "3.0.0-subset.54", "3.0.0-subset.55", "3.0.0-subset.56", "3.0.0-subset.57", "3.0.0-subset.58", "3.0.0-subset.59", "3.0.0-subset.60", "3.0.0-subset.61", "3.0.0-subset.62"].some(profile => trace.registryHash === profiles[profile]?.registryHash);
const zoneProfile = deltaProfile || trace.registryHash === profiles["3.0.0-subset.50"]?.registryHash;
const superseded = new Set(["source-specific-attached-don-count", "hand-effect-play-full-field", "effect-play-from-trash",
  "deck-top-to-trash-without-look", "event-main-private-deck-program", "continuous-source-identity"]);
if (deltaProfile) {
  for (const rule of ["event-main-mode-not-in-schema", "counter-additional-hand-payment", "effect-play-from-deck-search", "life-trigger-call-non-main-body"])
    superseded.add(rule);
  knownFeature.delete("effect-deck-shuffle");
  evidenceRules.push(
    ["C", "multi-character-inspected-deck-play", /デッキの上から[1-9]枚を見て、[^。]+キャラカード[2-9]枚までを、?(?:レストで|アクティブで)?登場させ/u,
      "Inspected-deck play currently permits one character; multiple full-field entries need a separate resolution contract."],
    ["C", "shuffle-hand-reset-draw-count", /手札すべてをデッキに戻し、デッキをシャッフルする。その後、デッキに戻した枚数分カードを引く。$/u,
      "Own-deck shuffle exists, but DRAW does not consume the exact count of a previous hand reset."],
    ["C", "shuffle-opponent-hand-reset", /相手は自身の手札すべてをデッキに戻しシャッフルする/u,
      "The shuffle instruction is own-deck only and does not authorize an opponent hand reset."],
    ["C", "ko-activation-don-cost", /(?:【KO時】|〖KO時〗)ドン(?:[!！]{2}|‼)[-−－][1-9]/u,
      "ON_KO activation with a DON return cost is outside the current authorization contract."],
    ["C", "direct-effect-damage", /相手に[1-9]ダメージを与える/u,
      "Battle damage and life moves are not a direct card-effect damage instruction."],
  );
}
const details = [], groups = new Map(), unclassifiedCards = new Set(), unknownGroups = new Map();
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
      if (zoneProfile && superseded.has(pattern)) continue;
      if (!matcher?.test(span.text) || guard && !guard(span.text)) continue;
      record(category, pattern, explanation, span); matched = true;
    }
    for (const feature of span.features ?? []) {
      if (!knownFeature.has(feature)) continue;
      record("C", feature, knownFeature.get(feature), span); matched = true;
    }
    if (!matched) {
      unclassifiedSpans++;
      // This key groups candidates for review only; generation always uses the original text.
      const key = `${span.field}:${span.text.normalize("NFKC").replace(/[0-9]+/g, "#")}`;
      const row = unknownGroups.get(key) ?? { count: 0, example: span.text, field: span.field, cards: new Set() };
      row.count++;
      row.cards.add(card.cardId);
      unknownGroups.set(key, row);
    }
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
const unknown = [...unknownGroups.entries()].sort(([a, x], [b, y]) => y.cards.size - x.cards.size || y.count - x.count || (a < b ? -1 : a > b ? 1 : 0));
fs.writeFileSync(path.join(directory, "remaining-unclassified.csv"), csv([["field", "normalized_pattern", "affected_cards", "occurrences", "example", "card_ids"],
  ...unknown.map(([key, row]) => [row.field, key.slice(row.field.length + 1), row.cards.size, row.count, row.example, [...row.cards].sort().join(" ")])]), { flag: "wx" });
console.log(JSON.stringify({ ...summary, patterns: summary.patterns.map(({ category, pattern, affectedCardCount }) => [category, pattern, affectedCardCount]) }));
