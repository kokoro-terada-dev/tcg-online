import { useState } from "react";
import type { CardView, MatchCommand, MatchView, Zone } from "../../server/src/test/protocol";
import { getCardBackImageUrl, getDonImageUrl, getLocalCardImage } from "../utils/localCardImages";
import "./testMatch.css";

type Props = { match: MatchView; roomId: string; busy: boolean; error: string; onCommand: (command: MatchCommand) => void; onEnd: () => void };
const labels: Record<Zone, string> = { hand: "手札", deck: "デッキ", life: "ライフ", trash: "トラッシュ", public: "公開", character: "キャラクター", stage: "ステージ", leader: "リーダー", donDeck: "DONデッキ", activeDon: "ACTIVE DON", restDon: "REST DON" };
const imageUrl = (card: CardView) => !card.cardId ? getCardBackImageUrl() : getLocalCardImage(card.cardId)?.imageUrl ?? (card.kind === "don" ? getDonImageUrl() : null);

export default function TestBoard({ match, roomId, busy, error, onCommand, onEnd }: Props) {
  const [selection, setSelection] = useState<{ id: string; from: Zone } | null>(null);
  const [preview, setPreview] = useState<CardView | null>(null);
  const own = match.players[match.localPlayerIndex];
  const selected = selection ? own.zones[selection.from].find((card) => card?.id === selection.id) : null;
  function command(action: { kind: "draw" } | { kind: "rotate"; cardInstanceId: string; from: Zone } | { kind: "move"; cardInstanceId: string; from: Zone; to: Zone; slotIndex?: number }) {
    if (busy) return;
    onCommand({ ...action, matchId: match.matchId, expectedRevision: match.revision, requestId: crypto.randomUUID() });
    setSelection(null);
  }
  function move(to: Zone, slotIndex?: number) {
    if (!selected || !selection) return;
    command({ kind: "move", cardInstanceId: selected.id, from: selection.from, to, ...(slotIndex === undefined ? {} : { slotIndex }) });
  }
  function cardButton(card: CardView | null, zone: Zone, owner: number, index: number) {
    const mine = owner === match.localPlayerIndex;
    if (!card) return <button key={`empty-${index}`} className="test-card test-empty" disabled={!mine || !selected || busy || (zone === "character" && selected.kind !== "character") || (zone === "stage" && selected.kind !== "stage")} aria-label={`${labels[zone]}の空き枠${index + 1}`} onClick={() => move(zone, index)}>{index + 1}</button>;
    const url = imageUrl(card);
    const label = card.cardId ?? "裏向きカード";
    return <button key={card.id} className={`test-card${card.rotated ? " test-card-rest" : ""}${selected?.id === card.id ? " test-card-selected" : ""}`} aria-label={`${labels[zone]} ${label}`} title={label} disabled={busy}
      onClick={() => {
        if (!mine || zone === "leader") setPreview(card);
        else setSelection((current) => current?.id === card.id ? null : { id: card.id, from: zone });
      }}>
      {url ? <img src={url} alt={label} draggable={false} /> : <span>{label}</span>}
    </button>;
  }
  function area(zone: Zone, owner: number, fixed = false) {
    const cards = match.players[owner as 0 | 1].zones[zone];
    return <section className="test-area" key={zone}>
      <h3>{labels[zone]} <span>{cards.filter(Boolean).length}</span></h3>
      <div className={fixed ? "test-slots" : "test-card-strip"}>{cards.map((card, index) => cardButton(card, zone, owner, index))}</div>
    </section>;
  }
  const targets: Zone[] = selection?.from === "leader" ? [] : selected?.kind === "don" ? ["activeDon", "restDon", "donDeck"] : ["hand", "character", "stage", "trash", "public", "deck", "life"];
  return <main className="test-board">
    <header className="test-board-header"><strong>テスト対戦 <small>{roomId}</small></strong><button onClick={() => { if (window.confirm("両プレイヤーをルームへ戻しますか？")) onEnd(); }} disabled={busy}>ルームへ戻る</button></header>
    <div className="test-board-scroll">
      {([1 - match.localPlayerIndex, match.localPlayerIndex] as const).map((owner) => <section className="test-player" key={owner}>
        <h2>{owner === match.localPlayerIndex ? "自分" : "相手"}</h2>
        {area("hand", owner)}
        {area("character", owner, true)}
        <div className="test-row">{area("leader", owner)}{area("stage", owner)}{area("public", owner)}</div>
        <div className="test-row">
          {(["deck", "life", "trash", "donDeck"] as const).map((zone) => {
            const cards = match.players[owner as 0 | 1].zones[zone];
            const top = cards[0];
            return <section className="test-area" key={zone}><h3>{labels[zone]} <span>{cards.length}</span></h3>{top ? cardButton(top, zone, owner, 0) : <div className="test-stack-empty">—</div>}</section>;
          })}
        </div>
        <div className="test-row">{area("activeDon", owner)}{area("restDon", owner)}</div>
      </section>)}
    </div>
    <footer className="test-board-actions">
      {error && <div role="alert" className="test-error">{error}</div>}
      {selected && selection ? <>
        <div className="test-selection-title"><strong>{selected.cardId ?? labels[selection.from]}</strong><button onClick={() => setSelection(null)}>閉じる</button></div>
        <div className="test-action-grid">
          <button onClick={() => setPreview(selected)}>詳細</button>
          {(["leader", "character", "stage"] as Zone[]).includes(selection.from) && <button disabled={busy} onClick={() => command({ kind: "rotate", cardInstanceId: selected.id, from: selection.from })}>{selected.rotated ? "アクティブ" : "レスト"}</button>}
          {targets.filter((to) => to !== selection.from && (to !== "character" || selected.kind === "character") && (to !== "stage" || selected.kind === "stage")).map((to) => <button key={to} disabled={busy} onClick={() => move(to)}>{to === "character" ? "登場" : `${labels[to]}へ`}</button>)}
        </div>
      </> : <div className="test-action-grid">
        <button disabled={busy || own.zones.deck.length === 0} onClick={() => command({ kind: "draw" })}>1枚ドロー</button>
        <button disabled={busy || !own.zones.donDeck[0]} onClick={() => {
          const don = own.zones.donDeck[0];
          if (don) command({ kind: "move", cardInstanceId: don.id, from: "donDeck", to: "activeDon" });
        }}>DON追加</button>
        <button onClick={() => setSelection(own.zones.leader[0] ? { id: own.zones.leader[0].id, from: "leader" } : null)}>リーダー</button>
      </div>}
    </footer>
    {preview && <div className="test-preview" role="dialog" aria-modal="true" aria-label="カード詳細" onClick={() => setPreview(null)}>
      {imageUrl(preview) ? <img src={imageUrl(preview)!} alt={preview.cardId ?? "裏向きカード"} onClick={(event) => event.stopPropagation()} /> : <span>{preview.cardId}</span>}
      <button onClick={() => setPreview(null)}>閉じる</button>
    </div>}
  </main>;
}
