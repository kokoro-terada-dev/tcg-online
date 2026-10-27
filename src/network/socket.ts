import { io } from "socket.io-client";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL?.trim() ||
  (import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "https://tcg-server-u085.onrender.com");

export const socket = io(
  SERVER_URL,
  {
    transports: ["polling", "websocket"],
    reconnection: true,
    autoConnect: false,
    timeout: 60000,
  }
);

export function connectSocket() {
  if (!socket.connected) {
    socket.connect();
  }
}

export let isHost = false;

export function setHost(
  value: boolean
) {
  isHost = value;
}
