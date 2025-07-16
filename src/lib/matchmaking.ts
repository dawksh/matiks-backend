import type { ServerWebSocket } from "bun";
import type { Player, UserId, RoomId } from "./types";
import { send, broadcast } from "./websocket";
import { rooms, gameStates, READY_TIME, ROUND_TIME_LIMIT, generateQuestion } from "./rooms";
import { wsToUser } from "./connections";

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

const createMatch = () => {
  const [p1, p2] = [queue.shift(), queue.shift()];
  if (!p1 || !p2) return;
  
  const roomId = `room-${Date.now()}`;
  rooms.set(roomId, [p1, p2]);
  
  const startTime = Date.now() + READY_TIME;
  const gameState = {
    startTime,
    currentQuestion: generateQuestion(),
    scores: new Map([[p1.userId, 0], [p2.userId, 0]]),
    roundTimer: undefined
  };
  gameStates.set(roomId, gameState);

  [p1, p2].forEach(p => send(p.ws, "match-found", { roomId }));
  broadcast([p1, p2], "room-ready", { 
    players: [p1.userId, p2.userId],
    startTime
  });

  setTimeout(() => {
    const room = rooms.get(roomId);
    const gameState = gameStates.get(roomId);
    if (!room || !gameState) return;
    
    broadcast(room, "game-start", {
      question: gameState.currentQuestion,
      timeLeft: ROUND_TIME_LIMIT
    });

    if (gameState.roundTimer) {
      clearTimeout(gameState.roundTimer);
    }

    gameState.roundTimer = setTimeout(() => {
      const currentRoom = rooms.get(roomId);
      const currentState = gameStates.get(roomId);
      if (!currentRoom || !currentState) return;

      const scores = Object.fromEntries(currentState.scores);
      const playerScores = Array.from(currentState.scores.entries());
      const maxScore = Math.max(...playerScores.map(([_, score]) => score));
      const winners = playerScores
        .filter(([_, score]) => score === maxScore)
        .map(([userId]) => userId);

      broadcast(currentRoom, "round-end", {
        results: {
          winner: winners.length > 1 ? "tie" : winners[0],
          scores,
          reason: "time_limit"
        }
      });
      rooms.delete(roomId);
      gameStates.delete(roomId);
    }, ROUND_TIME_LIMIT);
  }, READY_TIME);
}; 