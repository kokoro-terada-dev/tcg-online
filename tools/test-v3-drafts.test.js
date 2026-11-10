import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ledgerFromCsv } from "./build-v3-review-ledger.js";
import { generateV3Drafts } from "./generate-v3-drafts.js";
import { analyzeV3Coverage } from "./analyze-v3-coverage.js";

const require = createRequire(import.meta.url);
const { SOURCE_COLUMNS } = require("../server/dist/test/effects/v3/cardData.js");
const { loadReviewedV3Catalog } = require("../server/dist/test/effects/v3/reviewedCatalog.js");
const { ApprovedV3Catalog } = require("../server/dist/test/effects/v3/approval.js");
const { compileV3CardJson } = require("../server/dist/test/effects/v3/compiler.js");
const quote = value => `"${value.replaceAll('"', '""')}"`;
const card = (id, body, patch = {}) => ({
  "表示ID": id, "カード番号": id, "カード名": id, "種類": "CHARACTER", "コスト": "1", "パワー": "2000",
  "カウンター": "-", "ライフ": "-", "色": "緑", "属性": "斬", "特徴": "合成", "テキスト": body, "トリガー": "", ...patch
});
const csv = rows => Buffer.from([SOURCE_COLUMNS, ...rows.map(row => SOURCE_COLUMNS.map(field => row[field] ?? ""))]
  .map(row => row.map(quote).join(",")).join("\r\n"));
const entry = (generated, id) => generated.candidates.cards.find(card => card.cardId === id);
const trace = (generated, id) => generated.trace.cards.find(card => card.cardId === id);

test("exact keywords and independent draws preserve every body and trigger span without granting approval", () => {
  const text = "【ブロッカー】\r\n【登場時】カード1枚を引く。\n〖KO時〗カード2枚を引く。";
  const trigger = "【トリガー】カード1枚を引く。";
  const rows = [card("SYN-MULTI", text, { "トリガー": trigger }), card("SYN-VANILLA", "-", { "トリガー": "-" }),
    card("SYN-EVENT", "【メイン】カード2枚を引く。", { "種類": "EVENT", "パワー": "-", "属性": "-" })];
  const bytes = csv(rows), ledger = ledgerFromCsv(bytes), generated = generateV3Drafts(ledger);
  const multi = entry(generated, "SYN-MULTI").definition;
  assert.deepEqual(multi.effects.map(effect => effect.timing.type), ["ON_PLAY", "ON_KO", "TRIGGER"]);
  assert.deepEqual(multi.effects.map(effect => effect.actions[0].count), [1, 2, 1]);
  assert.deepEqual(multi.keywords.map(keyword => keyword.type), ["BLOCKER"]);
  for (const span of trace(generated, "SYN-MULTI").variants[0].spans) {
    assert.equal((span.field === "text" ? text : trigger).slice(span.start, span.end), span.text);
  }
  const vanilla = entry(generated, "SYN-VANILLA");
  assert.equal(vanilla.generation.noEffect, true);
  assert.deepEqual(vanilla.definition.effects, []);
  assert.equal(generated.trace.totals.compilerPassed, 3);
  assert.equal(generated.trace.totals.noEffect, 1);
  const plan = compileV3CardJson(JSON.stringify(multi));
  assert.equal(plan.definition.reviewStatus, "needs_review");
  assert.throws(() => new ApprovedV3Catalog([plan], [], "synthetic"), /unapproved/);
  const coverage = analyzeV3Coverage(loadReviewedV3Catalog(), bytes, { auditLedger: ledger, candidates: generated.candidates });
  assert.equal(coverage.counts.candidate, 3);
  assert.equal(coverage.counts.approved, 0);
  assert.equal(coverage.cards.find(card => card.cardId === "SYN-VANILLA").generation.noEffect, true);
});

