import { useState } from "react";

import CharacterArea from "../Areas/CharacterArea";
import DeckArea from "../Areas/DeckArea";
import DonArea from "../Areas/DonArea";
import LeaderArea from "../Areas/LeaderArea";
import LifeArea from "../Areas/LifeArea";
import TrashArea from "../Areas/TrashArea";
import PublicArea from "../Areas/PublicArea";

import HandArea from "../Hand/HandArea";

import type { PlayerState } from "../../types/card";

import { useGameStore } from "../../store/gameStore";

import { sendBoardAction } from "../../network/roomClient";

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

type ZoneKey =
  | "deck"
  | "trash"
  | "life";

type ListCardAction =
  | "TO_HAND"
  | "TO_PUBLIC"
  | "TO_TRASH"
  | "TO_DECK_BOTTOM"
  | "TO_LIFE_TOP";

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
  const localPlayerIndex =
    useGameStore((x) => x.localPlayerIndex);
  const communicationMode =
    useGameStore((x) => x.communicationMode);

  const isOpponent =
    localPlayerIndex !== null &&
    playerIndex !== localPlayerIndex;

  const canOperate =
    localPlayerIndex === null ||
    playerIndex === localPlayerIndex;

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

  const moveListCardToPublic =
    useGameStore(
      (x) => x.moveListCardToPublic
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

  function getZoneCards(
    zone: ZoneKey
  ) {
    if (zone === "deck") {
      return player.deck;
    }

    if (zone === "trash") {
      return player.trash;
    }

    return player.life;
  }

  function getZoneCardIndex(
    zone: ZoneKey,
    cardId: string
  ) {
    return getZoneCards(zone).findIndex(
      (card) => card.id === cardId
    );
  }

  function sendListCardAction(
    zone: ZoneKey,
    cardId: string,
    listAction: ListCardAction
  ) {
    if (!canOperate) {
      return false;
    }

    const fromIndex = getZoneCardIndex(
      zone,
      cardId
    );

    if (fromIndex === -1) {
      return false;
    }

    sendBoardAction({
      actionType: "LIST_CARD_ACTION",
      payload: {
        playerIndex,
        from: zone,
        fromIndex,
        listAction,
      },
    });

    return true;
  }

  function handleListCardToHand(
    zone: ZoneKey,
    cardId: string
  ) {
    if (!sendListCardAction(zone, cardId, "TO_HAND")) {
      return;
    }

    moveListCardToHand(playerIndex, zone, cardId);
  }

  function handleListCardToPublic(
    zone: ZoneKey,
    cardId: string
  ) {
    if (!sendListCardAction(zone, cardId, "TO_PUBLIC")) {
      return;
    }

    moveListCardToPublic(playerIndex, zone, cardId);
  }

  function handleListCardToTrash(
    zone: ZoneKey,
    cardId: string
  ) {
    if (!sendListCardAction(zone, cardId, "TO_TRASH")) {
      return;
    }

    moveListCardToTrash(playerIndex, zone, cardId);
  }

  function handleListCardToDeckBottom(
    zone: ZoneKey,
    cardId: string
  ) {
    if (!sendListCardAction(zone, cardId, "TO_DECK_BOTTOM")) {
      return;
    }

    moveListCardToDeckBottom(playerIndex, zone, cardId);
  }

  function handleListCardToLifeTop(
    zone: ZoneKey,
    cardId: string
  ) {
    if (!sendListCardAction(zone, cardId, "TO_LIFE_TOP")) {
      return;
    }

    moveListCardToLifeTop(playerIndex, zone, cardId);
  }

  function handleToggleCardFace(
    zone: ZoneKey,
    cardId: string
  ) {
    const canToggleFace =
      canOperate ||
      (isOpponent && zone === "deck");

    if (!canToggleFace) {
      return;
    }

    const cardIndex = getZoneCardIndex(
      zone,
      cardId
    );

    if (cardIndex === -1) {
      return;
    }

    toggleCardFace(playerIndex, cardId);

    sendBoardAction({
      actionType: "TOGGLE_LIST_CARD_FACE",
      payload: {
        playerIndex,
        zone,
        cardIndex,
      },
    });
  }

  function handleOpenTopDeckCards(
    count: number
  ) {
    if (!canOperate) {
      return;
    }

    openTopDeckCards(playerIndex, count);

    sendBoardAction({
      actionType: "OPEN_TOP_DECK_CARDS",
      payload: {
        playerIndex,
        count,
      },
    });
  }

  function handleReorderZoneCards(
    zone: ZoneKey,
    activeId: string,
    overId: string
  ) {
    if (!canOperate) {
      return;
    }

    const activeIndex = getZoneCardIndex(
      zone,
      activeId
    );

    const overIndex = getZoneCardIndex(
      zone,
      overId
    );

    if (
      activeIndex === -1 ||
      overIndex === -1
    ) {
      return;
    }

    reorderZoneCards(
      playerIndex,
      zone,
      activeId,
      overId
    );

    sendBoardAction({
      actionType: "REORDER_ZONE_CARDS",
      payload: {
        playerIndex,
        zone,
        activeIndex,
        overIndex,
      },
    });
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          width: "100%",
          position: "relative",
          padding: GAME_LAYOUT.css.boardPadding,
          boxSizing: "border-box",
          overflow: "hidden",
          borderLeft:
            communicationMode === "silent"
              ? `3px solid ${
                  playerIndex === 0 ? "#38bdf8" : "#fb7185"
                }`
              : undefined,
          background:
            communicationMode === "silent"
              ? playerIndex === 0
                ? "rgba(14, 116, 144, 0.055)"
                : "rgba(190, 24, 93, 0.055)"
              : undefined,
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
                  canOperate &&
                  selectDonStack(playerIndex, fromArea)
                }
              />

              <div
                style={{
                  marginTop: "0px",
                  marginLeft: "var(--op-trash-offset-left, 120px)",
                  display: "flex",
                  gap: "6px",
                  alignItems: "center",
                }}
              >
                <TrashArea
                  cards={player.trash}
                  playerIndex={playerIndex}
                  onOpen={() => setTrashOpen(true)}
                />

                <PublicArea
                  cards={player.publicCards}
                  playerIndex={playerIndex}
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
                  canOperate &&
                  selectDonStack(playerIndex, fromArea)
                }
              />

              <div
                style={{
                  marginTop: "var(--op-trash-lift)",
                  marginLeft: "var(--op-trash-offset-left, 120px)",
                  display: "flex",
                  gap: "6px",
                  alignItems: "center",
                }}
              >
                <TrashArea
                  cards={player.trash}
                  playerIndex={playerIndex}
                  onOpen={() => setTrashOpen(true)}
                />

                <PublicArea
                  cards={player.publicCards}
                  playerIndex={playerIndex}
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
          communicationMode === "silent"
            ? handleListCardToHand("deck", id)
            : handleListCardToPublic("deck", id)
        }
        onPublic={(id) =>
          handleListCardToPublic("deck", id)
        }
        primaryActionLabel="公開へ"
        onTrash={(id) =>
          handleListCardToTrash("deck", id)
        }
        onBottom={(id) =>
          handleListCardToDeckBottom("deck", id)
        }
        onLifeTop={(id) =>
          handleListCardToLifeTop("deck", id)
        }
        onToggleFace={(cardId) =>
          handleToggleCardFace("deck", cardId)
        }
        onOpenTopCards={(count) =>
          handleOpenTopDeckCards(count)
        }
        zone="deck"
        playerIndex={playerIndex}
        canOperate={canOperate}
        canToggleFace={canOperate || isOpponent}
        useSilentDeckLayout={communicationMode === "silent"}
        onReorder={(activeId, overId) =>
          handleReorderZoneCards(
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
          handleListCardToHand("trash", id)
        }
        onPublic={(id) =>
          handleListCardToPublic("trash", id)
        }
        onTrash={(id) =>
          handleListCardToTrash("trash", id)
        }
        onBottom={(id) =>
          handleListCardToDeckBottom("trash", id)
        }
        onLifeTop={(id) =>
          handleListCardToLifeTop("trash", id)
        }
        onToggleFace={(cardId) =>
          handleToggleCardFace("trash", cardId)
        }
        onOpenTopCards={() => { }}
        zone="trash"
        playerIndex={playerIndex}
        canOperate={canOperate}
        canToggleFace={canOperate}
        onReorder={(activeId, overId) =>
          handleReorderZoneCards(
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
          handleListCardToHand("life", id)
        }
        onPublic={(id) =>
          handleListCardToPublic("life", id)
        }
        onTrash={(id) =>
          handleListCardToTrash("life", id)
        }
        onBottom={(id) =>
          handleListCardToDeckBottom("life", id)
        }
        onLifeTop={(id) =>
          handleListCardToLifeTop("life", id)
        }
        onToggleFace={(cardId) =>
          handleToggleCardFace("life", cardId)
        }
        onOpenTopCards={() => { }}
        zone="life"
        playerIndex={playerIndex}
        canOperate={canOperate}
        canToggleFace={canOperate}
        onReorder={(activeId, overId) =>
          handleReorderZoneCards(
            "life",
            activeId,
            overId
          )
        }
      />
    </>
  );
}
