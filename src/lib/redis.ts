import { redis } from "bun";

const ttl = 300;

const key = (roomId: string) => `room:${roomId}`;

export const setRoomData = (roomId: string, data: unknown) =>
  redis.set(key(roomId), JSON.stringify(data)).then(() => redis.expire(key(roomId), ttl));

export const getRoomData = (roomId: string) =>
  redis.get(key(roomId)).then((v) => (v ? JSON.parse(v) : null));

export const delRoomData = (roomId: string) =>
  redis.del(key(roomId));
