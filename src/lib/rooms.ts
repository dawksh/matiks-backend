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
export const ROUND_TIME_LIMIT = 30000;
export const READY_TIME = 5000;

export const generateQuestion = (): Question => {
  const opType = ["+", "-", "*", "/"][Math.floor(Math.random() * 4)];
  let a = 0, b = 0, question = "", answer = 0;

  if (opType === "+") {
    a = Math.floor(Math.random() * 150);
    b = Math.floor(Math.random() * 150);
    question = `${a} + ${b}`;
    answer = a + b;
  } else if (opType === "-") {
    a = Math.floor(Math.random() * 100);
    b = Math.floor(Math.random() * 100);
    if (a < b) [a, b] = [b, a];
    question = `${a} - ${b}`;
    answer = a - b;
  } else if (opType === "*") {
    if (Math.random() < 0.5) {
      a = Math.floor(Math.random() * 10);
      b = Math.floor(Math.random() * 10);
    } else {
      a = Math.floor(Math.random() * 40) + 10;
      b = Math.floor(Math.random() * 10);
      if (Math.random() < 0.5) [a, b] = [b, a];
    }
    question = `${a} * ${b}`;
    answer = a * b;
  } else if (opType === "/") {
    b = Math.floor(Math.random() * 9) + 1;
    answer = Math.floor(Math.random() * 10) + 1;
    a = b * answer;
    question = `${a} / ${b}`;
  }

  const id = Math.random().toString(36).slice(2, 8);
  return { id, question, answer };
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
    currentQuestion: generateQuestion(),
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

  const nextQuestion = generateQuestion();
  gameState.currentQuestion = nextQuestion;
  
  broadcast(room, "game-start", { 
    question: nextQuestion,
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
};

export const handleUserLeave = (ws: ServerWebSocket<unknown>) => {
  const userId = wsToUser.get(ws);
  if (!userId) return;

  for (const [roomId, players] of rooms.entries()) {
    const playerIndex = players.findIndex((p) => p.userId === userId);
    if (playerIndex !== -1) {
      const remainingPlayer = players[playerIndex === 0 ? 1 : 0];
      const gameState = gameStates.get(roomId);
      
      if (gameState?.roundTimer) {
        clearTimeout(gameState.roundTimer);
      }
      
      if (remainingPlayer) {
        broadcast(players, "round-end", {
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
    const { userId, answer } = data;
    const question = gameState.currentQuestion;
    const isCorrect = question && question.answer === answer;
    
    if (isCorrect) {
      gameState.scores.set(userId, (gameState.scores.get(userId) || 0) + 1);
      broadcast(room, "point-update", {
        userId,
        scores: Object.fromEntries(gameState.scores)
      });
    }

    broadcast(room, "answer-result", {
      userId,
      questionId: question.id,
      correct: isCorrect
    });

    const nextQuestion = generateQuestion();
    gameState.currentQuestion = nextQuestion;
    broadcast(room, "next-question", {
      question: nextQuestion
    });
  } else {
    broadcast(room, type, data);
  }
};
