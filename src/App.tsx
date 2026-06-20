import { useState } from "react";

import Board from "./components/Board/Board";
import DeckSelect from "./components/DeckSelect/DeckSelect";
import MulliganScreen from "./components/Mulligan/MulliganScreen";
import RoomScreen from "./components/Online/RoomScreen";

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

  const resetToDeckSelect =
    useGameStore((x) => x.resetToDeckSelect);

  if (isStarted) {
    if (mulliganPlayerIndex !== null) {
      return <MulliganScreen />;
    }

    return (
      <Board
        resetToDeckSelect={resetToDeckSelect}
      />
    );
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
            style={menuButtonStyle}
            onClick={() => setScreen("host-room")}
          >
            ルーム作成
          </button>

          <button
            style={menuButtonStyle}
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

const menuButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "52px",
  borderRadius: "12px",
  border: "1px solid #60a5fa",
  background: "#2563eb",
  color: "white",
  fontSize: "16px",
  fontWeight: 900,
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