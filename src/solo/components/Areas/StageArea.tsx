import { useDroppable } from "@dnd-kit/core";

import type { CardData } from "../../types/card";

import GameCard from "../Card/GameCard";
import { GAME_LAYOUT } from "../../layout/gameLayout";

type Props = {
    card: CardData | null;
    playerIndex: number;
};

export default function StageArea({
    card,
    playerIndex,
}: Props) {
    const { setNodeRef, isOver } = useDroppable({
        id: `stage-${playerIndex}`,
        data: {
            to: "stage",
            playerIndex,
            cardId: card?.id,
        },
    });

    return (
        <div
            ref={setNodeRef}
            style={{
                width: GAME_LAYOUT.css.deckWidth,
                height: "calc(var(--op-card-height) + 3px)",
                border: isOver
                    ? GAME_LAYOUT.css.areaBorderActive
                    : GAME_LAYOUT.css.areaBorder,
                borderRadius: GAME_LAYOUT.css.cardRadius,
                background: "#0f172a",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
            }}
        >{!card && (
            <div
                style={{
                    color: "white",
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontWeight: "bold",
                }}
            >
                STAGE
            </div>
        )}
            {card && (
                <GameCard
                    card={card}
                    playerIndex={playerIndex}
                    from="stage"
                />
            )}
        </div>
    );
}