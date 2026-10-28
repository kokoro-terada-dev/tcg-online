import { createHash } from "node:crypto";
import { createMatch } from "../../game";
import type { DeckInput } from "../../protocol";
import { MatchMovementCapture } from "../matchMovement";
import { createProgression } from "../../progression/state";
import { applySystemEvent } from "../../progression/transitions";
import { compileV3CardJson } from "./compiler";
import { ApprovedV3Catalog } from "./approval";
import { V3SyntheticMatchCoordinator } from "./matchCoordinator";
import type { V3SessionView } from "./sessionProtocol";
import { ensureMove } from "../../movement/state";
const labels: Record<string, string> = { draw: "1枚ドロー", paidDraw: "任意発動・コストでドロー" };
export function createSyntheticSession(decks: readonly [DeckInput, DeckInput], firstPlayer: 0 | 1, key: Uint8Array) {
  const match = createMatch(decks[0], decks[1]), imageAliases: Record<string, string> = {}, always = () => ({ type: "all", conditions: [] });
  const plans = ([0, 1] as const).map(actor => {
    const z = match.players[actor].zones, leader = z.leader[0]!, cardId = `V3-SESSION-LEADER-${actor}`;
    imageAliases[cardId] = leader.cardId; leader.cardId = cardId;
    for (let i = 0; i < 2; i++) z.activeDon.push({ ...z.donDeck.shift()!, faceUp: true, rotated: false });
    return compileV3CardJson(JSON.stringify({ schemaVersion: "3.0.0-subset.10", cardId, cardVersion: "session-fixture.1", name: "Synthetic session leader", cardType: "leader",
      baseStats: { cost: null, power: null, counter: null, life: null }, colors: [], traits: [], attributes: [], reviewStatus: "approved",
      source: { text: "Synthetic session only: draw once per object turn, or optionally rest one DON and discard one hand to draw. Not a real card or official ruling.", triggerText: "", displayIds: [cardId], datasetSha256: createHash("sha256").update("v3-session-fixture.1").digest("hex") },
      effects: ["draw", "paidDraw"].map(id => ({ id, kind: "activated", timing: { type: "MAIN" }, sourceZones: ["leader"], optional: id === "paidDraw", usageLimit: { type: "PER_TURN", scope: "SOURCE_OBJECT", count: 1 },
        activationConditions: always(), resolutionConditions: always(), costs: id === "paidDraw" ? [{ type: "REST_DON", count: 1 }, { type: "DISCARD_HAND", count: 1 }] : [], actions: [{ type: "DRAW", player: "SELF", count: 1 }] })) }));
  });
  const mainIds = new Set<string>();
  for (const actor of [0, 1] as const) for (const zone of ["deck", "hand", "life"] as const) for (const object of match.players[actor].zones[zone]) {
    if (!object || object.kind !== "character" && object.kind !== "stage") continue;
    const originalId = object.cardId, kind = object.kind, cardId = `V3-SESSION-MAIN-${createHash("sha256").update(JSON.stringify([kind, originalId])).digest("hex")}`;
    ensureMove(!imageAliases[cardId] || imageAliases[cardId] === originalId, "v3-session-image-alias-conflict"); imageAliases[cardId] = originalId; object.cardId = cardId;
    if (mainIds.has(cardId)) continue; mainIds.add(cardId);
    plans.push(compileV3CardJson(JSON.stringify({ schemaVersion: "3.0.0-subset.10", cardId, cardVersion: "session-vanilla.1", name: `Synthetic ${kind}`, cardType: kind,
      baseStats: { cost: kind === "character" ? 2 : 1, power: kind === "character" ? 2000 : null, counter: kind === "character" ? 1000 : 0, life: null },
      colors: [], traits: [], attributes: [], reviewStatus: "approved", effects: [],
      source: { text: "", triggerText: "", displayIds: [cardId], datasetSha256: createHash("sha256").update("v3-session-vanilla.1").digest("hex") } })));
  }
  const rulesetVersion = "synthetic-session.1", catalog = new ApprovedV3Catalog(plans, plans.map(plan => ({ status: "approved", cardId: plan.definition.cardId, cardVersion: plan.definition.cardVersion,
    definitionHash: plan.definitionHash, sourceHash: plan.sourceHash, compilerVersion: plan.compilerVersion, registryHash: plan.registryHash, rulesetVersion,
    reviewer: "synthetic-session-fixture-code", approvedAt: "2026-10-29T00:00:00.000Z", ruleEvidence: ["synthetic-session:not-official-card-rulings"] })), rulesetVersion);
  const cards = plans.map(plan => catalog.get(plan.definition.cardId)!);
  let progression = createProgression(firstPlayer);
  while (true) {
    progression = applySystemEvent(progression, progression.revision, { kind: "settlePhase", phaseToken: progression.phaseToken });
    if (progression.phase === "main") break;
    progression = applySystemEvent(progression, progression.revision, { kind: "advancePhase", phaseToken: progression.phaseToken });
  }
  const movement = new MatchMovementCapture(match, 1).snapshot().movement;
  const sources = ([0, 1] as const).map(actor => ({ instanceId: movement.players[actor].leader[0]!, generation: 0 }));
  const coordinator = new V3SyntheticMatchCoordinator({ mode: "syntheticNoAbilities", movement, progression, cards, signingKey: key, master: null });
  return { matchId: match.id, coordinator, imageAliases, sources };
}
export type SyntheticSession = ReturnType<typeof createSyntheticSession>;
export function sessionView(session: SyntheticSession, roomId: string, actor: 0 | 1): V3SessionView {
  const view = session.coordinator.viewFor(actor);
  const visibleIds = new Set(view.movement.players.flatMap(zones => Object.values(zones).flatMap(cards => cards.flatMap(card => card?.cardId ? [card.cardId] : []))));
  const imageAliases = Object.fromEntries(Object.entries(session.imageAliases).filter(([id]) => visibleIds.has(id)));
  return { ...view, matchId: session.matchId, roomId, localPlayerIndex: actor, imageAliases,
    workType: session.coordinator.pendingWorkKind(),
    effects: session.coordinator.effectsFor(actor, session.sources[actor]!).map(effect => ({ ...effect, label: labels[effect.effectId]! })), playableCards: session.coordinator.playableCardsFor(actor) };
}
