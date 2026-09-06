#!/usr/bin/env node
"use strict";

/**
 * Build a signed release APK of the employee app.
 *
 *   node scripts/build-android.js [--prebuild] [--api-url https://...] [--abi arm64-v8a,armeabi-v7a]
 *
 * What it does, in order:
 *   1. Makes sure a release keystore exists in mobile/keystore/ (git-ignored),
 *      generating one with keytool the first time and writing its credentials
 *      beside it. Keep that folder safe: an update signed with a different
 *      key cannot install over the old app.
 *   2. Optionally regenerates android/ from app.json (`--prebuild`), which is
 *      needed whenever a native module or a config plugin changes.
 *   3. Patches android/app/build.gradle so the release build type uses that
 *      keystore instead of the debug one Expo generates.
 *   4. Runs Gradle with the API URL baked in via EXPO_PUBLIC_API_URL.
 *   5. Copies the APK to mobile/dist/ and frontend/public/downloads/, and
 *      prints its size and SHA-256.
 */

const { execSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const apiUrl = option("--api-url", process.env.EXPO_PUBLIC_API_URL || "https://chefotech-hrms.onrender.com");
const abis = option("--abi", "arm64-v8a,armeabi-v7a");
const appJson = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const version = appJson.expo.version;
const isWindows = process.platform === "win32";

function log(step) {
  console.log(`\n▶ ${step}`);
}

/** JAVA_HOME, or wherever the `java` on PATH actually lives (Windows installs rarely set the variable). */
function detectJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  try {
    const probe = spawnSync("java", ["-XshowSettings:properties", "-version"], { encoding: "utf8", shell: true });
    const match = /java\.home\s*=\s*(.+)/.exec(`${probe.stderr || ""}${probe.stdout || ""}`);
    if (match) return match[1].trim();
  } catch {
    /* fall through */
  }
  return null;
}

const javaHome = detectJavaHome();
if (!javaHome) {
  console.error("No JDK found. Install JDK 17 or set JAVA_HOME.");
  process.exit(1);
}
const keytool = path.join(javaHome, "bin", isWindows ? "keytool.exe" : "keytool");
process.env.JAVA_HOME = javaHome;

function run(command, cwd = root, env = {}) {
  const result = spawnSync(command, { cwd, stdio: "inherit", shell: true, env: { ...process.env, ...env } });
  if (result.status !== 0) {
    console.error(`\nCommand failed (${result.status}): ${command}`);
    process.exit(result.status || 1);
  }
}

// ── 1. Keystore ─────────────────────────────────────────────────────────────

const keystoreDir = path.join(root, "keystore");
const keystorePath = path.join(keystoreDir, "chefotech-hrms-release.keystore");
const credentialsPath = path.join(keystoreDir, "credentials.json");
fs.mkdirSync(keystoreDir, { recursive: true });

let credentials;
if (fs.existsSync(credentialsPath)) {
  credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
} else {
  credentials = { alias: "chefotech-hrms", storePassword: crypto.randomBytes(12).toString("base64url"), keyPassword: null };
  credentials.keyPassword = credentials.storePassword;
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
}

if (!fs.existsSync(keystorePath)) {
  log("Generating the release keystore (first build only)");
  run(
    `"${keytool}" -genkeypair -v -keystore "${keystorePath}" -alias ${credentials.alias} -keyalg RSA -keysize 2048 -validity 10000 -storepass ${credentials.storePassword} -keypass ${credentials.keyPassword} -dname "CN=Chefotech HRMS, O=Chefotech, C=IN"`
  );
}

// ── 2. Prebuild ─────────────────────────────────────────────────────────────

const androidDir = path.join(root, "android");
if (flag("--prebuild") || !fs.existsSync(path.join(androidDir, "gradlew"))) {
  log("Regenerating the native Android project from app.json");
  run("npx expo prebuild --platform android --clean --no-install", root, { CI: "1" });
}

// ── 3. Signing config ───────────────────────────────────────────────────────

log("Applying the release signing config");
const gradlePath = path.join(androidDir, "app", "build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");
if (!gradle.includes("signingConfigs.release")) {
  gradle = gradle.replace(
    /signingConfigs \{\s*debug \{/,
    `signingConfigs {
        release {
            storeFile file(CHEFOTECH_KEYSTORE_FILE)
            storePassword CHEFOTECH_KEYSTORE_PASSWORD
            keyAlias CHEFOTECH_KEY_ALIAS
            keyPassword CHEFOTECH_KEY_PASSWORD
        }
        debug {`
  );
  gradle = gradle.replace(/(release \{[^}]*?)signingConfig signingConfigs\.debug/, "$1signingConfig signingConfigs.release");
  fs.writeFileSync(gradlePath, gradle);
}
const propsPath = path.join(androidDir, "gradle.properties");
let props = fs.readFileSync(propsPath, "utf8").replace(/\n?CHEFOTECH_[A-Z_]+=.*\n?/g, "\n");
props = `${props.trimEnd()}\n\n# Release signing (written by scripts/build-android.js; the keystore lives outside android/)\nCHEFOTECH_KEYSTORE_FILE=${keystorePath.replace(/\\/g, "/")}\nCHEFOTECH_KEYSTORE_PASSWORD=${credentials.storePassword}\nCHEFOTECH_KEY_ALIAS=${credentials.alias}\nCHEFOTECH_KEY_PASSWORD=${credentials.keyPassword}\n`;
fs.writeFileSync(propsPath, props);

// ── 4. Build ────────────────────────────────────────────────────────────────

log(`Building release APK ${version} for ${abis} against ${apiUrl}`);
fs.writeFileSync(path.join(root, ".env.production"), `EXPO_PUBLIC_API_URL=${apiUrl}\n`);
const gradlew = `"${path.join(androidDir, isWindows ? "gradlew.bat" : "gradlew")}"`;
run(`${gradlew} assembleRelease -PreactNativeArchitectures=${abis} --no-daemon`, androidDir, { EXPO_PUBLIC_API_URL: apiUrl, NODE_ENV: "production" });

// ── 5. Publish the artefact ─────────────────────────────────────────────────

const built = path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!fs.existsSync(built)) {
  console.error("The build finished but no APK was produced at " + built);
  process.exit(1);
}
const distDir = path.join(root, "dist");
fs.mkdirSync(distDir, { recursive: true });
const distPath = path.join(distDir, `Chefotech-HRMS-${version}.apk`);
fs.copyFileSync(built, distPath);
const downloadsDir = path.resolve(root, "..", "frontend", "public", "downloads");
fs.mkdirSync(downloadsDir, { recursive: true });
const downloadPath = path.join(downloadsDir, "chefotech-hrms.apk");
fs.copyFileSync(built, downloadPath);

const bytes = fs.statSync(distPath).size;
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(distPath)).digest("hex");
fs.writeFileSync(path.join(distDir, `Chefotech-HRMS-${version}.sha256`), `${sha256}  Chefotech-HRMS-${version}.apk\n`);

console.log(`\nAPK: ${distPath}`);
console.log(`Also copied to: ${downloadPath}`);
console.log(`Size: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`SHA-256: ${sha256}`);
console.log(`API: ${apiUrl}`);
try {
  execSync("echo done", { stdio: "ignore" });
} catch {
  /* nothing */
}
