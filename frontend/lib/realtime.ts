"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { BASE_URL, tokens } from "./api";

/**
 * The realtime channel.
 *
 * One socket per browser tab, shared by every subscriber. The server decides
 * which rooms a socket joins from the verified token — the client cannot ask
 * to join a room, which is what stops the realtime layer becoming the hole in
 * an otherwise well-isolated multi-tenant system.
 *
 * Everything degrades gracefully: if the socket never connects (a proxy
 * blocking WebSockets, a locked-down network), the polling in each component
 * keeps the UI correct, just less immediate.
 */

let socket: Socket | null = null;
let refCount = 0;

function getSocket(): Socket | null {
  const token = tokens.get();
  if (!token) return null;

  if (!socket) {
    socket = io(BASE_URL, {
      path: "/realtime",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionAttempts: 8,
      reconnectionDelay: 2000,
      autoConnect: true,
    });
  }
  return socket;
}

function releaseSocket() {
  refCount -= 1;
  if (refCount <= 0 && socket) {
    socket.disconnect();
    socket = null;
    refCount = 0;
  }
}

/** Subscribe to a server event for the lifetime of the component. */
export function useRealtime<T = unknown>(event: string, handler: (payload: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const connection = getSocket();
    if (!connection) return;

    refCount += 1;
    const listener = (payload: T) => handlerRef.current(payload);
    connection.on(event, listener);

    return () => {
      connection.off(event, listener);
      releaseSocket();
    };
  }, [event]);
}

export function disconnectRealtime() {
  if (socket) {
    socket.disconnect();
    socket = null;
    refCount = 0;
  }
}
