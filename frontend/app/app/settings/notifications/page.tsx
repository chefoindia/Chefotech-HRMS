"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Eye,
  Megaphone,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useReferenceData, toOptions } from "@/lib/hooks";
import { formatDateTime, formatRelative, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  Card,
  CardHeader,
  Checkbox,
  FieldGrid,
  Input,
  Modal,
  NoAccessState,
  PageLoader,
  Select,
  Switch,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ui";
import type { Announcement, NotificationRule } from "@/lib/types";

interface Template {
  key: string;
  event: string;
  group: string;
  category: string;
  channels: string[];
  subject: string;
  title: string;
  body: string;
  actionUrl: string | null;
  enabled: boolean;
  isHtml: boolean;
  isCustomised: boolean;
  variables: string[];
  defaults: { subject: string; title: string; body: string; channels: string[] };
}

interface RuleEvent {
  event: string;
  templateKey: string;
  title: string;
  group: string;
  channels: string[];
  variables: string[];
}

const GROUP_LABELS: Record<string, string> = {
  account: "Account and security",
  leave: "Leave",
  attendance: "Attendance and shifts",
  payroll: "Payroll and expenses",
  employee: "People and documents",
  workflow: "Approvals",
  ticket: "Help desk and assets",
  announcement: "Announcements and digests",
  other: "Other",
};

const CHANNEL_LABELS: Record<string, string> = {
  in_app: "In-app",
  email: "Email",
  push: "Push",
  sms: "SMS",
};

/**
 * Notifications.
 *
 * Three things an administrator controls, on one screen:
 *   what each message SAYS (templates),
 *   who ELSE hears about an event (rules — which had an API and no screen),
 *   and what the company tells everyone (announcements, with read receipts).
 */
export default function NotificationSettingsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState("templates");

  if (!can("notification.manage_templates") && !can("notification.broadcast")) {
    return <NoAccessState what="notification settings" />;
  }

  const tabs = [
    ...(can("notification.manage_templates")
      ? [
          { key: "templates", label: "Messages" },
          { key: "rules", label: "Who gets told" },
        ]
      : []),
    ...(can("notification.broadcast") ? [{ key: "announcements", label: "Announcements" }] : []),
    { key: "digest", label: "Daily digest" },
  ];

  const active = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  return (
    <div className="space-y-5">
      <Tabs items={tabs} active={active} onChange={setTab} />
      {active === "templates" && <TemplatesTab />}
      {active === "rules" && <RulesTab />}
      {active === "announcements" && <AnnouncementsTab />}
      {active === "digest" && <DigestTab />}
    </div>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────

function TemplatesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; title: string; body: string; html: string } | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["notification-templates"],
    queryFn: async () => (await api.get<Template[]>("/notifications/templates")).data,
  });

  useEffect(() => {
    if (!templates?.length) return;
    const target = templates.find((template) => template.key === selectedKey) || templates[0];
    setSelectedKey(target.key);
    setDraft({ ...target });
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, selectedKey]);

  const grouped = useMemo(() => {
    const out = new Map<string, Template[]>();
    for (const template of templates || []) {
      if (!out.has(template.group)) out.set(template.group, []);
      out.get(template.group)!.push(template);
    }
    return [...out.entries()];
  }, [templates]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api.patch(`/notifications/templates/${draft.key}`, {
        subject: draft.subject,
        title: draft.title,
        body: draft.body,
        actionUrl: draft.actionUrl,
        channels: draft.channels,
        enabled: draft.enabled,
        isHtml: draft.isHtml,
      });
    },
    onSuccess: () => {
      toast.success("Message saved");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["notification-templates"] });
    },
    onError: (error) => toast.fromError(error, "Could not save that message."),
  });

  const reset = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api.delete(`/notifications/templates/${draft.key}`);
    },
    onSuccess: () => {
      toast.success("Reset to the default wording");
      queryClient.invalidateQueries({ queryKey: ["notification-templates"] });
    },
    onError: (error) => toast.fromError(error, "Could not reset that message."),
  });

  const showPreview = useMutation({
    mutationFn: async () =>
      (await api.post<{ subject: string; title: string; body: string; html: string }>(`/notifications/templates/${draft!.key}/preview`, {})).data,
    onSuccess: (data) => setPreview(data),
    onError: (error) => toast.fromError(error, "Could not render a preview."),
  });

  const sendTest = useMutation({
    mutationFn: async () => (await api.post<{ sent: number; channels: Record<string, number> }>(`/notifications/templates/${draft!.key}/send-test`)).data,
    onSuccess: (result) => {
      const parts = Object.entries(result.channels || {})
        .filter(([, n]) => n)
        .map(([c, n]) => `${CHANNEL_LABELS[c] || c}: ${n}`);
      toast.success("Test sent to you", parts.length ? parts.join(" · ") : "No channel was available for your account.");
    },
    onError: (error) => toast.fromError(error, "Could not send a test."),
  });

  if (isLoading || !draft) return <PageLoader label="Loading messages" />;

  const patch = (changes: Partial<Template>) => {
    setDraft({ ...draft, ...changes });
    setDirty(true);
  };

  return (
    <div className="lg:flex lg:gap-6">
      <div className="mb-5 lg:mb-0 lg:w-72 lg:shrink-0">
        <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
          {grouped.map(([group, items]) => (
            <div key={group}>
              <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
                {GROUP_LABELS[group] || humanise(group)}
              </p>
              <div className="space-y-1">
                {items.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => setSelectedKey(template.key)}
                    className={cn(
                      "w-full rounded-[var(--radius)] border p-2.5 text-left transition-colors",
                      template.key === selectedKey ? "border-brand-300 bg-brand-50" : "hover:bg-[var(--surface-muted)]",
                      !template.enabled && "opacity-60"
                    )}
                  >
                    <p className="truncate text-[13px] font-medium text-[var(--text)]">{template.title}</p>
                    <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">{template.event}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {template.isCustomised && <Badge tone="brand">Customised</Badge>}
                      {!template.enabled && <Badge tone="neutral">Off</Badge>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-5">
        <Callout tone="info" icon={<Bell className="h-4 w-4" />}>
          Only messages you change are stored. Everything else follows the platform default, so
          improvements to the standard wording reach you automatically.
        </Callout>

        <Card>
          <CardHeader
            title={draft.title}
            description={draft.event}
            action={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" loading={showPreview.isPending} onClick={() => showPreview.mutate()} icon={<Eye className="h-3.5 w-3.5" />}>
                  Preview
                </Button>
                <Button variant="outline" size="sm" loading={sendTest.isPending} onClick={() => sendTest.mutate()} icon={<Send className="h-3.5 w-3.5" />}>
                  Send me a test
                </Button>
                {draft.isCustomised && (
                  <Button variant="ghost" size="sm" loading={reset.isPending} onClick={() => reset.mutate()} icon={<RotateCcw className="h-3.5 w-3.5" />}>
                    Reset
                  </Button>
                )}
                <Button size="sm" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()} icon={<Save className="h-3.5 w-3.5" />}>
                  Save
                </Button>
              </div>
            }
          />

          <div className="mt-5 space-y-4">
            <Switch
              label="Send this message"
              hint="Turning it off stops it going out on every channel, for everyone."
              checked={draft.enabled}
              onChange={(value) => patch({ enabled: value })}
            />

            <Input label="Email subject" value={draft.subject} onChange={(event) => patch({ subject: event.target.value })} />
            <Input label="Title" value={draft.title} onChange={(event) => patch({ title: event.target.value })} hint="Shown in the app and as the push notification heading." />
            <Textarea label="Body" rows={8} value={draft.body} onChange={(event) => patch({ body: event.target.value })} className={draft.isHtml ? "font-mono text-[12.5px]" : undefined} />
            <FieldGrid columns={2}>
              <Input
                label="Opens (link)"
                value={draft.actionUrl || ""}
                onChange={(event) => patch({ actionUrl: event.target.value || null })}
                hint="Where the notification takes the person. Placeholders work here too."
              />
              <div className="flex items-end pb-2">
                <Checkbox
                  label="Body is HTML"
                  hint="Use your own email markup instead of the branded wrapper."
                  checked={draft.isHtml}
                  onChange={(event) => patch({ isHtml: event.target.checked })}
                />
              </div>
            </FieldGrid>

            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">Available placeholders</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {draft.variables.map((variable) => (
                  <button
                    key={variable}
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`{{${variable}}}`).catch(() => undefined);
                      toast.success("Copied", `{{${variable}}}`);
                    }}
                    className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-[11.5px] text-[var(--text-muted)] hover:bg-brand-50 hover:text-brand-700"
                  >
                    {`{{${variable}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[13px] font-medium text-[var(--text)]">Channels</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {["in_app", "email", "push"].map((channel) => (
                  <label key={channel} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.channels.includes(channel)}
                      onChange={(event) =>
                        patch({
                          channels: event.target.checked
                            ? [...draft.channels, channel]
                            : draft.channels.filter((item) => item !== channel),
                        })
                      }
                      className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
                    />
                    <span className="text-[13px]">{CHANNEL_LABELS[channel]}</span>
                  </label>
                ))}
                <label className="flex items-center gap-2 opacity-50" title="SMS needs an SMS provider, which is not configured on this server.">
                  <input type="checkbox" disabled className="h-4 w-4 rounded" />
                  <span className="text-[13px]">SMS (not available)</span>
                </label>
              </div>
              <p className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">
                A channel only sends if it is also enabled organization-wide in Settings, and each person can mute topics in their own preferences.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {preview && (
        <Modal
          open
          onClose={() => setPreview(null)}
          title="Preview"
          description="Rendered against sample data, exactly as the email would look."
          size="lg"
          footer={<Button variant="outline" onClick={() => setPreview(null)}>Close</Button>}
        >
          <div className="space-y-3">
            <div>
              <p className="text-[11.5px] uppercase text-[var(--text-subtle)]">Subject</p>
              <p className="text-[14px] font-medium text-[var(--text)]">{preview.subject}</p>
            </div>
            <iframe
              title="Email preview"
              srcDoc={preview.html}
              sandbox=""
              className="h-[28rem] w-full rounded-[var(--radius)] border bg-white"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Rules ───────────────────────────────────────────────────────────────────

const RECIPIENT_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: "subject", label: "The person it is about", hint: "Whose leave, whose payslip." },
  { value: "actor", label: "Whoever caused it", hint: "The approver, the person who uploaded." },
  { value: "reporting_manager", label: "Their reporting manager", hint: "Resolved when it happens." },
  { value: "department_head", label: "Their department head", hint: "From the department record." },
  { value: "role", label: "Everyone with a role", hint: "e.g. every HR Manager." },
  { value: "user", label: "Named users", hint: "Specific accounts." },
  { value: "employee", label: "Named employees", hint: "Specific people." },
  { value: "email", label: "An external address", hint: "An auditor, a payroll bureau, a shared inbox." },
];

type RuleDraft = Omit<NotificationRule, "id" | "isSystemDefault"> & { id?: string };

function blankRule(event = ""): RuleDraft {
  return { name: "", description: "", event, templateKey: null, condition: "", recipients: [{ type: "reporting_manager" }], channels: null, isActive: true };
}

function RulesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [deleting, setDeleting] = useState<NotificationRule | null>(null);

  const { data: rules, isLoading } = useQuery({
    queryKey: ["notification-rules"],
    queryFn: async () => (await api.get<NotificationRule[]>("/notifications/rules")).data,
  });
  const { data: events } = useQuery({
    queryKey: ["notification-rule-events"],
    queryFn: async () => (await api.get<RuleEvent[]>("/notifications/rules/events")).data,
    staleTime: 10 * 60_000,
  });
  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<Array<{ id: string; name: string }>>("/roles")).data,
    staleTime: 5 * 60_000,
  });
  const { data: users } = useQuery({
    queryKey: ["org-users", "picker"],
    queryFn: async () => (await api.get<Array<{ id: string; fullName: string; email: string }>>("/users", { query: { limit: 200 } })).data,
    staleTime: 5 * 60_000,
  });
  const { data: employees } = useQuery({
    queryKey: ["employees", "picker"],
    queryFn: async () => (await api.get<Array<{ id: string; fullName: string; employeeCode: string }>>("/employees", { query: { limit: 200 } })).data,
    staleTime: 5 * 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notification-rules"] });

  const seed = useMutation({
    mutationFn: async () => (await api.post<{ created: number; alreadyPresent: number; skipped: Array<{ name: string; reason: string }> }>("/notifications/rules/seed-defaults")).data,
    onSuccess: (result) => {
      toast.success(`${result.created} recommended rule${result.created === 1 ? "" : "s"} added`, result.skipped.length ? `${result.skipped.length} skipped because a role they name does not exist here.` : undefined);
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not add the recommended rules."),
  });

  const save = useMutation({
    mutationFn: async (rule: RuleDraft) => {
      const { id, ...body } = rule;
      const payload = { ...body, condition: body.condition || null, channels: body.channels && body.channels.length ? body.channels : null, templateKey: body.templateKey || null };
      if (id) await api.patch(`/notifications/rules/${id}`, payload);
      else await api.post("/notifications/rules", payload);
    },
    onSuccess: () => {
      toast.success("Rule saved");
      setEditing(null);
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not save that rule."),
  });

  const toggle = useMutation({
    mutationFn: async (rule: NotificationRule) => api.patch(`/notifications/rules/${rule.id}`, { isActive: !rule.isActive }),
    onSuccess: invalidate,
    onError: (error) => toast.fromError(error, "Could not update that rule."),
  });

  const remove = useMutation({
    mutationFn: async (rule: NotificationRule) => api.delete(`/notifications/rules/${rule.id}`),
    onSuccess: () => {
      toast.success("Rule removed");
      setDeleting(null);
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not remove that rule."),
  });

  const eventTitle = (event: string) => (events || []).find((e) => e.event === event)?.title || event;

  const describeRecipient = (spec: NotificationRule["recipients"][number]) => {
    const type = RECIPIENT_TYPES.find((t) => t.value === spec.type)?.label || spec.type;
    if (spec.type === "role") return `${type}: ${(spec.roleIds || []).map((id) => roles?.find((r) => r.id === id)?.name || "?").join(", ")}`;
    if (spec.type === "user") return `${type}: ${(spec.userIds || []).map((id) => users?.find((u) => u.id === id)?.fullName || "?").join(", ")}`;
    if (spec.type === "employee") return `${type}: ${(spec.employeeIds || []).map((id) => employees?.find((e) => e.id === id)?.fullName || "?").join(", ")}`;
    if (spec.type === "email") return spec.email || type;
    return type;
  };

  const grouped = useMemo(() => {
    const out = new Map<string, NotificationRule[]>();
    for (const rule of rules || []) {
      if (!out.has(rule.event)) out.set(rule.event, []);
      out.get(rule.event)!.push(rule);
    }
    return [...out.entries()];
  }, [rules]);

  return (
    <div className="space-y-5">
      <Callout tone="info" icon={<Users className="h-4 w-4" />}>
        The product already tells the person an event is about. Rules add people on top — the manager who needs to plan cover, the payroll clerk, an external auditor. A rule can never stop someone hearing about their own request.
      </Callout>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-[var(--text-muted)]">
          {rules?.length ? `${rules.length} rule${rules.length === 1 ? "" : "s"}, ${rules.filter((r) => r.isActive).length} active.` : "No rules yet."}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" loading={seed.isPending} onClick={() => seed.mutate()} icon={<Sparkles className="h-4 w-4" />}>
            Add the recommended rules
          </Button>
          <Button onClick={() => setEditing(blankRule(events?.[0]?.event || ""))} icon={<Plus className="h-4 w-4" />}>
            New rule
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : !grouped.length ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-[14px] font-medium text-[var(--text)]">Nobody extra is being told about anything yet</p>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">Start from the recommended set — managers on leave requests, payroll on completed runs, HR on rejections — then adjust.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([event, items]) => (
            <Card key={event} padded={false}>
              <div className="border-b bg-[var(--surface-muted)] px-4 py-2.5">
                <p className="text-[13px] font-semibold text-[var(--text)]">When: {eventTitle(event)}</p>
                <p className="font-mono text-[11px] text-[var(--text-subtle)]">{event}</p>
              </div>
              <ul className="divide-y">
                {items.map((rule) => (
                  <li key={rule.id} className={cn("flex items-start gap-3 px-4 py-3", !rule.isActive && "opacity-60")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13.5px] font-medium text-[var(--text)]">{rule.name}</p>
                        {rule.isSystemDefault && <Badge tone="neutral">Recommended</Badge>}
                        {rule.condition && <Badge tone="info">only if {rule.condition}</Badge>}
                        {rule.channels && rule.channels.length > 0 && <Badge tone="purple">{rule.channels.map((c) => CHANNEL_LABELS[c] || c).join(" + ")}</Badge>}
                      </div>
                      {rule.description && <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{rule.description}</p>}
                      <p className="mt-1 text-[12.5px] text-[var(--text)]">
                        Tell: {rule.recipients.map(describeRecipient).join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch checked={rule.isActive} onChange={() => toggle.mutate(rule)} />
                      <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing({ ...rule, condition: rule.condition || "" })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setDeleting(rule)}>
                        <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <RuleEditor
          rule={editing}
          events={events || []}
          roles={roles || []}
          users={users || []}
          employees={employees || []}
          saving={save.isPending}
          onChange={setEditing}
          onSave={() => save.mutate(editing)}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        loading={remove.isPending}
        tone="danger"
        title="Remove this rule?"
        confirmLabel="Remove"
        message={deleting ? `"${deleting.name}" will stop adding people to ${eventTitle(deleting.event)} notifications.` : ""}
      />
    </div>
  );
}

function RuleEditor({
  rule,
  events,
  roles,
  users,
  employees,
  saving,
  onChange,
  onSave,
  onClose,
}: {
  rule: RuleDraft;
  events: RuleEvent[];
  roles: Array<{ id: string; name: string }>;
  users: Array<{ id: string; fullName: string; email: string }>;
  employees: Array<{ id: string; fullName: string; employeeCode: string }>;
  saving: boolean;
  onChange: (rule: RuleDraft) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const event = events.find((e) => e.event === rule.event);
  const patch = (changes: Partial<RuleDraft>) => onChange({ ...rule, ...changes });
  const setRecipient = (index: number, changes: Partial<RuleDraft["recipients"][number]>) =>
    patch({ recipients: rule.recipients.map((r, i) => (i === index ? { ...r, ...changes } : r)) });

  const valid =
    rule.name.trim().length > 0 &&
    rule.event &&
    rule.recipients.length > 0 &&
    rule.recipients.every((r) =>
      r.type === "role" ? (r.roleIds || []).length > 0
        : r.type === "user" ? (r.userIds || []).length > 0
          : r.type === "employee" ? (r.employeeIds || []).length > 0
            : r.type === "email" ? Boolean(r.email && /\S+@\S+\.\S+/.test(r.email))
              : true
    );

  const grouped = useMemo(() => {
    const out = new Map<string, RuleEvent[]>();
    for (const e of events) {
      if (!out.has(e.group)) out.set(e.group, []);
      out.get(e.group)!.push(e);
    }
    return [...out.entries()];
  }, [events]);

  return (
    <Modal
      open
      onClose={onClose}
      title={rule.id ? "Edit rule" : "New rule"}
      description="When this happens, also tell these people."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={saving} disabled={!valid} onClick={onSave}>Save rule</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldGrid columns={2}>
          <Input label="Name" required value={rule.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Copy HR on rejected leave" />
          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text)]">When</label>
            <select value={rule.event} onChange={(e) => patch({ event: e.target.value })} className="input-base">
              {grouped.map(([group, items]) => (
                <optgroup key={group} label={GROUP_LABELS[group] || humanise(group)}>
                  {items.map((e) => (
                    <option key={e.event} value={e.event}>{e.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </FieldGrid>
        <Textarea label="Why this rule exists (optional)" rows={2} value={rule.description || ""} onChange={(e) => patch({ description: e.target.value })} />

        <div>
          <p className="text-[13px] font-medium text-[var(--text)]">Also tell</p>
          <div className="mt-2 space-y-2">
            {rule.recipients.map((recipient, index) => (
              <div key={index} className="rounded-[var(--radius)] border p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <select value={recipient.type} onChange={(e) => setRecipient(index, { type: e.target.value, roleIds: [], userIds: [], employeeIds: [], email: "" })} className="input-base">
                      {RECIPIENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <p className="text-[12px] text-[var(--text-subtle)]">{RECIPIENT_TYPES.find((t) => t.value === recipient.type)?.hint}</p>

                    {recipient.type === "role" && (
                      <MultiPick options={roles.map((r) => ({ value: r.id, label: r.name }))} selected={recipient.roleIds || []} onChange={(roleIds) => setRecipient(index, { roleIds })} />
                    )}
                    {recipient.type === "user" && (
                      <MultiPick options={users.map((u) => ({ value: u.id, label: `${u.fullName} (${u.email})` }))} selected={recipient.userIds || []} onChange={(userIds) => setRecipient(index, { userIds })} />
                    )}
                    {recipient.type === "employee" && (
                      <MultiPick options={employees.map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))} selected={recipient.employeeIds || []} onChange={(employeeIds) => setRecipient(index, { employeeIds })} />
                    )}
                    {recipient.type === "email" && (
                      <Input type="email" placeholder="auditor@example.com" value={recipient.email || ""} onChange={(e) => setRecipient(index, { email: e.target.value })} />
                    )}
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Remove recipient" disabled={rule.recipients.length === 1} onClick={() => patch({ recipients: rule.recipients.filter((_, i) => i !== index) })}>
                    <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => patch({ recipients: [...rule.recipients, { type: "role", roleIds: [] }] })}>
              Add another
            </Button>
          </div>
        </div>

        <FieldGrid columns={2}>
          <Input
            label="Only when (optional)"
            placeholder={event?.variables.some((v) => v.startsWith("leave.days")) ? "leave.days >= 5" : "amount > 50000"}
            value={rule.condition || ""}
            onChange={(e) => patch({ condition: e.target.value })}
            hint={event?.variables.length ? `Fields: ${event.variables.slice(0, 6).join(", ")}${event.variables.length > 6 ? "…" : ""}` : "A formula over the event data."}
          />
          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text)]">Channels</label>
            <div className="flex flex-wrap gap-3 pt-2">
              {["in_app", "email", "push"].map((channel) => (
                <label key={channel} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={(rule.channels || []).includes(channel)}
                    onChange={(e) => {
                      const current = rule.channels || [];
                      patch({ channels: e.target.checked ? [...current, channel] : current.filter((c) => c !== channel) });
                    }}
                    className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
                  />
                  {CHANNEL_LABELS[channel]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-[var(--text-subtle)]">Leave all unticked to use the message's own channels.</p>
          </div>
        </FieldGrid>

        <Switch label="Active" checked={rule.isActive} onChange={(isActive) => patch({ isActive })} />
      </div>
    </Modal>
  );
}

function MultiPick({ options, selected, onChange }: { options: Array<{ value: string; label: string }>; selected: string[]; onChange: (values: string[]) => void }) {
  const [filter, setFilter] = useState("");
  const visible = options.filter((o) => !filter || o.label.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="rounded-md border">
      {options.length > 8 && (
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="w-full border-b bg-transparent px-2.5 py-1.5 text-[13px] outline-none" />
      )}
      <div className="max-h-40 overflow-y-auto p-1">
        {visible.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-[var(--text-subtle)]">Nothing to choose from.</p>}
        {visible.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-[var(--surface-muted)]">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(e) => onChange(e.target.checked ? [...selected, option.value] : selected.filter((v) => v !== option.value))}
              className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Announcements ───────────────────────────────────────────────────────────

function AnnouncementsTab() {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reference = useReferenceData();
  const locale = session?.organization?.locale || "en-IN";
  const timezone = session?.organization?.timezone;

  const [composing, setComposing] = useState(false);
  const [report, setReport] = useState<Announcement | null>(null);
  const [form, setForm] = useState({
    title: "",
    message: "",
    audience: "all" as Announcement["audience"]["type"],
    departmentId: "",
    locationId: "",
    employeeIds: [] as string[],
    channels: ["in_app", "email"] as string[],
    requireAcknowledgement: false,
    scheduledFor: "",
    pinnedUntil: "",
  });

  const { data: announcements, isLoading } = useQuery({
    queryKey: ["announcements", "manage"],
    queryFn: async () => (await api.get<Announcement[]>("/notifications/announcements", { query: { scope: "manage", limit: 50 } })).data,
  });
  const { data: employees } = useQuery({
    queryKey: ["employees", "picker"],
    queryFn: async () => (await api.get<Array<{ id: string; fullName: string; employeeCode: string }>>("/employees", { query: { limit: 200 } })).data,
    enabled: composing && form.audience === "employees",
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["announcements"] });

  const send = useMutation({
    mutationFn: async () =>
      (await api.post<Announcement>("/notifications/announce", {
        title: form.title,
        message: form.message,
        audience: form.audience,
        departmentId: form.departmentId || undefined,
        locationId: form.locationId || undefined,
        employeeIds: form.audience === "employees" ? form.employeeIds : undefined,
        channels: form.channels,
        requireAcknowledgement: form.requireAcknowledgement,
        scheduledFor: form.scheduledFor ? new Date(form.scheduledFor).toISOString() : null,
        pinnedUntil: form.pinnedUntil ? new Date(form.pinnedUntil).toISOString() : null,
      })).data,
    onSuccess: (result) => {
      toast.success(
        result.status === "scheduled" ? "Announcement scheduled" : "Announcement sent",
        result.status === "scheduled" ? `It goes out ${formatDateTime(result.scheduledFor!, { locale, timezone })}.` : `${result.recipientCount} people.`
      );
      setComposing(false);
      setForm({ title: "", message: "", audience: "all", departmentId: "", locationId: "", employeeIds: [], channels: ["in_app", "email"], requireAcknowledgement: false, scheduledFor: "", pinnedUntil: "" });
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not send that announcement."),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/announcements/${id}/cancel`),
    onSuccess: () => {
      toast.success("Cancelled");
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not cancel that announcement."),
  });

  const remind = useMutation({
    mutationFn: async (id: string) => (await api.post<{ reminded: number }>(`/notifications/announcements/${id}/remind`)).data,
    onSuccess: (result) => toast.success(`Reminded ${result.reminded} ${result.reminded === 1 ? "person" : "people"}`),
    onError: (error) => toast.fromError(error, "Could not send reminders."),
  });

  const valid =
    form.title.trim().length >= 3 &&
    form.message.trim().length >= 3 &&
    form.channels.length > 0 &&
    (form.audience !== "department" || form.departmentId) &&
    (form.audience !== "location" || form.locationId) &&
    (form.audience !== "employees" || form.employeeIds.length > 0);

  const statusTone: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
    sent: "success",
    scheduled: "info",
    sending: "warning",
    failed: "danger",
    cancelled: "neutral",
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-[var(--text-muted)]">Company-wide notices, with read receipts when you need them.</p>
        <Button onClick={() => setComposing(true)} icon={<Megaphone className="h-4 w-4" />}>
          New announcement
        </Button>
      </div>

      <Card padded={false}>
        {isLoading ? (
          <div className="space-y-2 p-5">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton h-14" />
            ))}
          </div>
        ) : !announcements?.length ? (
          <div className="py-10 text-center">
            <p className="text-[14px] font-medium text-[var(--text)]">Nothing announced yet</p>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">Policy changes, office closures, festival greetings — send them here and see who has read them.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {announcements.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13.5px] font-medium text-[var(--text)]">{a.title}</p>
                    <Badge tone={statusTone[a.status] || "neutral"}>{humanise(a.status)}</Badge>
                    {a.requireAcknowledgement && a.status === "sent" && (
                      <Badge tone={a.acknowledgedCount >= a.recipientCount ? "success" : "warning"}>
                        {a.acknowledgedCount}/{a.recipientCount} acknowledged
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] text-[var(--text-muted)]">{a.message}</p>
                  <p className="mt-1 text-[11.5px] text-[var(--text-subtle)]">
                    {humanise(a.audience.type)} · {a.channels.map((c) => CHANNEL_LABELS[c] || c).join(", ")} ·{" "}
                    {a.status === "scheduled" && a.scheduledFor
                      ? `goes out ${formatDateTime(a.scheduledFor, { locale, timezone })}`
                      : a.sentAt
                        ? `sent ${formatRelative(a.sentAt)} to ${a.recipientCount}`
                        : formatRelative(a.createdAt)}
                    {a.createdBy && ` · by ${a.createdBy}`}
                  </p>
                  {a.error && <p className="mt-1 text-[12px] text-[var(--danger)]">{a.error}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {a.requireAcknowledgement && a.status === "sent" && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setReport(a)}>Who has read it</Button>
                      {a.acknowledgedCount < a.recipientCount && (
                        <Button variant="ghost" size="sm" loading={remind.isPending} onClick={() => remind.mutate(a.id)}>Remind</Button>
                      )}
                    </>
                  )}
                  {a.status === "scheduled" && (
                    <Button variant="ghost" size="sm" onClick={() => cancel.mutate(a.id)}>Cancel</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {composing && (
        <Modal
          open
          onClose={() => setComposing(false)}
          title="New announcement"
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setComposing(false)}>Cancel</Button>
              <Button loading={send.isPending} disabled={!valid} onClick={() => send.mutate()} icon={<Send className="h-4 w-4" />}>
                {form.scheduledFor ? "Schedule" : "Send now"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Office closed on Friday 12 September" />
            <Textarea label="Message" required rows={6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />

            <FieldGrid columns={2}>
              <Select
                label="Who"
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value as typeof form.audience })}
                options={[
                  { value: "all", label: "Everyone" },
                  { value: "department", label: "A department" },
                  { value: "location", label: "A location" },
                  { value: "employees", label: "Specific people" },
                ]}
              />
              {form.audience === "department" && (
                <Select label="Department" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} options={toOptions(reference.departments)} placeholder="Choose…" />
              )}
              {form.audience === "location" && (
                <Select label="Location" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} options={toOptions(reference.locations)} placeholder="Choose…" />
              )}
            </FieldGrid>
            {form.audience === "employees" && (
              <MultiPick
                options={(employees || []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
                selected={form.employeeIds}
                onChange={(employeeIds) => setForm({ ...form, employeeIds })}
              />
            )}

            <div>
              <p className="text-[13px] font-medium text-[var(--text)]">Send by</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {["in_app", "email", "push"].map((channel) => (
                  <label key={channel} className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={form.channels.includes(channel)}
                      onChange={(e) => setForm({ ...form, channels: e.target.checked ? [...form.channels, channel] : form.channels.filter((c) => c !== channel) })}
                      className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
                    />
                    {CHANNEL_LABELS[channel]}
                  </label>
                ))}
              </div>
            </div>

            <Switch
              label="Ask everyone to acknowledge"
              hint="Each person gets a button to confirm they have read it, and you can see who has not."
              checked={form.requireAcknowledgement}
              onChange={(requireAcknowledgement) => setForm({ ...form, requireAcknowledgement })}
            />

            <FieldGrid columns={2}>
              <Input label="Send at (optional)" type="datetime-local" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} hint="Leave blank to send immediately." />
              <Input label="Keep pinned until (optional)" type="datetime-local" value={form.pinnedUntil} onChange={(e) => setForm({ ...form, pinnedUntil: e.target.value })} hint="Stays at the top of the noticeboard." />
            </FieldGrid>
          </div>
        </Modal>
      )}

      {report && <AcknowledgementReport announcement={report} onClose={() => setReport(null)} onRemind={() => remind.mutate(report.id)} reminding={remind.isPending} />}
    </div>
  );
}

