import { useEffect, useRef, useState } from "react";
import type { EffectTransportView } from "./effectClientState";
import { getLocalCardImage } from "../utils/localCardImages";

export default function DamageChoiceDialog({ view, busy, needsSync, error, onChoice, onSync }: {
  view: EffectTransportView; busy: boolean; needsSync: boolean; error: string;
  onChoice: (token: string) => void; onSync: () => void;
}) {
  const [detail, setDetail] = useState(false), [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const card = view.movement.players[view.localPlayerIndex].life[0];
  const image = card?.cardId && card.faceUp ? getLocalCardImage(card.cardId)?.imageUrl : null;
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="test-catalog-backdrop" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); setDetail(false); }
    if (event.key === "Tab") {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
      if (!buttons.length) event.preventDefault();
    }
  }}>
    <section ref={dialog} tabIndex={-1} className="test-catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="test-damage-title">
      <header><h2 id="test-damage-title">{detail ? "カード詳細" : "ライフ確認"}</h2>{detail && <button onClick={() => setDetail(false)}>戻る</button>}</header>
      <div className={detail ? "test-damage-detail" : "test-catalog-body"}>
        <button className="test-catalog-image" aria-label="カード詳細" disabled={!card?.cardId || !card.faceUp} onClick={() => setDetail(true)}>
          {image && !failed ? <img src={image} alt={card?.cardId ?? "カード"} draggable={false} onError={() => setFailed(true)} /> : <span>{card?.cardId ?? "カードを確認できません"}</span>}
        </button>
        {!detail && <div className="test-damage-actions">
          {view.damageChoice?.options.map(option => <button key={option.token} disabled={busy || needsSync || !card?.ref || !card.cardId || !card.faceUp} onClick={() => onChoice(option.token)}>{option.label}</button>)}
        </div>}
      </div>
      {error && <p role="alert">{error}</p>}
      {needsSync && <><p role="alert">応答を確認できません。再同期してください。</p><button disabled={busy} onClick={onSync}>再同期</button></>}
    </section>
  </div>;
}
