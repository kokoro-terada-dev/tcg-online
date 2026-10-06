import { useRef } from "react";

import { useDroppable } from "@dnd-kit/core";

import type { CardData } from "../../types/card";

import GameCard from "../Card/GameCard";
import { GAME_LAYOUT } from "../../layout/gameLayout";

type Props = {
  cards: CardData[];
  playerIndex: number;
  onOpen: () => void;
};

export default function TrashArea({
  cards,
  playerIndex,
  onOpen,
}: Props) {
  const longPressTimer = useRef<number | null>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: `trash-${playerIndex}`,
    data: {
      to: "trash",
      playerIndex,
    },
  });

  function clearTimer() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const topCard = cards[0];

  return (
    <div
      ref={setNodeRef}
      onTouchMoveCapture={clearTimer}
      onTouchEndCapture={clearTimer}
      onTouchCancelCapture={clearTimer}
      onContextMenuCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();

        clearTimer();
        onOpen();
      }}
      style={{
        width: "calc(var(--op-trash-width) + 3px)",
        height: "calc(var(--op-trash-height) + 3px)",
        border: isOver
          ? GAME_LAYOUT.css.areaBorderActive
          : GAME_LAYOUT.css.areaBorder,
        borderRadius: GAME_LAYOUT.css.areaRadius,
        background: "#111827",
        position: "relative",
        overflow: "visible",
        userSelect: "none",
      }}
    >
      {topCard ? (
        <>
          {cards.length >= 2 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 1,
                pointerEvents: "none",
              }}
            >
              <img
                src={cards[1].image}
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: GAME_LAYOUT.css.cardRadius,
                }}
              />
            </div>
          )}

          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
            }}
          >
            <GameCard
              card={{
                ...topCard,
                isFaceUp: true,
                rotated: false,
              }}
              playerIndex={playerIndex}
              from="trash"
            />
          </div>
        </>
      ) : (
        <div
          style={{
            color: "white",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontWeight: "bold",
            fontSize: "12px"
          }}
        >
          TRASH
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();

          clearTimer();
          onOpen();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
        style={{
          position: "absolute",

          right: "0px",
          bottom: "0px",

          width: "34px",
          height: "20px",

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