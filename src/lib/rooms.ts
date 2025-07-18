import type { ServerWebSocket } from "bun";
import type { UserId, RoomId, Question } from "./types";
import { send, broadcast } from "./websocket";
import { wsToUser } from "./connections";
import {
  setRoomData,
  getRoomData,
  delRoomData,
  setUserRoom,
  getUserRoom,
  delUserRoom,
} from "./redis";
import { prisma } from "./prisma";

export const ROUND_TIME_LIMIT = 60000;
export const READY_TIME = 10000;

export const generateQuestion = (): Question => {
  const opType = ["+", "-", "*", "/"][Math.floor(Math.random() * 4)];
  let a = 0,
    b = 0,
    question = "",
    answer = 0;

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

export const createRoom = async (
  ws: ServerWebSocket<unknown>,
  userId: UserId
) => {
  const roomId = `room-${Math.random().toString(36).slice(2, 8)}`;
  const player = { userId, ws, score: 0 };
  await setRoomData(roomId, { players: [player], gameState: null });
  await setUserRoom(userId, roomId);
  wsToUser.set(ws, userId);
  send(ws, "create-room", { roomId });
  send(ws, "room-ready", { players: [userId] });
};

export const createRoomWithPlayers = async (
  players: { userId: UserId; ws: ServerWebSocket<unknown> }[]
) => {
  const roomId = `room-${Math.random().toString(36).slice(2, 8)}`;
  const playerObjs = players.map((p) => ({
    userId: p.userId,
    ws: p.ws,
    score: 0,
  }));
  await Promise.all(playerObjs.map((p) => setUserRoom(p.userId, roomId)));
  playerObjs.forEach((p) => wsToUser.set(p.ws, p.userId));
  const startTime = Date.now() + READY_TIME;
  const gameState = {
    startTime,
    currentQuestion: generateQuestion(),
    scores: Object.fromEntries(playerObjs.map((p) => [p.userId, 0])),
  };
  await setRoomData(roomId, {
    players: playerObjs.map((p) => ({ userId: p.userId, score: p.score })),
    gameState,
  });
  playerObjs.forEach((p) => send(p.ws, "match-found", { roomId }));
  playerObjs.forEach((p) => send(p.ws, "create-room", { roomId }));
  broadcast(playerObjs, "room-ready", {
    players: playerObjs.map((p) => p.userId),
    startTime,
  });
  setTimeout(() => startGame(roomId), READY_TIME);
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
  await setUserRoom(userId, roomId);
  const startTime = Date.now() + READY_TIME;
  const gameState = {
    startTime,
    currentQuestion: generateQuestion(),
    scores: Object.fromEntries(players.map((p: any) => [p.userId, 0])),
  };
  await setRoomData(roomId, {
    players: players.map((p: any) => ({ userId: p.userId, score: p.score })),
    gameState,
  });
  broadcast(players, "room-ready", {
    players: players.map((p: any) => p.userId),
    startTime,
  });
  setTimeout(() => startGame(roomId), READY_TIME);
};

const startGame = async (roomId: RoomId) => {
  const data = await getRoomData(roomId);
  if (!data || !data.players || !data.gameState) return;
  const players = data.players
    .map((p: any) => {
      const ws = [...wsToUser.entries()].find(
        ([ws, userId]) => userId === p.userId
      )?.[0];
      return ws ? { ...p, ws } : null;
    })
    .filter(Boolean);
  const nextQuestion = generateQuestion();
  const gameState = {
    ...data.gameState,
    currentQuestion: nextQuestion,
  };
  await setRoomData(roomId, { players: data.players, gameState });
  broadcast(players, "game-start", {
    question: nextQuestion,
    timeLeft: ROUND_TIME_LIMIT,
  });
  setTimeout(async () => {
    const d = await getRoomData(roomId);
    if (!d || !d.players || !d.gameState) return;
    const scores = d.gameState.scores;
    const playerScores = Object.entries(scores);
    const maxScore = Math.max(
      ...playerScores.map(([_, score]) => Number(score))
    );
    const winners = playerScores
      .filter(([_, score]) => Number(score) === maxScore)
      .map(([userId]) => userId);
    const loser = playerScores.find(
      ([_, score]) => Number(score) !== maxScore
    )?.[0];
    broadcast(players, "round-end", {
      results: {
        winner: winners.length > 1 ? "tie" : winners[0],
        scores,
        reason: "time_limit",
      },
    });
    await delRoomData(roomId);
    const userIds = players.map((p: any) => p.userId);
    const users = await prisma.user.findMany({
      where: { fid: { in: userIds } },
    });
    if (users.length !== userIds.length) {
      console.log(users, userIds);
      return;
    } // or handle error
    if (!users.find((u) => u.fid === winners[0])) return; // or handle error
    userIds.forEach(async (userId: string) => {
      await prisma.user.update({
        where: { fid: userId },
        data: {
          points: { increment: scores[userId] },
        },
      });
    });
    await prisma.game.create({
      data: {
        players: { connect: users.map((u: any) => ({ id: u.id })) },
        winner: {
          connect: { id: users.find((u) => u.fid === winners[0])?.id },
        },
        winnerPoints: maxScore,
        loserPoints: loser ? scores[loser] : 0,
      },
    });
  }, ROUND_TIME_LIMIT);
};

export const handleGameEvent = async (
  type: string,
  roomId: RoomId,
  data: any
) => {
  const d = await getRoomData(roomId);
  if (!d || !d.players || !d.gameState) return;
  if (type === "submit-answer") {
    const { userId, answer } = data;
    const question = d.gameState.currentQuestion;
    const isCorrect = question && question.answer === answer;
    if (!isCorrect) return;

    d.gameState.scores[userId] = (d.gameState.scores[userId] || 0) + 1;
    d.players = d.players.map((p: any) =>
      p.userId === userId ? { ...p, score: d.gameState.scores[userId] } : p
    );
    const playersWithWs = d.players
      .map((p: { userId: string; score: number }) => ({
        ...p,
        ws: [...wsToUser.entries()].find(([ws, uid]) => uid === p.userId)?.[0],
      }))
      .filter((p: any) => p.ws);
    broadcast(playersWithWs, "point-update", {
      userId,
      scores: d.gameState.scores,
    });
    broadcast(playersWithWs, "answer-result", {
      userId,
      questionId: question.id,
      correct: isCorrect,
    });
    const nextQuestion = generateQuestion();
    d.gameState.currentQuestion = nextQuestion;
    await setRoomData(roomId, { players: d.players, gameState: d.gameState });
    broadcast(playersWithWs, "next-question", { question: nextQuestion });
  } else {
    const playersWithWs = d.players
      .map((p: { userId: string; score: number }) => ({
        ...p,
        ws: [...wsToUser.entries()].find(([ws, uid]) => uid === p.userId)?.[0],
      }))
      .filter((p: any) => p.ws);
    broadcast(playersWithWs, type, data);
  }
};
