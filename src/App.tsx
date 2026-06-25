import { useEffect, useState } from "react";

import Board from "./components/Board/Board";
import DeckSelect from "./components/DeckSelect/DeckSelect";
import MulliganScreen from "./components/Mulligan/MulliganScreen";
import RoomScreen from "./components/Online/RoomScreen";
import TurnOrderScreen from "./components/TurnOrder/TurnOrderScreen";

import {
  onGameTurnOrderSelected,
  onMulliganComplete,
  onMulliganResult,
} from "./network/roomClient";

import { useGameStore } from "./store/gameStore";

type AppScreen =
  | "top"
  | "online-menu"
  | "host-room"
  | "guest-room";

function App() {
  const [screen, setScreen] =
    useState<AppScreen>("top");

  const isStarted = useGameStore((x) => x.isStarted);

  const mulliganPlayerIndex =
    useGameStore((x) => x.mulliganPlayerIndex);
  const turnOrderSelectionPending =
    useGameStore((x) => x.turnOrderSelectionPending);

  const applyOnlineMulliganResult =
    useGameStore((x) => x.applyOnlineMulliganResult);
  const finishOnlineMulligan =
    useGameStore((x) => x.finishOnlineMulligan);
  const confirmTurnOrder =
    useGameStore((x) => x.confirmTurnOrder);

  useEffect(() => {
    const offMulliganResult = onMulliganResult(
      (result) => {
        applyOnlineMulliganResult(result);
      }
    );
    const offMulliganComplete = onMulliganComplete(
      finishOnlineMulligan
    );
    const offGameTurnOrderSelected =
      onGameTurnOrderSelected(confirmTurnOrder);

    return () => {
      offMulliganResult();
      offMulliganComplete();
      offGameTurnOrderSelected();
    };
  }, [
    applyOnlineMulliganResult,
    confirmTurnOrder,
    finishOnlineMulligan,
  ]);

  if (isStarted) {
    if (turnOrderSelectionPending) {
      return <TurnOrderScreen />;
    }

    if (mulliganPlayerIndex !== null) {
      return <MulliganScreen />;
    }

    return <Board />;
  }

  if (screen === "online-menu") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#111827",
          color: "white",
          padding: "16px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "520px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "22px" }}>
            オンライン対戦
          </h1>

          <button
            style={createRoomButtonStyle}
            onClick={() => setScreen("host-room")}
          >
            ルーム作成
          </button>

          <button
            style={joinRoomButtonStyle}
            onClick={() => setScreen("guest-room")}
          >
            ルーム入室
          </button>

          <button
            style={subButtonStyle}
            onClick={() => setScreen("top")}
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

  if (screen === "host-room") {
    return (
      <RoomScreen
        mode="host"
        onBack={() => setScreen("online-menu")}
      />
    );
  }

  if (screen === "guest-room") {
    return (
      <RoomScreen
        mode="guest"
        onBack={() => setScreen("online-menu")}
      />
    );
  }

  return (
    <DeckSelect
      onOpenOnlineMenu={() => setScreen("online-menu")}
    />
  );
}

const createRoomButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: "60px",
    borderRadius: "16px",
    border: "1px solid #86efac",
    background:
        "linear-gradient(180deg, #22c55e 0%, #15803d 100%)",
    color: "white",
    fontSize: "18px",
    fontWeight: 900,
    boxShadow:
        "0 7px 0 #14532d, 0 12px 22px rgba(34,197,94,0.28)",
};

const joinRoomButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: "60px",
    borderRadius: "16px",
    border: "1px solid #60a5fa",
    background:
        "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
    color: "white",
    fontSize: "18px",
    fontWeight: 900,
    boxShadow:
        "0 7px 0 #1e3a8a, 0 12px 22px rgba(59,130,246,0.28)",
};

const subButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "46px",
  borderRadius: "12px",
  border: "1px solid #475569",
  background: "#1e293b",
  color: "white",
  fontSize: "15px",
  fontWeight: 800,
};

export default App;
