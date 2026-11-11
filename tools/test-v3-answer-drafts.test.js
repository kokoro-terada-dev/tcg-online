import test from "node:test";
import assert from "node:assert/strict";
import { parseZoneEffect } from "./v3-draft-zones.js";

const parse = (body, timing = "ON_PLAY") =>
  parseZoneEffect(body, timing, "character", { start: 0, end: body.length }, true);

test("private search selects up to two across name and trait, then trashes the remainder", () => {
  const { actions } = parse("自分のデッキの上から5枚を見て、「例」か特徴《分類》を持つカード合計2枚までを公開し、手札に加える。その後、残りをトラッシュに置く。");
  const [look, pick, reveal, take, rest] = actions;
  assert.equal(look.count, 5);
  assert.deepEqual([pick.selector.min, pick.selector.max, pick.selector.visibility, pick.selector.filters.type], [0, 2, "OWNER_ONLY", "any"]);
  assert.equal(reveal.cards.ref, take.cards.ref);
  assert.equal(rest.excludeCards.ref, take.cards.ref);
  assert.equal(rest.destination.zone, "trash");
});

test("mixed trait hand entry applies the same power cap to either branch", () => {
  const { actions } = parse("自分の手札からパワー6000以下の、特徴《甲》か『乙』を含む特徴を持つキャラカード1枚までを、登場させる。");
  const filter = actions[0].selector.filters;
  assert.equal(filter.type, "any");
  assert.deepEqual(filter.conditions.map(branch => branch.conditions[0].right), [6000, 6000]);
  assert.deepEqual(filter.conditions.map(branch => branch.conditions[1].comparison), ["EXACT", "CONTAINS"]);
});

test("DON gap comparison includes attached DON through the existing field-count reference", () => {
  const { actions } = parse("自分の場のドン!!の枚数が相手の場のドン!!の枚数より6枚以上少ない場合、カード1枚を引く。");
  const arms = actions[0].condition.conditions;
  assert.equal(arms.length, 5);
  assert.deepEqual(arms[2].conditions, [
    { type: "compare", left: { ref: "SELF.don.fieldCount" }, op: "eq", right: 2 },
    { type: "compare", left: { ref: "OPPONENT.don.fieldCount" }, op: "gte", right: 8 }
  ]);
});
