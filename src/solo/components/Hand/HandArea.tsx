import { useEffect, useRef, useState } from "react";

import { useDroppable } from "@dnd-kit/core";

import type { CardData } from "../../types/card";

import GameCard from "../Card/GameCard";

type Props = {
  cards: CardData[];

  playerIndex: number;

  onPreview: (image: string | null) => void;
};

export default function HandArea({
  cards,
  playerIndex,
  onPreview,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstCardRef = useRef<HTMLDivElement | null>(null);

  const [cardOverlap, setCardOverlap] = useState(0);

  const { setNodeRef } = useDroppable({
    id: `hand-${playerIndex}`,

    data: {
      to: "hand",

      playerIndex,
    },
  });

  function setRootNode(element: HTMLDivElement | null) {
    rootRef.current = element;
    setNodeRef(element);
  }

  useEffect(() => {
    function updateOverlap() {
      const root = rootRef.current;
      const firstCard = firstCardRef.current;

      if (!root || !firstCard || cards.length <= 1) {
        setCardOverlap(0);
        return;
      }

      const rootStyle = window.getComputedStyle(root);

      const paddingLeft = Number.parseFloat(rootStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(rootStyle.paddingRight) || 0;

      const availableWidth = Math.max(
        0,
        root.clientWidth - paddingLeft - paddingRight - 36
      );

      const cardWidth = firstCard.getBoundingClientRect().width;

      if (cardWidth <= 0) {
        setCardOverlap(0);
        return;
      }

      const naturalWidth = cardWidth * cards.length;

      if (naturalWidth <= availableWidth) {
        setCardOverlap(0);
        return;
      }

      const requiredOverlap =
        (naturalWidth - availableWidth) / (cards.length - 1);

      const maxOverlap = cardWidth * 0.78;

      setCardOverlap(
        Math.ceil(Math.min(requiredOverlap, maxOverlap))
      );
    }

    updateOverlap();

    const resizeObserver = new ResizeObserver(updateOverlap);

    if (rootRef.current) {
      resizeObserver.observe(rootRef.current);
    }

    if (firstCardRef.current) {
      resizeObserver.observe(firstCardRef.current);
    }

    window.addEventListener("orientationchange", updateOverlap);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("orientationchange", updateOverlap);
    };
  }, [cards.length]);

  return (
    <div
      ref={setRootNode}
      style={{
        position: "relative",

        width: "100%",

        minHeight: "var(--op-hand-min-height)",

        border: "2px solid #475569",

        borderRadius: "12px",

        background: "#1e293b",

        padding: "var(--op-hand-padding)",

        overflowX: "hidden",
        overflowY: "hidden",

        display: "flex",

        alignItems: "center",

        touchAction: "none",
      }}
    >
      {cards.map((card, index) => {
        return (
          <div
            key={card.id}
            ref={index === 0 ? firstCardRef : undefined}
            style={{
              flexShrink: 0,

              marginLeft:
                index === 0 ? 0 : `-${cardOverlap}px`,

              pointerEvents: "auto",

              touchAction: "none",

              zIndex: index + 1,
            }}
          >
            <GameCard
              card={card}
              playerIndex={playerIndex}
              from="hand"
              onPreview={onPreview}
            />
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",

          right: "6px",

          bottom: "3px",

          fontSize: "clamp(18px, 5vw, 28px)",

          fontWeight: 900,

          color: "white",

          WebkitTextStroke: "2px black",

          pointerEvents: "none",

          zIndex: 999,
        }}
      >
        ×{cards.length}
      </div>
    </div>
  );
}
