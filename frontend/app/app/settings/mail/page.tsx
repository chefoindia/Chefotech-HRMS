"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Mail, RefreshCw, Send, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatDateTime, formatRelative, humanise } from "@/lib/format";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  DataTable,
  FilterSelect,
  Input,
  Modal,
  NoAccessState,
  StatCard,
  TableToolbar,
  useToast,
  type Column,
} from "@/components/ui";
import type { MailMessage } from "@/lib/types";

interface MailHealth {
  enabled: boolean;
  driver: string;
  from: string;
  replyTo: string | null;
  brevoKeySet: boolean;
  smtpHostSet: boolean;
  reachable: boolean;
  reason: string | null;
  queue: "background" | "inline";
  push: { expo: boolean; web: boolean };
}

interface MailStats {
  last24h: Record<string, number>;
  last7d: Record<string, number>;
  lastFailure: { to: string; subject: string; error: string; createdAt: string } | null;
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  sent: "success",
  simulated: "info",
  queued: "warning",
  sending: "warning",
  failed: "danger",
  skipped: "neutral",
};

/**
 * Mail.
 *
 * Three questions, answered on one screen: is email configured and will the
 * provider accept our messages; what went out, to whom, and did it arrive;
 * and — when it did not — why, with a button to send it again. Every "I
 * never got the email" conversation starts here rather than in the logs.
 */
