import { useState } from "react";

import CharacterArea from "../Areas/CharacterArea";
import DeckArea from "../Areas/DeckArea";
import DonArea from "../Areas/DonArea";
import LeaderArea from "../Areas/LeaderArea";
import LifeArea from "../Areas/LifeArea";
import TrashArea from "../Areas/TrashArea";

import HandArea from "../Hand/HandArea";

import type { PlayerState } from "../../types/card";

import { useGameStore } from "../../store/gameStore";

import CardListModal from "../Modal/CardListModal";
import StageArea from "../Areas/StageArea";
import { GAME_LAYOUT } from "../../layout/gameLayout";
import { getLocalCardImage } from "../../utils/localCardImages";

type Props = {
  player: PlayerState;

  playerIndex: number;
  onPreview: (image: string | null) => void;

  reversed?: boolean;

  isOwnPlayer: boolean;
};

function getCardBackImage() {
  return (
    getLocalCardImage("cardBack")?.imageUrl ??
    getLocalCardImage("card-back")?.imageUrl ??
    getLocalCardImage("back")?.imageUrl ??
    ""
  );
}

export default function PlayerBoard({
  player,
  playerIndex,
  onPreview,
  reversed = false,
  isOwnPlayer,
}: Props) {
  const [deckOpen, setDeckOpen] =
    useState(false);

  const [trashOpen, setTrashOpen] =
    useState(false);

  const [lifeOpen, setLifeOpen] =
    useState(false);

  const moveListCardToHand =
    useGameStore(
      (x) => x.moveListCardToHand
    );

  const moveListCardToTrash =
    useGameStore(
      (x) => x.moveListCardToTrash
    );

  const moveListCardToDeckBottom =
    useGameStore(
      (x) =>
        x.moveListCardToDeckBottom
    );

  const moveListCardToLifeTop =
    useGameStore((x) => x.moveListCardToLifeTop);

  const toggleCardFace =
    useGameStore((x) => x.toggleCardFace);

  const openTopDeckCards =
    useGameStore((x) => x.openTopDeckCards);

  const reorderZoneCards =
    useGameStore(
      (x) => x.reorderZoneCards
    );

  const selectedDonStack =
    useGameStore((x) => x.selectedDonStack);

  const selectDonStack =
    useGameStore((x) => x.selectDonStack);

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          width: "100%",
          padding: GAME_LAYOUT.css.boardPadding,
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {reversed ? (
          <>
            <div
              style={{
                marginTop: 0,
                marginBottom: "var(--op-top-hand-gap)",
                flexShrink: 0,
              }}
            >
              <HandArea
                cards={player.hand.map((card) => ({
                  ...card,
                  image: isOwnPlayer
                    ? card.image
                    : getCardBackImage(),
                }))}
                playerIndex={playerIndex}
                onPreview={
                  isOwnPlayer
                    ? onPreview
                    : () => { }
                }
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: GAME_LAYOUT.css.boardGap,
                marginTop: 0,
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <DonArea
                donDeck={player.donDeck}
                activeDons={player.activeDons}
                restDons={player.restDons}
                playerIndex={playerIndex}
                selectedDonStack={selectedDonStack}
                onSelectDonStack={(fromArea) =>
                  selectDonStack(playerIndex, fromArea)
                }
              />

              <div
                style={{
                  marginTop: "0px",
                  marginLeft: "var(--op-trash-offset-left, 120px)",
                }}
              >
                <TrashArea
                  cards={player.trash}
                  playerIndex={playerIndex}
                  onOpen={() => setTrashOpen(true)}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: GAME_LAYOUT.css.mainAreaGap,
                marginTop: GAME_LAYOUT.css.boardInnerGap,
                flexShrink: 0,
              }}
            >
              <LifeArea
                cards={player.life}
                playerIndex={playerIndex}
                onOpen={() => setLifeOpen(true)}
              />

              <LeaderArea
                card={player.leader}
                playerIndex={playerIndex}
                onPreview={onPreview}
              />

              <StageArea
                card={player.stage}
                playerIndex={playerIndex}
              />

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "var(--area-gap)",
                }}
              >
                <DeckArea
                  cards={player.deck}
                  playerIndex={playerIndex}
                  onOpen={() => setDeckOpen(true)}
                />
              </div>
            </div>

            <div
              style={{
                marginTop: GAME_LAYOUT.css.boardInnerGap,
                flexShrink: 0,
              }}
            >
              <CharacterArea
                cards={player.characters}
                playerIndex={playerIndex}
                onPreview={onPreview}
              />
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                marginTop: "var(--op-character-top-gap)",
                flexShrink: 0,
              }}
            >
              <CharacterArea
                cards={player.characters}
                playerIndex={playerIndex}
                onPreview={onPreview}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: GAME_LAYOUT.css.mainAreaGap,
                marginTop: GAME_LAYOUT.css.boardInnerGap,
                flexShrink: 0,
              }}
            >
              <LifeArea
                cards={player.life}
                playerIndex={playerIndex}
                onOpen={() => setLifeOpen(true)}
              />

              <LeaderArea
                card={player.leader}
                playerIndex={playerIndex}
                onPreview={onPreview}
              />

              <StageArea
                card={player.stage}
                playerIndex={playerIndex}
              />

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "var(--area-gap)",
                }}
              >
                <DeckArea
                  cards={player.deck}
                  playerIndex={playerIndex}
                  onOpen={() => setDeckOpen(true)}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: GAME_LAYOUT.css.boardGap,
                marginTop: GAME_LAYOUT.css.boardInnerGap,
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <DonArea
                donDeck={player.donDeck}
                activeDons={player.activeDons}
                restDons={player.restDons}
                playerIndex={playerIndex}
                selectedDonStack={selectedDonStack}
                onSelectDonStack={(fromArea) =>
                  selectDonStack(playerIndex, fromArea)
                }
              />

              <div
                style={{
                  marginTop: "var(--op-trash-lift)",
                  marginLeft: "var(--op-trash-offset-left, 120px)",
                }}
              >
                <TrashArea
                  cards={player.trash}
                  playerIndex={playerIndex}
                  onOpen={() => setTrashOpen(true)}
                />
              </div>
            </div>

            <div
              style={{
                marginTop: GAME_LAYOUT.css.boardInnerGap,
                flexShrink: 0,
              }}
            >
              <HandArea
                cards={player.hand.map((card) => ({
                  ...card,
                  image: isOwnPlayer
                    ? card.image
                    : getCardBackImage(),
                }))}
                playerIndex={playerIndex}
                onPreview={
                  isOwnPlayer
                    ? onPreview
                    : () => { }
                }
              />
            </div>
          </>
        )}
      </div>

      <CardListModal
        title="Deck"
        cards={player.deck}
        open={deckOpen}
        onClose={() => setDeckOpen(false)}
        onHand={(id) =>
          moveListCardToHand(playerIndex, "deck", id)
        }
        onTrash={(id) =>
          moveListCardToTrash(playerIndex, "deck", id)
        }
        onBottom={(id) =>
          moveListCardToDeckBottom(playerIndex, "deck", id)
        }
        onLifeTop={(id) =>
          moveListCardToLifeTop(playerIndex, "deck", id)
        }
        onToggleFace={(cardId) =>
          toggleCardFace(playerIndex, cardId)
        }
        onOpenTopCards={(count) =>
          openTopDeckCards(playerIndex, count)
        }
        zone="deck"
        playerIndex={playerIndex}
        onReorder={(activeId, overId) =>
          reorderZoneCards(
            playerIndex,
            "deck",
            activeId,
            overId
          )
        }
      />

      <CardListModal
        title="Trash"
        cards={player.trash}
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onHand={(id) =>
          moveListCardToHand(playerIndex, "trash", id)
        }
        onTrash={(id) =>
          moveListCardToTrash(playerIndex, "trash", id)
        }
        onBottom={(id) =>
          moveListCardToDeckBottom(playerIndex, "trash", id)
        }
        onLifeTop={(id) =>
          moveListCardToLifeTop(playerIndex, "trash", id)
        }
        onToggleFace={(cardId) =>
          toggleCardFace(playerIndex, cardId)
        }
        onOpenTopCards={() => { }}
        zone="trash"
        playerIndex={playerIndex}
        onReorder={(activeId, overId) =>
          reorderZoneCards(
            playerIndex,
            "trash",
            activeId,
            overId
          )
        }
      />

      <CardListModal
        title="Life"
        cards={player.life}
        open={lifeOpen}
        onClose={() => setLifeOpen(false)}
        onHand={(id) =>
          moveListCardToHand(playerIndex, "life", id)
        }
        onTrash={(id) =>
          moveListCardToTrash(playerIndex, "life", id)
        }
        onBottom={(id) =>
          moveListCardToDeckBottom(playerIndex, "life", id)
        }
        onLifeTop={(id) =>
          moveListCardToLifeTop(playerIndex, "life", id)
        }
        onToggleFace={(cardId) =>
          toggleCardFace(playerIndex, cardId)
        }
        onOpenTopCards={() => { }}
        zone="life"
        playerIndex={playerIndex}
        onReorder={(activeId, overId) =>
          reorderZoneCards(
            playerIndex,
            "life",
            activeId,
            overId
          )
        }
      />
    </>
  );
}