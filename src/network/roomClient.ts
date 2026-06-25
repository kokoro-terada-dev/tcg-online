import type {
  ActionLog,
  MulliganResultPayload,
  OnlineDeckOrderPayload
} from "../store/gameStore";

import {
  socket,
  setHost
} from "./socket";

export type DeckRecipeForRoom = {
  name: string;
  leaderCardId: string | null;
  mainDeck: string[];
  donDeck: string[];
  cardTypes: Record<string, string>;
  leaderLifeCount?: number;
};

export type CommunicationMode = "voice" | "silent";

export type TurnOrderPlayer = "host" | "guest";

export type RoomStateForClient = {
  roomId: string;
  hostSocketId: string;
  guestSocketId: string | null;
  hostReady: boolean;
  guestReady: boolean;
  hostDeckRecipe: DeckRecipeForRoom | null;
  guestDeckRecipe: DeckRecipeForRoom | null;
  communicationMode: CommunicationMode;
  hostMulliganComplete: boolean;
  guestMulliganComplete: boolean;
  turnOrderDecider: TurnOrderPlayer | null;
  firstPlayer: TurnOrderPlayer | null;
};

export type GameSetupStartPayload = {
  deckOrder: OnlineDeckOrderPayload;
  turnOrderDecider: 0 | 1;
};

