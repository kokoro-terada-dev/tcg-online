import { useDroppable } from "@dnd-kit/core";

import type { CardData } from "../../types/card";
import { GAME_LAYOUT } from "../../layout/gameLayout";

type Props = {
  cards: CardData[];
  playerIndex: number;
};

export default function DonDeckArea({
  cards,
  playerIndex,
}: Props) {

  const { setNodeRef, isOver } = useDroppable({
    id: `don-deck-${playerIndex}`,
    data: {
      to: "donDeck",
      playerIndex,
    },
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        alignItems: "center",
      }}
    >

      <div
        ref={setNodeRef}
        style={{
          width: GAME_LAYOUT.css.deckWidth,
          height: GAME_LAYOUT.css.deckHeight,
          border: isOver
            ? GAME_LAYOUT.css.areaBorderActive
            : GAME_LAYOUT.css.areaBorder,
          borderRadius: GAME_LAYOUT.css.cardRadius,
          background: "#111827",
          color: "white",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          fontWeight: "bold",
        }}
      >
        <div className="area-title">
          DON DECK
        </div>

        <div className="area-count">
          {cards.length}
        </div>
      </div>
    </div>
  );
}