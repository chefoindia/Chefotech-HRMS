// src/lib/biometrics.js
//
// Fingerprint / Face unlock.
//
// A deliberate security decision: this NEVER stores a password, and it does
// not store a separate credential of its own. The session token already lives
// in AsyncStorage and is restored on launch — what biometrics add is a lock
// on *opening the app*, so a lost or borrowed phone does not hand over
// someone's salary, payslips and attendance record to whoever picks it up.
//
// The alternative — saving phone+password behind a fingerprint — is more
// convenient and materially worse: it turns a device compromise into a
// permanent account compromise, and the password cannot be revoked the way a
// token can. Not worth it for the few seconds it saves.

// Availability is probed through expo-modules-core, NOT a try/catch around
// require().
//
// That distinction matters and cost a debugging round: requiring
// expo-local-authentication SUCCEEDS on a build without the native module —
// the JS shim is present in node_modules regardless. The throw
// ("Cannot find native module 'ExpoLocalAuthentication'") happens later, when
// the module object is first touched, so a try/catch around the require never
// sees it.
//
// requireOptionalNativeModule asks the native registry directly and returns
// null when absent, which is the only reliable check.
import { requireOptionalNativeModule } from "expo-modules-core";

let LocalAuthentication;
let laResolved = false;

function LA() {
  if (laResolved) return LocalAuthentication;
  laResolved = true;
  LocalAuthentication = null;
  try {
    if (requireOptionalNativeModule("ExpoLocalAuthentication")) {
      // eslint-disable-next-line global-require
      LocalAuthentication = require("expo-local-authentication");
    }
  } catch {
    LocalAuthentication = null;
  }
  return LocalAuthentication;
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const APP_LOCK_KEY = "grav.security.appLock";

/** Hardware present AND at least one biometric actually enrolled. */
export async function isBiometricAvailable() {
  if (Platform.OS === "web" || !LA()) return false;
  try {
    const [hasHardware, enrolled] = await Promise.all([
      LA().hasHardwareAsync(),
      LA().isEnrolledAsync(),
    ]);
    return hasHardware && enrolled;
  } catch {
    return false;
  }
}

/**
 * What to call it in the UI. Saying "fingerprint" on a Face ID device is the
 * kind of small wrongness that makes an app feel unfinished.
 */
export async function biometricLabel() {
  if (Platform.OS === "web" || !LA()) return "Biometrics";
  try {
    const types = await LA().supportedAuthenticationTypesAsync();
    const T = LA().AuthenticationType;
    if (types.includes(T.FACIAL_RECOGNITION)) {
      return Platform.OS === "ios" ? "Face ID" : "Face unlock";
    }
    if (types.includes(T.FINGERPRINT)) {
      return Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
    }
    if (types.includes(T.IRIS)) return "Iris";
    return "Biometrics";
  } catch {
    return "Biometrics";
  }
}

/** Prompt. Resolves { success, error }. */
export async function authenticate(reason = "Unlock GRAV") {
  if (Platform.OS === "web") return { success: true };
  if (!LA()) return { success: false, error: "Biometrics unavailable in this build" };
  try {
    const res = await LA().authenticateAsync({
      promptMessage: reason,
      // Let the user fall back to their device PIN. Without this, anyone whose
      // fingerprint stops reading (wet hands, a cut) is locked out of their
      // own payslips with no recourse.
      disableDeviceFallback: false,
      fallbackLabel: "Use device passcode",
      cancelLabel: "Cancel",
    });
    return { success: !!res.success, error: res.error };
  } catch (e) {
    return { success: false, error: e?.message };
  }
}

export async function isAppLockEnabled() {
  try {
    return (await AsyncStorage.getItem(APP_LOCK_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setAppLockEnabled(on) {
  try {
    if (on) await AsyncStorage.setItem(APP_LOCK_KEY, "1");
    else await AsyncStorage.removeItem(APP_LOCK_KEY);
  } catch {
    // Non-fatal: the toggle simply won't persist.
  }
}

export default {
  isBiometricAvailable,
  biometricLabel,
  authenticate,
  isAppLockEnabled,
  setAppLockEnabled,
  APP_LOCK_KEY,
};
