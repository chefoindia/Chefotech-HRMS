"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Save, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { applyBranding, buildScale, readableTextColor } from "@/lib/theme";
import { computeCompleteness } from "@/lib/completeness";
import { CompletionBar } from "@/components/settings/CompletionBar";
import { cn } from "@/lib/utils";
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
  Textarea,
  useToast,
} from "@/components/ui";
import type { Branding } from "@/lib/types";

const ASSETS = [
  {
    key: "logo",
    field: "logoUrl",
    label: "Logo",
    hint: "Shown in the sidebar, on emails and on every generated document. PNG or SVG with a transparent background works best, around 400×120.",
  },
  {
    key: "favicon",
    field: "faviconUrl",
    label: "Favicon",
    hint: "The small icon in a browser tab. A square image, at least 64×64.",
  },
  {
    key: "loginBackground",
    field: "loginBackgroundUrl",
    label: "Sign-in background",
    hint: "Optional. Shown behind the sign-in form on large screens.",
  },
] as const;

/**
 * Branding.
 *
 * Changes are previewed live against the real interface — the colour picker
 * writes straight into the CSS variables the whole app reads, so what you see
 * while choosing is exactly what everyone gets after saving.
 *
 * Uploaded assets go to Google Drive and come back as lh3 URLs. That host is
 * the one Drive endpoint that behaves like a CDN: it returns the image bytes
 * with permissive CORS and honours a size hint, so a logo renders in an <img>
 * tag on the sign-in page before anyone has authenticated.
 */