export type BoardActionPayload =
  | {
    roomId: string;
    actionType: "MOVE_CARD";
    payload: {
      playerIndex: number;
      cardId: string;
      fromIndex?: number;
      from: "hand" | "character" | "stage" | "trash" | "life" | "deck" | "counter";
      to: "hand" | "character" | "stage" | "trash" | "life" | "deck" | "counter";
      slotIndex?: number;
    };
  }
  | {
    roomId: string;
    actionType: "MOVE_DON";
    payload: {
      playerIndex: number;
      cardId: string;
      fromIndex: number;
      fromArea: "donDeck" | "activeDon" | "restDon";
      toArea: "donDeck" | "activeDon" | "restDon";
    };
  }
  | {
    roomId: string;
    actionType: "ATTACH_DON";
    payload: {
      playerIndex: number;
      donCardId: string;
      fromArea: "activeDon" | "restDon";
      fromIndex: number;
      targetCardId: string;
      targetArea: "leader" | "character";
      targetIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "RETURN_ATTACHED_DON";
    payload: {
      playerIndex: number;
      targetCardId: string;
      targetArea: "leader" | "character";
      targetIndex: number;
      toArea: "donDeck" | "activeDon" | "restDon";
    };
  }
  | {
    roomId: string;
    actionType: "REFRESH_PLAYER";
    payload: {
      playerIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "CARD_MENU_ACTION";
    payload: {
      playerIndex: number;
      cardId: string;
      targetArea: "leader" | "character" | "stage";
      targetIndex: number;
      menuAction:
      | "TOGGLE_ROTATE"
      | "CHANGE_POWER"
      | "CHANGE_COUNT_MODIFIER"
      | "SET_STATUS_LABEL"
      | "RETURN_ATTACHED_DONS_TO_REST";
      amount?: number;
      label?: string;
    };
  }
  | {
    roomId: string;
    actionType: "MOVE_SELECTED_DON_STACK";
    payload: {
      playerIndex: number;
      fromArea: "donDeck" | "activeDon" | "restDon";
      count: number;
      toArea: "donDeck" | "activeDon" | "restDon";
    };
  }
  | {
    roomId: string;
    actionType: "ATTACH_SELECTED_DON_STACK";
    payload: {
      playerIndex: number;
      fromArea: "activeDon" | "restDon";
      count: number;
      targetCardId: string;
      targetArea: "leader" | "character";
      targetIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "LIST_CARD_ACTION";
    payload: {
      playerIndex: number;
      from: "deck" | "trash" | "life";
      fromIndex: number;
      listAction:
      | "TO_HAND"
      | "TO_PUBLIC"
      | "TO_TRASH"
      | "TO_DECK_BOTTOM"
      | "TO_LIFE_TOP";
    };
  }
  | {
    roomId: string;
    actionType: "TOGGLE_LIST_CARD_FACE";
    payload: {
      playerIndex: number;
      zone: "deck" | "trash" | "life";
      cardIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "OPEN_TOP_DECK_CARDS";
    payload: {
      playerIndex: number;
      count: number;
    };
  }
  | {
    roomId: string;
    actionType: "REORDER_ZONE_CARDS";
    payload: {
      playerIndex: number;
      zone: "deck" | "trash" | "life";
      activeIndex: number;
      overIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "TOGGLE_PUBLIC_CARD_FACE";
    payload: {
      playerIndex: number;
      cardIndex: number;
    };
  }
  | {
    roomId: string;
    actionType: "QUICK_ACTION";
    payload: {
      log: ActionLog;
    };
  }
  | {
    roomId: string;
    actionType: "SET_ATTACK_TARGET";
    payload: {
      targetPlayerIndex: 0 | 1;
      targetArea: "leader" | "character";
      targetIndex: number;
      log: ActionLog;
    };
  }
  | {
    roomId: string;
    actionType: "CARD_QUICK_ACTION";
    payload: {
      playerIndex: 0 | 1;
      targetArea: "leader" | "character" | "stage" | "public";
      targetIndex: number;
      quickAction:
        | "attack"
        | "target"
        | "target1"
        | "target2"
        | "target3"
        | "effect"
        | "processing"
        | "confirmRequest"
        | "confirmed"
        | "note"
        | "rest"
        | "block"
        | "powerPlus"
        | "counterPhase"
        | "cancelSource"
        | "cancelTarget";
      log?: ActionLog;
    };
  }
  | {
    roomId: string;
    actionType: "CLEAR_CARD_ACTIONS";
    payload: {
      log?: ActionLog;
    };
  }
  | {
    roomId: string;
    actionType: "COUNTER_PHASE_ACTION";
    payload:
      | {
        counterAction: "START";
        playerIndex: 0 | 1;
        targetCardId: string;
        targetArea: "leader" | "character";
        targetIndex: number;
        log?: ActionLog;
      }
      | {
        counterAction: "ADJUST";
        amount: number;
      }
      | {
        counterAction: "CANCEL" | "CONFIRM";
      };
  };

let roomIdForClient: string | null = null;
let roomStateForClient: RoomStateForClient | null = null;
let createRoomPending = false;
let leaveAfterCreate = false;
let ignoredRoomId: string | null = null;

const roomStateListeners =
  new Set<(roomState: RoomStateForClient) => void>();

const joinFailedListeners =
  new Set<() => void>();

const boardActionListeners =
  new Set<(payload: BoardActionPayload) => void>();

const mulliganResultListeners =
  new Set<(payload: MulliganResultPayload) => void>();

const mulliganCompleteListeners =
  new Set<() => void>();

const gameTurnOrderSelectedListeners =
  new Set<(firstPlayerIndex: 0 | 1) => void>();

const opponentDisconnectedListeners =
  new Set<() => void>();

const roomClosedListeners =
  new Set<(message: string) => void>();

const guestLeftListeners =
  new Set<(message: string) => void>();

const matchExitRequestListeners =
  new Set<() => void>();

const matchExitAcceptedListeners =
  new Set<() => void>();

const matchExitRejectedListeners =
  new Set<() => void>();

function updateRoomState(
  roomState: RoomStateForClient
) {
  roomIdForClient = roomState.roomId;
  roomStateForClient = roomState;

  for (const listener of roomStateListeners) {
    listener(roomState);
  }
}

export function getClientRoomId() {
  return roomIdForClient;
}

export function getClientRoomState() {
  return roomStateForClient;
}

export function onRoomStateChanged(
  listener: (roomState: RoomStateForClient) => void
) {
  roomStateListeners.add(listener);

  if (roomStateForClient) {
    listener(roomStateForClient);
  }

  return () => {
    roomStateListeners.delete(listener);
  };
}

export function onJoinFailed(
  listener: () => void
) {
  joinFailedListeners.add(listener);

  return () => {
    joinFailedListeners.delete(listener);
  };
}

export function onBoardAction(
  listener: (payload: BoardActionPayload) => void
) {
  boardActionListeners.add(listener);

  return () => {
    boardActionListeners.delete(listener);
  };
}

export function onMulliganResult(
  listener: (payload: MulliganResultPayload) => void
) {
  mulliganResultListeners.add(listener);

  return () => {
    mulliganResultListeners.delete(listener);
  };
}

export function onOpponentDisconnected(
  listener: () => void
) {
  opponentDisconnectedListeners.add(listener);

  return () => {
    opponentDisconnectedListeners.delete(listener);
  };
}

export function onRoomClosed(
  listener: (message: string) => void
) {
  roomClosedListeners.add(listener);

  return () => {
    roomClosedListeners.delete(listener);
  };
}

export function onGuestLeft(
  listener: (message: string) => void
) {
  guestLeftListeners.add(listener);

  return () => {
    guestLeftListeners.delete(listener);
  };
}

export function onMatchExitRequest(
  listener: () => void
) {
  matchExitRequestListeners.add(listener);

  return () => {
    matchExitRequestListeners.delete(listener);
  };
}

export function onMatchExitAccepted(
  listener: () => void
) {
  matchExitAcceptedListeners.add(listener);

  return () => {
    matchExitAcceptedListeners.delete(listener);
  };
}

export function onMatchExitRejected(
  listener: () => void
) {
  matchExitRejectedListeners.add(listener);

  return () => {
    matchExitRejectedListeners.delete(listener);
  };
}

export function clearClientRoomState() {
  roomIdForClient = null;
  roomStateForClient = null;
  createRoomPending = false;
  leaveAfterCreate = false;
  ignoredRoomId = null;
  setHost(false);
}

export function onMulliganComplete(
  listener: () => void
) {
  mulliganCompleteListeners.add(listener);

  return () => {
    mulliganCompleteListeners.delete(listener);
  };
}

export function onGameTurnOrderSelected(
  listener: (firstPlayerIndex: 0 | 1) => void
) {
  gameTurnOrderSelectedListeners.add(listener);

  return () => {
    gameTurnOrderSelectedListeners.delete(listener);
  };
}

export function leaveRoom() {
  const roomId = roomIdForClient;
  const wasCreatingRoom = createRoomPending;

  if (roomId) {
    socket.emit("leave-room", { roomId });
  }

  clearClientRoomState();
  leaveAfterCreate = wasCreatingRoom;
  setHost(false);
}

export function setClientRoomId(
  roomId: string
) {
  roomIdForClient = roomId;
}

export function createRoom() {
  if (createRoomPending || roomIdForClient) {
    return;
  }

  createRoomPending = true;
  leaveAfterCreate = false;
  ignoredRoomId = null;
  setHost(true);

  socket.emit("create-room");
}

export function joinRoom(
  roomId: string
) {
  const normalizedRoomId =
    roomId.trim().toUpperCase();

  if (!normalizedRoomId) {
    return;
  }

  setHost(false);

  roomIdForClient = normalizedRoomId;

  socket.emit(
    "join-room",
    normalizedRoomId
  );
}

export function selectDeckForRoom(
  deckRecipe: DeckRecipeForRoom
) {
  if (!roomIdForClient) {
    return;
  }

  socket.emit(
    "deck-selected",
    {
      roomId: roomIdForClient,
      deckRecipe,
    }
  );
}

export function ready() {
  if (!roomIdForClient) {
    return;
  }

  socket.emit(
    "ready",
    roomIdForClient
  );
}

export function setRoomCommunicationMode(
  communicationMode: CommunicationMode
) {
  if (!roomIdForClient) {
    return;
  }

  socket.emit("set-communication-mode", {
    roomId: roomIdForClient,
    communicationMode,
  });
}

type TurnOrderResponse = {
  ok: boolean;
  message?: string;
};

export function rollTurnOrder(
  callback?: (response: TurnOrderResponse) => void
) {
  if (!roomIdForClient) {
    callback?.({
      ok: false,
      message: "ルーム情報がありません。",
    });
    return;
  }

  socket.emit(
    "roll-turn-order",
    {
      roomId: roomIdForClient,
    },
    callback
  );
}

export function selectTurnOrder(
  choice: "first" | "second",
  callback?: (response: TurnOrderResponse) => void
) {
  if (!roomIdForClient) {
    callback?.({
      ok: false,
      message: "ルーム情報がありません。",
    });
    return;
  }

  socket.emit(
    "select-turn-order",
    {
      roomId: roomIdForClient,
      choice,
    },
    callback
  );
}

export function sendGameSetup(
  deckOrder: OnlineDeckOrderPayload
) {
  if (!roomIdForClient) {
    return;
  }

  socket.emit(
    "game-setup",
    {
      roomId: roomIdForClient,
      deckOrder,
    }
  );
}

export function sendGameTurnOrderSelected(
  firstPlayerIndex: 0 | 1
) {
  if (!roomIdForClient) {
    return;
  }

  socket.emit(
    "game-turn-order-selected",
    {
      roomId: roomIdForClient,
      firstPlayerIndex,
    }
  );
}

export function sendMulliganResult(
  result: MulliganResultPayload
) {
  if (!roomIdForClient) {
    return;
  }

  socket.emit(
    "mulligan-result",
    {
      roomId: roomIdForClient,
      ...result,
    }
  );
}

export function sendBoardAction(
  action: Omit<BoardActionPayload, "roomId">
) {
  if (!roomIdForClient) {
    return;
  }

  socket.emit(
    "board-action",
    {
      roomId: roomIdForClient,
      ...action,
    }
  );
}

export function sendMatchExitRequest() {
  if (!roomIdForClient) {
    return;
  }

  socket.emit(
    "match-exit-request",
    {
      roomId: roomIdForClient,
    }
  );
}

export function sendMatchExitAccepted() {
  if (!roomIdForClient) {
    return;
  }

  socket.emit(
    "match-exit-accepted",
    {
      roomId: roomIdForClient,
    }
  );
}

export function sendMatchExitRejected() {
  if (!roomIdForClient) {
    return;
  }

  socket.emit(
    "match-exit-rejected",
    {
      roomId: roomIdForClient,
    }
  );
}

socket.on(
  "room-created",
  (roomState: RoomStateForClient) => {
    createRoomPending = false;

    if (leaveAfterCreate) {
      leaveAfterCreate = false;
      ignoredRoomId = roomState.roomId;
      socket.emit("leave-room", {
        roomId: roomState.roomId,
      });
      setHost(false);
      return;
    }

    setHost(true);
    updateRoomState(roomState);
  }
);

socket.on(
  "room-joined",
  (roomState: RoomStateForClient) => {
    ignoredRoomId = null;
    setHost(false);
    updateRoomState(roomState);
  }
);

socket.on(
  "room-state",
  (roomState: RoomStateForClient) => {
    if (roomState.roomId === ignoredRoomId) {
      return;
    }

    updateRoomState(roomState);
  }
);

socket.on(
  "join-failed",
  () => {
    createRoomPending = false;
    clearClientRoomState();

    for (const listener of joinFailedListeners) {
      listener();
    }
  }
);

socket.on(
  "board-action",
  (payload: BoardActionPayload) => {
    for (const listener of boardActionListeners) {
      listener(payload);
    }
  }
);

socket.on(
  "mulligan-result",
  (payload: MulliganResultPayload) => {
    for (const listener of mulliganResultListeners) {
      listener(payload);
    }
  }
);

socket.on(
  "mulligan-complete",
  () => {
    for (const listener of mulliganCompleteListeners) {
      listener();
    }
  }
);

socket.on(
  "game-turn-order-selected",
  (payload: { firstPlayerIndex: 0 | 1 }) => {
    for (const listener of gameTurnOrderSelectedListeners) {
      listener(payload.firstPlayerIndex);
    }
  }
);

socket.on(
  "opponent-disconnected",
  () => {
    clearClientRoomState();

    for (const listener of opponentDisconnectedListeners) {
      listener();
    }
  }
);

socket.on(
  "room-closed",
  (payload?: { message?: string }) => {
    const message =
      payload?.message ?? "ホストがルームを解散しました";

    clearClientRoomState();

    for (const listener of roomClosedListeners) {
      listener(message);
    }
  }
);

socket.on(
  "guest-left",
  (payload?: { message?: string }) => {
    const message =
      payload?.message ?? "ゲストが退出しました";

    for (const listener of guestLeftListeners) {
      listener(message);
    }
  }
);

socket.on(
  "match-exit-request",
  () => {
    for (const listener of matchExitRequestListeners) {
      listener();
    }
  }
);

socket.on(
  "match-exit-accepted",
  () => {
    for (const listener of matchExitAcceptedListeners) {
      listener();
    }
  }
);

socket.on(
  "match-exit-rejected",
  () => {
    for (const listener of matchExitRejectedListeners) {
      listener();
    }
  }
);
