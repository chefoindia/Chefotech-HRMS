"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { computeCompleteness } from "@/lib/completeness";
import { CompletionBar } from "@/components/settings/CompletionBar";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  FieldGrid,
  FieldHelp,
  FieldSet,
  Input,
  NoAccessState,
  PageLoader,
  Select,
  Switch,
  useToast,
} from "@/components/ui";
import type { Organization } from "@/lib/types";

interface SettingDefinition {
  key: string;
  group: string;
  label: string;
  description: string | null;
  help: { why: string; example?: string | null } | null;
  type: string;
  options: Array<{ value: string | number | boolean; label: string }> | null;
  validation: { min?: number; max?: number; maxLength?: number } | null;
  dependsOn: { key: string; equals: unknown } | null;
  default: unknown;
  value: unknown;
  isDefault: boolean;
}

/**
 * Organization settings.
 *
 * The company profile is a normal form. Everything below it is rendered from
 * the settings registry the API returns — type, label, options, validation and
 * all — so a new configurable value appears here automatically without a
 * frontend change. That is what "configuration-driven" has to mean to be worth
 * anything.
 */
export default function OrganizationSettingsPage() {
  const { session, can, refresh } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [profile, setProfile] = useState<Partial<Organization>>({});
  const [dirtySettings, setDirtySettings] = useState<Record<string, unknown>>({});

  const { data: organization, isLoading } = useQuery({
    queryKey: ["organization", "current"],
    queryFn: async () => {
      const { data } = await api.get<Organization>("/organizations/current");
      return data;
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["settings", "all"],
    queryFn: async () => {
      const { data } = await api.get<{
        groups: Array<{ key: string; label: string; canEdit: boolean }>;
        settings: SettingDefinition[];
      }>("/settings");
      return data;
    },
    enabled: can("settings.view"),
  });

  useEffect(() => {
    if (organization) setProfile(organization);
  }, [organization]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch<Organization>("/organizations/current", {
        name: profile.name,
        legalName: profile.legalName,
        registrationNumber: profile.registrationNumber,
        taxId: profile.taxId,
        industry: profile.industry,
        businessType: profile.businessType,
        companySize: profile.companySize,
        website: profile.website,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        timezone: profile.timezone,
        currency: profile.currency,
      });
      return data;
    },
    onSuccess: () => {
      toast.success("Company profile saved");
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not save the company profile."),
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      await api.patch("/settings", dirtySettings);
    },
    onSuccess: () => {
      toast.success("Settings saved", "These apply from the next calculation onwards.");
      setDirtySettings({});
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => toast.fromError(error, "Could not save those settings."),
  });

  if (!can("settings.view")) return <NoAccessState what="organization settings" />;
  if (isLoading) return <PageLoader label="Loading settings" />;

  const canEditProfile = can("settings.manage");
  const groupedSettings = groupBy(settings?.settings || [], (setting) => setting.group);
  const groupLabels = Object.fromEntries((settings?.groups || []).map((g) => [g.key, g]));

  const profileCompleteness = computeCompleteness(profile, [
    "legalName",
    "registrationNumber",
    "taxId",
    "website",
    "email",
    "phone",
    "address.line1",
    "address.city",
    "address.state",
    "address.postalCode",
    "timezone",
    "currency",
  ]);

  const valueOf = (setting: SettingDefinition) =>
    setting.key in dirtySettings ? dirtySettings[setting.key] : setting.value;

  const isVisible = (setting: SettingDefinition) => {
    if (!setting.dependsOn) return true;
    const parent = (settings?.settings || []).find((s) => s.key === setting.dependsOn!.key);
    if (!parent) return true;
    return valueOf(parent) === setting.dependsOn.equals;
  };

  return (
    <div className="space-y-5">
      {/* ── Company profile ──────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Company profile"
          description="Appears on documents, payslips and emails."
          action={
            canEditProfile && (
              <Button
                size="sm"
                loading={saveProfile.isPending}
                onClick={() => saveProfile.mutate()}
                icon={<Save className="h-3.5 w-3.5" />}
              >
                Save
              </Button>
            )
          }
        />

        <div className="mt-3">
          <CompletionBar {...profileCompleteness} />
        </div>

        <div className="mt-5 space-y-5">
          <FieldSet title="Identity">
            <FieldGrid columns={2}>
              <Input
                label="Company name"
                value={profile.name || ""}
                disabled={!canEditProfile}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
              />
              <Input
                label="Legal name"
                value={profile.legalName || ""}
                disabled={!canEditProfile}
                onChange={(event) => setProfile({ ...profile, legalName: event.target.value })}
                hint="Used on letters and certificates."
              />
              <Input
                label="Registration number"
                value={profile.registrationNumber || ""}
                disabled={!canEditProfile}
                onChange={(event) =>
                  setProfile({ ...profile, registrationNumber: event.target.value })
                }
              />
              <Input
                label="Tax ID / GSTIN"
                value={profile.taxId || ""}
                disabled={!canEditProfile}
                onChange={(event) => setProfile({ ...profile, taxId: event.target.value })}
              />
            </FieldGrid>
          </FieldSet>

          <FieldSet title="Contact">
            <FieldGrid columns={3}>
              <Input
                label="Email"
                type="email"
                value={profile.email || ""}
                disabled={!canEditProfile}
                onChange={(event) => setProfile({ ...profile, email: event.target.value })}
              />
              <Input
                label="Phone"
                value={profile.phone || ""}
                disabled={!canEditProfile}
                onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
              />
              <Input
                label="Website"
                value={profile.website || ""}
                disabled={!canEditProfile}
                onChange={(event) => setProfile({ ...profile, website: event.target.value })}
              />
            </FieldGrid>

            <FieldGrid columns={2}>
              <Input
                label="Address"
                value={profile.address?.line1 || ""}
                disabled={!canEditProfile}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    address: { ...(profile.address || ({} as never)), line1: event.target.value },
                  })
                }
              />
              <Input
                label="City"
                value={profile.address?.city || ""}
                disabled={!canEditProfile}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    address: { ...(profile.address || ({} as never)), city: event.target.value },
                  })
                }
              />
              <Input
                label="State"
                value={profile.address?.state || ""}
                disabled={!canEditProfile}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    address: { ...(profile.address || ({} as never)), state: event.target.value },
                  })
                }
              />
              <Input
                label="Postal code"
                value={profile.address?.postalCode || ""}
                disabled={!canEditProfile}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    address: {
                      ...(profile.address || ({} as never)),
                      postalCode: event.target.value,
                    },
                  })
                }
              />
            </FieldGrid>
          </FieldSet>

          <FieldSet
            title="Locale"
            description="Attendance days, payroll periods and every date in the product are calculated in this zone."
          >
            <FieldGrid columns={2}>
              <Input
                label="Time zone"
                value={profile.timezone || ""}
                disabled={!canEditProfile}
                onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}
                hint="For example Asia/Kolkata"
              />
              <Input
                label="Currency"
                value={profile.currency || ""}
                disabled={!canEditProfile}
                onChange={(event) =>
                  setProfile({ ...profile, currency: event.target.value.toUpperCase() })
                }
                hint="Three-letter code, for example INR"
              />
            </FieldGrid>
          </FieldSet>
        </div>
      </Card>

      {/* ── Registry-driven settings ─────────────────────────────────── */}
      {Object.entries(groupedSettings).map(([group, groupSettings]) => {
        const meta = groupLabels[group];
        const editable = meta?.canEdit !== false;

        return (
          <Card key={group}>
            <CardHeader
              title={meta?.label || group}
              description={
                editable
                  ? undefined
                  : "You can see these settings but your role cannot change them."
              }
            />

            <div className="mt-5 space-y-5">
              {groupSettings.filter(isVisible).map((setting) => (
                <SettingControl
                  key={setting.key}
                  setting={setting}
                  value={valueOf(setting)}
                  disabled={!editable}
                  onChange={(value) =>
                    setDirtySettings((current) => ({ ...current, [setting.key]: value }))
                  }
                />
              ))}
            </div>
          </Card>
        );
      })}

      {Object.keys(dirtySettings).length > 0 && (
        <div className="sticky bottom-4 z-10">
          <Callout tone="info" className="flex items-center justify-between gap-4 shadow-lg">
            <span>
              {Object.keys(dirtySettings).length}{" "}
              {Object.keys(dirtySettings).length === 1 ? "setting" : "settings"} changed and not
              yet saved.
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDirtySettings({})}>
                Discard
              </Button>
              <Button size="sm" loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
                Save changes
              </Button>
            </span>
          </Callout>
        </div>
      )}
    </div>
  );
}

