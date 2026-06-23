import {
    useEffect,
    useState
} from "react";

import type { CSSProperties } from "react";

import {
    isHost,
    socket
} from "../../network/socket";

import {
    createRoom,
    joinRoom,
    leaveRoom,
    onJoinFailed,
    onRoomStateChanged,
    ready,
    selectDeckForRoom,
    sendGameSetup
} from "../../network/roomClient";

import type {
    DeckRecipeForRoom,
    RoomStateForClient
} from "../../network/roomClient";

import {
    useGameStore
} from "../../store/gameStore";

import type {
    OnlineDeckOrderPayload
} from "../../store/gameStore";

import type {
    DeckRecipe,
    DeckRecipeCardTypeMap
} from "../../types/deck";

import {
    buildDeckCardsFromRecipe,
    getAllLocalDeckRecipes,
    getLocalDeckRecipe
} from "../../utils/localDeckStorage";

type RoomScreenProps = {
    mode: "host" | "guest";
    onBack: () => void;
};

function toRoomDeckRecipe(
    deck: DeckRecipe
): DeckRecipeForRoom {
    return {
        name: deck.name,
        leaderCardId: deck.leaderCardId,
        mainDeck: deck.mainDeck,
        donDeck: deck.donDeck,
        cardTypes: deck.cardTypes as DeckRecipeCardTypeMap,
        leaderLifeCount: deck.leaderLifeCount,
    };
}

function toDeckRecipe(
    deck: DeckRecipeForRoom
): DeckRecipe {
    const now = new Date().toISOString();

    return {
        id: deck.name,
        name: deck.name,
        leaderCardId: deck.leaderCardId,
        mainDeck: deck.mainDeck,
        donDeck: deck.donDeck,
        cardTypes: deck.cardTypes as DeckRecipeCardTypeMap,
        leaderLifeCount: deck.leaderLifeCount ?? 5,
        createdAt: now,
        updatedAt: now,
    };
}

