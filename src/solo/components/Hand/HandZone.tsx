import type { CardData } from "../../types/card";

import GameCard from "../Card/GameCard";

import { useDroppable } from "@dnd-kit/core";
import { GAME_LAYOUT } from "../../layout/gameLayout";

type Props = {
  cards: CardData[];

  playerIndex: number;
};

export default function HandZone({
  cards,
  playerIndex,
}: Props) {
  const { setNodeRef } =
    useDroppable({
      id: `hand-${playerIndex}`,

      data: {
        to: "hand",

        playerIndex,
      },
    });

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",

        gap: GAME_LAYOUT.css.boardGap,

        overflowX: "auto",

        padding: GAME_LAYOUT.css.handPadding,

        minHeight: GAME_LAYOUT.css.handMinHeight,

        border: "2px solid #475569",

        borderRadius: GAME_LAYOUT.css.areaRadius,

        background: "#1e293b",
      }}
    >
      {cards.map((card) => (
        <GameCard
          key={card.id}
          card={card}
          playerIndex={playerIndex}
          from="hand"
        />
      ))}
    </div>
  );
}