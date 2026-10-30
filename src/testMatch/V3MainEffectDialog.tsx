import type { V3SessionView } from "../../server/src/test/effects/v3/sessionProtocol";
import { getLocalCardImage } from "../utils/localCardImages";

export default function V3MainEffectDialog({ view, sourceId, disabled, onClose, onActivate }: {
  view: V3SessionView; sourceId: string; disabled: boolean; onClose: () => void;
  onActivate: (effect: V3SessionView["effects"][number] | (V3SessionView["mainEventChoices"][number] & { event: true })) => void;
}) {
  const events = (view.mainEventChoices ?? []).filter(effect => effect.source.instanceId === sourceId);
  const effects = view.effects.filter(effect => effect.source.instanceId === sourceId);
  const source = view.publicStats.find(card => card.player === view.localPlayerIndex && card.card.instanceId === sourceId);
  const hand = view.movement?.players[view.localPlayerIndex].hand.find(card => card?.ref?.instanceId === sourceId);
  if (!source && !hand) return null;
  const id = source?.cardId ?? hand?.cardId; if (!id) return null;
  const cardId = view.imageAliases[id] ?? id, image = getLocalCardImage(cardId)?.imageUrl;
  return <div className="test-modal-backdrop" onClick={onClose}>
    <section className="test-board-actions" role="dialog" aria-modal="true" aria-label="MAIN効果" onClick={event => event.stopPropagation()}>
      <div className="test-selection-title"><strong>{!source ? "手札イベント" : source.zone === "character" ? `キャラ${source.slot + 1}` : source.zone === "leader" ? "リーダー" : "ステージ"}・{cardId}</strong><button onClick={onClose}>閉じる</button></div>
      <div className="test-card-actions-body">
        {image && <img className="test-action-image" src={image} alt={cardId} draggable={false} />}
        <div className="test-action-grid">
          {events.map(effect => <button key={effect.sourceToken} disabled={disabled || !effect.enabled} onClick={() => onActivate({ ...effect, event: true })}>MAIN使用（DON{effect.cost}）<small>{effect.effectId}</small></button>)}
          {effects.length ? effects.map(effect => <button key={effect.sourceToken} disabled={disabled || !effect.enabled} onClick={() => onActivate(effect)}>
            {effect.label}<small>{effect.effectId}{effect.limit !== null ? `・${effect.used}/${effect.limit}` : ""}{!effect.enabled ? "・発動不可" : ""}</small>
          </button>) : !events.length && <p role="status">登録されたMAIN効果はありません。</p>}
        </div>
      </div>
    </section>
  </div>;
}
