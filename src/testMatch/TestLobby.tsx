import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type { CSSProperties } from "react";
import type { MatchCommand, MatchView, RoomView, DeckInput } from "../../server/src/test/protocol";
import { getAllLocalDeckRecipes } from "../utils/localDeckStorage";
import { getLocalCardImage, hasLocalCardImages } from "../utils/localCardImages";
import TestBoard from "./TestBoard";
import TestEffectBoard from "./TestEffectBoard";
import { acceptEffectView, acceptEffectCatalog, effectCatalogQuery, effectCommand, registeredEffectCommand, type EffectTransportView, type EffectCommandKind, type EffectCatalogView, type RegisteredEffectCommand } from "./effectClientState";

type Room = RoomView;
type Reply = { ok: boolean; error?: string };
const button: CSSProperties = { minHeight: "44px", borderRadius: "6px", border: "1px solid #64748b", background: "#0369a1", color: "white", fontWeight: 700, padding: "10px 14px", cursor: "pointer" };
const serverUrl = import.meta.env.VITE_TEST_SERVER_URL?.trim() ||
  (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:3001` : "");

export default function TestLobby({ onBack }: { onBack: () => void }) {
  const socketRef = useRef<Socket | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [match, setMatch] = useState<MatchView | null>(null);
  const [effect, setEffect] = useState<EffectTransportView | null>(null);
  const [needsSync, setNeedsSync] = useState(false);
  const effectRef = useRef<EffectTransportView | null>(null), roomRef = useRef<Room | null>(null);
  const activeMatchId = useRef<string | null>(null), retiredMatches = useRef(new Set<string>()), retiredEffects = useRef(new Set<string>());
  const epoch = useRef(0), effectFlight = useRef(false);
  const [deckId, setDeckId] = useState("");
  const [decks] = useState(getAllLocalDeckRecipes);
  function resetMatch() {
    if (activeMatchId.current) retiredMatches.current.add(activeMatchId.current);
    activeMatchId.current = null; effectRef.current = null; epoch.current++; effectFlight.current = false;
    setEffect(null); setMatch(null); setNeedsSync(false); setBusy(false);
  }
  function receiveEffect(next: EffectTransportView) {
    if (!roomRef.current?.inMatch || retiredMatches.current.has(next.matchId) || retiredEffects.current.has(`${next.matchId}:${next.effect.resolutionId}`) ||
      (activeMatchId.current !== null && activeMatchId.current !== next.matchId) || !acceptEffectView(effectRef.current, next)) return;
    const previous = effectRef.current;
    if (previous && previous.effect.resolutionId !== next.effect.resolutionId) retiredEffects.current.add(`${previous.matchId}:${previous.effect.resolutionId}`);
    activeMatchId.current = next.matchId; effectRef.current = next; setEffect(next); setMatch(null); setNeedsSync(false);
  }
  useEffect(() => {
    if (!serverUrl) return;
    const socket = io(serverUrl, { autoConnect: false, timeout: 60000, reconnection: false });
    socketRef.current = socket;
    socket.on("test-room:state", (next: Room) => { roomRef.current = next; setRoom(next); setMessage(""); setError(""); });
    socket.on("test-room:closed", (text: string) => { roomRef.current = null; setRoom(null); resetMatch(); setDeckId(""); setMessage(text); });
    socket.on("test-match:state", (next: MatchView) => {
      if (!roomRef.current?.inMatch || effectRef.current || retiredMatches.current.has(next.matchId) || (activeMatchId.current && activeMatchId.current !== next.matchId)) return;
      activeMatchId.current = next.matchId;
      setMatch(current => current?.matchId === next.matchId && current.revision > next.revision ? current : next);
    });
    socket.on("test-effect:state", receiveEffect);
    socket.on("test-match:ended", (text: string) => { resetMatch(); setMessage(text); });
    socket.on("connect_error", () => { setBusy(false); setError("テストサーバーに接続できません。起動状態と接続先を確認してください。"); });
    socket.on("disconnect", () => { roomRef.current = null; setRoom(null); resetMatch(); setDeckId(""); setError("接続が切れました。ルームを作成または入室し直してください。"); });
    return () => { socket.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, []);

  function request(event: string, value?: unknown) {
    const socket = socketRef.current;
    if (!socket || busy) return;
    setBusy(true); setError(""); setMessage("接続・応答を待っています...");
    const complete = (err: Error | null, reply?: Reply) => {
      if (socketRef.current !== socket) return;
      setBusy(false); setMessage("");
      if (err || !reply?.ok) {
        setError(reply?.error ?? "応答を受信できませんでした。再度お試しください。");
        if (err) { socket.disconnect(); setRoom(null); }
      } else if (event === "test-room:leave") { roomRef.current = null; setRoom(null); resetMatch(); setDeckId(""); }
    };
    socket.connect();
    if (value === undefined) socket.timeout(75000).emit(event, complete);
    else socket.timeout(75000).emit(event, value, complete);
  }
  function effectRequest(kind?: EffectCommandKind, tokens?: readonly string[], activation?: RegisteredEffectCommand) {
    const socket = socketRef.current, current = effectRef.current;
    if (!socket?.connected || !current || busy || effectFlight.current || (kind !== undefined && current.effect.status === "idle") || ((kind !== undefined || activation) && needsSync)) return;
    const sentEpoch = epoch.current, resolutionId = current.effect.resolutionId;
    const value = activation ?? (kind === undefined ? undefined : effectCommand(current, kind, crypto.randomUUID(), tokens));
    effectFlight.current = true; setBusy(true); setError("");
    const complete = (err: Error | null, reply?: { ok: boolean; code?: string; view?: EffectTransportView }) => {
      if (socketRef.current !== socket || epoch.current !== sentEpoch) return;
      effectFlight.current = false; setBusy(false);
      if (!activation && effectRef.current?.effect.resolutionId !== resolutionId) return;
      if (err || !reply?.view) { setNeedsSync(true); setError("応答を確認できません。再同期してください。"); return; }
      receiveEffect(reply.view);
      if (!reply.ok) setError(reply.code === "selection_retry" ? "この組み合わせでは支払えません。選び直してください。" : "操作できませんでした。最新の状態を確認してください。");
    };
    if (value === undefined) socket.timeout(10000).emit("test-effect:sync", complete);
    else socket.timeout(10000).emit("test-effect:command", value, complete);
  }
  async function queryCatalog(instanceId: string): Promise<EffectCatalogView> {
    const socket = socketRef.current, current = effectRef.current, sentEpoch = epoch.current;
    if (!socket?.connected || !current || busy || needsSync) throw new Error("Catalog unavailable");
    const query = effectCatalogQuery(current, instanceId);
    return new Promise((resolve, reject) => socket.timeout(10000).emit("test-effect:catalog", query,
      (err: Error | null, reply?: { ok: boolean; catalog?: EffectCatalogView }) => {
        const latest = effectRef.current;
        if (err || !reply?.ok || !reply.catalog || socketRef.current !== socket || epoch.current !== sentEpoch ||
          !latest || latest.effect.resolutionId !== current.effect.resolutionId || !acceptEffectCatalog(latest, query, reply.catalog)) {
          reject(new Error("Catalog unavailable")); return;
        }
        resolve(reply.catalog);
      }));
  }
  function activateCatalog(catalog: EffectCatalogView, effectId: string) {
    const current = effectRef.current;
    if (!current) return;
    try { effectRequest(undefined, undefined, registeredEffectCommand(current, catalog, effectId, crypto.randomUUID())); }
    catch { setError("一覧が更新されています。カードを開き直してください。"); }
  }
  if (effect && room) return <TestEffectBoard key={effect.matchId} view={effect} roomId={room.roomId} busy={busy} error={error} needsSync={needsSync} onAction={effectRequest} onSync={() => effectRequest()} onEnd={() => request("test-match:end")} onCatalog={queryCatalog} onActivateCatalog={activateCatalog} />;
  const mine = room?.host.socketId === socketRef.current?.id ? room?.host : room?.guest;
  function selectDeck(id: string) {
    const deck = decks.find((item) => item.id === id);
    if (!deck?.leaderCardId || deck.mainDeck.length !== 50 || deck.donDeck.length !== 10) { setError("リーダー・メイン50枚・DON10枚のデッキを選択してください"); return; }
    if (!hasLocalCardImages() || [deck.leaderCardId, ...deck.mainDeck].some((cardId) => !getLocalCardImage(cardId))) {
      setError("トップページで、このデッキに必要な画像ZIPを読み込んでください"); return;
    }
    setDeckId(id);
    const recipe: DeckInput = { name: deck.name, leaderCardId: deck.leaderCardId, mainDeck: deck.mainDeck, donDeck: deck.donDeck, cardTypes: Object.fromEntries(deck.mainDeck.map((cardId) => [cardId, deck.cardTypes[cardId] ?? "character"])), leaderLifeCount: deck.leaderLifeCount ?? 5 };
    request("test-room:deck", recipe);
  }
  if (match && room) return <TestBoard key={match.matchId} match={match} roomId={room.roomId} busy={busy} error={error} onCommand={(command: MatchCommand) => request("test-match:command", command)} onEnd={() => request("test-match:end")} />;
  return <main style={{ height: "100dvh", overflowY: "auto", touchAction: "pan-y", padding: "16px", background: "var(--app-background, #0f172a)", color: "white" }}>
    <div style={{ maxWidth: "480px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><h1 style={{ fontSize: "22px" }}>テスト対戦</h1><button style={button} onClick={onBack}>戻る</button></header>
      {!serverUrl && <p role="alert">テストサーバーの接続先が未設定です。</p>}
      {!room ? <>
        <button style={button} disabled={busy || !serverUrl} onClick={() => request("test-room:create")}>ルーム作成</button>
        <form onSubmit={(event) => { event.preventDefault(); if (/^\d{4}$/.test(code)) request("test-room:join", code); }} style={{ display: "flex", gap: "8px" }}>
          <input aria-label="テストルームコード" placeholder="4桁のコード" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} style={{ minWidth: 0, flex: 1, fontSize: "16px", padding: "10px", borderRadius: "6px" }} />
          <button style={button} disabled={busy || !serverUrl || code.length !== 4}>入室</button>
        </form>
      </> : <>
        <div style={{ fontSize: "20px", fontWeight: 700 }}>ルームコード：{room.roomId}</div>
        <div style={{ padding: "16px 0", borderBlock: "1px solid #64748b", lineHeight: 2 }}>
          <div>ホスト：入室済み・{room.host.ready ? "READY" : "準備中"}<div>{room.host.deck?.name ?? "デッキ未選択"}</div></div>
          <div>ゲスト：{room.guest ? `入室済み・${room.guest.ready ? "READY" : "準備中"}` : "入室待ち"}<div>{room.guest?.deck?.name ?? "デッキ未選択"}</div></div>
        </div>
        <label>デッキ<select aria-label="使用デッキ" value={deckId} disabled={busy || room.inMatch} onChange={(event) => selectDeck(event.target.value)} style={{ width: "100%", fontSize: "16px", padding: "10px", marginTop: "8px" }}>
          <option value="">選択してください</option>
          {decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
        </select></label>
        <button style={{ ...button, background: mine?.ready ? "#166534" : "#0369a1" }} disabled={busy || !mine?.deck} onClick={() => request("test-room:ready", !mine?.ready)}>{mine?.ready ? "READY解除" : "READY"}</button>
        {room.host.ready && room.guest?.ready && <p role="status">両プレイヤー READY</p>}
        {room.host.socketId === socketRef.current?.id && <button style={button} disabled={busy || !room.host.ready || !room.guest?.ready || room.inMatch} onClick={() => request("test-match:start")}>対戦開始</button>}
        <button style={{ ...button, background: "#334155" }} disabled={busy} onClick={() => request("test-room:leave")}>退出</button>
      </>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
    </div>
  </main>;
}
