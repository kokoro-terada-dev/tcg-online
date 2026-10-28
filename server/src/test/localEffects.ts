import { createTestServer } from "./server";
import { EffectMatchOwner } from "./effects/effectMatchOwner";
import { createProgression } from "./progression/state";
import { applySystemEvent } from "./progression/transitions";

// Local UI fixture, not real card rules or a production match initializer.
export async function startLocalEffectServer(port = 3002) {
  if (process.env.NODE_ENV === "production") throw new Error("Local effect fixtures are disabled in production");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Invalid local effect port");
  const service = createTestServer({ effectFactory(match) {
    let progression = createProgression(0);
    while (true) {
      progression = applySystemEvent(progression, progression.revision, { kind: "settlePhase", phaseToken: progression.phaseToken });
      if (progression.phase === "main") break;
      progression = applySystemEvent(progression, progression.revision, { kind: "advancePhase", phaseToken: progression.phaseToken });
    }
    const owner = new EffectMatchOwner(match), source = match.players[0].zones.leader[0];
    if (!source) throw new Error("Missing fixture leader");
    owner.adopt(progression);
    owner.openEffect({ resolutionId: "local-fixture", actor: 0, source: { instanceId: source.id, generation: 0 } }, {
      dslVersion: 1, effectId: "LOCAL.discard-draw", cardId: source.cardId, trigger: { kind: "activate", window: "main" },
      costs: [{ kind: "moveCards", selector: { kind: "cards", chooser: "SELF", owner: "SELF", zones: ["hand"], min: 1, max: 1, mode: "SELECT" },
        destination: { owner: "SELF", zone: "trash", position: "append", visibility: "faceUp" } }],
      actions: [{ kind: "draw", player: "SELF", amount: 1 }],
    }, { status: "certifiedNone" });
    return owner;
  } });
  try {
    await new Promise<void>((resolve, reject) => { service.http.once("error", reject); service.http.listen(port, "127.0.0.1", resolve); });
  } catch (error) { await new Promise<void>(resolve => service.io.close(() => resolve())); throw error; }
  const address = service.http.address();
  if (!address || typeof address === "string") throw new Error("Local effect listener unavailable");
  return { ...service, url: `http://127.0.0.1:${address.port}` };
}

if (require.main === module) startLocalEffectServer().then(service => console.log(`LOCAL FIXTURE ONLY: ${service.url}`)).catch(error => {
  console.error(error instanceof Error ? error.message : "Local fixture failed"); process.exitCode = 1;
});