export default function MailSettingsPage() {
  const { can, session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const state = useListState();
  const [testTo, setTestTo] = useState("");
  const [viewing, setViewing] = useState<MailMessage | null>(null);
  const locale = session?.organization?.locale || "en-IN";
  const timezone = session?.organization?.timezone;

  const canView = can("notification.manage_templates") || can("notification.view_mail_log");

  const health = useQuery({
    queryKey: ["mail", "health"],
    queryFn: async () => (await api.get<MailHealth>("/notifications/mail/health")).data,
    enabled: canView,
    staleTime: 60_000,
  });

  const stats = useQuery({
    queryKey: ["mail", "stats"],
    queryFn: async () => (await api.get<MailStats>("/notifications/mail/stats")).data,
    enabled: canView,
    refetchInterval: 30_000,
  });

  const log = useListQuery<MailMessage>("mail-log", "/notifications/mail/log", state, {
    limit: 25,
    enabled: canView,
  });

  const sendTest = useMutation({
    mutationFn: async () =>
      (await api.post<{ queued: boolean; delivered?: boolean; simulated?: boolean; error?: string }>(
        "/notifications/mail/test",
        testTo ? { to: testTo } : {}
      )).data,
    onSuccess: (result) => {
      if (result.queued) toast.success("Test email queued", "It will appear in the log below within a few seconds.");
      else if (result.simulated) toast.info("Captured in the dev outbox", "Mail is switched off on this server, so nothing was actually sent.");
      else if (result.delivered) toast.success("Test email sent", "Check the inbox — including spam, the first time.");
      else toast.error("The provider refused it", result.error || "See the log for details.");
      queryClient.invalidateQueries({ queryKey: ["mail-log"] });
      queryClient.invalidateQueries({ queryKey: ["mail", "stats"] });
    },
    onError: (error) => toast.fromError(error, "Could not send a test email."),
  });

  const resend = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/mail/log/${id}/resend`),
    onSuccess: () => {
      toast.success("Queued again");
      queryClient.invalidateQueries({ queryKey: ["mail-log"] });
    },
    onError: (error) => toast.fromError(error, "Could not resend that message."),
  });

  if (!canView) return <NoAccessState what="mail settings" />;

  const h = health.data;
  const s = stats.data;

  const columns: Array<Column<MailMessage>> = [
    {
      key: "to",
      header: "To",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-[var(--text)]">{row.toName || row.to}</p>
          {row.toName && <p className="truncate text-[12px] text-[var(--text-subtle)]">{row.to}</p>}
        </div>
      ),
    },
    {
      key: "subject",
      header: "Subject",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] text-[var(--text)]">{row.subject}</p>
          {row.templateKey && <p className="font-mono text-[11px] text-[var(--text-subtle)]">{row.templateKey}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div>
          <Badge tone={STATUS_TONE[row.status] || "neutral"}>{humanise(row.status)}</Badge>
          {row.error && <p className="mt-1 max-w-[16rem] truncate text-[11.5px] text-[var(--danger)]" title={row.error}>{row.error}</p>}
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      hideBelow: "md",
      render: (row) => (
        <span title={formatDateTime(row.createdAt, { locale, timezone })} className="text-[12.5px] text-[var(--text-muted)]">
          {formatRelative(row.sentAt || row.createdAt)}
          {row.attempts > 1 && <span className="ml-1 text-[var(--text-subtle)]">· {row.attempts} tries</span>}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setViewing(row)}>
            View
          </Button>
          {can("notification.manage_templates") && (row.status === "failed" || row.status === "sent" || row.status === "simulated") && (
            <Button variant="ghost" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => resend.mutate(row.id)}>
              Resend
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* ── Health ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Email delivery"
          description="Whether this server can send email, and through what."
          action={
            <Button variant="outline" size="sm" loading={health.isFetching} onClick={() => health.refetch()} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Re-check
            </Button>
          }
        />

        {health.isLoading ? (
          <div className="skeleton mt-4 h-20" />
        ) : h ? (
          <div className="mt-4 space-y-4">
            {!h.enabled ? (
              <Callout tone="danger" icon={<XCircle className="h-4 w-4" />} title="Email is switched off on this server">
                <span>
                  Nothing is being sent — password resets, invitations and payslip notices included. Set{" "}
                  <code className="rounded bg-[var(--surface-sunken)] px-1 font-mono text-[12px]">MAIL_ENABLED=true</code> on the
                  server and configure a provider.
                </span>
              </Callout>
            ) : h.reachable ? (
              <Callout tone="success" icon={<CheckCircle2 className="h-4 w-4" />} title="The mail provider accepts our credentials">
                Messages are sent via {h.driver}
                {h.queue === "background" ? " from a background queue with retries." : " directly from each request."}
              </Callout>
            ) : (
              <Callout tone="danger" icon={<AlertTriangle className="h-4 w-4" />} title="The mail provider rejected us">
                <span>{h.reason || "Unknown reason."} Until this is fixed every email will fail and show in the log below.</span>
              </Callout>
            )}

            <dl className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Transport" value={h.driver} />
              <Fact label="From address" value={h.from} />
              <Fact label="Reply-to" value={h.replyTo || "Not set"} />
              <Fact label="Credential" value={h.driver === "brevo" ? (h.brevoKeySet ? "Brevo API key set" : "No Brevo key") : h.smtpHostSet ? "SMTP host set" : "No SMTP host"} />
            </dl>

            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
              <Input
                label="Send a test email to"
                placeholder={session?.user.email}
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
                containerClassName="flex-1"
                hint="Leave blank to send it to yourself."
              />
              <Button loading={sendTest.isPending} onClick={() => sendTest.mutate()} icon={<Send className="h-4 w-4" />} disabled={!can("notification.manage_templates")}>
                Send test
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sent, last 24h" value={s ? s.last24h.sent + s.last24h.simulated : "—"} icon={<Mail className="h-5 w-5" />} tone="success" loading={stats.isLoading} />
        <StatCard label="Failed, last 24h" value={s ? s.last24h.failed : "—"} tone={s && s.last24h.failed ? "danger" : "default"} loading={stats.isLoading} />
        <StatCard label="Waiting to send" value={s ? s.last24h.queued + s.last24h.sending : "—"} tone="info" loading={stats.isLoading} />
        <StatCard label="Sent, last 7 days" value={s ? s.last7d.sent + s.last7d.simulated : "—"} hint={s ? `${s.last7d.failed} failed` : undefined} loading={stats.isLoading} />
      </div>

      {s?.lastFailure && (
        <Callout tone="warning" icon={<AlertTriangle className="h-4 w-4" />} title={`Most recent failure — ${formatRelative(s.lastFailure.createdAt)}`}>
          <span className="block truncate">
            To {s.lastFailure.to}: {s.lastFailure.subject}
          </span>
          <span className="mt-0.5 block text-[12.5px] opacity-80">{s.lastFailure.error}</span>
        </Callout>
      )}

      {/* ── Log ────────────────────────────────────────────────────────── */}
      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={log.items}
          rowKey={(row) => row.id}
          loading={log.isLoading}
          error={log.error ? (log.error as Error).message : null}
          onRetry={() => log.refetch()}
          emptyTitle="No email sent yet"
          emptyDescription="Every message the platform sends will be listed here with its delivery status."
          page={state.page}
          limit={log.limit}
          total={log.total}
          onPageChange={state.setPage}
          toolbar={
            <TableToolbar
              search={state.search}
              onSearchChange={(value) => {
                state.setFilter("to", value);
              }}
              placeholder="Filter by recipient"
              activeFilterCount={state.activeFilterCount}
              onClearFilters={state.clearFilters}
              filters={
                <FilterSelect
                  value={state.filters.status || ""}
                  onChange={(value) => state.setFilter("status", value)}
                  placeholder="Any status"
                  options={["sent", "failed", "queued", "simulated", "skipped"].map((value) => ({ value, label: humanise(value) }))}
                />
              }
            />
          }
        />
      </Card>

      {viewing && (
        <Modal
          open
          onClose={() => setViewing(null)}
          title={viewing.subject}
          description={`To ${viewing.toName ? `${viewing.toName} <${viewing.to}>` : viewing.to} · ${humanise(viewing.status)}${viewing.provider ? ` via ${viewing.provider}` : ""}`}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setViewing(null)}>
                Close
              </Button>
              {can("notification.manage_templates") && (
                <Button loading={resend.isPending} onClick={() => resend.mutate(viewing.id)} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                  Resend
                </Button>
              )}
            </>
          }
        >
          {viewing.error && (
            <Callout tone="danger" className="mb-4">
              {viewing.error}
            </Callout>
          )}
          <dl className="mb-4 grid gap-2 text-[12.5px] sm:grid-cols-2">
            <Fact label="Created" value={formatDateTime(viewing.createdAt, { locale, timezone })} />
            <Fact label="Sent" value={viewing.sentAt ? formatDateTime(viewing.sentAt, { locale, timezone }) : "—"} />
            <Fact label="Attempts" value={String(viewing.attempts)} />
            <Fact label="Provider message id" value={viewing.providerMessageId || "—"} />
          </dl>
          <pre className="max-h-[24rem] overflow-auto whitespace-pre-wrap rounded-[var(--radius)] border bg-[var(--surface-muted)] p-4 font-sans text-[13px] leading-relaxed text-[var(--text)]">
            {viewing.text}
          </pre>
        </Modal>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] uppercase tracking-wide text-[var(--text-subtle)]">{label}</dt>
      <dd className="truncate text-[var(--text)]" title={value}>
        {value}
      </dd>
    </div>
  );
}
