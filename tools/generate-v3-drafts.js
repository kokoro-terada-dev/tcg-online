import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ledgerFromCsv } from "./build-v3-review-ledger.js";
import { analyzeV3Coverage, collectProbes, isBareTriggerSelfPlay, v3DraftRegistry, writeV3Coverage } from "./analyze-v3-coverage.js";
import { reviewedPrintedDifferences } from "./review-v3-catalog.js";
import { csv } from "./audit-effect-cards.js";
import { draftSelect as select, emitV3Structure, parseV3Structure, structurePattern } from "./v3-draft-structure.js";
import { classifyTriggerSelfPlay } from "./v3-trigger-self-play.js";
import { parseCompoundEffect } from "./v3-draft-compound.js";
import { parseContinuousRecipe, parseDraftMode } from "./v3-draft-recipes.js";
import { normalizeGrammar, parseCompletionEffect, parseNewFieldRecipe } from "./v3-draft-completion.js";
import { parseAttachedPrefix, parseZoneContinuous, parseZoneEffect } from "./v3-draft-zones.js";
import { battleReplacementProgram, lifeCostProgram } from "./v3-draft-life-costs.js";
import { conditionalFieldProgram, handCostProgram, singleColorLeaderBaseProgram } from "./v3-draft-hand-cost.js";

const require = createRequire(import.meta.url);
const { loadReviewedV3Catalog } = require("../server/dist/test/effects/v3/reviewedCatalog.js");
const { compileV3CardJson, supportsV3RuntimeProfile } = require("../server/dist/test/effects/v3/compiler.js");
const { isInteractiveMainEvent, isLifeTriggerBody } = require("../server/dist/test/effects/v3/simpleMainEvent.js");
const latest = "v3-draft-generator.15";
const previousCompletion = "v3-draft-generator.14";
const previousRefinement = "v3-draft-generator.13";
const previousExpansion = "v3-draft-generator.12";
const previousBatch = "v3-draft-generator.11";
const keywords = new Map([
  ["ブロッカー", ["BLOCKER", "(相手のアタックの後、このカードをレストにし、アタックの対象をこのカードにできる)"]],
  ["速攻", ["RUSH", "(このカードは登場したターンにアタックできる)"]],
  ["速攻：キャラ", ["RUSH_CHARACTER"]],
  ["バニッシュ", ["BANISH", "(このカードがダメージを与えた場合、トリガーは発動せずそのカードはトラッシュに置かれる)"]],
  ["ダブルアタック", ["DOUBLE_ATTACK", "(このカードが与えるダメージは2になる)"]],
  ["ブロック不可", ["CANNOT_BE_BLOCKED", "(このカードはブロックされない)"]]
]);
const timings = new Map([
  ["登場時", ["ON_PLAY", "triggered", ["character", "stage"]]],
  ["アタック時", ["ON_ATTACK", "triggered", ["character", "leader"]]],
  ["相手のアタック時", ["ON_OPPONENT_ATTACK", "triggered", ["character", "leader"]]],
  ["KO時", ["ON_KO", "triggered", ["character"]]],
  ["メイン", ["MAIN", "activated", ["event"]]],
  ["起動メイン", ["MAIN", "activated", ["character", "leader", "stage"]]],
  ["カウンター", ["COUNTER", "activated", ["event"]]],
  ["トリガー", ["TRIGGER", "triggered", ["character", "event", "stage"]]]
]);
const boundaryTimings = new Map([
  ["ブロック時", ["ON_BLOCK", "triggered", ["character"]]],
  ["自分のターン終了時", ["TURN_END", "triggered", ["character", "stage", "leader"], "SELF"]],
  ["相手のターン終了時", ["TURN_END", "triggered", ["character", "stage", "leader"], "OPPONENT"]]
]);
const absent = value => value === "-" || value === "";
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...new Set(values)].sort(lexical);
const always = () => ({ type: "all", conditions: [] });
const header = text => /^(?:【([^】]+)】|〖([^〗]+)〗)(.*)$/u.exec(text.trim());
const reminder = (body, keyword) => keyword.length > 1 && /^[（(].+[）)]$/u.test(body) &&
  keyword.slice(1).some(value => value.slice(1, -1) === body.slice(1, -1));
const compare = (ref, op, right) => ({ type: "compare", left: { ref }, op, right });
const effectFor = (field, start, cardType, [type, kind, , player], suffix = "") => ({
  id: `${field === "text" ? "body" : "trigger"}-${start}${suffix}`, kind, timing: { type, ...(player ? { player } : {}) },
  sourceZones: [type === "TRIGGER" ? "life" : cardType === "event" ? "hand" : cardType],
  optional: false, usageLimit: null, activationConditions: always(), resolutionConditions: always(), costs: []
});

