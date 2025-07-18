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
