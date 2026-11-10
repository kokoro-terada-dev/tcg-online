import { draftSelect, emitV3Structure, parseV3Structure } from "./v3-draft-structure.js";
import { parsePublicCondition } from "./v3-trigger-self-play.js";

const mainDeckKinds = ["character", "stage", "event"];
const always = () => ({ type: "all", conditions: [] });
const binding = name => ({ ref: `bindings.${name}` });
const predicate = text => parsePublicCondition(text, true);
const metadata = (field, comparison, values) =>
  ({ type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field, comparison, match: "ANY", values });
const nameFilter = (value, op) => ({ type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op, value });
const numeric = (field, op, right) => ({ type: "compare", left: { ref: `CANDIDATE.current.${field}` }, op, right });

function searchTarget(text) {
  const conditions = [];
  const exclusion = /^「([^「」]+)」以外の/u.exec(text);
  if (exclusion) { conditions.push(nameFilter(exclusion[1], "ne")); text = text.slice(exclusion[0].length); }
  const range = /^(コスト|パワー)(0|[1-9][0-9]{0,4})から(0|[1-9][0-9]{0,4})の/u.exec(text);
  const bound = /^(コスト|パワー)(0|[1-9][0-9]{0,4})(以下|以上)?の/u.exec(text);
  if (range) {
    if (Number(range[2]) > Number(range[3])) return null;
    const stat = range[1] === "コスト" ? "cost" : "power";
    conditions.push(numeric(stat, "gte", Number(range[2])), numeric(stat, "lte", Number(range[3])));
    text = text.slice(range[0].length);
  } else if (bound) {
    conditions.push(numeric(bound[1] === "コスト" ? "cost" : "power",
      bound[3] === "以下" ? "lte" : bound[3] === "以上" ? "gte" : "eq", Number(bound[2])));
    text = text.slice(bound[0].length);
  }
  const traits = /^特徴(《[^《》]+》(か《[^《》]+》){0,2})を持つ/u.exec(text);
  const contains = /^『([^『』]+)』を含む特徴を持つ/u.exec(text);
  if (traits || contains) {
    const values = traits ? [...traits[1].matchAll(/《([^《》]+)》/gu)].map(m => m[1]) : [contains[1]];
    if (new Set(values).size !== values.length) return null;
    conditions.push(metadata("traits", traits ? "EXACT" : "CONTAINS", values));
    text = text.slice((traits ?? contains)[0].length);
  }
  const exact = /^「([^「」]+)」(?:のカード|のキャラカード)?$/u.exec(text);
  const types = new Map([["カード", mainDeckKinds], ["キャラカード", ["character"]], ["イベント", ["event"]],
    ["イベントカード", ["event"]], ["ステージカード", ["stage"]], ["ステージ", ["stage"]]]);
  const kinds = exact ? text.endsWith("のキャラカード") ? ["character"] : mainDeckKinds : types.get(text);
  if (!kinds) return null;
  if (exact) conditions.push(nameFilter(exact[1], "eq"));
  // A power filter on an Event/Stage with no printed power would be UNKNOWN.
  if ((range?.[1] ?? bound?.[1]) === "パワー" && kinds.some(kind => kind !== "character")) return null;
  return { kinds, filters: { type: "all", conditions } };
}

