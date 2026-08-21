// app.config.js
//
// Why this file exists
// ────────────────────
// A development build has no business fetching OTA updates. It loads its JS
// from Metro, so an update check can only ever be noise — and when it fails
// it is FATAL, which is what produced:
//
//   Uncaught Error: java.io.IOException: Failed to download remote update
//
// That crash had two causes stacked on each other:
//   1. app.json's `updates.url` pointed at project 5c42014d-… while the EAS
//      project is 89223300-…, so the update server refused every request.
//      (Fixed in app.json.)
//   2. expo-updates was enabled in a build that never needed it, so a refused
//      request took the whole app down instead of being ignored.
//
// Fixing only (1) would leave the app one network failure away from the same
// fatal screen. So updates are switched off entirely for development builds
// and left fully configured for preview/production, which are the builds that
// actually ship OTA.
//
// NOTE: `updates` is compiled into the native binary. Changing it here has no
// effect on an APK that is already installed — that build must be replaced.
//
// This file does not restate the app config. Expo reads app.json first and
// passes it in as `config`, so app.json stays the single source of truth and
// only the one key that must vary per build profile is overridden here.

const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = ({ config }) => ({
  ...config,
  updates: IS_DEV
    ? // Nothing else is needed: with updates disabled, expo-updates never
      // reaches the network and the failure mode disappears rather than
      // being handled.
      { enabled: false }
    : config.updates,
});
