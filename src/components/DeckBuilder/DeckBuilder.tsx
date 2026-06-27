import { useMemo, useRef, useState } from "react";

import type { CSSProperties, PointerEvent } from "react";

import type { DeckRecipe, LocalCardImage } from "../../types/deck";

import {
  getLocalCardImage,
  getLocalCardImages,
  loadCardImagesFromZip,
} from "../../utils/localCardImages";

import {
  deleteLocalDeckRecipe,
  exportLocalDeckRecipeToJson,
  getAllLocalDeckRecipes,
  importLocalDeckRecipeFromJsonFile,
  saveLocalDeckRecipe,
} from "../../utils/localDeckStorage";

type Props = {
  onBack: () => void;
  initialDeckId?: string | null;
};

type ScreenMode = "list" | "edit" | "search";

const buttonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "8px",
  border: "1px solid #475569",
  background: "#1e293b",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const importButtonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "8px",
  border: "1px solid #475569",
  background: "#ee9b00",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "#2563eb",
  border: "1px solid #60a5fa",
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "#dc2626",
  border: "1px solid #fca5a5",
};

function createNewRecipe(): DeckRecipe {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name: "新しいデッキ",
    leaderCardId: null,
    mainDeck: [],
    donDeck: Array.from({ length: 10 }, () => "don"),
    cardTypes: {
      don: "don",
    },
    leaderLifeCount: 5,
    createdAt: now,
    updatedAt: now,
  };
}

function countByCardId(cards: string[]) {
  return cards.reduce<Record<string, number>>((result, cardId) => {
    result[cardId] = (result[cardId] ?? 0) + 1;
    return result;
  }, {});
}

function getCardImageUrl(cardId: string | null) {
  if (!cardId) {
    return null;
  }

  return getLocalCardImage(cardId)?.imageUrl ?? null;
}

function makeGroupedCards(cards: string[]) {
  return Object.entries(countByCardId(cards)).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
}

