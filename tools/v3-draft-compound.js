import { parseV3Structure, emitV3Structure } from "./v3-draft-structure.js";
import { classifyTriggerSelfPlay, parsePublicCondition } from "./v3-trigger-self-play.js";
import { filteredHandCost, parseDraftMode, parseExistingRecipes } from "./v3-draft-recipes.js";

const always = () => ({ type: "all", conditions: [] });
const don = String.raw`ドン(?:[!！]{2}|‼)`;
const returnDon = new RegExp(`^${don}[-−－]([1-9]|10)(?:[（(]自分の場の${don}を指定の数${don}デッキに戻すことができる[）)])?$`, "u");
const playSource = sourceSpan => ({ type: "PLAY_TRIGGER_SOURCE", sourceSpan });

function activationCost(text, cardType, recipes, batch) {
  const discard = /^自分の手札([1-3])枚を捨てることができる$/u.exec(text);
  if (discard) return { type: "DISCARD_HAND", count: Number(discard[1]) };
  const don = returnDon.exec(text);
  if (don) return { type: "DON_RETURN", count: Number(don[1]), from: ["activeDon", "restDon", "attachedDon"] };
  if (text === "このキャラをレストにできる" && cardType === "character") return { type: "REST_SOURCE" };
  if (recipes && text === "このステージをレストにできる" && cardType === "stage") return { type: "REST_SOURCE" };
  if (recipes && (text === "このキャラをトラッシュに置くことができる" && cardType === "character" ||
      text === "このステージをトラッシュに置くことができる" && cardType === "stage"))
    return { type: "MOVE_AS_COST", selector: "SOURCE", destination: "trash" };
  if (batch) {
    const rest = new RegExp(`^([①②③④⑤⑥⑦⑧⑨⑩])[（(]コストエリアの${don}を指定の数レストにできる[）)]$`, "u").exec(text);
    if (rest) return { type: "REST_DON", count: rest[1].codePointAt(0) - "①".codePointAt(0) + 1 };
    return filteredHandCost(text);
  }
  return null;
}

