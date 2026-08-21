"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import type { Notification } from "@/lib/types";
import { useRealtime } from "@/lib/realtime";

/**
 * The notification bell.
 *
 * Polls for the unread count and also listens on the realtime channel, so a
 * leave approval lands immediately rather than up to a minute later. The poll
 * is the fallback for when the socket cannot connect — behind a corporate
 * proxy that blocks WebSockets, the bell still works.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: async () => {
      const { data } = await api.get<{ count: number }>("/notifications/unread-count");
      return data.count;
    },
    refetchInterval: 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: async () => {
      const { data: items } = await api.get<Notification[]>("/notifications", {
        query: { limit: 12 },
      });
      return items;
    },
    enabled: open,
  });

  useRealtime("notification", () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  });

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener("click", onClickOutside), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", onClickOutside);
    };
  }, [open]);

  const markAllRead = async () => {
    await api.post("/notifications/read", {});
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const markRead = async (id: string) => {
    await api.post("/notifications/read", { ids: [id] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-full p-2 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-4.5 w-4.5" aria-hidden />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-in absolute right-0 top-11 z-30 w-[22rem] overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)] shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h3 className="text-[13.5px] font-semibold text-[var(--text)]">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-600 hover:underline"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {isLoading ? (
              <div className="space-y-3 p-4">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="skeleton h-12" />
                ))}
              </div>
            ) : !data?.length ? (
              <EmptyState
                title="Nothing new"
                description="Approvals, payslips and reminders will appear here."
                className="py-10"
              />
            ) : (
              data.map((notification) => {
                const body = (
                  <>
                    <div className="flex items-start gap-2">
                      {!notification.readAt && (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />
                      )}
                      <div className={cn("min-w-0 flex-1", notification.readAt && "pl-3.5")}>
                        <p className="text-[13px] font-medium text-[var(--text)]">
                          {notification.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-[var(--text-muted)]">
                          {notification.body}
                        </p>
                        <p className="mt-1 text-[11.5px] text-[var(--text-subtle)]">
                          {formatRelative(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </>
                );

                return notification.actionUrl ? (
                  <Link
                    key={notification.id}
                    href={notification.actionUrl}
                    onClick={() => {
                      markRead(notification.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "block border-b px-4 py-3 last:border-0 hover:bg-[var(--surface-muted)]",
                      !notification.readAt && "bg-brand-50/40"
                    )}
                  >
                    {body}
                  </Link>
                ) : (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => markRead(notification.id)}
                    className={cn(
                      "block w-full border-b px-4 py-3 text-left last:border-0 hover:bg-[var(--surface-muted)]",
                      !notification.readAt && "bg-brand-50/40"
                    )}
                  >
                    {body}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
