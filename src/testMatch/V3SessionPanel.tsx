import { useEffect, useState } from "react";
import type { V3SessionView, V3SessionCommand } from "../../server/src/test/effects/v3/sessionProtocol";
import type { SessionDetails } from "./v3SessionClient";
import { v3BoardView } from "./v3FixtureClient";
import V3ChoicePanel from "./V3ChoicePanel";
import TestBoard from "./TestBoard";
const workLabels = { PAY_COSTS: "支払いを確定", DRAW: "ドローを実行", MOVE_CARD: "カードを移動", KO: "KOを実行", REST: "レストにする", SET_ACTIVE: "アクティブにする" };
export default function V3SessionPanel({ view, busy, needsSync, error, isHost, onAction, onSync, onEnd }: {
  view: V3SessionView; busy: boolean; needsSync: boolean; error: string; isHost: boolean;
  onAction: (kind: V3SessionCommand["kind"], details?: SessionDetails) => void; onSync: () => void; onEnd: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false), frame = view.frame, ownTurn = view.activePlayer === view.localPlayerIndex;
  useEffect(() => setCollapsed(false), [view.context.resolutionId, frame?.choice?.selectionId, frame?.status, view.turnNumber]);
  const idle = view.gate === "idle" && (!frame || frame.status === "completed"), disabled = busy || needsSync;
  return <>
    <TestBoard key={`${view.matchId}:${view.movement.revision}`} match={v3BoardView(view)} roomId={view.roomId} readOnly busy={busy} error={error} onCommand={() => {}} onEnd={onEnd} />
    <section className={`test-effect-panel${collapsed ? " test-effect-panel-minimized" : ""}`} aria-label="v3連続操作検証">
      <button hidden={!collapsed} onClick={() => setCollapsed(false)}>効果処理に戻る</button>
      <div hidden={collapsed}><strong>v3検証・連続操作</strong><p>{view.turnNumber}ターン目・{ownTurn ? "自分" : "相手"}のターン</p>
        {frame && <p role="status">{frame.status === "completed" ? frame.activationDecision === "declined" ? "発動せず終了" : "処理完了" : frame.status === "blocked" ? "未対応または処理不可・停止中" : view.resolutionActor === view.localPlayerIndex ? "自分が操作" : "相手の操作待ち"}</p>}
        {frame?.choice?.chooser === view.localPlayerIndex && <V3ChoicePanel key={frame.choice.selectionId} choice={frame.choice} disabled={disabled} onConfirm={tokens => onAction("answer", { tokens })} />}
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
  </>;
}
