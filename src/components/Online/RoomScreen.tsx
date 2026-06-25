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
    onGuestLeft,
    onJoinFailed,
    onRoomClosed,
    onRoomStateChanged,
    ready,
    selectDeckForRoom,
    sendGameSetup,
    setRoomCommunicationMode
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

import {
    getLocalCardImage
} from "../../utils/localCardImages";

type RoomScreenProps = {
    mode: "host" | "guest";
    onBack: () => void;
};

type PlayerPanelProps = {
    title: string;
    role: "HOST" | "GUEST";
    connected: boolean;
    ready: boolean;
    deck: DeckRecipeForRoom | undefined | null;
    accent: "blue" | "rose";
    emptyText: string;
    deckOptions?: DeckRecipe[];
    selectedDeckId?: string;
    onSelectDeck?: (deckId: string) => void;
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

function getLeaderImageUrl(deck: DeckRecipeForRoom | undefined | null) {
    if (!deck?.leaderCardId) {
        return null;
    }

    return getLocalCardImage(deck.leaderCardId)?.imageUrl ?? null;
}

function PlayerPanel({
    title,
    role,
    connected,
    ready,
    deck,
    accent,
    emptyText,
    deckOptions,
    selectedDeckId = "",
    onSelectDeck,
}: PlayerPanelProps) {
    const leaderImageUrl = getLeaderImageUrl(deck);
    const colors = accent === "blue"
        ? {
            border: "#38bdf8",
            glow: "rgba(56, 189, 248, 0.28)",
            bg: "rgba(14, 116, 144, 0.24)",
            text: "#bae6fd",
        }
        : {
            border: "#fb7185",
            glow: "rgba(251, 113, 133, 0.28)",
            bg: "rgba(159, 18, 57, 0.24)",
            text: "#fecdd3",
        };

    return (
        <section
            style={{
                ...playerPanelStyle,
                borderColor: connected
                    ? colors.border
                    : "rgba(100, 116, 139, 0.8)",
                boxShadow: connected
                    ? `0 0 0 1px ${colors.glow}, 0 14px 26px rgba(0,0,0,0.35)`
                    : "0 10px 20px rgba(0,0,0,0.28)",
            }}
        >
            <div style={playerPanelHeaderStyle}>
                <div>
                    <div style={panelEyebrowStyle}>{role}</div>
                    <div style={panelTitleStyle}>{title}</div>
                </div>

                <div
                    style={{
                        ...connectionPillStyle,
                        background: connected
                            ? "rgba(22, 163, 74, 0.16)"
                            : "rgba(100, 116, 139, 0.18)",
                        borderColor: connected ? "#22c55e" : "#64748b",
                        color: connected ? "#bbf7d0" : "#cbd5e1",
                    }}
                >
                    <span
                        style={{
                            ...connectionDotStyle,
                            background: connected ? "#22c55e" : "#64748b",
                            boxShadow: connected
                                ? "0 0 10px rgba(34, 197, 94, 0.9)"
                                : "none",
                        }}
                    />
                    {connected ? "入室済み" : "未入室"}
                </div>
            </div>

            <div style={playerPanelBodyStyle}>
                <div
                    style={{
                        ...leaderFrameStyle,
                        borderColor: leaderImageUrl
                            ? colors.border
                            : "rgba(100, 116, 139, 0.72)",
                        background: leaderImageUrl
                            ? "#020617"
                            : "linear-gradient(145deg, rgba(30,41,59,0.92), rgba(15,23,42,0.92))",
                    }}
                >
                    {leaderImageUrl ? (
                        <img
                            src={leaderImageUrl}
                            alt=""
                            draggable={false}
                            style={leaderImageStyle}
                        />
                    ) : (
                        <div style={leaderPlaceholderStyle}>
                            LEADER
                        </div>
                    )}
                </div>

                <div style={playerInfoStyle}>
                    <div style={deckNameLabelStyle}>デッキ</div>
                    <div style={deckNameStyle}>
                        {deck?.name ?? emptyText}
                    </div>

                    {deckOptions && onSelectDeck && (
                        <select
                            value={selectedDeckId}
                            onChange={(e) =>
                                onSelectDeck(e.target.value)
                            }
                            style={inlineSelectStyle}
                        >
                            <option value="">
                                デッキを選択
                            </option>

                            {deckOptions.map((item) => (
                                <option
                                    key={item.id}
                                    value={item.id}
                                >
                                    {item.name}
                                </option>
                            ))}
                        </select>
                    )}

                    <div style={miniStatusGridStyle}>
                        <div
                            style={{
                                ...miniStatusStyle,
                                background: deck
                                    ? colors.bg
                                    : "rgba(51, 65, 85, 0.55)",
                                color: deck ? colors.text : "#cbd5e1",
                                borderColor: deck
                                    ? colors.border
                                    : "#475569",
                            }}
                        >
                            {deck ? "デッキ選択済み" : "デッキ未選択"}
                        </div>

                        <div
                            style={{
                                ...miniStatusStyle,
                                background: ready
                                    ? "rgba(22, 163, 74, 0.2)"
                                    : "rgba(51, 65, 85, 0.55)",
                                color: ready ? "#bbf7d0" : "#cbd5e1",
                                borderColor: ready ? "#22c55e" : "#475569",
                            }}
                        >
                            {ready ? "READY" : "未READY"}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
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
                useGameStore
                    .getState()
                    .setCommunicationMode(
                        nextRoomState.communicationMode
                    );
            }
        );

        const offJoinFailed = onJoinFailed(() => {
            setError("ルームが見つからない、または満員です。");
        });

        const offRoomClosed = onRoomClosed((nextMessage) => {
            setRoomState(null);
            setSelectedDeckId("");
            setRoomCodeInput("");
            setMessage("");
            setError(nextMessage);
            window.alert(nextMessage);
            onBack();
        });

        const offGuestLeft = onGuestLeft((nextMessage) => {
            setMessage(nextMessage);
        });

        return () => {
            offRoomState();
            offJoinFailed();
            offRoomClosed();
            offGuestLeft();
        };
    }, [onBack]);

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
        Boolean(isHost
            ? roomState?.hostReady
            : roomState?.guestReady);

    const opponentReady =
        Boolean(isHost
            ? roomState?.guestReady
            : roomState?.hostReady);

    const opponentConnected =
        Boolean(isHost
            ? roomState?.guestSocketId
            : roomState?.hostSocketId);

    const ownConnected = roomState !== null;

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
                <header style={headerStyle}>
                    <div>
                        <div style={screenLabelStyle}>
                            ONLINE ROOM
                        </div>
                        <h1 style={titleStyle}>
                            対戦ルーム
                        </h1>
                    </div>

                    <div style={roleBadgeStyle}>
                        {isHost ? "HOST" : "GUEST"}
                    </div>
                </header>

                <section style={roomCodeCardStyle}>
                    <div style={roomCodeHeaderStyle}>
                        <span>ルームコード</span>
                        <span style={roomStateBadgeStyle}>
                            {roomState ? "接続中" : "未接続"}
                        </span>
                    </div>

                    <div style={roomCodeStyle}>
                        {roomState?.roomId ?? "----"}
                    </div>

                    {mode === "guest" && !roomState && (
                        <div style={joinBoxStyle}>
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
                </section>

                {roomState && (
                    <>
                        <PlayerPanel
                            title="自分"
                            role={isHost ? "HOST" : "GUEST"}
                            connected={ownConnected}
                            ready={ownReady}
                            deck={ownDeck}
                            accent="blue"
                            emptyText="デッキを選択してください"
                            deckOptions={decks}
                            selectedDeckId={selectedDeckId}
                            onSelectDeck={handleSelectDeck}
                        />

                        <PlayerPanel
                            title="対戦相手"
                            role={isHost ? "GUEST" : "HOST"}
                            connected={opponentConnected}
                            ready={opponentReady}
                            deck={opponentDeck}
                            accent="rose"
                            emptyText={
                                opponentConnected
                                    ? "デッキ選択待ち"
                                    : "入室待ち"
                            }
                        />

                        <section style={modeCardStyle}>
                            <div style={sectionTitleStyle}>
                                通話モード
                            </div>

                            {isHost ? (
                                <div style={segmentedStyle}>
                                    <button
                                        type="button"
                                        style={{
                                            ...segmentButtonStyle,
                                            ...(roomState.communicationMode === "voice"
                                                ? segmentButtonActiveStyle
                                                : {}),
                                        }}
                                        onClick={() =>
                                            setRoomCommunicationMode("voice")
                                        }
                                    >
                                        通話あり
                                    </button>
                                    <button
                                        type="button"
                                        style={{
                                            ...segmentButtonStyle,
                                            ...(roomState.communicationMode === "silent"
                                                ? segmentButtonActiveStyle
                                                : {}),
                                        }}
                                        onClick={() =>
                                            setRoomCommunicationMode("silent")
                                        }
                                    >
                                        通話なし
                                    </button>
                                </div>
                            ) : (
                                <div style={modeReadOnlyStyle}>
                                    {roomState.communicationMode === "silent"
                                        ? "通話なし"
                                        : "通話あり"}
                                </div>
                            )}
                        </section>

                        <section style={actionCardStyle}>
                            <div style={sectionTitleStyle}>
                                準備
                            </div>

                            <button
                                style={{
                                    ...primaryButtonStyle,
                                    opacity: ownDeck ? 1 : 0.45,
                                }}
                                disabled={!ownDeck}
                                onClick={handleReady}
                            >
                                {ownReady ? "READY済み" : "READY"}
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
                        </section>
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
                    style={backButtonStyle}
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
    background:
        "radial-gradient(circle at 50% 0%, rgba(14, 116, 144, 0.38), transparent 34%), linear-gradient(180deg, #020617 0%, #111827 52%, #0f172a 100%)",
    color: "white",
    padding:
        "12px 12px calc(18px + env(safe-area-inset-bottom))",
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
    gap: "10px",
};

const headerStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "2px 2px 0",
};

const screenLabelStyle: CSSProperties = {
    color: "#67e8f9",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.12em",
};

const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: "24px",
    lineHeight: 1.15,
};

const roleBadgeStyle: CSSProperties = {
    minWidth: "74px",
    padding: "8px 10px",
    borderRadius: "999px",
    border: "1px solid #38bdf8",
    background: "rgba(8, 47, 73, 0.78)",
    color: "#e0f2fe",
    fontSize: "12px",
    fontWeight: 1000,
    textAlign: "center",
};

const roomCodeCardStyle: CSSProperties = {
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid rgba(56, 189, 248, 0.5)",
    background:
        "linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(8, 47, 73, 0.82))",
    boxShadow:
        "0 12px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
};

const roomCodeHeaderStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "#cbd5e1",
    fontSize: "12px",
    fontWeight: 900,
};

