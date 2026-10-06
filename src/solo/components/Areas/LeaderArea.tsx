import { useDroppable } from "@dnd-kit/core";

import type { CardData } from "../../types/card";

import GameCard from "../Card/GameCard";
import { GAME_LAYOUT } from "../../layout/gameLayout";

type Props = {
  card: CardData | null;

  playerIndex: number;

  onPreview?: (
    image: string | null
  ) => void;
};

export default function LeaderArea({
  card,
  playerIndex,
  onPreview,
}: Props) {
  const { setNodeRef } = useDroppable({
    id: `leader-${playerIndex}`,
    data: {
      to: "leader",
      playerIndex,
      cardId: card?.id,
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        width: GAME_LAYOUT.css.leaderWidth,
        height:
          "calc(var(--op-card-height) + 15px)",
        border: GAME_LAYOUT.css.areaBorder,
        borderRadius: GAME_LAYOUT.css.cardRadius,
      }}
    >
      {card && (
        <GameCard
          card={card}
          playerIndex={playerIndex}
          from="leader"
          onPreview={onPreview}
        />
      )}
    </div>
  );
}