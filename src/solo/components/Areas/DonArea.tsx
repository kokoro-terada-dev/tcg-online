import { useDroppable } from "@dnd-kit/core";

import type { CardData } from "../../types/card";

import GameCard from "../Card/GameCard";
import { GAME_LAYOUT } from "../../layout/gameLayout";

type DonAreaKey =
  | "donDeck"
  | "activeDon"
  | "restDon";

type Props = {
  donDeck: CardData[];
  activeDons: CardData[];
  restDons: CardData[];

  playerIndex: number;

  selectedDonStack: {
    playerIndex: number;
    fromArea: DonAreaKey;
    count: number;
  } | null;

  onSelectDonStack: (
    fromArea: DonAreaKey
  ) => void;
};

export default function DonArea({
  donDeck,
  activeDons,
  restDons,
  playerIndex,
  selectedDonStack,
  onSelectDonStack,
}: Props) {
  const deckDrop = useDroppable({
    id: `don-deck-${playerIndex}`,
    data: {
      to: "donDeck",
      playerIndex,
    },
  });

  const activeDrop = useDroppable({
    id: `active-don-${playerIndex}`,
    data: {
      to: "activeDon",
      playerIndex,
    },
  });

  const restDrop = useDroppable({
    id: `rest-don-${playerIndex}`,
    data: {
      to: "restDon",
      playerIndex,
    },
  });

  return (
    <div
      style={{
        display: "flex",
        gap: GAME_LAYOUT.css.donAreaGap,
        alignItems: "center",
      }}
    >
      <DonStack
        title="DON DECK"
        cards={donDeck}
        playerIndex={playerIndex}
        from="donDeck"
        setNodeRef={deckDrop.setNodeRef}
        isOver={deckDrop.isOver}
        selectedCount={
          selectedDonStack?.playerIndex ===
            playerIndex &&
            selectedDonStack?.fromArea ===
            "donDeck"
            ? selectedDonStack.count
            : 0
        }
        onClick={() =>
          onSelectDonStack("donDeck")
        }
      />

      <div
        style={{
          marginLeft:
            "var(--op-active-don-offset-left, 100px)",

          display: "flex",
          alignItems: "center",
        }}
      >
        <DonStack
          title="ACTIVE DON"
          cards={activeDons}
          playerIndex={playerIndex}
          from="activeDon"
          setNodeRef={activeDrop.setNodeRef}
          isOver={activeDrop.isOver}
          selectedCount={
            selectedDonStack?.playerIndex ===
              playerIndex &&
              selectedDonStack?.fromArea ===
              "activeDon"
              ? selectedDonStack.count
              : 0
          }
          onClick={() =>
            onSelectDonStack("activeDon")
          }
        />

        <div
          style={{
            width:
              "var(--op-active-rest-gap, 48px)",
          }}
        />

        <DonStack
          title="REST DON"
          cards={restDons}
          playerIndex={playerIndex}
          from="restDon"
          setNodeRef={restDrop.setNodeRef}
          isOver={restDrop.isOver}
          rotated
          selectedCount={
            selectedDonStack?.playerIndex ===
              playerIndex &&
              selectedDonStack?.fromArea ===
              "restDon"
              ? selectedDonStack.count
              : 0
          }
          onClick={() =>
            onSelectDonStack("restDon")
          }
        />
      </div>
    </div>
  );
}

function DonStack({
  cards,
  playerIndex,
  from,
  setNodeRef,
  isOver,
  rotated = false,
  selectedCount,
  onClick,
}: {
  title: string;
  cards: CardData[];
  playerIndex: number;
  from: DonAreaKey;

  setNodeRef: (
    element: HTMLElement | null
  ) => void;

  isOver: boolean;

  rotated?: boolean;

  selectedCount: number;

  onClick: () => void;
}) {
  const topCard = cards[0];

  return (
    <div
      ref={setNodeRef}
      onClickCapture={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        width: rotated
          ? GAME_LAYOUT.css.donRotatedWidth
          : GAME_LAYOUT.css.donWidth,

        height: rotated
          ? GAME_LAYOUT.css.donRotatedHeight
          : GAME_LAYOUT.css.donHeight,

        border: isOver
          ? GAME_LAYOUT.css.areaBorderActive
          : GAME_LAYOUT.css.areaBorder,

        borderRadius: GAME_LAYOUT.css.cardRadius,

        background: "#111827",

        color: "white",

        position: "relative",

        overflow: "visible",

        userSelect: "none",

        cursor: "pointer",
      }}
    >
      {selectedCount > 0 && (
        <div
          style={{
            position: "absolute",

            left: "50%",

            top: "-22px",

            transform:
              "translateX(-50%)",

            background: "#facc15",

            color: "#111827",

            padding: "2px 10px",

            borderRadius: "999px",

            fontWeight: "bold",

            fontSize: "14px",

            zIndex: 1000,
          }}
        >
          ×{selectedCount}
        </div>
      )}

      {topCard && (
        <div
          style={{
            position: "absolute",

            top: rotated
              ? "-10px"
              : "-2px",

            left: rotated
              ? "6px"
              : "-2px",

            zIndex: 1,

            opacity: 0.85,
          }}
        >
          <GameCard
            card={{
              ...topCard,
              rotated,
            }}
            playerIndex={playerIndex}
            from={from}
          />
        </div>
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,

          display: "flex",
          justifyContent: "center",
          alignItems: "center",

          fontSize: "40px",
          fontWeight: 900,
          //fontFamily: "Impact, sans-serif",

          color: "white",

          WebkitTextStroke: "2px black",

          textShadow: `
      2px 2px 0 #000,
      -2px 2px 0 #000,
      2px -2px 0 #000,
      -2px -2px 0 #000
    `,

          pointerEvents: "none",
          zIndex: 999,
        }}
      >
        {cards.length}
      </div>
    </div>
  );
}