import type { ServerWebSocket } from "bun";
import type { Player, UserId, RoomId } from "./types";
import { send, broadcast } from "./websocket";
import {  READY_TIME, ROUND_TIME_LIMIT, generateQuestion } from "./rooms";
import { wsToUser } from "./connections";
import { setRoomData, getRoomData, delRoomData } from "./redis";

export const queue: Player[] = [];

export const handleMatchmaking = (ws: ServerWebSocket<unknown>, userId: UserId) => {
  if (queue.some(p => p.userId === userId)) {
    send(ws, "error", { message: "Already in queue" });
    return;
  }
  const player: Player = { userId, ws, score: 0 };
  queue.push(player);
  wsToUser.set(ws, userId);
  send(ws, "queue-joined", { position: queue.length });
  if (queue.length >= 2) createMatch();
};

const createMatch = async () => {
  const [p1, p2] = [queue.shift(), queue.shift()];
  if (!p1 || !p2) return;
  const roomId = `room-${Date.now()}`;
  const startTime = Date.now() + READY_TIME;
  const gameState = {
    startTime,
    currentQuestion: generateQuestion(),
    scores: { [p1.userId]: 0, [p2.userId]: 0 },
  };
  await setRoomData(roomId, {
    players: [
      { userId: p1.userId, score: 0 },
      { userId: p2.userId, score: 0 },
    ],
    gameState,
  });
  [p1, p2].forEach((p) => send(p.ws, "match-found", { roomId }));
  broadcast([p1, p2], "room-ready", {
    players: [p1.userId, p2.userId],
    startTime,
  });
  setTimeout(async () => {
    const data = await getRoomData(roomId);
    if (!data || !data.players || !data.gameState) return;
    broadcast(data.players, "game-start", {
      question: data.gameState.currentQuestion,
      timeLeft: ROUND_TIME_LIMIT,
    });
    setTimeout(async () => {
      const d = await getRoomData(roomId);
      if (!d || !d.players || !d.gameState) return;
      const scores = d.gameState.scores;
      const playerScores = Object.entries(scores);
      const maxScore = Math.max(...playerScores.map(([_, score]) => Number(score)));
      const winners = playerScores.filter(([_, score]) => Number(score) === maxScore).map(([userId]) => userId);
      broadcast(d.players, "round-end", {
        results: {
          winner: winners.length > 1 ? "tie" : winners[0],
          scores,
          reason: "time_limit",
        },
      });
      await delRoomData(roomId);
    }, ROUND_TIME_LIMIT);
  }, READY_TIME);
}; 