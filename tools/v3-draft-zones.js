import { parseCompoundEffect } from "./v3-draft-compound.js";
import { parseCompletionEffect, normalizeGrammar } from "./v3-draft-completion.js";
import { parseExistingRecipes, searchTarget } from "./v3-draft-recipes.js";
import { draftSelect } from "./v3-draft-structure.js";
import { parsePublicCondition } from "./v3-trigger-self-play.js";

const always = () => ({ type: "all", conditions: [] });
const legacy = (body, timing, kind, span) => parseCompoundEffect(body, timing, kind, span, false, true, true, null, true, true) ??
  parseCompletionEffect(body, timing, kind, span);
const hasAction = (actions, type) => actions.some(action => action.type === type ||
  action.type === "IF" && (hasAction(action.then, type) || hasAction(action.else, type)));

export function parseZoneContinuous(raw, cardType, sourceSpan) {
  if (cardType !== "character" && cardType !== "leader") return null;
  const attachment = parseAttachedPrefix(raw);
  let text = attachment ? attachment.body : normalizeGrammar(raw);
  const conditions = attachment ? [attachment.condition] : [];
  const turn = /^(?:【(自分|相手)のターン中】|〖(自分|相手)のターン中〗)/u.exec(text);
  if (turn) {
    conditions.push({ type: "TURN_IS", player: (turn[1] ?? turn[2]) === "自分" ? "SELF" : "OPPONENT" });
    text = text.slice(turn[0].length);
  }
  const guard = /^([^。:：]+?)(?:の)?場合、(.+)$/u.exec(text);
  if (guard) {
    const condition = parsePublicCondition(guard[1], true);
    // Avoid derived-stat dependency cycles and current-to-printed rewrites.
    if (!condition || condition.type !== "compare" || !/^(SELF|OPPONENT)\.(lifeCount|handCount)$/u.test(condition.left?.ref)) return null;
    conditions.push(condition); text = guard[2];
  }
  const kind = cardType === "character" ? "キャラ" : "リーダー";
  const stat = new RegExp(`^この${kind}(?:の|は)(パワー|コスト)([+-][1-9][0-9]{0,4})。$`, "u").exec(text);
  const keyword = new RegExp(`^この${kind}は(?:【(速攻|速攻：キャラ|ブロッカー|ダブルアタック|バニッシュ|ブロック不可)】|〖(速攻|速攻：キャラ|ブロッカー|ダブルアタック|バニッシュ|ブロック不可)〗)を得る。$`, "u").exec(text);
  const protection = new RegExp(`^この${kind}は(相手の)?効果でKOされない。$`, "u").exec(text);
  if (!stat && !keyword && !protection || stat?.[1] === "コスト" && cardType === "leader" || protection && cardType !== "character") return null;
  const ability = keyword && (keyword[1] ?? keyword[2]);
  const operation = stat ? { type: "ADD_STAT", stat: stat[1] === "パワー" ? "power" : "cost", amount: Number(stat[2]) } :
    keyword ? { type: "GRANT_KEYWORD", keyword: { type: { "速攻": "RUSH", "速攻：キャラ": "RUSH_CHARACTER", "ブロッカー": "BLOCKER",
      "ダブルアタック": "DOUBLE_ATTACK", "バニッシュ": "BANISH", "ブロック不可": "CANNOT_BE_BLOCKED" }[ability] } } :
      { type: "RESTRICT", policy: "CANNOT_KO", by: protection[1] ? "OPPONENT" : "ANY", cause: "EFFECT" };
  return { pattern: "zone-source-continuous", continuous: {
    type: "CONTINUOUS_EFFECT", sourceSpan, condition: { type: "all", conditions }, operation,
    affectedQuery: { type: "QUERY_CARDS", owner: "SELF", controller: "SELF", zone: cardType, cardTypes: [cardType],
      visibility: "PUBLIC", faceUpOnly: true, excludeSource: false, filters: { type: "IS_SOURCE" } }
  } };
}

