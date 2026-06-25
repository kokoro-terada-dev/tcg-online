import {
  sendGameTurnOrderSelected,
} from "../../network/roomClient";

import { useGameStore } from "../../store/gameStore";

export default function TurnOrderScreen() {
  const localPlayerIndex =
    useGameStore((x) => x.localPlayerIndex);
  const turnOrderDecider =
    useGameStore((x) => x.turnOrderDecider);
  const confirmTurnOrder =
    useGameStore((x) => x.confirmTurnOrder);

  const displayPlayerIndex =
    localPlayerIndex ?? 0;

  const canChoose =
    turnOrderDecider === displayPlayerIndex;

  function chooseFirst() {
    const firstPlayerIndex =
      displayPlayerIndex as 0 | 1;

    confirmTurnOrder(firstPlayerIndex);
    sendGameTurnOrderSelected(firstPlayerIndex);
  }

  function chooseSecond() {
    const firstPlayerIndex =
      displayPlayerIndex === 0 ? 1 : 0;

    confirmTurnOrder(firstPlayerIndex);
    sendGameTurnOrderSelected(firstPlayerIndex);
  }

  return (
    <div style={pageStyle}>
      <div style={panelStyle}>
        <div style={eyebrowStyle}>
          TURN ORDER
        </div>
        <h1 style={titleStyle}>
          先行後攻
        </h1>

        {canChoose ? (
          <>
            <p style={messageStyle}>
              選んでください
            </p>
            <div style={buttonGridStyle}>
              <button
                type="button"
                onClick={chooseFirst}
                style={buttonStyle}
              >
                先行
              </button>
              <button
                type="button"
                onClick={chooseSecond}
                style={buttonStyle}
              >
                後攻
              </button>
            </div>
          </>
        ) : (
          <p style={messageStyle}>
            相手が先後選択中です...
          </p>
        )}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100dvh",
  background:
    "linear-gradient(180deg, #020617 0%, #0f172a 100%)",
  color: "white",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "16px",
  boxSizing: "border-box",
};

const panelStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "420px",
  padding: "18px",
  borderRadius: "16px",
  border: "2px solid #38bdf8",
  background: "#1e293b",
  boxShadow: "0 18px 34px rgba(0,0,0,0.48)",
  textAlign: "center",
};

const eyebrowStyle: React.CSSProperties = {
  color: "#67e8f9",
  fontSize: "12px",
  fontWeight: 900,
};

const titleStyle: React.CSSProperties = {
  margin: "8px 0 14px",
  fontSize: "24px",
};

const messageStyle: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: "16px",
  fontWeight: 900,
};

const buttonGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "10px",
};

const buttonStyle: React.CSSProperties = {
  minHeight: "56px",
  borderRadius: "12px",
  border: "1px solid #60a5fa",
  background:
    "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
  color: "white",
  fontSize: "18px",
  fontWeight: 1000,
  boxShadow:
    "0 6px 0 #1e3a8a, 0 12px 20px rgba(0,0,0,0.28)",
};
