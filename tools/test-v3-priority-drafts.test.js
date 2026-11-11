import test from "node:test";
import assert from "node:assert/strict";
import { parseZoneEffect } from "./v3-draft-zones.js";

const parse = (body, timing = "MAIN", kind = "character") =>
  parseZoneEffect(body, timing, kind, { start: 0, end: body.length }, true);

test("a two-part event payment keeps both costs and only runs the success branch", () => {
  const body = "自分のドン!!2枚をレストにし、自分の手札1枚を捨てることができる：カード2枚を引く。";
  const { actions } = parse(body, "MAIN", "event");
  assert.deepEqual(actions[0].costs, [{ type: "REST_DON", count: 2 }, { type: "DISCARD_HAND", count: 1 }]);
  assert.equal(actions[1].payment, actions[0].bindAs);
  assert.equal(actions[1].then[0].count, 2);
  assert.deepEqual(actions[1].else, []);
});

test("named character alternatives remain an OR over the same single selection", () => {
  const { actions } = parse("自分の手札から「甲」か「乙」か「丙」1枚までを、登場させる。");
  const { selector } = actions[0];
  assert.deepEqual([selector.min, selector.max, selector.chooser, selector.visibility], [0, 1, "SELF", "OWNER_ONLY"]);
  assert.equal(selector.filters.type, "any");
  assert.deepEqual(selector.filters.conditions.map(x => x.value), ["甲", "乙", "丙"]);
  assert.equal(actions[1].destination.slotPolicy, "REPLACE_IF_FULL");
});

test("KO or rest uses the selected target, and does not open a mode without one", () => {
  const { actions } = parse("相手のコスト5以下のキャラ1枚までを、KOするか、レストにする。", "ON_KO");
  assert.equal(actions[0].selector.owner, "OPPONENT");
  assert.deepEqual(actions[1].condition.left, { ref: `bindings.${actions[0].bindAs}.count` });
  assert.deepEqual(actions[1].else, []);
  const modes = actions[1].then[0].modes;
  assert.deepEqual(modes.map(mode => mode.actions[0].type), ["KO", "REST"]);
  assert.ok(modes.every(mode => mode.actions[0].cards.ref === `bindings.${actions[0].bindAs}`));
});

test("multiple or cross-zone entries are not reduced to one hand character", () => {
  assert.equal(parse("自分の手札から特徴《例》を持つキャラカード2枚までを、登場させる。"), null);
  assert.equal(parse("自分の手札かトラッシュから「例」1枚までを、登場させる。"), null);
});
