// src/screens/LockScreen.js
//
// Shown when App Lock is on and a session exists. The user is already
// authenticated to the backend; this gates access to the device-local view of
// their data.

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Aurora, PrimaryAction, InlineAction } from "../components/ui";
import { useTheme, spacing, type } from "../theme";
import { authenticate, biometricLabel } from "../lib/biometrics";

const LOGO = require("../../assets/grav-logo.png");

export default function LockScreen({ onUnlock, onSignOut }) {
  const { colors } = useTheme();
  const [label, setLabel] = useState("Biometrics");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    biometricLabel().then((l) => alive && setLabel(l));
    return () => {
      alive = false;
    };
  }, []);

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    const res = await authenticate("Unlock GRAV");
    setBusy(false);
    if (res.success) onUnlock?.();
    else setFailed(true);
  }, [onUnlock]);

  // Prompt immediately — making someone tap a button to reach the prompt they
  // already expect is a pointless extra step.
  useEffect(() => {
    tryUnlock();
    // Intentionally once on mount; retry is via the button.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Aurora animated={false}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          <Ionicons
            name="lock-closed-outline"
            size={26}
            color={colors.textMuted}
            style={{ marginTop: spacing.loose }}
          />
          <Text style={[type.title, styles.title, { color: colors.text }]}>
            GRAV is locked
          </Text>
          <Text style={[type.body, styles.body, { color: colors.textMuted }]}>
            {failed
              ? `Unlock with ${label} to continue, or use your device passcode.`
              : `Use ${label} to continue.`}
          </Text>
        </View>

        <View style={styles.footer}>
          <PrimaryAction
            label={`Unlock with ${label}`}
            onPress={tryUnlock}
            loading={busy}
            icon={<Ionicons name="finger-print" size={18} color={colors.onAccent} />}
          />
          <InlineAction label="Sign out instead" onPress={onSignOut} tone="textMuted" />
        </View>
      </SafeAreaView>
    </Aurora>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.tight },
  logo: { width: 150, height: 74 },
  title: { marginTop: spacing.snug },
  body: { textAlign: "center", maxWidth: 300 },
  footer: {
    paddingHorizontal: spacing.loose,
    paddingBottom: spacing.loose,
    gap: spacing.snug,
    alignItems: "center",
  },
});
