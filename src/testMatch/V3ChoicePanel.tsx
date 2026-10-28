import { useState } from "react";
import type { V3Choice } from "../../server/src/test/effects/v3/fixtureProtocol";
import { getLocalCardImage } from "../utils/localCardImages";
export default function V3ChoicePanel({ choice, disabled, onConfirm }: { choice: V3Choice; disabled: boolean; onConfirm: (tokens: string[]) => void }) {
  const [tokens, setTokens] = useState<string[]>([]), [failed, setFailed] = useState<string[]>([]);
  if (choice.purpose === "activation") return <div><p>効果を発動しますか？</p><div className="test-effect-actions v3-activation-actions">{choice.options.map(option =>
    <button key={option.token} disabled={disabled} onClick={() => onConfirm([option.token])}>{option.label}</button>
  )}</div></div>;
  const activeSelected = choice.options.filter(option => option.zone === "activeDon" && tokens.includes(option.token)).length;
  return <div><p>{choice.purpose === "cost" ? "コストで捨てる手札" : choice.purpose === "returnCost" ? "DONデッキへ戻すDON" : "カード選択"} {tokens.length} / {choice.max}</p><div className="test-effect-candidates">{choice.options.map(option => {
    const image = getLocalCardImage(option.cardId)?.imageUrl;
    const activeReserved = choice.purpose === "returnCost" && option.zone === "activeDon" && activeSelected >= (choice.maxActiveReturn ?? 0);
    return <button key={option.token} role="checkbox" aria-checked={tokens.includes(option.token)} aria-label={option.label ? `${option.label} ${option.cardId}` : option.cardId} disabled={disabled || !tokens.includes(option.token) && (tokens.length >= choice.max || activeReserved)}
      onClick={() => setTokens(current => current.includes(option.token) ? current.filter(token => token !== option.token) : [...current, option.token])}>
      {image && !failed.includes(option.token) ? <img src={image} alt={option.cardId} draggable={false} onError={() => setFailed(current => [...current, option.token])} /> : <span>{option.cardId}</span>}
      {option.label && <span className="v3-don-choice-label">{option.label}</span>}
      {tokens.includes(option.token) && <b>{tokens.indexOf(option.token) + 1}</b>}
    </button>;
  })}</div><button className="test-effect-confirm" disabled={disabled || tokens.length < choice.min || tokens.length > choice.max} onClick={() => onConfirm(tokens)}>{choice.purpose !== "action" ? "支払いカードを確定" : "選択を確定"}</button></div>;
}
