const always = () => ({ type: "all", conditions: [] });
const compare = (ref, op, right) => ({ type: "compare", left: { ref }, op, right });
const player = side => side === "自分" ? "SELF" : "OPPONENT";
const op = bound => bound === "以下" ? "lte" : "gte";
const battleTimings = new Set(["COUNTER", "ON_ATTACK", "ON_OPPONENT_ATTACK", "ON_BLOCK"]);
const issue = (reason, start, end) => ({ reason, start, end });
const fail = (...args) => ({ issues: [issue(...args)] });
export const optionalDonBody = String.raw`ドン(?:[!！]{2}|‼)デッキからドン(?:[!！]{2}|‼)([1-9]|10)枚までを、?(アクティブ|レスト)で追加する。`;
const optionalDon = new RegExp(`^${optionalDonBody}$`, "u");

export function draftSelect(bindAs, zone, owner, min, max, filters, { visibility = "PUBLIC", chooser = "SELF" } = {}) {
  return { type: "SELECT", bindAs, selector: {
    type: "CARDS", owner, controller: owner, chooser, zone, cardTypes: zone === "hand" ? ["character", "stage", "event"] : [zone],
    filters, excludeSource: false, faceUpOnly: visibility === "PUBLIC", min, max, visibility,
    selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail"
  } };
}

function countConditions(text) {
  const terms = text.split(/でかつ、|かつ、|かつ/u);
  if (terms.length > 3) return null;
  const predicates = terms.map(term => {
    const match = /^(自分|相手)の(ライフ|手札)が(0|[1-9][0-9]?)枚(以下|以上)$/u.exec(term);
    return match && compare(`${player(match[1])}.${match[2] === "ライフ" ? "lifeCount" : "handCount"}`, op(match[4]), Number(match[3]));
  });
  if (predicates.some(predicate => !predicate)) return null;
  return predicates;
}

function target(text) {
  if (text === "自分のリーダー") return { owner: "SELF", chooser: "SELF", zones: ["leader"], min: 1, max: 1, filters: [] };
  if (text === "自分のリーダーかキャラ1枚まで") return { owner: "SELF", chooser: "SELF", zones: ["leader", "character"], min: 0, max: 1, filters: [] };
  const match = /^(自分|相手)の(レストの|アクティブの)?(.*?)キャラ([1-5])枚まで$/u.exec(text);
  if (!match) return null;
  const [, side, state, bounds, amount] = match, filters = [];
  if (state) filters.push(compare("CANDIDATE.rotated", "eq", state === "レストの"));
  if (bounds) {
    if (!bounds.endsWith("の")) return null;
    const seen = new Set();
    for (const term of bounds.slice(0, -1).split(/でかつ、|かつ、|かつ/u)) {
      const m = /^(コスト|パワー)(0|[1-9][0-9]{0,4})(以下|以上)$/u.exec(term);
      if (!m || seen.has(m[1])) return null;
      seen.add(m[1]);
      filters.push(compare(`CANDIDATE.current.${m[1] === "コスト" ? "cost" : "power"}`, op(m[3]), Number(m[2])));
    }
  }
  return { owner: player(side), chooser: "SELF", zones: ["character"], min: 0, max: Number(amount), filters };
}

function operation(sentence, timing) {
  const don = optionalDon.exec(sentence);
  if (don) return { kind: "optional-don", max: Number(don[1]), state: don[2] === "アクティブ" ? "ACTIVE" : "REST" };
  const draw = /^カード([1-9]|[1-4][0-9]|50)枚を引く。$/u.exec(sentence);
  if (draw) return { kind: "draw", player: "SELF", count: Number(draw[1]) };
  const discard = /^自分の手札([1-3])枚を捨てる。$/u.exec(sentence);
  if (discard) return { kind: "discard", owner: "SELF", chooser: "SELF", count: Number(discard[1]), shortage: "all-available" };
  const clause = /^(.+)を、(.+)。$/u.exec(sentence);
  if (!clause) return null;
  const selection = target(clause[1]);
  if (!selection) return null;
  const power = /^(このターン中|このバトル中)、パワー([+-])([1-9][0-9]{0,4})$/u.exec(clause[2]);
  if (power) {
    const duration = power[1] === "このバトル中" ? "battle" : "turn";
    if (duration === "battle" && !battleTimings.has(timing)) return null;
    return { kind: "power", target: selection, amount: Number(`${power[2]}${power[3]}`), duration };
  }
  if (selection.zones.length !== 1 || selection.zones[0] !== "character" || selection.owner !== "OPPONENT") return null;
  const kind = new Map([["レストにする", "rest"], ["KOする", "ko"], ["持ち主の手札に戻す", "return"]]).get(clause[2]);
  return kind ? { kind, target: selection } : null;
}

