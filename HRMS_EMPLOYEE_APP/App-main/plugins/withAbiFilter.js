const {
  withGradleProperties,
  withAppBuildGradle,
} = require("expo/config-plugins");

// Release builds ship arm64-v8a only (smaller APK/AAB — no real device needs the rest).
// Local emulators are x86_64, so an arm64-only build installs but crashes on launch with a
// missing-DSO error. Set ANDROID_ABIS to widen the filter for a local run, e.g.
//   ANDROID_ABIS=arm64-v8a,x86_64 npx expo prebuild -p android --clean
// armeabi-v7a is NOT optional once minSdk is 24. Every 64-bit-only build
// silently excludes 32-bit devices on Google Play — which is most phones from
// the API 24–28 era, exactly the devices being re-enabled. arm64 alone would
// have made the app uninstallable for them with no error the user could see.
//
// Cost is real but bounded: two ABIs roughly double the native payload in a
// universal APK. Release ships as an app-bundle (eas.json production), and
// Play splits per-device, so a user still downloads one ABI.
const DEFAULT_ABIS = "arm64-v8a,armeabi-v7a";
const ABIS = (process.env.ANDROID_ABIS || DEFAULT_ABIS)
  .split(",")
  .map((abi) => abi.trim())
  .filter(Boolean);

module.exports = function withAbiFilter(config) {
  // Step 1: Set gradle properties
  config = withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) =>
        item.key !== "reactNativeArchitectures" &&
        item.key !== "android.suppressUnsupportedCompileSdk",
    );
    config.modResults.push(
      { type: "property", key: "reactNativeArchitectures", value: ABIS.join(",") },
      {
        // Must track compileSdkVersion in app.json's expo-build-properties.
        // Left at 35 while that moved to 36, Gradle warns on every build.
        type: "property",
        key: "android.suppressUnsupportedCompileSdk",
        value: "36",
      },
    );
    return config;
  });

  // Step 2: Inject ndk.abiFilters into app/build.gradle
  config = withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    const filters = ABIS.map((abi) => `'${abi}'`).join(", ");
    if (!contents.includes("abiFilters")) {
      config.modResults.contents = contents.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {\n        ndk {\n            abiFilters ${filters}\n        }`,
      );
    } else {
      // Keep a previously generated android/ folder in step with ANDROID_ABIS.
      config.modResults.contents = contents.replace(
        /abiFilters[^\n]*/,
        `abiFilters ${filters}`,
      );
    }
    return config;
  });

  return config;
};
