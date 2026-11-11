import { draftSelect, emitV3Structure, parseV3Structure } from "./v3-draft-structure.js";
import { parseCompoundEffect } from "./v3-draft-compound.js";
import { searchTarget } from "./v3-draft-recipes.js";

const always = () => ({ type: "all", conditions: [] });
const don = String.raw`ドン(?:[!！]{2}|‼)`;
const returned = new RegExp(`^自分の場の${don}が(?:([1-9]|10)枚以上)?${don}デッキに戻された時、(.+)$`, "u");
const returnOne = new RegExp(`^自分の場の${don}1枚を${don}デッキに戻すことができる$`, "u");
const donZones = ["activeDon", "restDon", "attachedDon"];
const actor = side => side === "自分" ? "SELF" : "OPPONENT";
const colors = ["赤", "緑", "青", "紫", "黒", "黄"];
const binding = name => ({ ref: `bindings.${name}` });
const compare = (ref, op, right) => ({ type: "compare", left: { ref }, op, right });

function multicolor(text) {
  const match = /^(自分|相手)のリーダーが多色$/u.exec(text);
  if (!match) return null;
  const owner = actor(match[1]);
  const conditions = colors.flatMap((first, i) => colors.slice(i + 1).map(second => ({
    type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field: "colors", comparison: "EXACT", match: "ALL", values: [first, second]
  })));
  return { type: "EXISTS", query: { type: "QUERY_CARDS", owner, controller: owner, zone: "leader",
    cardTypes: ["leader"], visibility: "PUBLIC", faceUpOnly: true, excludeSource: false, filters: { type: "any", conditions } } };
}

function parseMultiColorEffect(text, timing, cardType, sourceSpan) {
  const form = /^((?:自分|相手)のリーダーが多色)(?:の場合|で、((?:自分|相手)の(?:手札|ライフ)が[0-9]+枚(?:以下|以上))の場合)、(.+)$/u.exec(text);
  if (!form) return null;
  const condition = multicolor(form[1]), parsed = parseCompoundEffect(form[3], timing, cardType, sourceSpan, false, true, true, null, true, true);
  if (!parsed || parsed.costs || parsed.usageLimit) return null;
  if (timing === "TRIGGER" && form[3].includes("このカードを登場させる")) return null;
  const second = form[2] && /^(自分|相手)の(手札|ライフ)が([0-9]+)枚(以下|以上)$/u.exec(form[2]);
  const guard = second ? { type: "all", conditions: [condition,
    compare(`${actor(second[1])}.${second[2] === "手札" ? "handCount" : "lifeCount"}`, second[4] === "以下" ? "lte" : "gte", Number(second[3]))] } : condition;
  return { pattern: "recipe-multicolor-guard", actions: [{ type: "IF", condition: guard, then: parsed.actions, else: [] }] };
}

function parseMixedField(text, sourceSpan) {
  const form = /^(自分|相手)のリーダーか(.*?)キャラ([1-5])枚までを、?(レストにする|アクティブにする)。$/u.exec(text);
  if (!form) return null;
  const [, side, characterFilter, max, verb] = form;
  const character = searchTarget(`${characterFilter}キャラカード`, true, true);
  if (!character) return null;
  const owner = actor(side), bindAs = `mixed_${sourceSpan.start}`;
  const pick = draftSelect(bindAs, "leader", owner, 0, Number(max), { type: "any", conditions: [
    compare("CANDIDATE.cardType", "eq", "leader"),
    { type: "all", conditions: [compare("CANDIDATE.cardType", "eq", "character"), character.filters] }
  ] });
  pick.selector.zone = ["leader", "character"];
  pick.selector.cardTypes = ["leader", "character"];
  return { pattern: "recipe-mixed-field-alternatives", actions: [pick, {
    type: verb === "レストにする" ? "REST" : "SET_ACTIVE", cards: binding(bindAs), sourceSpan
  }] };
}

function parseOptionalFollowup(text, timing, cardType, sourceSpan) {
  const form = /^(.+?を、(?:このバトル中|このターン中)、パワー[+-][0-9]+。)その後、自分の(手札([1-3])枚を捨ててもよい|ドン(?:[!！]{2}|‼)([1-9]|10)枚をレストに(?:できる|してもよい))。そうした場合、(.+)$/u.exec(text);
  if (!form || cardType === "event" && timing === "MAIN") return null;
  const parse = (body, span) => parseCompoundEffect(body, timing, cardType, span, false, true, true, null, true, true);
  const first = parse(form[1], sourceSpan), follow = parse(form[5], { ...sourceSpan, start: sourceSpan.end - form[5].length });
  if (!first || !follow || first.costs || follow.costs || first.usageLimit || follow.usageLimit) return null;
  const payment = `followup_${sourceSpan.start}`;
  const costs = [form[3] ? { type: "DISCARD_HAND", count: Number(form[3]) } : { type: "REST_DON", count: Number(form[4]) }];
  return { pattern: "recipe-optional-sequential-payment", actions: [...first.actions,
    { type: "OFFER_PAYMENT", costs, bindAs: payment, sourceSpan },
    { type: "IF_PAYMENT_SUCCEEDED", payment, then: follow.actions, else: [] }] };
}

