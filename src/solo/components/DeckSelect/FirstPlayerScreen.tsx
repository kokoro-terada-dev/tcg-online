import { useState } from "react";
import type { CSSProperties } from "react";
import type { CardData } from "../../types/card";

type Props = {
  decks: [CardData[], CardData[]];
  names: [string, string];
  onBack: () => void;
  onConfirm: (firstPlayer: 0 | 1) => void;
};

const buttonStyle: CSSProperties = { minHeight: "44px", padding: "8px 16px", border: "1px solid #64748b", borderRadius: "6px", color: "white", background: "#2563eb", fontWeight: 700 };

export default function FirstPlayerScreen({ decks, names, onBack, onConfirm }: Props) {
  const [firstPlayer, setFirstPlayer] = useState<0 | 1>(1);
  return <main style={{ height: "100dvh", overflowY: "auto", touchAction: "pan-y", padding: "16px", color: "white", background: "var(--app-background, #0f172a)" }}>
    <div style={{ maxWidth: "520px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <h1 style={{ fontSize: "22px", margin: 0 }}>先攻・後攻を選択</h1>
      {decks.map((deck, index) => {
        const leader = deck.find((card) => card.type === "leader");
        return <section key={index} style={{ padding: "16px", background: "#1e293b", borderRadius: "8px" }}>
          <h2 style={{ fontSize: "16px", margin: "0 0 12px" }}>{index === 0 ? "上側" : "下側"}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {leader && <img src={leader.image} alt={names[index]} draggable={false} style={{ width: "76px", height: "106px", objectFit: "contain", flexShrink: 0 }} />}
            <div role="group" aria-label={`${index === 0 ? "上側" : "下側"}の先後`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", flex: 1 }}>
              {([true, false] as const).map((first) => {
                const checked = (firstPlayer === index) === first;
                return <button type="button" key={String(first)} aria-pressed={checked}
                  onClick={() => setFirstPlayer((first ? index : 1 - index) as 0 | 1)}
                  style={{ ...buttonStyle, padding: "8px", background: first ? (checked ? "#15803d" : "#123321") : (checked ? "#dc2626" : "#3f1b24"), color: checked ? "#ffffff" : "#9ca3af", border: checked ? "2px solid white" : "2px solid #475569", boxShadow: checked ? `0 0 10px ${first ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}` : "none", cursor: "pointer", transition: "background-color 0.15s, color 0.15s", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {first ? "先攻" : "後攻"}
                </button>;
              })}
            </div>
          </div>
          <div style={{ marginTop: "10px", overflowWrap: "anywhere", fontWeight: 700 }}>{names[index]}</div>
        </section>;
      })}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <button style={{ ...buttonStyle, background: "#334155" }} onClick={onBack}>戻る</button>
        <button style={buttonStyle} onClick={() => onConfirm(firstPlayer)}>次へ</button>
      </div>
    </div>
  </main>;
}
