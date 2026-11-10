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
const { setup: eventFixture } = require("../server/test/helpers/v3-event.cjs");
const { finish, id } = require("../server/test/helpers/v3-observed.cjs");
const quote = value => `"${value.replaceAll('"', '""')}"`;
const card = (id, body, patch = {}) => ({
  "表示ID": id, "カード番号": id, "カード名": id, "種類": "CHARACTER", "コスト": "1", "パワー": "2000",
  "カウンター": "-", "ライフ": "-", "色": "緑", "属性": "斬", "特徴": "合成", "テキスト": body, "トリガー": "", ...patch
});
const csv = rows => Buffer.from([SOURCE_COLUMNS, ...rows.map(row => SOURCE_COLUMNS.map(field => row[field] ?? ""))]
  .map(row => row.map(quote).join(",")).join("\r\n"));
const entry = (generated, id) => generated.candidates.cards.find(card => card.cardId === id);
const trace = (generated, id) => generated.trace.cards.find(card => card.cardId === id);

test("base-value filters, current-value filters, and turn cost modifiers preserve the condition and operation order", () => {
  const text = "【登場時】自分のライフが2枚以下の場合、相手のレストの元々のコスト4以下かつパワー3000以上のキャラ2枚までを、KOする。その後、相手のキャラ1枚までを、このターン中、コスト-2。";
  const g = generateV3Drafts(ledgerFromCsv(csv([card("BASE-THEN-COST", text)])));
  const d = entry(g, "BASE-THEN-COST").definition;
  assert.equal(d.schemaVersion, "3.0.0-subset.44");
  const [step] = d.effects[0].actions;
  assert.deepEqual(step.condition.conditions[0], { type: "compare", left: { ref: "SELF.lifeCount" }, op: "lte", right: 2 });
  const [first, ko, second, cost] = step.then;
  assert.deepEqual([first.selector.owner, first.selector.controller, first.selector.chooser, first.selector.min, first.selector.max],
    ["OPPONENT", "OPPONENT", "SELF", 0, 2]);
  assert.deepEqual(first.selector.filters.conditions.map(c => [c.left.ref, c.op, c.right]),
    [["CANDIDATE.rotated", "eq", true], ["CANDIDATE.base.cost", "lte", 4], ["CANDIDATE.current.power", "gte", 3000]]);
  assert.equal(ko.type, "KO");
  assert.deepEqual([second.selector.min, second.selector.max], [0, 1]);
  assert.deepEqual(cost.condition, { type: "TURN_IS", player: "SELF" });
  assert.deepEqual([cost.then[0].stat, cost.then[0].amount, cost.then[0].cards.ref], ["cost", -2, `bindings.${second.bindAs}`]);
  assert.deepEqual([cost.then[0].duration.player, cost.else[0].duration.player], ["SELF", "OPPONENT"]);
  assert.notEqual(first.bindAs, second.bindAs);
  assert.deepEqual(step.else, []);
});

test("optional leader selection retains zero, and a leader or character shares one limit", () => {
  const event = { "種類": "EVENT", "パワー": "-", "属性": "-" };
  const g = generateV3Drafts(ledgerFromCsv(csv([
    card("LEADER-OPTIONAL", "【カウンター】自分のリーダー1枚までを、このバトル中、パワー+3000。", event),
    card("OPPONENT-ONE", "-", { "トリガー": "【トリガー】相手のリーダーかキャラ1枚までを、このターン中、パワー-2000。" }),
    card("OPPONENT-TWO", "【登場時】相手のリーダーかキャラ2枚までを、このターン中、パワー-2000。"),
    card("UNSCOPED-BASE", "【登場時】元々のパワー3000以下のキャラ1枚までを、KOする。"),
    card("VANILLA-ONLY", "-")
  ])));
  const [leader, modifier] = entry(g, "LEADER-OPTIONAL").definition.effects[0].actions;
  assert.deepEqual([leader.selector.zone, leader.selector.owner, leader.selector.min, leader.selector.max, modifier.duration.type],
    ["leader", "SELF", 0, 1, "BATTLE_END"]);
  const [mode] = entry(g, "OPPONENT-ONE").definition.effects[0].actions;
  assert.equal(mode.type, "CHOOSE_MODE");
  assert.deepEqual(mode.modes.map(({ actions: [pick] }) =>
    [pick.selector.zone, pick.selector.owner, pick.selector.chooser, pick.selector.min, pick.selector.max]),
  [["leader", "OPPONENT", "SELF", 0, 1], ["character", "OPPONENT", "SELF", 0, 1]]);
  for (const id of ["OPPONENT-TWO", "UNSCOPED-BASE"]) {
    assert.equal(entry(g, id).definition, undefined);
    assert.equal(trace(g, id).noEffect, false);
  }
  assert.equal(g.trace.totals.noEffect, 1);
});

