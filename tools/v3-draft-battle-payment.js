import { draftSelect } from "./v3-draft-structure.js";

const all = () => ({ type: "all", conditions: [] });
const turnEnd = player => ({ type: "TURN_END", player, occurrence: 1 });
const containsTrait = value => ({ type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT",
  field: "traits", comparison: "CONTAINS", match: "ANY", values: [value] });
const leaderOrCharacter = (bindAs, max, filters) => {
  const pick = draftSelect(bindAs, "character", "SELF", 0, max, filters);
  Object.assign(pick.selector, { zone: ["leader", "character"], cardTypes: ["leader", "character"] });
  return pick;
};

export function battlePaymentProgram(text, timing, cardType, sourceSpan) {
  const bindAs = `battle_payment_${sourceSpan.start}`, cards = { ref: `bindings.${bindAs}` };
  const power = (amount, duration) => ({ type: "MODIFY_STAT", cards, stat: "power", amount, duration, sourceSpan });
  const stagePower = /^このステージをレストにし、自分の手札([1-9])枚を捨てることができる：自分の『([^『』]+)』を含む特徴を持つ、リーダーかキャラ([1-5])枚までを、このバトル中、パワー\+([1-9][0-9]{0,4})。$/u.exec(text);
  if (cardType === "stage" && timing === "ON_OPPONENT_ATTACK" && stagePower) return {
    pattern: "zone-battle-payment", optional: true,
    costs: [{ type: "REST_SOURCE" }, { type: "DISCARD_HAND", count: Number(stagePower[1]) }],
    actions: [leaderOrCharacter(bindAs, Number(stagePower[3]), containsTrait(stagePower[2])),
      power(Number(stagePower[4]), { type: "BATTLE_END" })]
  };
  const attackDebuff = /^【ターン1回】自分の手札から『([^『』]+)』を含む特徴を持つカード1枚を捨てることができる：相手のキャラ([1-5])枚までを、このターン中、パワー-([1-9][0-9]{0,4})。$/u.exec(text);
  if (cardType !== "character" || !["ON_ATTACK", "ON_OPPONENT_ATTACK"].includes(timing) || !attackDebuff) return null;
  return { pattern: "zone-battle-payment", optional: true, usageLimit: { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 },
    costs: [{ type: "MOVE_AS_COST", destination: "trash", selector: draftSelect(bindAs, "hand", "SELF", 1, 1,
      containsTrait(attackDebuff[1]), { visibility: "OWNER_ONLY" }).selector }],
    actions: [draftSelect(bindAs, "character", "OPPONENT", 0, Number(attackDebuff[2]), all()),
      power(-Number(attackDebuff[3]), turnEnd(timing === "ON_ATTACK" ? "SELF" : "OPPONENT"))] };
}
