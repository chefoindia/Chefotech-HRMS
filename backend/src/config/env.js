/**
 * Central environment configuration.
 *
 * Nothing else in the codebase reads process.env directly (except the
 * bootstrap in server.js). Every value is validated once, at boot, so a
 * misconfigured deployment fails immediately instead of at 3am inside a
 * payroll run.
 */
"use strict";

require("dotenv").config();

const REQUIRED_IN_PRODUCTION = [
  "MONGODB_URI",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
];

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";
const isTest = NODE_ENV === "test";

const env = {
  NODE_ENV,
  isProd,
  isTest,
  isDev: NODE_ENV === "development",

  app: {
    name: process.env.APP_NAME || "Chefotech HRMS",
    port: int(process.env.PORT, 5001),
    apiPrefix: process.env.API_PREFIX || "/api/v1",
    publicUrl: process.env.PUBLIC_APP_URL || "http://localhost:3000",
    /**
     * The API's own externally reachable origin. File URLs must be absolute:
     * a relative path resolves against whoever is rendering it, which is the
     * frontend in a browser and nothing at all in an email or a generated PDF.
     */
    publicApiUrl:
      process.env.PUBLIC_API_URL || `http://localhost:${int(process.env.PORT, 5001)}`,
    trustProxy: bool(process.env.TRUST_PROXY, isProd),
  },

  db: {
    uri:
      process.env.MONGODB_URI ||
      "mongodb://127.0.0.1:27017/chefotech_hrms",
    // Never let a slow primary election hang an HTTP request forever.
    serverSelectionTimeoutMS: int(process.env.MONGODB_TIMEOUT_MS, 10000),
    maxPoolSize: int(process.env.MONGODB_POOL_SIZE, 20),
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me",
    accessTtl: process.env.JWT_ACCESS_TTL || "30m",
    refreshTtl: process.env.JWT_REFRESH_TTL || "30d",
    issuer: process.env.JWT_ISSUER || "chefotech-hrms",
  },

  cookies: {
    // Cross-site cookies (app on :3000, API on :5001) are blocked by Chrome
    // unless SameSite=None;Secure. In local dev that is impossible over http,
    // which is why the auth layer ALSO returns the token in the response body
    // and the client mirrors it into an Authorization header. Do not "clean
    // up" that duplication — see docs/architecture/authentication.md.
    domain: process.env.COOKIE_DOMAIN || undefined,
    secure: bool(process.env.COOKIE_SECURE, isProd),
    sameSite: process.env.COOKIE_SAMESITE || (isProd ? "none" : "lax"),
  },

  cors: {
    origins: list(process.env.CORS_ORIGINS, [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]),
  },

  security: {
    bcryptRounds: int(process.env.BCRYPT_ROUNDS, isTest ? 4 : 12),
    maxLoginAttempts: int(process.env.MAX_LOGIN_ATTEMPTS, 8),
    loginLockoutMinutes: int(process.env.LOGIN_LOCKOUT_MINUTES, 15),
    rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: int(process.env.RATE_LIMIT_MAX, 300),
    authRateLimitMax: int(process.env.AUTH_RATE_LIMIT_MAX, 20),
    // Encrypts tenant-supplied AI credentials (a Gemini API key) at rest.
    // 32 random bytes, hex-encoded:
    // node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    credentialEncryptionKey: process.env.AI_CREDENTIAL_ENCRYPTION_KEY || "",
  },

  storage: {
    driver: process.env.STORAGE_DRIVER || "drive", // drive | local
    localRoot: process.env.STORAGE_LOCAL_ROOT || "./.storage",
    maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 25 * 1024 * 1024),
    /**
     * Images and documents are stored in different places on purpose: images
     * need a CDN with transformations, documents need per-file access control
     * and the customer's own retention rules. Setting this to "drive" or
     * "local" puts everything back in one store.
     */
    imageDriver: process.env.IMAGE_STORAGE_DRIVER || "cloudinary", // cloudinary | drive | local
    drive: {
      serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "",
      rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "",
      // Shared Drives need supportsAllDrives on every call.
      sharedDriveId: process.env.GOOGLE_SHARED_DRIVE_ID || "",
    },
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
      apiKey: process.env.CLOUDINARY_API_KEY || "",
      apiSecret: process.env.CLOUDINARY_API_SECRET || "",
      folder: process.env.CLOUDINARY_FOLDER || "chefotech-hrms",
    },
  },

  /** Where public enquiries are routed. */
  contact: {
    salesInbox: process.env.CONTACT_SALES_INBOX || "sales@chefotech.com",
    supportInbox: process.env.CONTACT_SUPPORT_INBOX || "support@chefotech.com",
    privacyInbox: process.env.CONTACT_PRIVACY_INBOX || "privacy@chefotech.com",
  },

  mail: {
    enabled: bool(process.env.MAIL_ENABLED, false),
    host: process.env.SMTP_HOST || "",
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || "Chefotech HRMS <no-reply@chefotech.com>",
  },

  jobs: {
    enabled: bool(process.env.JOBS_ENABLED, !isTest),
    pollIntervalMs: int(process.env.JOBS_POLL_INTERVAL_MS, 5000),
    concurrency: int(process.env.JOBS_CONCURRENCY, 3),
    maxAttempts: int(process.env.JOBS_MAX_ATTEMPTS, 5),
  },

  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || "admin@chefotech.com",
    password: process.env.SUPER_ADMIN_PASSWORD || "ChangeMe@123",
    name: process.env.SUPER_ADMIN_NAME || "Chefotech Admin",
  },

  log: {
    level: process.env.LOG_LEVEL || (isTest ? "silent" : "info"),
    pretty: bool(process.env.LOG_PRETTY, !isProd),
  },
};

function assertProductionConfig() {
  if (!isProd) return;
  const missing = REQUIRED_IN_PRODUCTION.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`
    );
  }
  if (env.jwt.accessSecret.startsWith("dev-")) {
    throw new Error("JWT_ACCESS_SECRET must be set to a real secret in production");
  }
}

module.exports = { env, assertProductionConfig };
