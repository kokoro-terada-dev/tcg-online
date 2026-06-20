import type {
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

export type RoomStateForClient = {
  roomId: string;
  hostSocketId: string;
  guestSocketId: string | null;
  hostReady: boolean;
  guestReady: boolean;
  hostDeckRecipe: DeckRecipeForRoom | null;
  guestDeckRecipe: DeckRecipeForRoom | null;
};

export type BoardActionPayload =
  | {
    roomId: string;
    actionType: "MOVE_CARD";
    payload: {
      playerIndex: number;
      cardId: string;
      fromIndex?: number;
      from: "hand" | "character" | "stage" | "trash" | "life" | "deck";
      to: "hand" | "character" | "stage" | "trash" | "life" | "deck";
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
      toArea: "activeDon" | "restDon";
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
        | "SET_STATUS_LABEL"
        | "RETURN_ATTACHED_DONS_TO_REST";
      amount?: number;
      label?: "アタック×" | "アクティブ×";
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
  };

let roomIdForClient: string | null = null;
let roomStateForClient: RoomStateForClient | null = null;

const roomStateListeners =
  new Set<(roomState: RoomStateForClient) => void>();

const joinFailedListeners =
  new Set<() => void>();

const boardActionListeners =
  new Set<(payload: BoardActionPayload) => void>();

const opponentDisconnectedListeners =
  new Set<() => void>();

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

export function onOpponentDisconnected(
  listener: () => void
) {
  opponentDisconnectedListeners.add(listener);

  return () => {
    opponentDisconnectedListeners.delete(listener);
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
}

export function setClientRoomId(
  roomId: string
) {
  roomIdForClient = roomId;
}

export function createRoom() {
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
    console.log("ROOM CREATED", roomState);
    setHost(true);
    updateRoomState(roomState);
  }
);

socket.on(
  "room-joined",
  (roomState: RoomStateForClient) => {
    setHost(false);
    updateRoomState(roomState);
  }
);

socket.on(
  "room-state",
  (roomState: RoomStateForClient) => {
    updateRoomState(roomState);
  }
);

socket.on(
  "join-failed",
  () => {
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
  "opponent-disconnected",
  () => {
    clearClientRoomState();

    for (const listener of opponentDisconnectedListeners) {
      listener();
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
    clearClientRoomState();

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