test("a generated base-power selector resolves in the existing event MAIN runtime", () => {
  const body = "【メイン】相手の元々のパワー2000以下のキャラ1枚までを、KOする。";
  const g = generateV3Drafts(ledgerFromCsv(csv([card("BASE-POWER", body, { "種類": "EVENT", "パワー": "-", "属性": "-" })])));
  const { schemaVersion, effects } = entry(g, "BASE-POWER").definition;
  assert.equal(effects[0].actions[0].selector.filters.conditions[0].left.ref, "CANDIDATE.base.power");
  const { c } = eventFixture({ field: 1, mutate(d) { d.schemaVersion = schemaVersion; d.effects = effects; } });
  const use = c.mainEventChoicesFor(0)[0];
  c.useMainEvent(0, id(), c.context(), use.sourceToken, use.effectId);
  const { choice } = finish(c, 0), before = c.snapshotForCoordinator().movement;
  assert.equal(choice.options.length, 1);
  c.answer(0, id(), c.context(), choice.selectionId, [choice.options[0].token]);
  finish(c, 0);
  const after = c.snapshotForCoordinator().movement;
  assert.equal(after.players[1].trash.at(-1), before.players[1].character[0]);
  assert.deepEqual(after.players[0].character, before.players[0].character);
});

test("optional DON preserves the count, state and order without dropping a cost or condition", () => {
  const rows = [
    card("DON-ONLY", "【登場時】ドン‼デッキからドン‼4枚までを、レストで追加する。"),
    card("DON-DRAW", "【メイン】カード1枚を引き、ドン!!デッキからドン!!1枚までをアクティブで追加する。", { "種類": "EVENT", "パワー": "-", "属性": "-" }),
    card("DON-LIFE", "【アタック時】自分のライフが2枚以下の場合、ドン!!デッキからドン!!2枚までを、レストで追加する。"),
    card("DON-PAID", "【登場時】自分の手札1枚を捨てることができる：ドン!!デッキからドン!!2枚までを、レストで追加する。"),
    card("DON-RELATIVE", "【登場時】自分の場のドン!!が相手の場のドン!!の枚数以下の場合、ドン!!デッキからドン!!1枚までを、レストで追加する。"),
    card("DON-UNKNOWN", "【登場時】自分の場のドン!!が相手の場のドン!!の枚数より6枚以上少ない場合、ドン!!デッキからドン!!1枚までを、レストで追加する。"),
    card("DON-EXACT", "【登場時】ドン!!デッキからドン!!2枚を、レストで追加する。")
  ];
  const g = generateV3Drafts(ledgerFromCsv(csv(rows)));
  const actions = id => entry(g, id).definition.effects[0].actions;
  const details = ({ type, player, max, state }) => [type, player, max, state];
  assert.equal(entry(g, "DON-ONLY").definition.schemaVersion, "3.0.0-subset.46");
  assert.deepEqual(details(actions("DON-ONLY")[0]), ["ADD_DON_UP_TO", "SELF", 4, "REST"]);
  assert.deepEqual(actions("DON-DRAW").map(a => a.type), ["DRAW", "ADD_DON_UP_TO"]);
  assert.deepEqual(details(actions("DON-DRAW")[1]), ["ADD_DON_UP_TO", "SELF", 1, "ACTIVE"]);
  assert.equal(actions("DON-LIFE")[0].condition.conditions[0].left.ref, "SELF.lifeCount");
  assert.deepEqual(details(actions("DON-LIFE")[0].then[0]), ["ADD_DON_UP_TO", "SELF", 2, "REST"]);
  assert.equal(entry(g, "DON-RELATIVE").definition.schemaVersion, "3.0.0-subset.47");
  assert.deepEqual(actions("DON-RELATIVE")[0].condition.conditions[0], {
    type: "compare", left: { ref: "SELF.don.fieldCount" }, op: "lte", right: { ref: "OPPONENT.don.fieldCount" }
  });
  assert.deepEqual(details(actions("DON-RELATIVE")[0].then[0]), ["ADD_DON_UP_TO", "SELF", 1, "REST"]);
  for (const id of ["DON-PAID", "DON-UNKNOWN", "DON-EXACT"]) assert.equal(entry(g, id).definition, undefined);
});

