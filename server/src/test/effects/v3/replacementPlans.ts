import { createHash } from "node:crypto";
import { visibleTo } from "../../movement/engine";
import { movementOccurrence } from "../../movement/occurrence";
import { ensureMove, freezeMovement, getCard, location } from "../../movement/state";
import type { EventCause, MovementOperation, MovementState, Player, TransactionResult } from "../../movement/types";
import type { DeepReadonly } from "../types";
import type { ApprovedV3Card } from "./approval";
import type { Node } from "./dsl";
import { filteredCostCandidates } from "./activationCosts";
import { effectsDisabled, type KeywordGrants } from "./keywordEffects";
import { topLifeCostOperation } from "./activationCosts";
import { protectionRules } from "./protectionRules";
import type { ResolutionEnvironment, ResolutionIdentity } from "./resolution";

type Move = Extract<MovementOperation, { kind: "move" }>;
type Rule = DeepReadonly<Node<"replacement">>;
type Payment = NonNullable<Rule["optionalPayment"]>;
type Substitute = Move | Extract<MovementOperation, { kind: "setRest" }>;
export type ReplacementPlan = DeepReadonly<{
  intent: { id: string; workId: string; worldRevision: number; identity: ResolutionIdentity; operation: Move; cause: EventCause };
  candidateId: string; ruleId: string; definitionHash: string; chooser: Player;
  sourceLabel: string; sourceCardId: string; priority?: number; usageKey?: string;
  cause: EventCause;
  group?: { protectedCards: Move["card"][]; remaining: MovementOperation[] };
} & ({ substitute: Substitute; payment?: never } | { substitute: null; payment: { cost: Payment; label: string;
  candidates: { ref: Move["card"]; cardId: string; zone: string; label?: string }[] | "unknown" } })>;
export type ReplacementAnswer = Readonly<{ plan: ReplacementPlan; decision: "accepted" | "declined"; paymentCard?: Move["card"] }>;
const hash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const sameRef = (a: Move["card"], b: Move["card"]) => a.instanceId === b.instanceId && a.generation === b.generation;
export const replacementLabel = (substitute: DeepReadonly<Substitute>) => substitute.kind === "setRest" ? "このキャラをレスト" :
  substitute.cause === "EFFECT_KO" ? "このキャラをKO" : substitute.to.zone === "hand" ? "手札へ戻す" : "トラッシュへ置く";

function matches(rule: Rule, move: Move, actor: Player): boolean {
  const match = rule.match;
  if (match.cause === "DAMAGE") return false;
  if (match.cause === "OPPONENT_EFFECT_LEAVE") return actor !== move.from.player && move.from.zone === "character" &&
    move.to.zone !== "character" && ["EFFECT_KO", "EFFECT_MOVE"].includes(move.cause);
  if (match.cause === "KO") return move.from.zone === "character" && move.to.zone === "trash" && ["EFFECT_KO", "BATTLE_KO"].includes(move.cause);
  if (match.cause === "OPPONENT_LEAVE") return actor !== move.from.player && move.from.zone === "character" &&
    move.to.zone !== "character" && ["EFFECT_KO", "EFFECT_MOVE", "BATTLE_KO"].includes(move.cause);
  return move.cause === match.cause && move.from.zone === match.from && move.to.zone === match.to &&
    (match.by === "ANY" || (move.from.player === actor ? match.by === "SELF" : match.by === "OPPONENT"));
}

