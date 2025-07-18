import type { ServerWebSocket } from "bun";
import type { UserId } from "./types";
import { queue } from "./matchmaking";
import {
  setRoomData,
  getRoomData,
  delRoomData,
  getUserRoom,
  delUserRoom,
} from "./redis";
import { send } from "./websocket";
import { prisma } from "./prisma";

export const wsToUser = new Map<ServerWebSocket<unknown>, UserId>();

export const handleDisconnect = async (ws: ServerWebSocket<unknown>) => {
  console.log(ws)
  const userId = wsToUser.get(ws);
  if (!userId) return;
  const queueIdx = queue.findIndex((p) => p.userId === userId);
  if (queueIdx !== -1) queue.splice(queueIdx, 1);
  const roomId = await getUserRoom(userId);
  if (!roomId) {
    wsToUser.delete(ws);
    await delUserRoom(userId);
    return;
  }
  const data = await getRoomData(roomId);
  console.log(data);
  if (!data || !data.players) {
    wsToUser.delete(ws);
    await delUserRoom(userId);
    return;
  }
  const players = data.players.filter((p: any) => p.userId !== userId);
  wsToUser.delete(ws);
  await delUserRoom(userId);
  if (players.length === 1) {
    const winnerId = players[0].userId;
    const wsWinner = [...wsToUser.entries()].find(
      ([w, uid]) => uid === winnerId
    )?.[0];
    if (wsWinner) {
      send(wsWinner, "round-end", {
        results: {
          winner: winnerId,
          scores: data.gameState?.scores || {},
          reason: "opponent_left",
        },
      });
      await delRoomData(roomId);
      await delUserRoom(winnerId);
    }
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
        },
      });
    }
  } else {
    await setRoomData(roomId, { ...data, players });
  }
};