test("field DON generation keeps subject, exact boundaries, conjunctions and unresolved original text", () => {
  const combined = "【登場時】相手の場にドン‼が8枚以上あるかつ自分のライフが2枚以下の場合、カード1枚を引く。";
  const held = "【登場時】自分の場のドン‼が8枚以上ある場合、カード1枚を引く。その後、未確認処理。";
  const g = generateV3Drafts(ledgerFromCsv(csv([
    card("FIELD-ALL", combined), card("FIELD-HELD", held),
    card("FIELD-EXACT", "【登場時】自分の場のドン!!が10枚ある場合、カード1枚を引く。"),
    card("FIELD-STRICT", "【登場時】相手の場のドン!!の枚数が自分の場のドン!!の枚数より多い場合、カード1枚を引く。")
  ])));
  const predicates = id => entry(g, id).definition.effects[0].actions[0].condition.conditions;
  assert.deepEqual(predicates("FIELD-ALL").map(p => [p.left.ref, p.op, p.right]),
    [["OPPONENT.don.fieldCount", "gte", 8], ["SELF.lifeCount", "lte", 2]]);
  assert.deepEqual(predicates("FIELD-EXACT").map(p => [p.left.ref, p.op, p.right]), [["SELF.don.fieldCount", "eq", 10]]);
  assert.deepEqual(predicates("FIELD-STRICT").map(p => [p.left.ref, p.op, p.right.ref]),
    [["OPPONENT.don.fieldCount", "gt", "SELF.don.fieldCount"]]);
  assert.equal(entry(g, "FIELD-HELD").definition, undefined);
  const [unparsed] = trace(g, "FIELD-HELD").variants[0].spans[0].unparsed;
  assert.equal(held.slice(unparsed.start, unparsed.end), "未確認処理。");
});

test("only exact unconditional character or stage self-play receives the new profile", () => {
  const rows = [
    card("SELF-PLAY", "【登場時】カード1枚を引く。", { "トリガー": "【トリガー】このカードを登場させる。" }),
    card("SELF-STAGE", "-", { "種類": "STAGE", "パワー": "-", "属性": "-", "トリガー": "〖トリガー〗このカードを登場させる。" }),
    card("SELF-PAID", "-", { "トリガー": "【トリガー】ドン!!-1：このカードを登場させる。" }),
    card("SELF-CONDITIONAL", "-", { "トリガー": "【トリガー】自分のライフが2枚以下の場合、このカードを登場させる。" }),
    card("SELF-MULTILINE", "-", { "トリガー": "【トリガー】このカードを登場させる。\n未解釈処理。" }),
    card("UNCHANGED", "【登場時】カード1枚を引く。")
  ];
  const bytes = csv(rows), generated = generateV3Drafts(ledgerFromCsv(bytes));
  for (const id of ["SELF-PLAY", "SELF-STAGE"]) {
    const { definition } = entry(generated, id);
    assert.equal(definition.schemaVersion, "3.0.0-subset.45");
    assert.deepEqual(definition.effects.at(-1).actions.map(a => a.type), ["PLAY_TRIGGER_SOURCE"]);
    assert.equal(definition.reviewStatus, "needs_review");
  }
  for (const id of ["SELF-PAID", "SELF-CONDITIONAL", "SELF-MULTILINE"]) assert.equal(entry(generated, id).definition, undefined);
  assert.equal(entry(generated, "UNCHANGED").definition.schemaVersion, "3.0.0-subset.44");
  const coverage = analyzeV3Coverage(loadReviewedV3Catalog(), bytes, { candidates: generated.candidates });
  assert.equal(coverage.counts.candidate, 3);
  assert.equal(coverage.counts.approved, 0);
});

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

