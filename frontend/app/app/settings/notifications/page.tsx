"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Eye, RotateCcw, Save } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Input,
  Modal,
  NoAccessState,
  PageLoader,
  Switch,
  Textarea,
  useToast,
} from "@/components/ui";

interface Template {
  key: string;
  event: string;
  channels: string[];
  subject: string;
  title: string;
  body: string;
  enabled: boolean;
  isCustomised: boolean;
  variables: string[];
  defaults: { subject: string; title: string; body: string; channels: string[] };
}

export default function NotificationTemplatesPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; title: string; body: string } | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["notification-templates"],
    queryFn: async () => {
      const { data } = await api.get<Template[]>("/notifications/templates");
      return data;
    },
    enabled: can("notification.manage_templates"),
  });

  useEffect(() => {
    if (!templates?.length) return;
    const target = templates.find((template) => template.key === selectedKey) || templates[0];
    setSelectedKey(target.key);
    setDraft({ ...target });
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, selectedKey]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api.patch(`/notifications/templates/${draft.key}`, {
        subject: draft.subject,
        title: draft.title,
        body: draft.body,
        channels: draft.channels,
        enabled: draft.enabled,
      });
    },
    onSuccess: () => {
      toast.success("Template saved");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["notification-templates"] });
    },
    onError: (error) => toast.fromError(error, "Could not save that template."),
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
    onError: (error) => toast.fromError(error, "Could not reset that template."),
  });

  const showPreview = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ subject: string; title: string; body: string }>(
        `/notifications/templates/${draft!.key}/preview`,
        {}
      );
      return data;
    },
    onSuccess: (data) => setPreview(data),
    onError: (error) => toast.fromError(error, "Could not render a preview."),
  });

  if (!can("notification.manage_templates")) return <NoAccessState what="notification templates" />;
  if (isLoading || !draft) return <PageLoader label="Loading templates" />;

  return (
    <div className="lg:flex lg:gap-6">
      <div className="mb-5 lg:mb-0 lg:w-64 lg:shrink-0">
        <div className="max-h-[70vh] space-y-1 overflow-y-auto">
          {templates?.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => setSelectedKey(template.key)}
              className={cn(
                "w-full rounded-[var(--radius)] border p-2.5 text-left transition-colors",
                template.key === selectedKey
                  ? "border-brand-300 bg-brand-50"
                  : "hover:bg-[var(--surface-muted)]"
              )}
            >
              <p className="truncate text-[13px] font-medium text-[var(--text)]">{template.title}</p>
              <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                {template.event}
              </p>
              {template.isCustomised && (
                <Badge tone="brand" className="mt-1">
                  Customised
                </Badge>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-5">
        <Callout tone="info" icon={<Bell className="h-4 w-4" />}>
          Only templates you change are stored. Everything else follows the platform default, so
          improvements to the standard wording reach you automatically.
        </Callout>

        <Card>
          <CardHeader
            title={draft.title}
            description={draft.event}
            action={
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={showPreview.isPending}
                  onClick={() => showPreview.mutate()}
                  icon={<Eye className="h-3.5 w-3.5" />}
                >
                  Preview
                </Button>
                {draft.isCustomised && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={reset.isPending}
                    onClick={() => reset.mutate()}
                    icon={<RotateCcw className="h-3.5 w-3.5" />}
                  >
                    Reset
                  </Button>
                )}
                <Button
                  size="sm"
                  loading={save.isPending}
                  disabled={!dirty}
                  onClick={() => save.mutate()}
                  icon={<Save className="h-3.5 w-3.5" />}
                >
                  Save
                </Button>
              </div>
            }
          />

          <div className="mt-5 space-y-4">
            <Switch
              label="Send this notification"
              hint="Turning it off stops it going out entirely."
              checked={draft.enabled}
              onChange={(value) => {
                setDraft({ ...draft, enabled: value });
                setDirty(true);
              }}
            />

            <Input
              label="Email subject"
              value={draft.subject}
              onChange={(event) => {
                setDraft({ ...draft, subject: event.target.value });
                setDirty(true);
              }}
            />

            <Input
              label="Title"
              value={draft.title}
              onChange={(event) => {
                setDraft({ ...draft, title: event.target.value });
                setDirty(true);
              }}
              hint="Shown in the in-app notification."
            />

            <Textarea
              label="Body"
              rows={8}
              value={draft.body}
              onChange={(event) => {
                setDraft({ ...draft, body: event.target.value });
                setDirty(true);
              }}
            />

            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Available placeholders
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {draft.variables.map((variable) => (
                  <code
                    key={variable}
                    className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 font-mono text-[11.5px] text-[var(--text-muted)]"
                  >
                    {`{{${variable}}}`}
                  </code>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[13px] font-medium text-[var(--text)]">Channels</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {["in_app", "email", "push", "sms"].map((channel) => (
                  <label key={channel} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.channels.includes(channel)}
                      onChange={(event) => {
                        setDraft({
                          ...draft,
                          channels: event.target.checked
                            ? [...draft.channels, channel]
                            : draft.channels.filter((item) => item !== channel),
                        });
                        setDirty(true);
                      }}
                      className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
                    />
                    <span className="text-[13px]">{channel.replace("_", "-")}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">
                A channel only sends if it is also enabled organization-wide in Settings.
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
          description="Rendered against sample data."
          footer={<Button variant="outline" onClick={() => setPreview(null)}>Close</Button>}
        >
          <div className="space-y-3">
            <div>
              <p className="text-[11.5px] uppercase text-[var(--text-subtle)]">Subject</p>
              <p className="text-[14px] font-medium text-[var(--text)]">{preview.subject}</p>
            </div>
            <div>
              <p className="text-[11.5px] uppercase text-[var(--text-subtle)]">Title</p>
              <p className="text-[14px] text-[var(--text)]">{preview.title}</p>
            </div>
            <div>
              <p className="text-[11.5px] uppercase text-[var(--text-subtle)]">Body</p>
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--text)]">
                {preview.body}
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
