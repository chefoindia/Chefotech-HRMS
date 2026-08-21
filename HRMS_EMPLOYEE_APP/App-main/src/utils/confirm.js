// src/utils/confirm.js
//
// Cross-platform confirmation dialog.
// On native: uses Alert.alert with proper callbacks.
// On web: uses window.confirm — because react-native-web's Alert.alert callbacks DON'T FIRE.
//
// This is the cause of "logout button doesn't work on web" — Alert.alert renders
// the dialog but never calls the onPress callbacks because react-native-web
// only stubs the API.
//
// Usage:
//   import { confirm } from '../utils/confirm';
//   const ok = await confirm({ title: 'Logout', message: 'Are you sure?', confirmText: 'Logout', destructive: true });
//   if (ok) logout();

import { Platform, Alert } from "react-native";

/**
 * Show a confirm dialog and return a promise that resolves to true (user confirmed)
 * or false (user cancelled).
 *
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.message]
 * @param {string} [opts.confirmText="OK"]
 * @param {string} [opts.cancelText="Cancel"]
 * @param {boolean} [opts.destructive=false] - iOS shows confirm in red
 * @returns {Promise<boolean>}
 */
export function confirm({
  title,
  message = "",
  confirmText = "OK",
  cancelText = "Cancel",
  destructive = false,
} = {}) {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      // window.confirm is blocking — and the callback model that
      // Alert.alert uses on native is broken on react-native-web.
      const result =
        typeof window !== "undefined" && window.confirm
          ? window.confirm(`${title}${message ? "\n\n" + message : ""}`)
          : true;
      resolve(!!result);
    } else {
      Alert.alert(
        title,
        message,
        [
          {
            text: cancelText,
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: confirmText,
            style: destructive ? "destructive" : "default",
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    }
  });
}

/**
 * Cross-platform alert (just an info popup, no buttons needed).
 * Same reason — react-native-web's Alert.alert is unreliable for callbacks.
 *
 * @param {string} title
 * @param {string} [message]
 */
export function alert(title, message = "") {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.alert) {
      window.alert(`${title}${message ? "\n\n" + message : ""}`);
    }
  } else {
    Alert.alert(title, message);
  }
}
