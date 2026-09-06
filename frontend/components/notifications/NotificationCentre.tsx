"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  CheckCheck,
  Megaphone,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRealtime } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { formatRelative, formatDateTime, humanise } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Tabs,
  useToast,
} from "@/components/ui";
import type { Announcement, Notification } from "@/lib/types";

/**
 * The notification centre.
 *
 * The bell shows the last dozen; this is the whole record, searchable and
 * filterable by what it is about. It also carries the noticeboard — company
 * announcements, with the acknowledgement button where one was asked for —
 * because "did you see the memo" is the same question as "did you get the
 * notification" from the reader's side.
 *
 * Shared between the admin app and the employee portal. The two differ only
 * in the shell around them and where their links lead.
 */

const CATEGORY_LABELS: Record<string, string> = {
  leave: "Leave",
  attendance: "Attendance",
  payroll: "Payroll",
  document: "Documents",
  workflow: "Approvals",
  employee: "People",
  system: "Account",
  announcement: "Announcements",
  ticket: "Help desk",
  expense: "Expenses",
  asset: "Assets",
};

const SEVERITY_TONE: Record<string, "info" | "success" | "warning" | "danger"> = {
  info: "info",
  success: "success",
  warning: "warning",
  critical: "danger",
};

export function NotificationCentre({ variant }: { variant: "app" | "portal" }) {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const timezone = session?.organization?.timezone;

  const [tab, setTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const { data: summary } = useQuery({
    queryKey: ["notifications", "summary"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ category: string; total: number; unread: number }>>(
        "/notifications/summary"
      );
      return data;
    },
  });

  const listQuery = useMemo(
    () => ({
      page,
      limit: 30,
      q: search || undefined,
      unreadOnly: unreadOnly ? "true" : undefined,
      category: tab !== "all" && tab !== "announcements" ? tab : undefined,
    }),
    [page, search, unreadOnly, tab]
  );

  const notifications = useQuery({
    queryKey: ["notifications", "centre", listQuery],
    queryFn: async () => {
      const response = await api.get<Notification[]>("/notifications", { query: listQuery });
      return {
        items: response.data || [],
        total: response.meta?.total || 0,
        totalPages: response.meta?.totalPages || 1,
        unread: (response.meta?.unread as number) || 0,
      };
    },
    enabled: tab !== "announcements",
    placeholderData: (previous) => previous,
  });

  const announcements = useQuery({
    queryKey: ["announcements", "mine"],
    queryFn: async () => {
      const { data } = await api.get<Announcement[]>("/notifications/announcements", {
        query: { scope: "mine", limit: 50 },
      });
      return data;
    },
    enabled: tab === "announcements",
  });

  useRealtime("notification", () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post("/notifications/read", ids ? { ids } : {}),
    onSuccess: invalidate,
  });
  const markUnread = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/unread`),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: invalidate,
  });
  const clearRead = useMutation({
    mutationFn: () => api.post<{ deleted: number }>("/notifications/clear-read"),
    onSuccess: (result) => {
      toast.success(`${result.data.deleted} read notification${result.data.deleted === 1 ? "" : "s"} cleared`);
      invalidate();
    },
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/announcements/${id}/acknowledge`),
    onSuccess: () => {
      toast.success("Acknowledged", "Thank you — HR can see you have read it.");
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
    },
    onError: (error) => toast.fromError(error, "Could not record your acknowledgement."),
  });

  const totalUnread = (summary || []).reduce((sum, row) => sum + row.unread, 0);
  const byCategory = Object.fromEntries((summary || []).map((row) => [row.category, row]));

  const tabs = [
    { key: "all", label: "All", count: totalUnread || undefined },
    { key: "announcements", label: "Announcements", icon: <Megaphone className="h-3.5 w-3.5" /> },
    ...Object.keys(CATEGORY_LABELS)
      .filter((key) => key !== "announcement" && byCategory[key])
      .map((key) => ({
        key,
        label: CATEGORY_LABELS[key],
        count: byCategory[key]?.unread || undefined,
      })),
  ];

  const items = notifications.data?.items || [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          totalUnread
            ? `${totalUnread} unread. Everything you have been told, in one place.`
            : "Everything you have been told, in one place."
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              icon={<CheckCheck className="h-3.5 w-3.5" />}
              disabled={!totalUnread || markRead.isPending}
              onClick={() => markRead.mutate(undefined)}
            >
              Mark all read
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              loading={clearRead.isPending}
              onClick={() => clearRead.mutate()}
            >
              Clear read
            </Button>
          </>
        }
      />

      <Tabs
        items={tabs}
        active={tab}
        onChange={(key) => {
          setTab(key);
          setPage(1);
        }}
        className="mb-4"
      />

      {tab === "announcements" ? (
        <AnnouncementFeed
          items={announcements.data || []}
          loading={announcements.isLoading}
          onAcknowledge={(id) => acknowledge.mutate(id)}
          acknowledging={acknowledge.isPending}
          locale={locale}
          timezone={timezone}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Input
                placeholder="Search notifications"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                prefix={<Search className="h-4 w-4" />}
              />
            </div>
            <label className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => {
                  setUnreadOnly(event.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
              />
              Unread only
            </label>
          </div>

          <Card padded={false}>
            {notifications.isLoading ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="skeleton h-14" />
                ))}
              </div>
            ) : !items.length ? (
              <EmptyState
                icon={<Bell className="h-5 w-5" />}
                title={search || unreadOnly ? "Nothing matches" : "Nothing yet"}
                description={
                  search || unreadOnly
                    ? "Try a different search, or include read notifications."
                    : "Approvals, payslips, documents and reminders will appear here."
                }
              />
            ) : (
              <ul className="divide-y">
                {items.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    variant={variant}
                    locale={locale}
                    timezone={timezone}
                    onRead={() => markRead.mutate([notification.id])}
                    onUnread={() => markUnread.mutate(notification.id)}
                    onRemove={() => remove.mutate(notification.id)}
                  />
                ))}
              </ul>
            )}

            {notifications.data && notifications.data.totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-[13px] text-[var(--text-muted)]">
                <span>
                  Page {page} of {notifications.data.totalPages} · {notifications.data.total} total
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= notifications.data.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function NotificationRow({
  notification,
  variant,
  locale,
  timezone,
  onRead,
  onUnread,
  onRemove,
}: {
  notification: Notification;
  variant: "app" | "portal";
  locale: string;
  timezone?: string;
  onRead: () => void;
  onUnread: () => void;
  onRemove: () => void;
}) {
  const unread = !notification.readAt;
  // A link written for the other side of the product is still a real page;
  // the shell on the far end sorts out the navigation.
  const href = notification.actionUrl && rewriteForVariant(notification.actionUrl, variant);

  const body = (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <span
        className={cn(
          "mt-2 h-2 w-2 shrink-0 rounded-full",
          unread ? "bg-brand-600" : "bg-transparent"
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("text-[13.5px] text-[var(--text)]", unread ? "font-semibold" : "font-medium")}>
            {notification.title}
          </p>
          <Badge tone={SEVERITY_TONE[notification.severity] || "info"}>
            {CATEGORY_LABELS[notification.category] || humanise(notification.category)}
          </Badge>
        </div>
        <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-[var(--text-muted)]">
          {notification.body}
        </p>
        <p className="mt-1 text-[11.5px] text-[var(--text-subtle)]" title={formatDateTime(notification.createdAt, { locale, timezone })}>
          {formatRelative(notification.createdAt)}
        </p>
      </div>
    </div>
  );

  return (
    <li className={cn("flex items-start gap-2 px-4 py-3.5", unread && "bg-brand-50/30")}>
      {href ? (
        <Link href={href} onClick={() => unread && onRead()} className="flex min-w-0 flex-1 hover:opacity-90">
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1">{body}</div>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={unread ? onRead : onUnread}
          aria-label={unread ? "Mark read" : "Mark unread"}
          title={unread ? "Mark read" : "Mark unread"}
        >
          {unread ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Delete" title="Delete">
          <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
        </Button>
      </div>
    </li>
  );
}

function rewriteForVariant(url: string, variant: "app" | "portal") {
  if (!url.startsWith("/")) return url;
  // The portal has no admin pages; an admin link from a portal-only session
  // would 404 through the shell's redirect, so keep it but let the shell
  // decide. The one mapping worth making is the notification centre itself.
  if (variant === "portal" && url === "/app/notifications") return "/me/notifications";
  if (variant === "app" && url === "/me/notifications") return "/app/notifications";
  return url;
}

function AnnouncementFeed({
  items,
  loading,
  onAcknowledge,
  acknowledging,
  locale,
  timezone,
}: {
  items: Announcement[];
  loading: boolean;
  onAcknowledge: (id: string) => void;
  acknowledging: boolean;
  locale: string;
  timezone?: string;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((index) => (
          <div key={index} className="skeleton h-28" />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <Card>
        <EmptyState
          icon={<Megaphone className="h-5 w-5" />}
          title="No announcements yet"
          description="Company-wide notices from HR will appear here, with the ones that need your acknowledgement marked."
        />
      </Card>
    );
  }

  const pinned = (a: Announcement) => a.pinnedUntil && new Date(a.pinnedUntil) > new Date();

  return (
    <div className="space-y-3">
      {items.map((announcement) => (
        <Card key={announcement.id} className={cn(pinned(announcement) && "border-brand-300")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-[var(--text)]">{announcement.title}</h3>
                {pinned(announcement) && <Badge tone="brand">Pinned</Badge>}
                {announcement.requireAcknowledgement &&
                  (announcement.acknowledged ? (
                    <Badge tone="success">Acknowledged</Badge>
                  ) : (
                    <Badge tone="warning">Acknowledgement needed</Badge>
                  ))}
              </div>
              <p className="mt-1 text-[12px] text-[var(--text-subtle)]">
                {announcement.createdBy ? `${announcement.createdBy} · ` : ""}
                {formatDateTime(announcement.sentAt || announcement.createdAt, { locale, timezone })}
              </p>
            </div>
            {announcement.requireAcknowledgement && !announcement.acknowledged && (
              <Button size="sm" loading={acknowledging} onClick={() => onAcknowledge(announcement.id)} icon={<Check className="h-3.5 w-3.5" />}>
                I have read this
              </Button>
            )}
          </div>
          <p className="mt-3 whitespace-pre-line text-[13.5px] leading-relaxed text-[var(--text)]">
            {announcement.message}
          </p>
          {announcement.acknowledged && announcement.acknowledgedAt && (
            <p className="mt-3 text-[12px] text-[var(--text-subtle)]">
              You acknowledged this {formatRelative(announcement.acknowledgedAt)}.
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
