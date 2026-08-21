"use strict";

const mongoose = require("mongoose");
const { tenantPlugin } = require("../../core/tenancy/tenantPlugin");

/**
 * One organization's AI configuration.
 *
 * The key itself is never stored in plain text — see core/security/secretBox.
 * Only the three AES-GCM parts are persisted, plus enough metadata to show an
 * admin what is configured without ever decrypting on their behalf.
 *
 * "Bring your own key" rather than a platform-wide key is deliberate: it puts
 * the Gemini bill and quota in the tenant's own Google account, where a
 * runaway prompt loop in one tenant cannot exhaust a shared budget that every
 * other tenant depends on.
 */
const aiCredentialSchema = new mongoose.Schema(
  {
    // organizationId is added by tenantPlugin below.
    provider: { type: String, enum: ["gemini"], default: "gemini" },
    model: { type: String, default: "gemini-2.0-flash" },

    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    /** Last four characters, so the settings screen can show "…a1b2" without decrypting. */
    keySuffix: { type: String, required: true },

    isEnabled: { type: Boolean, default: true },

    /** Set by the one successful test call made right after saving. */
    lastVerifiedAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    usage: {
      requestCount: { type: Number, default: 0 },
      lastUsedAt: { type: Date, default: null },
    },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

aiCredentialSchema.plugin(tenantPlugin);
// One AI configuration per organization per provider.
aiCredentialSchema.index({ organizationId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.models.AiCredential || mongoose.model("AiCredential", aiCredentialSchema);
