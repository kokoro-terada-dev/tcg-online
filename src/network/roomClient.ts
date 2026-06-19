import { socket } from "./socket";

export function createRoom() {
  socket.emit("create-room");
}

export function joinRoom(
  roomId: string
) {
  socket.emit(
    "join-room",
    roomId
  );
}