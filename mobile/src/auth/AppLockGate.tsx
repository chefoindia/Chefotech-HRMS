import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "../theme/ThemeProvider";
import { Button, Txt } from "../components/ui";
import { spacing, radius } from "../theme";
import { useSession } from "./session";
import { BRAND } from "../brand";

/**
 * Optional biometric lock.
 *
 * An HR app holds salary history, home addresses and medical leave. A phone
 * left unlocked on a desk should not expose those, but forcing biometrics on
 * everyone is worse — plenty of devices have no enrolled biometric, and a hard
 * requirement would lock those people out of their own payslips entirely.
 *
 * So: off by default, opt-in from Settings, and it only engages when the
 * device can actually satisfy it.
 *
 * The lock re-arms when the app has been in the background past a grace
 * period. Locking on every task-switch would be unusable — people leave to
 * read an OTP and come straight back.
 */

const ENABLED_KEY = "chefotech.appLock";
const GRACE_MS = 60_000;

export async function isAppLockEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ENABLED_KEY).catch(() => null)) === "yes";
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) await SecureStore.setItemAsync(ENABLED_KEY, "yes");
  else await SecureStore.deleteItemAsync(ENABLED_KEY).catch(() => undefined);
}

/** What the device can actually do, so Settings can explain rather than fail. */
export async function appLockCapability(): Promise<{
  supported: boolean;
  enrolled: boolean;
  label: string;
}> {
  const [supported, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync().catch(() => false),
    LocalAuthentication.isEnrolledAsync().catch(() => false),
    LocalAuthentication.supportedAuthenticationTypesAsync().catch(
      () => [] as LocalAuthentication.AuthenticationType[]
    ),
  ]);

  const label = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
    ? "Face ID"
    : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
      ? "Fingerprint"
      : "Device passcode";

  return { supported, enrolled, label };
}

export function AppLockGate({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const colors = useColors();

  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setChecking(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Unlock ${BRAND.name}`,
        // Falling back to the device passcode means someone whose fingerprint
        // is not being recognised — wet hands on a factory floor — is not
        // locked out of their own attendance.
        disableDeviceFallback: false,
        cancelLabel: "Cancel",
      });
      if (result.success) {
        setLocked(false);
        backgroundedAt.current = null;
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Only signed-in sessions are worth locking; the login screen has nothing
    // behind it.
    if (!session) {
      setLocked(false);
      return;
    }

    const subscription = AppState.addEventListener("change", async (status: AppStateStatus) => {
      if (status === "background" || status === "inactive") {
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
        return;
      }

      if (status === "active" && backgroundedAt.current !== null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away < GRACE_MS) return;
        if (await isAppLockEnabled()) setLocked(true);
      }
    });

    return () => subscription.remove();
  }, [session]);

  // Prompt as soon as the lock engages, so the user is not left staring at a
  // wall with no obvious next step.
  useEffect(() => {
    if (locked && !checking) unlock();
    // Intentionally not depending on `unlock` identity; one prompt per lock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  if (!locked) return <>{children}</>;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing["3xl"],
      }}
    >
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: radius.full,
          backgroundColor: colors.brand[50],
          alignItems: "center",
          justifyContent: "center",
          marginBottom: spacing.xl,
        }}
      >
        <Ionicons name="lock-closed" size={32} color={colors.brand[600]} />
      </View>

      <Txt variant="title" style={{ textAlign: "center" }}>
        Locked
      </Txt>
      <Txt variant="body" tone="muted" style={{ textAlign: "center", marginTop: spacing.sm, lineHeight: 21 }}>
        Unlock to see your attendance, leave and payslips.
      </Txt>

      <Button
        title="Unlock"
        icon="finger-print"
        loading={checking}
        onPress={unlock}
        style={{ marginTop: spacing["2xl"], alignSelf: "stretch" }}
      />
    </View>
  );
}
