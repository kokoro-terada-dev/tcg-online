import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dissectV3DraftSpan, diagnoseV3DraftSpan } from "./v3-draft-diagnostics.js";
import { analyzeV3DraftDetails, renderV3TopGroups } from "./analyze-v3-draft-details.js";
import { ledgerFromCsv } from "./build-v3-review-ledger.js";
import { generateV3Drafts } from "./generate-v3-drafts.js";

const { SOURCE_COLUMNS } = createRequire(import.meta.url)("../server/dist/test/effects/v3/cardData.js");
const row = (id, text, fields = {}) => ({
  "表示ID": id, "カード番号": id, "カード名": id, "種類": "CHARACTER", "コスト": "1", "パワー": "2000",
  "カウンター": "-", "ライフ": "-", "色": "赤", "属性": "斬", "特徴": "合成", "テキスト": text, "トリガー": "", ...fields
});
function fixture(...rows) {
  const bytes = Buffer.from([SOURCE_COLUMNS, ...rows.map(r => SOURCE_COLUMNS.map(field => r[field] ?? ""))]
    .map(values => values.map(v => `"${v.replaceAll('"', '""')}"`).join(",")).join("\n"));
  const current = generateV3Drafts(ledgerFromCsv(bytes)).trace;
  const previous = { ...structuredClone(current), version: "v3-draft-generator.5" };
  return { bytes, previous, current };
}
const diagnose = (raw, extra = {}) => diagnoseV3DraftSpan({ raw, field: "text", cardType: "character", structure: dissectV3DraftSpan(raw), ...extra });
const ids = tokens => tokens.map(token => token.id);

test("the structural trace separates all eight dimensions without interpreting quoted titles as rules", () => {
  const raw = "【登場時】/【アタック時】自分の手札1枚を捨てることができる：自分の場のドン‼が3枚以上ある場合、相手は「💡このターン中にKOする。」を選ぶ。その後、このターン中、パワー-2000。";
  const { signals, multipleTimings } = dissectV3DraftSpan(raw, 13);
  assert.equal(multipleTimings, true);
  assert.deepEqual(ids(signals.timing), ["ON_PLAY", "ON_ATTACK"]);
  assert.deepEqual(ids(signals.conditions), ["field-don-comparison"]);
  assert.deepEqual(ids(signals.costs), ["discard-hand"]);
  assert.ok(ids(signals.targets).includes("explicit-actor"));
  assert.deepEqual(signals.quantities.map(s => [s.id, s.value]), [["exact-count", 1], ["gte", 3], ["signed-amount", -2000]]);
  assert.deepEqual(ids(signals.operations), ["discard", "modifier"]);
  assert.deepEqual(ids(signals.order), ["then"]);
  assert.deepEqual(ids(signals.duration), ["current-turn"]);
  for (const tokens of Object.values(signals)) for (const token of tokens) assert.equal(raw.slice(token.start - 13, token.end - 13), token.text);
});

test("diagnosis distinguishes unsupported scope from an existing operation and does not infer unknown semantics", () => {
  const life = diagnose("【トリガー】ドン!!-1：自分のライフが2枚以下の場合、このカードを登場させる。", { field: "triggerText" });
  assert.deepEqual(life.filter(f => f.category === "runtime").map(f => f.feature), ["trigger-self-play-condition", "trigger-self-play-payment"]);
  assert.deepEqual(diagnose("【登場時】ドン‼-1：カード1枚を引く。").map(f => f.category), ["composition"]);
  assert.deepEqual(diagnose("【登場時】/【アタック時】カード1枚を引く。").map(f => f.category), ["composition"]);
  assert.deepEqual(diagnose("【登場時】/【アタック時】【ターン1回】カード1枚を引く。").map(f => f.category), ["unknown"]);
  assert.equal(diagnose("自分の場のドン!!が2枚以上ドン!!デッキに戻された時、カード1枚を引く。").some(f => f.category === "runtime"), false);
  assert.equal(diagnose("【カウンター】自分のリーダーを、このバトル中、パワー+3000。", { cardType: "event" }).some(f => f.category === "runtime"), false);
  assert.deepEqual(diagnose("【トリガー】このカードの【メイン】効果を発動する。", { field: "triggerText", reason: "main-body-unconfirmed" }).map(f => f.category), ["unknown"]);
});

test("cohort totals de-duplicate prints, retain overlaps, and keep pinned human reviews separate", () => {
  const a = row("SYN-A", "【登場時】自分の手札1枚を捨てることができる：自分の場のドン‼が3枚以上ある場合、カード1枚を引く。その後、カード1枚を引く。");
  const b = row("SYN-B", "【速攻：キャラ】(このカードは登場したターンにキャラへアタックできる)", { "パワー": "-" });
  const { bytes, previous, current } = fixture(a, { ...a, "表示ID": "SYN-A_p1" }, b);
  const baseline = analyzeV3DraftDetails(bytes, previous, current);
  const { cardId, variantSha256, field, start, end, raw } = baseline.spans[0];
  const input = { version: "v3-draft-detail-reviews.1", sourceCsvSha256: current.sourceCsvSha256, registryHash: current.registryHash,
    entries: [{ cardId, variantSha256, field, start, end, raw, category: "interpretation", feature: "fixture-review", reviewer: "Fixture", evidence: "Synthetic review note" }] };
  const report = analyzeV3DraftDetails(bytes, previous, current, input);
  assert.equal(report.summary.spans, 2);
  assert.equal(report.summary.overlappingSpans, 1);
  assert.equal(report.summary.overlappingCards, 2);
  assert.deepEqual(report.summary.categories, baseline.summary.categories);
  assert.equal(report.summary.humanReviews, 1);
  assert.equal(report.humanReviews[0].classificationMode, "human-reviewed");
  assert.ok(report.spans.every(r => r.findings.every(f => f.classificationMode === "automatic")));
  assert.equal(report.summary.focus.find(f => f.id === "power-dash").cards, 1);
  assert.match(renderV3TopGroups(report), /SYN-A: 【登場時】/);
  assert.throws(() => analyzeV3DraftDetails(bytes, previous, current, { ...input, registryHash: "old" }), /pinned/);
  assert.throws(() => analyzeV3DraftDetails(bytes, previous, current, { ...input, entries: [{ ...input.entries[0], raw: "changed" }] }), /stale human review/);
});
