import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type { CSSProperties } from "react";

type Room = { roomId: string; host: { socketId: string; ready: boolean }; guest: { socketId: string; ready: boolean } | null };
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
  useEffect(() => {
    if (!serverUrl) return;
    const socket = io(serverUrl, { autoConnect: false, timeout: 60000, reconnection: false });
    socketRef.current = socket;
    socket.on("test-room:state", (next: Room) => { setRoom(next); setMessage(""); setError(""); });
    socket.on("test-room:closed", (text: string) => { setRoom(null); setMessage(text); });
    socket.on("connect_error", () => { setBusy(false); setError("テストサーバーに接続できません。起動状態と接続先を確認してください。"); });
    socket.on("disconnect", () => { setRoom(null); setBusy(false); setError("接続が切れました。ルームを作成または入室し直してください。"); });
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
      } else if (event === "test-room:leave") setRoom(null);
    };
    socket.connect();
    if (value === undefined) socket.timeout(75000).emit(event, complete);
    else socket.timeout(75000).emit(event, value, complete);
  }
  const mine = room?.host.socketId === socketRef.current?.id ? room?.host : room?.guest;
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
          <div>ホスト：入室済み・{room.host.ready ? "READY" : "準備中"}</div>
          <div>ゲスト：{room.guest ? `入室済み・${room.guest.ready ? "READY" : "準備中"}` : "入室待ち"}</div>
        </div>
        <button style={{ ...button, background: mine?.ready ? "#166534" : "#0369a1" }} disabled={busy} onClick={() => request("test-room:ready", !mine?.ready)}>{mine?.ready ? "READY解除" : "READY"}</button>
        {room.host.ready && room.guest?.ready && <p role="status">両プレイヤー READY</p>}
        <button style={{ ...button, background: "#334155" }} disabled={busy} onClick={() => request("test-room:leave")}>退出</button>
      </>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
    </div>
  </main>;
}
