"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, ShieldCheck, UserPlus, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatRelative } from "@/lib/format";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  DataTable,
  Input,
  Modal,
  NoAccessState,
  PageHeader,
  PersonCell,
  StatusBadge,
  TableToolbar,
  useToast,
  type Column,
} from "@/components/ui";

interface OrgUser {
  id: string;
  membershipId: string;
  email: string;
  fullName: string;
  status: string;
  emailVerified: boolean;
  lastLoginAt: string | null;
  roles: Array<{ id: string; name: string; isOwner: boolean }>;
  employee: { id: string; code: string; name: string } | null;
}

interface Role {
  id: string;
  name: string;
  key: string;
  description: string;
  isOwner: boolean;
  memberCount: number;
}

export default function UsersSettingsPage() {
  const { can, session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const state = useListState();

  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<OrgUser | null>(null);
  const [editingRoles, setEditingRoles] = useState<OrgUser | null>(null);
  const [signingOut, setSigningOut] = useState<OrgUser | null>(null);
  const [resettingMfa, setResettingMfa] = useState<OrgUser | null>(null);

  const { items, total, limit, isLoading, error, refetch } = useListQuery<OrgUser>(
    "org-users",
    "/users",
    state,
    { limit: 50, enabled: can("user.view") }
  );

  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data } = await api.get<Role[]>("/roles");
      return data;
    },
    enabled: can("role.view"),
  });

  const resend = useMutation({
    mutationFn: async (userId: string) => {
      await api.post(`/users/${userId}/resend-invitation`);
    },
    onSuccess: () => toast.success("Invitation resent"),
    onError: (err) => toast.fromError(err, "Could not resend that invitation."),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/users/${userId}`);
    },
    onSuccess: () => {
      toast.success("Access removed", "Their login still exists but no longer reaches this organization.");
      setRemoving(null);
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
    },
    onError: (err) => {
      toast.fromError(err, "Could not remove that person's access.");
      setRemoving(null);
    },
  });

  const revokeSessions = useMutation({
    mutationFn: async (userId: string) => (await api.post<{ revoked: number }>(`/users/${userId}/revoke-sessions`)).data,
    onSuccess: (data) => {
      toast.success("Signed out everywhere", `${data.revoked} session${data.revoked === 1 ? "" : "s"} ended. They will need to sign in again.`);
      setSigningOut(null);
    },
    onError: (err) => {
      toast.fromError(err, "Could not end their sessions.");
      setSigningOut(null);
    },
  });

  const resetMfa = useMutation({
    mutationFn: async (userId: string) => api.post(`/users/${userId}/reset-mfa`),
    onSuccess: () => {
      toast.success("Two-factor reset", "They can sign in with their password and set up a new authenticator.");
      setResettingMfa(null);
    },
    onError: (err) => {
      toast.fromError(err, "Could not reset two-factor for that user.");
      setResettingMfa(null);
    },
  });

  if (!can("user.view")) return <NoAccessState what="users" />;

  const columns: Array<Column<OrgUser>> = [
    {
      key: "name",
      header: "User",
      render: (row) => (
        <PersonCell
          name={row.fullName || row.email}
          subtitle={row.email}
          code={row.employee?.code}
        />
      ),
    },
    {
      key: "roles",
      header: "Roles",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.roles.map((role) => (
            <Badge key={role.id} tone={role.isOwner ? "brand" : "neutral"}>
              {role.name}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "lastLoginAt",
      header: "Last seen",
      hideBelow: "md",
      render: (row) => (row.lastLoginAt ? formatRelative(row.lastLoginAt) : "Never"),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.status === "invited" && can("user.invite") && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Mail className="h-3.5 w-3.5" />}
              onClick={(event) => {
                event.stopPropagation();
                resend.mutate(row.id);
              }}
            >
              Resend
            </Button>
          )}
          {can("role.assign") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                setEditingRoles(row);
              }}
            >
              Roles
            </Button>
          )}
          {can("user.update") && row.id !== session?.user.id && (
            <Button
              variant="ghost"
              size="sm"
              title="End every session this person has, on every device"
              onClick={(event) => {
                event.stopPropagation();
                setSigningOut(row);
              }}
            >
              Sign out
            </Button>
          )}
          {can("settings.manage_security") && row.id !== session?.user.id && (
            <Button
              variant="ghost"
              size="sm"
              title="Remove their second factor when they have lost their phone and recovery codes"
              onClick={(event) => {
                event.stopPropagation();
                setResettingMfa(row);
              }}
            >
              Reset 2FA
            </Button>
          )}
          {can("user.deactivate") && row.id !== session?.user.id && (
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--danger)]"
              onClick={(event) => {
                event.stopPropagation();
                setRemoving(row);
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in to this organization, and what each of them can do."
        actions={
          can("user.invite") && (
            <Button onClick={() => setInviting(true)} icon={<UserPlus className="h-4 w-4" />}>
              Invite user
            </Button>
          )
        }
      />

      <Callout tone="info" className="mb-5" icon={<ShieldCheck className="h-4 w-4" />}>
        Removing someone here revokes their access to this organization immediately — the token in
        their browser stops working on the next request. Their login survives, because they may
        belong to another organization.
      </Callout>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        page={state.page}
        limit={limit}
        total={total}
        onPageChange={state.setPage}
        emptyIcon={<Users className="h-6 w-6" />}
        emptyTitle="No users yet"
        emptyDescription="Invite your HR team and managers so they can start using the product."
        toolbar={
          <TableToolbar
            search={state.search}
            onSearchChange={state.setSearch}
            placeholder="Search by name or email"
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
          />
        }
      />

      <InviteDialog
        open={inviting}
        roles={roles || []}
        onClose={() => setInviting(false)}
        onDone={() => {
          setInviting(false);
          queryClient.invalidateQueries({ queryKey: ["org-users"] });
        }}
      />

      {editingRoles && (
        <RolesDialog
          user={editingRoles}
          roles={roles || []}
          onClose={() => setEditingRoles(null)}
          onDone={() => {
            setEditingRoles(null);
            queryClient.invalidateQueries({ queryKey: ["org-users"] });
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(signingOut)}
        onClose={() => setSigningOut(null)}
        onConfirm={() => {
          if (signingOut) revokeSessions.mutate(signingOut.id);
        }}
        loading={revokeSessions.isPending}
        title="Sign this person out everywhere?"
        confirmLabel="Sign out everywhere"
        message={
          signingOut ? (
            <>
              Every browser and app where <strong>{signingOut.fullName || signingOut.email}</strong> is signed in is ended straight away. Use this for a lost laptop or a suspected account takeover. Their access is unchanged — they can sign in again.
            </>
          ) : null
        }
      />

      <ConfirmDialog
        open={Boolean(resettingMfa)}
        onClose={() => setResettingMfa(null)}
        onConfirm={() => {
          if (resettingMfa) resetMfa.mutate(resettingMfa.id);
        }}
        loading={resetMfa.isPending}
        tone="danger"
        title="Reset two-factor authentication?"
        confirmLabel="Reset two-factor"
        message={
          resettingMfa ? (
            <>
              <strong>{resettingMfa.fullName || resettingMfa.email}</strong> will be able to sign in with just their password until they set up a new authenticator, and every current session of theirs is ended. Only do this after confirming with them directly — a request by email alone is exactly what an attacker would send.
            </>
          ) : null
        }
      />

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
        loading={remove.isPending}
        tone="danger"
        title="Remove this person's access?"
        confirmLabel="Remove access"
        message={
          removing ? (
            <>
              <strong>{removing.fullName || removing.email}</strong> will lose access to this
              organization straight away. Their employee record and history are kept.
            </>
          ) : null
        }
      />
    </>
  );
}

function InviteDialog({
  open,
  roles,
  onClose,
  onDone,
}: {
  open: boolean;
  roles: Role[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ email: "", firstName: "", lastName: "", roleIds: [] as string[] });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const invite = useMutation({
    mutationFn: async () => {
      await api.post("/users/invite", form);
    },
    onSuccess: () => {
      toast.success("Invitation sent", `${form.email} can now set their own password.`);
      setForm({ email: "", firstName: "", lastName: "", roleIds: [] });
      onDone();
    },
    onError: (error) => {
      if (error instanceof ApiError) setFieldErrors(error.fieldErrors);
      toast.fromError(error, "Could not send that invitation.");
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite someone"
      description="They will get an email with a link to set their own password."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={invite.isPending}
            disabled={!form.email || !form.roleIds.length}
            onClick={() => invite.mutate()}
          >
            Send invitation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Work email"
          type="email"
          required
          autoFocus
          value={form.email}
          error={fieldErrors["body.email"]}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            value={form.firstName}
            onChange={(event) => setForm({ ...form, firstName: event.target.value })}
          />
          <Input
            label="Last name"
            value={form.lastName}
            onChange={(event) => setForm({ ...form, lastName: event.target.value })}
          />
        </div>

        <div>
          <p className="text-[13px] font-medium text-[var(--text)]">Roles</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
            Roles decide exactly what they can see and do. Pick at least one.
          </p>
          <div className="mt-2 space-y-1.5">
            {roles.map((role) => (
              <label
                key={role.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-[var(--surface-muted)]"
              >
                <input
                  type="checkbox"
                  checked={form.roleIds.includes(role.id)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      roleIds: event.target.checked
                        ? [...form.roleIds, role.id]
                        : form.roleIds.filter((id) => id !== role.id),
                    })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
                />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-[var(--text)]">
                    {role.name}
                    {role.isOwner && (
                      <span className="ml-1.5 text-[11px] font-normal text-[var(--warning)]">
                        full access
                      </span>
                    )}
                  </span>
                  <span className="block text-[12px] text-[var(--text-muted)]">
                    {role.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RolesDialog({
  user,
  roles,
  onClose,
  onDone,
}: {
  user: OrgUser;
  roles: Role[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [roleIds, setRoleIds] = useState(user.roles.map((role) => role.id));

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/users/${user.id}`, { roleIds });
    },
    onSuccess: () => {
      toast.success("Roles updated", "The change takes effect on their next request.");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not change those roles."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Roles for ${user.fullName || user.email}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!roleIds.length} onClick={() => save.mutate()}>
            Save roles
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        {roles.map((role) => (
          <label
            key={role.id}
            className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-[var(--surface-muted)]"
          >
            <input
              type="checkbox"
              checked={roleIds.includes(role.id)}
              onChange={(event) =>
                setRoleIds(
                  event.target.checked
                    ? [...roleIds, role.id]
                    : roleIds.filter((id) => id !== role.id)
                )
              }
              className="mt-0.5 h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
            />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium text-[var(--text)]">{role.name}</span>
              <span className="block text-[12px] text-[var(--text-muted)]">{role.description}</span>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
