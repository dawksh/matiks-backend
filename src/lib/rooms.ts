import type { ServerWebSocket } from "bun";
import type {
  Player,
  UserId,
  RoomId,
  GameState,
  Question,
  QuestionId,
} from "./types";
import { send, broadcast } from "./websocket";
import { wsToUser } from "./connections";

export const rooms = new Map<RoomId, Player[]>();
export const gameStates = new Map<RoomId, GameState>();

const generateQuestion = (): Question => {
  const a = Math.floor(Math.random() * 100);
  const b = Math.floor(Math.random() * 100);
  const id = Math.random().toString(36).slice(2, 8);
  return { id, question: `${a} + ${b}`, answer: a + b };
};

const generateQuestions = (count: number): Map<QuestionId, Question> => {
  const questions = new Map();
  for (let i = 0; i < count; i++) {
    const q = generateQuestion();
    questions.set(q.id, q);
  }
  return questions;
};

export const createRoom = (ws: ServerWebSocket<unknown>, userId: UserId) => {
  const roomId = `room-${Math.random().toString(36).slice(2, 8)}`;
  const player: Player = { userId, ws, score: 0 };
  rooms.set(roomId, [player]);
  wsToUser.set(ws, userId);
  send(ws, "create-room", { roomId });
  send(ws, "room-ready", { players: [userId] });
};

export const joinRoom = (
  ws: ServerWebSocket<unknown>,
  userId: UserId,
  roomId: RoomId
) => {
  const room = rooms.get(roomId);
  if (!room) {
    send(ws, "error", { message: "Room not found" });
    return;
  }
  if (room.length >= 2) {
    send(ws, "error", { message: "Room full" });
    return;
  }
  if (room.some((p) => p.userId === userId)) {
    send(ws, "error", { message: "Already in room" });
    return;
  }

  const player: Player = { userId, ws, score: 0 };
  room.push(player);
  wsToUser.set(ws, userId);

  const startTime = Date.now() + 3000;
  const gameState: GameState = {
    startTime,
    questions: generateQuestions(5),
    scores: new Map(room.map((p) => [p.userId, 0])),
  };
  gameStates.set(roomId, gameState);

  broadcast(room, "room-ready", {
    players: room.map((p) => p.userId),
    startTime,
  });

  setTimeout(() => startGame(roomId), 3000);
};

const startGame = (roomId: RoomId) => {
  const room = rooms.get(roomId);
  const gameState = gameStates.get(roomId);
  if (!room || !gameState) return;

  const questions = Array.from(gameState.questions.values());
  broadcast(room, "game-start", { questions });
};

export const handleUserLeave = (ws: ServerWebSocket<unknown>) => {
  const userId = wsToUser.get(ws);
  if (!userId) return;

  for (const [roomId, players] of rooms.entries()) {
    const playerIndex = players.findIndex((p) => p.userId === userId);
    if (playerIndex !== -1) {
      const remainingPlayer = players[playerIndex === 0 ? 1 : 0];
      if (remainingPlayer) {
        broadcast(players, "game-over", {
          results: {
            winner: remainingPlayer.userId,
            reason: "opponent_left",
            scores: Object.fromEntries(gameStates.get(roomId)?.scores || []),
          },
        });
      }
      rooms.delete(roomId);
      gameStates.delete(roomId);
      break;
    }
  }
  wsToUser.delete(ws);
};

export const handleGameEvent = (type: string, roomId: RoomId, data: any) => {
  const room = rooms.get(roomId);
  const gameState = gameStates.get(roomId);
  if (!room || !gameState) return;

  if (type === "submit-answer") {
    const { userId, questionId, answer } = data;
    const question = gameState.questions.get(questionId);
    if (question && question.answer === answer) {
      gameState.scores.set(userId, (gameState.scores.get(userId) || 0) + 1);
      broadcast(room, "answer-result", {
        userId,
        questionId,
        correct: true,
        scores: Object.fromEntries(gameState.scores),
      });
    }

    if (
      Array.from(gameState.scores.values()).reduce((a, b) => a + b) ===
      gameState.questions.size
    ) {
      const scores = Object.fromEntries(gameState.scores);
      const winner = Array.from(gameState.scores.entries()).reduce((a, b) =>
        a[1] > b[1] ? a : b
      )[0];

      broadcast(room, "game-over", {
        results: {
          winner,
          scores,
          reason: "game_complete",
        },
      });
      rooms.delete(roomId);
      gameStates.delete(roomId);
    }
  } else {
    broadcast(room, type, data);
  }
};
