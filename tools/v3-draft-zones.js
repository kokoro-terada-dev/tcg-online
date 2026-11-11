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
const needsDeltaProfile = new Set(["zone-deck-play", "zone-event-main-payment", "zone-auto-field-stat", "zone-effect-play-batch"]);
function mixedTraitTarget(text) {
  const form = /^(.*?)特徴《([^《》]+)》か『([^『』]+)』を含む特徴を持つキャラカード$/u.exec(text);
  if (!form) return null;
  const prefix = form[1].replace(/、$/u, "");
  const exact = searchTarget(`${prefix}特徴《${form[2]}》を持つキャラカード`, true, true);
  const partial = searchTarget(`${prefix}『${form[3]}』を含む特徴を持つキャラカード`, true, true);
  return exact && partial ? { kinds: ["character"], filters: { type: "any", conditions: [exact.filters, partial.filters] } } : null;
}

export function parseZoneContinuous(raw, cardType, sourceSpan, delta = false) {
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
  let extended = false;
  if (guard) {
    const condition = parsePublicCondition(guard[1], true) ?? (delta ? parseJoinedGuard(guard[1]) ?? parseDeltaGuard(guard[1]) : null);
    extended = condition?.type !== "compare" || !/^(SELF|OPPONENT)\.(lifeCount|handCount)$/u.test(condition.left?.ref);
    // Only parsed player counts and field metadata; never rewrite current stats as printed stats.
    if (!condition || extended && !delta) return null;
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
  return { pattern: extended ? "zone-continuous-stable-guard" : "zone-source-continuous", continuous: {
    type: "CONTINUOUS_EFFECT", sourceSpan, condition: { type: "all", conditions }, operation,
    affectedQuery: { type: "QUERY_CARDS", owner: "SELF", controller: "SELF", zone: cardType, cardTypes: [cardType],
      visibility: "PUBLIC", faceUpOnly: true, excludeSource: false, filters: { type: "IS_SOURCE" } }
  } };
}

export function parseZoneEffect(raw, timing, cardType, sourceSpan, delta = false) {
  const normalized = normalizeGrammar(raw);
  const text = delta ? normalized.replaceAll("次の相手のエンドフェイズ終了時まで", "次の相手のターン終了時まで")
    .replace(/((?:手札|ライフ)が[0-9]+枚(?:以上|以下))ある場合、/gu, "$1の場合、")
    .replace(/((?:パワー|コスト)[0-9]+(?:以下|以上)の|特徴《[^《》]+》を持つ|属性\([^()]+\)を持つ)、(?=(?:リーダー|キャラ|特徴|属性))/gu, "$1") : normalized;
  if (delta && timing === "COUNTER" && cardType === "event") {
    const payment = /^自分の手札([1-3])枚を捨てることができる[:：](.+)$/u.exec(text);
    if (payment) {
      const follow = legacy(payment[2], timing, cardType, sourceSpan) ?? parseZoneEffect(payment[2], timing, cardType, sourceSpan, true);
      if (!follow || follow.costs || follow.usageLimit) return null;
      const bindAs = `counter_payment_${sourceSpan.start}`;
      return { pattern: needsDeltaProfile.has(follow.pattern) ? follow.pattern : "zone-counter-hand-payment", actions: [
        { type: "OFFER_PAYMENT", costs: [{ type: "DISCARD_HAND", count: Number(payment[1]) }], bindAs, sourceSpan },
        { type: "IF_PAYMENT_SUCCEEDED", payment: bindAs, then: follow.actions, else: [] }
      ] };
    }
  }
  if (delta && timing === "MAIN" && cardType === "event") {
    const payment = /^自分の(?:アクティブの)?ドン(?:[!！]{2}|‼)([1-9]|10)枚をレストに(?:できる|し、自分の手札([1-3])枚を捨てることができる)[:：](.+)$/u.exec(text);
    const returned = /^(?:ドン(?:[!！]{2}|‼)[-−－]([1-9]|10)|自分のアクティブのドン(?:[!！]{2}|‼)([1-9]|10)枚をドン(?:[!！]{2}|‼)デッキに戻すことができる)[:：](.+)$/u.exec(text);
    if (payment || returned) {
      const body = (payment ?? returned)[3];
      const follow = parseZoneEffect(body, timing, cardType, sourceSpan, true) ?? legacy(body, timing, cardType, sourceSpan);
      if (!follow || follow.costs || follow.usageLimit || follow.optional) return null;
      const costs = payment ? [{ type: "REST_DON", count: Number(payment[1]) },
        ...(payment[2] ? [{ type: "DISCARD_HAND", count: Number(payment[2]) }] : [])] :
        [{ type: "DON_RETURN", count: Number(returned[1] ?? returned[2]), from: returned[1] ? ["activeDon", "restDon", "attachedDon"] : ["activeDon"] }];
      const bindAs = `main_payment_${sourceSpan.start}`;
      return { pattern: "zone-event-main-payment", actions: [
        { type: "OFFER_PAYMENT", costs, bindAs, sourceSpan },
        { type: "IF_PAYMENT_SUCCEEDED", payment: bindAs, then: follow.actions, else: [] }
      ] };
    }
  }
  const paid = /^([^。:：]+)[:：](.+)$/u.exec(text);
  if (paid && cardType !== "event") {
    const rest = delta && /^自分の(?:アクティブの)?ドン(?:[!！]{2}|‼)([1-9]|10)枚(とこの(キャラ|ステージ|リーダー))?をレストにできる$/u.exec(paid[1]);
    const sourceKind = rest && { キャラ: "character", ステージ: "stage", リーダー: "leader" }[rest[3]];
    const exact = rest && (!rest[2] || sourceKind === cardType) && ["MAIN", "ON_PLAY", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK", "TURN_END"].includes(timing);
    const restAndTrash = delta && cardType === "character" && timing === "ON_OPPONENT_ATTACK" &&
      /^自分のドン(?:[!！]{2}|‼)([1-9]|10)枚をレストにし、このキャラをトラッシュに置くことができる$/u.exec(paid[1]);
    const declaration = legacy(`${paid[1]}：カード1枚を引く。`, timing, cardType, sourceSpan) ??
      (exact ? { costs: [{ type: "REST_DON", count: Number(rest[1]) }, ...(rest[2] ? [{ type: "REST_SOURCE" }] : [])] } :
        restAndTrash ? { costs: [{ type: "REST_DON", count: Number(restAndTrash[1]) },
          { type: "MOVE_AS_COST", selector: "SOURCE", destination: "trash" }] } : null);
    const effect = declaration?.costs?.length && (parseZoneEffect(paid[2], timing, cardType, sourceSpan, delta) ??
      (delta ? legacy(paid[2], timing, cardType, sourceSpan) : null));
    if (effect && (!delta || !effect.costs && !effect.usageLimit && !effect.optional &&
        (!restAndTrash || !JSON.stringify(effect.actions).includes("SOURCE.") && !hasAction(effect.actions, "BIND_SOURCE")))) return { ...effect, costs: declaration.costs, optional: declaration.optional ?? timing !== "MAIN",
      ...(declaration.usageLimit ? { usageLimit: declaration.usageLimit } : {}) };
    return null;
  }
  const once = /^(?:【ターン[1１]回】|〖ターン[1１]回〗)(.+)$/u.exec(text);
  if (once && (timing === "MAIN" || delta && ["ON_PLAY", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK", "TURN_END"].includes(timing)) && cardType !== "event") {
    const effect = parseZoneEffect(once[1], timing, cardType, sourceSpan, delta) ?? (delta ? legacy(once[1], timing, cardType, sourceSpan) : null);
    return effect ? { ...effect, usageLimit: { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 } } : null;
  }
  const guard = /^([^。:：]+?)(?:の)?場合、(.+)$/u.exec(text);
  const condition = guard ? (parsePublicCondition(guard[1], true) ?? (delta ? parseJoinedGuard(guard[1]) ?? parseDeltaGuard(guard[1]) : null)) : null;
  if (guard && !condition) return null;
  const wrap = actions => condition ? [{ type: "IF", condition, then: actions, else: [] }] : actions;
  const body = guard ? guard[2] : text;
  if (delta) {
    const allPrinted = /^(自分|相手)の元々の(パワー|コスト)([0-9]+)(以下|以上)のキャラすべてを、次の相手のターン終了時まで、(パワー|コスト)([+-][1-9][0-9]{0,4})。$/u.exec(body);
    if (allPrinted && timing === "MAIN" && Number.isSafeInteger(Number(allPrinted[3]))) {
      const bindAs = `all_field_${sourceSpan.start}`;
      const pick = draftSelect(bindAs, "character", allPrinted[1] === "自分" ? "SELF" : "OPPONENT", 0, 5, {
        type: "compare", left: { ref: `CANDIDATE.printed.${allPrinted[2] === "パワー" ? "power" : "cost"}` },
        op: allPrinted[4] === "以下" ? "lte" : "gte", right: Number(allPrinted[3])
      });
      return { pattern: "zone-auto-field-stat", actions: wrap([{ ...pick, automatic: "ALL" },
        { type: "MODIFY_STAT", cards: { ref: `bindings.${bindAs}` }, stat: allPrinted[5] === "パワー" ? "power" : "cost",
          amount: Number(allPrinted[6]), duration: { type: "TURN_END", player: "OPPONENT", occurrence: 1 }, sourceSpan }]) };
    }
    if (body === "お互いのライフの合計枚数以下のコストを持つ相手のキャラ1枚までを、レストにする。") {
      const bindAs = `life_total_target_${sourceSpan.start}`;
      return { pattern: "zone-life-total-target", actions: wrap([
        draftSelect(bindAs, "character", "OPPONENT", 0, 1, { type: "compare", left: { ref: "CANDIDATE.current.cost" },
          op: "lte", right: { ref: "BOTH.lifeCount" } }),
        { type: "REST", cards: { ref: `bindings.${bindAs}` }, sourceSpan }
      ]) };
    }
    if (body === "自分の手札1枚までを、ライフの上に加える。") {
      const bindAs = `hand_to_life_${sourceSpan.start}`;
      return { pattern: "zone-hand-to-life", actions: wrap([
        draftSelect(bindAs, "hand", "SELF", 0, 1, always(), { visibility: "OWNER_ONLY" }),
        { type: "MOVE_LIFE", player: "SELF", from: "BOUND", to: "LIFE_TOP", faceUp: false, cards: { ref: `bindings.${bindAs}` }, sourceSpan }
      ]) };
    }
    const traitLeader = /^自分の特徴《([^《》]+)》か《([^《》]+)》を持つリーダーを、このバトル中、パワー\+([1-9][0-9]{0,4})。$/u.exec(body);
    if (traitLeader && ["ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK", "COUNTER"].includes(timing) && traitLeader[1] !== traitLeader[2]) {
      const bindAs = `trait_leader_${sourceSpan.start}`;
      const pick = draftSelect(bindAs, "leader", "SELF", 1, 1, { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT",
        field: "traits", comparison: "EXACT", match: "ANY", values: [traitLeader[1], traitLeader[2]] });
      pick.selector.onInsufficient = "skip";
      return { pattern: "zone-trait-leader-battle-power", actions: wrap([pick,
        { type: "MODIFY_STAT", cards: { ref: `bindings.${bindAs}` }, stat: "power", amount: Number(traitLeader[3]),
          duration: { type: "BATTLE_END" }, sourceSpan }]) };
    }
    const operation = /^相手のコスト([0-9]{1,2})以下のキャラ1枚までを、?KOするか、レストにする。$/u.exec(body);
    if (operation) {
      const bindAs = `ko_or_rest_${sourceSpan.start}`, cards = { ref: `bindings.${bindAs}` };
      return { pattern: "zone-single-target-operation-mode", actions: wrap([
        draftSelect(bindAs, "character", "OPPONENT", 0, 1, { type: "compare", left: { ref: "CANDIDATE.current.cost" },
          op: "lte", right: Number(operation[1]) }),
        { type: "IF", condition: { type: "compare", left: { ref: `bindings.${bindAs}.count` }, op: "eq", right: 1 },
          then: [{ type: "CHOOSE_MODE", modes: [{ label: "KO", actions: [{ type: "KO", cards, sourceSpan }] },
            { label: "レスト", actions: [{ type: "REST", cards, sourceSpan }] }] }], else: [] }
      ]) };
    }
    const typed = /^(自分|相手)の(.+?)(リーダーかキャラ|キャラ)([1-5])枚まで(?:を|は)、?(.+)$/u.exec(body);
    if (typed) {
      const prefix = typed[2].replace(/^(特徴《[^《》]+》)と((?:【トリガー】|〖トリガー〗))を両方持つ$/u, "$1を持つ$2を持つ");
      const target = searchTarget(prefix + "キャラカード", true, true) ?? mixedTraitTarget(prefix + "キャラカード");
      const generic = target && legacy(`${typed[1]}の${typed[3]}${typed[4]}枚までを、${typed[5]}`, timing, cardType, sourceSpan);
      if (generic?.actions[0]?.type === "SELECT" && !generic.costs && !generic.usageLimit &&
          (typed[3] === "キャラ" || target.filters.conditions.every(filter => !filter.left?.ref?.endsWith(".cost")))) {
        const [pick, ...actions] = generic.actions;
        return { pattern: "zone-explicit-field-filters", actions: wrap([{ ...pick, selector: { ...pick.selector, filters: target.filters } }, ...actions]) };
      }
      if (target && typed[3] === "キャラ" && /^このターン中、(?:【速攻】|〖速攻〗)を得る。$/u.test(typed[5])) {
        const bindAs = `field_rush_${sourceSpan.start}`, owner = typed[1] === "自分" ? "SELF" : "OPPONENT";
        const grant = player => ({ type: "GRANT_KEYWORD", cards: { ref: `bindings.${bindAs}` }, keyword: { type: "RUSH" },
          duration: { type: "TURN_END", player, occurrence: 1 }, sourceSpan });
        return { pattern: "zone-explicit-field-filters", actions: wrap([
          draftSelect(bindAs, "character", owner, 0, Number(typed[4]), target.filters),
          { type: "IF", condition: { type: "TURN_IS", player: "SELF" }, then: [grant("SELF")], else: [grant("OPPONENT")] }
        ]) };
      }
    }
    const leader = /^(自分|相手)のリーダー「([^「」]+)」(?:を|は)、?(.+)$/u.exec(body);
    if (leader) {
      const filter = { type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op: "eq", value: leader[2] };
      const keyword = /^このターン中、(?:【(ブロック不可)】|〖(ブロック不可)〗)を得る。$/u.exec(leader[3]);
      if (keyword) {
        const bindAs = `named_leader_${sourceSpan.start}`;
        const pick = draftSelect(bindAs, "leader", leader[1] === "自分" ? "SELF" : "OPPONENT", 1, 1, filter);
        pick.selector.onInsufficient = "skip";
        const grant = player => ({ type: "GRANT_KEYWORD", cards: { ref: `bindings.${bindAs}` }, keyword: { type: "CANNOT_BE_BLOCKED" },
          duration: { type: "TURN_END", player, occurrence: 1 }, sourceSpan });
        return { pattern: "zone-named-leader-effect", actions: wrap([pick, { type: "IF", condition: { type: "TURN_IS", player: "SELF" },
          then: [grant("SELF")], else: [grant("OPPONENT")] }]) };
      }
      const generic = legacy(`${leader[1]}のリーダーを、${leader[3]}`, timing, cardType, sourceSpan);
      if (generic?.actions[0]?.type === "SELECT" && !generic.costs && !generic.usageLimit) {
        const [pick, ...actions] = generic.actions;
        return { pattern: "zone-named-leader-effect", actions: wrap([{ ...pick, selector: { ...pick.selector, onInsufficient: "skip", filters: filter } }, ...actions]) };
      }
    }
    const attributeAttach = /^自分の属性\(([^()]+)\)か\(([^()]+)\)を持つ、?(リーダーかキャラ1枚)に、?((?:レスト|アクティブ)のドン(?:[!！]{2}|‼)(?:[1-9]|10)枚までを、?付与する。)$/u.exec(body);
    if (attributeAttach && attributeAttach[1] !== attributeAttach[2]) {
      const generic = legacy(`自分の${attributeAttach[3]}に${attributeAttach[4]}`, timing, cardType, sourceSpan);
      if (generic?.pattern === "recipe-don-attachment" && generic.actions[0]?.type === "SELECT") {
        const [pick, ...actions] = generic.actions;
        return { pattern: "zone-attribute-don-attachment", actions: wrap([{ ...pick, selector: { ...pick.selector, filters: {
          type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field: "attributes", comparison: "EXACT", match: "ANY",
          values: [attributeAttach[1], attributeAttach[2]]
        } } }, ...actions]) };
      }
    }
    const attach = /^自分のリーダー「([^「」]+)」に、?((?:レスト|アクティブ)のドン(?:[!！]{2}|‼)(?:[1-9]|10)枚までを、?付与する。)$/u.exec(body);
    if (attach) {
      const generic = legacy(`自分のリーダーに${attach[2]}`, timing, cardType, sourceSpan);
      if (generic?.pattern === "recipe-don-attachment" && generic.actions[0]?.type === "SELECT") {
        const [pick, ...actions] = generic.actions;
        return { pattern: "zone-named-leader-attachment", actions: wrap([{ ...pick, selector: { ...pick.selector, filters: {
          type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op: "eq", value: attach[1]
        } } }, ...actions]) };
      }
    }
    const continued = /^(.+残りを(?:好きな順番でデッキの下に|トラッシュに)置)き、(.+)$/u.exec(body);
    if (continued) {
      const first = parseZoneEffect(continued[1] + "く。", timing, cardType, sourceSpan, true);
      const nextSpan = { ...sourceSpan, start: sourceSpan.end - continued[2].length };
      const next = legacy(continued[2], timing, cardType, nextSpan) ?? parseZoneEffect(continued[2], timing, cardType, nextSpan, true);
      if (first?.pattern === "zone-deck-play" && next && !next.costs && !next.usageLimit && !next.optional &&
          !JSON.stringify(next.actions).includes("SOURCE.") && !hasAction(next.actions, "BIND_SOURCE"))
        return { pattern: first.pattern, actions: wrap([...first.actions, ...next.actions]) };
    }
    const namedStat = /^(自分|相手)の(キャラか)?「([^「」\r\n]+)」1枚までを、((?:このバトル中|このターン中)、パワー[+-][1-9][0-9]{0,4}。)$/u.exec(body);
    if (namedStat) {
      const generic = legacy(`${namedStat[1]}のリーダーかキャラ1枚までを、${namedStat[4]}`, timing, cardType, sourceSpan);
      const name = { type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op: "eq", value: namedStat[3] };
      if (generic?.actions[0]?.type === "SELECT" && !generic.costs && !generic.usageLimit) {
        const filters = namedStat[2] ? { type: "any", conditions: [
          { type: "compare", left: { ref: "CANDIDATE.cardType" }, op: "eq", right: "character" }, name] } : name;
        const [select, ...actions] = generic.actions;
        return { pattern: "zone-named-field-stat", actions: wrap([{ ...select, selector: { ...select.selector, filters } }, ...actions]) };
      }
    }
    const top = /^自分のデッキの上から([1-9])枚を見て、(.+?)(?:合計)?([1-9])枚までを、?(?:(レストで|アクティブで)?登場させ(?:る。その後、|、)|公開し、手札に加え(?:る。その後、|、))残りを(好きな順番でデッキの下に|トラッシュに)置く。$/u.exec(body);
    const whole = /^自分のデッキから、?(.+?)1枚までを、?(?:(レストで|アクティブで)?登場させ(?:る。その後、|、)|公開し、手札に加え(?:る。その後、|、))デッキをシャッフルする。$/u.exec(body);
    const recover = (top ?? whole)?.[0].includes("公開し、手札に加え");
    const trash = top?.[5] === "トラッシュに";
    const play = top ? { count: Number(top[1]), target: top[2], max: Number(top[3]), state: top[4] } :
      whole ? { count: 50, target: whole[1], max: 1, state: whole[2] } : null;
    if (play) {
      if (play.max > play.count || !recover && play.max !== 1) return null;
      const named = /「[^「」]+」$/u.test(play.target);
      const targetText = !recover && named ? `${play.target}のキャラカード` : play.target;
      const target = searchTarget(targetText, true, true) ?? searchTarget(targetText.replace(
        /^(「[^「」]+」以外の)?(特徴《[^《》]+》を持つ|『[^『』]+』を含む特徴を持つ)((?:コスト|パワー)[0-9]+(?:以下|以上)?の)(キャラカード)$/u,
        "$1$3$2$4"), true, true);
      if (!target || !recover && (target.kinds.length !== 1 || target.kinds[0] !== "character")) return null;
      const [seen, picked, ordered] = ["seen", "picked", "ordered"].map(key => `deck_play_${sourceSpan.start}_${key}`);
      const binding = key => ({ ref: `bindings.${key}` });
      return { pattern: "zone-deck-play", actions: wrap([
        { type: "LOOK_TOP", player: "SELF", count: play.count, bindAs: seen, onInsufficient: "takeAvailable", sourceSpan },
        { type: "SELECT", bindAs: picked, selector: { type: "BOUND_CARDS", cards: binding(seen), excludeCards: null,
          owner: "SELF", controller: "SELF", chooser: "SELF", zone: "deck", cardTypes: target.kinds, filters: target.filters,
          visibility: "OWNER_ONLY", faceUpOnly: false, excludeSource: false, min: 0, max: play.max, selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" } },
        ...(recover ? [{ type: "REVEAL", cards: binding(picked), viewers: "BOTH", sourceSpan },
          { type: "MOVE_CARD", cards: binding(picked), destination: { owner: "SELF", zone: "hand", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan }] :
          [{ type: "PLAY_BY_EFFECT", cards: binding(picked), from: "deck",
            destination: { owner: "SELF", zone: "character", slotPolicy: "REPLACE_IF_FULL" }, enterState: play.state === "レストで" ? "REST" : "ACTIVE",
            provenance: "EFFECT", condition: always(), sourceSpan }]),
        ...(whole ? [{ type: "SHUFFLE_DECK", sourceSpan }] : trash ?
          [{ type: "MOVE_CARD", cards: binding(seen), excludeCards: binding(picked),
            destination: { owner: "SELF", zone: "trash", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan }] :
          [{ type: "ORDER_CARDS", cards: binding(seen), excludeCards: binding(picked), bindAs: ordered, chooser: "SELF", sourceSpan },
            { type: "RETURN_TO_DECK", cards: binding(ordered), player: "SELF", position: "bottom", sourceSpan }])
      ]) };
    }
  }
  if (cardType === "event" && timing === "MAIN" || delta) {
    // Reuse the search grammar; the compiler authorizes each emitted node.
    const search = parseExistingRecipes(body, timing, cardType === "event" ? "stage" : cardType, sourceSpan, { batch: true, expansion: true, refinement: true });
    if (search && hasAction(search.actions, "LOOK_TOP"))
      return { ...search, actions: wrap(search.actions), pattern: "zone-private-event-main" };
  }
  if (delta) {
    const sequence = /^(.+残りを好きな順番でデッキの下に置)き、(自分の手札から.+登場させる。)$/u.exec(body);
    if (sequence) {
      const first = legacy(sequence[1] + "く。", timing, cardType, sourceSpan) ?? parseZoneEffect(sequence[1] + "く。", timing, cardType, sourceSpan, true);
      const second = parseZoneEffect(sequence[2], timing, cardType, sourceSpan, true);
      if (first && second && hasAction(first.actions, "LOOK_TOP") && second.pattern === "zone-effect-play-full" &&
          !first.costs && !first.usageLimit && !first.optional)
        return { pattern: needsDeltaProfile.has(first.pattern) ? first.pattern : "zone-search-then-hand-play", actions: wrap([...first.actions, ...second.actions]) };
    }
    const ordered = /^(カード[1-9][0-9]?枚を引)き、(.+)$/u.exec(body);
    if (ordered && !/そのカード|引いたカード|引いた枚数/u.test(ordered[2])) {
      const first = legacy(ordered[1] + "く。", timing, cardType, sourceSpan);
      const second = legacy(ordered[2], timing, cardType, sourceSpan) ?? parseZoneEffect(ordered[2], timing, cardType, sourceSpan, delta);
      if (first && second && !second.costs && !second.usageLimit && !second.optional)
        return { pattern: needsDeltaProfile.has(second.pattern) ? second.pattern : "zone-ordered-draw", actions: wrap([...first.actions, ...second.actions]) };
    }
    if (guard) {
      const guarded = legacy(body, timing, cardType, sourceSpan);
      if (guarded && !guarded.costs && !guarded.usageLimit && !guarded.optional)
        return { pattern: "zone-joined-guard", actions: wrap(guarded.actions) };
    }
  }
  const parts = body.split("。その後、");
  if (parts.length === 2) {
    const secondSpan = { ...sourceSpan, start: sourceSpan.end - parts[1].length };
    const firstSpan = { ...sourceSpan, end: secondSpan.start };
    const first = legacy(parts[0] + "。", timing, cardType, firstSpan) ?? parseZoneEffect(parts[0] + "。", timing, cardType, firstSpan, delta);
    const second = parseZoneEffect(parts[1], timing, cardType, secondSpan, delta) ?? legacy(parts[1], timing, cardType, secondSpan);
    if (first && second && !first.costs && !second.costs && !first.usageLimit && !second.usageLimit &&
        (first.pattern.startsWith("zone-") || second.pattern.startsWith("zone-")) &&
        !JSON.stringify(second.actions).includes("SOURCE.") && !hasAction(second.actions, "BIND_SOURCE"))
      return { pattern: needsDeltaProfile.has(second.pattern) || !first.pattern.startsWith("zone-") ? second.pattern : first.pattern,
        actions: wrap([...first.actions, ...second.actions]) };
  }
  const mill = /^自分のデッキの上から([1-9]|[1-4][0-9]|50)枚を、?トラッシュに置(?:く。(?:その後、(.+))?|き、(.+))$/u.exec(body);
  if (mill) {
    const follow = mill[2] ?? mill[3], next = follow && legacy(follow, timing, cardType, sourceSpan);
    if (follow && (!next || next.costs || next.usageLimit)) return null;
    return { pattern: "zone-trash-deck-top", actions: wrap([{ type: "TRASH_DECK_TOP", count: Number(mill[1]), sourceSpan }, ...(next?.actions ?? [])]) };
  }
  const play = /^自分の(手札|トラッシュ)から、?(.+?)([1-5])枚までを、?(レストで|アクティブで)?登場させる。(?:その後、(.+))?$/u.exec(body);
  if (!play) {
    const parsed = delta && text !== normalized && legacy(text, timing, cardType, sourceSpan);
    return parsed ? { ...parsed, pattern: "zone-end-phase-or-target-syntax" } : null;
  }
  const max = Number(play[3]);
  if (max > 1 && (delta !== "batch-play" || play[1] !== "手札")) return null;
  const named = (delta ? /「[^「」\r\n]+」$/u : /^「[^「」\r\n]+」$/u).test(play[2]);
  // Only characters can enter this destination, even if the text specifies only a name.
  const names = delta && /^(?:「[^「」]+」か){1,4}「[^「」]+」$/u.test(play[2]) &&
    [...play[2].matchAll(/「([^「」]+)」/gu)].map(match => match[1]);
  const target = names ? { kinds: ["character"], filters: { type: "any", conditions: names.map(value => ({
    type: "CARD_NAME", subject: "CANDIDATE", basis: "CURRENT", op: "eq", value
  })) } } : searchTarget(named ? `${play[2]}のキャラカード` : play[2], true, true) ?? (delta ? mixedTraitTarget(play[2]) : null);
  if (!target || target.kinds.length !== 1 || target.kinds[0] !== "character") return null;
  const after = play[5] && legacy(play[5], timing, cardType, sourceSpan);
  if (play[5] && (!after || after.costs || after.usageLimit)) return null;
  const from = play[1] === "手札" ? "hand" : "trash", bindAs = `zone_play_${sourceSpan.start}`;
  const pick = draftSelect(bindAs, from, "SELF", 0, max, target.filters, { visibility: from === "hand" ? "OWNER_ONLY" : "PUBLIC" });
  pick.selector.cardTypes = ["character"];
  return { pattern: max > 1 ? "zone-effect-play-batch" : from === "hand" ? "zone-effect-play-full" : "zone-effect-play-trash", actions: wrap([pick,
    { type: "PLAY_BY_EFFECT", cards: { ref: `bindings.${bindAs}` }, from,
      destination: { owner: "SELF", zone: "character", slotPolicy: "REPLACE_IF_FULL" }, enterState: play[4] === "レストで" ? "REST" : "ACTIVE",
      provenance: "EFFECT", condition: always(), sourceSpan }, ...(after?.actions ?? [])]) };
}

function parseJoinedGuard(text) {
  const terms = text.replace(/を持ち、/u, "を持つかつ、").split(/でかつ、|かつ、|で、|かつ/u);
  if (terms.length !== 2) return null;
  const conditions = terms.map(term => parsePublicCondition(term, true) ?? parseDeltaGuard(term));
  return conditions.every(Boolean) ? { type: "all", conditions } : null;
}

function parseDeltaGuard(text) {
  const attribute = /^(自分|相手)のリーダーが属性\(([^()]+)\)を持つ$/u.exec(text);
  if (attribute) {
    const owner = attribute[1] === "自分" ? "SELF" : "OPPONENT";
    return { type: "EXISTS", query: { type: "QUERY_CARDS", owner, controller: owner, zone: "leader", visibility: "PUBLIC",
      faceUpOnly: true, cardTypes: ["leader"], excludeSource: false, filters: { type: "CARD_METADATA", subject: "CANDIDATE",
        basis: "CURRENT", field: "attributes", comparison: "EXACT", match: "ANY", values: [attribute[2]] } } };
  }
  const donGap = /^自分の場のドン(?:[!！]{2}|‼)の枚数が相手の場のドン(?:[!！]{2}|‼)の枚数より([1-9]|10)枚以上少ない$/u.exec(text);
  if (donGap) {
    const gap = Number(donGap[1]);
    return { type: "any", conditions: Array.from({ length: 11 - gap }, (_, count) => ({ type: "all", conditions: [
      { type: "compare", left: { ref: "SELF.don.fieldCount" }, op: "eq", right: count },
      { type: "compare", left: { ref: "OPPONENT.don.fieldCount" }, op: "gte", right: count + gap }
    ] })) };
  }
  const either = /^(自分|相手)のリーダーが「([^「」]+)」か特徴《([^《》]+)》を持つ$/u.exec(text);
  if (either) {
    const conditions = [parsePublicCondition(`${either[1]}のリーダーが「${either[2]}」`, true),
      parsePublicCondition(`${either[1]}のリーダーが特徴《${either[3]}》を持つ`, true)];
    return conditions.every(Boolean) ? { type: "any", conditions } : null;
  }
  const field = /^(自分|相手)の(元々の)?(コスト|パワー)([0-9]{1,5})(以上|以下)のキャラがいる$/u.exec(text);
  if (field) {
    const owner = field[1] === "自分" ? "SELF" : "OPPONENT";
    return { type: "EXISTS", query: { type: "QUERY_CARDS", owner, controller: owner, zone: "character",
      visibility: "PUBLIC", faceUpOnly: true, cardTypes: ["character"], excludeSource: false,
      filters: { type: "compare", left: { ref: `CANDIDATE.${field[2] ? "base" : "current"}.${field[3] === "コスト" ? "cost" : "power"}` },
        op: field[5] === "以上" ? "gte" : "lte", right: Number(field[4]) } } };
  }
  const trait = /^(自分|相手)のリーダーが『([^『』\r\n]+)』を含む特徴を持つ$/u.exec(text);
  if (!trait) return null;
  const owner = trait[1] === "自分" ? "SELF" : "OPPONENT";
  return { type: "EXISTS", query: { type: "QUERY_CARDS", owner, controller: owner, zone: "leader",
    visibility: "PUBLIC", faceUpOnly: true, cardTypes: ["leader"], excludeSource: false,
    filters: { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field: "traits", comparison: "CONTAINS", match: "ANY", values: [trait[2]] } } };
}

export function parseAttachedPrefix(text) {
  const match = /^(?:【ドン(?:[!！]{2}|‼)×([1-9]|10)】|〖ドン(?:[!！]{2}|‼)×([1-9]|10)〗)(.+)$/u.exec(normalizeGrammar(text));
  return match && { body: match[3], condition: { type: "compare", left: { ref: "SOURCE.attachedDonCount" }, op: "gte", right: Number(match[1] ?? match[2]) } };
}