export default function DeckBuilder({
  onBack,
  initialDeckId = null,
}: Props) {
  const initialDecks = getAllLocalDeckRecipes();

  const initialEditingDeck =
    initialDeckId !== null
      ? initialDecks.find((deck) => deck.id === initialDeckId) ?? null
      : null;

  const [mode, setMode] = useState<ScreenMode>(
    initialEditingDeck ? "edit" : "list"
  );

  const [cardImages, setCardImages] = useState<LocalCardImage[]>(
    getLocalCardImages()
  );

  const [decks, setDecks] = useState<DeckRecipe[]>(
    initialDecks
  );

  const [editingDeck, setEditingDeck] =
    useState<DeckRecipe | null>(initialEditingDeck);

  const [searchText, setSearchText] = useState("");

  const [seriesFilter, setSeriesFilter] = useState("");

  const [message, setMessage] = useState("");

  const [isOpeningSearch, setIsOpeningSearch] = useState(false);

  const [messageAnimationKey, setMessageAnimationKey] =
    useState(0);

  const [previewImage, setPreviewImage] =
    useState<string | null>(null);

  const previewTimer = useRef<number | null>(null);

  const previewStartPos =
    useRef<{ x: number; y: number } | null>(null);

  function clearPreviewTimer() {
    if (previewTimer.current !== null) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  }

  function startCardPreview(imageUrl: string) {
    clearPreviewTimer();

    previewTimer.current = window.setTimeout(() => {
      setPreviewImage(imageUrl);
      previewTimer.current = null;
    }, 550);
  }

  function handlePreviewPointerDown(
    imageUrl: string,
    event: PointerEvent
  ) {
    previewStartPos.current = {
      x: event.clientX,
      y: event.clientY,
    };
    startCardPreview(imageUrl);
  }

  function handlePreviewPointerMove(event: PointerEvent) {
    if (!previewStartPos.current) {
      return;
    }

    const dx = Math.abs(event.clientX - previewStartPos.current.x);
    const dy = Math.abs(event.clientY - previewStartPos.current.y);

    if (dx > 8 || dy > 8) {
      clearPreviewTimer();
      previewStartPos.current = null;
    }
  }

  function endCardPreviewPress() {
    clearPreviewTimer();
    previewStartPos.current = null;
  }

  function renderPreviewOverlay() {
    if (!previewImage) {
      return null;
    }

    return (
      <div
        onClick={() => setPreviewImage(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setPreviewImage(null);
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 5000,
          background: "rgba(2, 6, 23, 0.86)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px",
          boxSizing: "border-box",
        }}
      >
        <img
          src={previewImage}
          draggable={false}
          style={{
            maxWidth: "94vw",
            maxHeight: "94dvh",
            borderRadius: "12px",
            objectFit: "contain",
            boxShadow: "0 18px 40px rgba(0,0,0,0.65)",
          }}
        />
      </div>
    );
  }


  function showMessage(nextMessage: string) {
    setMessage(nextMessage);

    setMessageAnimationKey((x) => x + 1);
  }

  function openSearchScreen() {
    clearPreviewTimer();
    setPreviewImage(null);
    setSearchText("");
    setSeriesFilter("");
    setIsOpeningSearch(true);

    window.setTimeout(() => {
      setMode("search");
      setIsOpeningSearch(false);
    }, 50);
  }

  const deckBuildableCardImages = useMemo(
    () => cardImages.filter((card) => card.series !== "system"),
    [cardImages]
  );

  const seriesList = useMemo(
    () =>
      Array.from(new Set(deckBuildableCardImages.map((card) => card.series))).sort(),
    [deckBuildableCardImages]
  );

  const filteredCards = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return deckBuildableCardImages.filter((card) => {
      if (seriesFilter && card.series !== seriesFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return card.cardId.toLowerCase().includes(normalizedSearch);
    });
  }, [deckBuildableCardImages, searchText, seriesFilter]);

  function refreshDecks() {
    setDecks(getAllLocalDeckRecipes());
  }

  async function handleLoadZip(file: File | null) {
    if (!file) {
      return;
    }

    setMessage("画像ZIPを読み込み中...");

    try {
      const loaded = await loadCardImagesFromZip(file);

      setCardImages(loaded);
      setSearchText("");
      setSeriesFilter("");

      setMessage(
        loaded.length > 0
          ? `${loaded.length}枚の画像を読み込みました。`
          : "画像が0枚です。ZIP内が cards/OP01/OP01-001.png のような構成か確認してください。"
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "画像ZIPの読み込みに失敗しました。"
      );
    }
  }

  async function handleImportDeckJson(file: File | null) {
    if (!file) {
      return;
    }

    setMessage("デッキJSONを取り込み中...");

    try {
      const importedDeck = await importLocalDeckRecipeFromJsonFile(file);

      refreshDecks();

      setMessage(`${importedDeck.name} を取り込みました。`);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "デッキJSONの取り込みに失敗しました。"
      );
    }
  }

  function exportEditingDeck() {
    if (!editingDeck) {
      return;
    }

    exportLocalDeckRecipeToJson({
      ...editingDeck,
      updatedAt: new Date().toISOString(),
    });

    setMessage("デッキJSONを書き出しました。");
  }

  function openNewDeck() {
    const next = createNewRecipe();

    setEditingDeck(next);
    setMode("edit");
    setMessage("新規デッキを作成します");
  }

  function openExistingDeck(deck: DeckRecipe) {
    setEditingDeck(deck);
    setMode("edit");
    setMessage("");
  }

  function updateEditingDeck(updater: (current: DeckRecipe) => DeckRecipe) {
    setEditingDeck((current) => {
      if (!current) {
        return current;
      }

      return {
        ...updater(current),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function saveEditingDeck() {
    if (!editingDeck) {
      return;
    }

    const name = editingDeck.name.trim();

    if (!name) {
      setMessage("デッキ名を入力してください。");
      return;
    }

    if (editingDeck.mainDeck.length > 50) {
      const ok = window.confirm(
        `メインデッキが${editingDeck.mainDeck.length}枚あります。50枚を超えていますが保存しますか？`
      );

      if (!ok) {
        return;
      }
    }

    const nextDeck = {
      ...editingDeck,
      name,
      updatedAt: new Date().toISOString(),
    };

    saveLocalDeckRecipe(nextDeck);
    setEditingDeck(nextDeck);
    refreshDecks();
    setMessage(
      nextDeck.mainDeck.length === 50
        ? "デッキを保存しました。"
        : `デッキを保存しました。ただしメインデッキは${nextDeck.mainDeck.length}枚です。デッキ選択画面には50枚のデッキだけ表示されます。`
    );
  }

  function deleteDeck(deckId: string) {
    const ok = window.confirm("このデッキを削除しますか？");

    if (!ok) {
      return;
    }

    deleteLocalDeckRecipe(deckId);
    refreshDecks();
    setMessage("デッキを削除しました。");
  }

  function addCardToMain(cardId: string) {
    const addCount = 4;

    updateEditingDeck((current) => ({
      ...current,
      mainDeck: [
        ...current.mainDeck,
        ...Array.from({ length: addCount }, () => cardId),
      ],
      cardTypes: {
        ...current.cardTypes,
        [cardId]: current.cardTypes[cardId] ?? "character",
      },
    }));

    showMessage(`${cardId} を${addCount}枚追加しました。`);
  }

  function setCardAsLeader(cardId: string) {
    updateEditingDeck((current) => ({
      ...current,
      leaderCardId: cardId,
      cardTypes: {
        ...current.cardTypes,
        [cardId]: "leader",
      },
    }));

    showMessage(`${cardId} をリーダーに設定しました。`);
  }

  function addCardToDon(cardId: string) {
    const addCount = 10;

    updateEditingDeck((current) => ({
      ...current,
      donDeck: [
        ...current.donDeck,
        ...Array.from({ length: addCount }, () => cardId),
      ],
      cardTypes: {
        ...current.cardTypes,
        [cardId]: "don",
      },
    }));

    setMessage(`${cardId} をDONに${addCount}枚追加しました。`);
  }

  function removeAllFromMain(cardId: string) {
    updateEditingDeck((current) => ({
      ...current,
      mainDeck: current.mainDeck.filter((x) => x !== cardId),
    }));
  }

  function removeAllFromDon(cardId: string) {
    updateEditingDeck((current) => ({
      ...current,
      donDeck: current.donDeck.filter((x) => x !== cardId),
    }));
  }

  function setMainCardCount(cardId: string, nextCount: number) {
    updateEditingDeck((current) => {
      const currentType = current.cardTypes[cardId] ?? "character";

      return {
        ...current,
        mainDeck: [
          ...current.mainDeck.filter((x) => x !== cardId),
          ...Array.from({ length: nextCount }, () => cardId),
        ],
        cardTypes: {
          ...current.cardTypes,
          [cardId]: currentType,
        },
      };
    });
  }

  function setDonCardCount(cardId: string, nextCount: number) {
    updateEditingDeck((current) => ({
      ...current,
      donDeck: [
        ...current.donDeck.filter((x) => x !== cardId),
        ...Array.from({ length: nextCount }, () => cardId),
      ],
      cardTypes: {
        ...current.cardTypes,
        [cardId]: "don",
      },
    }));
  }

  function renderImageIcon(cardId: string | null, size = 58) {
    const imageUrl = getCardImageUrl(cardId);

    if (!cardId || !imageUrl) {
      return (
        <div
          style={{
            width: `${size}px`,
            height: `${Math.round(size * 1.4)}px`,
            borderRadius: "8px",
            background: "#0f172a",
            border: "1px solid #475569",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            color: "#94a3b8",
            fontSize: "10px",
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
        onPointerDown={(event) =>
          handlePreviewPointerDown(imageUrl, event)
        }
        onPointerUp={endCardPreviewPress}
        onPointerCancel={endCardPreviewPress}
        onPointerLeave={endCardPreviewPress}
        onPointerMove={handlePreviewPointerMove}
        style={{
          width: `${size}px`,
          height: "auto",
          borderRadius: "8px",
          display: "block",
          flexShrink: 0,
          touchAction: "none",
        }}
      />
    );
  }

  function renderCountIcon(
    cardId: string,
    count: number,
    onPlus: () => void,
    onMinus: () => void,
    onRemoveAll: () => void
  ) {
    return (
      <div
        key={cardId}
        style={{
          position: "relative",
          width: "72px",
          margin: "4px",
          touchAction: "manipulation",
        }}
      >
        {renderImageIcon(cardId, 72)}

        <div
          style={{
            position: "absolute",
            right: "-4px",
            bottom: "34px",

            minWidth: "26px",
            height: "26px",

            borderRadius: "999px",

            background: "#facc15",
            color: "#111827",

            border: "2px solid white",

            display: "flex",
            justifyContent: "center",
            alignItems: "center",

            fontSize: "14px",
            fontWeight: 900,

            boxShadow: "0 0 8px rgba(0,0,0,0.8)",
            pointerEvents: "none",
          }}
        >
          ×{count}
        </div>

        <button
          onClick={onRemoveAll}
          style={{
            position: "absolute",
            left: "-4px",
            top: "-4px",

            width: "24px",
            height: "24px",

            borderRadius: "999px",
            border: "1px solid white",

            background: "#dc2626",
            color: "white",

            fontSize: "14px",
            fontWeight: 900,

            padding: 0,
          }}
        >
          ×
        </button>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "4px",
            marginTop: "6px",
          }}
        >
          <button
            onClick={onMinus}
            style={{
              height: "28px",
              borderRadius: "6px",
              border: "1px solid #64748b",
              background: "#334155",
              color: "white",
              fontSize: "18px",
              fontWeight: 900,
              padding: 0,
            }}
          >
            -
          </button>

          <button
            onClick={onPlus}
            style={{
              height: "28px",
              borderRadius: "6px",
              border: "1px solid #60a5fa",
              background: "#2563eb",
              color: "white",
              fontSize: "18px",
              fontWeight: 900,
              padding: 0,
            }}
          >
            +
          </button>
        </div>
      </div>
    );
  }

  if (mode === "list") {
    return (
      <div
        style={{
          height: "100dvh",
          background: "#111827",
          color: "white",
          padding: "12px",
          boxSizing: "border-box",
          overflowY: "auto",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <h1 style={{ margin: 0, fontSize: "22px" }}>デッキ編集</h1>

            <button style={buttonStyle} onClick={onBack}>
              トップへ戻る
            </button>
          </div>

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
              新規作成
            </button>

            <label
              style={{
                ...buttonStyle,
                display: "inline-flex",
                alignItems: "center",
                background: "#059669",
              }}
            >
              デッキ取込
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  handleImportDeckJson(e.target.files?.[0] ?? null);
                  e.currentTarget.value = "";
                }}
                style={{ display: "none", background: "#175f10", }}
              />
            </label>
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
            decks.map((deck) => (
              <div
                key={deck.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: "#1e293b",
                  padding: "10px",
                  borderRadius: "12px",
                  border: "1px solid #475569",
                }}
              >
                {renderImageIcon(deck.leaderCardId, 54)}

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

                  <div style={{ fontSize: "12px", color: "#cbd5e1" }}>
                    メイン {deck.mainDeck.length}/50 / DON {deck.donDeck.length}枚
                  </div>
                </div>

                <button
                  style={primaryButtonStyle}
                  onClick={() => openExistingDeck(deck)}
                >
                  編集
                </button>

                <button
                  style={dangerButtonStyle}
                  onClick={() => deleteDeck(deck.id)}
                >
                  削除
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (!editingDeck) {
    return null;
  }

  const groupedMain = makeGroupedCards(editingDeck.mainDeck);
  const groupedDon = makeGroupedCards(editingDeck.donDeck);

  if (mode === "edit") {
    return (
      <div
        style={{
          height: "100dvh",
          background: "#0f172a",
          color: "white",
          padding: "12px",
          boxSizing: "border-box",
          overflowY: "auto",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
        }}
      >{isOpeningSearch && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999999,
            background: "rgba(15, 23, 42, 0.72)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: "54px",
              height: "54px",
              border: "6px solid rgba(255,255,255,0.25)",
              borderTop: "6px solid #10b981",
              borderRadius: "999px",
              animation: "deckBuilderSpin 0.8s linear infinite",
            }}
          />
        </div>
      )}
        <div
          style={{
            maxWidth: "840px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <h1 style={{ margin: 0, fontSize: "20px" }}>デッキ編集</h1>

            <button
              style={buttonStyle}
              onClick={() => {
                refreshDecks();
                setMode("list");
              }}
            >
              一覧へ
            </button>
          </div>

          <div
            style={{
              background: "#1e293b",
              borderRadius: "12px",
              padding: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <input
              value={editingDeck.name}
              onChange={(e) =>
                updateEditingDeck((current) => ({
                  ...current,
                  name: e.target.value,
                }))
              }
              placeholder="デッキ名"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px",
                borderRadius: "8px",
                border: "1px solid #475569",
                fontSize: "16px",
              }}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "8px",
              }}
            >
              <button style={primaryButtonStyle} onClick={saveEditingDeck}>
                保存
              </button>

              <button
                style={buttonStyle}
                onClick={openSearchScreen}
              >
                カード検索
              </button>

              <button style={importButtonStyle} onClick={exportEditingDeck}>
                デッキ出力
              </button>
            </div>

            <div style={{ fontSize: "12px", color: "#cbd5e1" }}>
              リーダー {editingDeck.leaderCardId ?? "未設定"} / メイン {editingDeck.mainDeck.length}/50 / DON {editingDeck.donDeck.length}枚
            </div>
          </div>

          {message && (
            <div
              key={messageAnimationKey}
              style={{
                background: "#334155",
                padding: "8px 10px",
                borderRadius: "8px",
                animation:
                  "deckBuilderMessageFlash 0.45s ease",
              }}
            >
              {message}
            </div>
          )}

          <section
            style={{
              background: "#1e293b",
              borderRadius: "12px",
              padding: "10px",
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: "16px" }}>リーダー</h2>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {renderImageIcon(editingDeck.leaderCardId, 72)}

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 900 }}>
                  {editingDeck.leaderCardId ?? "未設定"}
                </div>

                <label style={{ fontSize: "12px", color: "#cbd5e1" }}>
                  ライフ
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={editingDeck.leaderLifeCount}
                    onChange={(e) =>
                      updateEditingDeck((current) => ({
                        ...current,
                        leaderLifeCount: Number(e.target.value),
                      }))
                    }
                    style={{
                      width: "56px",
                      marginLeft: "8px",
                      padding: "4px",
                      borderRadius: "6px",
                    }}
                  />
                </label>
              </div>
            </div>
          </section>

          <section
            style={{
              background: "#1e293b",
              borderRadius: "12px",
              padding: "10px",
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: "16px" }}>
              メインデッキ {editingDeck.mainDeck.length}/50
            </h2>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              {groupedMain.length === 0 ? (
                <div style={{ color: "#cbd5e1" }}>カード未追加</div>
              ) : (
                groupedMain.map(([cardId, count]) =>
                  renderCountIcon(
                    cardId,
                    count,
                    () => setMainCardCount(cardId, count + 1),
                    () => setMainCardCount(cardId, Math.max(0, count - 1)),
                    () => removeAllFromMain(cardId)
                  )
                )
              )}
            </div>
          </section>

          <section
            style={{
              background: "#1e293b",
              borderRadius: "12px",
              padding: "10px",
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: "16px" }}>
              DON {editingDeck.donDeck.length}枚
            </h2>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {groupedDon.length === 0 ? (
                <div style={{ color: "#cbd5e1" }}>DON未追加</div>
              ) : (
                groupedDon.map(([cardId, count]) =>
                  renderCountIcon(
                    cardId,
                    count,
                    () => setDonCardCount(cardId, count + 1),
                    () => setDonCardCount(cardId, Math.max(0, count - 1)),
                    () => removeAllFromDon(cardId)
                  )
                )
              )}
            </div>
          </section>
        </div>
        {renderPreviewOverlay()}
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100dvh",
        background: "#0f172a",
        color: "white",
        padding: 0,
        boxSizing: "border-box",
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1000,
          background: "#0f172a",
          padding: "12px",
          borderBottom: "1px solid #475569",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "20px" }}>カード検索</h1>

          <button style={buttonStyle} onClick={() => setMode("edit")}>
            編集へ戻る
          </button>
        </div>

        <div
          style={{
            background: "#1e293b",
            borderRadius: "12px",
            padding: "10px",
            display: "flex",
            gap: "8px",
          }}
        >
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="カードID検索 例 OP01-001"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "10px",
              borderRadius: "8px",
              border: "1px solid #475569",
            }}
          />

          <select
            value={seriesFilter}
            onChange={(e) => setSeriesFilter(e.target.value)}
            style={{
              width: "94px",
              padding: "10px",
              borderRadius: "8px",
              border: "1px solid #475569",
            }}
          >
            <option value="">全OP</option>

            {seriesList.map((series) => (
              <option key={series} value={series}>
                {series}
              </option>
            ))}
          </select>
        </div>

        {message && (
          <div
            key={messageAnimationKey}
            style={{
              background: "#334155",
              padding: "8px 10px",
              borderRadius: "8px",
              animation:
                "deckBuilderMessageFlash 0.45s ease",
            }}
          >
            {message}
          </div>
        )}
      </div>

      <div
        style={{
          maxWidth: "840px",
          margin: "0 auto",
          padding: "12px",
          boxSizing: "border-box",
        }}
      >
        {cardImages.length === 0 ? (
          <div
            style={{
              background: "#1e293b",
              borderRadius: "12px",
              padding: "16px",
              color: "#cbd5e1",
            }}
          >
            カード画像が未読込です。デッキ選択画面で画像ZIPを読み込んでください。
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
              gap: "10px",
            }}
          >
            {filteredCards.map((card) => (
              <div
                key={card.path}
                style={{
                  background: "#1e293b",
                  borderRadius: "10px",
                  padding: "6px",
                  border: "1px solid #475569",
                }}
              >
                <img
                  src={card.imageUrl}
                  draggable={false}
                  onPointerDown={(event) =>
                    handlePreviewPointerDown(card.imageUrl, event)
                  }
                  onPointerUp={endCardPreviewPress}
                  onPointerCancel={endCardPreviewPress}
                  onPointerLeave={endCardPreviewPress}
                  onPointerMove={handlePreviewPointerMove}
                  style={{
                    width: "100%",
                    borderRadius: "8px",
                    display: "block",
                    touchAction: "none",
                  }}
                />

                <div
                  style={{
                    fontSize: "10px",
                    marginTop: "4px",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {card.cardId}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: "5px",
                    marginTop: "6px",
                  }}
                >
                  <button
                    style={{
                      ...primaryButtonStyle,
                      padding: "7px 4px",
                      fontSize: "11px",
                    }}
                    onClick={() => addCardToMain(card.cardId)}
                  >
                    4枚追加
                  </button>

                  <button
                    style={{
                      ...buttonStyle,
                      padding: "7px 4px",
                      fontSize: "11px",
                    }}
                    onClick={() => setCardAsLeader(card.cardId)}
                  >
                    リーダー
                  </button>

                  <button
                    style={{
                      ...buttonStyle,
                      padding: "7px 4px",
                      fontSize: "11px",
                    }}
                    onClick={() => addCardToDon(card.cardId)}
                  >
                    DON追加
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {renderPreviewOverlay()}
    </div>
  );
}
