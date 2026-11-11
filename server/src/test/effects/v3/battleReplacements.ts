import { visibleTo } from "../../movement/engine";
import { ensureMove } from "../../movement/state";
import type { MovementOperation, MovementState, Player } from "../../movement/types";
import type { CardObjectRef } from "../types";
import type { ApprovedV3Card } from "./approval";
import { effectsDisabled, type KeywordGrants } from "./keywordEffects";
import { protectionRules } from "./protectionRules";
import { planReplacements, type ReplacementPlan } from "./replacementPlans";

type Move = Extract<MovementOperation, { kind: "move" }>;
type EnvironmentFor = Parameters<typeof planReplacements>[6];
export type BattleReplacement = Readonly<{ id: string; cardId: string; label: string; source: Readonly<CardObjectRef>;
  operation: Move; plan?: ReplacementPlan }>;

export function battleReplacementCandidates(board: MovementState, intent: "BATTLE_KO" | "DAMAGE", battleId: string,
  attacker: Player, defender: Player, attackSource: Readonly<CardObjectRef>, target: Readonly<CardObjectRef>,
  definitions: ReadonlyMap<string, ApprovedV3Card>, activePlayer: Player, environmentFor: EnvironmentFor,
  used: (key: string) => boolean, grants: KeywordGrants): BattleReplacement[] {
  if (intent === "BATTLE_KO") {
    const move: Move = { kind: "move", card: target, from: { player: defender, zone: "character" },
      to: { player: defender, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "BATTLE_KO" };
    return planReplacements(board, `battle:${battleId}`, {
      matchId: board.matchId, resolutionId: battleId, effectId: "battle-ko", actor: attacker, source: attackSource
    }, [move], definitions, activePlayer, environmentFor, used, grants).flatMap(plan =>
      plan.substitute && plan.cause.source ? [{ id: plan.candidateId, cardId: plan.sourceCardId,
        label: `${plan.sourceLabel}：ライフを手札へ`, source: plan.cause.source, operation: plan.substitute, plan }] : []);
  }
  const rules = protectionRules(board, definitions, activePlayer, "effect", grants);
  return board.players[defender].character.flatMap(id => {
    const card = id === null ? undefined : board.cards[id], definition = card && definitions.get(card.cardId);
    const from = { player: defender, zone: "character" as const };
    if (!card || !definition || card.kind !== "character" || card.owner !== defender || card.controller !== defender ||
      !card.faceUp || !visibleTo(board, card, from, 0) || !visibleTo(board, card, from, 1) || effectsDisabled(grants, card)) return [];
    const source = { instanceId: card.instanceId, generation: card.generation };
    return (definition.definition.replacementEffects ?? []).flatMap(rule => {
      if (rule.match.cause !== "DAMAGE" || !("to" in rule.substitute) || rule.substitute.to !== "trash" || rule.substitute.from !== "SOURCE") return [];
      const eligible = environmentFor(rule.id, definition, defender, source).evaluate(rule.condition, {});
      ensureMove(eligible !== "unknown", "v3-replacement-condition-unknown");
      if (!eligible) return [];
      const operation: Move = { kind: "move", card: source, from,
        to: { player: defender, zone: "trash", position: "append", faceUp: true, rotated: false }, cause: "EFFECT_MOVE" };
      const cause = { kind: "EFFECT_MOVE" as const, actor: defender, effectController: defender, source, resolutionId: battleId, parentEventId: null };
      if (rules.status === "evaluate" && rules.check({ kind: "move", operationIndex: 0, card, from, to: operation.to, cause, automatic: false }, board).kind !== "allow") return [];
      return [{ id: JSON.stringify([source, rule.id]), cardId: card.cardId, label: `${definition.definition.name}をトラッシュへ`, source, operation }];
    });
  });
}
