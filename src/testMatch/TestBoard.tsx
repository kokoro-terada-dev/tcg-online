import { useState } from "react";
import type { CSSProperties } from "react";
import type { CardView, MatchCommand, MatchView, Zone } from "../../server/src/test/protocol";
import { getCardBackImageUrl, getDonImageUrl, getLocalCardImage } from "../utils/localCardImages";
import "./testMatch.css";

type Props = { match: MatchView; roomId: string; busy: boolean; error: string; onCommand: (command: MatchCommand) => void; onEnd: () => void };
const labels: Record<Zone, string> = { hand: "手札", deck: "デッキ", life: "ライフ", trash: "トラッシュ", public: "公開", character: "キャラクター", stage: "ステージ", leader: "リーダー", donDeck: "DONデッキ", activeDon: "ACTIVE DON", restDon: "REST DON" };
const imageUrl = (card: CardView) => !card.cardId ? getCardBackImageUrl() : getLocalCardImage(card.cardId)?.imageUrl ?? (card.kind === "don" ? getDonImageUrl() : null);

export default function TestBoard({ match, roomId, busy, error, onCommand, onEnd }: Props) {
  const [selection, setSelection] = useState<{ id: string; from: Zone } | null>(null);
  const [preview, setPreview] = useState<CardView | null>(null);
  const [list, setList] = useState<{ zone: Zone; owner: 0 | 1 } | null>(null);
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
        if (!mine) setPreview(card);
        else { setSelection((current) => current?.id === card.id ? null : { id: card.id, from: zone }); setList(null); }
      }}>
      {url ? <img src={url} alt={label} draggable={false} /> : <span>{label}</span>}
    </button>;
  }
  function area(zone: Zone, owner: number, fixed = false) {
    const cards = match.players[owner as 0 | 1].zones[zone];
    const stacked = (["deck", "life", "trash", "public", "donDeck"] as Zone[]).includes(zone);
    const shown = stacked ? cards.slice(0, 1) : cards;
    return <section className={`test-area test-area-${zone}`} style={{ "--test-area-count": Math.max(1, cards.length) } as CSSProperties} key={zone} aria-label={`${owner === match.localPlayerIndex ? "自分" : "相手"}の${labels[zone]}`}>
      <h3><span>{zone === "donDeck" ? "DON" : zone === "trash" ? "TRASH" : labels[zone]}</span><button className="test-area-count" aria-label={`${owner === match.localPlayerIndex ? "自分" : "相手"}の${labels[zone]}リスト`} onClick={() => setList({ zone, owner: owner as 0 | 1 })}>{cards.filter(Boolean).length}</button></h3>
      <div className={fixed ? "test-slots" : "test-card-strip"}>
        {shown.map((card, index) => cardButton(card, zone, owner, index))}
      </div>
    </section>;
  }
  const targets: Zone[] = selection?.from === "leader" ? [] : selected?.kind === "don" ? ["activeDon", "restDon", "donDeck"] : ["hand", "character", "stage", "trash", "public", "deck", "life"];
  return <main className="test-board">
    <header className="test-board-header"><strong>テスト対戦 <small>{roomId}</small></strong><button onClick={() => { if (window.confirm("両プレイヤーをルームへ戻しますか？")) onEnd(); }} disabled={busy}>ルームへ戻る</button></header>
    <div className="test-playmat">
      {([1 - match.localPlayerIndex, match.localPlayerIndex] as const).map((owner) => <section className={`test-player${owner !== match.localPlayerIndex ? " test-player-opponent" : ""}`} key={owner} aria-label={owner === match.localPlayerIndex ? "自分の盤面" : "相手の盤面"}>
        {area("character", owner, true)}
        <div className="test-main-row">{area("life", owner)}{area("leader", owner)}{area("stage", owner)}{area("deck", owner)}</div>
        <div className="test-support-row"><div className="test-don-row">{area("donDeck", owner)}{area("activeDon", owner)}{area("restDon", owner)}</div>{area("trash", owner)}{area("public", owner)}</div>
        {area("hand", owner)}
      </section>)}
      <nav className="test-board-controls" aria-label="盤面操作">
        <button disabled={busy || own.zones.deck.length === 0} onClick={() => command({ kind: "draw" })}>1枚ドロー</button>
        <button disabled={busy || !own.zones.donDeck[0]} onClick={() => {
          const don = own.zones.donDeck[0];
          if (don) command({ kind: "move", cardInstanceId: don.id, from: "donDeck", to: "activeDon" });
        }}>DON追加</button>
      </nav>
    </div>
    {error && <div role="alert" className="test-error">{error}</div>}
    {selected && selection && <section className="test-board-actions" role="dialog" aria-label="カード操作">
        <div className="test-selection-title"><strong>{selected.cardId ?? labels[selection.from]}</strong><button onClick={() => setSelection(null)}>閉じる</button></div>
        <div className="test-action-grid">
          <button onClick={() => setPreview(selected)}>詳細</button>
          {(["leader", "character", "stage"] as Zone[]).includes(selection.from) && <button disabled={busy} onClick={() => command({ kind: "rotate", cardInstanceId: selected.id, from: selection.from })}>{selected.rotated ? "アクティブ" : "レスト"}</button>}
          {targets.filter((to) => to !== selection.from && (to !== "character" || selected.kind === "character") && (to !== "stage" || selected.kind === "stage")).map((to) => <button key={to} disabled={busy} onClick={() => move(to)}>{to === "character" ? "登場" : `${labels[to]}へ`}</button>)}
        </div>
    </section>}
    {list && <div className="test-modal-backdrop" onClick={() => setList(null)}>
      <section className="test-card-list" role="dialog" aria-modal="true" aria-label={`${labels[list.zone]}リスト`} onClick={(event) => event.stopPropagation()}>
        <header className="test-selection-title"><strong>{list.owner === match.localPlayerIndex ? "自分" : "相手"}の{labels[list.zone]}</strong><button onClick={() => setList(null)}>閉じる</button></header>
        <div className="test-list-grid">{match.players[list.owner].zones[list.zone].filter((card): card is CardView => card !== null).map((card, index) => cardButton(card, list.zone, list.owner, index))}</div>
      </section>
    </div>}
    {preview && <div className="test-preview" role="dialog" aria-modal="true" aria-label="カード詳細" onClick={() => setPreview(null)}>
      {imageUrl(preview) ? <img src={imageUrl(preview)!} alt={preview.cardId ?? "裏向きカード"} onClick={(event) => event.stopPropagation()} /> : <span>{preview.cardId}</span>}
      <button onClick={() => setPreview(null)}>閉じる</button>
    </div>}
  </main>;
}
