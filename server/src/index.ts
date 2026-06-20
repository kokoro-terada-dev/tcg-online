import express = require("express");
import type { Request, Response } from "express";
import { createServer } from "http";
import { Server } from "socket.io";

import {
    canStartGame,
    createRoom,
    findRoomBySocketId,
    joinRoom,
    removeRoom,
    resetRoomAfterMatch,
    setDeckRecipe,
    setReady,
} from "./roomManager";

import type {
    DeckRecipeForRoom,
    GameSetupPayload,
    MulliganResultPayload,
    BoardActionPayload,
} from "./types";

const app = express();

app.get("/", (_: Request, res: Response) => {
    res.send("Server Running");
});

const httpServer = createServer(app);

const allowedOrigins = [
    "https://tcg-online-theta.vercel.app",
    "http://localhost:5173",
];

const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
    },
});

io.on("connection", (socket) => {

    socket.emit("welcome", {
        socketId: socket.id,
    });

    socket.on("disconnect", () => {

        const room = findRoomBySocketId(socket.id);

        if (!room) {
            return;
        }

        socket.to(room.roomId).emit(
            "opponent-disconnected"
        );

        io.in(room.roomId).socketsLeave(room.roomId);

        removeRoom(room.roomId);
    });

    socket.on("create-room", () => {
        const room = createRoom(socket.id);

        socket.join(room.roomId);

        socket.emit("room-created", room);
        io.to(room.roomId).emit("room-state", room);
    });

    socket.on(
        "join-room",
        (roomId: string) => {
            const room = joinRoom(
                roomId,
                socket.id
            );

            if (!room) {
                socket.emit("join-failed");
                return;
            }

            socket.join(roomId);

            socket.emit("room-joined", room);
            io.to(roomId).emit("room-state", room);
        }
    );

    socket.on(
        "deck-selected",
        (payload: {
            roomId: string;
            deckRecipe: DeckRecipeForRoom;
        }) => {
            const room = setDeckRecipe(
                payload.roomId,
                socket.id,
                payload.deckRecipe
            );

            if (!room) {
                return;
            }

            io.to(payload.roomId).emit(
                "room-state",
                room
            );
        }
    );

    socket.on(
        "ready",
        (roomId: string) => {
            const room = setReady(
                roomId,
                socket.id
            );

            if (!room) {
                return;
            }

            io.to(roomId).emit(
                "room-state",
                room
            );

            if (canStartGame(room)) {
                io.to(roomId).emit(
                    "both-ready"
                );
            }
        }
    );

    socket.on(
        "game-setup",
        (payload: GameSetupPayload) => {

            socket.to(payload.roomId).emit(
                "game-setup",
                payload.deckOrder
            );
        }
    );

    socket.on(
        "mulligan-result",
        (payload: MulliganResultPayload) => {

            socket.to(payload.roomId).emit(
                "mulligan-result",
                payload
            );
        }
    );

    socket.on(
        "board-action",
        (payload: BoardActionPayload) => {

            socket.to(payload.roomId).emit(
                "board-action",
                payload
            );
        }
    );

    socket.on(
        "match-exit-request",
        (payload: { roomId: string }) => {
            socket.to(payload.roomId).emit(
                "match-exit-request"
            );
        }
    );

    socket.on(
        "match-exit-accepted",
        (payload: { roomId: string }) => {
            const room = resetRoomAfterMatch(
                payload.roomId
            );

            io.to(payload.roomId).emit(
                "match-exit-accepted"
            );

            if (room) {
                io.to(payload.roomId).emit(
                    "room-state",
                    room
                );
            }
        }
    );

    socket.on(
        "match-exit-rejected",
        (payload: { roomId: string }) => {
            socket.to(payload.roomId).emit(
                "match-exit-rejected"
            );
        }
    );
});

const PORT = process.env.PORT || 3000;