function targetedActions(body, type, start, sourceSpan) {
  const binding = `target_${start}`, cards = { ref: `bindings.${binding}` };
  const leaderPower = /^自分のリーダーを、このバトル中、パワー\+([1-9][0-9]{0,4})。$/u.exec(body);
  if (type === "COUNTER" && leaderPower) return {
    pattern: "counter-own-leader-power", actions: [select(binding, "leader", "SELF", 1, 1, always()),
      { type: "MODIFY_STAT", cards, stat: "power", amount: Number(leaderPower[1]), duration: { type: "BATTLE_END" }, sourceSpan }]
  };
  const character = /^相手の(レストの)?(コスト|パワー)(0|[1-9][0-9]{0,4})以下のキャラ([1-5])枚までを、(レストにする|KOする|持ち主の手札に戻す)。$/u.exec(body);
  if (!character) return null;
  const [, rested, stat, limit, max, verb] = character;
  const threshold = compare(`CANDIDATE.current.${stat === "コスト" ? "cost" : "power"}`, "lte", Number(limit));
  const filter = rested ? { type: "all", conditions: [compare("CANDIDATE.rotated", "eq", true), threshold] } : threshold;
  const action = verb === "持ち主の手札に戻す"
    ? { type: "MOVE_CARD", cards, destination: { owner: "OPPONENT", zone: "hand", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan }
    : { type: verb === "KOする" ? "KO" : "REST", cards, sourceSpan };
  return { pattern: `opponent-threshold-${action.type.toLowerCase().replaceAll("_", "-")}`,
    actions: [select(binding, "character", "OPPONENT", 0, Number(max), filter), action] };
}

function grantsKeyword(actions, keyword) {
  return actions.some(action => action.type === "GRANT_KEYWORD" && action.keyword.type === keyword ||
    action.type === "IF" && grantsKeyword([...action.then, ...action.else], keyword) ||
    action.type === "IF_PAYMENT_SUCCEEDED" && grantsKeyword([...action.then, ...action.else], keyword));
}

function parseSpan(span, cardType, gaps, previous, raw, extended, recipes, batch, expansion, refinement, completion, zones) {
  const { field, start, end, text } = span;
  const tag = header(text);
  const keyword = keywords.get(tag?.[1] ?? tag?.[2]);
  const body = tag?.[3]?.trim();
  const sourceSpan = { start, end };
  if (field === "text" && keyword && (cardType === "character" || cardType === "leader" && !keyword[0].startsWith("RUSH")) &&
    (body === "" || reminder(body, keyword))) {
    return { ...span, status: "recognized", keyword: { type: keyword[0], sourceSpan },
      ...(body && !keyword.slice(1).includes(body) ? { pattern: "keyword-reminder-parentheses" } : {}) };
  }
  if (field === "text" && previous?.keyword && /^(?:\r\n|\r|\n)$/u.test(raw.slice(previous.end, start))) {
    const previousTag = header(previous.text), definition = keywords.get(previousTag?.[1] ?? previousTag?.[2]);
    if (definition && !previousTag[3].trim() && reminder(text.trim(), definition)) {
      return { ...span, status: "recognized", pattern: "keyword-reminder-next-line", attachedTo: previous.start };
    }
  }
  if (expansion && field === "text") {
    const grantContinuous = (previous?.continuousEffects ?? [previous?.continuous]).find(row => row?.operation?.type === "GRANT_KEYWORD");
    if (zones && grantContinuous &&
        /^(?:\r\n|\r|\n)$/u.test(raw.slice(previous.end, start))) {
      const keyword = [...keywords.values()].find(values => values[0] === grantContinuous.operation.keyword.type);
      if (keyword && reminder(text.trim(), keyword))
        return { ...span, status: "recognized", pattern: "zone-continuous-keyword-reminder", attachedTo: previous.start };
    }
    if (previous?.effect && /^(?:\r\n|\r|\n)$/u.test(raw.slice(previous.end, start))) {
      const grant = /(?:【([^】]+)】|〖([^〗]+)〗)を得る。$/u.exec(previous.text.trim());
      const definition = keywords.get(grant?.[1] ?? grant?.[2]) ?? (zones === "delta" ?
        [...keywords.values()].find(value => reminder(text.trim(), value) &&
          [...keywords.entries()].some(([label, row]) => row === value && (previous.text.includes(`【${label}】を得る。`) || previous.text.includes(`〖${label}〗を得る。`)))) : null);
      if (definition && reminder(text.trim(), definition) && grantsKeyword(previous.effect.actions, definition[0]))
        return { ...span, status: "recognized", pattern: "recipe-granted-keyword-reminder", attachedTo: previous.start };
    }
    const continuous = parseContinuousRecipe(text.trim(), cardType, sourceSpan);
    if (continuous) return { ...span, status: "recognized", pattern: "recipe-continuous-field", continuous };
  }
  const label = tag?.[1] ?? tag?.[2];
  const regular = timings.get(label), timing = regular ?? boundaryTimings.get(label);
  if (recipes && field === "text" && cardType === "character" && label === "速攻：キャラ" &&
      /^[（(]このカードは登場したターンにキャラへアタックできる[）)]$/u.test(body))
    return { ...span, status: "recognized", pattern: "recipe-rush-character-reminder", keyword: { type: "RUSH_CHARACTER", sourceSpan } };
  let reason = "timing-or-keyword-unconfirmed", unparsed = [{ ...sourceSpan, reason }];
  const secondTag = field === "text" && body?.startsWith("/") ? header(body.slice(1)) : null;
  if (extended && timing && secondTag) {
    const second = timings.get(secondTag[1] ?? secondTag[2]) ?? boundaryTimings.get(secondTag[1] ?? secondTag[2]);
    const pair = second && [timing[0], second[0]].join("/");
    const shared = secondTag[3].trim();
    if (["ON_PLAY/ON_ATTACK", "ON_PLAY/ON_KO", "MAIN/COUNTER"].includes(pair) &&
        timing[2].includes(cardType) && second[2].includes(cardType) && !/^[【〖]/u.test(shared)) {
      const parsed = [timing, second].map(t => parseCompoundEffect(shared, t[0], cardType, sourceSpan, false) ??
        (recipes ? parseCompoundEffect(shared, t[0], cardType, sourceSpan, false, true) : null) ??
        (batch ? parseCompoundEffect(shared, t[0], cardType, sourceSpan, false, true, true) : null) ??
        (zones === "delta" ? parseZoneEffect(shared, t[0], cardType, sourceSpan, true) : null));
      if (parsed.every(Boolean)) {
        const effects = [timing, second].map((t, index) => {
          const { pattern, structure, ...program } = parsed[index];
          return { ...effectFor(field, start, cardType, t, `-${index + 1}`), ...program };
        });
        return { ...span, status: "recognized", pattern: parsed.find(p => p.pattern.startsWith("zone-"))?.pattern ?? (parsed.some(p => p.pattern.startsWith("recipe-")) ?
          "recipe-multiple-timings" : "pr29-multiple-timings"), effects };
      }
    }
  }
  if (timing && (field === "triggerText") === (timing[0] === "TRIGGER") && timing[2].includes(cardType)) {
    const [type] = timing;
    const draw = /^カード([1-9]|[1-4][0-9]|50)枚を引く。$/u.exec(body);
    const parsed = regular && (draw ? { actions: [{ type: "DRAW", player: "SELF", count: Number(draw[1]), sourceSpan }] } : targetedActions(body, type, start, sourceSpan));
    const effect = effectFor(field, start, cardType, timing);
    if (type === "TRIGGER" && (cardType === "character" || cardType === "stage") && isBareTriggerSelfPlay(raw)) {
      return { ...span, status: "recognized", pattern: "trigger-self-play", effect: { ...effect, actions: [{ type: "PLAY_TRIGGER_SOURCE", sourceSpan }] } };
    }
    if (type === "TRIGGER" && (cardType === "character" || cardType === "stage") && raw.trim() === text.trim()) {
      const { predicate, pattern } = classifyTriggerSelfPlay(body);
      if (predicate) return { ...span, status: "recognized", pattern: `pr28-trigger-self-play-${pattern}`, effect: {
        ...effect, resolutionConditions: predicate, actions: [{ type: "PLAY_TRIGGER_SOURCE", sourceSpan }]
      } };
    }
    if (parsed) return { ...span, status: "recognized", ...(parsed.pattern ? { pattern: parsed.pattern } : {}), effect: { ...effect, actions: parsed.actions } };
    if (type === "TRIGGER" && cardType === "event" && /^(?:このカードの【メイン】効果を発動する。|このカードの〖メイン〗効果を発動する。)$/u.test(body)) {
      return { ...span, status: "unknown", features: [], unparsed: [{ ...sourceSpan, reason: "main-body-unconfirmed" }], pendingMainCall: effect };
    }
    if (zones === "delta" && type === "TRIGGER") {
      const call = /^このカードの(?:【(登場時|KO時|カウンター)】|〖(登場時|KO時|カウンター)〗)効果を発動する。$/u.exec(body);
      if (call) return { ...span, status: "unknown", features: [],
        unparsed: [{ ...sourceSpan, reason: "effect-body-unconfirmed" }], pendingMainCall: effect, bodyTiming: timings.get(call[1] ?? call[2])[0] };
    }
    const { structure, issues } = parseV3Structure(body, type);
    if (structure) return { ...span, status: "recognized", pattern: structurePattern(structure, !regular), structure,
      effect: { ...effect, actions: emitV3Structure(structure, sourceSpan) } };
    const fullTrigger = raw.trim() === text.trim();
    const compound = extended && (parseCompoundEffect(body, type, cardType, sourceSpan, fullTrigger) ??
      (recipes ? parseCompoundEffect(body, type, cardType, sourceSpan, fullTrigger, true) : null) ??
      (batch ? parseCompoundEffect(body, type, cardType, sourceSpan, fullTrigger, true, true) : null) ??
      (expansion ? parseCompoundEffect(body, type, cardType, sourceSpan, fullTrigger, true, true, null, true) : null) ??
      (refinement ? parseCompoundEffect(body, type, cardType, sourceSpan, fullTrigger, true, true, null, true, true) : null) ??
      (completion ? parseCompletionEffect(body, type, cardType, sourceSpan) : null) ??
      (zones ? parseZoneEffect(body, type, cardType, sourceSpan, zones === "delta" ? "batch-play" : false) : null));
    if (compound) {
      const { pattern, structure, ...program } = compound;
      return { ...span, status: "recognized", pattern, ...(structure ? { structure } : {}), effect: { ...effect, ...program } };
    }
    reason = issues[0].reason;
    const bodyStart = start + text.trimEnd().length - body.length;
    unparsed = issues.map(({ reason, start, end }) => ({
      ...(end > start ? { start: bodyStart + start, end: bodyStart + end } : sourceSpan), reason
    }));
  }
  if (zones && field === "text" && ["leader", "character"].includes(cardType)) {
    if (zones === "delta" && cardType === "leader") {
      const ko = /^(?:【ターン[1１]回】|〖ターン[1１]回〗)自分の属性\(([^()]+)\)を持ち、(?:【ブロッカー】|〖ブロッカー〗)を持たないキャラがKOされた時、(.+)$/u.exec(text.trim());
      if (ko) {
        const program = parseCompoundEffect(ko[2], "ON_KO", cardType, sourceSpan, false, true, true, null, true, true);
        if (program && !program.costs && !program.usageLimit && !program.optional) {
          const timing = { type: "ON_EVENT", event: "CARD_KO", snapshot: "TRANSACTION_BEFORE", relation: "OTHER",
            owner: "SELF", controller: "SELF", fromZones: ["character"], toZones: ["trash"], cardTypes: ["character"], filters: {
              type: "all", conditions: [
                { type: "CARD_METADATA", subject: "CANDIDATE", basis: "CURRENT", field: "attributes", comparison: "EXACT", match: "ANY", values: [ko[1]] },
                { type: "not", condition: { type: "HAS_ABILITY", subject: "CANDIDATE", basis: "CURRENT", ability: "BLOCKER" } }
              ] } };
          return { ...span, status: "recognized", pattern: "zone-observed-ko-filter", effect: {
            ...effectFor(field, start, cardType, ["ON_EVENT", "triggered"]), timing, actions: program.actions,
            usageLimit: { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 }
          } };
        }
      }
    }
    const continuous = parseZoneContinuous(text.trim(), cardType, sourceSpan, zones === "delta");
    if (continuous) return { ...span, status: "recognized", ...continuous };
    if (zones === "delta" && cardType === "character") {
      const combined = /^((?:[^。]+場合、)?このキャラは(?:【[^】]+】|〖[^〗]+〗))を得て、((?:パワー|コスト)[+-][0-9]+)。$/u.exec(text.trim());
      if (combined) {
        const first = parseZoneContinuous(combined[1] + "を得る。", cardType, sourceSpan, true);
        if (first) {
          const second = parseZoneContinuous(`このキャラの${combined[2]}。`, cardType, sourceSpan, true);
          if (second) return { ...span, status: "recognized", pattern: first.pattern,
            continuousEffects: [first.continuous, { ...second.continuous, condition: first.continuous.condition }] };
        }
      }
    }
    const attached = parseAttachedPrefix(text.trim());
    if (attached) {
      const inner = parseSpan({ ...span, text: attached.body }, cardType, gaps, previous, raw, extended, recipes, batch, expansion, refinement, completion, false);
      if (inner.continuous) return { ...span, status: "recognized", pattern: "zone-source-continuous",
        continuous: { ...inner.continuous, condition: { type: "all", conditions: [attached.condition, inner.continuous.condition] } } };
      const triggered = ["MAIN", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK", "TURN_END"];
      const newerTag = header(attached.body);
      const nextTiming = timings.get(newerTag?.[1] ?? newerTag?.[2]) ?? boundaryTimings.get(newerTag?.[1] ?? newerTag?.[2]);
      const program = nextTiming && triggered.includes(nextTiming[0]) && nextTiming[2].includes(cardType) &&
        parseZoneEffect(newerTag[3], nextTiming[0], cardType, sourceSpan, zones === "delta");
      const { pattern: programPattern, structure: _structure, ...programFields } = program || {};
      const effect = inner.effect ?? (program ?
        { ...effectFor(field, start, cardType, nextTiming), ...(zones === "delta" ? programFields : { actions: program.actions }) } : null);
      if (effect && triggered.includes(effect.timing.type) && effect.activationConditions.type === "all" && !effect.activationConditions.conditions.length)
        return { ...span, status: "recognized", pattern: programPattern === "zone-deck-play" && !inner.effect ? programPattern : "zone-source-attached-don", effect: { ...effect, activationConditions: attached.condition } };
    }
  }
  if (completion) {
    const normalized = normalizeGrammar(text);
    if (field === "text") {
      const program = parseNewFieldRecipe(normalized.trim(), cardType, sourceSpan);
      if (program) return { ...span, status: "recognized", ...program };
    }
    if (text !== normalized) {
      const parsed = parseSpan({ ...span, text: normalized }, cardType, gaps, previous, raw, extended, recipes, batch, expansion, refinement, false);
      if (parsed.status === "recognized") return { ...parsed, ...span, pattern: parsed.pattern ?? "grammar-symbol-variant" };
    }
  }
  const features = sorted(gaps.filter(gap => gap.field === field && text.includes(gap.quote)).map(gap => gap.feature));
  return { ...span, status: features.length ? "unsupported" : "unknown", features, reason, unparsed };
}

function analyzeVariant(variant, rows, extended, recipes, batch, expansion, refinement, completion, zones) {
  const selected = rows.filter(row => variant.recordNumbers.includes(row.recordNumber));
  const types = sorted(selected.map(row => row.raw["種類"]));
  const cardType = types.length === 1 ? types[0].toLowerCase() : null;
  const gaps = collectProbes([variant]);
  const spans = [];
  for (const field of ["text", "triggerText"]) {
    if (absent(variant[field])) continue;
    const lines = [...variant[field].matchAll(/[^\r\n]+/g)];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i], span = { field, start: match.index, end: match.index + match[0].length, text: match[0] };
      if (!span.text.trim()) continue;
      let parsed = parseSpan(span, cardType, gaps, spans.at(-1), variant[field], extended, recipes, batch, expansion, refinement, completion, zones);
      if (zones === "delta" && field === "text" && parsed.status !== "recognized") {
        const continuous = handCostProgram(span.text.trim(), cardType, { start: span.start, end: span.end });
        if (continuous) parsed = { ...span, status: "recognized", pattern: "zone-hand-cost", continuous };
      }
      if (zones === "delta" && field === "text" && parsed.status !== "recognized") {
        const replacement = battleReplacementProgram(span.text.trim(), cardType, { start: span.start, end: span.end });
        if (replacement) parsed = { ...span, status: "recognized",
          pattern: replacement.group ? "zone-group-replacement" : "zone-battle-replacement", replacement };
      }
      if (zones === "delta" && cardType === "character" && parsed.continuousEffects?.length === 2 &&
        /^相手の元々のパワー[0-9]+以上のキャラがいる場合、このキャラは【ブロッカー】を得て、パワー\+[0-9]+。$/u.test(span.text.trim())) {
        const effects = structuredClone(parsed.continuousEffects);
        const comparisons = effects.map(effect => effect.condition.conditions?.[0]?.query?.filters);
        if (comparisons.every(filter => filter?.type === "compare" && filter.left?.ref === "CANDIDATE.base.power")) {
          for (const filter of comparisons) filter.left.ref = "CANDIDATE.printed.power";
          parsed = { ...parsed, pattern: "zone-ko-and-stat-costs", continuousEffects: effects };
        }
      }
      if (zones === "delta" && parsed.status !== "recognized") {
        const tag = header(span.text), timing = timings.get(tag?.[1] ?? tag?.[2]);
        const program = timing?.[2].includes(cardType) && (field === "triggerText") === (timing[0] === "TRIGGER") &&
          (lifeCostProgram(tag[3], timing[0], cardType, { start: span.start, end: span.end }) ??
            singleColorLeaderBaseProgram(tag[3], timing[0], cardType, { start: span.start, end: span.end }) ??
            conditionalFieldProgram(tag[3], timing[0], cardType, { start: span.start, end: span.end }));
        if (program?.heldReason) {
          parsed = { ...parsed, reason: program.heldReason, unparsed: [{ start: span.start, end: span.end, reason: program.heldReason }] };
        } else if (program) {
          const { pattern, ...effect } = program;
          parsed = { ...span, status: "recognized", pattern, effect: { ...effectFor(field, span.start, cardType, timing), ...effect } };
        }
      }
      if (zones === "delta" && field === "text" && parsed.status !== "recognized" && cardType === "character") {
        const entry = /^(?:【(自分|相手)のターン中】|〖(自分|相手)のターン中〗)((?:【登場時】|〖登場時〗).+)$/u.exec(span.text.trim());
        if (entry) {
          const inner = parseSpan({ ...span, text: entry[3] }, cardType, gaps, spans.at(-1), variant[field], extended, recipes, batch, expansion, refinement, completion, zones);
          const effect = inner.effect;
          if (effect?.timing.type === "ON_PLAY" && effect.activationConditions.type === "all" && !effect.activationConditions.conditions.length) {
            parsed = { ...span, status: "recognized", pattern: "zone-turn-resolving-entry",
              effect: { ...effect, timing: { type: "ON_EVENT", event: "CARD_ENTERED", snapshot: "TRANSACTION_AFTER", relation: "SELF",
                owner: "SELF", controller: "SELF", fromZones: ["hand", "deck", "life", "trash", "public", "stage", "resolving"],
                toZones: ["character"], cardTypes: ["character"], filters: always() },
                activationConditions: { type: "TURN_IS", player: (entry[1] ?? entry[2]) === "自分" ? "SELF" : "OPPONENT" } } };
          }
        }
      }
      if (batch && field === "text" && parsed.status !== "recognized" && span.text.endsWith("以下から1つを選ぶ。")) {
        const tag = header(span.text), timing = timings.get(tag?.[1] ?? tag?.[2]) ?? boundaryTimings.get(tag?.[1] ?? tag?.[2]);
        const branches = [];
        let end = span.end;
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j];
          if (!line[0].startsWith("・") || !/^(?:\r\n|\r|\n)$/u.test(variant[field].slice(end, line.index))) break;
          end = line.index + line[0].length;
          branches.push({ label: line[0].slice(1), sourceSpan: { start: line.index + 1, end } });
        }
        const program = timing?.[2].includes(cardType) && branches.length >= 2 && branches.length <= 8 &&
          branches.every(branch => branch.label.length <= 80) && new Set(branches.map(branch => branch.label)).size === branches.length &&
          (parseCompoundEffect(tag[3], timing[0], cardType, { start: span.start, end }, false, true, true, branches) ??
            (expansion ? parseCompoundEffect(tag[3], timing[0], cardType, { start: span.start, end }, false, true, true, branches, true) : null) ??
            (refinement ? parseCompoundEffect(tag[3], timing[0], cardType, { start: span.start, end }, false, true, true, branches, true, true) : null) ??
            (zones === "delta" ? lifeCostProgram(tag[3], timing[0], cardType, { start: span.start, end }, branches) : null) ??
            (zones === "delta" && cardType === "event" && timing[0] === "MAIN" ? deltaEventMode(tag[3], branches) : null));
        if (program) {
          const { pattern, ...effect } = program;
          spans.push({ ...span, status: "recognized", pattern,
            effect: { ...effectFor(field, span.start, cardType, timing), ...effect } });
          for (const { sourceSpan: { start, end } } of branches) {
            spans.push({ field, start: start - 1, end, text: variant[field].slice(start - 1, end),
              status: "recognized", pattern, attachedTo: span.start });
          }
          i += branches.length;
          continue;
        }
      }
      spans.push(parsed);
    }
  }
  const body = spans.filter(span => span.field === "text");
  const main = body.filter(span => span.effect?.timing.type === "MAIN");
  for (const span of spans) if (span.pendingMainCall) {
    const { pendingMainCall, bodyTiming, features: _features, ...origin } = span;
    const target = bodyTiming ? body.filter(row => row.effect?.timing.type === bodyTiming) : main;
    Object.assign(span, { reason: bodyTiming ? "effect-body-unconfirmed" : "main-body-unconfirmed" });
    delete span.pendingMainCall;
    delete span.bodyTiming;
    if (target.length === 1 && body.every(line => line.status === "recognized") && (bodyTiming ?
        isLifeTriggerBody(target[0].effect, cardType, "3.0.0-subset.51") :
        isInteractiveMainEvent(target[0].effect, target[0].pattern?.startsWith("zone-")))) {
      Object.assign(span, { status: "recognized", pattern: bodyTiming ? "zone-trigger-body" : "trigger-own-main", effect: { ...pendingMainCall,
        actions: [{ type: "CALL_EFFECT_BODY", effectId: target[0].effect.id, sourceSpan: { start: origin.start, end: origin.end } }] } });
      delete span.reason;
      delete span.features;
      delete span.unparsed;
    }
  }
  return { ...variant, cardType, spans };
}

