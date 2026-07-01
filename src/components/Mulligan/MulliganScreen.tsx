import {
  sendMulliganResult,
} from "../../network/roomClient";

import { useGameStore } from "../../store/gameStore";

function getCardBackImage() {
  return "/cards/cardBack.png";
}

export default function MulliganScreen() {
  const players = useGameStore((x) => x.players);

  const localPlayerIndex =
    useGameStore((x) => x.localPlayerIndex);

  const mulliganPlayerIndex =
    useGameStore((x) => x.mulliganPlayerIndex);

  const mulligan =
    useGameStore((x) => x.mulligan);

  const keepHand =
    useGameStore((x) => x.keepHand);
  const mulliganWaiting =
    useGameStore((x) => x.mulliganWaiting);
  const firstPlayerIndex =
    useGameStore((x) => x.firstPlayerIndex);


  if (mulliganPlayerIndex === null) {
    return null;
  }

  const displayPlayerIndex =
    localPlayerIndex ?? mulliganPlayerIndex;

  const player = players[displayPlayerIndex];
  const turnOrderText =
    firstPlayerIndex === null
      ? null
      : firstPlayerIndex === displayPlayerIndex
        ? "あなたは 先行 です"
        : "あなたは 後攻 です";

  const hiddenMulliganChoice = ():
    | { action: "keep" | "mulligan" }
    | null => null;
  const ownChoice = hiddenMulliganChoice();
  const opponentChoice = hiddenMulliganChoice();

  function getChoiceLabel(action: "keep" | "mulligan") {
    return action === "keep" ? "キープ" : "マリガン";
  }

  function handleKeep() {
    if (mulliganWaiting) {
      return;
    }

    const result = keepHand(
      displayPlayerIndex as 0 | 1
    );

    if (localPlayerIndex !== null) {
      sendMulliganResult(result);
    }
  }

  function handleMulligan() {
    if (mulliganWaiting) {
      return;
    }

    const result = mulligan(
      displayPlayerIndex as 0 | 1
    );

    if (localPlayerIndex !== null) {
      sendMulliganResult(result);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#0f172a",
        color: "white",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          padding: "18px",
          border: "2px solid #475569",
          borderRadius: "16px",
          background: "#1e293b",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            marginTop: 0,
            fontSize: "22px",
          }}
        >
          自分の手札確認
        </h1>

        <p>
          {mulliganWaiting
            ? "対戦相手のマリガン選択を待っています。"
            : "マリガンは1回だけです。"}
        </p>

        {turnOrderText && (
          <div
            style={{
              marginTop: "12px",
              padding: "12px",
              borderRadius: "12px",
              border: "2px solid #38bdf8",
              background: "rgba(8, 47, 73, 0.78)",
              color: "#e0f2fe",
              textAlign: "center",
              fontSize: "18px",
              fontWeight: 1000,
            }}
          >
            {turnOrderText}
          </div>
        )}

        {(ownChoice || opponentChoice) && (
          <div
            style={{
              marginTop: "12px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}
          >
            <div
              style={{
                padding: "8px",
                borderRadius: "10px",
                background: "rgba(37, 99, 235, 0.28)",
                border: "1px solid rgba(147, 197, 253, 0.55)",
                textAlign: "center",
                fontSize: "12px",
                fontWeight: 900,
              }}
            >
              自分：{ownChoice ? getChoiceLabel(ownChoice.action) : "選択中"}
            </div>
            <div
              style={{
                padding: "8px",
                borderRadius: "10px",
                background: "rgba(71, 85, 105, 0.42)",
                border: "1px solid rgba(148, 163, 184, 0.55)",
                textAlign: "center",
                fontSize: "12px",
                fontWeight: 900,
              }}
            >
              相手：{opponentChoice ? getChoiceLabel(opponentChoice.action) : "選択中"}
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "4px",
            justifyContent: "center",
            marginTop: "24px",
            marginBottom: "24px",
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
            paddingBottom: "4px",
          }}
        >
          {player.hand.map((card) => (
            <img
              key={card.id}
              src={card.image || getCardBackImage()}
              draggable={false}
              style={{
                width: "64px",
                borderRadius: "8px",
                flexShrink: 0,
              }}
            />
          ))}
        </div>

        {!mulliganWaiting && (
          <div
            style={{
              display: "flex",
              gap: "10px",
              justifyContent: "center",
              flexDirection: "column",
            }}
          >
            <button
              onClick={handleKeep}
              style={primaryButtonStyle}
            >
              この手札で開始
            </button>

            <button
              onClick={handleMulligan}
              style={dangerButtonStyle}
            >
              マリガンして開始
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "48px",
  borderRadius: "12px",
  border: "none",
  cursor: "pointer",
  fontWeight: "bold",
  background: "#2563eb",
  color: "white",
  fontSize: "15px",
};

const dangerButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: "#dc2626",
};