const roomStateBadgeStyle: CSSProperties = {
    padding: "3px 8px",
    borderRadius: "999px",
    border: "1px solid #64748b",
    color: "#e2e8f0",
};

const roomCodeStyle: CSSProperties = {
    marginTop: "8px",
    background: "#020617",
    border: "2px solid #60a5fa",
    borderRadius: "10px",
    padding: "10px",
    textAlign: "center",
    fontSize: "34px",
    fontWeight: 1000,
    letterSpacing: "6px",
    color: "#bfdbfe",
    textShadow:
        "0 0 12px rgba(96,165,250,0.86)",
};

const joinBoxStyle: CSSProperties = {
    marginTop: "10px",
    display: "grid",
    gridTemplateColumns: "1fr 92px",
    gap: "8px",
};

const playerPanelStyle: CSSProperties = {
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid",
    background:
        "linear-gradient(180deg, rgba(30, 41, 59, 0.94), rgba(15, 23, 42, 0.96))",
};

const playerPanelHeaderStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
};

const panelEyebrowStyle: CSSProperties = {
    color: "#94a3b8",
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: "0.12em",
};

const panelTitleStyle: CSSProperties = {
    marginTop: "2px",
    fontSize: "17px",
    fontWeight: 1000,
};

const connectionPillStyle: CSSProperties = {
    minWidth: "88px",
    padding: "6px 8px",
    borderRadius: "999px",
    border: "1px solid",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    fontWeight: 1000,
};