test("counter distinguishes fixed leader, a single optional target across zones, and unsupported payments or totals", () => {
  const event = { "種類": "EVENT", "パワー": "-", "属性": "-" };
  const g = generateV3Drafts(ledgerFromCsv(csv([
    card("COUNT-POWER", "【カウンター】自分のリーダーを、このバトル中、パワー+2000。", event),
    card("COUNT-COST", "【カウンター】手札1枚を捨てる：自分のリーダーを、このバトル中、パワー+2000。", event),
    card("COUNT-TARGET", "【カウンター】自分のリーダーかキャラ1枚までを、このバトル中、パワー+2000。", event),
    card("COUNT-TOTAL", "【カウンター】自分のリーダーかキャラ2枚までを、このバトル中、パワー+2000。", event)
  ])));
  const [select, buff] = entry(g, "COUNT-POWER").definition.effects[0].actions;
  assert.deepEqual([select.selector.zone, select.selector.owner, select.selector.min, select.selector.max], ["leader", "SELF", 1, 1]);
  assert.deepEqual([buff.type, buff.amount, buff.duration.type], ["MODIFY_STAT", 2000, "BATTLE_END"]);
  assert.equal(entry(g, "COUNT-COST").definition, undefined);
  const [mode] = entry(g, "COUNT-TARGET").definition.effects[0].actions;
  assert.equal(mode.type, "CHOOSE_MODE");
  assert.deepEqual(mode.modes.map(({ actions: [pick, modify] }) =>
    [pick.selector.zone, pick.selector.owner, pick.selector.chooser, pick.selector.min, pick.selector.max, modify.duration.type]), [
    ["leader", "SELF", "SELF", 0, 1, "BATTLE_END"], ["character", "SELF", "SELF", 0, 1, "BATTLE_END"]
  ]);
  assert.equal(entry(g, "COUNT-TOTAL").definition, undefined);
});

test("structured clauses retain conjunctive conditions, current target bounds, quantities and independent sequential bindings", () => {
  const body = "【登場時】自分のライフが2枚以下でかつ、相手の手札が3枚以上の場合、相手のレストのコスト4以下かつパワー3000以上のキャラ2枚までを、KOする。その後、相手のアクティブのキャラ1枚までを、このターン中、パワー-1000。";
  const g = generateV3Drafts(ledgerFromCsv(csv([card("STRUCTURE-AND", body)])));
  const [effect] = entry(g, "STRUCTURE-AND").definition.effects;
  const [condition] = effect.actions;
  assert.deepEqual(condition.condition.conditions.map(x => [x.left.ref, x.op, x.right]), [
    ["SELF.lifeCount", "lte", 2], ["OPPONENT.handCount", "gte", 3]
  ]);
  const [pick, ko, second, duration] = condition.then;
  assert.deepEqual([pick.selector.owner, pick.selector.chooser, pick.selector.min, pick.selector.max], ["OPPONENT", "SELF", 0, 2]);
  assert.deepEqual(pick.selector.filters.conditions.map(x => [x.left.ref, x.op, x.right]), [
    ["CANDIDATE.rotated", "eq", true], ["CANDIDATE.current.cost", "lte", 4], ["CANDIDATE.current.power", "gte", 3000]
  ]);
  assert.equal(ko.type, "KO");
  assert.notEqual(pick.bindAs, second.bindAs);
  assert.equal(second.selector.filters.conditions[0].right, false);
  assert.deepEqual(duration.condition, { type: "TURN_IS", player: "SELF" });
  for (const [branch, player] of [[duration.then, "SELF"], [duration.else, "OPPONENT"]]) {
    assert.deepEqual([branch[0].cards.ref, branch[0].amount, branch[0].duration], [
      `bindings.${second.bindAs}`, -1000, { type: "TURN_END", player, occurrence: 1 }
    ]);
  }
});

