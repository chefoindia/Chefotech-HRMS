"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, RotateCcw, Send, Star } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDateTime, formatRelative, humanise } from "@/lib/format";
import { Badge, Button, Callout, Checkbox, Drawer, Input, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, type Ticket } from "@/lib/moduleTypes";

const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = { low: "neutral", normal: "info", high: "warning", urgent: "danger" };

/** One ticket: the conversation, and — for agents — the controls. */
export function TicketDrawer({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const agent = can("ticket.manage");
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [closing, setClosing] = useState(false);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ["tickets", ticketId],
    queryFn: async () => (await api.get<Ticket>(`/tickets/${ticketId}`)).data,
  });
  const { data: agents } = useQuery({
    queryKey: ["tickets", "agents"],
    queryFn: async () => (await api.get<Array<{ id: string; name: string; email: string }>>("/tickets/agents")).data,
    enabled: agent,
    staleTime: 5 * 60_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  const comment = useMutation({
    mutationFn: () => api.post(`/tickets/${ticketId}/comments`, { body, internal }),
    onSuccess: () => {
      setBody("");
      setInternal(false);
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not post that reply."),
  });

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/tickets/${ticketId}`, patch),
    onSuccess: refresh,
    onError: (error) => toast.fromError(error, "Could not update the ticket."),
  });

  const close = useMutation({
    mutationFn: () => api.post(`/tickets/${ticketId}/close`, rating ? { rating, ratingComment } : {}),
    onSuccess: () => {
      toast.success("Ticket closed", rating ? "Thanks for the rating." : undefined);
      setClosing(false);
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not close the ticket."),
  });

  const reopen = useMutation({
    mutationFn: () => api.post(`/tickets/${ticketId}/reopen`),
    onSuccess: refresh,
    onError: (error) => toast.fromError(error, "Could not reopen the ticket."),
  });

  const isRequester = ticket && ticket.requester.id === session?.user.id;
  const open = ticket && !["closed"].includes(ticket.status);

  return (
    <Drawer open onClose={onClose} title={ticket ? `#${ticket.number} ${ticket.subject}` : "Ticket"} width="lg">
      {isLoading || !ticket ? (
        <div className="skeleton h-48" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={ticket.status === "in_progress" ? "processing" : ticket.status === "waiting_on_requester" ? "pending" : ticket.status} label={humanise(ticket.status)} />
            <Badge tone={PRIORITY_TONE[ticket.priority]}>{humanise(ticket.priority)}</Badge>
            <Badge tone="neutral">{ticket.category.toUpperCase()}</Badge>
            {ticket.isOverdue && <Badge tone="danger">Overdue</Badge>}
            <span className="text-[12.5px] text-[var(--text-muted)]">
              by {ticket.requester.name}
              {ticket.requester.department ? ` (${ticket.requester.department})` : ""} · {formatRelative(ticket.createdAt)}
              {ticket.dueAt ? ` · due ${formatDateTime(ticket.dueAt, { locale })}` : ""}
            </span>
          </div>

          {ticket.description && <p className="whitespace-pre-wrap rounded-md border bg-[var(--surface-muted)] p-3 text-[13.5px] text-[var(--text)]">{ticket.description}</p>}

          {agent && open && (
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <Select label="Status" value={ticket.status} onChange={(e) => update.mutate({ status: e.target.value })} options={TICKET_STATUSES.map((s) => ({ value: s, label: humanise(s) }))} />
              <Select label="Assignee" value={ticket.assignee?.id || ""} onChange={(e) => update.mutate({ assigneeUserId: e.target.value || null })} placeholder="Unassigned" options={(agents || []).map((a) => ({ value: a.id, label: a.name }))} />
              <Select label="Priority" value={ticket.priority} onChange={(e) => update.mutate({ priority: e.target.value })} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: humanise(p) }))} />
              <Select label="Category" value={ticket.category} onChange={(e) => update.mutate({ category: e.target.value })} options={TICKET_CATEGORIES.map((c) => ({ value: c, label: c.toUpperCase() }))} />
            </div>
          )}

          <div className="space-y-3">
            {(ticket.comments || []).length === 0 && <p className="text-[12.5px] text-[var(--text-subtle)]">No replies yet.</p>}
            {(ticket.comments || []).map((c) => (
              <div key={c.id} className={`rounded-md border p-3 ${c.internal ? "border-amber-200 bg-amber-50/50" : c.authorUserId === session?.user.id ? "bg-brand-50/40" : ""}`}>
                <p className="mb-1 text-[12px] text-[var(--text-muted)]">
                  <strong className="text-[var(--text)]">{c.authorName}</strong> · {formatRelative(c.createdAt)}
                  {c.internal && (
                    <span className="ml-2 inline-flex items-center gap-1 text-amber-700">
                      <Lock className="h-3 w-3" aria-hidden /> internal note
                    </span>
                  )}
                </p>
                <p className="whitespace-pre-wrap text-[13.5px] text-[var(--text)]">{c.body}</p>
              </div>
            ))}
          </div>

          {ticket.resolutionNote && <Callout tone="success" title="Resolution">{ticket.resolutionNote}</Callout>}
          {ticket.rating && (
            <p className="flex items-center gap-1 text-[12.5px] text-[var(--text-muted)]">
              Rated {Array.from({ length: ticket.rating }).map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />)}
              {ticket.ratingComment ? ` — “${ticket.ratingComment}”` : ""}
            </p>
          )}

          {open ? (
            <div className="space-y-2 border-t pt-4">
              <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={agent ? "Reply to the requester, or add an internal note" : "Reply"} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {agent ? <Checkbox label="Internal note (requester will not see it)" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> : <span />}
                <div className="flex gap-2">
                  {(isRequester || agent) && ticket.status !== "closed" && (
                    <Button variant="outline" size="sm" onClick={() => setClosing(true)}>
                      {ticket.status === "resolved" ? "Close" : "Close ticket"}
                    </Button>
                  )}
                  <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} loading={comment.isPending} disabled={!body.trim()} onClick={() => comment.mutate()}>
                    Send
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-[12.5px] text-[var(--text-muted)]">Closed {ticket.closedAt ? formatRelative(ticket.closedAt) : ""}.</p>
              <Button variant="outline" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={reopen.isPending} onClick={() => reopen.mutate()}>
                Reopen
              </Button>
            </div>
          )}

          {closing && (
            <div className="space-y-3 rounded-md border p-3">
              {isRequester && (
                <>
                  <p className="text-[13px] font-medium text-[var(--text)]">How was the help?</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`}>
                        <Star className={`h-6 w-6 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-[var(--text-subtle)]"}`} />
                      </button>
                    ))}
                  </div>
                  <Input placeholder="Anything to add? (optional)" value={ratingComment} onChange={(e) => setRatingComment(e.target.value)} />
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setClosing(false)}>
                  Not yet
                </Button>
                <Button size="sm" loading={close.isPending} onClick={() => close.mutate()}>
                  Close ticket
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function NewTicketDialog({ onClose, onDone }: { onClose: () => void; onDone: (ticket: Ticket) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("it");
  const [priority, setPriority] = useState<string>("normal");

  const create = useMutation({
    mutationFn: async () => (await api.post<Ticket>("/tickets", { subject, description, category, priority })).data,
    onSuccess: (ticket) => {
      toast.success(`Ticket #${ticket.number} raised`, "The help desk has been notified.");
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onDone(ticket);
    },
    onError: (error) => toast.fromError(error, "Could not raise the ticket."),
  });

  return (
    <Drawer open onClose={onClose} title="Raise a ticket" width="md" footer={
      <>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={create.isPending} disabled={subject.trim().length < 3} onClick={() => create.mutate()}>
          Raise ticket
        </Button>
      </>
    }>
      <div className="space-y-4">
        <Input label="What do you need help with?" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Laptop will not turn on" autoFocus required />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={TICKET_CATEGORIES.map((c) => ({ value: c, label: c === "it" || c === "hr" ? c.toUpperCase() : humanise(c) }))} />
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: humanise(p) }))} hint="Urgent means you cannot work until it is fixed." />
        </div>
        <Textarea label="Details" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened, what you have tried, and when you need it by." />
      </div>
    </Drawer>
  );
}
