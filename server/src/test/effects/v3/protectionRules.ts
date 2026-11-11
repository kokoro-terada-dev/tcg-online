import { visibleTo } from "../../movement/engine";
import { ensureMove, getCard, location } from "../../movement/state";
import type { MovementRules, MovementState, Player, Proposal } from "../../movement/types";
import type { CardObjectRef } from "../types";
import type { ApprovedV3Card } from "./approval";
import { protectionDecision } from "./continuousEffects";
import { createDerivedCardFactsReader, UNKNOWN } from "./readContext";
import type { KeywordGrants } from "./keywordEffects";

type Ref = Readonly<CardObjectRef>;
type Decision = boolean | "unknown";
export function hasProtection(definitions: ReadonlyMap<string, ApprovedV3Card>): boolean {
  return [...definitions.values()].some(card => card.definition.continuousEffects?.some(effect => effect.operation.type === "RESTRICT"));
}

export function protectionReader(board: MovementState, definitions: ReadonlyMap<string, ApprovedV3Card>, activePlayer: Player, grants: KeywordGrants = []) {
  const facts = createDerivedCardFactsReader({ board: () => board, definitions, activePlayer, statEffects: () => [], keywordGrants: () => grants });
  return (target: Ref, actor: Player, policy: Parameters<typeof protectionDecision>[3], cause?: "EFFECT" | "BATTLE", source?: Ref | null): Decision => {
    const card = getCard(board, target), at = location(board, target.instanceId);
    if (!["leader", "character", "stage"].includes(at.zone) || !card.faceUp || card.kind !== at.zone ||
      !visibleTo(board, card, at, 0) || !visibleTo(board, card, at, 1)) return false;
    const info = facts(target, at.player);
    if (info === UNKNOWN) return "unknown";
    let attributes: readonly string[] | undefined;
    if (cause === "BATTLE" && source) {
      const attacker = facts(source, at.player);
      if (attacker !== UNKNOWN && attacker.metadata.printed.attributes !== UNKNOWN) attributes = attacker.metadata.printed.attributes;
    }
    return protectionDecision(info.protections, card.controller, actor, policy, cause, attributes);
  };
}

export function protectionRules(board: MovementState, definitions: ReadonlyMap<string, ApprovedV3Card>, activePlayer: Player,
  mode: "effect" | "cost" | "rule", grants: KeywordGrants = []): MovementRules {
  if (mode === "cost" || !hasProtection(definitions)) return { status: "certifiedNone" };
  const initial = protectionReader(board, definitions, activePlayer, grants);
  const decision = (proposal: Proposal, read: ReturnType<typeof protectionReader>): Decision => {
    const { card, cause, from, to } = proposal;
    if (!card || !from || proposal.automatic) return false;
    const target = { instanceId: card.instanceId, generation: card.generation };
    if (mode === "rule") return cause.kind === "BATTLE_KO" ? read(target, cause.actor, "CANNOT_KO", "BATTLE", cause.source) : false;
    const controller = cause.effectController;
    if (controller === null || !["move", "setRest"].includes(proposal.kind)) return false;
    const immune = read(target, controller, "UNAFFECTED_BY");
    const ko = cause.kind === "EFFECT_KO" ? read(target, controller, "CANNOT_KO", "EFFECT") : false;
    const move = proposal.kind === "move" && to && (from.zone !== to.zone || from.player !== to.player) ?
      read(target, controller, "PREVENT_MOVE") : false;
    return [immune, ko, move].includes(true) ? true : [immune, ko, move].includes("unknown") ? "unknown" : false;
  };
  return { status: "evaluate", check(proposal, draft) {
    const before = decision(proposal, initial);
    ensureMove(before !== "unknown", "v3-protection-unknown");
    // A batch whose own moves alter the outcome needs a separate timing ruling.
    if (proposal.operationIndex > 0) ensureMove(decision(proposal, protectionReader(draft, definitions, activePlayer, grants)) === before, "v3-protection-batch-order-unresolved");
    return { kind: before ? "prevent" : "allow" };
  } };
}