export function parseCompoundEffect(body, timing, cardType, sourceSpan, fullTrigger, recipes = false, batch = false, branches = null, expansion = false) {
  const once = recipes && (timing === "MAIN" || expansion && ["ON_PLAY", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK", "TURN_END"].includes(timing)) && cardType !== "event" &&
    /^(?:【ターン[1１]回】|〖ターン[1１]回〗)/u.exec(body);
  if (once) body = body.slice(once[0].length);
  const use = once ? { usageLimit: { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 } } : {};
  const segments = body.split(/[:：]/u);
  if (segments.length > 2) return null;
  const raw = segments.at(-1);
  const cost = segments.length === 2 ? activationCost(segments[0], cardType, recipes, batch) : null;
  let costs = cost ? [cost] : [];
  if (!cost && batch && segments.length === 2) {
    const terms = segments[0].trimEnd().split(/[,，]/u);
    const pair = terms.length === 2 && terms.map(term => activationCost(term, cardType, recipes, true));
    if (pair && (pair[0]?.type === "REST_DON" && ["DISCARD_HAND", "REST_SOURCE"].includes(pair[1]?.type) ||
        expansion && ["REST_DON", "DON_RETURN"].includes(pair[0]?.type) && ["REVEAL_CARDS", "MOVE_AS_COST"].includes(pair[1]?.type) && pair[1].selector !== "SOURCE"))
      costs = pair;
  }
  if (segments.length === 2 && !costs.length) return null;
  if (timing === "TRIGGER" && fullTrigger && (cardType === "character" || cardType === "stage")) {
    const shape = classifyTriggerSelfPlay(raw, true);
    if (costs.length) {
      if (costs.length !== 1 || !["DISCARD_HAND", "DON_RETURN"].includes(cost.type) || shape.kind !== "unconditional" && !shape.predicate) return null;
      return { pattern: "pr29-life-activation-cost", costs: [cost], resolutionConditions: shape.predicate ?? always(), actions: [playSource(sourceSpan)] };
    }
    if (shape.predicate) return { pattern: "pr29-life-compound-condition", resolutionConditions: shape.predicate, actions: [playSource(sourceSpan)] };
    const follow = /^カード([1-9])枚を引く。その後、(.+)$/u.exec(raw);
    const guard = follow && classifyTriggerSelfPlay(follow[2], true).predicate;
    if (guard) return { pattern: "pr29-life-sequence", actions: [
      { type: "DRAW", player: "SELF", count: Number(follow[1]), sourceSpan },
      { type: "IF", condition: guard, then: [playSource(sourceSpan)], else: [] }
    ] };
  }
  const counterReturn = expansion && timing === "COUNTER" && cardType === "event" && costs.length === 1 && cost?.type === "DON_RETURN";
  if (costs.length && !counterReturn && (cardType === "event" || !["ON_PLAY", "ON_ATTACK", "MAIN", ...(expansion ? ["ON_OPPONENT_ATTACK", "ON_BLOCK", "TURN_END"] : [])].includes(timing))) return null;
  const costFields = costs.length ? { costs, optional: timing !== "MAIN" && !counterReturn } : {};
  if (branches) {
    // The existing interactive MAIN schema does not admit CHOOSE_MODE.
    if (cardType === "event" && timing === "MAIN" || timing === "TRIGGER" || costs.some(node => node.selector === "SOURCE")) return null;
    const modes = branches.map(({ label, sourceSpan }) => {
      const branch = parseCompoundEffect(label, timing, cardType, sourceSpan, false, true, true, null, expansion);
      return branch && !branch.costs && !branch.usageLimit ? { label, actions: branch.actions } : null;
    });
    const actions = modes.every(Boolean) && parseDraftMode(raw, modes);
    return actions ? { pattern: "recipe-mode-selection", actions, ...use, ...costFields } : null;
  }
  const parse = text => parseV3Structure(text, timing, condition => parsePublicCondition(condition, true)).structure;
  const payment = /^自分の手札([1-3])枚を捨ててもよい。そうした場合、(.+)$/u.exec(raw);
  if (payment) {
    const then = parse(payment[2]);
    if (!then || costs.length) return null;
    return { pattern: once ? "recipe-turn-limit" : "pr29-in-effect-payment", ...use, actions: [
      { type: "OFFER_PAYMENT", costs: [{ type: "DISCARD_HAND", count: Number(payment[1]) }], bindAs: "optional_payment", sourceSpan },
      { type: "IF_PAYMENT_SUCCEEDED", payment: "optional_payment", then: emitV3Structure(then, sourceSpan, true), else: [] }
    ] };
  }
  const structure = parse(raw);
  const library = !structure && recipes ? parseExistingRecipes(raw, timing, cardType, sourceSpan, {
    batch, expansion, sourceAvailable: cost?.selector !== "SOURCE"
  }) : null;
  if (!structure && !library) return null;
  if (library) return { ...library, ...costFields, ...use };
  if (recipes && (once || counterReturn || cost?.type === "MOVE_AS_COST" || cost?.type === "REST_SOURCE" && cardType === "stage" ||
      batch && costs.some(node => node.type === "REST_DON" || node.type === "REVEAL_CARDS")))
    return { pattern: once ? "recipe-turn-limit" : "recipe-source-payment", structure, ...costFields, ...use,
      actions: emitV3Structure(structure, sourceSpan, true) };
  const pattern = cost ? "pr29-field-activation-cost" : structure.operations.some(node => node.kind === "owner-move") ? "pr29-owner-target" :
    structure.operations.some(node => node.guard) ? "pr29-conditional-sequence" :
      structure.conditions.length ? "pr29-compound-condition" : "pr29-field-target";
  return { pattern, structure, ...costFields,
    actions: emitV3Structure(structure, sourceSpan, true) };
}
