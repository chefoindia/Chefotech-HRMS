// src/lib/feedback.js
//
// Haptic tick that degrades to silence.
//
// expo-haptics is a native module. Requiring it on a build that doesn't
// contain it throws at call time, which would take down every button press —
// a missing vibration is not worth crashing a screen over. This resolves the
// module lazily, once, and no-ops forever if it isn't there.
//
// Calls are fire-and-forget by design: a dropped tick is invisible, but an
// awaited one makes the tap feel laggy.

import { Platform } from "react-native";

let mod;
let resolved = false;

function get() {
  if (resolved) return mod;
  resolved = true;
  try {
    // eslint-disable-next-line global-require
    mod = require("expo-haptics");
  } catch {
    mod = null;
  }
  return mod;
}

export function tap(kind = "light") {
  if (Platform.OS === "web") return;
  const H = get();
  if (!H?.impactAsync) return;
  try {
    const style =
      kind === "medium"
        ? H.ImpactFeedbackStyle?.Medium
        : kind === "heavy"
          ? H.ImpactFeedbackStyle?.Heavy
          : H.ImpactFeedbackStyle?.Light;
    H.impactAsync(style).catch(() => {});
  } catch {
    // Native side absent — silence is the correct fallback.
  }
}

export function notify(kind = "success") {
  if (Platform.OS === "web") return;
  const H = get();
  if (!H?.notificationAsync) return;
  try {
    const t =
      kind === "error"
        ? H.NotificationFeedbackType?.Error
        : kind === "warning"
          ? H.NotificationFeedbackType?.Warning
          : H.NotificationFeedbackType?.Success;
    H.notificationAsync(t).catch(() => {});
  } catch {
    /* no-op */
  }
}

export default { tap, notify };