export default function RoomScreen({
    mode,
    onBack,
}: RoomScreenProps) {
    const [roomState, setRoomState] =
        useState<RoomStateForClient | null>(null);

    const [roomCodeInput, setRoomCodeInput] =
        useState("");

    const [selectedDeckId, setSelectedDeckId] =
        useState("");

    const [message, setMessage] =
        useState("");

    const [error, setError] =
        useState("");

    const decks = getAllLocalDeckRecipes();

    const createOnlineDeckOrder = useGameStore(
        (x) => x.createOnlineDeckOrder
    );

    const startGameWithDeckOrders = useGameStore(
        (x) => x.startGameWithDeckOrders
    );

    useEffect(() => {
        useGameStore
            .getState()
            .setLocalPlayerIndex(mode === "host" ? 0 : 1);
    }, [mode]);

    useEffect(() => {
        const handleGameSetup = (
            deckOrder: OnlineDeckOrderPayload
        ) => {
            if (
                !roomState?.hostDeckRecipe ||
                !roomState?.guestDeckRecipe
            ) {
                setError("対戦開始に必要なデッキ情報が不足しています。");
                return;
            }

            try {
                const hostDeckRecipe =
                    toDeckRecipe(roomState.hostDeckRecipe);

                const guestDeckRecipe =
                    toDeckRecipe(roomState.guestDeckRecipe);

                const hostCards =
                    buildDeckCardsFromRecipe(hostDeckRecipe);

                const guestCards =
                    buildDeckCardsFromRecipe(guestDeckRecipe);

                useGameStore
                    .getState()
                    .setLocalPlayerIndex(1);

                startGameWithDeckOrders(
                    hostCards,
                    guestCards,
                    deckOrder
                );
            } catch (e) {
                setError(
                    e instanceof Error
                        ? e.message
                        : "同期された対戦開始に失敗しました。"
                );
            }
        };

        socket.on(
            "game-setup",
            handleGameSetup
        );

        return () => {
            socket.off(
                "game-setup",
                handleGameSetup
            );
        };
    }, [
        roomState,
        startGameWithDeckOrders,
    ]);

    useEffect(() => {
        const offRoomState = onRoomStateChanged(
            (nextRoomState) => {
                setRoomState(nextRoomState);
            }
        );

        const offJoinFailed = onJoinFailed(() => {
            setError("ルームが見つからない、または満員です。");
        });

        return () => {
            offRoomState();
            offJoinFailed();
        };
    }, []);

    useEffect(() => {
        if (mode === "host") {
            createRoom();
        }
    }, [
        mode,
    ]);

    const ownDeck =
        isHost
            ? roomState?.hostDeckRecipe
            : roomState?.guestDeckRecipe;

    const opponentDeck =
        isHost
            ? roomState?.guestDeckRecipe
            : roomState?.hostDeckRecipe;

    const ownReady =
        isHost
            ? roomState?.hostReady
            : roomState?.guestReady;

    const opponentReady =
        isHost
            ? roomState?.guestReady
            : roomState?.hostReady;

    const canStart =
        isHost &&
        roomState !== null &&
        roomState.hostReady &&
        roomState.guestReady &&
        roomState.hostDeckRecipe !== null &&
        roomState.guestDeckRecipe !== null;

    function handleJoinRoom() {
        setError("");

        if (!roomCodeInput.trim()) {
            setError("ルームコードを入力してください。");
            return;
        }

        joinRoom(roomCodeInput);
    }

    function handleBack() {
        leaveRoom();
        setRoomState(null);
        setRoomCodeInput("");
        setSelectedDeckId("");
        setMessage("");
        setError("");
        onBack();
    }

    function handleSelectDeck(
        deckId: string
    ) {
        setSelectedDeckId(deckId);
        setError("");
        setMessage("");

        const deck = getLocalDeckRecipe(deckId);

        if (!deck) {
            setError("選択したデッキが見つかりません。");
            return;
        }

        selectDeckForRoom(
            toRoomDeckRecipe(deck)
        );

        setMessage(
            `${deck.name} を選択しました。`
        );
    }

    function handleReady() {
        setError("");

        if (!ownDeck) {
            setError("READY前にデッキを選択してください。");
            return;
        }

        ready();
    }

    function handleStart() {
        setError("");

        if (!roomState) {
            setError("ルーム情報がありません。");
            return;
        }

        if (!canStart) {
            setError("両者のデッキ選択とREADYが必要です。");
            return;
        }

        if (
            !roomState.hostDeckRecipe ||
            !roomState.guestDeckRecipe
        ) {
            setError("デッキ情報が不足しています。");
            return;
        }

        try {
            const hostDeckRecipe =
                toDeckRecipe(roomState.hostDeckRecipe);

            const guestDeckRecipe =
                toDeckRecipe(roomState.guestDeckRecipe);

            const hostCards =
                buildDeckCardsFromRecipe(hostDeckRecipe);

            const guestCards =
                buildDeckCardsFromRecipe(guestDeckRecipe);

            const deckOrder = createOnlineDeckOrder(
                hostCards,
                guestCards
            );

            useGameStore
                .getState()
                .setLocalPlayerIndex(0);

            startGameWithDeckOrders(
                hostCards,
                guestCards,
                deckOrder
            );

            sendGameSetup(deckOrder);
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : "対戦開始に失敗しました。"
            );
        }
    }

    return (
        <div style={pageStyle}>
            <div style={containerStyle}>
                <h1 style={titleStyle}>
                    オンライン対戦
                </h1>

                <div style={cardStyle}>
                    <div style={labelStyle}>
                        ルームコード
                    </div>

                    <div style={roomCodeStyle}>
                        {roomState?.roomId ?? "----"}
                    </div>

                    <div style={subTextStyle}>
                        {isHost ? "Host" : "Guest"}
                    </div>
                </div>

                {mode === "guest" && !roomState && (
                    <div style={cardStyle}>
                        <div style={labelStyle}>
                            ルーム入室
                        </div>

                        <input
                            value={roomCodeInput}
                            onChange={(e) =>
                                setRoomCodeInput(
                                    e.target.value.toUpperCase()
                                )
                            }
                            placeholder="ルームコード"
                            style={inputStyle}
                        />

                        <button
                            style={primaryButtonStyle}
                            onClick={handleJoinRoom}
                        >
                            入室
                        </button>
                    </div>
                )}

                {roomState && (
                    <>
                        <div style={cardStyle}>
                            <div style={labelStyle}>
                                自分のデッキ
                            </div>

                            <select
                                value={selectedDeckId}
                                onChange={(e) =>
                                    handleSelectDeck(e.target.value)
                                }
                                style={selectStyle}
                            >
                                <option value="">
                                    デッキを選択
                                </option>

                                {decks.map((deck) => (
                                    <option
                                        key={deck.id}
                                        value={deck.id}
                                    >
                                        {deck.name}
                                    </option>
                                ))}
                            </select>

                            <div style={statusTextStyle}>
                                選択中：
                                {ownDeck?.name ?? "未選択"}
                            </div>
                        </div>

                        <div style={cardStyle}>
                            <div style={labelStyle}>
                                相手
                            </div>

                            <div style={statusRowStyle}>
                                <span>デッキ</span>
                                <strong>
                                    {opponentDeck?.name ?? "未選択"}
                                </strong>
                            </div>

                            <div style={statusRowStyle}>
                                <span>状態</span>
                                <strong>
                                    {opponentReady ? "READY" : "未READY"}
                                </strong>
                            </div>
                        </div>

                        <div style={cardStyle}>
                            <div style={statusRowStyle}>
                                <span>自分</span>
                                <strong>
                                    {ownReady ? "READY" : "未READY"}
                                </strong>
                            </div>

                            <button
                                style={{
                                    ...primaryButtonStyle,
                                    opacity: ownDeck ? 1 : 0.45,
                                }}
                                disabled={!ownDeck}
                                onClick={handleReady}
                            >
                                READY
                            </button>

                            {isHost && (
                                <button
                                    style={{
                                        ...startButtonStyle,
                                        opacity: canStart ? 1 : 0.45,
                                    }}
                                    disabled={!canStart}
                                    onClick={handleStart}
                                >
                                    対戦開始
                                </button>
                            )}
                        </div>
                    </>
                )}

                {message && (
                    <div style={messageStyle}>
                        {message}
                    </div>
                )}

                {error && (
                    <div style={errorStyle}>
                        {error}
                    </div>
                )}

                <button
                    style={subButtonStyle}
                    onClick={handleBack}
                >
                    戻る
                </button>
            </div>
        </div>
    );
}

