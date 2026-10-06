import { useDroppable } from "@dnd-kit/core";

import type { CardData } from "../../types/card";

import GameCard from "../Card/GameCard";
import { GAME_LAYOUT } from "../../layout/gameLayout";

type Props = {
  cards: (CardData | null)[];

  playerIndex: number;

  onPreview: (
    image: string | null
  ) => void;
};

export default function CharacterArea({
  cards,
  playerIndex,
  onPreview,
}: Props) {
  return (
    <div
      style={{
        display: "flex",

        justifyContent: "center",

        gap: GAME_LAYOUT.css.characterGap,
      }}
    >
      {cards.map((card, slotIndex) => (
        <CharacterSlot
          key={slotIndex}
          card={card}
          slotIndex={slotIndex}
          playerIndex={playerIndex}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
}

function CharacterSlot({
  card,
  slotIndex,
  playerIndex,
  onPreview,
}: {
  card: CardData | null;

  slotIndex: number;

  playerIndex: number;

  onPreview: (
    image: string | null
  ) => void;
}) {
  const { setNodeRef, isOver } =
    useDroppable({
      id: `character-${playerIndex}-${slotIndex}`,

      data: {
        to: "character",

        slotIndex,

        playerIndex,

        cardId: card?.id,
      },
    });

  return (
    <div
      ref={setNodeRef}
      style={{
        width: GAME_LAYOUT.css.deckWidth,

        height:
          "calc(var(--op-card-height) + 2px)",

        border: isOver
          ? GAME_LAYOUT.css.areaBorderActive
          : GAME_LAYOUT.css.areaBorder,

        borderRadius: GAME_LAYOUT.css.cardRadius,

        display: "flex",

        alignItems: "center",

        justifyContent: "center",

        background: "#0f172a",
      }}
    >
      {card && (
        <GameCard
          card={card}
          playerIndex={playerIndex}
          from="character"
          onPreview={onPreview}
        />
      )}
    </div>
  );
}