function deltaEventMode(header, branches) {
  const modes = branches.map(({ label, sourceSpan }) => {
    const program = parseCompoundEffect(label, "MAIN", "event", sourceSpan, false, true, true, null, true, true) ??
      parseZoneEffect(label, "MAIN", "event", sourceSpan, true);
    return program && !program.costs && !program.usageLimit && !program.optional ? { label, actions: program.actions } : null;
  });
  const actions = modes.every(Boolean) && parseDraftMode(header, modes);
  return actions ? { pattern: "zone-event-main-mode", actions } : null;
}

function definitionFor(card, variant, raw, sourceCsvSha256) {
  const cardType = variant.cardType, stats = {
    cost: raw["コスト"], power: raw["パワー"], counter: raw["カウンター"], life: raw["ライフ"]
  };
  const required = { leader: ["power", "life"], character: ["cost", "power"], stage: ["cost"], event: ["cost"] }[cardType];
  const possible = [...required, ...(cardType === "character" ? ["counter"] : [])];
  const baseStats = Object.fromEntries(Object.entries(stats).map(([key, value]) => [key,
    absent(value) ? null : /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined]));
  const labels = value => absent(value) ? [] : value.split("/");
  const colors = labels(raw["色"]);
  if (!raw["カード名"].trim() || !colors.length || (cardType === "character" && stats.counter === "") ||
    required.some(key => baseStats[key] === null) ||
    Object.entries(baseStats).some(([key, value]) => value === undefined || value !== null && !possible.includes(key))) return null;
  const triggerPlay = variant.spans.some(span => span.pattern === "trigger-self-play");
  const optionalDon = variant.spans.some(span => span.structure?.operations.some(node => node.kind === "optional-don"));
  const fieldDon = variant.spans.some(span => span.pattern?.startsWith("pr27-field-don-"));
  const conditionalTriggerPlay = variant.spans.some(span => span.pattern?.startsWith("pr28-trigger-self-play-"));
  const compound = variant.spans.some(span => span.pattern?.startsWith("pr29-"));
  const recipes = variant.spans.some(span => span.pattern?.startsWith("recipe-"));
  const zones = variant.spans.some(span => span.pattern?.startsWith("zone-"));
  const batchPlay = variant.spans.some(span => span.pattern === "zone-effect-play-batch");
  const lifeCost = variant.spans.some(span => span.pattern === "zone-life-top-cost");
  const restCardCost = variant.spans.some(span => span.pattern === "zone-rest-card-cost");
  const revealConfirmation = variant.spans.some(span => span.pattern === "zone-reveal-confirmation-cost");
  const skipRefresh = variant.spans.some(span => span.pattern === "zone-skip-refresh");
  const fieldRestriction = variant.spans.some(span => span.pattern === "zone-field-restriction");
  const koAndStatCosts = variant.spans.some(span => span.pattern === "zone-ko-and-stat-costs");
  const battleReplacement = variant.spans.some(span => span.pattern === "zone-battle-replacement");
  const handCost = variant.spans.some(span => span.pattern === "zone-hand-cost");
  const groupReplacement = variant.spans.some(span => span.pattern === "zone-group-replacement");
  const fieldBinding = variant.spans.some(span => ["zone-auto-field-stat", "zone-turn-resolving-entry"].includes(span.pattern));
  const deckPlay = variant.spans.some(span => ["zone-deck-play", "zone-trigger-body", "zone-event-main-payment", "zone-event-main-mode",
    "zone-continuous-stable-guard"].includes(span.pattern));
  const newTargets = variant.spans.some(span => span.pattern?.startsWith("pr25-"));
  const continuousEffects = variant.spans.flatMap(span => span.continuousEffects ?? (span.continuous ? [span.continuous] : []));
  const replacementEffects = variant.spans.flatMap(span => span.replacement ? [span.replacement] : []);
  return {
    schemaVersion: groupReplacement ? "3.0.0-subset.62" : handCost ? "3.0.0-subset.61" : battleReplacement ? "3.0.0-subset.60" : koAndStatCosts || variant.spans.some(span => span.pattern === "zone-single-color-leader-base") ? "3.0.0-subset.59" : fieldRestriction ? "3.0.0-subset.58" : skipRefresh ? "3.0.0-subset.57" : revealConfirmation ? "3.0.0-subset.56" : restCardCost ? "3.0.0-subset.55" : lifeCost ? "3.0.0-subset.54" : batchPlay ? "3.0.0-subset.53" : fieldBinding ? "3.0.0-subset.52" : deckPlay ? "3.0.0-subset.51" : zones ? "3.0.0-subset.50" : recipes || compound ? "3.0.0-subset.49" : conditionalTriggerPlay ? "3.0.0-subset.48" : fieldDon ? "3.0.0-subset.47" : optionalDon ? "3.0.0-subset.46" : triggerPlay ? "3.0.0-subset.45" : "3.0.0-subset.44", cardId: card.cardId,
    cardVersion: recipes ? "draft.recipes.1" : compound ? "draft.pr29.1" : conditionalTriggerPlay ? "draft.pr28.1" : fieldDon ? "draft.pr27.1" : newTargets ? "draft.pr25.1" : optionalDon ? "draft.pr24.1" : triggerPlay ? "draft.pr23.1" : variant.spans.some(span => span.structure) ? "draft.pr21.1" :
      variant.spans.some(span => span.pattern) ? "draft.pr20.1" : "draft.pr19.1", cardType, name: raw["カード名"], baseStats, colors,
    traits: labels(raw["特徴"]), attributes: labels(raw["属性"]), reviewStatus: "needs_review",
    keywords: variant.spans.flatMap(span => span.keyword ? [span.keyword] : []),
    effects: variant.spans.flatMap(span => span.effects ?? (span.effect ? [span.effect] : [])),
    ...(continuousEffects.length ? { continuousEffects } : {}),
    ...(replacementEffects.length ? { replacementEffects } : {}),
    source: { text: absent(variant.text) ? "" : variant.text, triggerText: absent(variant.triggerText) ? "" : variant.triggerText,
      displayIds: sorted(variant.displayIds), datasetSha256: sourceCsvSha256 }
  };
}