test("ambiguous suffixes, unknown payments and known gaps cannot leak an incomplete definition", () => {
  const bytes = csv([
    card("SYN-PARTIAL", "【速攻】\n【登場時】自分のデッキをシャッフルする。"),
    card("SYN-COST", "【登場時】ドン!!-1：カード1枚を引く。"),
    card("SYN-SUFFIX", "【登場時】カード1枚を引く。その後、カードを選ぶ。"),
    card("SYN-TRIGGER", "【登場時】カード1枚を引く。", { "トリガー": "【トリガー】カード1枚を引いてもよい。" }),
    card("SYN-HEADER", "【登場時】\r\nカード1枚を引く。")
  ]);
  const generated = generateV3Drafts(ledgerFromCsv(bytes));
  assert.deepEqual(generated.trace.totals.counts, { complete: 0, partial: 2, unconvertible: 3, unassessed: 0 });
  assert.equal(generated.trace.totals.unresolvedSpans, 6);
  assert.ok(generated.candidates.cards.every(card => !Object.hasOwn(card, "definition")));
  assert.equal(trace(generated, "SYN-PARTIAL").variants[0].spans[1].status, "unsupported");
  assert.equal(trace(generated, "SYN-COST").variants[0].spans[0].status, "unknown");
  const coverage = analyzeV3Coverage(loadReviewedV3Catalog(), bytes, { candidates: generated.candidates });
  assert.equal(coverage.counts.unsupported, 1);
  assert.equal(coverage.counts.candidate, 0);
  assert.equal(coverage.counts.unassessed, 4);
});

test("conflicting prints and missing metadata stay separate, and compiler failures never ship", () => {
  const bytes = csv([
    card("SYN-CONFLICT", "【登場時】カード1枚を引く。"),
    card("SYN-CONFLICT", "【登場時】カード2枚を引く。", { "表示ID": "SYN-CONFLICT-p1" }),
    card("SYN-NO-POWER", "【ブロッカー】", { "パワー": "" }),
    card("SYN-BLANK", ""),
    card("SYN-COMPILER", "【登場時】カード1枚を引く。", { "トリガー": "【トリガー】カード1枚を引く。\n【トリガー】カード2枚を引く。" })
  ]);
  const generated = generateV3Drafts(ledgerFromCsv(bytes));
  assert.equal(trace(generated, "SYN-CONFLICT").variants.length, 2);
  assert.equal(trace(generated, "SYN-CONFLICT").status, "unassessed");
  assert.equal(entry(generated, "SYN-CONFLICT"), undefined);
  assert.equal(trace(generated, "SYN-NO-POWER").status, "unassessed");
  assert.equal(trace(generated, "SYN-BLANK").noEffect, false);
  assert.equal(trace(generated, "SYN-COMPILER").compiler, "failed");
  assert.equal(entry(generated, "SYN-COMPILER").definition, undefined);
});

test("a card regenerated from the same CSV has identical hashes and partial metadata cannot smuggle a DSL", () => {
  const bytes = csv([card("SYN-Z", "【ブロッカー】"), card("SYN-A", "-")]), ledger = ledgerFromCsv(bytes);
  const all = generateV3Drafts(ledger), single = generateV3Drafts(ledger, ["SYN-Z"]);
  assert.deepEqual(entry(all, "SYN-Z"), entry(single, "SYN-Z"));
  assert.deepEqual(trace(all, "SYN-Z"), trace(single, "SYN-Z"));
  assert.deepEqual(all, generateV3Drafts(ledger));
  assert.equal(single.trace.totals.sourceCards, 2);
  assert.equal(single.trace.totals.selectedCards, 1);
  assert.throws(() => generateV3Drafts(ledger, ["ABSENT"]), /does not exist/);
  entry(single, "SYN-Z").generation.status = "partial";
  assert.throws(() => analyzeV3Coverage(loadReviewedV3Catalog(), bytes, { candidates: single.candidates }), /generated coverage metadata/);
});

test("a split reminder is recognized only when adjacent to the same standalone keyword", () => {
  const note = "(このカードは登場したターンにアタックできる)";
  const generated = generateV3Drafts(ledgerFromCsv(csv([
    card("NOTE-VALID", `【速攻】\r\n${note}`),
    card("NOTE-ORPHAN", note),
    card("NOTE-MISMATCH", `【ブロッカー】\n${note}`),
    card("NOTE-NOT-ADJACENT", `【速攻】\n\n${note}`),
    card("NOTE-SUFFIX", `【速攻】\n${note}ほかの効果。`)
  ])));
  assert.deepEqual(entry(generated, "NOTE-VALID").definition.keywords.map(keyword => keyword.type), ["RUSH"]);
  assert.equal(trace(generated, "NOTE-VALID").variants[0].spans[1].pattern, "keyword-reminder-next-line");
  for (const id of ["NOTE-ORPHAN", "NOTE-MISMATCH", "NOTE-NOT-ADJACENT", "NOTE-SUFFIX"]) {
    assert.equal(entry(generated, id).definition, undefined);
  }
});