export function planReplacements(board: MovementState, workId: string, identity: ResolutionIdentity, operations: readonly MovementOperation[],
  definitions: ReadonlyMap<string, ApprovedV3Card>, activePlayer: Player,
  environmentFor: (ruleId: string, card: ApprovedV3Card, actor: Player, source: Move["card"]) => ResolutionEnvironment,
  used: (key: string) => boolean, grants: KeywordGrants = []): readonly ReplacementPlan[] {
  function allowed(move: Move, cause: EventCause): boolean {
    const rules = protectionRules(board, definitions, activePlayer, cause.kind === "BATTLE_KO" ? "rule" : "effect", grants);
    if (rules.status === "certifiedNone") return true;
    ensureMove(rules.status === "evaluate", "v3-replacement-protection-unresolved");
    const result = rules.check({ kind: "move", operationIndex: 0, card: getCard(board, move.card),
      from: move.from, to: move.to, automatic: false, cause }, board).kind;
    ensureMove(result !== "defer", "v3-replacement-protection-unresolved");
    return result === "allow";
  }
  const originalCause = (move: Move): EventCause => ({ kind: move.cause, actor: identity.actor,
    effectController: move.cause === "BATTLE_KO" ? null : identity.actor, source: identity.source,
    resolutionId: move.cause === "BATTLE_KO" ? null : identity.resolutionId, parentEventId: null });
  const moves = operations.filter((op): op is Move => op.kind === "move" && op.from.zone === "character");
  const groups: ReplacementPlan[] = [];
  if (moves.length) for (const chooser of [0, 1] as const) {
    const own = moves.filter(move => move.from.player === chooser);
    if (!own.length) continue;
    for (const [slot, id] of board.players[chooser].character.entries()) {
      const holder = id === null ? undefined : board.cards[id], definition = holder && definitions.get(holder.cardId);
      if (!holder || !definition || holder.kind !== "character" || holder.owner !== chooser || holder.controller !== chooser ||
        !holder.faceUp || effectsDisabled(grants, holder)) continue;
      const source = { instanceId: holder.instanceId, generation: holder.generation };
      for (const rule of definition.definition.replacementEffects ?? []) {
        if (!rule.group || rule.optionalPayment) continue;
        const candidates = own.filter(move => matches(rule, move, identity.actor));
        if (!candidates.length || rule.substitute.from === "SOURCE_REST" && holder.rotated) continue;
        const env = environmentFor(rule.id, definition, chooser, source), valid = env.evaluate(rule.condition, {});
        ensureMove(valid !== "unknown", "v3-replacement-condition-unknown");
        if (!valid) continue;
        const protectedMoves = candidates.filter(move => {
          if (!allowed(move, originalCause(move))) return false;
          const match = env.evaluate(rule.group!.filters, {}, move.card);
          ensureMove(match !== "unknown", "v3-replacement-target-unknown");
          return match;
        });
        if (!protectedMoves.length) continue;
        const remaining = operations.filter(op => !protectedMoves.some(move => move === op));
        const substitute: Substitute = rule.substitute.from === "SOURCE_REST" ? { kind: "setRest", card: source, rotated: true } :
          { kind: "move", card: source, from: { player: chooser, zone: "character" },
            to: { player: chooser, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "EFFECT_KO" };
        const operation = moves[0]!, cause = originalCause(operation), workIntent = { workId, worldRevision: board.revision, identity, operation, cause };
        const intent = { ...workIntent, id: hash([workIntent, operations]) }, candidateId = hash([intent.id, definition.definitionHash, rule.id, source]);
        const alternateCause: EventCause = { kind: substitute.kind === "move" ? substitute.cause : "EFFECT_MOVE", actor: chooser,
          effectController: chooser, source, resolutionId: candidateId, parentEventId: null };
        if (substitute.kind === "move") {
          if (!allowed(substitute, alternateCause)) continue;
          ensureMove(!remaining.some(op => "card" in op && sameRef(op.card, source)), "v3-group-replacement-source-conflict");
        } else {
          const at = { player: chooser, zone: "character" as const };
          const rules = protectionRules(board, definitions, activePlayer, "effect", grants);
          if (rules.status === "evaluate" && rules.check({ kind: "setRest", operationIndex: 0, card: holder,
            from: at, to: at, cause: alternateCause, automatic: false }, board).kind !== "allow") continue;
        }
        groups.push(freezeMovement({ intent, candidateId, ruleId: rule.id, definitionHash: definition.definitionHash, chooser,
          sourceCardId: holder.cardId, sourceLabel: `キャラ${slot + 1}・${definition.definition.name}`, priority: chooser === activePlayer ? 1 : 2,
          cause: alternateCause, substitute, group: { protectedCards: protectedMoves.map(move => move.card), remaining } }));
      }
    }
  }
  if (groups.length) {
    ensureMove(groups.every(plan => plan.chooser === groups[0]!.chooser), "v3-group-replacement-competing-choosers");
    ensureMove(groups.every(plan => JSON.stringify(plan.group?.protectedCards) === JSON.stringify(groups[0]!.group?.protectedCards)),
      "v3-group-replacement-overlapping-scopes");
    // A competing legacy replacement may require a different priority or scope.
    ensureMove(!moves.some(move => (["leader", "character", "stage"] as const).some(zone => board.players[move.from.player][zone].some(id => {
      const holder = id === null ? undefined : board.cards[id];
      return holder && !effectsDisabled(grants, holder) && definitions.get(holder.cardId)?.definition.replacementEffects?.some(rule =>
        !rule.group && (rule.target || id === move.card.instanceId) && matches(rule, move, identity.actor));
    }))), "v3-group-replacement-legacy-conflict");
    return groups;
  }
  for (const move of operations) {
    if (move.kind !== "move" || move.from.zone !== "character") continue;
    const object = getCard(board, move.card), at = location(board, object.instanceId);
    ensureMove(at.player === move.from.player && at.zone === move.from.zone, "v3-replacement-stale-source");
    if (object.kind !== "character" || object.owner !== at.player || object.controller !== at.player ||
      !object.faceUp || !visibleTo(board, object, at, 0) || !visibleTo(board, object, at, 1)) continue;
    const candidates = (["leader", "character", "stage"] as const).flatMap(zone => board.players[at.player][zone].flatMap((id, slot) => {
      if (!id) return [];
      const holder = board.cards[id]!, definition = definitions.get(holder.cardId);
      if (effectsDisabled(grants, holder)) return [];
      if (!definition?.definition.replacementEffects || holder.kind !== zone || holder.owner !== at.player || holder.controller !== at.player ||
        !holder.faceUp || !visibleTo(board, holder, { player: at.player, zone }, 0) || !visibleTo(board, holder, { player: at.player, zone }, 1)) return [];
      const source = { instanceId: id, generation: holder.generation };
      const sourceLabel = zone === "leader" ? "リーダー" : zone === "stage" ? "ステージ" : `キャラ${slot + 1}`;
      return definition.definition.replacementEffects.flatMap((rule, index) =>
        !rule.group && (rule.target || id === object.instanceId) && matches(rule, move, identity.actor) ? [{ definition, rule, source, sourceLabel, index }] : []);
    }));
    if (!candidates.length) continue;
    ensureMove(operations.length === 1, "v3-replacement-batch-unresolved");
    const cause: EventCause = { kind: move.cause, actor: identity.actor, effectController: move.cause === "BATTLE_KO" ? null : identity.actor, source: identity.source,
      resolutionId: move.cause === "BATTLE_KO" ? null : identity.resolutionId, parentEventId: null };
    if (!allowed(move, cause)) return [];
    const intent = { workId, worldRevision: board.revision, identity, operation: move, cause };
    const intentId = hash(intent);
    const plans: ReplacementPlan[] = [];
    let modern = false;
    for (const { definition, rule, source, sourceLabel, index } of candidates) {
      const usageKey = rule.usageLimit ? JSON.stringify([board.turnNumber, source.instanceId, source.generation, rule.id]) : undefined;
      if (usageKey && used(usageKey)) continue;
      const environment = environmentFor(rule.id, definition, at.player, source);
      const valid = environment.evaluate(rule.condition, {});
      ensureMove(valid !== "unknown", "v3-replacement-condition-unknown");
      if (!valid) continue;
      if (rule.target) {
        const target = environment.evaluate("maxPrintedPower" in rule.target ?
          { type: "compare", left: { ref: "CANDIDATE.printed.power" }, op: "lte", right: rule.target.maxPrintedPower } :
          { type: "compare", left: { ref: "CANDIDATE.printed.cost" }, op: "gte", right: rule.target.minPrintedCost }, {}, move.card);
        ensureMove(target !== "unknown", "v3-replacement-target-unknown");
        if (!target) continue;
      }
      const prioritized = ["3.0.0-subset.39", "3.0.0-subset.40", "3.0.0-subset.41", "3.0.0-subset.42", "3.0.0-subset.43", "3.0.0-subset.44", "3.0.0-subset.45", "3.0.0-subset.46", "3.0.0-subset.47", "3.0.0-subset.48", "3.0.0-subset.49", "3.0.0-subset.50", "3.0.0-subset.51", "3.0.0-subset.52", "3.0.0-subset.53", "3.0.0-subset.54", "3.0.0-subset.55", "3.0.0-subset.56", "3.0.0-subset.57", "3.0.0-subset.58", "3.0.0-subset.59", "3.0.0-subset.60", "3.0.0-subset.61", "3.0.0-subset.62"].includes(definition.definition.schemaVersion);
      const candidateId = hash([intentId, definition.definitionHash, rule.id, ...(prioritized ? [source] : [])]);
      const alternateCause: EventCause = { kind: "EFFECT_MOVE", actor: at.player, effectController: at.player,
        source, resolutionId: candidateId, parentEventId: null };
      const base = { intent: { ...intent, id: intentId }, candidateId, ruleId: rule.id,
        definitionHash: definition.definitionHash, chooser: at.player, cause: alternateCause,
        sourceCardId: definition.definition.cardId, sourceLabel: `${sourceLabel}・${definition.definition.name}（${index + 1}）`, ...(usageKey ? { usageKey } : {}) };
      if (rule.optionalPayment) {
        const cost = rule.optionalPayment;
        const rows = cost.type === "DON_RETURN" ? environment.candidates({ type: "CARDS", owner: "SELF", controller: "SELF", chooser: "SELF",
          zone: cost.from, visibility: "PUBLIC", faceUpOnly: true, cardTypes: ["don"], filters: { type: "all", conditions: [] },
          excludeSource: false, min: 1, max: 1, selectionMode: "SELECT", order: "UNORDERED", onInsufficient: "fail" }, {}) :
          board.players[at.player].hand.some(id => id !== null && board.cards[id]?.kind === "unknown") ? "unknown" :
            filteredCostCandidates(environment, cost.selector, source);
        const label = cost.type === "DON_RETURN" ? "DON!!を戻す" : cost.selector.cardTypes.includes("character") ? "手札を捨てる" :
          cost.selector.cardTypes.length > 1 ? "イベント／ステージ" : cost.selector.cardTypes[0] === "event" ? "イベント" : "ステージ";
        // Keep the wait visible even when payment cannot be offered; the opponent must not learn what is in the hand.
        plans.push(freezeMovement(structuredClone({ ...base, substitute: null, payment: { cost, label,
          candidates: rows === "unknown" ? rows : rows.map(({ ref, cardId, zone, label }) => ({ ref, cardId, zone, ...(label ? { label } : {}) })) } })));
        modern ||= prioritized;
        continue;
      }
      const life = rule.substitute.from === "LIFE_TOP" ? topLifeCostOperation(board, at.player, "TO_HAND") : null;
      if (rule.substitute.from === "LIFE_TOP" && life?.kind !== "move") continue;
      const substitute: Move = life?.kind === "move" ? { ...life, cause: "EFFECT_MOVE" } :
        { ...move, cause: "EFFECT_MOVE", to: { player: at.player, zone: rule.substitute.to, position: "append", faceUp: true, rotated: false } };
      if (!allowed(substitute, alternateCause)) continue;
      ensureMove(!definition.definition.replacementEffects?.some(next => next.id !== rule.id && matches(next, substitute, at.player)),
        "v3-replacement-chain-unresolved");
      plans.push(freezeMovement(structuredClone({ ...base, substitute })));
      modern ||= prioritized;
    }
    if (modern) return plans.map(plan => freezeMovement({ ...plan, priority:
      plan.cause.source?.instanceId === identity.source.instanceId && plan.cause.source.generation === identity.source.generation ? 0 :
        plan.chooser === activePlayer ? 1 : 2 }));
    ensureMove(plans.length < 2 || plans.every(plan => plan.payment), "v3-replacement-conflict-unresolved");
    return plans;
  }
  return [];
}

export function verifyReplacementOutcome(before: MovementState, result: TransactionResult, plan: ReplacementPlan, payment?: Move): string {
  const operation = plan.substitute ?? payment;
  ensureMove(operation, "v3-replacement-operation-required");
  if (operation.kind === "setRest") {
    const event = result.events.find(row => row.kind === "restChanged" && row.before && sameRef(row.before, operation.card));
    const occurrence = event && movementOccurrence(event);
    ensureMove(plan.group && event?.before?.rotated === false && event.after?.rotated === true && sameRef(event.after, operation.card) &&
      occurrence?.transactionId === plan.candidateId && occurrence.before.revision === before.revision && occurrence.after === result.state &&
      !result.prevented.length && result.events.length === 1 && JSON.stringify(event.cause) === JSON.stringify(plan.cause), "v3-replacement-rest-outcome");
    return occurrence.transactionId;
  }
  const { card, from, to } = operation;
  const root = result.events.filter(event => event.kind === "moved" && event.before?.instanceId === card.instanceId && event.before.generation === card.generation);
  const event = root[0], occurrence = event && movementOccurrence(event);
  ensureMove(root.length === 1 && event && occurrence && !result.prevented.length &&
    result.events.filter(row => row.isKO).length === Number(operation.cause === "EFFECT_KO" && !!plan.group) &&
    event.isKO === (operation.cause === "EFFECT_KO" && !!plan.group) &&
    occurrence.transactionId === plan.candidateId && occurrence.after === result.state && occurrence.before.matchId === before.matchId && occurrence.before.revision === before.revision &&
    event.after?.instanceId === card.instanceId && event.after.generation === card.generation + 1 &&
    event.from?.zone === from.zone && event.from.player === from.player && event.to?.zone === to.zone && event.to.player === to.player &&
    JSON.stringify(event.cause) === JSON.stringify(plan.cause), "v3-replacement-outcome-mismatch");
  if (plan.payment) {
    const target = getCard(result.state, plan.intent.operation.card), at = location(result.state, target.instanceId);
    const paid = plan.payment.cost.type === "DON_RETURN" ? to.zone === "donDeck" && plan.payment.cost.from.some(zone => zone === from.zone) :
      from.zone === "hand" && to.zone === "trash";
    ensureMove(result.events.length === 1 && paid && at.zone === "character" && at.player === plan.chooser,
      "v3-paid-replacement-outcome-mismatch");
  }
  return occurrence.transactionId;
}
