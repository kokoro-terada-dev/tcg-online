import { fieldDonCondition } from "./v3-draft-structure.js";

const selfPlay = "このカードを登場させる。";
const side = word => word === "自分" ? "SELF" : "OPPONENT";
const leader = (owner, filters) => ({
  type: "EXISTS", query: { type: "QUERY_CARDS", owner, controller: owner, zone: "leader",
    visibility: "PUBLIC", faceUpOnly: true, cardTypes: ["leader"], excludeSource: false, filters }
});
const leaderTraits = /^(自分|相手)のリーダーが特徴(《[^《》\r\n]+》(か《[^《》\r\n]+》){0,2})を(?:持つ$|持ち、(.+)$)/u;

export function parsePublicCondition(text, compound = false) {
  const traits = leaderTraits.exec(text);
  if (traits) {
    const values = [...traits[2].matchAll(/《([^《》]+)》/gu)].map(match => match[1]);
    if (new Set(values).size !== values.length) return null;
    const trait = leader(side(traits[1]), { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT",
      field: "traits", comparison: "EXACT", match: "ANY", values });
    if (!traits[4]) return trait;
    const next = countCondition(traits[4], compound);
    return next ? { type: "all", conditions: [trait, next] } : null;
  }
  const name = /^(自分|相手)のリーダーが「([^「」\r\n]+)」$/u.exec(text);
  if (name) return leader(side(name[1]), { type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op: "eq", value: name[2] });
  return countCondition(text, compound);
}

function countCondition(text, compound) {
  if (compound) {
    const total = /^お互いのライフの合計枚数が(0|[1-9][0-9]?)枚(以下|以上)$/u.exec(text);
    if (total) return { type: "compare", left: { ref: "BOTH.lifeCount" }, op: total[2] === "以下" ? "lte" : "gte", right: Number(total[1]) };
    const either = /^自分か相手の(ライフが(?:0|[1-9][0-9]?)枚(?:以下|以上)?)$/u.exec(text);
    if (either) return { type: "any", conditions: ["自分", "相手"].map(side => countCondition(`${side}の${either[1]}`, false)) };
    const and = text.split(/でかつ、|かつ、|かつ/u), or = text.split(/または/u);
    if (and.length > 1 && or.length > 1) return null;
    const terms = and.length > 1 ? and : or;
    if (terms.length > 1 && terms.length <= 3) {
      const conditions = terms.map(term => countCondition(term, true));
      return conditions.every(Boolean) ? { type: and.length > 1 ? "all" : "any", conditions } : null;
    }
  }
  const count = /^(自分|相手)の(ライフ|手札)が(0|[1-9][0-9]?)枚(以下|以上)?$/u.exec(text);
  if (!count) return fieldDonCondition(text);
  if (!compound && count[2] === "手札") return null;
  return { type: "compare", left: { ref: `${side(count[1])}.${count[2] === "ライフ" ? "lifeCount" : "handCount"}` },
    op: count[4] === "以下" ? "lte" : count[4] === "以上" ? "gte" : "eq", right: Number(count[3]) };
}

export function classifyTriggerSelfPlay(body, compound = false) {
  if (body === selfPlay) return { kind: "unconditional" };
  if (!body.endsWith(selfPlay)) return { kind: "unconfirmed" };
  if (/[:：]/u.test(body)) return { kind: "payment" };
  const suffix = `場合、${selfPlay}`;
  if (!body.endsWith(suffix)) return { kind: "unconfirmed" };
  const prefix = body.slice(0, -suffix.length).replace(/の$/u, "");
  if (!prefix || /。|その後/u.test(prefix)) return { kind: "unconfirmed" };
  const predicate = parsePublicCondition(prefix, compound);
  const pattern = !predicate ? null : predicate.type === "all" || predicate.type === "any" ? "compound-condition" :
    predicate.type === "EXISTS" ? predicate.query.filters.type === "CARD_NAME" ? "leader-name" : "leader-trait" :
      predicate.left.ref.endsWith(".lifeCount") ? "life-count" : "don-count";
  return { kind: "conditional", predicate, pattern: !compound && pattern === "compound-condition" ? "trait-and-count" : pattern };
}
