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
  const power = /^自分の単色のリーダーを、次の相手のエンドフェイズ終了時まで、元々のパワー([1-9][0-9]{0,4})にする。$/u.exec(text);
  if (cardType !== "character" || timing !== "ON_PLAY" || !power) return null;
  const bindAs = `single_color_leader_${sourceSpan.start}`;
  const filter = { type: "any", conditions: colors.map(color => ({ type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT",
    field: "colors", comparison: "EXACT", match: "EXACT", values: [color] })) };
  const select = draftSelect(bindAs, "leader", "SELF", 1, 1, filter);
  select.selector.onInsufficient = "skip";
  return { pattern: "zone-single-color-leader-base", actions: [select, { type: "MODIFY_STAT", mode: "SET_BASE",
    cards: { ref: `bindings.${bindAs}` }, stat: "power", amount: Number(power[1]), sourceSpan,
    duration: { type: "UNTIL_BOUNDARY", boundary: "END_PHASE_END", player: "OPPONENT", occurrence: 1, includeCurrent: false } }] };
}
