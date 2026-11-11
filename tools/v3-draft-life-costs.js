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
  const turnEnd = { type: "TURN_END", player: "SELF", occurrence: 1 };
  const nameTrait = (value, comparison = "EXACT") => ({ type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT",
    field: "traits", comparison, match: "ANY", values: [value] });
  const payKO = (value, comparison) => ({ type: "KO_AS_COST",
    selector: draftSelect(bind, "character", "SELF", 1, 1, nameTrait(value, comparison)).selector });
  const offer = (costs, then) => {
    const payment = `payment_${sourceSpan.start}`;
    return { pattern: "zone-ko-and-stat-costs", actions: [
      { type: "OFFER_PAYMENT", costs, bindAs: payment, sourceSpan },
      { type: "IF_PAYMENT_SUCCEEDED", payment, then, else: [] }
    ] };
  };
  const basePower = /^自分の手札([1-9][0-9]?)枚を捨てることができる：自分のトラッシュが([1-9][0-9]?)枚以上ある場合、自分のリーダーを、このターン中、元々のパワー([1-9][0-9]{0,4})にする。$/u.exec(text);
  if (timing === "ON_OPPONENT_ATTACK" && cardType === "character" && basePower) return { pattern: "zone-ko-and-stat-costs",
    optional: true, costs: [{ type: "DISCARD_HAND", count: Number(basePower[1]) }],
    resolutionConditions: { type: "COUNT", op: "gte", value: Number(basePower[2]), query: {
      type: "QUERY_CARDS", owner: "SELF", controller: "SELF", zone: "trash", visibility: "PUBLIC",
      cardTypes: ["character", "event", "stage"], faceUpOnly: true, excludeSource: false, filters: all()
    } }, actions: [draftSelect(bind, "leader", "SELF", 1, 1, all()),
      { ...power(bind, Number(basePower[3]), { ...turnEnd, player: "OPPONENT" }, sourceSpan), mode: "SET_BASE" }] };
  const blockLock = /^自分のドン!!([1-9])枚をレストにし、自分の『([^『』]+)』を含む特徴を持つキャラ1枚をKOできる：相手のコスト([0-9]{1,2})のキャラすべては、このターン中、【ブロッカー】を発動できない。$/u.exec(text);
  if (timing === "MAIN" && cardType === "event" && blockLock) return offer(
    [{ type: "REST_DON", count: Number(blockLock[1]) }, payKO(blockLock[2], "CONTAINS")],
    [{ ...draftSelect(bind, "character", "OPPONENT", 0, 5, compare("eq", Number(blockLock[3]))), automatic: "ALL" },
      { type: "PREVENT_BLOCKER", cards: cards(bind), sourceSpan }]);
  const koThen = /^自分の特徴《([^《》]+)》を持つキャラ1枚をKOできる：(.+)$/u.exec(text);
  if (cardType === "event" && koThen) {
    const cost = /^相手のキャラ([1-5])枚までを、このターン中、コスト-([1-9][0-9]?)。$/u.exec(koThen[2]);
    if (timing === "MAIN" && cost) return offer([payKO(koThen[1])], [
      draftSelect(bind, "character", "OPPONENT", 0, Number(cost[1]), all()),
      { type: "MODIFY_STAT", cards: cards(bind), stat: "cost", amount: -Number(cost[2]), duration: turnEnd, sourceSpan }
    ]);
    const counter = /^自分のリーダーかキャラ1枚までを、このバトル中、パワー\+([1-9][0-9]{0,4})。$/u.exec(koThen[2]);
    if (timing === "COUNTER" && counter) {
      const pick = draftSelect(bind, "character", "SELF", 0, 1, all());
      Object.assign(pick.selector, { zone: ["leader", "character"], cardTypes: ["leader", "character"] });
      return { pattern: "zone-ko-and-stat-costs", optional: true, costs: [payKO(koThen[1])],
        actions: [pick, power(bind, Number(counter[1]), { type: "BATTLE_END" }, sourceSpan)] };
    }
  }
  const disable = /^相手のキャラ([1-5])枚までを、このターン中、効果を無効にする。$/u.exec(text);
  if (timing === "ON_ATTACK" && cardType === "character" && disable) return { pattern: "zone-field-restriction",
    actions: [draftSelect(bind, "character", "OPPONENT", 0, Number(disable[1]), all()),
      { type: "DISABLE_CARD_EFFECTS", cards: cards(bind), sourceSpan }] };
  const playLock = /^カード([1-9][0-9]?)枚を引き、自分の手札からコスト([0-9]{1,2})以下の特徴《([^《》]+)》を持つキャラカード1枚までを、登場させる。その後、自分は、このターン中、キャラカードを登場できない。$/u.exec(text);
  if (timing === "ON_PLAY" && cardType === "character" && playLock) {
    const filter = all(compare("lte", Number(playLock[2])), { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT",
      field: "traits", comparison: "EXACT", match: "ANY", values: [playLock[3]] });
    const pick = draftSelect(bind, "hand", "SELF", 0, 1, filter, { visibility: "OWNER_ONLY" });
    pick.selector.cardTypes = ["character"];
    return { pattern: "zone-field-restriction", actions: [
      { type: "DRAW", player: "SELF", count: Number(playLock[1]), sourceSpan }, pick,
      { type: "PLAY_BY_EFFECT", cards: cards(bind), from: "hand", destination: { owner: "SELF", zone: "character", slotPolicy: "REPLACE_IF_FULL" },
        enterState: "ACTIVE", provenance: "EFFECT", condition: filter, sourceSpan },
      { type: "PREVENT_CHARACTER_PLAY", player: "SELF", sourceSpan }
    ] };
  }
  const bounce = /^自分の手札([1-9][0-9]?)枚を捨てることができる：相手のコスト([0-9]{1,2})以下のキャラ([1-5])枚までを、このターン中、効果を無効にし、持ち主の手札に戻す。$/u.exec(text);
  if (timing === "MAIN" && cardType === "event" && bounce) {
    const payment = `payment_${sourceSpan.start}`;
    return { pattern: "zone-field-restriction", actions: [
      { type: "OFFER_PAYMENT", costs: [{ type: "DISCARD_HAND", count: Number(bounce[1]) }], bindAs: payment, sourceSpan },
      { type: "IF_PAYMENT_SUCCEEDED", payment, then: [
        draftSelect(bind, "character", "OPPONENT", 0, Number(bounce[3]), compare("lte", Number(bounce[2]))),
        { type: "DISABLE_CARD_EFFECTS", cards: cards(bind), sourceSpan },
        { type: "MOVE_CARD", cards: cards(bind), destination: { owner: "CARD_OWNER", zone: "hand", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan }
      ], else: [] }
    ] };
  }
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
