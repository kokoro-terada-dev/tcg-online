import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseExistingRecipes } from "./v3-draft-recipes.js";
import { parseCompoundEffect } from "./v3-draft-compound.js";
import { reviewableDefinitionFiles } from "./generate-v3-drafts.js";

const require = createRequire(import.meta.url);
const { setup, finish, id } = require("../server/test/helpers/v3-observed.cjs");
const { ApprovedV3Catalog } = require("../server/dist/test/effects/v3/approval.js");
const { compileV3CardJson } = require("../server/dist/test/effects/v3/compiler.js");
const { definition } = require("../server/test/helpers/v3-event.cjs");
const recipe = (body, timing = "ON_PLAY", kind = "character") =>
  parseExistingRecipes(body, timing, kind, { start: 0, end: body.length });
const search = "自分のデッキの上から5枚を見て、「ナミ」以外の特徴《麦わらの一味》か《FILM》を持つカード1枚までを公開し、手札に加える。その後、残りを好きな順番でデッキの下に置く。";

test("search retains exact exclusions, trait alternatives, private scope and remainder, without dropping unsupported text", () => {
  const { actions } = recipe(search);
  assert.deepEqual(actions.map(action => action.type), ["LOOK_TOP", "SELECT", "REVEAL", "MOVE_CARD", "ORDER_CARDS", "RETURN_TO_DECK"]);
  const [look, { selector }, reveal, move, order, rest] = actions;
  assert.deepEqual([look.player, look.count, look.onInsufficient], ["SELF", 5, "takeAvailable"]);
  assert.deepEqual([selector.type, selector.visibility, selector.chooser, selector.min, selector.max], ["BOUND_CARDS", "OWNER_ONLY", "SELF", 0, 1]);
  assert.deepEqual(selector.filters.conditions.map(filter => [filter.type, filter.op ?? filter.match, filter.value ?? filter.values]),
    [["CARD_NAME", "ne", "ナミ"], ["CARD_METADATA", "ANY", ["麦わらの一味", "FILM"]]]);
  assert.deepEqual([reveal.viewers, move.destination.zone, order.excludeCards, rest.position], ["BOTH", "hand", reveal.cards, "bottom"]);
  for (const text of [search.replace("自分のデッキ", "相手のデッキ"), search.replace("1枚まで", "1枚"),
    search.replace("好きな順番", "ランダムな順番"), search + "その後、カードをシャッフルする。"]) assert.equal(recipe(text), null);
  assert.equal(recipe(search, "MAIN", "event"), null);
});

test("ordered composition retains a later condition and a single DON target, and does not transfer hand choices", () => {
  const body = "【ターン1回】このステージをレストにできる：自分のリーダーかキャラ1枚にレストのドン‼2枚までを、付与する。その後、相手の手札が5枚以上の場合、相手は自身の手札1枚をデッキの下に置く。";
  const result = parseCompoundEffect(body, "MAIN", "stage", { start: 0, end: body.length }, false, true);
  assert.deepEqual(result.usageLimit, { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 });
  assert.deepEqual(result.costs, [{ type: "REST_SOURCE" }]);
  assert.deepEqual(result.actions[0].selector.zone, ["leader", "character"]);
  const [{ selector }, attach] = result.actions[1].then;
  assert.deepEqual([selector.zone, selector.min, selector.max, attach.from, attach.assignments.length], ["restDon", 0, 2, "REST", 1]);
  assert.equal(result.actions[2].condition.left.ref, "OPPONENT.handCount");
  assert.deepEqual([result.actions[2].then[0].player, result.actions[2].then[0].chooser], ["OPPONENT", "OPPONENT"]);
  assert.equal(recipe("相手の手札1枚を選んで捨てさせる。"), null);
  const reorder = recipe("自分のデッキの上から3枚を見て、好きな順番に並び替え、デッキの上か下に置く。");
  assert.deepEqual(reorder.actions.map(action => action.type), ["LOOK_TOP", "ORDER_CARDS", "CHOOSE_MODE"]);
  assert.deepEqual(reorder.actions[2].modes.map(mode => mode.actions[0].position), ["top", "bottom"]);
});

test("generated search executes unchanged Runtime with selected-only reveal and ordered private remainder", () => {
  const body = "自分のデッキの上から3枚を見て、コスト2のイベント1枚までを公開し、手札に加える。その後、残りを好きな順番でデッキの下に置く。";
  const { actions } = recipe(body);
  const { c, options } = setup({ count: 1, mutate(raw) {
    raw.schemaVersion = "3.0.0-subset.49";
    raw.source.text = body;
    Object.assign(raw.effects[0], { kind: "activated", timing: { type: "MAIN" }, actions });
  } });
  const state = () => c.snapshotForCoordinator().movement, before = state(), [a, b, d] = before.players[0].deck;
  const leader = options.movement.cards[before.players[0].leader[0]];
  c.activate(0, id(), c.context(), { instanceId: leader.instanceId, generation: leader.generation }, "watch-0");
  const first = finish(c, 0).choice;
  assert.equal(first.options.length, 3);
  assert.deepEqual(c.viewFor(1).frame.choice.options, []);
  assert.ok(c.viewFor(1).movement.players[0].deck.every(card => card.cardId === null));
  c.answer(0, id(), c.context(), first.selectionId, [first.options[1].token]);
  c.advance(0, id(), c.context());
  c.applyPendingWork(0, id(), c.context());
  assert.equal(c.viewFor(1).movement.players[0].deck.filter(card => card.cardId !== null).length, 1);
  const remainder = finish(c, 0).choice;
  assert.equal(remainder.purpose, "order");
  c.answer(0, id(), c.context(), remainder.selectionId, [...remainder.options].reverse().map(option => option.token));
  finish(c, 0);
  assert.equal(state().players[0].hand.at(-1), b);
  assert.deepEqual(state().players[0].deck.slice(-2), [d, a]);
  assert.ok(c.viewFor(1).movement.players[0].deck.every(card => card.cardId === null));
});

test("per-card export includes only complete review candidates and cannot create a trusted definition", () => {
  const needsReview = { ...definition(), reviewStatus: "needs_review" };
  const d = id => ({ cardId: id, generation: { status: "complete" }, definition: { ...needsReview, cardId: id } });
  const ids = ["NEW", "KNOWN", "RULING", "PARTIAL"];
  const cards = ids.map(d);
  cards[3].generation.status = "partial";
  const report = { cards: ids.map(cardId => ({ cardId, classification: cardId === "RULING" ? "ruling" : "candidate",
    approval: cardId === "KNOWN" ? {} : null })) };
  const [file] = reviewableDefinitionFiles({ cards }, report);
  assert.deepEqual(reviewableDefinitionFiles({ cards }, report).map(file => file.file), ["NEW.json"]);
  const compiled = compileV3CardJson(JSON.stringify(file.definition));
  assert.equal(compiled.status, "compiled_not_executable");
  assert.throws(() => new ApprovedV3Catalog([compiled], [], "synthetic"), /unapproved/);
  assert.throws(() => reviewableDefinitionFiles({ cards: [d("NUL")] }, { cards: [{ cardId: "NUL", classification: "candidate" }] }), /Unsafe/);
  assert.throws(() => reviewableDefinitionFiles({ cards: [d("NEW"), d("NEW")] }, report), /duplicate/);
});