test("threshold effects retain current value, rest condition, chooser and maximum", () => {
  const rows = [
    card("TARGET-KO", "【登場時】相手のレストのコスト4以下のキャラ2枚までを、KOする。", {
      "トリガー": "【トリガー】相手のパワー3000以下のキャラ1枚までを、レストにする。"
    }),
    card("TARGET-RETURN", "【登場時】相手のコスト3以下のキャラ1枚までを、持ち主の手札に戻す。"),
    card("TARGET-REQUIRED", "【登場時】相手のコスト4以下のキャラ1枚を、KOする。"),
    card("TARGET-UNSCOPED", "【登場時】コスト4以下のキャラ1枚までを、KOする。")
  ];
  const g = generateV3Drafts(ledgerFromCsv(csv(rows)));
  const [entryEffect, trigger] = entry(g, "TARGET-KO").definition.effects;
  const [select, ko] = entryEffect.actions;
  assert.deepEqual([select.selector.owner, select.selector.controller, select.selector.chooser, select.selector.min, select.selector.max],
    ["OPPONENT", "OPPONENT", "SELF", 0, 2]);
  assert.deepEqual(select.selector.filters.conditions.map(condition => [condition.left.ref, condition.op, condition.right]), [
    ["CANDIDATE.rotated", "eq", true], ["CANDIDATE.current.cost", "lte", 4]
  ]);
  assert.equal(ko.type, "KO");
  assert.equal(trigger.actions[0].selector.filters.left.ref, "CANDIDATE.current.power");
  assert.equal(trigger.actions[1].type, "REST");
  assert.equal(entry(g, "TARGET-RETURN").definition.effects[0].actions[1].destination.owner, "OPPONENT");
  assert.equal(entry(g, "TARGET-REQUIRED").definition, undefined);
  assert.equal(entry(g, "TARGET-UNSCOPED").definition, undefined);
});

test("counter buffs only the own leader for the battle; costs and a broader target are not guessed", () => {
  const event = { "種類": "EVENT", "パワー": "-", "属性": "-" };
  const g = generateV3Drafts(ledgerFromCsv(csv([
    card("COUNT-POWER", "【カウンター】自分のリーダーを、このバトル中、パワー+2000。", event),
    card("COUNT-COST", "【カウンター】手札1枚を捨てる：自分のリーダーを、このバトル中、パワー+2000。", event),
    card("COUNT-TARGET", "【カウンター】自分のリーダーかキャラ1枚までを、このバトル中、パワー+2000。", event)
  ])));
  const [select, buff] = entry(g, "COUNT-POWER").definition.effects[0].actions;
  assert.deepEqual([select.selector.zone, select.selector.owner, select.selector.min, select.selector.max], ["leader", "SELF", 1, 1]);
  assert.deepEqual([buff.type, buff.amount, buff.duration.type], ["MODIFY_STAT", 2000, "BATTLE_END"]);
  assert.equal(entry(g, "COUNT-COST").definition, undefined);
  assert.equal(entry(g, "COUNT-TARGET").definition, undefined);
});

test("a life trigger calls the fully interpreted unique MAIN on the same card or remains unresolved", () => {
  const event = { "種類": "EVENT", "パワー": "-", "属性": "-", "トリガー": "【トリガー】このカードの【メイン】効果を発動する。" };
  const g = generateV3Drafts(ledgerFromCsv(csv([
    card("CALL-OK", "【メイン】カード2枚を引く。", event),
    card("CALL-UNKNOWN", "【メイン】カード2枚を引く。その後、条件を確認する。", event),
    card("CALL-DUP", "【メイン】カード2枚を引く。\n【メイン】カード1枚を引く。", event)
  ])));
  const [main, trigger] = entry(g, "CALL-OK").definition.effects;
  assert.equal(trigger.actions[0].type, "CALL_EFFECT_BODY");
  assert.equal(trigger.actions[0].effectId, main.id);
  assert.equal(trigger.costs.length, 0);
  assert.equal(entry(g, "CALL-UNKNOWN").definition, undefined);
  assert.equal(entry(g, "CALL-DUP").definition, undefined);
  assert.equal(trace(g, "CALL-UNKNOWN").variants[0].spans.at(-1).reason, "main-body-unconfirmed");
});
