"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Key,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  FieldGrid,
  Input,
  NoAccessState,
  PageLoader,
  Select,
  Switch,
  useToast,
} from "@/components/ui";

interface AiStatus {
  configured: boolean;
  isEnabled: boolean;
  model: string | null;
  keySuffix: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  usage?: { requestCount: number; lastUsedAt: string | null };
  updatedAt?: string;
}

interface AiModel {
  value: string;
  label: string;
}

const FEATURES = [
  {
    title: "Setup assistant",
    body: "When the built-in help does not recognise a question, it is answered live by AI — grounded in what this platform actually does, not generic advice. Available the moment a key is saved.",
  },
  {
    title: "“Fill this for me” for leave policies",
    body: "Describe a leave policy in one plain sentence and review a structured draft before anything is saved. Nothing is written until an administrator accepts it.",
  },
];

/**
 * AI settings — bring your own Gemini key.
 *
 * The key is verified with a real call to Google before it is ever stored, so
 * "saved" always means "confirmed working". It is encrypted at rest and never
 * sent back to the browser in full — only the last four characters, which is
 * enough to recognise which key is configured and not enough to reconstruct
 * it from a screenshot.
 */
export default function AiSettingsPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const status = useQuery({
    queryKey: ["ai", "status"],
    queryFn: async () => (await api.get<AiStatus>("/ai/status")).data,
  });

  const models = useQuery({
    queryKey: ["ai", "models"],
    queryFn: async () => (await api.get<AiModel[]>("/ai/models")).data,
    staleTime: 60 * 60_000,
  });

  const save = useMutation({
    mutationFn: () =>
      api.put<AiStatus>("/ai/credential", { apiKey: apiKey.trim(), model: model || undefined }),
    onSuccess: () => {
      toast.success("Key verified with Gemini and saved.");
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["ai", "status"] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Could not save that key.");
    },
  });

  const toggle = useMutation({
    mutationFn: (isEnabled: boolean) => api.patch<AiStatus>("/ai/credential/enabled", { isEnabled }),
    onSuccess: (_data, isEnabled) => {
      toast.success(isEnabled ? "AI features turned on." : "AI features turned off.");
      queryClient.invalidateQueries({ queryKey: ["ai", "status"] });
    },
    onError: () => toast.error("Could not change that."),
  });

  const remove = useMutation({
    mutationFn: () => api.delete("/ai/credential"),
    onSuccess: () => {
      toast.success("AI key removed.");
      setConfirmingRemove(false);
      queryClient.invalidateQueries({ queryKey: ["ai", "status"] });
    },
    onError: () => toast.error("Could not remove that key."),
  });

  if (!can("settings.manage_ai")) return <NoAccessState what="AI settings" />;
  if (status.isLoading) return <PageLoader label="Loading AI settings…" />;

  const data = status.data;

  return (
    <div className="space-y-6">
      <Callout tone="info" icon={<Sparkles className="h-4 w-4" />}>
        AI features run on{" "}
        <a
          href="https://ai.google.dev/gemini-api/docs/api-key"
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-2"
        >
          your own Google Gemini API key
        </a>
        , not ours. That keeps usage and cost inside your own Google account, where a busy month
        for your team never competes with any other customer&apos;s. Google&apos;s free tier
        covers moderate use; see their pricing page for current limits.
      </Callout>

      <Card>
        <CardHeader
          title="Gemini API key"
          description={
            data?.configured
              ? `Connected · ending ${data.keySuffix}`
              : "Not configured yet — AI features are off until a key is added."
          }
          action={
            data?.configured ? (
              data.lastError ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--danger-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--danger)]">
                  <XCircle className="h-3.5 w-3.5" /> Last call failed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--success)]">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                </span>
              )
            ) : null
          }
        />

        <div className="mt-4 space-y-4">
          {data?.configured && (
            <div className="flex items-center justify-between rounded-[var(--radius)] border bg-[var(--surface-muted)] px-4 py-3">
              <div>
                <p className="text-[13.5px] font-medium text-[var(--text)]">AI features</p>
                <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                  {data.isEnabled
                    ? "On — the assistant and drafting tools are available to your team."
                    : "Off — the key is saved but nothing uses it right now."}
                </p>
              </div>
              <Switch
                checked={data.isEnabled}
                onChange={(value) => toggle.mutate(value)}
                disabled={toggle.isPending}
              />
            </div>
          )}

          <FieldGrid columns={2}>
            <Input
              label={data?.configured ? "Replace the key" : "API key"}
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="AIza…"
              autoComplete="off"
              suffix={
                <button
                  type="button"
                  onClick={() => setShowKey((value) => !value)}
                  className="text-[var(--text-subtle)] hover:text-[var(--text)]"
                  aria-label={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />
            <div>
              <Select
                label="Model"
                value={model || models.data?.[0]?.value || ""}
                onChange={(event) => setModel(event.target.value)}
                options={(models.data ?? []).map((m) => ({ value: m.value, label: m.label }))}
              />
              {data?.configured && data.model && (
                <p className="mt-1.5 text-[12px] text-[var(--text-subtle)]">
                  Currently using <span className="font-mono">{data.model}</span> — the specific
                  model Google is currently offering for this key. Save again any time to
                  re-check.
                </p>
              )}
            </div>
          </FieldGrid>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={apiKey.trim().length < 20}
              icon={<Key className="h-4 w-4" />}
            >
              {save.isPending ? "Verifying with Gemini…" : "Save and verify"}
            </Button>
            {data?.configured && (
              <Button
                variant="ghost"
                onClick={() => setConfirmingRemove(true)}
                icon={<Trash2 className="h-4 w-4" />}
                className="text-[var(--danger)] hover:bg-[var(--danger-bg)]"
              >
                Remove key
              </Button>
            )}
          </div>

          <p className="flex items-start gap-1.5 text-[12.5px] text-[var(--text-subtle)]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Saving makes one real request to Gemini to confirm the key works before anything is
            stored. If it fails, nothing is saved and your previous key (if any) is unaffected.
          </p>

          {data?.lastError && (
            <Callout tone="danger">
              The last call to Gemini failed: {data.lastError}
            </Callout>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="What this turns on"
          description="Every feature below only activates once a key is saved and enabled."
          action={<Wand2 className="h-4 w-4 text-[var(--text-subtle)]" />}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-[var(--radius)] border p-4">
              <p className="text-[13.5px] font-medium text-[var(--text)]">{feature.title}</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {data?.usage && data.usage.requestCount > 0 && (
        <Card>
          <CardHeader title="Usage" description="A count only — we never log what was asked or answered." />
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[24px] font-semibold text-[var(--text)]">
              {data.usage.requestCount.toLocaleString()}
            </span>
            <span className="text-[13px] text-[var(--text-muted)]">requests made</span>
          </div>
          {data.usage.lastUsedAt && (
            <p className="mt-1 text-[12px] text-[var(--text-subtle)]">
              Last used {new Date(data.usage.lastUsedAt).toLocaleString()}
            </p>
          )}
        </Card>
      )}

      {confirmingRemove && (
        <Card className="border-[var(--danger)]">
          <p className="text-[13.5px] text-[var(--text)]">
            Remove the saved Gemini key? AI features will stop working immediately for everyone in
            your organization.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
              Remove key
            </Button>
            <Button variant="outline" onClick={() => setConfirmingRemove(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