function generateCard(card, rows, sourceCsvSha256, extended, recipes, batch, expansion = false, refinement = false, completion = false, zones = false) {
  const variants = card.variants.map(variant => analyzeVariant(variant, rows, extended, recipes, batch, expansion, refinement, completion, zones));
  const spans = variants.flatMap(variant => variant.spans);
  const recognized = spans.filter(span => span.status === "recognized").length;
  const unresolved = spans.length - recognized;
  const base = { cardId: card.cardId, sourceCsvSha256, names: sorted(rows.map(row => row.raw["カード名"])),
    displayIds: sorted(rows.map(row => row.displayId)), variants, recognized, unresolved, noEffect: false,
    status: "unassessed", compiler: "not_checked", reasons: card.reasons };
  const variant = variants[0];
  if (card.disposition === "quarantine" || variants.length !== 1) return base;
  if (!["leader", "character", "stage", "event"].includes(variant.cardType)) return { ...base, reasons: ["card-type-unmodeled"] };
  if (unresolved) return { ...base, status: recognized ? "partial" : "unconvertible", reasons: ["uninterpreted-source"] };
  const noEffect = absent(variant.text) && absent(variant.triggerText);
  if (!recognized && (!noEffect || variant.cardType !== "character")) return { ...base, reasons: ["effect-absence-unconfirmed"] };
  const definition = definitionFor(card, variant, rows[0].raw, sourceCsvSha256);
  if (!definition || rows.some(row => reviewedPrintedDifferences(row.raw, definition).length)) return { ...base, reasons: ["printed-metadata-unconfirmed"] };
  try {
    const plan = compileV3CardJson(JSON.stringify(definition));
    if (!supportsV3RuntimeProfile(plan)) return { ...base, compiler: "passed", reasons: ["runtime-profile-mismatch"] };
    return { ...base, status: "complete", noEffect, compiler: "passed", compilerVersion: plan.compilerVersion,
      registryHash: plan.registryHash, definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, definition };
  } catch (error) {
    return { ...base, status: "unconvertible", compiler: "failed", reasons: [error.message.slice(0, 512)] };
  }
}

