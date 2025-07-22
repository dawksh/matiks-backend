import type { ServerWebSocket } from "bun";
import type { UserId } from "./types";
import {  removeFromQueue } from "./matchmaking";
import {
  setRoomData,
  getRoomData,
  delRoomData,
  getUserRoom,
  delUserRoom,
} from "./redis";
import { send, validateConnection } from "./websocket";
import { prisma } from "./prisma";

export const wsToUser = new Map<ServerWebSocket<unknown>, UserId>();
export const userToWs = new Map<UserId, ServerWebSocket<unknown>>();
export const connectionTimestamps = new Map<ServerWebSocket<unknown>, number>();
export const lastHeartbeat = new Map<ServerWebSocket<unknown>, number>();

export const trackConnection = (ws: ServerWebSocket<unknown>, userId: UserId) => {
  wsToUser.set(ws, userId);
  userToWs.set(userId, ws);
  connectionTimestamps.set(ws, Date.now());
  lastHeartbeat.set(ws, Date.now());
};

export const untrackConnection = (ws: ServerWebSocket<unknown>) => {
  const userId = wsToUser.get(ws);
  if (userId) {
    userToWs.delete(userId);
  }
  wsToUser.delete(ws);
  connectionTimestamps.delete(ws);
  lastHeartbeat.delete(ws);
};

export const getValidWebSocket = (userId: UserId): ServerWebSocket<unknown> | null => {
  const ws = userToWs.get(userId);
  return ws && validateConnection(ws) ? ws : null;
};

export const updateHeartbeat = (ws: ServerWebSocket<unknown>) => {
  lastHeartbeat.set(ws, Date.now());
};

export const isConnectionStale = (ws: ServerWebSocket<unknown>, timeoutMs: number = 30000): boolean => {
  const lastBeat = lastHeartbeat.get(ws);
  return lastBeat ? (Date.now() - lastBeat) > timeoutMs : true;
};

export const handleDisconnect = async (ws: ServerWebSocket<unknown>) => {
  const userId = wsToUser.get(ws);
  if (!userId) return;
  
  removeFromQueue(userId);
  untrackConnection(ws);
  
  try {
    const roomId = await getUserRoom(userId);
    if (!roomId) {
      await delUserRoom(userId);
      return;
    }
    
    const data = await getRoomData(roomId);
    if (!data || !data.players) {
      await delUserRoom(userId);
      return;
    }
    
    const players = data.players.filter((p: any) => p.userId !== userId);
    await delUserRoom(userId);
    
    if (players.length === 0) {
      await delRoomData(roomId);
      return;
    }
    
    if (players.length === 1) {
      const winnerId = players[0].userId;
      const wsWinner = [...wsToUser.entries()].find(
        ([w, uid]) => uid === winnerId
      )?.[0];
      
      if (wsWinner && wsWinner.readyState === 1) {
        send(wsWinner, "round-end", {
          results: {
            winner: winnerId,
            scores: data.gameState?.scores || {},
            reason: "opponent_left",
          },
        });
      }
      
      await delRoomData(roomId);
      await delUserRoom(winnerId);
      
      const score = data.gameState?.scores?.[winnerId] || 0;
      const users = await prisma.user.findMany({
        where: { fid: { in: [winnerId, userId] } },
      });
      
      const winner = users.find((u) => u.fid === winnerId);
      if (winner) {
        await prisma.user.update({
          where: { fid: winnerId },
          data: { points: { increment: score } },
        });
        
        await prisma.game.create({
          data: {
            players: { connect: users.map((u: any) => ({ id: u.id })) },
            winner: { connect: { id: winner.id } },
            winnerPoints: score,
            loserPoints: data.gameState?.scores?.[userId] || 0,
          },
        });
      }
    } else {
      await setRoomData(roomId, { ...data, players });
    }
  } catch (error) {
    console.error("Error handling disconnect:", error);
  }
};