const remainder = "残りを好きな順番でデッキの下に置く";
function search(body, prefix, sourceSpan) {
  const form = /^自分のデッキの上から([1-9])枚を見て、(.+?)([1-9])枚までを公開し、手札に加え(?:る。その後、|、)残りを好きな順番でデッキの下に置く。$/u.exec(body);
  if (!form || Number(form[3]) > Number(form[1])) return null;
  const target = searchTarget(form[2]);
  if (!target) return null;
  const looked = `${prefix}_seen`, selected = `${prefix}_picked`, ordered = `${prefix}_ordered`;
  return { pattern: "recipe-private-search", actions: [
    { type: "LOOK_TOP", player: "SELF", count: Number(form[1]), bindAs: looked, onInsufficient: "takeAvailable", sourceSpan },
    { type: "SELECT", bindAs: selected, selector: { type: "BOUND_CARDS", cards: binding(looked), excludeCards: null,
      owner: "SELF", controller: "SELF", chooser: "SELF", zone: "deck", cardTypes: target.kinds, filters: target.filters,
      visibility: "OWNER_ONLY", faceUpOnly: false, excludeSource: false, min: 0, max: Number(form[3]),
      selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" } },
    { type: "REVEAL", cards: binding(selected), viewers: "BOTH", sourceSpan },
    { type: "MOVE_CARD", cards: binding(selected), destination: { owner: "SELF", zone: "hand", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan },
    { type: "ORDER_CARDS", cards: binding(looked), excludeCards: binding(selected), bindAs: ordered, chooser: "SELF", sourceSpan },
    { type: "RETURN_TO_DECK", cards: binding(ordered), player: "SELF", position: "bottom", sourceSpan }
  ] };
}

function reorder(body, prefix, sourceSpan) {
  const form = /^自分のデッキの上から([1-9])枚を見て、好きな順番に並び(?:替え|変え)、デッキの(上か下|上|下)に置く。$/u.exec(body);
  if (!form) return null;
  const looked = `${prefix}_seen`, ordered = `${prefix}_ordered`;
  const returnTo = position => ({ type: "RETURN_TO_DECK", cards: binding(ordered), player: "SELF", position, sourceSpan });
  return { pattern: "recipe-private-order", actions: [
    { type: "LOOK_TOP", player: "SELF", count: Number(form[1]), bindAs: looked, onInsufficient: "takeAvailable", sourceSpan },
    { type: "ORDER_CARDS", cards: binding(looked), excludeCards: null, bindAs: ordered, chooser: "SELF", sourceSpan },
    form[2] === "上か下" ? { type: "CHOOSE_MODE", modes: [
      { label: "デッキの上", actions: [returnTo("top")] }, { label: "デッキの下", actions: [returnTo("bottom")] }
    ] } : returnTo(form[2] === "上" ? "top" : "bottom")
  ] };
}

const donAttachment = /^自分の(?:(特徴《([^《》]+)》を持つ))?(リーダーかキャラ1枚|リーダー(?:1枚)?|キャラ1枚)に(レスト|アクティブ)のドン(?:[!！]{2}|‼)([1-9]|10)枚までを、?付与する。$/u;
function attach(body, prefix, sourceSpan) {
  const form = donAttachment.exec(body);
  if (!form) return null;
  const kinds = form[3].includes("か") ? ["leader", "character"] : [form[3].startsWith("リーダー") ? "leader" : "character"];
  const target = `${prefix}_target`, don = `${prefix}_don`, from = form[4] === "レスト" ? "REST" : "ACTIVE";
  const pick = draftSelect(target, kinds[0], "SELF", 1, 1, form[2] ? metadata("traits", "EXACT", [form[2]]) : always());
  if (kinds.length > 1) Object.assign(pick.selector, { zone: kinds, cardTypes: kinds });
  pick.selector.onInsufficient = "skip";
  const payment = draftSelect(don, from === "REST" ? "restDon" : "activeDon", "SELF", 0, Number(form[5]), always());
  payment.selector.cardTypes = ["don"];
  return { pattern: "recipe-don-attachment", actions: [pick,
    { type: "IF", condition: { type: "compare", left: { ref: `bindings.${target}.count` }, op: "eq", right: 1 }, then: [
      payment, { type: "ATTACH_DON", from, assignments: [{ cards: binding(don), target: binding(target) }], sourceSpan }
    ], else: [] }
  ] };
}

function ownerHand(body, sourceSpan) {
  const discard = /^相手は自身の手札([1-9])枚を捨てる。$/u.exec(body);
  if (discard) return { pattern: "recipe-owner-hand", actions: [{ type: "DISCARD_BY_OWNER", player: "OPPONENT", chooser: "OPPONENT", count: Number(discard[1]), sourceSpan }] };
  const bottom = /^相手は自身の手札(?:(1)枚をデッキの下|(\d)枚を好きな順番でデッキの下)に置く。$/u.exec(body);
  if (bottom && Number(bottom[1] ?? bottom[2]) > 0) return { pattern: "recipe-owner-hand", actions: [
    { type: "ORDER_THEN_MOVE", player: "OPPONENT", chooser: "OPPONENT", count: Number(bottom[1] ?? bottom[2]), destination: "deckBottom", sourceSpan }
  ] };
  return null;
}

function leadingCondition(text) {
  const clause = /^([^。]+?)(?:の)?場合、/u.exec(text);
  if (!clause) return { body: text };
  return { body: text.slice(clause[0].length), condition: predicate(clause[1]) };
}

export function parseExistingRecipes(body, timing, cardType, sourceSpan) {
  const initial = leadingCondition(body);
  if (initial.condition === null) return null;
  const parts = initial.body.split("。その後、");
  if (parts.length > 6) return null;
  const actions = [], patterns = new Set();
  const eventMain = cardType === "event" && timing === "MAIN";
  for (let i = 0; i < parts.length; i++) {
    const prefix = `recipe_${sourceSpan.start}_${i}`, step = i === 0 ? { body: parts[i] } : leadingCondition(parts[i]);
    if (step.condition === null) return null;
    const sentence = i === parts.length - 1 ? step.body : `${step.body}。`;
    let parsed = !eventMain && (search(sentence, prefix, sourceSpan) || reorder(sentence, prefix, sourceSpan) || attach(sentence, prefix, sourceSpan));
    if (!parsed && !eventMain && parts[i + 1]?.replace(/。$/u, "") === remainder) {
      parsed = search(`${sentence}その後、${remainder}。`, prefix, sourceSpan);
      if (parsed) i++;
    }
    const structure = parsed ? null : parseV3Structure(sentence, timing, predicate).structure;
    parsed ||= ownerHand(sentence, sourceSpan);
    if (!parsed && !structure) return null;
    if (parsed) patterns.add(parsed.pattern);
    const next = parsed?.actions ?? emitV3Structure(structure, sourceSpan, true, prefix);
    actions.push(...(step.condition ? [{ type: "IF", condition: step.condition, then: next, else: [] }] : next));
  }
  if (!patterns.size) return null;
  return { pattern: [...patterns][0], actions: initial.condition ?
    [{ type: "IF", condition: initial.condition, then: actions, else: [] }] : actions };
}
