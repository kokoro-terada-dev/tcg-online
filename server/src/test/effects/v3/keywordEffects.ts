import { createHash } from "node:crypto";
import { dataArray, dataObject, ensureMove, freezeMovement, getCard, location, reference } from "../../movement/state";
import type { MovementState } from "../../movement/types";
import type { CardObjectRef, DeepReadonly } from "../types";
import type { Node } from "./dsl";
import type { ApprovedV3Card } from "./approval";
export type Keyword = Node<"keyword">["type"];
export type KeywordGrant = Readonly<{ id: string; target: Readonly<CardObjectRef>; source: Readonly<CardObjectRef>; actor: 0 | 1; keyword: Keyword; endPlayer: 0 | 1; remaining: 1 | 2 }>;
export type KeywordGrants = readonly KeywordGrant[];
export function validateKeywordGrants(board: MovementState, grants: KeywordGrants): KeywordGrants {
  dataArray(grants, 256); const ids = new Set<string>();
  for (const grant of grants) {
    dataObject(grant, ["id", "target", "source", "actor", "keyword", "endPlayer", "remaining"]); reference(grant.target); reference(grant.source);
    const card = getCard(board, grant.target), at = location(board, card.instanceId);
    ensureMove(typeof grant.id === "string" && /^[a-f0-9]{64}$/.test(grant.id) && !ids.has(grant.id) && card.faceUp && card.kind === at.zone &&
      (card.kind === "character" || card.kind === "leader") && (grant.actor === 0 || grant.actor === 1) && (grant.endPlayer === 0 || grant.endPlayer === 1) &&
      (grant.remaining === 1 || grant.remaining === 2) && ["BLOCKER", "RUSH", "RUSH_CHARACTER", "CANNOT_BE_BLOCKED"].includes(grant.keyword) &&
      (card.kind === "character" || grant.keyword !== "RUSH" && grant.keyword !== "RUSH_CHARACTER"), "v3-invalid-keyword-grant"); ids.add(grant.id);
  }
  return freezeMovement(structuredClone(grants));
}
export function pruneKeywordGrants(board: MovementState, grants: KeywordGrants): KeywordGrants {
  return freezeMovement(grants.filter(grant => { const card = board.cards[grant.target.instanceId]; return card?.generation === grant.target.generation && ["leader", "character"].includes(location(board, card.instanceId).zone); }));
}
export function addKeywordGrants(board: MovementState, grants: KeywordGrants, workId: string, source: Readonly<CardObjectRef>, actor: 0 | 1,
  targets: readonly Readonly<CardObjectRef>[], keyword: DeepReadonly<Node<"keyword">>, duration: DeepReadonly<Node<"duration">>, definitions: readonly ApprovedV3Card[]): KeywordGrants {
  ensureMove(targets.length > 0 && new Set(targets.map(ref => ref.instanceId)).size === targets.length && grants.length + targets.length <= 256, "v3-keyword-grant-limit");
  const entries = targets.map(target => {
    const card = getCard(board, target), definition = definitions.find(known => known.definition.cardId === card.cardId);
    ensureMove(definition && definition.definition.cardType === card.kind && !card.modifierIds.length && !card.grantIds.length, "v3-keyword-target-unregistered");
    return { id: createHash("sha256").update(JSON.stringify([board.matchId, workId, target])).digest("hex"), target: { ...target }, source: { ...source }, actor,
      keyword: keyword.type, endPlayer: duration.player === "SELF" ? actor : (1 - actor) as 0 | 1, remaining: duration.occurrence };
  });
  return validateKeywordGrants(board, [...grants, ...entries]);
}
export function endTurnKeywordGrants(grants: KeywordGrants, player: 0 | 1): KeywordGrants {
  return freezeMovement(grants.flatMap(grant => grant.endPlayer !== player ? [grant] : grant.remaining === 1 ? [] : [{ ...grant, remaining: 1 as const }]));
}
export function effectiveKeywords(board: MovementState, definitions: ReadonlyMap<string, ApprovedV3Card>, grants: KeywordGrants, ref: Readonly<CardObjectRef>): readonly Keyword[] {
  const card = getCard(board, ref), at = location(board, card.instanceId), known = definitions.get(card.cardId);
  ensureMove(known && known.definition.cardType === card.kind && !card.grantIds.length && card.faceUp && card.kind === at.zone && ["leader", "character"].includes(at.zone), "v3-keywords-unresolved");
  return [...new Set([...known.definition.keywords.map(keyword => keyword.type), ...grants.filter(grant => grant.target.instanceId === ref.instanceId && grant.target.generation === ref.generation).map(grant => grant.keyword)])];
}
