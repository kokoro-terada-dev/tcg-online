import { draftSelect } from "./v3-draft-structure.js";

const all = (...conditions) => ({ type: "all", conditions });
const compare = (op, right) => ({ type: "compare", left: { ref: "CANDIDATE.current.cost" }, op, right });
const cards = bind => ({ ref: `bindings.${bind}` });
const life = operation => ({ type: "LIFE_TOP_COST", operation });
const power = (bind, amount, duration, sourceSpan) =>
  ({ type: "MODIFY_STAT", cards: cards(bind), stat: "power", amount, duration, sourceSpan });

export function lifeCostProgram(text, timing, cardType, sourceSpan, branches = []) {
  const bind = `life_cost_target_${sourceSpan.start}`;
  const pattern = "zone-life-top-cost";
  const refresh = /^相手のレストのコスト([0-9]{1,2})以下のキャラ([1-5])枚までは、次の相手のリフレッシュフェイズでアクティブにならない。$/u.exec(text);
  if (timing === "ON_PLAY" && cardType === "character" && refresh) return { pattern: "zone-skip-refresh",
    actions: [draftSelect(bind, "character", "OPPONENT", 0, Number(refresh[2]), all(
      { type: "compare", left: { ref: "CANDIDATE.rotated" }, op: "eq", right: true }, compare("lte", Number(refresh[1])))),
    { type: "SKIP_REFRESH", cards: cards(bind), duration: { type: "UNTIL_BOUNDARY", player: "OPPONENT", boundary: "TURN_START", occurrence: 1, includeCurrent: false }, sourceSpan }] };
  const revealDraw = /^自分の手札からイベントか特徴《([^《》]+)》を持つカード合計([1-9][0-9]?)枚を公開できる：カード([1-9][0-9]?)枚を引く。$/u.exec(text);
  if (timing === "ON_PLAY" && cardType === "character" && revealDraw) {
    const count = Number(revealDraw[2]);
    const filter = { type: "any", conditions: [
      { type: "compare", left: { ref: "CANDIDATE.cardType" }, op: "eq", right: "event" },
      { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field: "traits", comparison: "EXACT", match: "ANY", values: [revealDraw[1]] }
    ] };
    return { pattern: "zone-reveal-confirmation-cost", optional: true,
      costs: [{ type: "REVEAL_CARDS", confirmation: "OPPONENT", selector: draftSelect(bind, "hand", "SELF", count, count, filter, { visibility: "OWNER_ONLY" }).selector }],
      actions: [{ type: "DRAW", player: "SELF", count: Number(revealDraw[3]), sourceSpan }] };
  }
  const restDraw = /^自分のリーダー「([^「」]+)」をレストにできる：カード([1-9][0-9]?)枚を引く。$/u.exec(text);
  if (timing === "MAIN" && cardType === "event" && restDraw) return { pattern: "zone-rest-card-cost", optional: true,
    costs: [{ type: "REST_AS_COST", selector: draftSelect(bind, "leader", "SELF", 1, 1, {
      type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op: "eq", value: restDraw[1]
    }).selector }],
    actions: [{ type: "DRAW", player: "SELF", count: Number(restDraw[2]), sourceSpan }] };
  const restCounter = /^自分のカード1枚をレストにできる：自分の特徴《([^《》]+)》を持つ、リーダーかキャラ1枚までを、このバトル中、パワー\+([1-9][0-9]{0,4})。$/u.exec(text);
  if (timing === "COUNTER" && cardType === "event" && restCounter) {
    const payment = draftSelect(bind, "character", "SELF", 1, 1, all()).selector;
    Object.assign(payment, { zone: ["leader", "character", "stage", "activeDon"], cardTypes: ["leader", "character", "stage", "don"] });
    const pick = draftSelect(bind, "character", "SELF", 0, 1, {
      type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field: "traits", comparison: "EXACT", match: "ANY", values: [restCounter[1]]
    });
    Object.assign(pick.selector, { zone: ["leader", "character"], cardTypes: ["leader", "character"] });
    return { pattern: "zone-rest-card-cost", optional: true, costs: [{ type: "REST_AS_COST", selector: payment }],
      actions: [pick, power(bind, Number(restCounter[2]), { type: "BATTLE_END" }, sourceSpan)] };
  }
  if (timing === "MAIN" && cardType === "character" && text ===
      "【ターン1回】自分のライフの上から1枚を手札に加えることができる：以下から1つを選ぶ。") {
    const modes = branches.map(({ label, sourceSpan: branchSpan }) => {
      const m = /^キャラ1枚までを、このターン中、パワー([+-][1-9][0-9]{0,4})。$/u.exec(label);
      return m && { label, actions: [draftSelect(bind, "character", "EITHER", 0, 1, all()),
        power(bind, Number(m[1]), { type: "TURN_END", player: "SELF", occurrence: 1 }, branchSpan)] };
    });
    return modes.length >= 2 && modes.every(Boolean) ? { pattern, optional: true,
      usageLimit: { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 }, costs: [life("TO_HAND")],
      actions: [{ type: "CHOOSE_MODE", modes, sourceSpan }] } : null;
  }
  const entry = /^自分のリーダーが「([^「」]+)」の場合、自分のライフの上から1枚を裏向きにできる：相手のコスト([0-9]{1,2})以下のキャラ1枚までを、レストにする。$/u.exec(text);
  if (timing === "ON_PLAY" && cardType === "character" && entry) return { pattern, optional: true, costs: [life("FACE_DOWN")],
    activationConditions: { type: "EXISTS", query: { type: "QUERY_CARDS", owner: "SELF", controller: "SELF", zone: "leader",
      cardTypes: ["leader"], visibility: "PUBLIC", faceUpOnly: true, excludeSource: false,
      filters: { type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op: "eq", value: entry[1] } } },
    actions: [draftSelect(bind, "character", "OPPONENT", 0, 1, compare("lte", Number(entry[2]))),
      { type: "REST", cards: cards(bind), sourceSpan }] };
  const main = /^自分のコスト([0-9]{1,2})以上の特徴《([^《》]+)》を持つキャラ1枚をトラッシュに置くことができる：自分のデッキの上から1枚までを、ライフの上に加える。$/u.exec(text);
  if (timing === "MAIN" && cardType === "event" && main) return { pattern,
    costs: [{ type: "MOVE_AS_COST", destination: "trash", selector: draftSelect(bind, "character", "SELF", 1, 1,
      all(compare("gte", Number(main[1])), { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT",
        field: "traits", comparison: "EXACT", match: "ANY", values: [main[2]] })).selector }],
    actions: [{ type: "CHOOSE_MODE", sourceSpan, modes: [
      { label: "デッキの上から1枚をライフに加える", actions: [{ type: "MOVE_LIFE", player: "SELF", from: "DECK_TOP", to: "LIFE_TOP", faceUp: false }] },
      { label: "加えない", actions: [] }
    ] }] };
  const counter = /^自分のライフの上から1枚を表向きにできる：自分のリーダーかキャラ1枚までを、このバトル中、パワー\+([1-9][0-9]{0,4})。$/u.exec(text);
  if (timing === "COUNTER" && cardType === "event" && counter) {
    const pick = draftSelect(bind, "character", "SELF", 0, 1, all());
    Object.assign(pick.selector, { zone: ["leader", "character"], cardTypes: ["leader", "character"] });
    return { pattern, costs: [life("FACE_UP")], actions: [pick, power(bind, Number(counter[1]), { type: "BATTLE_END" }, sourceSpan)] };
  }
  return null;
}