function AcknowledgementReport({ announcement, onClose, onRemind, reminding }: { announcement: Announcement; onClose: () => void; onRemind: () => void; reminding: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["announcements", announcement.id, "acks"],
    queryFn: async () =>
      (await api.get<{ total: number; acknowledged: number; pending: Array<{ employeeId: string; name: string; email: string; hasAccount: boolean }>; rows: Array<{ employeeId: string; name: string; acknowledged: boolean; acknowledgedAt: string | null }> }>(
        `/notifications/announcements/${announcement.id}/acknowledgements`
      )).data,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={announcement.title}
      description={data ? `${data.acknowledged} of ${data.total} have acknowledged.` : "Loading…"}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {data && data.pending.length > 0 && (
            <Button loading={reminding} onClick={onRemind} icon={<Send className="h-3.5 w-3.5" />}>Remind the {data.pending.length} pending</Button>
          )}
        </>
      }
    >
      {isLoading || !data ? (
        <div className="skeleton h-40" />
      ) : data.pending.length === 0 ? (
        <Callout tone="success">Everyone has acknowledged this announcement.</Callout>
      ) : (
        <div>
          <p className="mb-2 text-[13px] font-medium text-[var(--text)]">Not yet acknowledged</p>
          <ul className="max-h-72 divide-y overflow-y-auto rounded-[var(--radius)] border">
            {data.pending.map((row) => (
              <li key={row.employeeId} className="flex items-center justify-between px-3 py-2 text-[13px]">
                <span className="text-[var(--text)]">{row.name}</span>
                <span className="text-[12px] text-[var(--text-subtle)]">{row.hasAccount ? row.email : "No portal account"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

// ── Digest ──────────────────────────────────────────────────────────────────

function DigestTab() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["digest", "preview"],
    queryFn: async () => (await api.get<{ dateLabel: string; body: string }>("/notifications/digest/preview")).data,
  });

  return (
    <div className="space-y-5">
      <Callout tone="info">
        Managers and HR get one email each morning listing what is waiting on them and what is happening today. It is only sent when there is something in it. The time and the on/off switch live under Organization settings → Notifications; each person can opt out in their own preferences.
      </Callout>
      <Card>
        <CardHeader
          title="What yours would say today"
          description={data?.dateLabel}
          action={
            <Button variant="outline" size="sm" loading={isFetching} onClick={() => refetch()} icon={<RotateCcw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
          }
        />
        {isLoading ? (
          <div className="skeleton mt-4 h-40" />
        ) : (
          <pre className="mt-4 whitespace-pre-wrap rounded-[var(--radius)] border bg-[var(--surface-muted)] p-4 font-sans text-[13px] leading-relaxed text-[var(--text)]">
            {data?.body}
          </pre>
        )}
      </Card>
    </div>
  );
}