function SettingControl({
  setting,
  value,
  disabled,
  onChange,
}: {
  setting: SettingDefinition;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  // Every registry setting carries a `help` block explaining what it changes
  // downstream plus a worked example, surfaced through this one icon so the
  // consequence of a choice is readable before it is saved.
  const helpIcon = setting.help ? <FieldHelp label={setting.label} help={setting.help} /> : undefined;

  if (setting.type === "boolean") {
    return (
      <Switch
        label={setting.label}
        labelSuffix={helpIcon}
        hint={setting.description || undefined}
        checked={Boolean(value)}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (setting.type === "enum") {
    return (
      <Select
        label={setting.label}
        labelSuffix={helpIcon}
        hint={setting.description || undefined}
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(event) => {
          const option = setting.options?.find((o) => String(o.value) === event.target.value);
          onChange(option ? option.value : event.target.value);
        }}
        options={(setting.options || []).map((option) => ({
          value: String(option.value),
          label: option.label,
        }))}
      />
    );
  }

  if (setting.type === "multienum") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div>
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]">
          <span>{setting.label}</span>
          {helpIcon}
        </p>
        {setting.description && (
          <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{setting.description}</p>
        )}
        <div className="mt-2 space-y-1.5">
          {(setting.options || []).map((option) => (
            <Checkbox
              key={String(option.value)}
              label={option.label}
              disabled={disabled}
              checked={selected.includes(String(option.value))}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, String(option.value)]
                  : selected.filter((item) => item !== String(option.value));
                onChange(next);
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (setting.type === "array") {
    return (
      <Input
        label={setting.label}
        labelSuffix={helpIcon}
        hint={setting.description || "Separate values with commas"}
        disabled={disabled}
        value={Array.isArray(value) ? value.join(", ") : ""}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
              .map((item) => (Number.isNaN(Number(item)) ? item : Number(item)))
          )
        }
      />
    );
  }

  return (
    <Input
      label={setting.label}
      labelSuffix={helpIcon}
      hint={setting.description || undefined}
      disabled={disabled}
      type={setting.type === "number" ? "number" : setting.type === "time" ? "time" : "text"}
      min={setting.validation?.min}
      max={setting.validation?.max}
      value={String(value ?? "")}
      onChange={(event) =>
        onChange(setting.type === "number" ? Number(event.target.value) : event.target.value)
      }
    />
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((accumulator, item) => {
    const group = key(item);
    (accumulator[group] = accumulator[group] || []).push(item);
    return accumulator;
  }, {});
}
