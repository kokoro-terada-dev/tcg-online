import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { CardData } from "../../types/card";

type Props = {
  decks: [CardData[], CardData[]];
  onBack: () => void;
  onComplete: (hands: [string[], string[]]) => void;
};

const buttonStyle: CSSProperties = {
  border: "1px solid #64748b", borderRadius: "6px", background: "#2563eb",
  color: "white", padding: "10px 12px", minHeight: "44px", fontWeight: 700,
};

export default function HandSelectScreen({ decks, onBack, onComplete }: Props) {
  const [playerIndex, setPlayerIndex] = useState<0 | 1>(0);
  const [hands, setHands] = useState<[string[], string[]]>([[], []]);
  const [preview, setPreview] = useState<CardData | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const listRef = useRef<HTMLDivElement | null>(null);
  const cards = decks[playerIndex].filter((card) => card.type !== "leader" && card.type !== "don");
  const handIds = hands[playerIndex];
  const groups = new Map<string, CardData[]>();
  for (const card of cards) {
    const group = groups.get(card.name) ?? [];
    group.push(card);
    groups.set(card.name, group);
  }

  function cancelPress() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => cancelPress, []);

  function startPress(event: PointerEvent, card: CardData) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancelPress();
    origin.current = { x: event.clientX, y: event.clientY };
    timer.current = setTimeout(() => { timer.current = null; setPreview(card); }, 450);
  }

  function updateHand(next: string[]) {
    setHands((current) => playerIndex === 0 ? [next, current[1]] : [current[0], next]);
  }

  function image(card: CardData, style: CSSProperties) {
    return <img src={card.image} alt={card.name} draggable={false} style={{ ...style, objectFit: "contain", WebkitTouchCallout: "none" }}
      onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => startPress(event, card)}
      onPointerMove={(event) => { if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancelPress(); }}
      onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress} />;
  }

  return (
    <main style={{ height: "100dvh", display: "grid", gridTemplateRows: "80% 20%", background: "var(--app-background, #0f172a)", color: "white", overflow: "hidden" }}>
      <section style={{ minHeight: 0, display: "flex", flexDirection: "column", padding: "12px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
          <h1 style={{ fontSize: "18px", margin: 0 }}>デッキ{playerIndex + 1}：手札選択</h1>
          <button style={{ ...buttonStyle, background: "#334155" }} onClick={() => {
            if (playerIndex === 1) setPlayerIndex(0); else onBack();
          }}>戻る</button>
        </header>
        <div ref={listRef} style={{ overflowY: "auto", touchAction: "pan-y", minHeight: 0, flex: 1 }}>
          {[...groups.entries()].map(([name, group]) => {
            const selected = group.filter((card) => handIds.includes(card.id)).length;
            const available = group.find((card) => !handIds.includes(card.id));
            const disabled = handIds.length >= 5 || !available;
            return <div key={name} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "8px 0", borderBottom: "1px solid #475569" }}>
              {image(group[0], { width: "72px", height: "100px", flexShrink: 0 })}
              <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontSize: "13px" }}>{name}<div style={{ marginTop: "6px" }}>{selected} / {group.length}枚</div></div>
              <button disabled={disabled} style={{ ...buttonStyle, flexShrink: 0, opacity: disabled ? 0.4 : 1 }} onClick={() => {
                if (available && handIds.length < 5) updateHand([...handIds, available.id]);
              }}>手札へ</button>
            </div>;
          })}
        </div>
      </section>
      <section style={{ minHeight: 0, borderTop: "2px solid #64748b", background: "#111827", padding: "8px 12px max(8px, env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
          <strong style={{ fontSize: "13px" }}>手札 {handIds.length}/5</strong>
          <button style={buttonStyle} onClick={() => {
            if (playerIndex === 0) { setPlayerIndex(1); listRef.current?.scrollTo(0, 0); }
            else onComplete(hands);
          }}>{playerIndex === 0 ? "次へ" : "開始"}</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "6px", minHeight: 0, flex: 1 }}>
          {handIds.map((id) => {
            const card = cards.find((item) => item.id === id)!;
            return <div key={id} style={{ position: "relative", minHeight: 0 }}>
              {image(card, { width: "100%", height: "100%" })}
              <button aria-label={`${card.name}を手札から外す`} title="手札から外す" style={{ position: "absolute", top: 0, right: 0, width: "24px", height: "24px", padding: 0, border: 0, borderRadius: "4px", color: "white", background: "#b91c1c" }} onClick={() => updateHand(handIds.filter((item) => item !== id))}>×</button>
            </div>;
          })}
        </div>
      </section>
      {preview && createPortal(<div role="dialog" aria-modal="true" aria-label="カード詳細" onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "16px" }}>
        <img src={preview.image} alt={preview.name} draggable={false} onClick={(event) => event.stopPropagation()} style={{ maxWidth: "100%", width: "360px", maxHeight: "calc(100dvh - 100px)", objectFit: "contain" }} />
        <button style={buttonStyle} onClick={() => setPreview(null)}>閉じる</button>
      </div>, document.body)}
    </main>
  );
}
