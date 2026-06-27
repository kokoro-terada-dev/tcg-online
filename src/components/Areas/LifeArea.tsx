import { useRef } from "react";

import { useDroppable } from "@dnd-kit/core";

import type { CardData } from "../../types/card";

import GameCard from "../Card/GameCard";
import { GAME_LAYOUT } from "../../layout/gameLayout";
import { getCardBackImageUrl } from "../../utils/localCardImages";

type Props = {
  cards: CardData[];
  playerIndex: number;
  onOpen: () => void;
};

export default function LifeArea({
  cards,
  playerIndex,
  onOpen,
}: Props) {
  const longPressTimer = useRef<number | null>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: `life-${playerIndex}`,
    data: {
      to: "life",
      playerIndex,
    },
  });

  function clearLongPressTimer() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function requestOpen() {
    onOpen();
  }

  const cardBackImage = getCardBackImageUrl();

  return (
    <div
      ref={setNodeRef}
      onMouseUp={clearLongPressTimer}
      onMouseLeave={clearLongPressTimer}
      onTouchMoveCapture={clearLongPressTimer}
      onTouchEndCapture={clearLongPressTimer}
      onTouchCancelCapture={clearLongPressTimer}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();

        clearLongPressTimer();
        requestOpen();
      }}
      style={{
        width: GAME_LAYOUT.css.lifeWidth,
        height: GAME_LAYOUT.css.lifeHeight,

        border: isOver
          ? GAME_LAYOUT.css.areaBorderActive
          : GAME_LAYOUT.css.areaBorder,

        borderRadius: GAME_LAYOUT.css.areaRadius,
        background: "#111827",

        position: "relative",
        overflow: "hidden",
        isolation: "isolate",

        userSelect: "none",
      }}
    >
      {cards.length === 0 && (
        <div
          style={{
            color: "white",
            height: "100%",

            display: "flex",
            justifyContent: "center",
            alignItems: "center",

            fontWeight: "bold",
          }}
        >
          LIFE
        </div>
      )}

      {cards.map((card, index) => (
        <div
          key={card.id}
          style={{
            position: "absolute",

            left: "calc(var(--op-life-width) * 0.18)",

            top: `calc(${index} * var(--op-life-stack-gap) + var(--op-life-stack-offset-y))`,

            zIndex: cards.length - index,
          }}
        >
          <GameCard
            card={{
              ...card,
              image: card.isFaceUp ? card.image : cardBackImage,
              rotated: false,
            }}
            playerIndex={playerIndex}
            from="life"
            draggableDisabled={index !== 0}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();

          clearLongPressTimer();
          requestOpen();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
        style={{
          position: "absolute",

          right: "0px",
          bottom: "0px",

          width: "34px",
          height: "25px",

          color: "white",

          background: "rgba(15,23,42,0.92)",

          border: "2px solid #94a3b8",

          borderRadius: "6px",

          display: "flex",
          justifyContent: "center",
          alignItems: "center",

          fontSize: "14px",
          fontWeight: "bold",

          boxShadow:
            "0 0 10px rgba(0,0,0,0.6)",

          textShadow: `
    -1px 0 0 #000,
     1px 0 0 #000,
     0 -1px 0 #000,
     0 1px 0 #000
  `,

          zIndex: 999,

          cursor: "pointer",
        }}
      >
        ×{cards.length}
      </button>
    </div>
  );
}
