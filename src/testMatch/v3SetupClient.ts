import type { V3SetupView } from "../../server/src/test/effects/v3/setupProtocol";

export function acceptV3SetupView(current: V3SetupView | null, next: V3SetupView, matchId: string | null): boolean {
  if (next.mode !== "v3-reviewed-setup" || next.matchId !== matchId || next.movement.matchId !== next.matchId || !Number.isSafeInteger(next.revision)) return false;
  return !current || next.matchId === current.matchId && next.localPlayerIndex === current.localPlayerIndex && next.revision >= current.revision && next.movement.revision >= current.movement.revision;
}
export function v3SetupCommand(view: V3SetupView, kind: "first" | "mulligan", value: "first" | "second" | boolean, requestId: string) {
  if (kind === "first") {
    if (view.status !== "firstChoice" || view.choicePlayer !== view.localPlayerIndex || value !== "first" && value !== "second") throw Error("First-player choice is unavailable");
  } else if (view.status !== "mulligan" || view.mulliganPlayer !== view.localPlayerIndex || typeof value !== "boolean") throw Error("Mulligan choice is unavailable");
  return { matchId: view.matchId, revision: view.revision, requestId, kind, value };
}