export function generateV3Drafts(ledger, cardIds = [], version = latest, validate = null, { delta = false, excludeApproved = new Set() } = {}) {
  if (![latest, previousCompletion, previousRefinement, previousExpansion, previousBatch, "v3-draft-generator.10", "v3-draft-generator.9", "v3-draft-generator.8"].includes(version)) throw Error("Unsupported draft generation baseline");
  const registryHash = v3DraftRegistry(version);
  const selected = new Set(cardIds), rows = new Map();
  for (const row of ledger.rows) {
    if (selected.size && !selected.has(row.cardId)) continue;
    if (!rows.has(row.cardId)) rows.set(row.cardId, []);
    rows.get(row.cardId).push(row);
  }
  if ([...selected].some(id => !rows.has(id))) throw Error("Requested card ID does not exist in this CSV");
  const counts = { complete: 0, partial: 0, unconvertible: 0, unassessed: 0 };
  const schemaHolds = [];
  const cards = ledger.cards.filter(card => rows.has(card.cardId)).map(card => {
    if (excludeApproved.has(card.cardId)) return { cardId: card.cardId, status: "unassessed", noEffect: false,
      compiler: "not_checked", variants: [], unresolved: 0, recognized: 0, reasons: ["approval-excluded-from-delta"] };
    const args = [card, rows.get(card.cardId), ledger.sourceSha256, version !== "v3-draft-generator.8",
      [latest, previousCompletion, previousRefinement, previousExpansion, previousBatch, "v3-draft-generator.10"].includes(version),
      [latest, previousCompletion, previousRefinement, previousExpansion, previousBatch].includes(version)];
    const prior = generateCard(...args);
    const unfinished = result => ["partial", "unconvertible"].includes(result.status);
    const expanded = [latest, previousCompletion, previousRefinement, previousExpansion].includes(version) && unfinished(prior) ? generateCard(...args, true) : prior;
    const refined = [latest, previousCompletion, previousRefinement].includes(version) && unfinished(expanded) ? generateCard(...args, true, true) : expanded;
    const completed = [latest, previousCompletion].includes(version) && unfinished(refined) ? generateCard(...args, true, true, true) : refined;
    const next = version === latest && unfinished(completed) ? generateCard(...args, true, true, true, delta ? "delta" : true) : completed;
    const { definition, ...review } = next;
    if (!validate || next.status !== "complete" || validate(definition)) return next;
    schemaHolds.push({ cardId: card.cardId, schemaVersion: definition.schemaVersion, errors: structuredClone(validate.errors) });
    return { ...review, status: "unassessed", reasons: ["schema-validation-failed"] };
  })
    .sort((a, b) => lexical(a.cardId, b.cardId));
  const totals = { sourceCards: ledger.cards.length, selectedCards: cards.length, counts, noEffect: 0, compilerPassed: 0, compilerFailed: 0, unresolvedSpans: 0 };
  for (const card of cards) {
    counts[card.status]++;
    totals.noEffect += Number(card.noEffect);
    totals.compilerPassed += Number(card.compiler === "passed");
    totals.compilerFailed += Number(card.compiler === "failed");
    totals.unresolvedSpans += card.unresolved;
  }
  const candidates = { version: "v3-coverage-candidates.1", sourceCsvSha256: ledger.sourceSha256, registryHash,
    cards: cards.flatMap(card => card.variants.length !== 1 ? [] : [{ cardId: card.cardId, variantSha256: card.variants[0].pairSha256,
      generation: { version, status: card.status, noEffect: card.noEffect, recognized: card.recognized, unresolved: card.unresolved },
      ...(card.definition ? { definition: card.definition } : {}) }]) };
  return { candidates, schemaHolds, trace: { version, executable: false, sourceCsvSha256: ledger.sourceSha256, registryHash, totals,
    cards: cards.map(({ definition: _draft, ...card }) => card) } };
}

