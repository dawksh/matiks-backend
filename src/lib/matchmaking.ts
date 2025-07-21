import type { ServerWebSocket } from "bun";
import type { Player, UserId } from "./types";
import { send } from "./websocket";
import { createRoomWithPlayers } from "./rooms";
import { wsToUser } from "./connections";
import { enqueuePlayer, dequeuePlayers, removePlayerFromQueue, getAllQueuedPlayers } from "./redis";

export const handleMatchmaking = async (
  ws: ServerWebSocket<unknown>,
  userId: UserId
) => {
  const all = await getAllQueuedPlayers();
  if (all.some((p) => p.userId === userId)) {
    send(ws, "error", { message: "Already in queue" });
    return;
  }
  if (ws.readyState !== 1) {
    send(ws, "error", { message: "WebSocket not ready" });
    return;
  }
  await enqueuePlayer(userId, 0);
  wsToUser.set(ws, userId);
  const position = (await getAllQueuedPlayers()).findIndex((p) => p.userId === userId) + 1;
  send(ws, "queue-joined", { position });
  if ((await getAllQueuedPlayers()).length >= 2) {
    createMatch();
  }
};

export const removeFromQueue = async (userId: UserId) => {
  await removePlayerFromQueue(userId);
};

export const cleanupQueue = async () => {
  // Remove players whose ws is not open
  const all = await getAllQueuedPlayers();
  let removed = 0;
  for (const p of all) {
    const ws = [...wsToUser.entries()].find(([, id]) => id === p.userId)?.[0];
    if (!ws || ws.readyState !== 1) {
      await removePlayerFromQueue(p.userId);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`Cleaned up ${removed} stale connections from queue`);
  }
};

export const startPeriodicCleanup = () => {
  setInterval(() => {
    cleanupQueue();
  }, 15000);
};

const createMatch = async () => {
  await cleanupQueue();
  const all = await getAllQueuedPlayers();
  if (all.length < 2) return;
  const players = await dequeuePlayers(2);
  if (players.length < 2) return;
  const [p1, p2] = players;
  const ws1 = [...wsToUser.entries()].find(([, id]) => id === p1.userId)?.[0];
  const ws2 = [...wsToUser.entries()].find(([, id]) => id === p2.userId)?.[0];
  if (!ws1 || ws1.readyState !== 1) {
    if (ws2 && ws2.readyState === 1) await enqueuePlayer(p2.userId, p2.score);
    return;
  }
  if (!ws2 || ws2.readyState !== 1) {
    if (ws1 && ws1.readyState === 1) await enqueuePlayer(p1.userId, p1.score);
    return;
  }
  try {
    await createRoomWithPlayers([
      { userId: p1.userId, ws: ws1 },
      { userId: p2.userId, ws: ws2 },
    ]);
  } catch (error) {
    console.error("Failed to create match:", error);
    if (ws1 && ws1.readyState === 1) {
      await enqueuePlayer(p1.userId, p1.score);
      send(ws1, "error", { message: "Failed to create match" });
    }
    if (ws2 && ws2.readyState === 1) {
      await enqueuePlayer(p2.userId, p2.score);
      send(ws2, "error", { message: "Failed to create match" });
    }
  }
};
