import { useGameStore } from "../../store/gameStore";

export default function MulliganScreen() {
  const players = useGameStore((x) => x.players);

  const mulliganPlayerIndex =
    useGameStore((x) => x.mulliganPlayerIndex);

  const mulligan = useGameStore((x) => x.mulligan);

  const keepHand = useGameStore((x) => x.keepHand);

  if (mulliganPlayerIndex === null) {
    return null;
  }

  const player = players[mulliganPlayerIndex];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        color: "white",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "32px",
      }}
    >
      <div
        style={{
          width: "500px",
          padding: "24px",
          border: "2px solid #475569",
          borderRadius: "16px",
          background: "#1e293b",
        }}
      >
        <h1>
          {mulliganPlayerIndex === 0
            ? "上側：確認"
            : "下側：確認"}
        </h1>

        <p>
          1回だけマリガンできます。
        </p>

        <div
          style={{
            display: "flex",
            gap: "2px",
            justifyContent: "center",
            marginTop: "24px",
            marginBottom: "24px",
          }}
        >
          {player.hand.map((card) => (
            <img
              key={card.id}
              src={card.image}
              style={{
                width: "75px",
                borderRadius: "8px",
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            justifyContent: "center",
          }}
        >
          <button
            onClick={() =>
              keepHand(mulliganPlayerIndex)
            }
            style={{
              padding: "12px 24px",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              fontWeight: "bold",
              background: "#2563eb",
              color: "white",
            }}
          >
            この手札で開始
          </button>

          <button
            onClick={() =>
              mulligan(mulliganPlayerIndex)
            }
            style={{
              padding: "12px 24px",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
              fontWeight: "bold",
              background: "#dc2626",
              color: "white",
            }}
          >
            マリガンする
          </button>
        </div>
      </div>
    </div>
  );
}