const connectionDotStyle: CSSProperties = {
    width: "9px",
    height: "9px",
    borderRadius: "50%",
    flexShrink: 0,
};

const playerPanelBodyStyle: CSSProperties = {
    marginTop: "10px",
    display: "grid",
    gridTemplateColumns: "78px 1fr",
    gap: "12px",
    alignItems: "stretch",
};

const leaderFrameStyle: CSSProperties = {
    width: "78px",
    aspectRatio: "0.71",
    borderRadius: "8px",
    border: "2px solid",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 8px 16px rgba(0,0,0,0.42)",
};

const leaderImageStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
};

const leaderPlaceholderStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#64748b",
    fontSize: "10px",
    fontWeight: 1000,
    letterSpacing: "0.08em",
};

const playerInfoStyle: CSSProperties = {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "8px",
};

const deckNameLabelStyle: CSSProperties = {
    color: "#94a3b8",
    fontSize: "11px",
    fontWeight: 900,
};

const deckNameStyle: CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: "#f8fafc",
    fontSize: "15px",
    fontWeight: 1000,
};

const miniStatusGridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 76px",
    gap: "6px",
};

const miniStatusStyle: CSSProperties = {
    minHeight: "28px",
    border: "1px solid",
    borderRadius: "7px",
    padding: "0 7px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontSize: "11px",
    fontWeight: 1000,
    whiteSpace: "nowrap",
};