export function reviewableDefinitionFiles(candidates, report) {
  const reviewable = new Set(report.cards.filter(card => card.classification === "candidate" && !card.approval).map(card => card.cardId));
  const ids = new Set();
  return candidates.cards.flatMap(({ cardId, generation, definition }) => {
    if (!reviewable.has(cardId) || generation.status !== "complete" || !definition) return [];
    const portable = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(cardId) &&
      !/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/iu.test(cardId);
    if (!portable || ids.has(cardId.toLowerCase()) || definition.cardId !== cardId || definition.reviewStatus !== "needs_review")
      throw Error("Unsafe or duplicate candidate definition");
    ids.add(cardId.toLowerCase());
    return [{ file: `${cardId}.json`, definition }];
  });
}

function writeDraftResults(directory, { candidates, trace }, definitionExport) {
  const write = (name, data) => fs.writeFileSync(path.join(directory, name), data, { flag: "wx" });
  write("candidates.json", JSON.stringify(candidates, null, 2) + "\n");
  write("generation.json", JSON.stringify(trace, null, 2) + "\n");
  write("generation.csv", csv([["card_id", "generation", "no_effect", "compiler", "recognized_spans", "unresolved_spans", "definition_sha256", "reasons"],
    ...trace.cards.map(card => [card.cardId, card.status, card.noEffect, card.compiler, card.recognized, card.unresolved, card.definitionHash ?? "", JSON.stringify(card.reasons)])]));
  if (definitionExport) {
    const { files, holds } = definitionExport;
    fs.mkdirSync(path.join(directory, "definitions"));
    for (const { file, definition } of files) write(path.join("definitions", file), JSON.stringify(definition, null, 2) + "\n");
    write("definition-export.json", JSON.stringify({ executable: false, sourceCsvSha256: trace.sourceCsvSha256,
      schemaValidated: files.length, holds }, null, 2) + "\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root, source, output, ...flags] = process.argv.slice(2), cardIds = [];
    if (!root || !source || !output || flags.length % 2) throw Error("Usage: generate-v3-drafts.js <catalog-dir> <source.csv> <new-output-dir> [--ledger file.json] [--card ID] [--definitions validated]");
    let auditLedger, exportDefinitions = false;
    for (let i = 0; i < flags.length; i += 2) {
      if (flags[i] === "--card") cardIds.push(flags[i + 1]);
      else if (flags[i] === "--ledger" && auditLedger === undefined) {
        if (fs.statSync(flags[i + 1]).size > 64 * 1024 * 1024) throw Error("Input ledger exceeds 64 MiB");
        auditLedger = JSON.parse(fs.readFileSync(flags[i + 1], "utf8"));
      } else if (flags[i] === "--definitions" && flags[i + 1] === "validated" && !exportDefinitions) exportDefinitions = true;
      else throw Error("Unknown or duplicate option");
    }
    if (fs.statSync(source).size > 25 * 1024 * 1024) throw Error("Input CSV exceeds 25 MiB");
    const validate = require("../docs/validate-card-effect-json.cjs").createSchemaValidator();
    const bytes = fs.readFileSync(source), generated = generateV3Drafts(ledgerFromCsv(bytes), cardIds, latest, validate);
    const report = analyzeV3Coverage(loadReviewedV3Catalog(root), bytes, { auditLedger, candidates: generated.candidates });
    const definitionExport = exportDefinitions ? { files: reviewableDefinitionFiles(generated.candidates, report), holds: generated.schemaHolds } : null;
    writeV3Coverage(root, output, report);
    writeDraftResults(output, generated, definitionExport);
    console.log(JSON.stringify({ ...generated.trace.totals, ...(definitionExport ? { reviewableDefinitionFiles: definitionExport.files.length,
      schemaHolds: definitionExport.holds.length } : {}), coverage: report.counts, gaps: report.gaps.slice(0, 10) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
