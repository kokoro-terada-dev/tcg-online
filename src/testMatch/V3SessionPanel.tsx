import { useEffect, useState } from "react";
import type { V3SessionView, V3SessionCommand } from "../../server/src/test/effects/v3/sessionProtocol";
import type { SessionDetails } from "./v3SessionClient";
import { v3BoardView } from "./v3FixtureClient";
import V3ChoicePanel from "./V3ChoicePanel";
import TestBoard from "./TestBoard";
import { getLocalCardImage } from "../utils/localCardImages";
const workLabels = { PAY_COSTS: "支払いを確定", DRAW: "ドローを実行", MOVE_CARD: "カードを移動", KO: "KOを実行", REST: "レストにする", SET_ACTIVE: "アクティブにする", LOOK_TOP: "山札を見る", REVEAL: "カードを公開", RETURN_TO_DECK: "山札へ戻す", CLOSE_REVEALS: "確認を終了", MODIFY_STAT: "修正を適用" };
export default function V3SessionPanel({ view, busy, needsSync, error, isHost, onAction, onSync, onEnd }: {
  view: V3SessionView; busy: boolean; needsSync: boolean; error: string; isHost: boolean;
  onAction: (kind: V3SessionCommand["kind"], details?: SessionDetails) => void; onSync: () => void; onEnd: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false), frame = view.frame, ownTurn = view.activePlayer === view.localPlayerIndex;
  const [revealPreview, setRevealPreview] = useState<string | null>(null);
  useEffect(() => setCollapsed(false), [view.context.resolutionId, frame?.choice?.selectionId, frame?.status, view.turnNumber, view.gate, view.pendingTriggerCount]);
  useEffect(() => setRevealPreview(null), [view.context.revision]);
  const idle = view.gate === "idle" && (!frame || frame.status === "completed"), disabled = busy || needsSync;
  const playable = (id: string) => view.playableCards.find(play => play.card.instanceId === id);
  return <>
    <TestBoard key={`${view.matchId}:${view.movement.revision}`} match={v3BoardView(view)} roomId={view.roomId} readOnly busy={busy} error={error} onCommand={() => {}} onEnd={onEnd}
      testPlayLabel={card => `登場（DON${playable(card.id)?.cost ?? "?"}）`} canTestPlay={card => !disabled && !!playable(card.id)?.enabled}
      testPlayUnavailableReason={card => { const play = playable(card.id); return disabled ? needsSync ? "再同期が必要" : "処理中" : !play ? "未対応カード" : play.cost === null ? "コスト未確認" : play.slotIndex < 0 ? "空き枠なし" : !ownTurn || !idle ? "操作待ち" : "DON不足"; }}
      onTestPlay={card => { const play = playable(card.id); if (play?.enabled) onAction("play", { card: play.card }); }} />
    <section className={`test-effect-panel${collapsed ? " test-effect-panel-minimized" : ""}`} aria-label="v3連続操作検証">
      <button hidden={!collapsed} onClick={() => setCollapsed(false)}>効果処理に戻る</button>
      <div hidden={collapsed}><strong>v3検証・連続操作</strong><p>{view.turnNumber}ターン目・{ownTurn ? "自分" : "相手"}のターン</p>
        {view.gate === "trigger" && <div><p role="status">{view.triggerChooser === view.localPlayerIndex ? "登場時効果を選択" : "相手の登場時効果を待っています"}（{view.pendingTriggerCount}件）</p>
          <div className="test-effect-actions">{view.triggerChoices.map(choice => <button key={choice.token} disabled={disabled} onClick={() => onAction("trigger", { token: choice.token })}>
            登場時効果・{view.imageAliases[choice.cardId] ?? choice.cardId}
          </button>)}</div></div>}
        {view.publicReveals.length > 0 && <div className="v3-public-reveals" aria-label="公開中のカード">{view.publicReveals.map((card, index) => {
          const id = view.imageAliases[card.cardId] ?? card.cardId, image = getLocalCardImage(id)?.imageUrl;
          return <button key={`${card.cardId}:${index}`} onClick={() => setRevealPreview(id)}>{image ? <img src={image} alt={id} draggable={false} /> : id}</button>;
        })}</div>}
        {frame && <p role="status">{frame.status === "completed" ? frame.activationDecision === "declined" ? "発動せず終了" : "処理完了" : frame.status === "blocked" ? "未対応または処理不可・停止中" : view.resolutionActor === view.localPlayerIndex ? "自分が操作" : "相手の操作待ち"}</p>}
        {view.publicStats.some(card => card.powerDelta || card.costDelta) && <div className="v3-stat-summary" aria-label="適用中の数値修正">{view.publicStats.filter(card => card.powerDelta || card.costDelta).map(card =>
          <p key={card.card.instanceId}>{card.player === view.localPlayerIndex ? "自分" : "相手"}・{card.zone === "leader" ? "リーダー" : card.zone === "stage" ? "ステージ" : `キャラ${card.slot + 1}`}
            {card.powerDelta !== 0 && <b> パワー {card.power ?? "?"}（{card.powerDelta > 0 ? "+" : ""}{card.powerDelta}）</b>}
            {card.costDelta !== 0 && <b> コスト {card.cost ?? "?"}（{card.costDelta > 0 ? "+" : ""}{card.costDelta}）</b>}
          </p>)}</div>}
        {frame?.choice?.chooser === view.localPlayerIndex && <V3ChoicePanel key={frame.choice.selectionId} choice={frame.choice} imageAliases={view.imageAliases} disabled={disabled} onConfirm={tokens => onAction("answer", { tokens })} />}
        <div className="test-effect-actions">
          {view.effects.map(effect => <button key={effect.effectId} disabled={disabled || !effect.enabled} onClick={() => onAction("activate", { effectId: effect.effectId })}>{effect.label} {effect.limit === null ? "" : `${effect.used}/${effect.limit}`}</button>)}
          {view.resolutionActor === view.localPlayerIndex && frame?.status === "ready" && <button disabled={disabled} onClick={() => onAction("advance")}>処理を進める</button>}
          {view.resolutionActor === view.localPlayerIndex && frame?.status === "waitingForWork" && <button disabled={disabled} onClick={() => onAction("work")}>{view.workType ? workLabels[view.workType] : "処理を実行"}</button>}
          {ownTurn && <button disabled={disabled || !idle} onClick={() => onAction("endTurn")}>ターン終了</button>}
          <button disabled={busy} onClick={onSync}>再同期</button><button onClick={() => setCollapsed(true)}>盤面を見る</button>
          {isHost && <button disabled={busy} onClick={onEnd}>ルームへ戻る</button>}
        </div>{error && <p role="alert">{error}</p>}
      </div>
    </section>
    {revealPreview && <div className="test-preview" role="dialog" aria-modal="true" aria-label="公開カード詳細" onClick={() => setRevealPreview(null)}>
      {getLocalCardImage(revealPreview)?.imageUrl ? <img src={getLocalCardImage(revealPreview)!.imageUrl} alt={revealPreview} onClick={event => event.stopPropagation()} /> : <span>{revealPreview}</span>}
      <button onClick={() => setRevealPreview(null)}>閉じる</button>
    </div>}
  </>;
}