const modeCardStyle: CSSProperties = {
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid rgba(148, 163, 184, 0.42)",
    background: "rgba(15, 23, 42, 0.78)",
};

const actionCardStyle: CSSProperties = {
    ...modeCardStyle,
    display: "flex",
    flexDirection: "column",
    gap: "9px",
};

const sectionTitleStyle: CSSProperties = {
    marginBottom: "8px",
    color: "#cbd5e1",
    fontSize: "12px",
    fontWeight: 1000,
};

const segmentedStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "6px",
    padding: "4px",
    borderRadius: "10px",
    background: "#020617",
    border: "1px solid #334155",
};

const segmentButtonStyle: CSSProperties = {
    minHeight: "40px",
    borderRadius: "8px",
    border: "1px solid transparent",
    background: "transparent",
    color: "#cbd5e1",
    fontSize: "14px",
    fontWeight: 1000,
};

const segmentButtonActiveStyle: CSSProperties = {
    borderColor: "#38bdf8",
    background: "linear-gradient(180deg, #0284c7, #075985)",
    color: "#ffffff",
    boxShadow: "0 0 14px rgba(56, 189, 248, 0.32)",
};

const modeReadOnlyStyle: CSSProperties = {
    minHeight: "42px",
    borderRadius: "10px",
    border: "1px solid #38bdf8",
    background: "rgba(8, 47, 73, 0.78)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "15px",
    fontWeight: 1000,
};

const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: "46px",
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

const inlineSelectStyle: CSSProperties = {
    width: "100%",
    minHeight: "38px",
    borderRadius: "8px",
    border: "1px solid #38bdf8",
    background: "rgba(2, 6, 23, 0.92)",
    color: "white",
    fontSize: "13px",
    fontWeight: 900,
    padding: "0 10px",
    boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
    width: "100%",
    minHeight: "50px",
    borderRadius: "12px",
    border: "1px solid #60a5fa",
    background:
        "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
    color: "white",
    fontSize: "16px",
    fontWeight: 1000,
    boxShadow:
        "0 5px 0 #1e3a8a, 0 10px 18px rgba(0,0,0,0.32)",
    cursor: "pointer",
};

const startButtonStyle: CSSProperties = {
    ...primaryButtonStyle,
    minHeight: "54px",
    background:
        "linear-gradient(180deg, #f59e0b 0%, #b45309 100%)",
    border: "1px solid #facc15",
    fontSize: "18px",
    boxShadow:
        "0 6px 0 #78350f, 0 12px 22px rgba(245,158,11,0.25)",
};

const backButtonStyle: CSSProperties = {
    width: "100%",
    minHeight: "46px",
    flexShrink: 0,
    borderRadius: "12px",
    border: "1px solid #64748b",
    background:
        "linear-gradient(180deg, #334155 0%, #1e293b 100%)",
    color: "#e2e8f0",
    fontSize: "15px",
    fontWeight: 1000,
    boxShadow:
        "0 4px 0 #0f172a, 0 8px 14px rgba(0,0,0,0.28)",
    cursor: "pointer",
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