const pageStyle: CSSProperties = {
    width: "100%",
    height: "100dvh",
    background: "#111827",
    color: "white",
    padding:
        "12px 12px calc(20px + env(safe-area-inset-bottom))",
    boxSizing: "border-box",
    overflowY: "auto",
    overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
    overscrollBehaviorY: "contain",
};

const containerStyle: CSSProperties = {
    width: "100%",
    maxWidth: "520px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
};

const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: "22px",
};

const cardStyle: CSSProperties = {
    background:
        "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
    border: "1px solid rgba(148,163,184,0.45)",
    borderRadius: "18px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    boxShadow:
        "0 10px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
};

const labelStyle: CSSProperties = {
    fontSize: "13px",
    color: "#cbd5e1",
    fontWeight: 800,
};

const roomCodeStyle: CSSProperties = {
    marginTop: "8px",
    background: "#020617",
    border: "2px solid #60a5fa",
    borderRadius: "12px",
    padding: "14px",
    textAlign: "center",
    fontSize: "34px",
    fontWeight: 1000,
    letterSpacing: "6px",
    color: "#93c5fd",
    textShadow:
        "0 0 10px rgba(96,165,250,0.7)",
};

const subTextStyle: CSSProperties = {
    textAlign: "center",
    color: "#cbd5e1",
    fontWeight: 800,
};

const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: "44px",
    borderRadius: "10px",
    border: "1px solid #64748b",
    background: "#0f172a",
    color: "white",
    fontSize: "18px",
    fontWeight: 900,
    padding: "0 12px",
    boxSizing: "border-box",
    textTransform: "uppercase",
};

const selectStyle: CSSProperties = {
    width: "100%",
    minHeight: "44px",
    borderRadius: "10px",
    border: "1px solid #64748b",
    background: "#0f172a",
    color: "white",
    fontSize: "15px",
    fontWeight: 800,
    padding: "0 10px",
    boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
    width: "100%",
    minHeight: "56px",
    borderRadius: "16px",
    border: "1px solid #60a5fa",
    background:
        "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
    color: "white",
    fontSize: "17px",
    fontWeight: 900,
    boxShadow:
        "0 6px 0 #1e3a8a, 0 10px 18px rgba(0,0,0,0.35)",
    cursor: "pointer",
};

const startButtonStyle: CSSProperties = {
    ...primaryButtonStyle,
    minHeight: "60px",
    background:
        "linear-gradient(180deg, #f59e0b 0%, #b45309 100%)",
    border: "1px solid #facc15",
    color: "white",
    fontSize: "18px",
    boxShadow:
        "0 7px 0 #78350f, 0 12px 22px rgba(245,158,11,0.28)",
};

const subButtonStyle: CSSProperties = {
    width: "100%",
    minHeight: "48px",
    flexShrink: 0,
    borderRadius: "14px",
    border: "1px solid #64748b",
    background:
        "linear-gradient(180deg, #334155 0%, #1e293b 100%)",
    color: "#e2e8f0",
    fontSize: "15px",
    fontWeight: 900,
    boxShadow:
        "0 5px 0 #0f172a, 0 8px 14px rgba(0,0,0,0.3)",
    cursor: "pointer",
};

const statusTextStyle: CSSProperties = {
    color: "#cbd5e1",
    fontSize: "13px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
};

const statusRowStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    color: "#cbd5e1",
    fontSize: "14px",
};

const messageStyle: CSSProperties = {
    background: "#164e63",
    border: "1px solid #67e8f9",
    borderRadius: "10px",
    padding: "10px",
    fontSize: "13px",
    fontWeight: 800,
};

const errorStyle: CSSProperties = {
    background: "#7f1d1d",
    border: "1px solid #fca5a5",
    borderRadius: "10px",
    padding: "10px",
    fontSize: "13px",
    fontWeight: 800,
};
