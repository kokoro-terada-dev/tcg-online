import { useState } from "react";
import TestPlayerBoard from "./TestPlayerBoard";
import TestAttackArrow from "./TestAttackArrow";
import type { CardView, MatchCommand, MatchView, Zone } from "../../server/src/test/protocol";
import { getCardBackImageUrl, getDonImageUrl, getLocalCardImage } from "../utils/localCardImages";
import "./testMatch.css";

type Props = { match: MatchView; roomId: string; busy: boolean; error: string; onCommand: (command: MatchCommand) => void; onEnd: () => void; readOnly?: boolean; onInspectEffects?: (card: CardView) => void };
const labels: Record<Zone, string> = { hand: "手札", deck: "デッキ", life: "ライフ", trash: "トラッシュ", public: "公開", character: "キャラクター", stage: "ステージ", leader: "リーダー", donDeck: "DONデッキ", activeDon: "ACTIVE DON", restDon: "REST DON" };
const imageUrl = (card: CardView) => !card.cardId ? getCardBackImageUrl() : getLocalCardImage(card.cardId)?.imageUrl ?? (card.kind === "don" ? getDonImageUrl() : null);

export default function TestBoard({ match, roomId, busy, error, onCommand, onEnd, readOnly = false, onInspectEffects }: Props) {
  const [selection, setSelection] = useState<{ id: string; from: Zone } | null>(null);
  const [preview, setPreview] = useState<CardView | null>(null);
  const [list, setList] = useState<{ zone: Zone; owner: 0 | 1 } | null>(null);
  const own = match.players[match.localPlayerIndex];
  const [attackSource, setAttackSource] = useState<{ id: string; from: "leader" | "character"; revision: number } | null>(null);
  const [attackTarget, setAttackTarget] = useState<CardView | null>(null);
  const choosingAttack = attackSource?.revision === match.revision && Boolean(attackSource && own.zones[attackSource.from].find((card) => card?.id === attackSource.id && !card.rotated));
  function cancelAttack() { setAttackSource(null); setAttackTarget(null); }
  const selected = selection ? own.zones[selection.from].find((card) => card?.id === selection.id) : null;
  function command(action: { kind: "draw" } | { kind: "attack"; cardInstanceId: string; from: "leader" | "character"; targetId: string } | { kind: "rotate"; cardInstanceId: string; from: Zone } | { kind: "move"; cardInstanceId: string; from: Zone; to: Zone; slotIndex?: number }) {
    if (busy || readOnly) return;
    onCommand({ ...action, matchId: match.matchId, expectedRevision: match.revision, requestId: crypto.randomUUID() });
    setSelection(null);
  }
  function move(to: Zone, slotIndex?: number) {
    if (!selected || !selection) return;
    command({ kind: "move", cardInstanceId: selected.id, from: selection.from, to, ...(slotIndex === undefined ? {} : { slotIndex }) });
  }
  function cardButton(card: CardView, zone: Zone, owner: number, _index: number) {
    const mine = owner === match.localPlayerIndex;
    const url = imageUrl(card);
    const label = card.cardId ?? "裏向きカード";
    const attackCandidate = !mine && (zone === "leader" || zone === "character");
    return <button key={card.id} data-card-id={card.id} data-player-index={owner} className={`test-match-card test-match-card-${zone}${card.rotated ? " test-match-rest" : ""}${selected?.id === card.id ? " test-match-selected" : ""}${choosingAttack && attackCandidate ? " test-attack-candidate" : ""}`} aria-label={`${labels[zone]} ${label}`} title={label} disabled={busy || (choosingAttack && !attackCandidate)}
      onClick={() => {
        if (choosingAttack) {
          if (!mine && (zone === "leader" || zone === "character")) setAttackTarget(card);
          return;
        }
        if (readOnly && mine && card.faceUp && card.cardId && ["leader", "character", "stage"].includes(zone) && onInspectEffects) { setList(null); onInspectEffects(card); }
        else if (!mine || readOnly) setPreview(card);
        else { setSelection((current) => current?.id === card.id ? null : { id: card.id, from: zone }); setList(null); }
      }}>
      {url ? <img src={url} alt={label} draggable={false} /> : <span>{label}</span>}
    </button>;
  }
  const targets: Zone[] = selection?.from === "leader" ? [] : selected?.kind === "don" ? ["activeDon", "restDon", "donDeck"] : ["hand", "character", "stage", "trash", "public", "deck", "life"];
  return <main className="test-board">
    <div className="test-playmat">
      <TestPlayerBoard player={match.players[(1 - match.localPlayerIndex) as 0 | 1]} playerIndex={(1 - match.localPlayerIndex) as 0 | 1} reversed renderCard={(card, zone, index) => cardButton(card, zone, 1 - match.localPlayerIndex, index)} onOpen={(zone) => { if (!choosingAttack) setList({ zone, owner: (1 - match.localPlayerIndex) as 0 | 1 }); }} canPlace={() => false} onPlace={() => {}} />
      <nav className="test-board-controls" aria-label="盤面操作">
        <small>{roomId}</small>
        {!readOnly && <><button disabled={busy || choosingAttack || own.zones.deck.length === 0} onClick={() => command({ kind: "draw" })}>1枚ドロー</button>
        <button disabled={busy || choosingAttack || !own.zones.donDeck[0]} onClick={() => {
          const don = own.zones.donDeck[0];
          if (don) command({ kind: "move", cardInstanceId: don.id, from: "donDeck", to: "activeDon" });
        }}>DON追加</button></>}
        <button onClick={() => { if (window.confirm("両プレイヤーをルームへ戻しますか？")) onEnd(); }} disabled={busy}>ルームへ戻る</button>
      </nav>
      <TestPlayerBoard player={own} playerIndex={match.localPlayerIndex} reversed={false} renderCard={(card, zone, index) => cardButton(card, zone, match.localPlayerIndex, index)} onOpen={(zone) => { if (!choosingAttack) setList({ zone, owner: match.localPlayerIndex }); }} canPlace={(zone) => !readOnly && !busy && Boolean(selected && selection?.from !== "leader" && selected.kind === zone)} onPlace={move} />
    </div>
    <TestAttackArrow attack={match.attack} revision={match.revision} />
    {choosingAttack && <div className="test-attack-prompt" role="status">相手のリーダー・キャラクターを選択<button onClick={cancelAttack}>キャンセル</button></div>}
    {error && <div role="alert" className="test-error">{error}</div>}
    {selected && selection && <div className="test-modal-backdrop" onClick={() => setSelection(null)}><section className="test-board-actions" role="dialog" aria-modal="true" aria-label="カード操作" onClick={(event) => event.stopPropagation()}>
        <div className="test-selection-title"><strong>{selected.cardId ?? labels[selection.from]}</strong><button onClick={() => setSelection(null)}>閉じる</button></div>
        <div className="test-card-actions-body">
        {imageUrl(selected) && <img className="test-action-image" src={imageUrl(selected)!} alt={selected.cardId ?? "カード"} />}
        <div className="test-action-grid">
          <button onClick={() => setPreview(selected)}>詳細</button>
          {(selection.from === "leader" || selection.from === "character") && <button disabled={busy || selected.rotated} onClick={() => {
            if (selection.from !== "leader" && selection.from !== "character") return;
            setAttackSource({ id: selected.id, from: selection.from, revision: match.revision }); setAttackTarget(null); setSelection(null);
          }}>アタック</button>}
          {(["leader", "character", "stage"] as Zone[]).includes(selection.from) && <button disabled={busy} onClick={() => command({ kind: "rotate", cardInstanceId: selected.id, from: selection.from })}>{selected.rotated ? "アクティブ" : "レスト"}</button>}
          {targets.filter((to) => to !== selection.from && (to !== "character" || selected.kind === "character") && (to !== "stage" || selected.kind === "stage")).map((to) => <button key={to} disabled={busy} onClick={() => move(to)}>{to === "character" ? "登場" : `${labels[to]}へ`}</button>)}
        </div>
        </div>
    </section></div>}
    {choosingAttack && attackTarget && attackSource && <div className="test-modal-backdrop"><section className="test-board-actions" role="dialog" aria-modal="true" aria-label="アタック確認">
      <h2>アタックしますか？</h2>
      <div className="test-card-actions-body">
        {imageUrl(attackTarget) && <img className="test-action-image" src={imageUrl(attackTarget)!} alt={attackTarget.cardId ?? "対象カード"} />}
        <div className="test-action-grid"><button disabled={busy} onClick={() => setAttackTarget(null)}>いいえ</button><button disabled={busy} onClick={() => {
          command({ kind: "attack", cardInstanceId: attackSource.id, from: attackSource.from, targetId: attackTarget.id }); cancelAttack();
        }}>はい</button><button onClick={cancelAttack}>キャンセル</button></div>
      </div>
    </section></div>}
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
