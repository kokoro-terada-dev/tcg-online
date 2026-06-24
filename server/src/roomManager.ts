import type {
  CommunicationMode,
  DeckRecipeForRoom,
  RoomState,
} from "./types";

const rooms = new Map<string, RoomState>();

function createRoomId() {
  return Math.floor(
    Math.random() * 10000
  )
    .toString()
    .padStart(4, "0");
}

export function createRoom(
  socketId: string
) {
  let roomId = createRoomId();

  while (rooms.has(roomId)) {
    roomId = createRoomId();
  }

  const room: RoomState = {
    roomId,
    hostSocketId: socketId,
    guestSocketId: null,
    hostReady: false,
    guestReady: false,
    hostDeckRecipe: null,
    guestDeckRecipe: null,
    communicationMode: "voice",
    hostMulliganComplete: false,
    guestMulliganComplete: false,
  };

  rooms.set(roomId, room);

  return room;
}

export function joinRoom(
  roomId: string,
  socketId: string
) {
  const room = rooms.get(roomId);

  if (!room) {
    return null;
  }

  if (room.hostSocketId === socketId) {
    return room;
  }

  if (
    room.guestSocketId &&
    room.guestSocketId !== socketId
  ) {
    return null;
  }

  room.guestSocketId = socketId;
  room.guestReady = false;

  return room;
}

export function setReady(
  roomId: string,
  socketId: string
) {
  const room = rooms.get(roomId);

  if (!room) {
    return null;
  }

  if (room.hostSocketId === socketId) {
    room.hostReady = true;
  } else if (room.guestSocketId === socketId) {
    room.guestReady = true;
  } else {
    return null;
  }

  return room;
}

export function setDeckRecipe(
  roomId: string,
  socketId: string,
  deckRecipe: DeckRecipeForRoom
) {
  const room = rooms.get(roomId);

  if (!room) {
    return null;
  }

  if (room.hostSocketId === socketId) {
    room.hostDeckRecipe = deckRecipe;
    room.hostReady = false;
  } else if (room.guestSocketId === socketId) {
    room.guestDeckRecipe = deckRecipe;
    room.guestReady = false;
  } else {
    return null;
  }

  return room;
}

export function getRoom(
  roomId: string
) {
  return rooms.get(roomId) ?? null;
}

export function canStartGame(
  room: RoomState
) {
  return (
    room.guestSocketId !== null &&
    room.hostReady &&
    room.guestReady &&
    room.hostDeckRecipe !== null &&
    room.guestDeckRecipe !== null
  );
}

export function findRoomBySocketId(
  socketId: string
) {
  for (const room of rooms.values()) {
    if (
      room.hostSocketId === socketId ||
      room.guestSocketId === socketId
    ) {
      return room;
    }
  }

  return null;
}

export function removeRoom(
  roomId: string
) {
  rooms.delete(roomId);
}

export function setCommunicationMode(
  roomId: string,
  socketId: string,
  communicationMode: CommunicationMode
) {
  const room = rooms.get(roomId);

  if (!room || room.hostSocketId !== socketId) {
    return null;
  }

  room.communicationMode = communicationMode;
  room.hostReady = false;
  room.guestReady = false;

  return room;
}

export function markMulliganComplete(
  roomId: string,
  socketId: string
) {
  const room = rooms.get(roomId);

  if (!room) {
    return null;
  }

  if (room.hostSocketId === socketId) {
    room.hostMulliganComplete = true;
  } else if (room.guestSocketId === socketId) {
    room.guestMulliganComplete = true;
  } else {
    return null;
  }

  return room;
}

export function leaveRoom(
  roomId: string,
  socketId: string
) {
  const room = rooms.get(roomId);

  if (!room) {
    return null;
  }

  if (room.hostSocketId === socketId) {
    rooms.delete(roomId);

    return {
      room,
      roomRemoved: true,
    };
  }

  if (room.guestSocketId !== socketId) {
    return null;
  }

  room.guestSocketId = null;
  room.guestReady = false;
  room.guestDeckRecipe = null;
  room.guestMulliganComplete = false;
  room.hostReady = false;

  return {
    room,
    roomRemoved: false,
  };
}


export function resetRoomAfterMatch(
  roomId: string
) {
  const room = rooms.get(roomId);

  if (!room) {
    return null;
  }

  room.hostReady = false;
  room.guestReady = false;
  room.hostMulliganComplete = false;
  room.guestMulliganComplete = false;

  return room;
}
