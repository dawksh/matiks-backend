import { createClient } from "redis";

const ttl = 300;
const key = (roomId: string) => `room:${roomId}`;

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

export const setRoomData = async (roomId: string, data: unknown) => {
  await client.set(key(roomId), JSON.stringify(data), { EX: ttl });
};

export const getRoomData = async (roomId: string) => {
  const v = await client.get(key(roomId));
  return v ? JSON.parse(v) : null;
};

export const delRoomData = async (roomId: string) => {
  await client.del(key(roomId));
};

export const setUserRoom = async (userId: string, roomId: string) => {
  await client.set(`user-room:${userId}`, roomId, { EX: ttl });
};

export const getUserRoom = async (userId: string) => {
  return client.get(`user-room:${userId}`);
};

export const delUserRoom = async (userId: string) => {
  await client.del(`user-room:${userId}`);
};

export const setCache = async (key: string, data: unknown, ttlOverride?: number) => {
  await client.set(key, JSON.stringify(data), { EX: ttlOverride ?? ttl });
};

export const getCache = async (key: string) => {
  const v = await client.get(key);
  return v ? JSON.parse(v) : null;
};

// Redis queue helpers for matchmaking
const MATCHMAKING_QUEUE_KEY = "matchmaking-queue";

export const enqueuePlayer = async (userId: string, score: number = 0) => {
  await client.rPush(MATCHMAKING_QUEUE_KEY, JSON.stringify({ userId, score }));
};

export const dequeuePlayers = async (count: number) => {
  const players = await client.lRange(MATCHMAKING_QUEUE_KEY, 0, count - 1);
  if (players.length > 0) {
    await client.lTrim(MATCHMAKING_QUEUE_KEY, players.length, -1);
  }
  return players.map((p) => JSON.parse(p));
};

export const removePlayerFromQueue = async (userId: string) => {
  const all = await client.lRange(MATCHMAKING_QUEUE_KEY, 0, -1);
  for (const p of all) {
    const obj = JSON.parse(p);
    if (obj.userId === userId) {
      await client.lRem(MATCHMAKING_QUEUE_KEY, 1, p);
      break;
    }
  }
};

export const getAllQueuedPlayers = async () => {
  const all = await client.lRange(MATCHMAKING_QUEUE_KEY, 0, -1);
  return all.map((p) => JSON.parse(p));
};

const POINTS_QUEUE_KEY = "points-queue"

export const addToPointsQueue = async (batch: {userId: string, points: number}[]) => {
  await client.rPush(POINTS_QUEUE_KEY, JSON.stringify(batch));
};

export const getNextPointsBatch = async () => {
  const batch = await client.lPop(POINTS_QUEUE_KEY);
  return batch ? JSON.parse(batch) : null;
}