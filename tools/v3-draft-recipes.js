import { draftSelect, emitV3Structure, parseV3Structure } from "./v3-draft-structure.js";
import { parsePublicCondition } from "./v3-trigger-self-play.js";

const mainDeckKinds = ["character", "stage", "event"];
const always = () => ({ type: "all", conditions: [] });
const binding = name => ({ ref: `bindings.${name}` });
const predicate = text => parsePublicCondition(text, true);
const metadata = (field, comparison, values) =>
  ({ type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field, comparison, match: "ANY", values });
const nameFilter = (value, op) => ({ type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op, value });
const numeric = (field, op, right, basis) => ({ type: "compare", left: { ref: `CANDIDATE.${basis}.${field}` }, op, right });
const seat = text => text === "自分" ? "SELF" : "OPPONENT";
const query = (owner, zone, cardTypes, filters, excludeSource = false) => ({
  type: "QUERY_CARDS", owner, controller: owner, zone, cardTypes, filters, excludeSource, visibility: "PUBLIC", faceUpOnly: true
});

export function searchTarget(text, batch = false, expansion = false) {
  if (expansion) {
    // Split only after a complete name or explicit card kind, not inside traits.
    const either = /^(「[^「」]+」|.+?(?:キャラカード|イベントカード|ステージカード))か(.+)$/u.exec(text);
    if (either) {
      const alternatives = either.slice(1).map(term => searchTarget(term, true));
      if (!alternatives.every(Boolean)) return null;
      const conditions = alternatives.map(({ kinds, filters }) => {
        const types = kinds.map(kind => ({ type: "compare", left: { ref: "CANDIDATE.cardType" }, op: "eq", right: kind }));
        return { type: "all", conditions: [{ type: "any", conditions: types }, filters] };
      });
      return { kinds: [...new Set(alternatives.flatMap(item => item.kinds))], filters: { type: "any", conditions } };
    }
  }
  const conditions = [];
  const exclusion = /^「([^「」]+)」以外の/u.exec(text);
  if (exclusion) { conditions.push(nameFilter(exclusion[1], "ne")); text = text.slice(exclusion[0].length); }
  const basis = batch && text.startsWith("元々の") ? "base" : "current";
  if (basis === "base") text = text.slice("元々の".length);
  const range = /^(コスト|パワー)(0|[1-9][0-9]{0,4})から(0|[1-9][0-9]{0,4})の/u.exec(text);
  const bound = /^(コスト|パワー)(0|[1-9][0-9]{0,4})(以下|以上)?の/u.exec(text);
  if (basis === "base" && !range && !bound) return null;
  if (range) {
    if (Number(range[2]) > Number(range[3])) return null;
    const stat = range[1] === "コスト" ? "cost" : "power";
    conditions.push(numeric(stat, "gte", Number(range[2]), basis), numeric(stat, "lte", Number(range[3]), basis));
    text = text.slice(range[0].length);
  } else if (bound) {
    conditions.push(numeric(bound[1] === "コスト" ? "cost" : "power",
      bound[3] === "以下" ? "lte" : bound[3] === "以上" ? "gte" : "eq", Number(bound[2]), basis));
    text = text.slice(bound[0].length);
  }
  const color = batch && /^([赤緑青紫黒黄])の/u.exec(text);
  if (color) {
    conditions.push(metadata("colors", "EXACT", [color[1]]));
    text = text.slice(color[0].length);
  }
  const attribute = expansion && /^属性(?:\(([^()（）]+)\)|（([^()（）]+)）)を持つ/u.exec(text);
  if (attribute) {
    conditions.push(metadata("attributes", "EXACT", [attribute[1] ?? attribute[2]]));
    text = text.slice(attribute[0].length);
  }
  const traits = /^特徴(《[^《》]+》(か《[^《》]+》){0,2})を持つ/u.exec(text);
  const contains = /^『([^『』]+)』を含む特徴を持つ/u.exec(text);
  if (traits || contains) {
    const values = traits ? [...traits[1].matchAll(/《([^《》]+)》/gu)].map(m => m[1]) : [contains[1]];
    if (new Set(values).size !== values.length) return null;
    conditions.push(metadata("traits", traits ? "EXACT" : "CONTAINS", values));
    text = text.slice((traits ?? contains)[0].length);
  }
  if (batch && /^(?:【トリガー】|〖トリガー〗)を持つ/u.test(text)) {
    conditions.push({ type: "HAS_ABILITY", subject: "CANDIDATE", basis: "PRINTED", ability: "TRIGGER" });
    text = text.replace(/^(?:【トリガー】|〖トリガー〗)を持つ/u, "");
  }
  if (batch) text = text === "キャラ" ? "キャラカード" : text.replace(/^「([^「」]+)」のキャラ$/u, "「$1」のキャラカード");
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
const remainderChoice = /^残りを好きな順番に並び(?:替え|変え)、デッキの上か下に置く$/u;
function search(body, prefix, sourceSpan, batch, expansion, refinement) {
  const usual = /^自分のデッキの上から([1-9])枚を見て、(.+?)([1-9])枚までを公開し、手札に加え(?:る。その後、|、)残りを好きな順番でデッキの下に置く。$/u.exec(body);
  const twoEnds = !usual && refinement && /^自分のデッキの上から([1-9])枚を見て、(.+?)([1-9])枚までを公開し、手札に加え(?:る。その後、|、)残りを好きな順番に並び(?:替え|変え)、デッキの上か下に置く。$/u.exec(body);
  const form = usual ?? twoEnds;
  if (!form || Number(form[3]) > Number(form[1])) return null;
  const target = searchTarget(form[2], batch, expansion);
  if (!target) return null;
  const looked = `${prefix}_seen`, selected = `${prefix}_picked`, ordered = `${prefix}_ordered`;
  const returnTo = position => ({ type: "RETURN_TO_DECK", cards: binding(ordered), player: "SELF", position, sourceSpan });
  return { pattern: "recipe-private-search", actions: [
    { type: "LOOK_TOP", player: "SELF", count: Number(form[1]), bindAs: looked, onInsufficient: "takeAvailable", sourceSpan },
    { type: "SELECT", bindAs: selected, selector: { type: "BOUND_CARDS", cards: binding(looked), excludeCards: null,
      owner: "SELF", controller: "SELF", chooser: "SELF", zone: "deck", cardTypes: target.kinds, filters: target.filters,
      visibility: "OWNER_ONLY", faceUpOnly: false, excludeSource: false, min: 0, max: Number(form[3]),
      selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" } },
    { type: "REVEAL", cards: binding(selected), viewers: "BOTH", sourceSpan },
    { type: "MOVE_CARD", cards: binding(selected), destination: { owner: "SELF", zone: "hand", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan },
    { type: "ORDER_CARDS", cards: binding(looked), excludeCards: binding(selected), bindAs: ordered, chooser: "SELF", sourceSpan },
    twoEnds ? { type: "CHOOSE_MODE", modes: [
      { label: "デッキの上", actions: [returnTo("top")] }, { label: "デッキの下", actions: [returnTo("bottom")] }
    ] } : returnTo("bottom")
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
function attach(body, prefix, sourceSpan, batch) {
  const form = donAttachment.exec(body) ?? (batch && /^自分の(?:(特徴(《[^《》]+》(か《[^《》]+》){0,2})を持つ)、?)?(リーダーか(?:自分の)?キャラ1枚|リーダー(?:1枚)?|キャラ1枚)に、?(レスト|アクティブ)のドン(?:[!！]{2}|‼)([1-9]|10)枚までを、?付与する。$/u.exec(body));
  if (!form) return null;
  const [who, state, count] = form.slice(-3);
  // An explicit second "自分の" does not carry the leader's trait restriction over to characters.
  if (form[2] && who.includes("か自分の")) return null;
  const traits = form[2] && (form.length === 6 ? [form[2]] : [...form[2].matchAll(/《([^《》]+)》/gu)].map(m => m[1]));
  if (traits && new Set(traits).size !== traits.length) return null;
  const kinds = who.includes("か") ? ["leader", "character"] : [who.startsWith("リーダー") ? "leader" : "character"];
  const target = `${prefix}_target`, don = `${prefix}_don`, from = state === "レスト" ? "REST" : "ACTIVE";
  const pick = draftSelect(target, kinds[0], "SELF", 1, 1, traits ? metadata("traits", "EXACT", traits) : always());
  if (kinds.length > 1) Object.assign(pick.selector, { zone: kinds, cardTypes: kinds });
  pick.selector.onInsufficient = "skip";
  const payment = selectDon(don, from, Number(count));
  return { pattern: "recipe-don-attachment", actions: [pick,
    { type: "IF", condition: { type: "compare", left: { ref: `bindings.${target}.count` }, op: "eq", right: 1 }, then: [
      payment, { type: "ATTACH_DON", from, assignments: [{ cards: binding(don), target: binding(target) }], sourceSpan }
    ], else: [] }
  ] };
}

const selectDon = (bindAs, state, max) => {
  const pick = draftSelect(bindAs, state === "REST" ? "restDon" : "activeDon", "SELF", 0, max, always());
  pick.selector.cardTypes = ["don"];
  return pick;
};

export function filteredHandCost(text) {
  const form = /^自分の手札から(.+?)([1-9])枚を(捨てることができる|公開できる|公開することができる)$/u.exec(text);
  const target = form && searchTarget(form[1], true);
  if (!target) return null;
  const count = Number(form[2]), selector = draftSelect("payment", "hand", "SELF", count, count, target.filters, { visibility: "OWNER_ONLY" }).selector;
  selector.cardTypes = target.kinds;
  return form[3].startsWith("公開") ? { type: "REVEAL_CARDS", selector } : { type: "MOVE_AS_COST", selector, destination: "trash" };
}

const fieldKinds = new Map([["リーダー", "leader"], ["キャラ", "character"]]);
const battleTimings = new Set(["COUNTER", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK"]);
function fieldAction(verb, timing, cards, sourceSpan, refinement) {
  const commands = { "レストにする": "REST", "アクティブにする": "SET_ACTIVE", "KOする": "KO" };
  if (Object.hasOwn(commands, verb)) return { type: commands[verb], cards, sourceSpan };
  if (verb === "持ち主の手札に戻す")
    return { type: "MOVE_CARD", cards, destination: { owner: "CARD_OWNER", zone: "hand", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan };
  const stat = (refinement ?
    /^(このターン中|このバトル中|次の相手のターン終了時まで|次の自分のターン開始時まで)、(パワー|コスト)([+-])([1-9][0-9]{0,4})$/u :
    /^(このターン中|このバトル中|次の相手のターン終了時まで)、(パワー|コスト)([+-])([1-9][0-9]{0,4})$/u).exec(verb);
  const keyword = (refinement ?
    /^(このターン中|このバトル中)、(?:【(速攻|ブロッカー|ダブルアタック|バニッシュ|ブロック不可)】|〖(速攻|ブロッカー|ダブルアタック|バニッシュ|ブロック不可)〗)を得る$/u :
    /^(このターン中|このバトル中)、(?:【(速攻|ブロッカー)】|〖(速攻|ブロッカー)〗)を得る$/u).exec(verb);
  if (!stat && !keyword) return null;
  const period = (stat ?? keyword)[1];
  if (period === "このバトル中" && !battleTimings.has(timing)) return null;
  const withDuration = duration => stat ? {
    type: "MODIFY_STAT", cards, stat: stat[2] === "パワー" ? "power" : "cost", amount: Number(stat[3] + stat[4]), duration, sourceSpan
  } : { type: "GRANT_KEYWORD", cards, keyword: { type: { "速攻": "RUSH", "ブロッカー": "BLOCKER", "ダブルアタック": "DOUBLE_ATTACK",
    "バニッシュ": "BANISH", "ブロック不可": "CANNOT_BE_BLOCKED" }[keyword[2] ?? keyword[3]] }, duration, sourceSpan };
  const end = player => withDuration({ type: "TURN_END", player, occurrence: 1 });
  if (period === "このターン中") return { type: "IF", condition: { type: "TURN_IS", player: "SELF" }, then: [end("SELF")], else: [end("OPPONENT")] };
  if (period === "このバトル中") return withDuration({ type: "BATTLE_END" });
  if (period === "次の自分のターン開始時まで") return withDuration({
    type: "UNTIL_BOUNDARY", player: "SELF", boundary: "TURN_START", occurrence: 1, includeCurrent: false
  });
  return end("OPPONENT");
}

function additionalField(body, cardType, prefix, sourceSpan) {
  const form = /^(.+?)を、?(持ち主の手札に戻す|持ち主のデッキの下に置く|トラッシュに置く|KOする)。$/u.exec(body);
  if (!form) return null;
  const [, target, verb] = form;
  const stage = /^(自分|相手)の(.*?)ステージ([1-5])枚まで$/u.exec(target);
  const withoutSide = !/^(自分|相手)の/u.test(target);
  const field = !stage && fieldTarget(withoutSide ? `自分の${target}` : target);
  if (!stage && (!field || field.excludeSource || field.zones.length !== 1 || field.zones[0] !== "character")) return null;
  if (withoutSide && !["持ち主の手札に戻す", "持ち主のデッキの下に置く"].includes(verb)) return null;
  const stageTarget = stage && searchTarget(`${stage[2]}ステージ`, true);
  if (stage && !stageTarget) return null;
  const owner = stage ? seat(stage[1]) : withoutSide ? "EITHER" : field.owner;
  const max = stage ? Number(stage[3]) : field.max;
  const zone = stage ? "stage" : "character";
  const bindAs = `${prefix}_moved`, cards = binding(bindAs);
  const bottom = verb === "持ち主のデッキの下に置く";
  if (bottom && max !== 1) return null;
  const pick = draftSelect(bindAs, zone, owner, 0, max, stageTarget?.filters ?? field.filters);
  const action = verb === "KOする" ? { type: stage ? "KO_STAGE" : "KO", cards, sourceSpan } :
    { type: "MOVE_CARD", cards, destination: { owner: verb === "トラッシュに置く" ? owner : "CARD_OWNER",
      zone: bottom ? "deck" : verb === "トラッシュに置く" ? "trash" : "hand",
      position: bottom ? "bottom" : "append", faceUp: !bottom }, cause: "EFFECT", sourceSpan };
  return { pattern: stage ? "recipe-stage-target" : "recipe-field-movement", actions: [pick, action],
    movesSource: zone === cardType && owner !== "OPPONENT" };
}

function fieldTarget(text, expansion = false) {
  const form = /^(自分|相手)の(このキャラ以外の)?(レストの|アクティブの)?(.*?)((?:リーダーか|リーダーと)?キャラ|リーダー)(合計)?([1-5])枚まで$/u.exec(text);
  if (!form) return null;
  const [, player, exclude, state, filters, types, total, max] = form;
  if (Boolean(total) !== types.startsWith("リーダーと") || types === "リーダー" && max !== "1" ||
      exclude && (player !== "自分" || types !== "キャラ")) return null;
  const zones = types === "リーダー" ? ["leader"] : types === "キャラ" ? ["character"] : ["leader", "character"];
  const prefix = expansion ? filters.replace(/を持つ、$/u, "を持つ") : filters;
  const parsed = searchTarget(`${prefix}${types === "リーダー" ? "カード" : "キャラカード"}`, true);
  if (!parsed || zones.includes("leader") && parsed.filters.conditions.some(filter => filter.left?.ref.endsWith(".cost"))) return null;
  if (state) parsed.filters.conditions.push({ type: "compare", left: { ref: "CANDIDATE.rotated" }, op: "eq", right: state === "レストの" });
  return { owner: player === "自分" ? "SELF" : "OPPONENT", excludeSource: Boolean(exclude), zones, max: Number(max), filters: parsed.filters };
}

const fieldTimings = new Set(["MAIN", "ON_PLAY", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK", "TURN_END"]);
function targetedField(body, timing, cardType, prefix, sourceSpan, sourceAvailable, expansion, refinement) {
  const self = (refinement ? /^この(キャラ|リーダー)(?:は|を)、?(.+)。$/u : /^この(キャラ|リーダー)(?:は、|を、?)(.+)。$/u).exec(body);
  const bindAs = `${prefix}_field`, cards = binding(bindAs);
  if (self && sourceAvailable && fieldKinds.get(self[1]) === cardType && fieldTimings.has(timing)) {
    if (self[2] === "レストにする" || self[2] === "アクティブにする" || /^(このターン中|このバトル中|次の)/u.test(self[2])) {
      const action = fieldAction(self[2], timing, cards, sourceSpan, refinement);
      if (action) return { pattern: "recipe-self-field", actions: [{ type: "BIND_SOURCE", bindAs }, action] };
    }
    return null;
  }
  const form = (refinement && /^(.+枚まで)は、?(.+)。$/u.exec(body)) || /^(.+)を、?(.+)。$/u.exec(body);
  const leader = refinement && form && /^(自分|相手)のリーダー$/u.exec(form[1]);
  const target = form && (fieldTarget(form[1], expansion) ?? (leader ? {
    owner: seat(leader[1]), zones: ["leader"], min: 1, max: 1, excludeSource: false, filters: always()
  } : null));
  if (!target || target.excludeSource && (!sourceAvailable || cardType !== "character" || !fieldTimings.has(timing))) return null;
  const action = fieldAction(form[2], timing, cards, sourceSpan, refinement);
  if (!action || ["KO", "MOVE_CARD"].includes(action.type) && target.zones.includes("leader")) return null;
  const pick = draftSelect(bindAs, target.zones[0], target.owner, target.min ?? 0, target.max, target.filters);
  Object.assign(pick.selector, { cardTypes: target.zones, excludeSource: target.excludeSource,
    zone: target.zones.length === 1 ? target.zones[0] : target.zones });
  return { pattern: "recipe-filtered-field", actions: [pick, action],
    movesSource: cardType === "character" && target.zones.includes("character") &&
      target.owner === "SELF" && !target.excludeSource && ["KO", "MOVE_CARD"].includes(action.type) };
}

function extraRecipe(body, timing, cardType, prefix, sourceSpan, eventMain, sourceAvailable, expansion, refinement) {
  const don = /^自分の(レストの|アクティブの)?ドン(?:[!！]{2}|‼)([1-9]|10)枚までを、?(アクティブ|レスト)にする。$/u.exec(body);
  if (don && !eventMain) {
    const to = don[3] === "アクティブ" ? "ACTIVE" : "REST", from = to === "ACTIVE" ? "REST" : "ACTIVE";
    if (don[1] && (don[1] === "レストの") !== (from === "REST")) return null;
    const chosen = `${prefix}_don`;
    return { pattern: "recipe-don-state", actions: [selectDon(chosen, from, Number(don[2])),
      { type: "SET_DON_STATE", cards: binding(chosen), from, to, sourceSpan }] };
  }
  const attach = /^この(キャラ|リーダー)に、?(レスト|アクティブ)のドン(?:[!！]{2}|‼)([1-9]|10)枚までを、?付与する。$/u.exec(body);
  if (attach && sourceAvailable && fieldKinds.get(attach[1]) === cardType && fieldTimings.has(timing)) {
    const target = `${prefix}_target`, chosen = `${prefix}_don`, from = attach[2] === "レスト" ? "REST" : "ACTIVE";
    return { pattern: "recipe-don-source-attachment", actions: [{ type: "BIND_SOURCE", bindAs: target },
      selectDon(chosen, from, Number(attach[3])),
      { type: "ATTACH_DON", from, assignments: [{ cards: binding(chosen), target: binding(target) }], sourceSpan }] };
  }
  const recovery = /^自分のトラッシュから(.+?)([1-9])枚までを、?手札に加える。$/u.exec(body);
  const recovered = !eventMain && recovery && searchTarget(recovery[1], true, expansion);
  if (recovered) {
    const chosen = `${prefix}_recovered`, pick = draftSelect(chosen, "trash", "SELF", 0, Number(recovery[2]), recovered.filters);
    pick.selector.cardTypes = recovered.kinds;
    return { pattern: "recipe-trash-recovery", actions: [pick, { type: "MOVE_CARD", cards: binding(chosen),
      destination: { owner: "SELF", zone: "hand", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan }] };
  }
  const life = /^(自分|相手)のライフの(上|下)から1枚を、?(手札に加える|トラッシュに置く|デッキの下に置く)。$/u.exec(body);
  const heal = /^自分のデッキの上から1枚を、?ライフの(上|下)に(表向きで|裏向きで)?加える。$/u.exec(body);
  if (!eventMain && (life || heal)) return { pattern: "recipe-life-edge", actions: [{ type: "MOVE_LIFE", player: life?.[1] === "相手" ? "OPPONENT" : "SELF",
    ...(life ? { from: life[2] === "上" ? "LIFE_TOP" : "LIFE_BOTTOM",
      to: { "手札に加える": "HAND", "トラッシュに置く": "TRASH", "デッキの下に置く": "DECK_BOTTOM" }[life[3]] }
      : { from: "DECK_TOP", to: heal[1] === "上" ? "LIFE_TOP" : "LIFE_BOTTOM", faceUp: heal[2] === "表向きで" }), sourceSpan }] };
  return targetedField(body, timing, cardType, prefix, sourceSpan, sourceAvailable, expansion, refinement);
}

function privateMovement(body, prefix, sourceSpan) {
  const reveal = /^自分の手札から(.+?)1枚までを公開し、ライフの(上|下)に(表向き|裏向き)で加える。$/u.exec(body);
  const revealed = reveal && searchTarget(reveal[1], true, true);
  if (revealed) {
    const bindAs = `${prefix}_revealed_life`, cards = binding(bindAs);
    const pick = draftSelect(bindAs, "hand", "SELF", 0, 1, revealed.filters, { visibility: "OWNER_ONLY" });
    pick.selector.cardTypes = revealed.kinds;
    return { pattern: "recipe-hand-reveal-life", actions: [pick, { type: "REVEAL", cards, viewers: "BOTH", sourceSpan },
      { type: "MOVE_LIFE", player: "SELF", from: "BOUND", to: reveal[2] === "上" ? "LIFE_TOP" : "LIFE_BOTTOM",
        faceUp: reveal[3] === "表向き", cards, sourceSpan }] };
  }
  const fromLife = /^(自分|相手)のライフの(上|下)から1枚までを、?(?:(?:持ち主の)?手札に加える|トラッシュに置く)。$/u.exec(body);
  const fromDeck = /^自分のデッキの上から1枚までを、?ライフの(上|下)に(表向きで|裏向きで)?加える。$/u.exec(body);
  if (fromLife || fromDeck) {
    const player = fromLife ? seat(fromLife[1]) : "SELF";
    const move = { type: "MOVE_LIFE", player, sourceSpan, ...(fromLife ? {
      from: fromLife[2] === "上" ? "LIFE_TOP" : "LIFE_BOTTOM", to: body.endsWith("手札に加える。") ? "HAND" : "TRASH"
    } : { from: "DECK_TOP", to: fromDeck[1] === "上" ? "LIFE_TOP" : "LIFE_BOTTOM", faceUp: fromDeck[2] === "表向きで" }) };
    const choice = { type: "CHOOSE_MODE", modes: [
      { label: "1枚移動", actions: [move] },
      { label: "移動しない", actions: [{ type: "IF", condition: always(), then: [], else: [] }] }
    ] };
    return { pattern: "recipe-optional-life-edge", actions: [fromLife ? { type: "IF",
      condition: { type: "compare", left: { ref: `${player}.lifeCount` }, op: "gte", right: 1 }, then: [choice], else: [] } : choice] };
  }
  const hand = /^自分の手札1枚(まで)?を、?(?:自分の)?デッキの(上|下)に置く。$/u.exec(body);
  if (!hand) return null;
  const chosen = `${prefix}_hand_to_deck`, min = hand[1] ? 0 : 1;
  const actions = [draftSelect(chosen, "hand", "SELF", min, 1, always(), { visibility: "OWNER_ONLY" }),
    { type: "MOVE_CARD", cards: binding(chosen), destination: { owner: "SELF", zone: "deck", position: hand[2] === "上" ? "top" : "bottom",
      faceUp: false }, cause: "EFFECT", sourceSpan }];
  return { pattern: "recipe-own-hand-deck", actions: min ? [{ type: "IF",
    condition: { type: "compare", left: { ref: "SELF.handCount" }, op: "gte", right: 1 }, then: actions, else: [] }] : actions };
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

function publicCondition(text, batch, expansion = false, refinement = false) {
  const prior = predicate(text);
  if (prior || !batch) return prior;
  const and = text.split(/でかつ、|かつ、|かつ/u), or = text.split("または");
  if (and.length > 1 && or.length > 1) return null;
  const terms = and.length > 1 ? and : or;
  if (terms.length > 1) {
    if (terms.length > 3) return null;
    const conditions = terms.map(term => publicCondition(term, true, expansion, refinement));
    return conditions.every(Boolean) ? { type: and.length > 1 ? "all" : "any", conditions } : null;
  }
  const leader = /^(自分|相手)のリーダーが特徴(《[^《》]+》(か《[^《》]+》){0,2})を持つか「([^「」]+)」$/u.exec(text);
  if (leader) {
    const trait = predicate(`${leader[1]}のリーダーが特徴${leader[2]}を持つ`);
    const name = predicate(`${leader[1]}のリーダーが「${leader[4]}」`);
    return trait && name ? { type: "any", conditions: [trait, name] } : null;
  }
  if (/^(自分|相手)の(ライフ|手札)が[0-9]+枚(以上|以下)ある$/u.test(text)) return predicate(text.slice(0, -2));
  if (expansion) {
    if (refinement) {
      const combined = /^((?:自分|相手)のリーダーが『[^『』]+』を含む特徴を)持ち、((?:自分|相手)の.+)$/u.exec(text);
      if (combined) {
        const conditions = [`${combined[1]}持つ`, combined[2]].map(term => publicCondition(term, true, true, true));
        return conditions.every(Boolean) ? { type: "all", conditions } : null;
      }
      const don = /^(自分|相手)の(アクティブ|レスト)のドン(?:[!！]{2}|‼)が(0|[1-9]|10)枚(以上|以下)(?:ある)?$/u.exec(text);
      if (don) return { type: "compare", left: { ref: `${seat(don[1])}.don.${don[2] === "アクティブ" ? "activeCount" : "restCount"}` },
        op: don[4] === "以上" ? "gte" : "lte", right: Number(don[3]) };
      const state = /^(自分|相手)のリーダーが(アクティブ|レスト)$/u.exec(text);
      if (state) return { type: "EXISTS", query: query(seat(state[1]), "leader", ["leader"],
        { type: "compare", left: { ref: "CANDIDATE.rotated" }, op: "eq", right: state[2] === "レスト" }) };
      const other = /^自分のキャラの他の「([^「」]+)」がいない$/u.exec(text);
      if (other) return { type: "not", condition: { type: "EXISTS",
        query: query("SELF", "character", ["character"], nameFilter(other[1], "eq"), true) } };
      const alternatives = /^(自分|相手)のリーダーが(「[^「」]+」(?:か「[^「」]+」){1,3}|「[^「」]+」か特徴《[^《》]+》を持つ)$/u.exec(text);
      if (alternatives) return { type: "any", conditions: alternatives[2].split(/(?<=」)か/u)
        .map(term => predicate(`${alternatives[1]}のリーダーが${term}`)) };
    }
    const leaderContains = /^(自分|相手)のリーダーが『([^『』]+)』を含む特徴を持つ$/u.exec(text);
    if (leaderContains) return { type: "EXISTS", query: query(seat(leaderContains[1]), "leader", ["leader"],
      metadata("traits", "CONTAINS", [leaderContains[2]])) };
    const has = /^(自分|相手)の(レストの|アクティブの)?(.*?)キャラが(?:(0|[1-9][0-9]?)枚(以上|以下)?(いる|いない)?|(いる|いない))$/u.exec(text);
    if (has && (!has[4] || has[6] !== "いない")) {
      const target = searchTarget(`${has[3]}キャラカード`, true);
      if (!target) return null;
      if (has[2]) target.filters.conditions.push({ type: "compare", left: { ref: "CANDIDATE.rotated" }, op: "eq", right: has[2] === "レストの" });
      const matching = query(seat(has[1]), "character", ["character"], target.filters);
      if (has[4]) return { type: "COUNT", query: matching, op: has[5] === "以上" ? "gte" : has[5] === "以下" ? "lte" : "eq", value: Number(has[4]) };
      const exists = { type: "EXISTS", query: matching };
      return has[7] === "いる" ? exists : { type: "not", condition: exists };
    }
  }
  const count = /^(自分|相手)の(キャラ|トラッシュ)が(0|[1-9][0-9]?)枚(以上|以下)?(?:いる|ある)?$/u.exec(text);
  if (!count) return null;
  const owner = count[1] === "自分" ? "SELF" : "OPPONENT", character = count[2] === "キャラ";
  return { type: "COUNT", op: count[4] === "以上" ? "gte" : count[4] === "以下" ? "lte" : "eq", value: Number(count[3]),
    query: { type: "QUERY_CARDS", owner, controller: owner, zone: character ? "character" : "trash",
      cardTypes: character ? ["character"] : mainDeckKinds, visibility: "PUBLIC", faceUpOnly: true, excludeSource: false, filters: always() } };
}

function leadingCondition(text, batch, expansion = false, refinement = false) {
  const clause = /^([^。]+?)(?:の)?場合、/u.exec(text);
  if (!clause) return { body: text };
  const prior = predicate(clause[1]);
  return { body: text.slice(clause[0].length), condition: prior ?? publicCondition(clause[1], batch, expansion, refinement), newCondition: !prior };
}

export function parseContinuousRecipe(text, cardType, sourceSpan) {
  if (!["leader", "character", "stage"].includes(cardType)) return null;
  const turn = /^(?:【(自分|相手)のターン中】|〖(自分|相手)のターン中〗)/u.exec(text);
  const step = leadingCondition(turn ? text.slice(turn[0].length) : text, true, true);
  if (step.condition === null) return null;
  const form = /^(?:(自分|相手)のキャラすべてを、?|(自分のリーダー|このリーダー)の)(パワー|コスト)([+-][1-9][0-9]{0,4})。$/u.exec(step.body);
  if (!form || form[2] === "このリーダー" && cardType !== "leader" || form[2] && form[3] !== "パワー") return null;
  const guards = [];
  if (turn) guards.push({ type: "TURN_IS", player: seat(turn[1] ?? turn[2]) });
  if (step.condition) {
    const condition = step.condition;
    if (condition.type !== "compare" || !/^(SELF|OPPONENT)\.(lifeCount|handCount)$/u.test(condition.left?.ref) ||
        typeof condition.right !== "number") return null;
    guards.push(condition);
  }
  const zone = form[2] ? "leader" : "character";
  return { type: "CONTINUOUS_EFFECT", condition: { type: "all", conditions: guards },
    affectedQuery: query(form[2] ? "SELF" : seat(form[1]), zone, [zone], always()),
    operation: { type: "ADD_STAT", stat: form[3] === "パワー" ? "power" : "cost", amount: Number(form[4]) }, sourceSpan };
}

export function parseDraftMode(header, modes) {
  const { body, condition } = leadingCondition(header, true);
  if (body !== "以下から1つを選ぶ。" || condition === null) return null;
  const action = { type: "CHOOSE_MODE", modes };
  return condition ? [{ type: "IF", condition, then: [action], else: [] }] : [action];
}

export function parseExistingRecipes(body, timing, cardType, sourceSpan, { batch = false, sourceAvailable = true, expansion = false, refinement = false } = {}) {
  const checksSource = condition => condition && (condition.query?.excludeSource || condition.conditions?.some(checksSource) || checksSource(condition.condition));
  const validCondition = condition => condition !== null && (!checksSource(condition) ||
    cardType === "character" && fieldTimings.has(timing) && sourceAvailable);
  const initial = leadingCondition(body, batch, expansion, refinement);
  if (!validCondition(initial.condition)) return null;
  const ordered = refinement ? initial.body.replace(/^(カード(?:[1-9]|[1-4][0-9]|50)枚を引)き、(?=自分の手札1枚(?:まで)?を、?(?:自分の)?デッキの(?:上|下)に置く。)/u, "$1く。その後、") : initial.body;
  const parts = ordered.split("。その後、");
  if (parts.length > 6) return null;
  const actions = [], patterns = new Set();
  const eventMain = cardType === "event" && timing === "MAIN";
  for (let i = 0; i < parts.length; i++) {
    const prefix = `recipe_${sourceSpan.start}_${i}`, step = i === 0 ? { body: parts[i] } :
      leadingCondition(parts[i], batch, expansion, refinement);
    if (!validCondition(step.condition)) return null;
    const sentence = i === parts.length - 1 ? step.body : `${step.body}。`;
    let parsed = !eventMain && (search(sentence, prefix, sourceSpan, batch, expansion, refinement) || reorder(sentence, prefix, sourceSpan) || attach(sentence, prefix, sourceSpan, batch));
    const following = parts[i + 1]?.replace(/。$/u, "");
    if (!parsed && !eventMain && (following === remainder || refinement && following && remainderChoice.test(following))) {
      parsed = search(`${sentence}その後、${following}。`, prefix, sourceSpan, batch, expansion, refinement);
      if (parsed) i++;
    }
    const structure = parsed ? null : parseV3Structure(sentence, timing, predicate).structure;
    parsed ||= ownerHand(sentence, sourceSpan);
    if (!parsed && !structure && batch) parsed = extraRecipe(sentence, timing, cardType, prefix, sourceSpan, eventMain, sourceAvailable, expansion, refinement);
    if (!parsed && !structure && expansion) parsed = additionalField(sentence, cardType, prefix, sourceSpan);
    if (!parsed && !structure && refinement && !eventMain) parsed = privateMovement(sentence, prefix, sourceSpan);
    if (!parsed && !structure) return null;
    if (parsed) patterns.add(parsed.pattern);
    if (initial.newCondition || step.newCondition) patterns.add("recipe-public-condition");
    const next = parsed?.actions ?? emitV3Structure(structure, sourceSpan, true, prefix);
    actions.push(...(step.condition ? [{ type: "IF", condition: step.condition, then: next, else: [] }] : next));
    if (batch && (parsed?.movesSource || cardType === "character" && structure?.operations.some(node =>
      node.kind === "owner-move" && node.target.controller !== "OPPONENT"))) sourceAvailable = false;
  }
  if (!patterns.size) return null;
  return { pattern: [...patterns][0], actions: initial.condition ?
    [{ type: "IF", condition: initial.condition, then: actions, else: [] }] : actions };
}
