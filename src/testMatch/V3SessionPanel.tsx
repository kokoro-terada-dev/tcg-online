import { useEffect, useState } from "react";
import type { V3SessionView, V3SessionCommand } from "../../server/src/test/effects/v3/sessionProtocol";
import type { SessionDetails } from "./v3SessionClient";
import { v3BoardView } from "./v3FixtureClient";
import V3ChoicePanel from "./V3ChoicePanel";
import TestBoard from "./TestBoard";
import { getLocalCardImage } from "../utils/localCardImages";
const workLabels = { PAY_COSTS: "支払いを確定", DRAW: "ドローを実行", MOVE_CARD: "カードを移動", KO: "KOを実行", REST: "レストにする", SET_ACTIVE: "アクティブにする", LOOK_TOP: "山札を見る", REVEAL: "カードを公開", RETURN_TO_DECK: "山札へ戻す", CLOSE_REVEALS: "確認を終了", MODIFY_STAT: "修正を適用", GRANT_KEYWORD: "能力を付与" };
export default function V3SessionPanel({ view, busy, needsSync, error, isHost, onAction, onSync, onEnd }: {
  view: V3SessionView; busy: boolean; needsSync: boolean; error: string; isHost: boolean;
  onAction: (kind: V3SessionCommand["kind"], details?: SessionDetails) => void; onSync: () => void; onEnd: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false), frame = view.frame, ownTurn = view.activePlayer === view.localPlayerIndex;
  const [revealPreview, setRevealPreview] = useState<string | null>(null);
  const [counterTargetId, setCounterTargetId] = useState<string>("");
  useEffect(() => setCounterTargetId(view.battle?.target.instanceId ?? ""), [view.battle?.battleId, view.battle?.target.instanceId]);
  useEffect(() => setCollapsed(false), [view.context.resolutionId, frame?.choice?.selectionId, frame?.status, view.turnNumber, view.gate, view.pendingTriggerCount, view.battle?.step, view.lifePending]);
  useEffect(() => setRevealPreview(null), [view.context.revision]);
  const idle = !view.battle && !view.outcome && view.gate === "idle" && (!frame || frame.status === "completed"), disabled = busy || needsSync;
  const playable = (id: string) => view.playableCards.find(play => play.card.instanceId === id);
  const battle = view.battle, defending = battle?.defender === view.localPlayerIndex;
  const attackEffectActor = view.gate === "trigger" ? view.triggerChooser : view.resolutionActor;
  const counterTargets = view.publicStats.filter(card => card.player === view.localPlayerIndex && (card.zone === "leader" || card.zone === "character"));
  const counterTarget = counterTargets.find(card => card.card.instanceId === counterTargetId)?.card ?? battle?.target;
  return <>
    <TestBoard key={`${view.matchId}:${view.movement.revision}`} match={v3BoardView(view)} roomId={view.roomId} readOnly busy={busy} error={error} onCommand={() => {}} onEnd={onEnd}
      testPlayLabel={card => `登場（DON${playable(card.id)?.cost ?? "?"}）`} canTestPlay={card => !disabled && !!playable(card.id)?.enabled}
      testPlayUnavailableReason={card => { const play = playable(card.id); return disabled ? needsSync ? "再同期が必要" : "処理中" : !play ? "未対応カード" : play.cost === null ? "コスト未確認" : play.slotIndex < 0 ? "空き枠なし" : !ownTurn || !idle ? "操作待ち" : "DON不足"; }}
      canTestAttackSource={card => !disabled && view.attackChoices.sources.some(option => option.card.instanceId === card.id)}
      canTestAttackTarget={(card, sourceId) => !disabled && view.attackChoices.targets.some(option => option.card.instanceId === card.id) && (!sourceId || view.attackChoices.pairs.some(pair => pair.sourceId === sourceId && pair.targetId === card.id))}
      canTestAttachDon={card => !disabled && idle && ownTurn && view.movement.players[view.localPlayerIndex].activeDon.length > 0 && view.publicStats.some(option => option.card.instanceId === card.id && option.player === view.localPlayerIndex && (option.zone === "leader" || option.zone === "character"))}
      onTestAttachDon={card => { const target = view.publicStats.find(option => option.card.instanceId === card.id)?.card; if (target) onAction("attachDon", { target, count: 1 }); }}
      onInspectEffects={() => setCollapsed(false)} onTestAttack={(sourceId, targetId) => {
        const source = view.attackChoices.sources.find(option => option.card.instanceId === sourceId)?.card, target = view.attackChoices.targets.find(option => option.card.instanceId === targetId)?.card;
        if (source && target) onAction("attack", { source, target });
      }}
      onTestPlay={card => { const play = playable(card.id); if (play?.enabled) onAction("play", { card: play.card }); }} />
    <section className={`test-effect-panel${collapsed ? " test-effect-panel-minimized" : ""}`} aria-label="v3連続操作検証">
      <button hidden={!collapsed} onClick={() => setCollapsed(false)}>効果処理に戻る</button>
      <div hidden={collapsed}><strong>v3検証・連続操作</strong><p>{view.turnNumber}ターン目・{ownTurn ? "自分" : "相手"}のターン</p>
        {battle && <div className="v3-battle-status"><p role="status">{view.damageEffectsPending ? "KO時の効果処理" : battle.step === "attack" ? "アタック時の効果処理" : battle.step === "block" ? "ブロック" : battle.step === "counter" ? "カウンター" : "ダメージ確認"}・{battle.step === "attack" || view.damageEffectsPending ? attackEffectActor === view.localPlayerIndex ? "自分が操作" : "相手の操作待ち" : defending ? "自分が操作" : "相手の操作待ち"}</p>
          {!view.damageEffectsPending && <p>攻撃 {battle.powers?.attack ?? "?"} → 防御 {battle.powers?.defense ?? "?"}</p>}
          {defending && !view.lifePending && !view.damageEffectsPending && view.gate === "idle" && <div className="test-effect-actions">
            {battle.step === "block" && view.blockerChoices.map(choice => <button key={choice.card.instanceId} disabled={disabled} onClick={() => onAction("block", { card: choice.card })}>ブロック・{view.imageAliases[choice.cardId] ?? choice.cardId}</button>)}
            {battle.step === "block" && <button disabled={disabled} onClick={() => onAction("passBlock")}>ブロックしない</button>}
            {battle.step === "counter" && <button disabled={disabled} onClick={() => onAction("endCounter")}>カウンター終了</button>}
            {battle.step === "damage" && <button disabled={disabled} onClick={() => onAction("damage")}>バトル結果を確定</button>}
          </div>}
          {defending && battle.step === "counter" && <>
            <select aria-label="カウンターの対象" value={counterTarget?.instanceId ?? ""} onChange={event => setCounterTargetId(event.target.value)}>{counterTargets.map(card =>
              <option key={card.card.instanceId} value={card.card.instanceId}>{card.zone === "leader" ? "リーダー" : `キャラ${card.slot + 1}`}</option>)}</select>
            <div className="v3-counter-cards">{view.counterChoices.map(choice => {
              const id = view.imageAliases[choice.cardId] ?? choice.cardId, image = getLocalCardImage(id)?.imageUrl;
              return <button key={choice.card.instanceId} disabled={disabled || !counterTarget} onClick={() => counterTarget && onAction("counter", { card: choice.card, target: counterTarget })}>
                {image ? <img src={image} alt={id} draggable={false} /> : <span>{id}</span>}<b>+{choice.amount}</b>
              </button>;
            })}</div>
          </>}
          {view.lifePending && <p role="status">{view.lifeChoice ? "ライフを確認" : "相手がライフを確認中"}</p>}
          {view.lifeChoice && <div className="v3-life-choice"><button onClick={() => setRevealPreview(view.imageAliases[view.lifeChoice!.cardId] ?? view.lifeChoice!.cardId)}>カード詳細</button>
            <button disabled={disabled} onClick={() => onAction("life", { token: view.lifeChoice!.token })}>手札へ</button></div>}
        </div>}
        {view.gate === "trigger" && <div><p role="status">{view.triggerChooser === view.localPlayerIndex ? "解決する効果を選択" : "相手の効果を待っています"}（{view.pendingTriggerCount}件）</p>
          <div className="test-effect-actions">{view.triggerChoices.map(choice => <button key={choice.token} disabled={disabled} onClick={() => onAction("trigger", { token: choice.token })}>
            {choice.timing === "ON_KO" ? "KO時" : choice.timing === "ON_PLAY" ? "登場時" : choice.timing === "ON_ATTACK" ? "アタック時" : "相手のアタック時"}・{view.imageAliases[choice.cardId] ?? choice.cardId}
          </button>)}</div></div>}
        {view.publicReveals.length > 0 && <div className="v3-public-reveals" aria-label="公開中のカード">{view.publicReveals.map((card, index) => {
          const id = view.imageAliases[card.cardId] ?? card.cardId, image = getLocalCardImage(id)?.imageUrl;
          return <button key={`${card.cardId}:${index}`} onClick={() => setRevealPreview(id)}>{image ? <img src={image} alt={id} draggable={false} /> : id}</button>;
        })}</div>}
        {frame && <p role="status">{frame.status === "completed" ? frame.activationDecision === "declined" ? "発動せず終了" : "処理完了" : frame.status === "blocked" ? "未対応または処理不可・停止中" : view.resolutionActor === view.localPlayerIndex ? "自分が操作" : "相手の操作待ち"}</p>}
        {view.publicStats.some(card => card.powerDelta || card.costDelta || card.keywords.length) && <div className="v3-stat-summary" aria-label="数値修正と能力">{view.publicStats.filter(card => card.powerDelta || card.costDelta || card.keywords.length).map(card =>
          <p key={card.card.instanceId}>{card.player === view.localPlayerIndex ? "自分" : "相手"}・{card.zone === "leader" ? "リーダー" : card.zone === "stage" ? "ステージ" : `キャラ${card.slot + 1}`}
            {card.powerDelta !== 0 && <b> パワー {card.power ?? "?"}（{card.powerDelta > 0 ? "+" : ""}{card.powerDelta}）</b>}
            {card.costDelta !== 0 && <b> コスト {card.cost ?? "?"}（{card.costDelta > 0 ? "+" : ""}{card.costDelta}）</b>}
            {card.keywords.length > 0 && <small> {card.keywords.map(keyword => ({ BLOCKER: "ブロッカー", RUSH: "速攻", RUSH_CHARACTER: "速攻：キャラ", CANNOT_BE_BLOCKED: "ブロック不可" }[keyword] ?? keyword)).join("・")}</small>}
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
    {view.outcome && <div className="test-effect-result" role="status">{view.outcome.winner === null ? "DRAW" : view.outcome.winner === view.localPlayerIndex ? "WIN" : "LOSE"}</div>}
    {revealPreview && <div className="test-preview" role="dialog" aria-modal="true" aria-label="公開カード詳細" onClick={() => setRevealPreview(null)}>
      {getLocalCardImage(revealPreview)?.imageUrl ? <img src={getLocalCardImage(revealPreview)!.imageUrl} alt={revealPreview} onClick={event => event.stopPropagation()} /> : <span>{revealPreview}</span>}
      <button onClick={() => setRevealPreview(null)}>閉じる</button>
    </div>}
  </>;
}
