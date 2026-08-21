// src/components/ForceUpdateModal.js
//
// Two-path update flow when user taps "Update Now":
//
//   1. OTA path (preferred) — uses `expo-updates` to download the new
//      JavaScript bundle in the background and restart the app on the
//      new version. Works for JS-only changes (most updates).
//
//   2. Google Play fallback — if OTA reports no update available, opens
//      Google Play Store specifically (NOT vivo AppStore / Mi Store /
//      AppGallery). Uses a special URL scheme that only Google Play
//      registers as a handler, so OEM stores can't intercept.
//
// Either way the user never gets sent to a website.

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  BackHandler,
  Linking,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Updates from "expo-updates";
import { useTheme, radius, spacing, type } from "../theme";

// MUST match android.package in app.json
const PACKAGE_NAME = "com.grav.crm";

// ─────────────────────────────────────────────────────────────────────────
//  Open Google Play (not OEM default store)
//
//  The trick: use an Android Intent URI with the package binding embedded.
//  This URL format:
//      intent://details?id=PKG#Intent;scheme=market;package=com.android.vending;end
//  tells Android: "open the URL `market://details?id=PKG` BUT ONLY in the
//  app whose package is `com.android.vending` (Google Play)."
//
//  Linking.openURL processes this through Android's intent resolver, which
//  honors the `package=` parameter and ignores all other apps registered
//  for the market:// scheme — bypassing Vivo AppStore, Mi Store, etc.
//
//  This requires NO native dependencies — just RN's built-in Linking API.
// ─────────────────────────────────────────────────────────────────────────
async function openGooglePlay() {
  if (Platform.OS !== "android") {
    // iOS — open the Play Store web URL (this app is Android-only on Play
    // Store, so iOS users would only see this in dev/web).
    try {
      await Linking.openURL(
        `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}`,
      );
    } catch (_) {}
    return;
  }

  // Attempt 1: Android Intent URI pinned to com.android.vending
  // The `S.browser_fallback_url=` parameter is a safety net — if Play
  // Store isn't installed, Android opens the HTTPS URL instead.
  const fallbackUrl = `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}`;
  const intentUrl =
    `intent://details?id=${PACKAGE_NAME}` +
    `#Intent` +
    `;scheme=market` +
    `;package=com.android.vending` +
    `;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}` +
    `;end`;

  try {
    await Linking.openURL(intentUrl);
    return;
  } catch (e) {
    console.warn("[ForceUpdate] Intent URI failed:", e?.message);
  }

  // Attempt 2: Play Store HTTPS URL.
  // Google Play registers itself as an intent filter for this exact URL
  // host pattern (play.google.com/store/apps/details). On most devices
  // this opens the Play Store app directly. OEM stores don't register
  // for this exact path.
  try {
    await Linking.openURL(fallbackUrl);
    return;
  } catch (_) {}

  // Last resort
  Alert.alert(
    "Could not open Google Play",
    "Please open Google Play Store manually and search for GRAV CRM.",
    [{ text: "OK" }],
  );
}

export default function ForceUpdateModal({ visible, message }) {
  // This was the last surface in the app still painting raw hexes from the
  // pre-theme `Colors` map — a white card with #111827 text, which is a
  // light-mode card floating over a dark-mode app. Styles are built per-scheme
  // for the same reason every screen does it: a module-scope StyleSheet can
  // only ever hold one theme.
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => handler.remove();
  }, [visible]);

  const handleUpdate = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("Checking for update...");

    // Path A: OTA via expo-updates
    try {
      if (Updates.isEnabled && !__DEV__) {
        const check = await Updates.checkForUpdateAsync();
        if (check?.isAvailable) {
          setStatus("Downloading update...");
          await Updates.fetchUpdateAsync();
          setStatus("Restarting...");
          await Updates.reloadAsync();
          return;
        }
        setStatus("Opening Google Play...");
      } else {
        setStatus("Opening Google Play...");
      }
    } catch (e) {
      console.warn(
        "[ForceUpdate] OTA failed, falling back to Play Store:",
        e?.message,
      );
      setStatus("Opening Google Play...");
    }

    // Path B: Force Google Play (not OEM default)
    await openGooglePlay();
    setBusy(false);
    setStatus("");
  };

  const handleExit = () => BackHandler.exitApp();

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={s.overlay}>
        <View style={s.card}>
          <View style={s.iconBox}>
            <Ionicons name="arrow-up-circle" size={48} color={colors.text} />
          </View>
          <Text style={s.title}>Update Required</Text>
          <Text style={s.message}>
            {message ||
              "A new version of GRAV is available. Please update to continue using the app."}
          </Text>

          {busy && (
            <View style={s.busyRow}>
              <ActivityIndicator color={colors.text} />
              {!!status && <Text style={s.busyText}>{status}</Text>}
            </View>
          )}

          <TouchableOpacity
            style={[s.updateBtn, busy && { opacity: 0.7 }]}
            onPress={handleUpdate}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Ionicons name="download-outline" size={20} color={colors.onAccent} />
            <Text style={s.updateBtnText}>
              {busy ? "Updating..." : "Update Now"}
            </Text>
          </TouchableOpacity>

          <Text style={s.helpText}>
            {Platform.OS === "android"
              ? "Tap Update — the app will refresh automatically. If a Play Store update is required, Google Play will open."
              : "Tap Update — the app will refresh automatically."}
          </Text>

          {!busy && (
            <TouchableOpacity
              style={s.exitBtn}
              onPress={handleExit}
              activeOpacity={0.7}
            >
              <Text style={s.exitBtnText}>Exit App</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

// Every `fontSize`/`fontWeight` pair below was previously raw. React Native
// ignores `fontWeight` once `fontFamily` names a static face, so those weights
// were never rendering anyway — the type scale carries the named Manrope face,
// which is the only way weight actually lands.
const makeStyles = (colors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      // A scrim is a dimmer, not a surface — it covers the whole screen, so it
      // cannot produce a region split.
      backgroundColor: colors.scrim,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.loose,
    },
    // A top-level surface over the scrim, so it takes a PANEL token.
    card: {
      backgroundColor: colors.panelStrong,
      borderRadius: radius.sheet,
      padding: spacing.loose,
      width: "100%",
      maxWidth: 340,
      alignItems: "center",
    },
    // A child of the card, so it takes `inset` — never a panel token.
    iconBox: {
      width: 80,
      height: 80,
      borderRadius: radius.card,
      backgroundColor: colors.inset,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: spacing.base,
    },
    title: {
      ...type.headline,
      color: colors.text,
      marginBottom: spacing.tight,
      textAlign: "center",
    },
    message: {
      ...type.body,
      color: colors.textMuted,
      textAlign: "center",
      marginBottom: spacing.base,
    },
    busyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      marginBottom: spacing.base,
    },
    busyText: { ...type.caption, color: colors.textMuted },
    updateBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.tight,
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingVertical: spacing.snug,
      paddingHorizontal: spacing.section,
      width: "100%",
    },
    updateBtnText: { ...type.label, color: colors.onAccent },
    helpText: {
      ...type.caption,
      color: colors.textFaint,
      textAlign: "center",
      marginTop: spacing.snug,
      marginBottom: spacing.tight,
    },
    exitBtn: { paddingVertical: spacing.tight, paddingHorizontal: spacing.loose },
    exitBtnText: { ...type.caption, color: colors.danger },
  });
