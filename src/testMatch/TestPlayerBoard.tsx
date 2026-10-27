import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CardView, PlayerView, Zone } from "../../server/src/test/protocol";
import { GAME_LAYOUT } from "../layout/gameLayout";

type Props = {
  player: PlayerView;
  playerIndex: 0 | 1;
  reversed: boolean;
  renderCard: (card: CardView, zone: Zone, index: number) => ReactNode;
  onOpen: (zone: Zone) => void;
  onPlace: (zone: Zone, index: number) => void;
  canPlace: (zone: Zone) => boolean;
};

// Dimensions, spacing and ordering follow the existing PlayerBoard and Areas.
// The fit wrapper only scales down when their natural size exceeds the viewport.
export default function TestPlayerBoard({ player, playerIndex, reversed, renderCard, onOpen, onPlace, canPlace }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      if (!outer.current || !content.current) return;
      const next = Math.min(1, outer.current.clientHeight / Math.max(1, content.current.offsetHeight), outer.current.clientWidth / Math.max(1, content.current.scrollWidth));
      setScale((current) => Math.abs(current - next) > .001 ? next : current);
    };
    const observer = new ResizeObserver(fit);
    if (outer.current) observer.observe(outer.current);
    if (content.current) observer.observe(content.current);
    fit();
    return () => observer.disconnect();
  }, []);

  function count(zone: Zone) {
    return <button className="test-stack-count" aria-label={`${reversed ? "相手" : "自分"}の${zone}リスト`} onClick={() => onOpen(zone)}>×{player.zones[zone].filter(Boolean).length}</button>;
  }
  function stack(zone: "deck" | "trash" | "public") {
    const card = player.zones[zone][0];
    return <div className={`test-standard-stack test-standard-${zone}`} data-test-area={zone}>
      {card ? <div className="test-stack-top">{renderCard(card, zone, 0)}</div> : <div className="test-empty-title">{zone === "public" ? "公開" : zone.toUpperCase()}</div>}
      {count(zone)}
    </div>;
  }
  function life() {
    return <div className="test-standard-life" data-test-area="life">
      {player.zones.life.length === 0 && <div className="test-empty-title">LIFE</div>}
      {player.zones.life.map((card, index) => card && <div key={card.id} style={{ position: "absolute", left: "calc(var(--op-life-width) * .18)", top: `calc(${index} * var(--op-life-stack-gap) + var(--op-life-stack-offset-y))`, zIndex: player.zones.life.length - index, pointerEvents: index === 0 ? "auto" : "none" }}>{renderCard(card, "life", index)}</div>)}
      {count("life")}
    </div>;
  }
  function slot(zone: "character" | "stage" | "leader", index: number) {
    const card = player.zones[zone][index];
    return <div key={index} className={`test-standard-slot test-standard-${zone}`} data-test-area={zone} data-slot={index}>
      {card ? renderCard(card, zone, index) : <button className="test-slot-target" aria-label={`${zone === "character" ? "キャラクター" : "ステージ"}の空き枠${index + 1}`} disabled={!canPlace(zone)} onClick={() => onPlace(zone, index)}>{zone === "stage" ? "STAGE" : ""}</button>}
    </div>;
  }
  function don(zone: "donDeck" | "activeDon" | "restDon") {
    const card = player.zones[zone][0];
    return <div className={`test-standard-don${zone === "restDon" ? " test-standard-don-rest" : ""}`} data-test-area={zone}>
      {card && <div className="test-standard-don-top">{renderCard({ ...card, rotated: zone === "restDon" }, zone, 0)}</div>}
      <button className="test-don-count" aria-label={`${reversed ? "相手" : "自分"}の${zone}リスト`} onClick={() => onOpen(zone)}>{player.zones[zone].length}</button>
    </div>;
  }
  const characters = <div style={{ marginTop: reversed ? GAME_LAYOUT.css.boardInnerGap : "var(--op-character-top-gap)", flexShrink: 0 }}><div style={{ display: "flex", justifyContent: "center", gap: GAME_LAYOUT.css.characterGap }}>{player.zones.character.map((_, index) => slot("character", index))}</div></div>;
  const main = <div style={{ display: "flex", justifyContent: "center", gap: GAME_LAYOUT.css.mainAreaGap, marginTop: GAME_LAYOUT.css.boardInnerGap, flexShrink: 0 }}>
    {life()}{slot("leader", 0)}{slot("stage", 0)}<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--area-gap)" }}>{stack("deck")}</div>
  </div>;
  const support = <div style={{ display: "flex", justifyContent: "center", gap: GAME_LAYOUT.css.boardGap, marginTop: reversed ? 0 : GAME_LAYOUT.css.boardInnerGap, alignItems: "center", flexShrink: 0 }}>
    <div style={{ display: "flex", gap: GAME_LAYOUT.css.donAreaGap, alignItems: "center" }}>
      {don("donDeck")}<div style={{ marginLeft: "var(--op-active-don-offset-left, 100px)", display: "flex", alignItems: "center" }}>{don("activeDon")}<div style={{ width: "var(--op-active-rest-gap, 48px)" }} />{don("restDon")}</div>
    </div>
    <div style={{ marginTop: reversed ? "0px" : "var(--op-trash-lift)", marginLeft: "var(--op-trash-offset-left, 120px)", display: "flex", gap: "6px", alignItems: "center" }}>{stack("trash")}{stack("public")}</div>
  </div>;
  const hand = <div style={{ marginTop: reversed ? 0 : GAME_LAYOUT.css.boardInnerGap, marginBottom: reversed ? "var(--op-top-hand-gap)" : undefined, flexShrink: 0 }}><TestHand cards={player.zones.hand} renderCard={renderCard} onOpen={() => onOpen("hand")} /></div>;
  return <div ref={outer} className="test-player-fit" aria-label={reversed ? "相手の盤面" : "自分の盤面"}>
    <div ref={content} className="test-standard-player" style={{ transform: `scale(${scale})`, borderLeft: `3px solid ${playerIndex === 0 ? "#38bdf8" : "#fb7185"}`, background: playerIndex === 0 ? "rgba(14,116,144,.055)" : "rgba(190,24,93,.055)" }}>
      {reversed ? <>{hand}{support}{main}{characters}</> : <>{characters}{main}{support}{hand}</>}
    </div>
  </div>;
}

function TestHand({ cards, renderCard, onOpen }: { cards: (CardView | null)[]; renderCard: Props["renderCard"]; onOpen: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const [overlap, setOverlap] = useState(0);
  useLayoutEffect(() => {
    function update() {
      if (!root.current || !first.current || cards.length < 2) { setOverlap(0); return; }
      const style = getComputedStyle(root.current);
      const available = Math.max(0, root.current.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 36);
      const width = first.current.offsetWidth;
      setOverlap(Math.ceil(Math.min(width * .78, Math.max(0, (width * cards.length - available) / (cards.length - 1)))));
    }
    const observer = new ResizeObserver(update);
    if (root.current) observer.observe(root.current);
    if (first.current) observer.observe(first.current);
    update();
    return () => observer.disconnect();
  }, [cards.length]);
  return <div ref={root} className="test-standard-hand" data-test-area="hand">
    {cards.map((card, index) => card && <div ref={index === 0 ? first : undefined} key={card.id} style={{ flexShrink: 0, marginLeft: index === 0 ? 0 : -overlap, zIndex: index + 1 }}>{renderCard(card, "hand", index)}</div>)}
    <button className="test-hand-count" aria-label="手札リスト" onClick={onOpen}>×{cards.length}</button>
  </div>;
}