export function parseZoneEffect(raw, timing, cardType, sourceSpan) {
  const text = normalizeGrammar(raw);
  const paid = /^([^。:：]+)[:：](.+)$/u.exec(text);
  if (paid && cardType !== "event") {
    const declaration = legacy(`${paid[1]}：カード1枚を引く。`, timing, cardType, sourceSpan);
    const effect = declaration?.costs?.length && parseZoneEffect(paid[2], timing, cardType, sourceSpan);
    if (effect) return { ...effect, costs: declaration.costs, optional: declaration.optional ?? timing !== "MAIN",
      ...(declaration.usageLimit ? { usageLimit: declaration.usageLimit } : {}) };
    return null;
  }
  const once = /^(?:【ターン[1１]回】|〖ターン[1１]回〗)(.+)$/u.exec(text);
  if (once && timing === "MAIN" && cardType !== "event") {
    const effect = parseZoneEffect(once[1], timing, cardType, sourceSpan);
    return effect ? { ...effect, usageLimit: { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 } } : null;
  }
  const guard = /^([^。:：]+?)(?:の)?場合、(.+)$/u.exec(text);
  const condition = guard ? parsePublicCondition(guard[1], true) : null;
  if (guard && !condition) return null;
  const wrap = actions => condition ? [{ type: "IF", condition, then: actions, else: [] }] : actions;
  const body = guard ? guard[2] : text;
  if (cardType === "event" && timing === "MAIN") {
    // Reuse the search grammar; the compiler authorizes each emitted node.
    const search = parseExistingRecipes(body, timing, "stage", sourceSpan, { batch: true, expansion: true, refinement: true });
    if (search && hasAction(search.actions, "LOOK_TOP"))
      return { ...search, actions: wrap(search.actions), pattern: "zone-private-event-main" };
  }
  const parts = body.split("。その後、");
  if (parts.length === 2) {
    const secondSpan = { ...sourceSpan, start: sourceSpan.end - parts[1].length };
    const firstSpan = { ...sourceSpan, end: secondSpan.start };
    const first = legacy(parts[0] + "。", timing, cardType, firstSpan) ?? parseZoneEffect(parts[0] + "。", timing, cardType, firstSpan);
    const second = parseZoneEffect(parts[1], timing, cardType, secondSpan) ?? legacy(parts[1], timing, cardType, secondSpan);
    if (first && second && !first.costs && !second.costs && !first.usageLimit && !second.usageLimit &&
        (first.pattern.startsWith("zone-") || second.pattern.startsWith("zone-")) &&
        !JSON.stringify(second.actions).includes("SOURCE.") && !hasAction(second.actions, "BIND_SOURCE"))
      return { pattern: first.pattern.startsWith("zone-") ? first.pattern : second.pattern, actions: wrap([...first.actions, ...second.actions]) };
  }
  const mill = /^自分のデッキの上から([1-9]|[1-4][0-9]|50)枚を、?トラッシュに置(?:く。(?:その後、(.+))?|き、(.+))$/u.exec(body);
  if (mill) {
    const follow = mill[2] ?? mill[3], next = follow && legacy(follow, timing, cardType, sourceSpan);
    if (follow && (!next || next.costs || next.usageLimit)) return null;
    return { pattern: "zone-trash-deck-top", actions: wrap([{ type: "TRASH_DECK_TOP", count: Number(mill[1]), sourceSpan }, ...(next?.actions ?? [])]) };
  }
  const play = /^自分の(手札|トラッシュ)から、?(.+?)1枚までを、?(レストで|アクティブで)?登場させる。(?:その後、(.+))?$/u.exec(body);
  if (!play) return null;
  const named = /^「[^「」\r\n]+」$/u.test(play[2]);
  // Only characters can enter this destination, even if the text specifies only a name.
  const target = searchTarget(named ? `${play[2]}のキャラカード` : play[2], true, true);
  if (!target || target.kinds.length !== 1 || target.kinds[0] !== "character") return null;
  const after = play[4] && legacy(play[4], timing, cardType, sourceSpan);
  if (play[4] && (!after || after.costs || after.usageLimit)) return null;
  const from = play[1] === "手札" ? "hand" : "trash", bindAs = `zone_play_${sourceSpan.start}`;
  const pick = draftSelect(bindAs, from, "SELF", 0, 1, target.filters, { visibility: from === "hand" ? "OWNER_ONLY" : "PUBLIC" });
  pick.selector.cardTypes = ["character"];
  return { pattern: from === "hand" ? "zone-effect-play-full" : "zone-effect-play-trash", actions: wrap([pick,
    { type: "PLAY_BY_EFFECT", cards: { ref: `bindings.${bindAs}` }, from,
      destination: { owner: "SELF", zone: "character", slotPolicy: "REPLACE_IF_FULL" }, enterState: play[3] === "レストで" ? "REST" : "ACTIVE",
      provenance: "EFFECT", condition: always(), sourceSpan }, ...(after?.actions ?? [])]) };
}

export function parseAttachedPrefix(text) {
  const match = /^(?:【ドン(?:[!！]{2}|‼)×([1-9]|10)】|〖ドン(?:[!！]{2}|‼)×([1-9]|10)〗)(.+)$/u.exec(normalizeGrammar(text));
  return match && { body: match[3], condition: { type: "compare", left: { ref: "SOURCE.attachedDonCount" }, op: "gte", right: Number(match[1] ?? match[2]) } };
}
