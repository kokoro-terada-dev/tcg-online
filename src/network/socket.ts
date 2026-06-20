import { io } from "socket.io-client";

export const socket = io(
  "http://localhost:3000",
  {
    transports: ["websocket"],
  }
);

export let currentRoomId: string | null = null;

export let isHost = false;

export function setRoomId(
  roomId: string
) {
  currentRoomId = roomId;
}

export function setHost(
  value: boolean
) {
  isHost = value;
}