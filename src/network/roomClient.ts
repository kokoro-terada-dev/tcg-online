import type {
  OnlineDeckOrderPayload
} from "../store/gameStore";

import {
  socket,
  setHost
} from "./socket";

let roomIdForClient: string | null = null;

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
  setHost(false);

  roomIdForClient = roomId;

  socket.emit(
    "join-room",
    roomId
  );
}

export function ready() {
  if (!roomIdForClient) {
    console.warn(
      "ready skipped: room id is not set"
    );

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
    console.warn(
      "game setup skipped: room id is not set"
    );

    return;
  }

  console.log(
    "SEND GAME SETUP",
    roomIdForClient,
    deckOrder
  );

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
  (roomId: string) => {
    roomIdForClient = roomId;

    console.log(
      "ROOM CREATED",
      roomId
    );
  }
);

socket.on(
  "room-joined",
  (roomId: string) => {
    roomIdForClient = roomId;

    console.log(
      "ROOM JOINED",
      roomId
    );
  }
);