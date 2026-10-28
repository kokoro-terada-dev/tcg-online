import { useEffect, useRef, useState } from "react";
import type { CardView } from "../../server/src/test/protocol";
import type { EffectCatalogView } from "./effectClientState";
import { getLocalCardImage } from "../utils/localCardImages";

const eventLabels = { onPlay: "登場時", onAttack: "アタック時", onKo: "KO時", turnStart: "ターン開始時", turnEnd: "ターン終了時" };
export default function EffectCatalogDialog({ card, onLoad, onClose, onActivate }: {
  card: CardView; onLoad: (id: string) => Promise<EffectCatalogView>; onClose: () => void;
  onActivate?: (catalog: EffectCatalogView, effectId: string) => void;
}) {
  const [result, setResult] = useState<EffectCatalogView | null>(null), [error, setError] = useState(false);
  const [imageFailed, setImageFailed] = useState(false), close = useRef<HTMLButtonElement>(null);
  const load = useRef(onLoad);
  useEffect(() => {
    let active = true;
    const previous = document.activeElement;
    close.current?.focus();
    load.current(card.id).then(value => { if (active) setResult(value); }, () => { if (active) setError(true); });
    return () => { active = false; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [card.id]);
  const image = card.cardId ? getLocalCardImage(card.cardId)?.imageUrl : null;
  return <div className="test-catalog-backdrop" onClick={onClose} onKeyDown={event => {
    if (event.key === "Escape") onClose();
    if (event.key === "Tab") {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <section className="test-catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="test-catalog-title" onClick={event => event.stopPropagation()}>
      <header><h2 id="test-catalog-title">登録済み効果</h2><button ref={close} onClick={onClose}>閉じる</button></header>
      <div className="test-catalog-body">
        <div className="test-catalog-image">{image && !imageFailed ? <img src={image} alt={card.cardId ?? "カード"} onError={() => setImageFailed(true)} /> : <span>{card.cardId}</span>}</div>
        <div className="test-catalog-results" aria-live="polite">
          {error ? <p role="alert">一覧を取得できませんでした。閉じて再度お試しください。</p> : !result ? <p role="status">読込中...</p> : result.catalogVersion === null ? <p>効果カタログが未設定です。</p> : result.effects.length === 0 ? <p>登録済みの効果はありません。</p> : <ul>{result.effects.map(effect => <li key={effect.effectId}>
            <strong>{effect.trigger.kind === "event" ? eventLabels[effect.trigger.event] : effect.trigger.window === "main" ? "起動メイン" : effect.trigger.window === "counter" ? "カウンター" : "トリガー"}</strong>
            <span>{effect.effectId}</span><small>{effect.timingAvailable ? "タイミング一致・発動可否は未判定" : "現在の発動タイミングではありません"}</small>
            {onActivate && result.activationEnabled && effect.timingAvailable && <button onClick={() => onActivate(result, effect.effectId)}>発動する</button>}
          </li>)}</ul>}
        </div>
      </div>
    </section>
  </div>;
}
