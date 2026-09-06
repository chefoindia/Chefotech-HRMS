"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Copy, KeyRound, ListChecks, Pause, Play, Plus, RefreshCw, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatDateTime, formatRelative, humanise } from "@/lib/format";
import { Badge, Button, Callout, Card, CardHeader, Checkbox, ConfirmDialog, Drawer, EmptyState, FieldGrid, Input, Modal, NoAccessState, PageHeader, Tabs, useToast } from "@/components/ui";
import { ApiDocsPanel } from "@/components/integrations/ApiDocsPanel";

/**
 * API keys and webhooks — the two doors other systems use.
 *
 * A key is shown once, at creation, and never again: we store a hash. Its
 * scopes are a subset of what its creator can do, so a key is never a way
 * to escalate. A webhook receives signed JSON for the events it subscribes
 * to; the secret is likewise shown once, and can be rotated.
 */

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  isExpired: boolean;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  useCount: number;
  revokedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  consecutiveFailures: number;
  lastDeliveredAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  disabledReason: string | null;
  createdAt: string;
}

interface Delivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: unknown;
}

interface EventEntry {
  event: string;
  group: string;
  examples: string[];
}

interface PermissionGroup {
  key: string;
  label: string;
  permissions: Array<[string, string]>;
}

export default function IntegrationsSettingsPage() {
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const [tab, setTab] = useState("guide");

  if (!can("settings.manage_integrations")) return <NoAccessState what="API keys and webhooks" />;

  return (
    <>
      <PageHeader
        title="API & webhooks"
        description="Let another system read and write your HR data, and get told the moment something changes. Start with the guide — it has the base URL, working examples in four languages, and a console to try a request right here."
      />

      <Tabs
        items={[
          { key: "guide", label: "Guide & testing", icon: <BookOpen className="h-3.5 w-3.5" /> },
          { key: "keys", label: "API keys", icon: <KeyRound className="h-3.5 w-3.5" /> },
          { key: "webhooks", label: "Webhooks", icon: <WebhookIcon className="h-3.5 w-3.5" /> },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === "guide" && <ApiDocsPanel onGoToKeys={() => setTab("keys")} />}

      {tab === "keys" && (
        <div className="space-y-5">
          <Callout tone="info" icon={<KeyRound className="h-4 w-4" />}>
            A key authenticates a program rather than a person: send it as an{" "}
            <code className="rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[12px]">x-api-key</code> header on every request. It carries
            only the permissions you tick, can never create other keys, and stops working the moment you revoke it.{" "}
            <button type="button" onClick={() => setTab("guide")} className="font-medium underline">
              Read the guide
            </button>{" "}
            for examples and a request console.
          </Callout>
          <ApiKeysCard locale={locale} />
        </div>
      )}

      {tab === "webhooks" && (
        <div className="space-y-5">
          <Callout tone="info" icon={<WebhookIcon className="h-4 w-4" />}>
            A webhook is us calling you. Give a URL that answers{" "}
            <code className="rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[12px]">200</code> within ten seconds, pick the events, and
            verify the{" "}
            <code className="rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[12px]">X-Chefotech-Signature</code> header before trusting a
            payload.{" "}
            <button type="button" onClick={() => setTab("guide")} className="font-medium underline">
              The guide
            </button>{" "}
            has copy-paste verification code for Node, Python and PHP.
          </Callout>
          <WebhooksCard locale={locale} />
        </div>
      )}
    </>
  );
}

// ── API keys ────────────────────────────────────────────────────────────────

function ApiKeysCard({ locale }: { locale: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ title: string; value: string; note: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const { data: keys, isLoading } = useQuery({
    queryKey: ["integrations", "api-keys"],
    queryFn: async () => {
      const { data } = await api.get<ApiKey[]>("/integrations/api-keys");
      return data;
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => api.post(`/integrations/api-keys/${id}/revoke`),
    onSuccess: () => {
      toast.success("Key revoked", "Requests using it will be refused from now on.");
      queryClient.invalidateQueries({ queryKey: ["integrations", "api-keys"] });
      setRevoking(null);
    },
    onError: (error) => toast.fromError(error, "Could not revoke that key."),
  });

  return (
    <Card>
      <CardHeader
        title="API keys"
        description="For scripts and other systems that call the API on their own. Each key carries only the permissions you give it."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New key
          </Button>
        }
      />
      <div className="mt-4">
        {isLoading ? (
          <p className="text-[13px] text-[var(--text-muted)]">Loading…</p>
        ) : !keys || keys.length === 0 ? (
          <EmptyState icon={<KeyRound className="h-5 w-5" />} title="No API keys" description="Create one to let another system read or write on this organization's behalf." />
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {keys.map((key) => {
              const dead = Boolean(key.revokedAt) || key.isExpired;
              return (
                <li key={key.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13.5px] font-medium text-[var(--text)]">{key.name}</p>
                      <code className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[11.5px] text-[var(--text-muted)]">{key.prefix}…</code>
                      {key.revokedAt ? <Badge tone="danger">Revoked</Badge> : key.isExpired ? <Badge tone="warning">Expired</Badge> : <Badge tone="success">Active</Badge>}
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                      {key.scopes.length} permission{key.scopes.length === 1 ? "" : "s"} · created {formatDate(key.createdAt, { locale })}
                      {key.createdBy ? ` by ${key.createdBy}` : ""}
                      {key.expiresAt ? ` · expires ${formatDate(key.expiresAt, { locale })}` : " · never expires"}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                      {key.lastUsedAt ? `Last used ${formatRelative(key.lastUsedAt)}${key.lastUsedIp ? ` from ${key.lastUsedIp}` : ""} · ${key.useCount.toLocaleString(locale)} requests` : "Never used"}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {key.scopes.slice(0, 8).map((s) => (
                        <span key={s} className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                          {s}
                        </span>
                      ))}
                      {key.scopes.length > 8 && <span className="text-[11px] text-[var(--text-muted)]">+{key.scopes.length - 8} more</span>}
                    </p>
                  </div>
                  {!dead && (
                    <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setRevoking(key)}>
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {creating && (
        <NewKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(plainKey, name) => {
            setCreating(false);
            queryClient.invalidateQueries({ queryKey: ["integrations", "api-keys"] });
            setRevealed({ title: `Key created: ${name}`, value: plainKey, note: "Copy it now. For your safety it is stored hashed and cannot be shown again." });
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking.id);
        }}
        loading={revoke.isPending}
        tone="danger"
        title={`Revoke "${revoking?.name}"?`}
        confirmLabel="Revoke"
        message="Anything still using this key will start getting 401 responses immediately. This cannot be undone; create a new key instead."
      />

      {revealed && <SecretDialog {...revealed} onClose={() => setRevealed(null)} />}
    </Card>
  );
}

function NewKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (plainKey: string, name: string) => void }) {
  const toast = useToast();
  const { session } = useSession();
  const mine = useMemo(() => new Set(session?.permissions || []), [session]);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set());

  const { data: groups } = useQuery({
    queryKey: ["roles", "permissions"],
    queryFn: async () => {
      const { data } = await api.get<PermissionGroup[]>("/roles/permissions");
      return data;
    },
    staleTime: 10 * 60_000,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ key: ApiKey; plainKey: string }>("/integrations/api-keys", { name: name.trim(), scopes: [...scopes], expiresAt: expiresAt || null });
      return data;
    },
    onSuccess: (data) => onCreated(data.plainKey, data.key.name),
    onError: (error) => toast.fromError(error, "Could not create the key."),
  });

  const toggle = (key: string) => {
    setScopes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New API key"
      description="Give it the least it needs. You can only grant permissions you hold yourself."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={<KeyRound className="h-3.5 w-3.5" />} disabled={!name.trim() || scopes.size === 0} loading={create.isPending} onClick={() => create.mutate()}>
            Create key
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldGrid columns={2}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Payroll sync, Tally export…" required />
          <Input label="Expires on (optional)" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} hint="Leave blank for a key that lasts until revoked." />
        </FieldGrid>
        <div>
          <p className="text-sm font-medium text-[var(--text)]">Permissions</p>
          <p className="text-[12.5px] text-[var(--text-muted)]">{scopes.size} selected</p>
          <div className="mt-2 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-[var(--border)] p-3">
            {(groups || []).map((group) => {
              const allowed = group.permissions.filter(([key]) => mine.has(key));
              if (allowed.length === 0) return null;
              return (
                <div key={group.key}>
                  <div className="flex items-center justify-between">
                    <p className="text-[12.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{group.label}</p>
                    <button
                      type="button"
                      className="text-[12px] text-[var(--brand)] hover:underline"
                      onClick={() =>
                        setScopes((current) => {
                          const next = new Set(current);
                          const every = allowed.every(([key]) => next.has(key));
                          for (const [key] of allowed) {
                            if (every) next.delete(key);
                            else next.add(key);
                          }
                          return next;
                        })
                      }
                    >
                      {allowed.every(([key]) => scopes.has(key)) ? "Clear" : "Select all"}
                    </button>
                  </div>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    {allowed.map(([key, label]) => (
                      <Checkbox key={key} label={label} hint={key} checked={scopes.has(key)} onChange={() => toggle(key)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SecretDialog({ title, value, note, onClose }: { title: string; value: string; note: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="outline" icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button onClick={onClose}>I have saved it</Button>
        </>
      }
    >
      <Callout tone="warning">{note}</Callout>
      <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-[12.5px]">{value}</pre>
    </Modal>
  );
}

// ── Webhooks ────────────────────────────────────────────────────────────────

function WebhooksCard({ locale }: { locale: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ title: string; value: string; note: string } | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const [rotating, setRotating] = useState<Webhook | null>(null);
  const [viewing, setViewing] = useState<Webhook | null>(null);

  const { data: hooks, isLoading } = useQuery({
    queryKey: ["integrations", "webhooks"],
    queryFn: async () => {
      const { data } = await api.get<Webhook[]>("/integrations/webhooks");
      return data;
    },
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["integrations", "webhooks"] });

  const test = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ ok: boolean; responseStatus: number | null; error: string | null }>(`/integrations/webhooks/${id}/test`);
      return data;
    },
    onSuccess: (data) => {
      if (data.ok) toast.success("Delivered", `The receiver answered ${data.responseStatus}.`);
      else toast.warning("Not delivered", data.error || `The receiver answered ${data.responseStatus ?? "nothing"}.`);
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not send a test event."),
  });

  const toggle = useMutation({
    mutationFn: async (hook: Webhook) => api.patch(`/integrations/webhooks/${hook.id}`, { isActive: !hook.isActive }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.fromError(error, "Could not update the webhook."),
  });

  const rotate = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ secret: string }>(`/integrations/webhooks/${id}/rotate-secret`);
      return data;
    },
    onSuccess: (data, id) => {
      const hook = hooks?.find((h) => h.id === id);
      setRotating(null);
      setRevealed({ title: `New secret: ${hook?.name || "webhook"}`, value: data.secret, note: "Update the receiver before the next event fires. Deliveries are signed with this secret from now on." });
    },
    onError: (error) => toast.fromError(error, "Could not rotate the secret."),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/integrations/webhooks/${id}`),
    onSuccess: () => {
      toast.success("Webhook removed");
      setDeleting(null);
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not remove the webhook."),
  });

  return (
    <Card>
      <CardHeader
        title="Webhooks"
        description="Tell another system the moment something happens here: a joiner, an approved leave, a processed payroll."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Add webhook
          </Button>
        }
      />
      <div className="mt-4">
        {isLoading ? (
          <p className="text-[13px] text-[var(--text-muted)]">Loading…</p>
        ) : !hooks || hooks.length === 0 ? (
          <EmptyState icon={<WebhookIcon className="h-5 w-5" />} title="No webhooks" description="Add a receiver URL and pick the events it should hear about." />
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {hooks.map((hook) => (
              <li key={hook.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13.5px] font-medium text-[var(--text)]">{hook.name}</p>
                    {hook.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Paused</Badge>}
                    {hook.consecutiveFailures > 0 && <Badge tone="warning">{hook.consecutiveFailures} failure{hook.consecutiveFailures === 1 ? "" : "s"} in a row</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-muted)]">{hook.url}</p>
                  <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                    {hook.events.includes("*") ? "All events" : `${hook.events.length} event${hook.events.length === 1 ? "" : "s"}`}
                    {hook.lastDeliveredAt ? ` · last delivered ${formatRelative(hook.lastDeliveredAt)}` : " · nothing delivered yet"}
                    {hook.lastStatus ? ` · last response ${hook.lastStatus}` : ""}
                  </p>
                  {hook.disabledReason && <p className="mt-0.5 text-[12.5px] text-[var(--danger)]">{hook.disabledReason}</p>}
                  {hook.lastError && !hook.disabledReason && <p className="mt-0.5 text-[12.5px] text-[var(--danger)]">{hook.lastError}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <Button variant="ghost" size="sm" icon={<Send className="h-3.5 w-3.5" />} loading={test.isPending && test.variables === hook.id} onClick={() => test.mutate(hook.id)}>
                    Test
                  </Button>
                  <Button variant="ghost" size="sm" icon={<ListChecks className="h-3.5 w-3.5" />} onClick={() => setViewing(hook)}>
                    Deliveries
                  </Button>
                  <Button variant="ghost" size="sm" icon={hook.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} onClick={() => toggle.mutate(hook)}>
                    {hook.isActive ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="ghost" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRotating(hook)}>
                    Rotate secret
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Remove webhook" onClick={() => setDeleting(hook)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && (
        <NewWebhookDialog
          onClose={() => setCreating(false)}
          onCreated={(secret, name) => {
            setCreating(false);
            invalidate();
            setRevealed({ title: `Webhook added: ${name}`, value: secret, note: "This signing secret is shown once. Store it with the receiver; every delivery is signed with it." });
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(rotating)}
        onClose={() => setRotating(null)}
        onConfirm={() => {
          if (rotating) rotate.mutate(rotating.id);
        }}
        loading={rotate.isPending}
        title={`Rotate the secret for "${rotating?.name}"?`}
        confirmLabel="Rotate"
        message="The old secret stops working at once. You will be shown the new one a single time."
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
        loading={remove.isPending}
        tone="danger"
        title={`Remove "${deleting?.name}"?`}
        confirmLabel="Remove"
        message="Its delivery history goes with it."
      />

      {revealed && <SecretDialog {...revealed} onClose={() => setRevealed(null)} />}
      {viewing && <DeliveriesDrawer hook={viewing} locale={locale} onClose={() => setViewing(null)} />}
    </Card>
  );
}

function NewWebhookDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string, name: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [all, setAll] = useState(false);
  const [events, setEvents] = useState<Set<string>>(new Set());

  const { data: catalog } = useQuery({
    queryKey: ["integrations", "events"],
    queryFn: async () => {
      const { data } = await api.get<EventEntry[]>("/integrations/events");
      return data;
    },
    staleTime: 10 * 60_000,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, EventEntry[]>();
    for (const entry of catalog || []) {
      if (!map.has(entry.group)) map.set(entry.group, []);
      map.get(entry.group)!.push(entry);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalog]);

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ webhook: Webhook; secret: string }>("/integrations/webhooks", { name: name.trim(), url: url.trim(), events: all ? ["*"] : [...events] });
      return data;
    },
    onSuccess: (data) => onCreated(data.secret, data.webhook.name),
    onError: (error) => toast.fromError(error, "Could not add the webhook."),
  });

  const validUrl = /^https?:\/\/\S+$/i.test(url.trim());
  const canSubmit = name.trim().length > 0 && validUrl && (all || events.size > 0);

  return (
    <Modal
      open
      onClose={onClose}
      title="Add webhook"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={<WebhookIcon className="h-3.5 w-3.5" />} disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()}>
            Add webhook
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldGrid columns={2}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Slack joiners channel, ERP sync…" required />
          <Input label="Receiver URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/chefotech" hint="HTTPS in production. Must answer 2xx within 10 seconds." required />
        </FieldGrid>
        <div>
          <Checkbox label="All events" hint="Including ones added in future." checked={all} onChange={(e) => setAll(e.target.checked)} />
        </div>
        {!all && (
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-[var(--border)] p-3">
            {grouped.map(([group, entries]) => (
              <div key={group}>
                <p className="text-[12.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{humanise(group)}</p>
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  {entries.map((entry) => (
                    <Checkbox
                      key={entry.event}
                      label={entry.event}
                      hint={entry.examples.map(humanise).join(", ")}
                      checked={events.has(entry.event)}
                      onChange={() =>
                        setEvents((current) => {
                          const next = new Set(current);
                          if (next.has(entry.event)) next.delete(entry.event);
                          else next.add(entry.event);
                          return next;
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeliveriesDrawer({ hook, locale, onClose }: { hook: Webhook; locale: string; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["integrations", "webhooks", hook.id, "deliveries"],
    queryFn: async () => {
      const { data: rows } = await api.get<Delivery[]>(`/integrations/webhooks/${hook.id}/deliveries`, { query: { limit: 50 } });
      return rows;
    },
  });

  return (
    <Drawer open onClose={onClose} title={`Deliveries: ${hook.name}`} description="The last fifty, newest first. Kept for thirty days." width="lg">
      {isLoading ? (
        <p className="text-[13px] text-[var(--text-muted)]">Loading…</p>
      ) : !data || data.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-5 w-5" />} title="Nothing delivered yet" description="Send a test event, or wait for one of the subscribed events to happen." />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {data.map((d) => (
            <li key={d.id} className="py-2.5">
              <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(open === d.id ? null : d.id)}>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[var(--text)]">{d.event}</p>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    {formatDateTime(d.createdAt, { locale })} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                    {d.durationMs != null ? ` · ${d.durationMs} ms` : ""}
                    {d.error ? ` · ${d.error}` : ""}
                  </p>
                </div>
                <Badge tone={d.status === "delivered" ? "success" : d.status === "failed" ? "danger" : "warning"}>{d.status === "delivered" ? `Delivered ${d.responseStatus ?? ""}` : humanise(d.status)}</Badge>
              </button>
              {open === d.id && <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-[11.5px]">{JSON.stringify(d.payload, null, 2)}</pre>}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
