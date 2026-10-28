import { performance } from "node:perf_hooks";
import type { Server, Socket } from "socket.io";
import { EffectCommandHost, type EffectCommandResponse, type EffectTransportView } from "./effectCommandHost";
import type { Player } from "../movement/types";
import { OwnedEffectEndpoint, OwnedEffectUnavailable } from "./ownedEffectEndpoint";
import type { EffectCatalogView } from "../effectProtocol";

export const EFFECT_SOCKET_LIMITS = Object.freeze({ requests: 60, windowMs: 10000 });
export type EffectSocketMembership = Readonly<{
  host: EffectCommandHost | OwnedEffectEndpoint; actor: Player; socketIds: readonly [string, string];
}>;
export type EffectSocketResolver = (socketId: string) => EffectSocketMembership | null;
export type EffectSocketFailure = Readonly<{ ok: false; code: "not_available" | "rate_limited" | "internal_error" }>;
export type EffectSocketSyncResponse = Readonly<{ ok: true; view: EffectTransportView }> | EffectSocketFailure;
export type EffectSocketCommandResponse = EffectCommandResponse | EffectSocketFailure;
export type EffectSocketCatalogResponse = Readonly<{ ok: true; catalog: EffectCatalogView }> | EffectSocketFailure | Readonly<{ ok: false; code: "query_rejected" }>;
type Checked = EffectSocketMembership & Readonly<{ peers: readonly [Socket, Socket] }>;
const attached = new WeakSet<Socket>();

// The resolver is synchronous, server-owned, and side-effect free. No payload selects a room or seat.
export function bindEffectSocket(io: Server, socket: Socket, resolve: EffectSocketResolver,
  options: Readonly<{ now?: () => number }> = {}): () => void {
  if (attached.has(socket) || socket.nsp !== io.of("/") || io.sockets.sockets.get(socket.id) !== socket) throw new Error("invalid-or-duplicate-effect-socket-binding");
  const now = options.now ?? (() => performance.now());
  let windowStart = now(), requests = 0, disposed = false;
  if (!Number.isFinite(windowStart)) throw new Error("invalid-effect-socket-clock");
  function permitted(): boolean {
    const time = now();
    if (!Number.isFinite(time) || time < windowStart) return false;
    if (time - windowStart >= EFFECT_SOCKET_LIMITS.windowMs) { windowStart = time; requests = 0; }
    if (requests >= EFFECT_SOCKET_LIMITS.requests) return false;
    requests++; return true;
  }
  function membership(): Checked | null {
    try {
      const own = resolve(socket.id);
      if (!socket.connected || !own || (!(own.host instanceof EffectCommandHost) && !(own.host instanceof OwnedEffectEndpoint)) || (own.actor !== 0 && own.actor !== 1) ||
        own.socketIds.length !== 2 || own.socketIds[0] === own.socketIds[1] || own.socketIds[own.actor] !== socket.id) return null;
      if (own.host instanceof OwnedEffectEndpoint && !own.host.available()) return null;
      const ids: [string, string] = [own.socketIds[0], own.socketIds[1]];
      const peers: Socket[] = [];
      for (const actor of [0, 1] as const) {
        const peer = io.sockets.sockets.get(ids[actor]), entry = resolve(ids[actor]);
        if (!peer?.connected || !entry || entry.host !== own.host || entry.actor !== actor ||
          entry.socketIds[0] !== ids[0] || entry.socketIds[1] !== ids[1]) return null;
        peers.push(peer);
      }
      return { host: own.host, actor: own.actor, socketIds: ids, peers: peers as [Socket, Socket] };
    } catch { return null; }
  }
  function same(a: Checked, b: Checked | null): b is Checked {
    return b !== null && a.host === b.host && a.actor === b.actor && a.socketIds[0] === b.socketIds[0] && a.socketIds[1] === b.socketIds[1];
  }
  function stamp(view: EffectTransportView): string {
    return JSON.stringify([view.effect.resolutionId, view.movement.revision, view.progression.revision, view.effect.status, view.effect.completedSteps]);
  }
  const unavailable = (): EffectSocketFailure => ({ ok: false, code: "not_available" });
  function catalog(input: unknown, reply?: (value: EffectSocketCatalogResponse) => void): void {
    if (disposed || typeof reply !== "function") return;
    try {
      if (!permitted()) { reply({ ok: false, code: "rate_limited" }); return; }
      const context = membership();
      if (!context || !(context.host instanceof OwnedEffectEndpoint)) { reply(unavailable()); return; }
      const result = context.host.catalogFor(context.actor, input);
      reply(same(context, membership()) ? { ok: true, catalog: result } : unavailable());
    } catch { reply({ ok: false, code: "query_rejected" }); }
  }
  function sync(reply?: (value: EffectSocketSyncResponse) => void): void {
    if (disposed || typeof reply !== "function") return;
    try {
      if (!permitted()) { reply({ ok: false, code: "rate_limited" }); return; }
      const context = membership();
      if (!context) { reply(unavailable()); return; }
      const view = context.host.viewFor(context.actor);
      reply(same(context, membership()) ? { ok: true, view } : unavailable());
    } catch (error) { reply(error instanceof OwnedEffectUnavailable ? unavailable() : { ok: false, code: "internal_error" }); }
  }
  function command(input: unknown, reply?: (value: EffectSocketCommandResponse) => void): void {
    if (disposed || typeof reply !== "function") return;
    try {
      if (!permitted()) { reply({ ok: false, code: "rate_limited" }); return; }
      const context = membership();
      if (!context) { reply(unavailable()); return; }
      const before = stamp(context.host.viewFor(context.actor));
      const response = context.host.handle(context.actor, input), current = membership();
      if (!same(context, current)) { reply(unavailable()); return; }
      if (before !== stamp(response.view)) {
        const views = [context.host.viewFor(0), context.host.viewFor(1)] as const;
        // Emit to server Socket objects, never to a client-supplied room name.
        current.peers[0].emit("test-effect:state", views[0]);
        current.peers[1].emit("test-effect:state", views[1]);
      }
      reply(response);
    } catch (error) { reply(error instanceof OwnedEffectUnavailable ? unavailable() : { ok: false, code: "internal_error" }); }
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    socket.off("test-effect:sync", sync); socket.off("test-effect:command", command); socket.off("disconnect", dispose);
    socket.off("test-effect:catalog", catalog);
    attached.delete(socket);
  }
  attached.add(socket);
  socket.on("test-effect:sync", sync); socket.on("test-effect:command", command); socket.on("disconnect", dispose);
  socket.on("test-effect:catalog", catalog);
  return dispose;
}
