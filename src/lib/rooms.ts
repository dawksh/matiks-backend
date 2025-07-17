import type { ServerWebSocket } from "bun";
import type {
  Player,
  UserId,
  RoomId,
  GameState,
  Question,
} from "./types";
import { send, broadcast } from "./websocket";
import { wsToUser } from "./connections";
import { setRoomData, getRoomData, delRoomData } from "./redis";

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

export const createRoom = async (ws: ServerWebSocket<unknown>, userId: UserId) => {
  const roomId = `room-${Math.random().toString(36).slice(2, 8)}`;
  const player = { userId, ws, score: 0 };
  await setRoomData(roomId, { players: [player], gameState: null });
  wsToUser.set(ws, userId);
  send(ws, "create-room", { roomId });
  send(ws, "room-ready", { players: [userId] });
};

export const joinRoom = async (
  ws: ServerWebSocket<unknown>,
  userId: UserId,
  roomId: RoomId
) => {
  const data = await getRoomData(roomId);
  if (!data || !data.players) {
    send(ws, "error", { message: "Room not found" });
    return;
  }
  if (data.players.length >= 2) {
    send(ws, "error", { message: "Room full" });
    return;
  }
  if (data.players.some((p: any) => p.userId === userId)) {
    send(ws, "error", { message: "Already in room" });
    return;
  }
  const player = { userId, ws, score: 0 };
  const players = [...data.players, player];
  wsToUser.set(ws, userId);
  const startTime = Date.now() + 3000;
  const gameState = {
    startTime,
    currentQuestion: generateQuestion(),
    scores: Object.fromEntries(players.map((p: any) => [p.userId, 0])),
  };
  await setRoomData(roomId, { players: players.map((p: any) => ({ userId: p.userId, score: p.score })), gameState });
  broadcast(players, "room-ready", {
    players: players.map((p: any) => p.userId),
    startTime,
  });
  setTimeout(() => startGame(roomId), 3000);
};

const startGame = async (roomId: RoomId) => {
  const data = await getRoomData(roomId);
  if (!data || !data.players || !data.gameState) return;
  const players = data.players.map((p: any) => ({ ...p, ws: undefined }));
  const nextQuestion = generateQuestion();
  const gameState = {
    ...data.gameState,
    currentQuestion: nextQuestion,
  };
  await setRoomData(roomId, { players, gameState });
  broadcast(players, "game-start", {
    question: nextQuestion,
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
};

export const handleUserLeave = async (ws: ServerWebSocket<unknown>) => {
  const userId = wsToUser.get(ws);
  if (!userId) return;
  // Redis does not support wildcard get, so this needs a list of roomIds from somewhere. For now, skip loop.
  wsToUser.delete(ws);
};

export const handleGameEvent = async (type: string, roomId: RoomId, data: any) => {
  const d = await getRoomData(roomId);
  if (!d || !d.players || !d.gameState) return;
  if (type === "submit-answer") {
    const { userId, answer } = data;
    const question = d.gameState.currentQuestion;
    const isCorrect = question && question.answer === answer;
    if (isCorrect) d.gameState.scores[userId] = (d.gameState.scores[userId] || 0) + 1;
    broadcast(d.players, "point-update", { userId, scores: d.gameState.scores });
    broadcast(d.players, "answer-result", { userId, questionId: question.id, correct: isCorrect });
    const nextQuestion = generateQuestion();
    d.gameState.currentQuestion = nextQuestion;
    await setRoomData(roomId, { players: d.players, gameState: d.gameState });
    broadcast(d.players, "next-question", { question: nextQuestion });
  } else {
    broadcast(d.players, type, data);
  }
};
