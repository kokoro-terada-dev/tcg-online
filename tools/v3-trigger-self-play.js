import { fieldDonCondition } from "./v3-draft-structure.js";

const selfPlay = "このカードを登場させる。";
const side = word => word === "自分" ? "SELF" : "OPPONENT";
const leader = (owner, filters) => ({
  type: "EXISTS", query: { type: "QUERY_CARDS", owner, controller: owner, zone: "leader",
    visibility: "PUBLIC", faceUpOnly: true, cardTypes: ["leader"], excludeSource: false, filters }
});
const leaderTraits = /^(自分|相手)のリーダーが特徴(《[^《》\r\n]+》(か《[^《》\r\n]+》){0,2})を(?:持つ$|持ち、(.+)$)/u;

function condition(text) {
  const traits = leaderTraits.exec(text);
  if (traits) {
    const values = [...traits[2].matchAll(/《([^《》]+)》/gu)].map(match => match[1]);
    if (new Set(values).size !== values.length) return null;
    const trait = leader(side(traits[1]), { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT",
      field: "traits", comparison: "EXACT", match: "ANY", values });
    if (!traits[4]) return trait;
    const next = countCondition(traits[4]);
    return next ? { type: "all", conditions: [trait, next] } : null;
  }
  const name = /^(自分|相手)のリーダーが「([^「」\r\n]+)」$/u.exec(text);
  if (name) return leader(side(name[1]), { type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op: "eq", value: name[2] });
  return countCondition(text);
}

function countCondition(text) {
  const count = /^(自分|相手)のライフが(0|[1-9][0-9]?)枚(以下|以上)?$/u.exec(text);
  if (!count) return fieldDonCondition(text);
  return { type: "compare", left: { ref: `${side(count[1])}.lifeCount` },
    op: count[3] === "以下" ? "lte" : count[3] === "以上" ? "gte" : "eq", right: Number(count[2]) };
}

export function classifyTriggerSelfPlay(body) {
  if (body === selfPlay) return { kind: "unconditional" };
  if (!body.endsWith(selfPlay)) return { kind: "unconfirmed" };
  if (/[:：]/u.test(body)) return { kind: "payment" };
  const suffix = `場合、${selfPlay}`;
  if (!body.endsWith(suffix)) return { kind: "unconfirmed" };
  const prefix = body.slice(0, -suffix.length).replace(/の$/u, "");
  if (!prefix || /。|その後/u.test(prefix)) return { kind: "unconfirmed" };
  const predicate = condition(prefix);
  const pattern = !predicate ? null : predicate.type === "all" ? "trait-and-count" :
    predicate.type === "EXISTS" ? predicate.query.filters.type === "CARD_NAME" ? "leader-name" : "leader-trait" :
      predicate.left.ref.endsWith(".lifeCount") ? "life-count" : "don-count";
  return { kind: "conditional", predicate, pattern };
}
