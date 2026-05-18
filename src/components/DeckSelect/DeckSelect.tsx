import { useState } from "react";

import type { CSSProperties } from "react";

import { useGameStore } from "../../store/gameStore";

import DeckBuilder from "../DeckBuilder/DeckBuilder";

import type { DeckRecipe } from "../../types/deck";

import {
  buildDeckCardsFromRecipe,
  getAllLocalDeckRecipes,
  getLocalDeckRecipe,
} from "../../utils/localDeckStorage";

import {
  getLocalCardImage,
  hasLocalCardImages,
  loadCardImagesFromZip,
} from "../../utils/localCardImages";

type ScreenMode = "select" | "builder";

const buttonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "8px",
  border: "1px solid #475569",
  background: "#1e293b",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "#2563eb",
  border: "1px solid #60a5fa",
};

function getDeckStatus(deck: DeckRecipe) {
  if (!deck.leaderCardId) {
    return "リーダー未設定";
  }

  if (deck.mainDeck.length !== 50) {
    return `メイン${deck.mainDeck.length}/50`;
  }

  return "使用可能";
}

function canUseDeck(deck: DeckRecipe) {
  return deck.leaderCardId !== null && deck.mainDeck.length === 50;
}

function renderLeaderIcon(deck: DeckRecipe) {
  const imageUrl = deck.leaderCardId
    ? getLocalCardImage(deck.leaderCardId)?.imageUrl
    : null;

  if (!imageUrl) {
    return (
      <div
        style={{
          width: "54px",
          height: "76px",
          borderRadius: "8px",
          background: "#0f172a",
          border: "1px solid #475569",
          color: "#94a3b8",
          fontSize: "10px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        no img
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      draggable={false}
      style={{
        width: "54px",
        borderRadius: "8px",
        display: "block",
        flexShrink: 0,
      }}
    />
  );
}

export default function DeckSelect() {
  const [mode, setMode] = useState<ScreenMode>("select");

  const [editingDeckId, setEditingDeckId] =
    useState<string | null>(null);

  const [decks, setDecks] = useState<DeckRecipe[]>(
    getAllLocalDeckRecipes()
  );

  const [player1DeckId, setPlayer1DeckId] =
    useState<string | null>(null);

  const [player2DeckId, setPlayer2DeckId] =
    useState<string | null>(null);

  const [isZipLoaded, setIsZipLoaded] = useState(hasLocalCardImages());

  const [message, setMessage] = useState("");

  const [error, setError] = useState("");

  const startGame = useGameStore((x) => x.startGame);

  function refreshDecks() {
    const nextDecks = getAllLocalDeckRecipes();

    setDecks(nextDecks);

    if (
      player1DeckId &&
      !nextDecks.some((deck) => deck.id === player1DeckId)
    ) {
      setPlayer1DeckId(null);
    }

    if (
      player2DeckId &&
      !nextDecks.some((deck) => deck.id === player2DeckId)
    ) {
      setPlayer2DeckId(null);
    }
  }

  async function handleLoadZip(file: File | null) {
    if (!file) {
      return;
    }

    setMessage("画像ZIPを読み込み中...");
    setError("");

    try {
      const loaded = await loadCardImagesFromZip(file);

      setIsZipLoaded(hasLocalCardImages());

      setMessage(
        loaded.length > 0
          ? `${loaded.length}枚の画像を読み込みました。`
          : "画像が0枚です。ZIP内が cards/OP01/OP01-001.png のような構成か確認してください。"
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "画像ZIPの読み込みに失敗しました。"
      );
    }
  }

  function openNewDeck() {
    setEditingDeckId(null);
    setMode("builder");
  }

  function openEditDeck(deckId: string) {
    setEditingDeckId(deckId);
    setMode("builder");
  }

  function getDeckName(deckId: string | null) {
    if (!deckId) {
      return "未選択";
    }

    return decks.find((deck) => deck.id === deckId)?.name ?? "不明なデッキ";
  }

  function selectDeckForPlayer(playerIndex: 1 | 2, deck: DeckRecipe) {
    if (!canUseDeck(deck)) {
      setError(
        `${deck.name} は使用できません。リーダー設定済み、かつメインデッキ50枚のデッキだけ選択できます。`
      );
      return;
    }

    if (playerIndex === 1) {
      setPlayer1DeckId(deck.id);
    } else {
      setPlayer2DeckId(deck.id);
    }

    setError("");
  }

  function canStart() {
    return player1DeckId !== null && player2DeckId !== null;
  }

  function handleStart() {
    setError("");

    if (!isZipLoaded) {
      setError("ゲーム開始前に画像ZIPを読み込んでください。");
      return;
    }

    if (!player1DeckId || !player2DeckId) {
      setError("デッキ1とデッキ2を選択してください。");
      return;
    }

    const player1Recipe = getLocalDeckRecipe(player1DeckId);
    const player2Recipe = getLocalDeckRecipe(player2DeckId);

    if (!player1Recipe || !player2Recipe) {
      setError("選択したデッキが見つかりません。");
      refreshDecks();
      return;
    }

    try {
      const player1Cards = buildDeckCardsFromRecipe(player1Recipe);
      const player2Cards = buildDeckCardsFromRecipe(player2Recipe);

      startGame(player1Cards, player2Cards);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "デッキ読み込みに失敗しました。"
      );
    }
  }

  if (mode === "builder") {
    return (
      <DeckBuilder
        initialDeckId={editingDeckId}
        onBack={() => {
          refreshDecks();
          setIsZipLoaded(hasLocalCardImages());
          setMode("select");
        }}
      />
    );
  }

  return (
    <div
      style={{
        height: "100dvh",
        background: "#0f172a",
        color: "white",
        padding: "12px",
        paddingBottom: "132px",
        boxSizing: "border-box",
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div
        style={{
          maxWidth: "760px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "22px" }}>
          デッキ選択
        </h1>

        {!isZipLoaded && (
          <div
            style={{
              background: "#7f1d1d",
              border: "1px solid #fca5a5",
              borderRadius: "12px",
              padding: "10px",
              fontWeight: 800,
            }}
          >
            画像ZIPが未読込です。デッキ編集・ゲーム開始前に読み込んでください。
          </div>
        )}

        <div
          style={{
            background: "#1e293b",
            borderRadius: "12px",
            padding: "10px",
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <label
            style={{
              ...buttonStyle,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            画像ZIP読込
            <input
              type="file"
              accept=".zip"
              onChange={(e) => {
                handleLoadZip(e.target.files?.[0] ?? null);
                e.currentTarget.value = "";
              }}
              style={{ display: "none" }}
            />
          </label>

          <button style={primaryButtonStyle} onClick={openNewDeck}>
            デッキ編集
          </button>
        </div>

        {message && (
          <div
            style={{
              background: "#334155",
              padding: "8px 10px",
              borderRadius: "8px",
            }}
          >
            {message}
          </div>
        )}

        {error && (
          <div
            style={{
              background: "#7f1d1d",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #fca5a5",
            }}
          >
            {error}
          </div>
        )}

        {decks.length === 0 ? (
          <div
            style={{
              background: "#1e293b",
              borderRadius: "12px",
              padding: "16px",
              color: "#cbd5e1",
            }}
          >
            作成済みデッキはありません。「新規作成」から作ってください。
          </div>
        ) : (
          decks.map((deck) => {
            const usable = canUseDeck(deck);

            return (
              <div
                key={deck.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: "#1e293b",
                  padding: "10px",
                  borderRadius: "12px",
                  border: usable
                    ? "1px solid #475569"
                    : "1px solid #7f1d1d",
                }}
              >
                {renderLeaderIcon(deck)}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 900,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {deck.name}
                  </div>

                  <div
                    style={{
                      fontSize: "12px",
                      color: usable ? "#cbd5e1" : "#fca5a5",
                      marginTop: "2px",
                    }}
                  >
                    {getDeckStatus(deck)} / DON {deck.donDeck.length}枚
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "6px",
                      marginTop: "8px",
                    }}
                  >
                    <button
                      style={{
                        ...buttonStyle,
                        padding: "7px 4px",
                        fontSize: "11px",
                        background:
                          player1DeckId === deck.id ? "#2563eb" : "#1e293b",
                        opacity: usable ? 1 : 0.45,
                      }}
                      disabled={!usable}
                      onClick={() => selectDeckForPlayer(1, deck)}
                    >
                      デッキ1に選択
                    </button>

                    <button
                      style={{
                        ...buttonStyle,
                        padding: "7px 4px",
                        fontSize: "11px",
                        background:
                          player2DeckId === deck.id ? "#2563eb" : "#1e293b",
                        opacity: usable ? 1 : 0.45,
                      }}
                      disabled={!usable}
                      onClick={() => selectDeckForPlayer(2, deck)}
                    >
                      デッキ2に選択
                    </button>
                  </div>
                </div>

                <button
                  style={primaryButtonStyle}
                  onClick={() => openEditDeck(deck.id)}
                >
                  編集
                </button>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          background: "rgba(15,23,42,0.98)",
          borderTop: "2px solid #475569",
          padding: "10px",
          boxSizing: "border-box",
          boxShadow: "0 -4px 16px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            maxWidth: "760px",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <div
            style={{
              minWidth: 0,
              fontSize: "12px",
              lineHeight: 1.5,
            }}
          >
            <div
              style={{
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              デッキ1：{getDeckName(player1DeckId)}
            </div>

            <div
              style={{
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              デッキ2：{getDeckName(player2DeckId)}
            </div>
          </div>

          <button
            disabled={!canStart()}
            onClick={handleStart}
            style={{
              ...primaryButtonStyle,
              minWidth: "86px",
              height: "44px",
              opacity: canStart() ? 1 : 0.45,
              cursor: canStart() ? "pointer" : "not-allowed",
            }}
          >
            開始
          </button>
        </div>
      </div>
    </div>
  );
}
