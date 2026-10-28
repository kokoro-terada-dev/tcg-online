import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { V3FixtureView, V3RoomView, V3Scenario } from "../../server/src/test/effects/v3/fixtureProtocol";
import { acceptV3View, v3BoardView, v3Command } from "./v3FixtureClient";
import { getAllLocalDeckRecipes } from "../utils/localDeckStorage";
import { getLocalCardImage } from "../utils/localCardImages";
import TestBoard from "./TestBoard";
import "./testEffect.css";
import "./v3Fixture.css";
const url = import.meta.env.VITE_TEST_SERVER_URL?.trim();
export default function V3FixtureLobby({ onBack }: { onBack: () => void }) {
  const socket = useRef<Socket | null>(null), roomRef = useRef<V3RoomView | null>(null), viewRef = useRef<V3FixtureView | null>(null), epoch = useRef(0), flight = useRef(false);
  const [room, setRoom] = useState<V3RoomView | null>(null), [view, setView] = useState<V3FixtureView | null>(null), [busy, setBusy] = useState(false), [needsSync, setNeedsSync] = useState(false);
  const [error, setError] = useState(""), [code, setCode] = useState(""), [scenario, setScenario] = useState<V3Scenario>("bounce"), [actor, setActor] = useState<0 | 1>(0), [deckId, setDeckId] = useState("");
  const [decks] = useState(getAllLocalDeckRecipes);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(false); }, [view?.frame.status, view?.frame.choice?.selectionId]);
  function receive(next: V3FixtureView) {
    if (!acceptV3View(viewRef.current, next, roomRef.current?.matchId ?? null)) return;
    viewRef.current = next; setView(next);
  }
  useEffect(() => {
    if (!url) return;
    const client = io(url, { reconnection: false, timeout: 10000 }); socket.current = client;
    client.on("v3-room:state", (next: V3RoomView) => {
      if (roomRef.current?.matchId !== next.matchId) { epoch.current++; viewRef.current = null; setView(null); setNeedsSync(false); flight.current = false; setBusy(false); }
      roomRef.current = next; setRoom(next);
    });
    const reset = (text: string) => { epoch.current++; roomRef.current = null; viewRef.current = null; setRoom(null); setView(null); setDeckId(""); flight.current = false; setBusy(false); setNeedsSync(false); setError(text); };
    client.on("v3:state", receive); client.on("v3-room:closed", reset);
    client.on("disconnect", () => reset("接続が切れました。ルームを作成・入室し直してください。"));
    client.on("connect_error", () => { flight.current = false; setBusy(false); setError("v3検証サーバーに接続できません。"); });
    return () => { epoch.current++; client.removeAllListeners(); client.disconnect(); socket.current = null; };
  }, []);
  function request(event: string, payload: unknown = null) {
    const client = socket.current; if (!client || flight.current) return false;
    if (!client.connected) { client.connect(); setError("接続中です。接続後にもう一度操作してください。"); return false; }
    flight.current = true; setBusy(true); setError(""); const sentEpoch = epoch.current;
    client.timeout(10000).emit(event, payload, (err: Error | null, reply?: { ok: boolean; error?: string; view?: V3FixtureView }) => {
      if (socket.current !== client || epoch.current !== sentEpoch) return;
      flight.current = false; setBusy(false);
      if (err || !reply) { setNeedsSync(!!viewRef.current); setError("応答を確認できません。再同期してください。"); return; }
      if (reply.view) { receive(reply.view); setNeedsSync(false); }
      if (!reply.ok) setError(reply.error ?? "操作できませんでした。");
    });
    return true;
  }
  function action(kind: "advance" | "work" | "answer", tokens?: readonly string[]) {
    if (!viewRef.current || busy || needsSync) return;
    try { request("v3:command", v3Command(viewRef.current, kind, crypto.randomUUID(), tokens)); } catch { setError("操作状態が変わりました。再同期してください。"); }
  }
  const isHost = room?.host.socketId === socket.current?.id, mine = isHost ? room?.host : room?.guest;
  if (view && room) return <>
    <TestBoard key={`${view.matchId}:${view.movement.revision}`} match={v3BoardView(view)} roomId={room.roomId} readOnly busy={busy} error={error} onCommand={() => {}} onEnd={() => { if (isHost) request("v3:end"); else setError("ホスト側でルームへ戻してください。"); }} />
    <section className={`test-effect-panel${collapsed ? " test-effect-panel-minimized" : ""}`} aria-label="v3合成効果検証">
      <button hidden={!collapsed} onClick={() => setCollapsed(false)}>効果処理に戻る</button>
      <div hidden={collapsed}>
      <strong>v3検証・合成効果</strong><p>{view.scenario === "bounce" ? "キャラを手札へ戻す" : "DONレスト → 1枚ドロー"}</p>
      <p role="status">{view.frame.status === "completed" ? "処理完了" : view.frame.status === "blocked" ? "未対応または処理不可・停止中" : view.actor === view.localPlayerIndex ? "自分が操作" : "相手の操作待ち"}</p>
      {view.frame.choice?.chooser === view.localPlayerIndex && <Choice key={view.frame.choice.selectionId} view={view} disabled={busy || needsSync} onConfirm={tokens => action("answer", tokens)} />}
      <div className="test-effect-actions">
        {view.actor === view.localPlayerIndex && view.frame.status === "ready" && <button disabled={busy || needsSync} onClick={() => action("advance")}>処理を進める</button>}
        {view.actor === view.localPlayerIndex && view.frame.status === "waitingForWork" && <button disabled={busy || needsSync} onClick={() => action("work")}>{view.workType === "PAY_COSTS" ? "支払いを確定" : "処理を実行"}</button>}
        <button disabled={busy} onClick={() => request("v3:sync")}>再同期</button>
        <button onClick={() => setCollapsed(true)}>盤面を見る</button>
        {isHost && <button disabled={busy} onClick={() => request("v3:end")}>ルームへ戻る</button>}
      </div>
      {error && <p role="alert">{error}</p>}
      </div>
    </section>
  </>;
  return <main className="v3-fixture-lobby"><div>
    <header><h1>v3ローカル検証</h1><button onClick={onBack}>戻る</button></header>
    {!url && <p role="alert">検証サーバーの接続先が未設定です。</p>}
    {!room ? <><button disabled={busy || !url} onClick={() => request("v3-room:create")}>ルーム作成</button>
      <form onSubmit={event => { event.preventDefault(); request("v3-room:join", code); }}><input aria-label="ルームコード" placeholder="4桁のコード" inputMode="numeric" maxLength={4} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} /><button disabled={busy || code.length !== 4}>入室</button></form></> : <>
      <strong>ルームコード：{room.roomId}</strong>
      <p>ホスト：{room.host.ready ? "READY" : "準備中"}・{room.host.deckName ?? "デッキ未選択"}</p>
      <p>ゲスト：{room.guest ? `${room.guest.ready ? "READY" : "準備中"}・${room.guest.deckName ?? "デッキ未選択"}` : "入室待ち"}</p>
      <label>デッキ<select value={deckId} disabled={busy} onChange={event => {
        const deck = decks.find(deck => deck.id === event.target.value); if (!deck) return;
        if (request("v3-room:deck", { name: deck.name, leaderCardId: deck.leaderCardId, mainDeck: deck.mainDeck, donDeck: deck.donDeck, leaderLifeCount: deck.leaderLifeCount ?? 5,
          cardTypes: Object.fromEntries(deck.mainDeck.map(id => [id, deck.cardTypes[id] ?? "character"])) })) setDeckId(deck.id);
      }}><option value="">選択してください</option>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>
      <button disabled={busy || !mine?.deckName} onClick={() => request("v3-room:ready", !mine?.ready)}>{mine?.ready ? "READY解除" : "READY"}</button>
      {isHost && <><label>合成効果<select value={scenario} disabled={busy} onChange={e => setScenario(e.target.value as V3Scenario)}><option value="bounce">公開キャラ → 手札</option><option value="payDraw">DONレスト → ドロー</option></select></label>
        <label>操作者<select value={actor} disabled={busy} onChange={e => setActor(Number(e.target.value) as 0 | 1)}><option value={0}>ホスト</option><option value={1}>ゲスト</option></select></label>
        <button disabled={busy || !room.host.ready || !room.guest?.ready} onClick={() => request("v3:start", { scenario, actor })}>検証開始</button></>}
      <button disabled={busy} onClick={() => request("v3-room:leave")}>退出</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </div></main>;
}
function Choice({ view, disabled, onConfirm }: { view: V3FixtureView; disabled: boolean; onConfirm: (tokens: string[]) => void }) {
  const [tokens, setTokens] = useState<string[]>([]), [failed, setFailed] = useState<string[]>([]), choice = view.frame.choice!;
  return <div><p>カード選択 {tokens.length} / {choice.max}</p><div className="test-effect-candidates">{choice.options.map(option => {
    const image = getLocalCardImage(option.cardId)?.imageUrl;
    return <button key={option.token} role="checkbox" aria-checked={tokens.includes(option.token)} aria-label={option.cardId} disabled={disabled || !tokens.includes(option.token) && tokens.length >= choice.max}
      onClick={() => setTokens(current => current.includes(option.token) ? current.filter(token => token !== option.token) : [...current, option.token])}>
      {image && !failed.includes(option.token) ? <img src={image} alt={option.cardId} draggable={false} onError={() => setFailed(current => [...current, option.token])} /> : <span>{option.cardId}</span>}
      {tokens.includes(option.token) && <b>{tokens.indexOf(option.token) + 1}</b>}
    </button>;
  })}</div><button className="test-effect-confirm" disabled={disabled || tokens.length < choice.min || tokens.length > choice.max} onClick={() => onConfirm(tokens)}>選択を確定</button></div>;
}
