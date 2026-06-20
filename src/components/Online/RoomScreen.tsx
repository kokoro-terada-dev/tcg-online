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
                    onClick={onBack}
                >
                    戻る
                </button>
            </div>
        </div>
    );
}

const pageStyle: CSSProperties = {
    minHeight: "100dvh",
    background: "#111827",
    color: "white",
    padding: "12px",
    boxSizing: "border-box",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
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
    background: "#1e293b",
    border: "1px solid #475569",
    borderRadius: "14px",
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
};

const labelStyle: CSSProperties = {
    fontSize: "13px",
    color: "#cbd5e1",
    fontWeight: 800,
};

const roomCodeStyle: CSSProperties = {
    fontSize: "36px",
    fontWeight: 900,
    letterSpacing: "6px",
    textAlign: "center",
    background: "#0f172a",
    borderRadius: "12px",
    padding: "14px 8px",
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
    minHeight: "48px",
    borderRadius: "12px",
    border: "1px solid #60a5fa",
    background: "#2563eb",
    color: "white",
    fontSize: "16px",
    fontWeight: 900,
};

const startButtonStyle: CSSProperties = {
    ...primaryButtonStyle,
    background: "#16a34a",
    border: "1px solid #86efac",
};

const subButtonStyle: CSSProperties = {
    width: "100%",
    minHeight: "46px",
    borderRadius: "12px",
    border: "1px solid #475569",
    background: "#1e293b",
    color: "white",
    fontSize: "15px",
    fontWeight: 800,
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