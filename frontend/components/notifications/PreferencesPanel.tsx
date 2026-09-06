"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Laptop, Save, Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { enableBrowserPush, disableBrowserPush, currentSubscription, pushSupport } from "@/lib/webPush";
import { Badge, Button, Callout, Card, CardHeader, FieldGrid, Input, Switch, useToast } from "@/components/ui";
import type { NotificationPreference, PushDevice } from "@/lib/types";

const CATEGORY_LABELS: Record<string, string> = {
  leave: "Leave",
  attendance: "Attendance",
  payroll: "Payroll",
  document: "Documents",
  workflow: "Approvals",
  employee: "People",
  system: "Account & security",
  announcement: "Announcements",
  ticket: "Help desk",
  expense: "Expenses",
  asset: "Assets",
};

/**
 * How this person wants to be reached.
 *
 * In-app is always on — it is the record. Email and push can each be turned
 * off entirely or per category, push can be silenced overnight, and the
 * browser can be enrolled for push from here.
 */
export function PreferencesPanel({ showDigest = true }: { showDigest?: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<NotificationPreference | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: preferences } = useQuery({
    queryKey: ["notifications", "preferences"],
    queryFn: async () => {
      const { data } = await api.get<NotificationPreference>("/notifications/preferences");
      return data;
    },
  });

  useEffect(() => {
    if (preferences) {
      setDraft(preferences);
      setDirty(false);
    }
  }, [preferences]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const { categories, isDefault, ...body } = draft;
      await api.put("/notifications/preferences", body);
    },
    onSuccess: () => {
      toast.success("Preferences saved");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["notifications", "preferences"] });
    },
    onError: (error) => toast.fromError(error, "Could not save your preferences."),
  });

  if (!draft) return <div className="skeleton h-48" />;

  const categories = draft.categories || Object.keys(CATEGORY_LABELS);
  const isMuted = (category: string, channel: "email" | "push") =>
    draft.muted.some((m) => m.category === category && m.channel === channel);
  const toggleMute = (category: string, channel: "email" | "push") => {
    const muted = isMuted(category, channel)
      ? draft.muted.filter((m) => !(m.category === category && m.channel === channel))
      : [...draft.muted, { category, channel }];
    setDraft({ ...draft, muted });
    setDirty(true);
  };
  const patch = (changes: Partial<NotificationPreference>) => {
    setDraft({ ...draft, ...changes });
    setDirty(true);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="How to reach you"
          description="In-app notifications are always kept, so nothing is lost. Choose what also reaches your inbox and your phone."
          action={
            <Button size="sm" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()} icon={<Save className="h-3.5 w-3.5" />}>
              Save
            </Button>
          }
        />

        <div className="mt-5 space-y-4">
          <Switch
            label="Email"
            hint="Turn off to stop every email except account security notices and password resets."
            checked={draft.emailEnabled}
            onChange={(value) => patch({ emailEnabled: value })}
          />
          <Switch
            label="Push notifications"
            hint="To your phone (the mobile app) and any browser you enrol below."
            checked={draft.pushEnabled}
            onChange={(value) => patch({ pushEnabled: value })}
          />
          {showDigest && (
            <Switch
              label="Morning digest"
              hint="One email a day summarising what is waiting on you. Only sent when there is something in it, and only if you approve things or see the organization."
              checked={draft.dailyDigest}
              onChange={(value) => patch({ dailyDigest: value })}
            />
          )}
        </div>

        <div className="mt-6">
          <p className="text-[13px] font-medium text-[var(--text)]">By topic</p>
          <p className="mb-3 text-[12.5px] text-[var(--text-muted)]">
            Untick a channel for a topic you would rather only see in the app.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-[var(--text-subtle)]">
                  <th className="py-1.5 pr-4 font-medium">Topic</th>
                  <th className="py-1.5 pr-4 text-center font-medium">Email</th>
                  <th className="py-1.5 text-center font-medium">Push</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category} className="border-t">
                    <td className="py-2 pr-4 text-[var(--text)]">{CATEGORY_LABELS[category] || category}</td>
                    {(["email", "push"] as const).map((channel) => {
                      const masterOff = channel === "email" ? !draft.emailEnabled : !draft.pushEnabled;
                      return (
                        <td key={channel} className="py-2 pr-4 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${channel} for ${CATEGORY_LABELS[category] || category}`}
                            checked={!masterOff && !isMuted(category, channel)}
                            disabled={masterOff}
                            onChange={() => toggleMute(category, channel)}
                            className={cn(
                              "h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]",
                              masterOff && "opacity-40"
                            )}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <Switch
            label="Quiet hours"
            hint="No push notifications between these times. They still appear in the app, and emails are unaffected."
            checked={draft.quietHours.enabled}
            onChange={(value) => patch({ quietHours: { ...draft.quietHours, enabled: value } })}
          />
          {draft.quietHours.enabled && (
            <FieldGrid columns={2}>
              <Input
                label="From"
                type="time"
                value={draft.quietHours.start}
                onChange={(event) => patch({ quietHours: { ...draft.quietHours, start: event.target.value } })}
              />
              <Input
                label="Until"
                type="time"
                value={draft.quietHours.end}
                onChange={(event) => patch({ quietHours: { ...draft.quietHours, end: event.target.value } })}
              />
            </FieldGrid>
          )}
        </div>
      </Card>

      <DevicesCard />
    </div>
  );
}

function DevicesCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [support, setSupport] = useState<ReturnType<typeof pushSupport>>("unsupported");
  const [thisBrowser, setThisBrowser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: devices } = useQuery({
    queryKey: ["notifications", "devices"],
    queryFn: async () => {
      const { data } = await api.get<PushDevice[]>("/notifications/devices");
      return data;
    },
  });

  const { data: config } = useQuery({
    queryKey: ["notifications", "push-config"],
    queryFn: async () => {
      const { data } = await api.get<{ web: boolean }>("/notifications/push/config");
      return data;
    },
  });

  useEffect(() => {
    setSupport(pushSupport());
    currentSubscription().then((sub) => setThisBrowser(sub ? sub.endpoint : null));
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const result = await enableBrowserPush();
      if (result === "subscribed") {
        toast.success("Browser notifications on", "You will be notified here even when the tab is in the background.");
        const sub = await currentSubscription();
        setThisBrowser(sub ? sub.endpoint : null);
        setSupport(pushSupport());
        queryClient.invalidateQueries({ queryKey: ["notifications", "devices"] });
      } else if (result === "denied") {
        toast.warning("Notifications are blocked", "Allow notifications for this site in your browser settings, then try again.");
        setSupport(pushSupport());
      } else {
        toast.info("Not available", "Browser push is not configured on this server.");
      }
    } catch (error) {
      toast.fromError(error, "Could not enable browser notifications.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disableBrowserPush();
      setThisBrowser(null);
      toast.success("Browser notifications off");
      queryClient.invalidateQueries({ queryKey: ["notifications", "devices"] });
    } finally {
      setBusy(false);
    }
  };

  const test = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ attempted: number; delivered: number; noDevices?: boolean }>("/notifications/devices/test");
      return data;
    },
    onSuccess: (result) => {
      if (result.noDevices) toast.warning("No devices", "Install the mobile app or enable browser notifications first.");
      else toast.success("Test sent", `${result.delivered} of ${result.attempted} device(s) accepted it.`);
    },
    onError: (error) => toast.fromError(error, "Could not send a test."),
  });

  return (
    <Card>
      <CardHeader
        title="Your devices"
        description="Where push notifications go. The mobile app registers itself when you sign in."
        action={
          <Button variant="outline" size="sm" loading={test.isPending} onClick={() => test.mutate()} icon={<BellRing className="h-3.5 w-3.5" />}>
            Send a test
          </Button>
        }
      />

      <div className="mt-4">
        {support === "unsupported" ? (
          <Callout tone="info">This browser does not support push notifications.</Callout>
        ) : !config?.web ? (
          <Callout tone="info">Browser push is not configured on this server. The mobile app still receives push notifications.</Callout>
        ) : thisBrowser ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-emerald-200 bg-[var(--success-bg)] p-3.5">
            <p className="text-[13px] text-[var(--text)]">This browser is enrolled for notifications.</p>
            <Button variant="outline" size="sm" loading={busy} onClick={disable}>
              Turn off here
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border p-3.5">
            <div>
              <p className="text-[13px] font-medium text-[var(--text)]">Get notified in this browser</p>
              <p className="text-[12.5px] text-[var(--text-muted)]">
                {support === "denied"
                  ? "Notifications are blocked for this site. Allow them in your browser settings first."
                  : "Approvals and payslips will reach you even when the tab is in the background."}
              </p>
            </div>
            <Button size="sm" loading={busy} disabled={support === "denied"} onClick={enable}>
              Enable
            </Button>
          </div>
        )}
      </div>

      {devices && devices.length > 0 && (
        <ul className="mt-4 divide-y">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-sunken)] text-[var(--text-muted)]">
                {device.kind === "web" ? <Laptop className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-[var(--text)]">
                  {device.deviceName || (device.kind === "web" ? "Browser" : `Mobile app (${device.platform})`)}
                  {device.appVersion && <span className="ml-1 text-[var(--text-subtle)]">v{device.appVersion}</span>}
                </p>
                <p className="text-[12px] text-[var(--text-subtle)]">
                  Seen {formatRelative(device.lastSeenAt)}
                  {device.lastDeliveredAt && ` · last delivered ${formatRelative(device.lastDeliveredAt)}`}
                </p>
              </div>
              {device.isActive ? (
                <Badge tone="success">Active</Badge>
              ) : (
                <Badge tone="neutral" className="max-w-[12rem] truncate" >
                  Retired{device.disabledReason ? `: ${device.disabledReason}` : ""}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
