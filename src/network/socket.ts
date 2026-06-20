import { io } from "socket.io-client";

const SERVER_URL =
  import.meta.env.DEV
    ? "http://localhost:3000"
    : "https://tcg-server-u085.onrender.com";

export const socket = io(
  SERVER_URL,
  {
    transports: ["polling", "websocket"],
    reconnection: true,
  }
);

export let isHost = false;

export function setHost(
  value: boolean
) {
  isHost = value;
}