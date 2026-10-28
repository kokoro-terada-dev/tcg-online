import { useEffect, useState } from "react";
import TestBoard from "./TestBoard";
import { canTestAttackSource, canTestAttackTarget, effectBoardView, testPlayDestination, type EffectTransportView, type EffectCommandKind } from "./effectClientState";
import { getCardBackImageUrl, getLocalCardImage } from "../utils/localCardImages";
import "./testEffect.css";
import EffectCatalogDialog from "./EffectCatalogDialog";
import type { EffectCatalogView } from "./effectClientState";
import type { CardView } from "../../server/src/test/protocol";

type Props = { view: EffectTransportView; roomId: string; busy: boolean; error: string; needsSync: boolean;
  onAction: (kind: EffectCommandKind, tokens?: readonly string[]) => void; onSync: () => void; onEnd: () => void;
  onCatalog?: (instanceId: string) => Promise<EffectCatalogView>; onActivateCatalog?: (catalog: EffectCatalogView, effectId: string) => void; onTestTurn?: () => void; onTestPlay?: (instanceId: string) => void;
  onTestAttack?: (sourceId: string, targetId: string) => void; onTestBattleDecision?: (decision: "passBlock" | "endCounter") => void; onTestResolveDamage?: () => void };
export default function TestEffectBoard(props: Props) {
  const { view, busy, needsSync, onAction } = props;
  const [inspected, setInspected] = useState<{ card: CardView; context: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);
  const finished = view.progression.finished;
  const resultLabel = view.progression.winner === view.localPlayerIndex ? "WIN" :
    view.progression.winner !== null || view.progression.defeatedPlayers?.includes(view.localPlayerIndex) ? "LOSE" : "対戦終了";
  useEffect(() => {
    setResultVisible(finished);
    if (!finished) return;
    const timer = window.setTimeout(() => setResultVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [view.matchId, finished]);
  const context = `${view.matchId}:${view.localPlayerIndex}:${view.effect.resolutionId}:${view.movement.revision}:${view.progression.revision}:${view.effect.status}:${busy}:${needsSync}`;
  useEffect(() => { setInspected(null); }, [context]);
  useEffect(() => { setCollapsed(false); }, [view.effect.resolutionId, view.effect.status, view.selection?.selectionId]);
  const selection = view.selection, mine = view.effect.actor === view.localPlayerIndex, disabled = busy || needsSync || finished;
  let board;
  try { board = effectBoardView(view); } catch { return <main><p role="alert">この盤面形式はまだ表示できません。</p><button onClick={props.onEnd}>ルームへ戻る</button></main>; }
  return <>
    <TestBoard key={`${view.effect.resolutionId}:${view.movement.revision}:${view.progression.revision}`} match={board} roomId={props.roomId} busy={busy} error={props.error} readOnly onCommand={() => {}} onEnd={props.onEnd}
      onTestPlay={view.testPlayAvailable && props.onTestPlay && !disabled ? card => props.onTestPlay!(card.id) : undefined}
      canTestPlay={card => testPlayDestination(view, card.id) !== null}
      onTestAttack={view.testAttackAvailable && !disabled ? props.onTestAttack : undefined}
      canTestAttackSource={card => canTestAttackSource(view, card.id)} canTestAttackTarget={card => canTestAttackTarget(view, card.id)}
      onInspectEffects={props.onCatalog && !disabled ? card => setInspected({ card, context }) : undefined} />
    <section className={`test-effect-panel${collapsed ? " test-effect-panel-minimized" : ""}`} aria-label="効果処理">
      <button hidden={!collapsed} onClick={() => setCollapsed(false)}>効果処理に戻る</button>
      <div hidden={collapsed}>
      {selection ? <Selection key={selection.selectionId} selection={selection} disabled={disabled}
        onConfirm={tokens => onAction(view.effect.status === "waitingForCostSelection" ? "answerCosts" : "answerEffect", tokens)} /> : <p role="status">{
        finished ? (view.progression.defeatedPlayers?.length === 2 ? "対戦終了・両者敗北" : `対戦終了・${resultLabel}`) :
        view.battle && view.effect.status === "idle" ? (view.battle.step === "block" ? "ブロック判断待ち" : view.battle.step === "counter" ? "カウンター判断待ち" : "ダメージ判定待ち") :
        view.effect.status === "idle" ? <><span>{view.progression.activePlayer === view.localPlayerIndex ? "自分のターン・待機中" : "相手のターン・待機中"}</span><small> / {view.progression.turnNumber}ターン目</small></> :
        view.effect.status === "completed" ? "処理完了" : view.effect.status === "blocked" ? "処理を続行できません" :
        !mine || view.effect.status === "waitingForSelection" ? "相手の操作を待っています" :
        view.effect.status === "costsReady" ? "支払いを確定してください" : "効果処理"
      }</p>}
      {view.battlePower && <p aria-label="判定用パワー">攻撃 {view.battlePower.attack ?? "?"} / 防御 {view.battlePower.defense ?? "?"}
        {(view.battlePower.attack === null || view.battlePower.defense === null) && <small>（パワー情報不足・未対応）</small>}</p>}
      <div className="test-effect-actions">
        {mine && view.effect.status === "prepared" && <button disabled={disabled} onClick={() => onAction("beginCosts")}>効果を使う</button>}
        {mine && view.effect.status === "costsReady" && <button disabled={disabled} onClick={() => onAction("commitCosts")}>実行</button>}
        {mine && view.effect.status === "resolving" && <button disabled={disabled} onClick={() => onAction("advance")}>処理を進める</button>}
        {mine && ["costsReady", "waitingForCostSelection"].includes(view.effect.status) && <button disabled={disabled} onClick={() => onAction("cancelCosts")}>キャンセル</button>}
        <button disabled={busy} onClick={props.onSync}>再同期</button>
        <button onClick={() => setCollapsed(true)}>盤面を見る</button>
        {view.effect.status === "idle" && view.testTurnSwitchAvailable && props.onTestTurn && <button disabled={disabled} onClick={props.onTestTurn}>テスト手番交代</button>}
        {view.effect.status === "idle" && view.testBattleDecision && props.onTestBattleDecision && <button disabled={disabled} onClick={() => props.onTestBattleDecision!(view.testBattleDecision!)}>{view.testBattleDecision === "passBlock" ? "ブロックしない" : "カウンター終了"}</button>}
        {view.effect.status === "idle" && view.testDamageAvailable && props.onTestResolveDamage && <button disabled={disabled} onClick={props.onTestResolveDamage}>テストダメージ判定</button>}
      </div>
      {needsSync && <p role="alert">応答を確認できません。再同期してください。</p>}
      </div>
    </section>
    {finished && resultVisible && <div className={`test-effect-result${resultLabel === "WIN" ? " test-effect-result-win" : ""}`} role="status">{resultLabel}</div>}
    {inspected?.context === context && props.onCatalog && <EffectCatalogDialog key={`${context}:${inspected.card.id}`} card={inspected.card} onLoad={props.onCatalog} onClose={() => setInspected(null)}
      {...(props.onActivateCatalog ? { onActivate: props.onActivateCatalog } : {})} />}
  </>;
}
function Selection({ selection, disabled, onConfirm }: { selection: NonNullable<EffectTransportView["selection"]>; disabled: boolean; onConfirm: (tokens: readonly string[]) => void }) {
  const [tokens, setTokens] = useState<string[]>([]);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const min = selection.kind === "choice" ? 1 : selection.min, max = selection.kind === "choice" ? 1 : selection.max;
  const valid = tokens.length >= min && tokens.length <= max;
  function toggle(token: string) {
    setTokens(current => current.includes(token) ? current.filter(t => t !== token) : current.length < max ? [...current, token] : current);
  }
  return <div>
    <p>{selection.kind === "choice" ? "選択してください" : `カード選択 ${tokens.length} / ${max}`}</p>
    <div className="test-effect-candidates">
      {selection.kind === "choice" ? selection.options.map(option => <label key={option.token}>
        <input type="radio" name={selection.selectionId} disabled={disabled} checked={tokens[0] === option.token} onChange={() => setTokens([option.token])} />{option.label}
      </label>) : selection.candidates.map(card => {
        const image = card.cardId ? getLocalCardImage(card.cardId)?.imageUrl : getCardBackImageUrl();
        return <button key={card.token} role="checkbox" aria-checked={tokens.includes(card.token)} aria-label={card.cardId ?? "裏向きカード"}
          disabled={disabled || (!tokens.includes(card.token) && tokens.length >= max)} onClick={() => toggle(card.token)}>
          {image && !failedImages.has(card.token) ? <img src={image} alt={card.cardId ?? "裏向きカード"} draggable={false} onError={() => setFailedImages(current => new Set([...current, card.token]))} /> : <span>{card.cardId ?? "裏向きカード"}</span>}
          {tokens.includes(card.token) && <b>{tokens.indexOf(card.token) + 1}</b>}
        </button>;
      })}
    </div>
    <button className="test-effect-confirm" disabled={disabled || !valid} onClick={() => onConfirm(tokens)}>選択を確定</button>
  </div>;
}
