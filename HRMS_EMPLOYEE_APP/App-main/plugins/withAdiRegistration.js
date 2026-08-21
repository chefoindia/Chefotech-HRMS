const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * This plugin copies adi-registration.properties into the Android assets folder
 * so Google Play can verify package ownership during developer verification.
 */
module.exports = function withAdiRegistration(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const srcFile = path.join(
        config.modRequest.projectRoot,
        "assets",
        "adi-registration.properties",
      );

      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
      );

      const destFile = path.join(destDir, "adi-registration.properties");

      // Create destination directory if it doesn't exist
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Copy the file
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, destFile);
        console.log(
          "[withAdiRegistration] Copied adi-registration.properties to Android assets",
        );
      } else {
        console.warn(
          "[withAdiRegistration] WARNING: assets/adi-registration.properties not found!",
        );
      }

      return config;
    },
  ]);
};
