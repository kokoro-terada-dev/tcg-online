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


  if (mulliganPlayerIndex === null) {
    return null;
  }

  const displayPlayerIndex =
    localPlayerIndex ?? mulliganPlayerIndex;

  const player = players[displayPlayerIndex];

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
