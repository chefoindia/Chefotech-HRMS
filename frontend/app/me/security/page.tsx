"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, Laptop, LogOut, Lock, ShieldCheck, ShieldOff, Smartphone, History } from "lucide-react";
import { api, tokens } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDateTime, formatRelative, humanise } from "@/lib/format";
import { saveBlob } from "@/lib/files";
import { Badge, Button, Callout, Card, CardHeader, ConfirmDialog, EmptyState, Input, Modal, PageHeader, PageLoader, useToast } from "@/components/ui";
import { ChangePasswordDialog } from "@/components/security/ChangePasswordDialog";

interface SecurityStatus {
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  recoveryCodesRemaining: number;
  enforced: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
}

interface SessionRow {
  id: string;
  device: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

interface HistoryRow {
  id: string;
  action: string;
  at: string;
  ip: string | null;
  device: string;
  description: string | null;
}

/**
 * Account security: two-factor authentication, password, active sessions
 * and sign-in history. Also where the shell sends someone who must act
 * before continuing — an expired password, or an organization that requires
 * a second factor for administrators.
 */
function SecurityPage() {
  const params = useSearchParams();
  const { session, signOut, refresh } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";

  const [changingPassword, setChangingPassword] = useState(params.get("expired") === "1");
  const [enrolling, setEnrolling] = useState(params.get("setup") === "1");
  const [disabling, setDisabling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const status = useQuery({
    queryKey: ["me", "security"],
    queryFn: async () => (await api.get<SecurityStatus>("/auth/security")).data,
  });

  const sessions = useQuery({
    queryKey: ["me", "sessions"],
    queryFn: async () => (await api.get<SessionRow[]>("/auth/sessions", { headers: { "X-Refresh-Token": tokens.getRefresh() || "" } })).data,
  });

  const history = useQuery({
    queryKey: ["me", "login-history"],
    queryFn: async () => (await api.get<HistoryRow[]>("/auth/login-history")).data,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      toast.success("Signed out of that device");
      queryClient.invalidateQueries({ queryKey: ["me", "sessions"] });
    },
    onError: (error) => toast.fromError(error, "Could not end that session."),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => (await api.post<{ revoked: number }>("/auth/sessions/revoke-others", { refreshToken: tokens.getRefresh() || undefined })).data,
    onSuccess: (data) => {
      toast.success(`Signed out of ${data.revoked} other device${data.revoked === 1 ? "" : "s"}`);
      setRevokingOthers(false);
      queryClient.invalidateQueries({ queryKey: ["me", "sessions"] });
    },
    onError: (error) => toast.fromError(error, "Could not end the other sessions."),
  });

  if (status.isLoading || !status.data) return <PageLoader label="Loading security settings" />;
  const s = status.data;
  const mustEnrol = Boolean(session?.mfaSetupRequired) && !s.mfaEnabled;

  return (
    <>
      <PageHeader title="Security" description="Two-factor authentication, your password, and every device signed in to your account." />

      {session?.passwordExpired && (
        <Callout tone="warning" className="mb-5" title="Your password is due for a change">
          Your organization requires a new password on a schedule. Choose one now to continue.
          <div className="mt-2">
            <Button size="sm" onClick={() => setChangingPassword(true)}>
              Change password
            </Button>
          </div>
        </Callout>
      )}
      {mustEnrol && (
        <Callout tone="warning" className="mb-5" title="Two-factor authentication is required for your account">
          Your organization requires administrators to sign in with a second factor. Set it up now; it takes about a minute with any authenticator app.
          <div className="mt-2">
            <Button size="sm" onClick={() => setEnrolling(true)}>
              Set up now
            </Button>
          </div>
        </Callout>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Two-factor authentication"
            description="A code from your phone at every sign-in, so a stolen password alone is not enough."
            action={s.mfaEnabled ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}
          />
          <div className="mt-4 space-y-3 text-[13.5px] text-[var(--text-muted)]">
            {s.mfaEnabled ? (
              <>
                <p>
                  Switched on {s.mfaEnabledAt ? formatRelative(s.mfaEnabledAt) : ""}. You have <strong className="text-[var(--text)]">{s.recoveryCodesRemaining}</strong> unused recovery code{s.recoveryCodesRemaining === 1 ? "" : "s"}.
                </p>
                {s.recoveryCodesRemaining <= 2 && <Callout tone="warning">You are running low on recovery codes. Generate a fresh set and store them somewhere safe.</Callout>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setRegenerating(true)}>
                    New recovery codes
                  </Button>
                  <Button variant="outline" size="sm" icon={<ShieldOff className="h-3.5 w-3.5" />} onClick={() => setDisabling(true)} disabled={s.enforced} title={s.enforced ? "Your organization requires two-factor for administrators" : undefined}>
                    Turn off
                  </Button>
                </div>
                {s.enforced && <p className="text-[12.5px]">Your organization requires this for administrators, so it cannot be switched off — only set up again with a new phone.</p>}
              </>
            ) : (
              <>
                <p>Works with Google Authenticator, Microsoft Authenticator, Authy, 1Password and any other app that reads a QR code.</p>
                <Button icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setEnrolling(true)}>
                  Set up two-factor authentication
                </Button>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Password" description="Changing it signs you out of every device." />
          <div className="mt-4 space-y-3 text-[13.5px] text-[var(--text-muted)]">
            <p>Last changed {s.passwordChangedAt ? formatRelative(s.passwordChangedAt) : "never"}.</p>
            <p>
              Last sign-in {s.lastLoginAt ? formatRelative(s.lastLoginAt) : "—"}
              {s.lastLoginIp ? ` from ${s.lastLoginIp}` : ""}.
            </p>
            <Button variant="outline" icon={<Lock className="h-4 w-4" />} onClick={() => setChangingPassword(true)}>
              Change password
            </Button>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Signed-in devices"
          description="Every browser and app with an active session on your account."
          action={
            (sessions.data?.length || 0) > 1 && (
              <Button variant="outline" size="sm" icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => setRevokingOthers(true)}>
                Sign out everywhere else
              </Button>
            )
          }
        />
        <div className="mt-3">
          {sessions.isLoading ? (
            <div className="skeleton h-24" />
          ) : !sessions.data?.length ? (
            <EmptyState title="No sessions" description="That is unexpected — try refreshing." />
          ) : (
            <ul className="divide-y">
              {sessions.data.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                  {/phone|android|ios|iphone|mobile/i.test(row.device + (row.userAgent || "")) ? <Smartphone className="h-4.5 w-4.5 text-[var(--text-subtle)]" aria-hidden /> : <Laptop className="h-4.5 w-4.5 text-[var(--text-subtle)]" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-[var(--text)]">
                      {row.device}
                      {row.current && <Badge tone="brand" className="ml-2">This device</Badge>}
                    </p>
                    <p className="text-[12.5px] text-[var(--text-muted)]">
                      {row.ip ? `${row.ip} · ` : ""}signed in {formatRelative(row.createdAt)} · last active {formatRelative(row.lastUsedAt)}
                    </p>
                  </div>
                  {!row.current && (
                    <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === row.id} onClick={() => revoke.mutate(row.id)}>
                      Sign out
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Recent security activity" description="Sign-ins and changes to your account, newest first." />
        <div className="mt-3">
          {history.isLoading ? (
            <div className="skeleton h-24" />
          ) : !history.data?.length ? (
            <p className="text-[13px] text-[var(--text-muted)]">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {history.data.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                  <History className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                  <span className="flex-1 text-[var(--text)]">
                    {HISTORY_LABELS[row.action] || humanise(row.action.replace(/^auth\./, ""))}
                    {row.description ? <span className="text-[var(--text-muted)]"> — {row.description}</span> : ""}
                  </span>
                  <span className="shrink-0 text-[12.5px] text-[var(--text-muted)]">
                    {row.device}
                    {row.ip ? ` · ${row.ip}` : ""} · {formatDateTime(row.at, { locale })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <ChangePasswordDialog open={changingPassword} forced={Boolean(session?.passwordExpired)} onClose={() => setChangingPassword(false)} onDone={signOut} />

      {enrolling && (
        <EnrolDialog
          onClose={() => setEnrolling(false)}
          onDone={async () => {
            setEnrolling(false);
            await refresh();
            queryClient.invalidateQueries({ queryKey: ["me", "security"] });
          }}
        />
      )}
      {disabling && (
        <DisableDialog
          onClose={() => setDisabling(false)}
          onDone={async () => {
            setDisabling(false);
            await refresh();
            queryClient.invalidateQueries({ queryKey: ["me", "security"] });
          }}
        />
      )}
      {regenerating && <RegenerateDialog onClose={() => setRegenerating(false)} onDone={() => queryClient.invalidateQueries({ queryKey: ["me", "security"] })} />}

      <ConfirmDialog
        open={revokingOthers}
        onClose={() => setRevokingOthers(false)}
        onConfirm={() => revokeOthers.mutate()}
        loading={revokeOthers.isPending}
        title="Sign out of every other device?"
        confirmLabel="Sign out everywhere else"
        message="Every other browser and app is signed out immediately. This device stays signed in."
      />
    </>
  );
}

const HISTORY_LABELS: Record<string, string> = {
  "auth.signed_in": "Signed in",
  "auth.account_locked": "Account locked after failed attempts",
  "auth.refresh_reuse_detected": "A session token was reused and all its sessions were ended",
  "auth.mfa_enabled": "Two-factor authentication switched on",
  "auth.mfa_disabled": "Two-factor authentication switched off",
  "auth.password_changed": "Password changed",
  "auth.password_reset": "Password reset",
  "auth.session_revoked": "A device was signed out",
  "auth.other_sessions_revoked": "Other devices were signed out",
};

function RecoveryCodes({ codes }: { codes: string[] }) {
  const toast = useToast();
  const text = codes.join("\n");
  return (
    <div className="space-y-3">
      <Callout tone="warning" title="Save these recovery codes now">
        Each one signs you in once if you lose your phone. They are shown only this once — store them in a password manager or print them.
      </Callout>
      <div className="grid grid-cols-2 gap-1.5 rounded-md border bg-[var(--surface-muted)] p-3 font-mono text-[13px] tracking-wider">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          icon={<Copy className="h-3.5 w-3.5" />}
          onClick={() => {
            navigator.clipboard.writeText(text).catch(() => undefined);
            toast.success("Copied");
          }}
        >
          Copy
        </Button>
        <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => saveBlob(new Blob([`ChefoTech HRMS recovery codes\n\n${text}\n`], { type: "text/plain" }), "chefotech-recovery-codes.txt")}>
          Download
        </Button>
      </div>
    </div>
  );
}

function EnrolDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const setup = useQuery({
    queryKey: ["me", "mfa-setup"],
    queryFn: async () => (await api.post<{ secret: string; otpauthUrl: string; qrDataUrl: string | null }>("/auth/mfa/setup")).data,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  const enable = useMutation({
    mutationFn: async () => (await api.post<{ enabled: boolean; recoveryCodes: string[] }>("/auth/mfa/enable", { token: code.trim() })).data,
    onSuccess: (data) => setRecoveryCodes(data.recoveryCodes),
    onError: (error) => toast.fromError(error, "That code did not match. Check the time on your phone and try the next code."),
  });

  return (
    <Modal
      open
      onClose={recoveryCodes ? () => undefined : onClose}
      title={recoveryCodes ? "Two-factor authentication is on" : "Set up two-factor authentication"}
      size="md"
      footer={
        recoveryCodes ? (
          <Button disabled={!saved} onClick={onDone}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={enable.isPending} disabled={code.replace(/\s/g, "").length !== 6 || !setup.data} onClick={() => enable.mutate()}>
              Verify and switch on
            </Button>
          </>
        )
      }
    >
      {recoveryCodes ? (
        <div className="space-y-4">
          <RecoveryCodes codes={recoveryCodes} />
          <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[var(--border-strong)] text-brand-600" />I have saved my recovery codes somewhere safe.
          </label>
        </div>
      ) : setup.isLoading ? (
        <div className="skeleton h-48" />
      ) : setup.error ? (
        <Callout tone="danger">{(setup.error as Error).message}</Callout>
      ) : setup.data ? (
        <div className="space-y-4">
          <ol className="list-decimal space-y-2 pl-5 text-[13.5px] text-[var(--text-muted)]">
            <li>Open your authenticator app and choose &quot;add account&quot; or the + button.</li>
            <li>Scan this QR code, or type the key below it.</li>
            <li>Enter the six-digit code the app shows.</li>
          </ol>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {setup.data.qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={setup.data.qrDataUrl} alt="QR code for your authenticator app" className="h-44 w-44 rounded-md border bg-white p-1" />
            ) : null}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[12px] font-medium uppercase tracking-wider text-[var(--text-subtle)]">Manual key</p>
              <p className="break-all rounded-md border bg-[var(--surface-muted)] p-2 font-mono text-[13px] tracking-wider">{setup.data.secret.match(/.{1,4}/g)?.join(" ")}</p>
              <p className="text-[12px] text-[var(--text-subtle)]">Time-based, 6 digits, 30 seconds — the defaults in every app.</p>
            </div>
          </div>
          <Input label="Code from the app" autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} className="text-[18px] tracking-[0.3em]" />
        </div>
      ) : null}
    </Modal>
  );
}

function DisableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const disable = useMutation({
    mutationFn: () => api.post("/auth/mfa/disable", { password, token: code.trim() }),
    onSuccess: () => {
      toast.success("Two-factor authentication is off");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not switch it off."),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Turn off two-factor authentication?"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Keep it on
          </Button>
          <Button variant="danger" loading={disable.isPending} disabled={!password || code.replace(/\s/g, "").length < 6} onClick={() => disable.mutate()}>
            Turn off
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="warning">Your password alone will be enough to sign in again. Confirm with your password and a current code.</Callout>
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input label="Code from your app, or a recovery code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
    </Modal>
  );
}

function RegenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const regenerate = useMutation({
    mutationFn: async () => (await api.post<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { token: code.trim() })).data,
    onSuccess: (data) => {
      setCodes(data.recoveryCodes);
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not generate new codes."),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={codes ? "Your new recovery codes" : "Generate new recovery codes"}
      size="sm"
      footer={
        codes ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={regenerate.isPending} disabled={code.replace(/\s/g, "").length < 6} onClick={() => regenerate.mutate()}>
              Generate
            </Button>
          </>
        )
      }
    >
      {codes ? (
        <RecoveryCodes codes={codes} />
      ) : (
        <div className="space-y-4">
          <p className="text-[13.5px] text-[var(--text-muted)]">Your existing recovery codes stop working the moment new ones are made.</p>
          <Input label="Code from your app" autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

export default function SecurityPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <SecurityPage />
    </Suspense>
  );
}
