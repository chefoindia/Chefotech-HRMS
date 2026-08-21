"use strict";

const { Server } = require("socket.io");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const tokens = require("../../modules/auth/tokens");

/**
 * Realtime channel.
 *
 * Used for notification badges, live attendance on the dashboard, and progress
 * on long-running jobs. Every socket is authenticated with the same access
 * token as the REST API and is joined to exactly two rooms:
 *
 *   org:<organizationId>   organization-wide broadcasts
 *   user:<userId>          messages for one person
 *
 * A socket is never joined to another tenant's room, and there is no
 * client-controlled "join" event — which is how a realtime layer usually ends
 * up being the hole in an otherwise well-isolated system.
 */

let io = null;

function attach(server) {
  io = new Server(server, {
    cors: { origin: env.cors.origins, credentials: true },
    path: "/realtime",
    serveClient: false,
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        (socket.handshake.headers.authorization || "").replace(/^Bearer /, "");

      if (!token) return next(new Error("unauthenticated"));

      const payload = tokens.verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.organizationId = payload.org;
      socket.data.isPlatformUser = Boolean(payload.plt);
      return next();
    } catch (err) {
      return next(new Error("unauthenticated"));
    }
  });

  io.on("connection", (socket) => {
    const { userId, organizationId } = socket.data;

    socket.join(`user:${userId}`);
    if (organizationId) socket.join(`org:${organizationId}`);

    logger.debug({ userId, organizationId, socketId: socket.id }, "Realtime client connected");

    // Deliberately no generic "join" handler: rooms are assigned from the
    // verified token, never requested by the client.
    socket.on("ping:check", (ack) => {
      if (typeof ack === "function") ack({ ok: true, at: Date.now() });
    });

    socket.on("disconnect", (reason) => {
      logger.debug({ userId, socketId: socket.id, reason }, "Realtime client disconnected");
    });
  });

  // The notification service pushes through this interface rather than
  // importing socket.io itself.
  require("../../modules/notifications/notification.service").setRealtime({
    toUser,
    toOrganization,
  });

  logger.info("Realtime server attached at /realtime");
  return io;
}

function toUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function toOrganization(organizationId, event, payload) {
  if (!io) return;
  io.to(`org:${organizationId}`).emit(event, payload);
}

function connectionCount() {
  return io ? io.engine.clientsCount : 0;
}

async function close() {
  if (!io) return;
  await new Promise((resolve) => io.close(resolve));
  io = null;
}

module.exports = { attach, toUser, toOrganization, connectionCount, close };
