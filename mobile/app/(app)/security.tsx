import { useEffect, useState } from "react";
import { Alert, RefreshControl, Share, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import { useChangePassword, useLoginHistory, useMfaDisable, useMfaEnable, useMfaRecoveryCodes, useMfaSetup, useRevokeOtherSessions, useRevokeSession, useSecurityStatus, useSessions } from "../../src/api/hooks";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, Field, Loading, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { CheckRow, Note, Sheet } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { ApiError } from "../../src/api/client";
import { dateTimeLabel, humanise, relative } from "../../src/lib/format";

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

/**
 * Account security — the web portal's /me/security: two-factor
 * authentication, your password, every device signed in, and recent
 * activity. Also where an expired password or an enforced second factor
 * sends you.
 */
export default function SecurityScreen() {
  const colors = useColors();
  const router = useRouter();
  const toast = useToast();
  const { session, signOut, refresh } = useSession();
  const status = useSecurityStatus();
  const sessions = useSessions();
  const history = useLoginHistory();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [changingPassword, setChangingPassword] = useState(Boolean(session?.passwordExpired));
  const [enrolling, setEnrolling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const s = status.data;
  const mustEnrol = Boolean(session?.mfaSetupRequired) && s && !s.mfaEnabled;

  const confirmRevokeOthers = () =>
    Alert.alert("Sign out of every other device?", "Every other browser and app is signed out immediately. This phone stays signed in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out everywhere else", style: "destructive", onPress: () => revokeOthers.mutateAsync(undefined).then((r) => toast.success(`Signed out of ${r.revoked} other device${r.revoked === 1 ? "" : "s"}.`)).catch((e) => toast.error(e instanceof ApiError ? e.message : "Could not end the other sessions.")) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={status.isRefetching}
            onRefresh={() => {
              status.refetch();
              sessions.refetch();
              history.refetch();
            }}
            tintColor={colors.brand[600]}
          />
        }
      >
        <ScreenHeader title="Security" />

        {session?.passwordExpired && (
          <Note tone="warning">Your password is due for a change. Your organization requires a new password on a schedule — choose one now to continue.</Note>
        )}
        {mustEnrol && <Note tone="warning">Two-factor authentication is required for your account. Set it up now; it takes about a minute with any authenticator app.</Note>}

        {status.isLoading || !s ? (
          <Loading label="Loading security settings…" />
        ) : (
          <>
            <SectionHeader title="Two-factor authentication" action={s.mfaEnabled ? <Badge label="On" tone="success" /> : <Badge label="Off" tone="neutral" />} />
            <Card>
              {s.mfaEnabled ? (
                <>
                  <Txt variant="body" tone="muted" style={{ lineHeight: 21 }}>
                    Switched on {s.mfaEnabledAt ? relative(s.mfaEnabledAt) : ""}. You have <Txt variant="bodyMedium">{s.recoveryCodesRemaining}</Txt> unused recovery code{s.recoveryCodesRemaining === 1 ? "" : "s"}.
                  </Txt>
                  {s.recoveryCodesRemaining <= 2 && (
                    <View style={{ marginTop: spacing.md }}>
                      <Note tone="warning">You are running low on recovery codes. Generate a fresh set and store them somewhere safe.</Note>
                    </View>
                  )}
                  <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Button title="New recovery codes" variant="secondary" size="sm" icon="key-outline" onPress={() => setRegenerating(true)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button title="Turn off" variant="secondary" size="sm" icon="shield-outline" onPress={() => setDisabling(true)} disabled={s.enforced} />
                    </View>
                  </View>
                  {s.enforced && (
                    <Txt variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
                      Your organization requires this for administrators, so it cannot be switched off — only set up again with a new phone.
                    </Txt>
                  )}
                </>
              ) : (
                <>
                  <Txt variant="body" tone="muted" style={{ lineHeight: 21, marginBottom: spacing.md }}>
                    A code from an authenticator app at every sign-in, so a stolen password alone is not enough. Works with Google Authenticator, Microsoft Authenticator, Authy, 1Password and any other app that reads a QR code.
                  </Txt>
                  <Button title="Set up two-factor authentication" icon="shield-checkmark-outline" onPress={() => setEnrolling(true)} />
                </>
              )}
            </Card>

            <SectionHeader title="Password" />
            <Card>
              <Txt variant="body" tone="muted" style={{ lineHeight: 21 }}>
                Last changed {s.passwordChangedAt ? relative(s.passwordChangedAt) : "never"}. Last sign-in {s.lastLoginAt ? relative(s.lastLoginAt) : "—"}
                {s.lastLoginIp ? ` from ${s.lastLoginIp}` : ""}.
              </Txt>
              <Button title="Change password" variant="secondary" icon="lock-closed-outline" onPress={() => setChangingPassword(true)} style={{ marginTop: spacing.md }} />
            </Card>

            <SectionHeader title="Signed-in devices" action={(sessions.data?.length || 0) > 1 ? <Button title="Sign out everywhere else" variant="ghost" size="sm" onPress={confirmRevokeOthers} loading={revokeOthers.isPending} /> : undefined} />
            <Card>
              {sessions.isLoading ? (
                <Loading />
              ) : !sessions.data?.length ? (
                <Txt variant="caption" tone="muted">
                  No sessions — try refreshing.
                </Txt>
              ) : (
                sessions.data.map((row, index) => (
                  <View key={row.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
                    <Ionicons name={/phone|android|ios|iphone|mobile/i.test(row.device + (row.userAgent || "")) ? "phone-portrait-outline" : "laptop-outline"} size={18} color={colors.textSubtle} style={{ marginRight: spacing.md }} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
                          {row.device}
                        </Txt>
                        {row.current && <Badge label="This device" tone="brand" />}
                      </View>
                      <Txt variant="caption" tone="muted">
                        {row.ip ? `${row.ip} · ` : ""}signed in {relative(row.createdAt)} · last active {relative(row.lastUsedAt)}
                      </Txt>
                    </View>
                    {!row.current && <Button title="Sign out" variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === row.id} onPress={() => revoke.mutateAsync(row.id).then(() => toast.success("Signed out of that device.")).catch(() => toast.error("Could not end that session."))} />}
                  </View>
                ))
              )}
            </Card>

            <SectionHeader title="Recent security activity" />
            <Card>
              {history.isLoading ? (
                <Loading />
              ) : !history.data?.length ? (
                <Txt variant="caption" tone="muted">
                  Nothing recorded yet.
                </Txt>
              ) : (
                history.data.map((row, index) => (
                  <View key={row.id} style={{ paddingVertical: spacing.sm, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
                    <Txt variant="label">
                      {HISTORY_LABELS[row.action] || humanise(row.action.replace(/^auth\./, ""))}
                      {row.description ? <Txt variant="caption" tone="muted"> — {row.description}</Txt> : null}
                    </Txt>
                    <Txt variant="caption" tone="subtle">
                      {row.device}
                      {row.ip ? ` · ${row.ip}` : ""} · {dateTimeLabel(row.at)}
                    </Txt>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </Screen>

      {changingPassword && (
        <ChangePasswordSheet
          forced={Boolean(session?.passwordExpired)}
          onClose={() => setChangingPassword(false)}
          onDone={async () => {
            setChangingPassword(false);
            await signOut();
            router.replace("/(auth)/login");
          }}
        />
      )}
      {enrolling && (
        <EnrolSheet
          onClose={() => setEnrolling(false)}
          onDone={async () => {
            setEnrolling(false);
            await refresh();
            status.refetch();
          }}
        />
      )}
      {disabling && (
        <DisableSheet
          onClose={() => setDisabling(false)}
          onDone={async () => {
            setDisabling(false);
            await refresh();
            status.refetch();
          }}
        />
      )}
      {regenerating && <RegenerateSheet onClose={() => setRegenerating(false)} />}
    </SafeAreaView>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const colors = useColors();
  const toast = useToast();
  const text = codes.join("\n");
  return (
    <View>
      <Note tone="warning">Save these recovery codes now. Each one signs you in once if you lose your phone. They are shown only this once — store them in a password manager.</Note>
      <View style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md }}>
        {codes.map((code) => (
          <Txt key={code} variant="body" style={{ width: "50%", paddingVertical: 3, fontFamily: "monospace", letterSpacing: 1 }}>
            {code}
          </Txt>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Button
            title="Copy"
            variant="secondary"
            size="sm"
            icon="copy-outline"
            onPress={() => {
              Clipboard.setStringAsync(text)
                .then(() => toast.success("Copied."))
                .catch(() => toast.error("Could not copy."));
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Share / save" variant="secondary" size="sm" icon="share-outline" onPress={() => Share.share({ message: `Chefotech HRMS recovery codes\n\n${text}` }).catch(() => undefined)} />
        </View>
      </View>
    </View>
  );
}

function ChangePasswordSheet({ forced, onClose, onDone }: { forced: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const change = useChangePassword();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await change.mutateAsync({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success("Password changed. You will be signed out of every device.");
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not change your password.");
    }
  };

  return (
    <Sheet
      open
      onClose={forced ? () => undefined : onClose}
      title={forced ? "Choose a new password" : "Change your password"}
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {!forced && (
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="secondary" onPress={onClose} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Button title="Change password" onPress={submit} loading={change.isPending} disabled={!form.currentPassword || !form.newPassword || form.newPassword !== form.confirm} />
          </View>
        </View>
      }
    >
      {error && <Note tone="danger">{error}</Note>}
      <Note tone="info">{`${forced ? "Your organization requires a new password on a schedule, and yours is due. " : ""}Changing your password signs you out everywhere, including this phone.`}</Note>
      <Field label="Current password" secureTextEntry autoCapitalize="none" value={form.currentPassword} onChangeText={(v) => setForm({ ...form, currentPassword: v })} />
      <Field label="New password" secureTextEntry autoCapitalize="none" value={form.newPassword} onChangeText={(v) => setForm({ ...form, newPassword: v })} hint="With an uppercase letter, a lowercase letter and a number. Your organization sets the minimum length." />
      <Field label="Confirm new password" secureTextEntry autoCapitalize="none" value={form.confirm} onChangeText={(v) => setForm({ ...form, confirm: v })} error={form.confirm && form.newPassword !== form.confirm ? "These do not match" : undefined} />
    </Sheet>
  );
}

function EnrolSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const colors = useColors();
  const toast = useToast();
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setup.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async () => {
    try {
      const result = await enable.mutateAsync(code.replace(/\s/g, ""));
      setRecoveryCodes(result.recoveryCodes);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "That code did not match. Check the time on your phone and try the next code.");
    }
  };

  const data = setup.data;
  return (
    <Sheet
      open
      onClose={recoveryCodes ? () => undefined : onClose}
      title={recoveryCodes ? "Two-factor authentication is on" : "Set up two-factor authentication"}
      tall
      footer={
        recoveryCodes ? (
          <Button title="Done" onPress={onDone} disabled={!saved} />
        ) : (
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="secondary" onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Verify and switch on" onPress={verify} loading={enable.isPending} disabled={code.replace(/\s/g, "").length !== 6 || !data} />
            </View>
          </View>
        )
      }
    >
      {recoveryCodes ? (
        <View style={{ paddingBottom: spacing.lg }}>
          <RecoveryCodes codes={recoveryCodes} />
          <View style={{ marginTop: spacing.md }}>
            <CheckRow label="I have saved my recovery codes somewhere safe." checked={saved} onChange={setSaved} />
          </View>
        </View>
      ) : setup.isPending || !data ? (
        setup.isError ? (
          <Note tone="danger">{setup.error instanceof ApiError ? setup.error.message : "Could not start the setup."}</Note>
        ) : (
          <Loading label="Preparing your key…" />
        )
      ) : (
        <View style={{ paddingBottom: spacing.lg }}>
          <Txt variant="body" tone="muted" style={{ lineHeight: 21, marginBottom: spacing.md }}>
            1. Open your authenticator app and choose “add account”.{"\n"}2. Scan this QR code, or type the key below it.{"\n"}3. Enter the six-digit code the app shows.
          </Txt>
          {data.qrDataUrl ? <Image source={{ uri: data.qrDataUrl }} style={{ width: 180, height: 180, alignSelf: "center", borderRadius: radius.md, backgroundColor: "#fff" }} contentFit="contain" /> : null}
          <Txt variant="caption" tone="subtle" style={{ textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.md }}>
            Manual key
          </Txt>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4, marginBottom: spacing.md }}>
            <Txt variant="body" style={{ flex: 1, fontFamily: "monospace", letterSpacing: 1.5, backgroundColor: colors.surfaceMuted, padding: spacing.sm, borderRadius: radius.sm }}>
              {data.secret.match(/.{1,4}/g)?.join(" ")}
            </Txt>
            <Button title="Copy" variant="ghost" size="sm" icon="copy-outline" onPress={() => Clipboard.setStringAsync(data.secret).then(() => toast.success("Key copied.")).catch(() => undefined)} />
          </View>
          <Field label="Code from the app" keyboardType="number-pad" autoComplete="one-time-code" placeholder="123 456" value={code} onChangeText={setCode} maxLength={7} />
        </View>
      )}
    </Sheet>
  );
}

function DisableSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const disable = useMfaDisable();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const submit = async () => {
    try {
      await disable.mutateAsync({ password, token: code.trim() });
      toast.success("Two-factor authentication is off.");
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not switch it off.");
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Turn off two-factor authentication?"
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Keep it on" variant="secondary" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Turn off" variant="danger" onPress={submit} loading={disable.isPending} disabled={!password || code.replace(/\s/g, "").length < 6} />
          </View>
        </View>
      }
    >
      <Note tone="warning">Your password alone will be enough to sign in again. Confirm with your password and a current code.</Note>
      <Field label="Password" secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword} />
      <Field label="Code from your app, or a recovery code" autoCapitalize="none" value={code} onChangeText={setCode} />
    </Sheet>
  );
}

function RegenerateSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const regenerate = useMfaRecoveryCodes();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const submit = async () => {
    try {
      const result = await regenerate.mutateAsync(code.trim());
      setCodes(result.recoveryCodes);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not generate new codes.");
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={codes ? "Your new recovery codes" : "Generate new recovery codes"}
      footer={
        codes ? (
          <Button title="Done" onPress={onClose} />
        ) : (
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="secondary" onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Generate" onPress={submit} loading={regenerate.isPending} disabled={code.replace(/\s/g, "").length < 6} />
            </View>
          </View>
        )
      }
    >
      {codes ? (
        <View style={{ paddingBottom: spacing.lg }}>
          <RecoveryCodes codes={codes} />
        </View>
      ) : (
        <>
          <Txt variant="body" tone="muted" style={{ marginBottom: spacing.md, lineHeight: 21 }}>
            Your existing recovery codes stop working the moment new ones are made.
          </Txt>
          <Field label="Code from your app" keyboardType="number-pad" autoComplete="one-time-code" value={code} onChangeText={setCode} />
        </>
      )}
    </Sheet>
  );
}