function parseRushCharacter(text, timing, cardType, sourceSpan) {
  if (cardType !== "character" || !/このキャラは、?このターン中、(?:【速攻：キャラ】|〖速攻：キャラ〗)を得る。$/u.test(text)) return null;
  const parsed = parseCompoundEffect(text.replace(/(?:【速攻：キャラ】|〖速攻：キャラ〗)を得る。$/u, "【速攻】を得る。"),
    timing, cardType, sourceSpan, false, true, true, null, true, true);
  if (!parsed) return null;
  const rewrite = actions => actions.map(action => action.type === "IF" ?
    { ...action, then: rewrite(action.then), else: rewrite(action.else) } :
    action.type === "GRANT_KEYWORD" && action.keyword.type === "RUSH" ? { ...action, keyword: { type: "RUSH_CHARACTER" } } : action);
  return { ...parsed, pattern: "recipe-grant-rush-character", actions: rewrite(parsed.actions) };
}

function parseRestDonPayment(text, timing, cardType, sourceSpan) {
  const form = /^(【ターン[1１]回】|〖ターン[1１]回〗)?自分の(?:アクティブの)?ドン(?:[!！]{2}|‼)([1-9]|10)枚をレストにできる[:：](.+)$/u.exec(text);
  if (!form || cardType === "event" || !["MAIN", "ON_PLAY", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK", "TURN_END"].includes(timing)) return null;
  const parsed = parseCompoundEffect(form[3], timing, cardType, sourceSpan, false, true, true, null, true, true);
  if (!parsed || parsed.costs || parsed.usageLimit) return null;
  return { ...parsed, pattern: "recipe-explicit-rest-don-payment", costs: [{ type: "REST_DON", count: Number(form[2]) }],
    optional: timing !== "MAIN", ...(form[1] ? { usageLimit: { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 } } : {}) };
}

function parseSameTargetPower(text, timing, sourceSpan) {
  const form = /^((?:自分|相手)の(?:リーダーかキャラ|キャラ|リーダー)1枚までを、このバトル中、パワー[+-][0-9]+。)その後、自分のトラッシュが([1-9][0-9]?)枚以上ある場合、そのカードを、このバトル中、パワー([+-][1-9][0-9]{0,4})。$/u.exec(text);
  if (!form || !["COUNTER", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK"].includes(timing)) return null;
  const structure = parseV3Structure(form[1], timing).structure;
  if (!structure) return null;
  const [pick, change] = emitV3Structure(structure, sourceSpan, true);
  if (pick?.type !== "SELECT" || change?.type !== "MODIFY_STAT") return null;
  const query = { type: "QUERY_CARDS", owner: "SELF", controller: "SELF", zone: "trash", cardTypes: ["character", "event", "stage"],
    visibility: "PUBLIC", faceUpOnly: true, excludeSource: false, filters: always() };
  return { pattern: "recipe-reuse-selected-battle-target", actions: [pick, change, {
    type: "IF", condition: { type: "COUNT", query, op: "gte", value: Number(form[2]) },
    then: [{ ...change, amount: Number(form[3]) }], else: []
  }] };
}

export function parseCompletionEffect(text, timing, cardType, sourceSpan) {
  return parseFreeSlotPlay(text, timing, cardType, sourceSpan) ?? parseMultiColorEffect(text, timing, cardType, sourceSpan) ??
    parseMixedField(text, sourceSpan) ?? parseOptionalFollowup(text, timing, cardType, sourceSpan) ??
    parseRushCharacter(text, timing, cardType, sourceSpan) ?? parseRestDonPayment(text, timing, cardType, sourceSpan) ??
    parseSameTargetPower(text, timing, sourceSpan);
}

function parseReplacement(text, cardType, sourceSpan) {
  const match = /^(【ターン[1１]回】|〖ターン[1１]回〗)?このキャラが(相手の)?効果(?:で|によって)KOされる場合、代わりに(.+)。$/u.exec(text);
  if (cardType !== "character" || !match) return null;
  const body = match[3], cost = /^自分の手札の?(?:(イベントかステージカード|キャラカード|イベント|ステージカード))?1枚を捨てることができる$/u.exec(body);
  let optionalPayment;
  if (cost) {
    const kinds = { "イベントかステージカード": ["event", "stage"], "キャラカード": ["character"], "イベント": ["event"], "ステージカード": ["stage"] };
    const selector = draftSelect("payment", "hand", "SELF", 1, 1, always(), { visibility: "OWNER_ONLY" }).selector;
    if (cost[1]) selector.cardTypes = kinds[cost[1]];
    optionalPayment = { type: "MOVE_AS_COST", selector, destination: "trash" };
  } else if (returnOne.test(body)) optionalPayment = { type: "DON_RETURN", count: 1, from: donZones };
  if (!optionalPayment) return null;
  return { pattern: "recipe-paid-ko-replacement", replacement: {
    type: "REPLACE_EVENT", id: `replacement-${sourceSpan.start}`, sourceSpan, condition: always(),
    match: { cause: "EFFECT_KO", by: match[2] ? "OPPONENT" : "ANY", from: "character", to: "trash" },
    substitute: { type: "PREVENT" }, optionalPayment, ...(match[1] ? { usageLimit: "ONCE_PER_TURN" } : {})
  } };
}

function parseReturned(text, cardType, sourceSpan) {
  if (!["character", "leader", "stage"].includes(cardType)) return null;
  const prefix = /^(?:【(自分|相手)のターン中】|〖(自分|相手)のターン中〗)?(【ターン[1１]回】|〖ターン[1１]回〗)?/u.exec(text);
  const match = returned.exec(text.slice(prefix[0].length));
  if (!match) return null;
  const parsed = parseCompoundEffect(match[2], "ON_EVENT", cardType, sourceSpan, false, true, true, null, true, true);
  if (!parsed || parsed.costs || parsed.usageLimit) return null;
  return { pattern: "recipe-don-return-observer", effect: {
    id: `body-${sourceSpan.start}`, kind: "triggered", sourceZones: [cardType], optional: false, costs: [],
    timing: { type: "ON_EVENT", event: "DON_RETURNED", owner: "SELF", cause: "ANY", min: Number(match[1] ?? 1) },
    usageLimit: prefix[3] ? { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 } : null,
    activationConditions: prefix[1] || prefix[2] ? { type: "TURN_IS", player: actor(prefix[1] ?? prefix[2]) } : always(),
    resolutionConditions: always(), actions: parsed.actions
  } };
}

function parseOptionalOpponentAttack(text, cardType, sourceSpan) {
  const form = /^(【ターン[1１]回】|〖ターン[1１]回〗)?相手がアタックした時、発動できる。(.+)$/u.exec(text);
  if (!form || !["leader", "character"].includes(cardType)) return null;
  const parsed = parseCompoundEffect(form[2], "ON_OPPONENT_ATTACK", cardType, sourceSpan, false, true, true, null, true, true);
  if (!parsed || parsed.costs || parsed.usageLimit) return null;
  return { pattern: "recipe-optional-opponent-attack", effect: {
    id: `body-${sourceSpan.start}`, kind: "triggered", sourceZones: [cardType], optional: true, costs: [],
    timing: { type: "ON_OPPONENT_ATTACK" }, usageLimit: form[1] ? { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 } : null,
    activationConditions: always(), resolutionConditions: always(), actions: parsed.actions
  } };
}

export function parseNewFieldRecipe(text, cardType, sourceSpan) {
  return parseReplacement(text, cardType, sourceSpan) ?? parseReturned(text, cardType, sourceSpan) ??
    parseOptionalOpponentAttack(text, cardType, sourceSpan);
}

export function parseFreeSlotPlay(text, timing, cardType, sourceSpan) {
  const form = /^このキャラをトラッシュに置くことができる[:：]自分の手札から(.+?)1枚までを、?(レストで|アクティブで)?登場させる。(?:その後、(.+))?$/u.exec(text);
  if (!form || cardType !== "character" || !["MAIN", "ON_PLAY", "ON_ATTACK"].includes(timing)) return null;
  const target = searchTarget(form[1], true, true);
  if (!target || target.kinds.length !== 1 || target.kinds[0] !== "character") return null;
  const subsequent = form[3] && parseV3Structure(form[3], timing).structure;
  if (form[3] && !subsequent) return null;
  const chosen = `play_${sourceSpan.start}`;
  const pick = draftSelect(chosen, "hand", "SELF", 0, 1, target.filters, { visibility: "OWNER_ONLY" });
  pick.selector.cardTypes = target.kinds;
  return { pattern: "recipe-play-after-source-cost", costs: [{ type: "MOVE_AS_COST", selector: "SOURCE", destination: "trash" }],
    optional: timing !== "MAIN", actions: [pick, { type: "PLAY_BY_EFFECT", cards: { ref: `bindings.${chosen}` }, from: "hand",
      destination: { owner: "SELF", zone: "character", slotPolicy: "FIRST_EMPTY" }, enterState: form[2] === "レストで" ? "REST" : "ACTIVE",
      provenance: "EFFECT", condition: always(), sourceSpan },
    ...(subsequent ? emitV3Structure(subsequent, sourceSpan, true) : [])] };
}

// Never normalize text inside a literal card name, trait, or quoted string.
export function normalizeGrammar(text) {
  return text.split(/(「[^」]*」|『[^』]*』|《[^》]*》)/u).map((part, index) => index % 2 ? part : part
    .replace(/ドン[ \u3000]+(?=[!！]{2}|‼)/gu, "ドン")
    .replace(/(自分|相手)の、(?=(?:レストの|アクティブの|コスト|パワー|元々の|特徴))/gu, "$1の")
    .replace(/((?:コスト|パワー)[0-9]+(?:以上|以下)?の)、(?=(?:特徴|キャラ|リーダー|ステージ))/gu, "$1")
    .replace(/(パワー|コスト)[−－](?=[0-9])/gu, "$1-")
    .replace(/(パワー|コスト)＋(?=[0-9])/gu, "$1+")).join("");
}
