import { createHash } from "node:crypto";
import { visibleTo } from "../../movement/engine";
import { movementOccurrence } from "../../movement/occurrence";
import { ensureMove, freezeMovement, getCard, location } from "../../movement/state";
import type { EventCause, MovementOperation, MovementState, Player, TransactionResult } from "../../movement/types";
import type { DeepReadonly } from "../types";
import type { ApprovedV3Card } from "./approval";
import type { Node } from "./dsl";
import { protectionRules } from "./protectionRules";
import type { ResolutionIdentity } from "./resolution";

type Move = Extract<MovementOperation, { kind: "move" }>;
type Rule = DeepReadonly<Node<"replacement">>;
export type ReplacementPlan = DeepReadonly<{
  intent: { id: string; workId: string; worldRevision: number; identity: ResolutionIdentity; operation: Move; cause: EventCause };
  candidateId: string; ruleId: string; definitionHash: string; chooser: Player;
  substitute: Move; cause: EventCause;
}>;
export type ReplacementAnswer = Readonly<{ plan: ReplacementPlan; decision: "accepted" | "declined" }>;
const hash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

function matches(rule: Rule, move: Move, actor: Player): boolean {
  const match = rule.match;
  return move.cause === match.cause && move.from.zone === match.from && move.to.zone === match.to &&
    (match.by === "ANY" || (move.from.player === actor ? match.by === "SELF" : match.by === "OPPONENT"));
}

export function planReplacement(board: MovementState, workId: string, identity: ResolutionIdentity, operations: readonly MovementOperation[],
  definitions: ReadonlyMap<string, ApprovedV3Card>, activePlayer: Player,
  evaluate: (rule: Rule, card: ApprovedV3Card, actor: Player, source: Move["card"]) => boolean | "unknown"): ReplacementPlan | null {
  let rules: ReturnType<typeof protectionRules> | undefined;
  function allowed(move: Move, cause: EventCause): boolean {
    rules ??= protectionRules(board, definitions, activePlayer, "effect");
    if (rules.status === "certifiedNone") return true;
    ensureMove(rules.status === "evaluate", "v3-replacement-protection-unresolved");
    const result = rules.check({ kind: "move", operationIndex: 0, card: getCard(board, move.card),
      from: move.from, to: move.to, automatic: false, cause }, board).kind;
    ensureMove(result !== "defer", "v3-replacement-protection-unresolved");
    return result === "allow";
  }
  for (const move of operations) {
    if (move.kind !== "move" || move.from.zone !== "character") continue;
    const object = getCard(board, move.card), at = location(board, object.instanceId), definition = definitions.get(object.cardId);
    if (!definition?.definition.replacementEffects?.length) continue;
    ensureMove(at.player === move.from.player && at.zone === move.from.zone, "v3-replacement-stale-source");
    if (object.kind !== "character" || object.owner !== at.player || object.controller !== at.player ||
      !object.faceUp || !visibleTo(board, object, at, 0) || !visibleTo(board, object, at, 1)) continue;
    const candidates = definition.definition.replacementEffects.filter(rule => matches(rule, move, identity.actor));
    if (!candidates.length) continue;
    ensureMove(operations.length === 1, "v3-replacement-batch-unresolved");
    const cause: EventCause = { kind: move.cause, actor: identity.actor, effectController: identity.actor, source: identity.source,
      resolutionId: identity.resolutionId, parentEventId: null };
    if (!allowed(move, cause)) return null;
    const intent = { workId, worldRevision: board.revision, identity, operation: move, cause };
    const intentId = hash(intent);
    let plan: ReplacementPlan | null = null;
    for (const rule of candidates) {
      const valid = evaluate(rule, definition, at.player, move.card);
      ensureMove(valid !== "unknown", "v3-replacement-condition-unknown");
      if (!valid) continue;
      const substitute: Move = { ...move, cause: "EFFECT_MOVE", to: { player: at.player, zone: rule.substitute.to, position: "append", faceUp: true, rotated: false } };
      const candidateId = hash([intentId, definition.definitionHash, rule.id]);
      const alternateCause: EventCause = { kind: "EFFECT_MOVE", actor: at.player, effectController: at.player,
        source: move.card, resolutionId: candidateId, parentEventId: null };
      if (!allowed(substitute, alternateCause)) continue;
      ensureMove(!plan, "v3-replacement-conflict-unresolved");
      ensureMove(!definition.definition.replacementEffects.some(next => next.id !== rule.id && matches(next, substitute, at.player)),
        "v3-replacement-chain-unresolved");
      plan = freezeMovement(structuredClone({ intent: { ...intent, id: intentId }, candidateId, ruleId: rule.id,
        definitionHash: definition.definitionHash, chooser: at.player, substitute, cause: alternateCause }));
    }
    return plan;
  }
  return null;
}

export function verifyReplacementOutcome(before: MovementState, result: TransactionResult, plan: ReplacementPlan): string {
  const { card, from, to } = plan.substitute;
  const root = result.events.filter(event => event.kind === "moved" && event.before?.instanceId === card.instanceId && event.before.generation === card.generation);
  const event = root[0], occurrence = event && movementOccurrence(event);
  ensureMove(root.length === 1 && event && occurrence && !result.prevented.length && !result.events.some(row => row.isKO) &&
    occurrence.after === result.state && occurrence.before.matchId === before.matchId && occurrence.before.revision === before.revision &&
    event.after?.instanceId === card.instanceId && event.after.generation === card.generation + 1 &&
    event.from?.zone === from.zone && event.from.player === from.player && event.to?.zone === to.zone && event.to.player === to.player &&
    JSON.stringify(event.cause) === JSON.stringify(plan.cause), "v3-replacement-outcome-mismatch");
  return occurrence.transactionId;
}
