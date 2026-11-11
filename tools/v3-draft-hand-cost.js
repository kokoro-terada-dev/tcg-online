import { draftSelect } from "./v3-draft-structure.js";

const colors = ["赤", "緑", "青", "紫", "黒", "黄"];
const query = (owner, zone, filters) => ({ type: "QUERY_CARDS", owner, controller: owner, zone, cardTypes: ["character"],
  visibility: zone === "hand" ? "OWNER_ONLY" : "PUBLIC", faceUpOnly: zone !== "hand", excludeSource: false, filters });

export function handCostProgram(text, cardType, sourceSpan) {
  const cost = /^手札のこのカードは、相手のパワー([0-9]{1,5})以上のキャラがいる場合、コスト-([1-9][0-9]?)。$/u.exec(text);
  if (cardType !== "character" || !cost) return null;
  return { type: "CONTINUOUS_EFFECT", sourceZone: "hand", sourceSpan,
    condition: { type: "EXISTS", query: query("OPPONENT", "character", { type: "compare", left: { ref: "CANDIDATE.current.power" }, op: "gte", right: Number(cost[1]) }) },
    affectedQuery: query("SELF", "hand", { type: "IS_SOURCE" }),
    operation: { type: "ADD_STAT", stat: "cost", amount: -Number(cost[2]) } };
}

export function singleColorLeaderBaseProgram(text, timing, cardType, sourceSpan) {
  const power = /^自分の(?:単色のリーダー|リーダー「([^「」]+)」)を、次の相手のエンドフェイズ終了時まで、元々のパワー([1-9][0-9]{0,4})にする。$/u.exec(text);
  if (cardType !== "character" || timing !== "ON_PLAY" || !power) return null;
  const bindAs = `single_color_leader_${sourceSpan.start}`;
  const filter = power[1] ? { type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op: "eq", value: power[1] } :
    { type: "any", conditions: colors.map(color => ({ type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT",
    field: "colors", comparison: "EXACT", match: "EXACT", values: [color] })) };
  const select = draftSelect(bindAs, "leader", "SELF", 1, 1, filter);
  select.selector.onInsufficient = "skip";
  return { pattern: "zone-single-color-leader-base", actions: [select, { type: "MODIFY_STAT", mode: "SET_BASE",
    cards: { ref: `bindings.${bindAs}` }, stat: "power", amount: Number(power[2]), sourceSpan,
    duration: { type: "UNTIL_BOUNDARY", boundary: "END_PHASE_END", player: "OPPONENT", occurrence: 1, includeCurrent: false } }] };
}

export function conditionalFieldProgram(text, timing, cardType, sourceSpan) {
  if (cardType !== "character") return null;
  const bindAs = `opponent_power_${sourceSpan.start}`, cards = { ref: `bindings.${bindAs}` };
  const boost = /^【ターン1回】相手のパワー([0-9]{1,5})以上のキャラがいて、自分の他の「([^「」]+)」がいない場合、このキャラは、次の相手のエンドフェイズ終了時まで、【ブロッカー】を得て、パワー\+([1-9][0-9]{0,4})。$/u.exec(text);
  if (timing === "MAIN" && boost) return { heldReason: "field-name-including-all-names-leader-unimplemented" };
  const revive = /^自分の手札から『([^『』]+)』を含む特徴を持つカード1枚を捨てることができる：このキャラカードをトラッシュから登場させる。$/u.exec(text);
  if (timing === "ON_KO" && revive) {
    const filters = { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field: "traits",
      comparison: "CONTAINS", match: "ANY", values: [revive[1]] };
    const payment = `revive_payment_${sourceSpan.start}`;
    return { pattern: "zone-effect-play-trash", actions: [
      { type: "OFFER_PAYMENT", bindAs: payment, costs: [{ type: "MOVE_AS_COST", destination: "trash",
        selector: draftSelect(bindAs, "hand", "SELF", 1, 1, filters, { visibility: "OWNER_ONLY" }).selector }], sourceSpan },
      { type: "IF_PAYMENT_SUCCEEDED", payment, then: [{ type: "BIND_SOURCE", bindAs }, { type: "PLAY_BY_EFFECT", cards, from: "trash",
        destination: { owner: "SELF", zone: "character", slotPolicy: "REPLACE_IF_FULL" }, enterState: "ACTIVE", provenance: "EFFECT",
        condition: { type: "all", conditions: [] }, sourceSpan }], else: [] }
    ] };
  }
  const play = /^自分の手札からコスト([0-9]{1,2})の『([^『』]+)』を含む特徴を持つカード([1-5])枚までを、登場させる。$/u.exec(text);
  if (timing !== "ON_KO" || !play || play[3] !== "1") return null;
  const filters = { type: "all", conditions: [
    { type: "compare", left: { ref: "CANDIDATE.current.cost" }, op: "eq", right: Number(play[1]) },
    { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field: "traits", comparison: "CONTAINS", match: "ANY", values: [play[2]] }
  ] };
  const select = draftSelect(bindAs, "hand", "SELF", 0, 1, filters, { visibility: "OWNER_ONLY" });
  select.selector.cardTypes = ["character"];
  return { pattern: "zone-effect-play-full", actions: [select, { type: "PLAY_BY_EFFECT", cards, from: "hand",
    destination: { owner: "SELF", zone: "character", slotPolicy: "REPLACE_IF_FULL" }, enterState: "ACTIVE",
    provenance: "EFFECT", condition: filters, sourceSpan }] };
}
