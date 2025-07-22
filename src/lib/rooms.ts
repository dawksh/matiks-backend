import type { ServerWebSocket } from "bun";
import type { UserId, RoomId, Question } from "./types";
import { send, broadcast } from "./websocket";
import { wsToUser, trackConnection, getValidWebSocket } from "./connections";
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
  const roomId = `room-${userId}`;
  const player = { userId, ws, score: 0 };
  await setRoomData(roomId, { players: [player], gameState: null });
  await setUserRoom(userId, roomId);
  trackConnection(ws, userId);
  send(ws, "create-room", { roomId });
  send(ws, "waiting-for-player", { roomId });
};

export const createRoomWithPlayers = async (
  players: { userId: UserId; ws: ServerWebSocket<unknown> }[],
  preRoomId?: string
) => {
  const roomId = preRoomId || `room-${Math.random().toString(36).slice(2, 8)}`;
  const playerObjs = players.map((p) => ({
    userId: p.userId,
    ws: p.ws,
    score: 0,
  }));
  
  const validPlayers = playerObjs.filter((p) => p.ws.readyState === 1);
  if (validPlayers.length !== playerObjs.length) {
    throw new Error("Some players have invalid WebSocket connections");
  }
  
  try {
    await Promise.all(playerObjs.map((p) => setUserRoom(p.userId, roomId)));
    playerObjs.forEach((p) => trackConnection(p.ws, p.userId));
    
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
    if(!preRoomId) {
      playerObjs.forEach((p) => send(p.ws, "create-room", { roomId }));
    }
    broadcast(playerObjs, "room-ready", {
      players: playerObjs.map((p) => p.userId),
      startTime,
    });
    
    setTimeout(() => startGame(roomId), READY_TIME);
  } catch (error) {
    console.error("Failed to create room with players:", error);
    throw error;
  }
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
  const players = [
    ...data.players.map((p: any) => ({ userId: p.userId, ws: [...wsToUser.entries()].find(([ws, uid]) => uid === p.userId)?.[0] })),
    { userId, ws }
  ];
  await createRoomWithPlayers(players, roomId);
};

export const reconnectUser = async (ws: ServerWebSocket<unknown>, userId: UserId) => {
  const roomId = await getUserRoom(userId);
  if (!roomId) return;
  const data = await getRoomData(roomId);
  if (!data || !data.players) return;
  const playerIdx = data.players.findIndex((p: any) => p.userId === userId);
  if (playerIdx === -1) return;
  trackConnection(ws, userId);
  const players = data.players.map((p: any, i: number) => i === playerIdx ? { ...p, ws } : { ...p, ws: [...wsToUser.entries()].find(([w, uid]) => uid === p.userId)?.[0] });
  if (players.length === 1) {
    send(ws, "waiting-for-player", { roomId });
    return;
  }
  if (players.length === 2) {
    const readyPlayers = players.filter((p: any) => p.ws && p.ws.readyState === 1);
    broadcast(readyPlayers, "room-ready", { players: readyPlayers.map((p: any) => p.userId), startTime: data.gameState?.startTime });
    if (data.gameState && Date.now() >= data.gameState.startTime) {
      send(ws, "game-start", { question: data.gameState.currentQuestion, timeLeft: Math.max(0, ROUND_TIME_LIMIT - (Date.now() - data.gameState.startTime)) });
    }
  }
};

const startGame = async (roomId: RoomId) => {
  try {
    const data = await getRoomData(roomId);
    if (!data || !data.players || !data.gameState) {
      console.log("Room data not found or invalid for game start:", roomId);
      return;
    }
    
    const players = data.players
      .map((p: any) => {
        const ws = [...wsToUser.entries()].find(
          ([ws, userId]) => userId === p.userId
        )?.[0];
        return ws && ws.readyState === 1 ? { ...p, ws } : null;
      })
      .filter(Boolean);
    
    if (players.length < 2) {
      console.log("Not enough valid players to start game:", roomId);
      await delRoomData(roomId);
      return;
    }
    
    const initQuestion = generateQuestion();
    const gameState = {
      ...data.gameState,
      currentQuestion: initQuestion,
    };
    
    await setRoomData(roomId, { players: data.players, gameState });
    broadcast(players, "game-start", {
      question: initQuestion,
      timeLeft: ROUND_TIME_LIMIT,
    });
    
    setTimeout(async () => {
      try {
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
        
        const validPlayers = players.filter((p: any) => p.ws.readyState === 1);
        broadcast(validPlayers, "round-end", {
          results: {
            winner: winners.length > 1 ? "tie" : winners[0],
            scores,
            reason: "time_limit",
          },
        });
        
        await delRoomData(roomId);
        const userIds = players.map((p: any) => p.userId);
        
        const realUserIds = userIds.filter((id: string) => id !== "formula-bot");
        const users = await prisma.user.findMany({
          where: { fid: { in: realUserIds } },
        });
        if (users.length !== realUserIds.length) {
          console.log("User data mismatch:", users, realUserIds);
          return;
        }
        if (!users.find((u) => u.fid === winners[0])) {
          console.log("Winner not found in database:", winners[0]);
          return;
        }
        await Promise.all(realUserIds.map(async (userId: string) => {
          await prisma.user.update({
            where: { fid: userId },
            data: {
              points: { increment: scores[userId] },
            },
          });
        }));
        await prisma.game.create({
          data: {
            players: { connect: users.map((u: any) => ({ id: u.id })) },
            winner: {
              connect: { id: users.find((u) => u.fid === winners[0])?.id },
            },
            winnerPoints: maxScore,
            loserPoints: loser && loser !== "formula-bot" ? scores[loser] : 0,
          },
        });
      } catch (error) {
        console.error("Error in round end:", error);
      }
    }, ROUND_TIME_LIMIT);
  } catch (error) {
    console.error("Error starting game:", error);
  }
};

export const handleGameEvent = async (
  type: string,
  roomId: RoomId,
  data: any
) => {
  try {
    const d = await getRoomData(roomId);
    if (!d || !d.players || !d.gameState) {
      console.log("Invalid room data for game event:", roomId);
      return;
    }
    
    const playersWithWs = d.players
      .map((p: { userId: string; score: number }) => ({
        ...p,
        ws: [...wsToUser.entries()].find(([ws, uid]) => uid === p.userId)?.[0],
      }))
      .filter((p: any) => p.ws && p.ws.readyState === 1);
    
    if (type === "submit-answer") {
      const { userId, answer } = data;
      const question = d.gameState.currentQuestion;
      const isCorrect = question && question.answer === answer;
      
      if (!isCorrect) return;
      
      d.gameState.scores[userId] = (d.gameState.scores[userId] || 0) + 1;
      d.players = d.players.map((p: any) =>
        p.userId === userId ? { ...p, score: d.gameState.scores[userId] } : p
      );
      
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
      broadcast(playersWithWs, type, data);
    }
  } catch (error) {
    console.error("Error handling game event:", error);
  }
};