export function parseV3Structure(body, timing) {
  if (/[:：]/u.test(body)) return fail("payment-or-unmodeled-declaration", 0, body.length);
  let clauses = body, offset = 0, conditions = [];
  const marker = body.indexOf("の場合、");
  if (marker >= 0) {
    conditions = countConditions(body.slice(0, marker));
    offset = marker + "の場合、".length;
    if (!conditions) return fail("resolution-condition-unconfirmed", 0, offset);
    clauses = body.slice(offset);
  }
  const drawDiscard = /^(カード(?:[1-9]|[1-4][0-9]|50)枚を引)き、(自分の手札[1-3]枚を捨てる。)$/u.exec(clauses);
  if (drawDiscard) {
    const ops = [operation(`${drawDiscard[1]}く。`, timing), operation(drawDiscard[2], timing)];
    return { structure: { conditions, sequence: "draw-discard", operations: ops } };
  }
  const combined = /^(.+?)(枚を引き|KOし|レストにし)、(.+)$/u.exec(clauses);
  if (combined && optionalDon.test(combined[3])) {
    const verb = { "枚を引き": "枚を引く。", "KOし": "KOする。", "レストにし": "レストにする。" }[combined[2]];
    const first = operation(combined[1] + verb, timing);
    if (first) return { structure: { conditions, sequence: "then", operations: [first, operation(combined[3], timing)] } };
  }
  const parts = clauses.split("。その後、");
  if (parts.length > 3) return fail("sequence-limit", offset, body.length);
  const operations = [], issues = [];
  for (const [index, part] of parts.entries()) {
    const sentence = index < parts.length - 1 ? `${part}。` : part;
    const node = operation(sentence, timing);
    if (!node) issues.push(issue("target-or-operation-unconfirmed", offset, offset + sentence.length));
    else operations.push(node);
    offset += part.length + "。その後、".length;
  }
  return issues.length ? { issues } : { structure: { conditions, sequence: parts.length > 1 ? "then" : "single", operations } };
}

function discardActions({ owner, chooser }, count, prefix, sourceSpan) {
  if (!count) return [];
  const bindAs = `${prefix}_hand_${count}`, cards = { ref: `bindings.${bindAs}` };
  return [{ type: "IF", condition: compare(`${owner}.handCount`, "gte", count),
    then: [draftSelect(bindAs, "hand", owner, count, count, always(), { chooser, visibility: "OWNER_ONLY" }),
      { type: "MOVE_CARD", cards, destination: { owner, zone: "trash", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan }],
    else: discardActions({ owner, chooser }, count - 1, prefix, sourceSpan) }];
}

function emitOperation(node, prefix, sourceSpan) {
  if (node.kind === "optional-don") return [{ type: "ADD_DON_UP_TO", player: "SELF", max: node.max, state: node.state, sourceSpan }];
  if (node.kind === "draw") return [{ type: "DRAW", player: node.player, count: node.count, sourceSpan }];
  if (node.kind === "discard") return discardActions(node, node.count, prefix, sourceSpan);
  const { zones, owner, chooser, min, max, filters } = node.target;
  const forZone = zone => {
    const bindAs = `${prefix}_${zone}`, cards = { ref: `bindings.${bindAs}` };
    const select = draftSelect(bindAs, zone, owner, min, max, { type: "all", conditions: filters }, { chooser });
    if (node.kind === "power") {
      const modify = duration => ({ type: "MODIFY_STAT", cards, stat: "power", amount: node.amount, duration, sourceSpan });
      const untilTurn = player => modify({ type: "TURN_END", player, occurrence: 1 });
      return [select, node.duration === "battle" ? modify({ type: "BATTLE_END" }) : {
        type: "IF", condition: { type: "TURN_IS", player: "SELF" }, then: [untilTurn("SELF")], else: [untilTurn("OPPONENT")]
      }];
    }
    return [select, node.kind === "return"
      ? { type: "MOVE_CARD", cards, destination: { owner, zone: "hand", position: "append", faceUp: true }, cause: "EFFECT", sourceSpan }
      : { type: node.kind === "ko" ? "KO" : "REST", cards, sourceSpan }];
  };
  return zones.length === 1 ? forZone(zones[0]) : [{ type: "CHOOSE_MODE", modes: zones.map(zone => ({
    label: zone === "leader" ? "リーダー" : "キャラ", actions: forZone(zone)
  })) }];
}

export function emitV3Structure(structure, sourceSpan) {
  const actions = structure.operations.flatMap((node, i) => emitOperation(node, `structure_${sourceSpan.start}_${i}`, sourceSpan));
  return structure.conditions.length ? [{ type: "IF", condition: { type: "all", conditions: structure.conditions }, then: actions, else: [] }] : actions;
}

export function structurePattern(structure, boundary) {
  if (structure.operations.some(node => node.kind === "optional-don")) return "optional-add-don";
  if (structure.conditions.length) return "structure-count-conditions";
  if (structure.sequence === "draw-discard") return "structure-draw-discard";
  if (structure.sequence === "then") return "structure-sequence";
  if (structure.operations[0].target?.zones.length > 1) return "structure-leader-or-character";
  if (structure.operations[0].kind === "power") return "structure-power-duration";
  if (boundary) return "structure-boundary";
  return structure.operations[0].kind === "discard" ? "structure-discard" : "structure-target-filters";
}
