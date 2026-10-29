import { useState } from "react";
import type { V3SetupView } from "../../server/src/test/effects/v3/setupProtocol";
import { getLocalCardImage } from "../utils/localCardImages";

export default function V3SetupPanel({ view, busy, needsSync, error, isHost, onAction, onSync, onEnd }: {
  view: V3SetupView; busy: boolean; needsSync: boolean; error: string; isHost: boolean;
  onAction: (kind: "first" | "mulligan", value: "first" | "second" | boolean) => void; onSync: () => void; onEnd: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null), own = view.localPlayerIndex, disabled = busy || needsSync;
  const hand = view.movement.players[own]!.hand, image = (id: string) => getLocalCardImage(id)?.imageUrl;
  const choosing = view.status === "firstChoice", myChoice = choosing ? view.choicePlayer === own : view.mulliganPlayer === own;
  return <main className="v3-fixture-lobby v3-setup"><div>
    <header><h1>{choosing ? "先攻・後攻" : "手札確認"}</h1><span>{view.roomId}</span></header>
    {view.movement.players.map((player, index) => {
      const leader = player.leader[0], id = leader?.cardId, outcome = view.mulligans[index];
      return <section className="v3-setup-player" key={index}>
        {id && (image(id) ? <img src={image(id)} alt={id} draggable={false} /> : <span>{id}</span>)}
        <div><strong>{index === own ? "自分" : "相手"}</strong><p>{view.firstPlayer !== null ? view.firstPlayer === index ? "先攻" : "後攻" : "抽選済み"}</p></div>
        <span>{choosing ? view.choicePlayer === index ? "選択権あり" : "待機" : outcome === null ? "選択待ち" : outcome ? "引き直し済み" : "この手札で確定"}</span>
      </section>;
    })}
    <p role="status">{choosing ? myChoice ? "先攻か後攻を選んでください" : "相手が先後選択中です…" : myChoice ? "最初の手札を確定してください" : "相手の手札確定を待っています…"}</p>
    {choosing ? myChoice && <div className="v3-setup-actions"><button disabled={disabled} onClick={() => onAction("first", "first")}>先攻</button><button disabled={disabled} onClick={() => onAction("first", "second")}>後攻</button></div> : <>
      <strong>あなたは{view.firstPlayer === own ? "先攻" : "後攻"}です</strong>
      <div className="v3-setup-hand">{hand.map((card, index) => {
        const id = card?.cardId;
        return <button key={card?.ref?.instanceId ?? index} disabled={!id} onClick={() => id && setPreview(id)} aria-label={`${id ?? "カード"}の詳細`}>
          {id && image(id) ? <img src={image(id)} alt={id} draggable={false} /> : <span>{id}</span>}
        </button>;
      })}</div>
      {myChoice && <div className="v3-setup-actions"><button disabled={disabled} onClick={() => onAction("mulligan", true)}>引き直す</button><button disabled={disabled} onClick={() => onAction("mulligan", false)}>この手札にする</button></div>}
    </>}
    {error && <p role="alert">{error}</p>}
    <div className="v3-setup-actions"><button disabled={busy} onClick={onSync}>再同期</button>{isHost && <button disabled={busy} onClick={onEnd}>ルームへ戻る</button>}</div>
    {preview && <div className="test-preview" role="dialog" aria-modal="true" aria-label="手札カード詳細" onClick={() => setPreview(null)}>
      {image(preview) ? <img src={image(preview)} alt={preview} onClick={event => event.stopPropagation()} /> : <span>{preview}</span>}
      <button onClick={() => setPreview(null)}>閉じる</button>
    </div>}
  </div></main>;
}
