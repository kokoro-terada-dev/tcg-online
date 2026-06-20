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

let roomIdForClient: string | null = null;
let roomStateForClient: RoomStateForClient | null = null;

const roomStateListeners =
  new Set<(roomState: RoomStateForClient) => void>();

const joinFailedListeners =
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