export default function BrandingSettingsPage() {
  const { session, can, refresh } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [branding, setBranding] = useState<Partial<Branding>>({});
  const [dirty, setDirty] = useState(false);
  const originalRef = useRef<Partial<Branding> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["organization", "branding"],
    queryFn: async () => {
      const { data: payload } = await api.get<Branding>("/organizations/current/branding");
      return payload;
    },
  });

  useEffect(() => {
    if (data && !originalRef.current) {
      originalRef.current = data;
      setBranding(data);
    }
  }, [data]);

  // Preview against the live interface as the user picks.
  useEffect(() => {
    if (dirty) applyBranding(branding);
  }, [branding, dirty]);

  // Leaving without saving must not keep the preview colours.
  useEffect(() => {
    return () => {
      if (originalRef.current) applyBranding(originalRef.current);
    };
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      const { data: saved } = await api.patch<Branding>("/organizations/current/branding", {
        primaryColor: branding.primaryColor,
        secondaryColor: branding.secondaryColor,
        accentColor: branding.accentColor,
        sidebarStyle: branding.sidebarStyle,
        borderRadius: branding.borderRadius,
        loginHeadline: branding.loginHeadline,
        loginSubtext: branding.loginSubtext,
        emailFooterText: branding.emailFooterText,
        pdfFooterText: branding.pdfFooterText,
        showPoweredBy: branding.showPoweredBy,
      });
      return saved;
    },
    onSuccess: (saved) => {
      toast.success("Branding saved", "Everyone in your organization sees this now.");
      originalRef.current = saved;
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not save your branding."),
  });

  const upload = useMutation({
    mutationFn: async ({ asset, file }: { asset: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const { data: result } = await api.upload<{ url: string; asset: string }>(
        `/organizations/current/branding/${asset}`,
        formData
      );
      return result;
    },
    onSuccess: () => {
      toast.success("Uploaded");
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not upload that image."),
  });

  const remove = useMutation({
    mutationFn: async (asset: string) => {
      await api.delete(`/organizations/current/branding/${asset}`);
    },
    onSuccess: () => {
      toast.success("Removed");
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not remove that image."),
  });

  const set = <K extends keyof Branding>(key: K, value: Branding[K]) => {
    setBranding((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  if (!can("settings.manage_branding")) return <NoAccessState what="branding settings" />;
  if (isLoading) return <PageLoader label="Loading branding" />;

  const scale = branding.primaryColor ? buildScale(branding.primaryColor) : {};
  const wordingCompleteness = computeCompleteness(branding, [
    "loginHeadline",
    "loginSubtext",
    "emailFooterText",
    "pdfFooterText",
  ]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Images"
          description="Uploaded to your Drive folder and served from Google's image CDN."
        />

        <div className="mt-5 space-y-5">
          {ASSETS.map((asset) => {
            const url = (data as Record<string, unknown> | undefined)?.[asset.field] as string | null;

            return (
              <div
                key={asset.key}
                className="flex flex-col gap-4 border-b pb-5 last:border-0 last:pb-0 sm:flex-row sm:items-start"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-[var(--text)]">{asset.label}</p>
                  <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{asset.hint}</p>
                </div>

                <div className="flex items-center gap-3">
                  <div
                    className="grid h-16 w-32 shrink-0 place-items-center overflow-hidden rounded-[var(--radius)] border bg-[var(--surface-muted)]"
                    data-tour={asset.key === "logo" ? "branding-logo-preview" : undefined}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={asset.label}
                        className="max-h-full max-w-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-[var(--text-subtle)]" aria-hidden />
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[calc(var(--radius)-2px)] border border-[var(--border-strong)] px-3 text-[13px] font-medium hover:bg-[var(--surface-muted)]"
                      data-tour={asset.key === "logo" ? "branding-logo-upload" : undefined}
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden />
                      {url ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) upload.mutate({ asset: asset.key, file });
                          event.target.value = "";
                        }}
                      />
                    </label>

                    {url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => remove.mutate(asset.key)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Colours"
          description="Applied live as you choose, so you can see the result before saving."
          action={
            <Button
              size="sm"
              loading={save.isPending}
              disabled={!dirty}
              onClick={() => save.mutate()}
              icon={<Save className="h-3.5 w-3.5" />}
              data-tour="branding-save"
            >
              Save
            </Button>
          }
        />

        <div className="mt-5 space-y-5">
          <FieldGrid columns={3}>
            <ColorField
              label="Primary"
              hint="Buttons, links and highlights"
              value={branding.primaryColor || "#4F46E5"}
              onChange={(value) => set("primaryColor", value)}
            />
            <ColorField
              label="Accent"
              hint="Charts and secondary highlights"
              value={branding.accentColor || "#06B6D4"}
              onChange={(value) => set("accentColor", value)}
            />
            <ColorField
              label="Secondary"
              hint="Used in emails and documents"
              value={branding.secondaryColor || "#0F172A"}
              onChange={(value) => set("secondaryColor", value)}
            />
          </FieldGrid>

          {Object.keys(scale).length > 0 && (
            <div>
              <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-[var(--text-subtle)]">
                Derived palette
              </p>
              <div className="flex overflow-hidden rounded-[var(--radius)] border">
                {Object.entries(scale).map(([step, colour]) => (
                  <div
                    key={step}
                    className="flex h-12 flex-1 items-end justify-center pb-1 text-[10px] font-medium"
                    style={{ background: colour, color: readableTextColor(colour) }}
                    title={`${step}: ${colour}`}
                  >
                    {step}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
                Tints are interpolated in OKLCH from your primary colour, so the lighter steps stay
                saturated instead of going grey.
              </p>
            </div>
          )}

          <FieldGrid columns={2}>
            <Select
              label="Sidebar style"
              value={branding.sidebarStyle || "dark"}
              onChange={(event) => set("sidebarStyle", event.target.value as Branding["sidebarStyle"])}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "brand", label: "Brand colour" },
              ]}
            />
            <Select
              label="Corner rounding"
              value={branding.borderRadius || "medium"}
              onChange={(event) =>
                set("borderRadius", event.target.value as Branding["borderRadius"])
              }
              options={[
                { value: "none", label: "Square" },
                { value: "small", label: "Slightly rounded" },
                { value: "medium", label: "Rounded" },
                { value: "large", label: "Very rounded" },
              ]}
            />
          </FieldGrid>
        </div>
      </Card>

      <Card>
        <CardHeader title="Wording" description="Text that appears outside the application." />
        <div className="mt-3">
          <CompletionBar {...wordingCompleteness} label="Custom text set" />
        </div>

        <div className="mt-5 space-y-4">
          <Input
            label="Sign-in headline"
            value={branding.loginHeadline || ""}
            onChange={(event) => set("loginHeadline", event.target.value)}
            placeholder="Welcome back"
          />
          <Input
            label="Sign-in subtext"
            value={branding.loginSubtext || ""}
            onChange={(event) => set("loginSubtext", event.target.value)}
          />
          <Textarea
            label="Email footer"
            value={branding.emailFooterText || ""}
            onChange={(event) => set("emailFooterText", event.target.value)}
            placeholder="Appears at the bottom of every email we send on your behalf."
            rows={2}
          />
          <Textarea
            label="Document footer"
            value={branding.pdfFooterText || ""}
            onChange={(event) => set("pdfFooterText", event.target.value)}
            placeholder="Appears at the bottom of generated letters and payslips."
            rows={2}
          />

          <Switch
            label="Show “Powered by Chefotech”"
            hint="Turn this off to white-label the interface for your employees."
            checked={branding.showPoweredBy !== false}
            onChange={(value) => set("showPoweredBy", value)}
          />
        </div>
      </Card>

      {dirty && (
        <div className="sticky bottom-4 z-10">
          <Callout tone="info" className="flex items-center justify-between gap-4 shadow-lg">
            <span>You are previewing unsaved changes.</span>
            <span className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (originalRef.current) {
                    setBranding(originalRef.current);
                    applyBranding(originalRef.current);
                  }
                  setDirty(false);
                }}
              >
                Discard
              </Button>
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
                Save branding
              </Button>
            </span>
          </Callout>
        </div>
      )}
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--text)]">{label}</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} colour`}
          className="h-9 w-12 cursor-pointer rounded border border-[var(--border-strong)] bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} hex value`}
          className={cn("input-base font-mono text-[13px] uppercase")}
        />
      </div>
      <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}
