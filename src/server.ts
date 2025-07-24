import { serve } from "bun";
import type { Message } from "./lib/types";
import { handleMatchmaking, startPeriodicCleanup, handleSingleplayer } from "./lib/matchmaking";
import {
  createRoom,
  joinRoom,
  handleGameEvent,
  reconnectUser,
} from "./lib/rooms";
import {
  handleDisconnect,
  trackConnection,
  updateHeartbeat,
} from "./lib/connections";
import { handleUserConnect } from "./lib/user";
import { startConnectionMonitoring } from "./lib/connection-stability";
import Elysia, { t } from "elysia";
import { prisma } from "./lib/prisma";
import cors from "@elysiajs/cors";
import {
  parseWebhookEvent,
  verifyAppKeyWithNeynar,
} from "@farcaster/miniapp-node";
import { setCache, getCache } from "./lib/redis";
import { sendNotification } from "./lib/sendNotification";

const app = new Elysia();

app.use(cors());

app
  .get(
    "/leaderboard",
    async ({
      query,
    }: {
      query: { limit: number; page: number; userId?: string };
    }) => {
      const cacheKey = `leaderboard:${query.limit}:${query.page}`;
      const allUsersKey = `leaderboard:allUsers`;
      const cached = await getCache(cacheKey);
      const cachedAll = await getCache(allUsersKey);
      let users, allUsers;
      if (cached && cachedAll) {
        users = cached;
        allUsers = cachedAll;
      } else {
        users = await prisma.user.findMany({
          orderBy: { points: "desc" },
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        });
        allUsers = await prisma.user.findMany({
          orderBy: { points: "desc" },
          select: {
            id: true,
            fid: true,
            displayName: true,
            username: true,
            profilePictureUrl: true,
            points: true,
          },
        });
        await setCache(cacheKey, users, 5);
        await setCache(allUsersKey, allUsers, 5);
      }
      const usersWithRank = users.map((u: any) => {
        const rank = allUsers.findIndex((x: any) => x.id === u.id) + 1;
        return { ...u, rank };
      });
      let caller = null;
      if (query.userId) {
        const found = allUsers.find((u: any) => u.fid === query.userId);
        if (found) {
          caller = {
            ...found,
            rank: allUsers.findIndex((x: any) => x.id === found.id) + 1,
          };
        }
      }
      return {
        users: usersWithRank,
        total: usersWithRank.length,
        page: query.page,
        caller,
      };
    },
    {
      query: t.Object({
        limit: t.Number({ default: 10 }),
        page: t.Number({ default: 1 }),
        userId: t.Optional(t.String()),
      }),
    }
  )
  .post("/webhook", async ({ body }) => {
    try {
      const data = await parseWebhookEvent(body, verifyAppKeyWithNeynar);
      const { event, fid } = data;
      let token = null;
      switch (event.event) {
        case "frame_added":
          token = event.notificationDetails?.token;
          if (token) {
            const user = await prisma.user.findUnique({
              where: { fid: fid.toString() },
            });
            await sendNotification([token], "you made it!", "daily quizzes heading your way soon", event.notificationDetails?.url!);
            if (user) {
              await prisma.user.update({
                where: { id: user.id },
                data: { notificationToken: token },
              });
            }
          }
          break;
        case "frame_removed":
          await prisma.user.update({
            where: { fid: fid.toString() },
            data: { notificationToken: null },
          });
          break;
        case "notifications_enabled":
          token = event.notificationDetails?.token;
          if (token) {
            const user = await prisma.user.findUnique({
              where: { fid: fid.toString() },
            });
            if (user) {
              await prisma.user.update({
                where: { id: user.id },
                data: { notificationToken: token },
              });
            }
          }
          break;
        case "notifications_disabled":
          await prisma.user.update({
            where: { fid: fid.toString() },
            data: { notificationToken: null },
          });
          break;
      }
    } catch (e) {}
    return { message: "Webhook received" };
  })
  .get("/user", async ({ query }) => {
    const user = await prisma.user.findUnique({
      where: { fid: query.fid.toString() },
      include: {
        gamesWon: true,
        gamesPlayed: true
      }
    });
    const modifiedUser = {
      ...user,
      playtime: user?.gamesPlayed?.length || 0,
      gamesWon: user?.gamesWon?.length || 0,
      gamesPlayed: user?.gamesPlayed?.length || 0,
    }
    return modifiedUser;
  }, {
    query: t.Object({
      fid: t.String(),
    }),
  });

app.listen(8080, () => {
  console.log("App Working on port 8080");
});

startPeriodicCleanup();
startConnectionMonitoring();

serve({
  port: 3000,
  fetch(req, server) {
    if (server.upgrade(req)) {
      return;
    }
    return new Response("Expected WebSocket connection", { status: 426 });
  },
  websocket: {
    open: () => {
      console.log("Client connected");
    },
    message(ws, msg) {
      let data: Message;
      try {
        data = JSON.parse(msg.toString());
      } catch {
        console.error("Invalid JSON message");
        return;
      }

      // Handle heartbeat responses
      if (data.type === "pong") {
        updateHeartbeat(ws);
        return;
      }

      // Track connection for user-related messages
      if (data.userId && data.type !== "ping" && data.type !== "pong") {
        trackConnection(ws, data.userId);
      }

      switch (data.type) {
        case "join-matchmaking":
          if (data.userId) handleMatchmaking(ws, data.userId);
          break;
        case "singleplayer":
          if (data.userId) handleSingleplayer(ws, data.userId);
          break;
        case "create-room":
          if (data.userId) createRoom(ws, data.userId);
          break;
        case "join-room":
          if (data.roomId && data.userId)
            joinRoom(ws, data.userId, data.roomId);
          break;
        case "submit-answer":
          if (
            data.roomId &&
            data.questionId !== undefined &&
            data.answer !== undefined
          ) {
            handleGameEvent(data.type, data.roomId, data);
          }
          break;
        case "game-over":
          if (data.roomId) handleGameEvent(data.type, data.roomId, data);
          break;
        case "register-user":
          handleUserConnect(
            data.fid!,
            data.displayName!,
            data.profilePictureUrl!,
            data.username!
          );
          break;
        case "ping":
          // Respond to client pings
          ws.send(JSON.stringify({ type: "pong", timestamp: data.timestamp }));
          break;
        case "reconnect":
          if (data.userId) reconnectUser(ws, data.userId);
          break;
      }
    },
    close(ws) {
      console.log("Client disconnected");
      handleDisconnect(ws);
    },
  },
});

console.log("Bun WebSocket server running on :3000");
