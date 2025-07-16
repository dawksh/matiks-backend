import type { ServerWebSocket } from "bun";
import type { Player, UserId, RoomId } from "./types";
import { send, broadcast } from "./websocket";
import { rooms, gameStates, READY_TIME, ROUND_TIME_LIMIT } from "./rooms";
import { wsToUser } from "./connections";

export const queue: Player[] = [];

const generateQuestions = (count: number) => {
  const questions = new Map();
  for (let i = 0; i < count; i++) {
    const a = Math.floor(Math.random() * 100);
    const b = Math.floor(Math.random() * 100);
    const id = Math.random().toString(36).slice(2, 8);
    questions.set(id, { id, question: `${a} + ${b}`, answer: a + b });
  }
  return questions;
};

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
    questions: new Map(),
    scores: new Map([[p1.userId, 0], [p2.userId, 0]]),
    currentQuestionIndex: 0
  };
  gameStates.set(roomId, gameState);

  [p1, p2].forEach(p => send(p.ws, "match-found", { roomId }));
  broadcast([p1, p2], "room-ready", { 
    players: [p1.userId, p2.userId],
    startTime
  });

  setTimeout(() => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const gameState = gameStates.get(roomId);
    if (!gameState) return;
    
    gameState.questions = generateQuestions(5);
    const questions = Array.from(gameState.questions.values());
    
    broadcast(room, "game-start", {
      question: questions[0],
      timeLeft: ROUND_TIME_LIMIT
    });
  }, READY_TIME);
}; 