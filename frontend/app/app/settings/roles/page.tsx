"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Save, ShieldCheck } from "lucide-react";
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
  NoAccessState,
  PageLoader,
  Textarea,
  useToast,
} from "@/components/ui";

interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isOwner: boolean;
  isSystem: boolean;
  isDefault: boolean;
  memberCount: number;
}

interface PermissionGroup {
  key: string;
  label: string;
  permissions: Array<[string, string]>;
}

/**
 * Roles and permissions.
 *
 * The permission catalog comes from the API, so a capability added on the
 * server shows up here without a frontend change. Nothing in the product keys
 * off a role's NAME — only off the permissions attached to it — which is why
 * a tenant can rename "HR Admin" to "People Ops" and nothing breaks.
 */
export default function RolesSettingsPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Role | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: roles, isLoading } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data } = await api.get<Role[]>("/roles");
      return data;
    },
    enabled: can("role.view"),
  });

  const { data: catalog } = useQuery({
    queryKey: ["roles", "permissions"],
    queryFn: async () => {
      const { data } = await api.get<PermissionGroup[]>("/roles/permissions");
      return data;
    },
    enabled: can("role.view"),
    staleTime: 30 * 60_000,
  });

  useEffect(() => {
    if (!roles?.length) return;
    const target = roles.find((role) => role.id === selectedId) || roles[0];
    setSelectedId(target.id);
    setDraft(structuredClone(target));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, selectedId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api.patch(`/roles/${draft.id}`, {
        name: draft.name,
        description: draft.description,
        permissions: draft.permissions,
      });
    },
    onSuccess: () => {
      toast.success("Role saved", "Everyone with this role picks up the change within seconds.");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (error) => toast.fromError(error, "Could not save this role."),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Role>("/roles", {
        name: "New role",
        permissions: ["dashboard.view", "profile.view_own"],
      });
      return data;
    },
    onSuccess: (role) => {
      toast.success("Role created", "Now choose what it can do.");
      setSelectedId(role.id);
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (error) => toast.fromError(error, "Could not create a role."),
  });

  if (!can("role.view")) return <NoAccessState what="roles" />;
  if (isLoading || !draft) return <PageLoader label="Loading roles" />;

  const canManage = can("role.manage");
  const permissionSet = new Set(draft.permissions);

  const toggle = (permission: string, enabled: boolean) => {
    setDraft((current) => {
      if (!current) return current;
      const next = new Set(current.permissions);
      if (enabled) next.add(permission);
      else next.delete(permission);
      return { ...current, permissions: [...next] };
    });
    setDirty(true);
  };

  const toggleGroup = (group: PermissionGroup, enabled: boolean) => {
    setDraft((current) => {
      if (!current) return current;
      const next = new Set(current.permissions);
      for (const [key] of group.permissions) {
        if (enabled) next.add(key);
        else next.delete(key);
      }
      return { ...current, permissions: [...next] };
    });
    setDirty(true);
  };

  return (
    <div className="lg:flex lg:gap-6">
      {/* ── Role list ─────────────────────────────────────────────── */}
      <div className="mb-5 lg:mb-0 lg:w-64 lg:shrink-0">
        <div className="space-y-1">
          {roles?.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedId(role.id)}
              className={cn(
                "w-full rounded-[var(--radius)] border p-3 text-left transition-colors",
                role.id === selectedId ? "border-brand-300 bg-brand-50" : "hover:bg-[var(--surface-muted)]"
              )}
            >
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--text)]">
                  {role.name}
                </p>
                {role.isOwner && <Lock className="h-3.5 w-3.5 text-[var(--warning)]" aria-hidden />}
              </div>
              <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                {role.permissions.length} permissions
                {role.isDefault && " · default for new employees"}
              </p>
            </button>
          ))}
        </div>

        {canManage && (
          <Button
            variant="outline"
            size="sm"
            fullWidth
            className="mt-3"
            loading={create.isPending}
            onClick={() => create.mutate()}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            New role
          </Button>
        )}
      </div>

      {/* ── Editor ────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-5">
        <Card>
          <CardHeader
            title={draft.name}
            description={
              draft.isOwner
                ? "The Owner role always has full access and cannot be narrowed."
                : draft.isSystem
                  ? "A built-in role. You can edit it freely, but it cannot be deleted."
                  : "A role you created."
            }
            action={
              canManage &&
              !draft.isOwner && (
                <Button
                  size="sm"
                  loading={save.isPending}
                  disabled={!dirty}
                  onClick={() => save.mutate()}
                  icon={<Save className="h-3.5 w-3.5" />}
                >
                  Save
                </Button>
              )
            }
          />

          <div className="mt-5 space-y-4">
            <Input
              label="Name"
              value={draft.name}
              disabled={!canManage}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
                setDirty(true);
              }}
            />
            <Textarea
              label="Description"
              value={draft.description}
              disabled={!canManage}
              rows={2}
              onChange={(event) => {
                setDraft({ ...draft, description: event.target.value });
                setDirty(true);
              }}
            />
          </div>
        </Card>

        {draft.isOwner && (
          <Callout tone="warning" icon={<ShieldCheck className="h-4 w-4" />}>
            Owner permissions are fixed. Without at least one Owner, nobody could restore access
            to the organization — so the role cannot be narrowed and the last Owner cannot be
            removed.
          </Callout>
        )}

        {catalog?.map((group) => {
          const groupKeys = group.permissions.map(([key]) => key);
          const allOn = groupKeys.every((key) => permissionSet.has(key));
          const someOn = groupKeys.some((key) => permissionSet.has(key));

          return (
            <Card key={group.key}>
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-semibold text-[var(--text)]">{group.label}</h3>

                {canManage && !draft.isOwner && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group, !allOn)}
                    className="text-[12.5px] font-medium text-brand-600 hover:underline"
                  >
                    {allOn ? "Clear all" : "Select all"}
                  </button>
                )}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {group.permissions.map(([key, description]) => (
                  <label
                    key={key}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-md p-2",
                      canManage && !draft.isOwner && "hover:bg-[var(--surface-muted)]",
                      draft.isOwner && "cursor-not-allowed opacity-70"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={permissionSet.has(key)}
                      disabled={!canManage || draft.isOwner}
                      onChange={(event) => toggle(key, event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] text-[var(--text)]">{description}</span>
                      <span className="block font-mono text-[11px] text-[var(--text-subtle)]">
                        {key}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {someOn && !allOn && (
                <Badge tone="brand" className="mt-3">
                  {groupKeys.filter((key) => permissionSet.has(key)).length} of {groupKeys.length}
                </Badge>
              )}
            </Card>
          );
        })}

        {dirty && canManage && !draft.isOwner && (
          <div className="sticky bottom-4 z-10">
            <Callout tone="info" className="flex items-center justify-between gap-4 shadow-lg">
              <span>
                {draft.permissions.length} permissions selected, not yet saved.
              </span>
              <span className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const original = roles?.find((role) => role.id === selectedId);
                    if (original) setDraft(structuredClone(original));
                    setDirty(false);
                  }}
                >
                  Discard
                </Button>
                <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
                  Save role
                </Button>
              </span>
            </Callout>
          </div>
        )}
      </div>
    </div>
  );
}