test("a structured MAIN draw then discard resolves against the post-draw hand, with private and exact selection", () => {
  const body = "【メイン】カード2枚を引き、自分の手札3枚を捨てる。";
  const g = generateV3Drafts(ledgerFromCsv(csv([card("STRUCTURE-EVENT", body, { "種類": "EVENT", "パワー": "-", "属性": "-" })])));
  const { schemaVersion, effects } = entry(g, "STRUCTURE-EVENT").definition;
  const [draw, discard] = effects[0].actions;
  assert.equal(draw.type, "DRAW");
  assert.deepEqual([discard.then[0].selector.min, discard.else[0].then[0].selector.min, discard.else[0].else[0].then[0].selector.min], [3, 2, 1]);
  assert.deepEqual(discard.else[0].else[0].else, []);
  const { c } = eventFixture({ mutate(d) { d.schemaVersion = schemaVersion; d.effects = effects; } });
  const use = c.mainEventChoicesFor(0)[0];
  const before = c.snapshotForCoordinator().movement.players[0];
  c.useMainEvent(0, id(), c.context(), use.sourceToken, use.effectId);
  finish(c, 0);
  const q = c.viewFor(0).frame.choice;
  assert.equal(q.options.length, before.hand.length - 1 + 2);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.throws(() => c.answer(0, id(), c.context(), q.selectionId, q.options.slice(0, 2).map(o => o.token)));
  c.answer(0, id(), c.context(), q.selectionId, q.options.slice(0, 3).map(o => o.token));
  finish(c, 0);
  const after = c.snapshotForCoordinator().movement.players[0];
  assert.equal(after.hand.length, before.hand.length - 2);
  assert.equal(after.trash.length, before.trash.length + 4);
});

test("sequential exact discard resolves as many as possible if earlier work reduces the hand", () => {
  const body = "【メイン】自分の手札3枚を捨てる。その後、自分の手札3枚を捨てる。";
  const g = generateV3Drafts(ledgerFromCsv(csv([card("STRUCTURE-SHORT", body, { "種類": "EVENT", "パワー": "-", "属性": "-" })])));
  const { schemaVersion, effects } = entry(g, "STRUCTURE-SHORT").definition;
  const { c } = eventFixture({ mutate(d) { d.schemaVersion = schemaVersion; d.effects = effects; } });
  const use = c.mainEventChoicesFor(0)[0];
  c.useMainEvent(0, id(), c.context(), use.sourceToken, use.effectId);
  finish(c, 0);
  const first = c.viewFor(0).frame.choice;
  assert.equal(first.options.length, 4);
  c.answer(0, id(), c.context(), first.selectionId, first.options.slice(0, 3).map(o => o.token));
  finish(c, 0);
  const second = c.viewFor(0).frame.choice;
  assert.equal(second.options.length, 1);
  c.answer(0, id(), c.context(), second.selectionId, [second.options[0].token]);
  finish(c, 0);
  assert.equal(c.snapshotForCoordinator().movement.players[0].hand.length, 0);
});

test("uncertain selectors, scope and payment retain precise raw offsets without leaking a partial definition", () => {
  const bodies = [
    ["  【登場時】カード1枚を引く。その後、相手のキャラ2枚を、KOする。  ", "相手のキャラ2枚を、KOする。", "target-or-operation-unconfirmed"],
    ["【登場時】自分のライフが2枚以下または相手の手札が3枚以上の場合、カード1枚を引く。", "自分のライフが2枚以下または相手の手札が3枚以上の場合、", "resolution-condition-unconfirmed"],
    ["【登場時】ドン!!−1：カード1枚を引く。", "ドン!!−1：カード1枚を引く。", "payment-or-unmodeled-declaration"],
    ["【登場時】自分のリーダーを、このバトル中、パワー+1000。", "自分のリーダーを、このバトル中、パワー+1000。", "target-or-operation-unconfirmed"]
  ];
  const g = generateV3Drafts(ledgerFromCsv(csv(bodies.map(([body], i) => card(`HELD-${i}`, body)))));
  for (const [i, [body, unresolved, reason]] of bodies.entries()) {
    assert.equal(entry(g, `HELD-${i}`).definition, undefined);
    const [span] = trace(g, `HELD-${i}`).variants[0].spans;
    assert.equal(span.reason, reason);
    assert.deepEqual(span.unparsed.map(({ start, end, reason }) => [body.slice(start, end), reason]), [[unresolved, reason]]);
  }
  const multi = "【登場時】カード1枚を引く。その後、カードを選ぶ。その後、ドン!!を追加する。";
  const second = generateV3Drafts(ledgerFromCsv(csv([card("HELD-SEQUENCE", multi)])));
  const [span] = trace(second, "HELD-SEQUENCE").variants[0].spans;
  assert.deepEqual(span.unparsed.map(({ start, end }) => multi.slice(start, end)), ["カードを選ぶ。", "ドン!!を追加する。"]);
  assert.equal(entry(second, "HELD-SEQUENCE").definition, undefined);
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
