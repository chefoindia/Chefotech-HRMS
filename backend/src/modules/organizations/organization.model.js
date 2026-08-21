"use strict";

const mongoose = require("mongoose");
const { createGlobalSchema } = require("../../core/tenancy/baseSchema");
const { SUPPORTED_TIMEZONES } = require("../../shared/datetime");

/**
 * The tenant.
 *
 * A global (non tenant-scoped) collection by necessity — it is the thing every
 * other collection points at. Reads of this model outside a system context are
 * still constrained: `organization.service` only ever loads the org in the
 * caller's own token.
 */

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, default: "" },
    line2: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "India" },
    postalCode: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const brandingSchema = new mongoose.Schema(
  {
    // Stored as StoredFile ids; the API resolves them to lh3 URLs on read.
    logoFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
    logoDarkFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
    faviconFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
    letterheadFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
    watermarkFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
    loginBackgroundFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },

    // Theme tokens. The frontend maps these straight onto CSS custom
    // properties, which is why no component anywhere hard-codes a brand colour.
    primaryColor: { type: String, default: "#4F46E5" },
    secondaryColor: { type: String, default: "#0F172A" },
    accentColor: { type: String, default: "#06B6D4" },
    sidebarStyle: { type: String, enum: ["light", "dark", "brand"], default: "dark" },
    borderRadius: { type: String, enum: ["none", "small", "medium", "large"], default: "medium" },
    fontFamily: { type: String, default: "Inter" },

    loginHeadline: { type: String, default: "" },
    loginSubtext: { type: String, default: "" },

    emailHeaderColor: { type: String, default: "#4F46E5" },
    emailFooterText: { type: String, default: "" },

    pdfHeaderText: { type: String, default: "" },
    pdfFooterText: { type: String, default: "" },
    showPoweredBy: { type: Boolean, default: true },
  },
  { _id: false }
);

const onboardingStepSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "skipped"],
      default: "pending",
    },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const organizationSchema = createGlobalSchema({
  name: { type: String, required: true, trim: true },
  legalName: { type: String, trim: true, default: "" },
  displayName: { type: String, trim: true, default: "" },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

  registrationNumber: { type: String, trim: true, default: "" },
  taxId: { type: String, trim: true, default: "" }, // GSTIN / VAT / EIN
  panNumber: { type: String, trim: true, default: "" },
  pfNumber: { type: String, trim: true, default: "" },
  esiNumber: { type: String, trim: true, default: "" },

  industry: { type: String, trim: true, default: "" },
  businessType: {
    type: String,
    enum: [
      "private_limited",
      "public_limited",
      "llp",
      "partnership",
      "proprietorship",
      "ngo",
      "government",
      "other",
    ],
    default: "private_limited",
  },
  companySize: {
    type: String,
    enum: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"],
    default: "11-50",
  },

  website: { type: String, trim: true, default: "" },
  email: { type: String, trim: true, lowercase: true, default: "" },
  phone: { type: String, trim: true, default: "" },
  address: { type: addressSchema, default: () => ({}) },

  // Locale. Every date decision in the platform is made against this zone.
  timezone: {
    type: String,
    default: "Asia/Kolkata",
    validate: {
      validator: (v) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: v });
          return true;
        } catch {
          return false;
        }
      },
      message: "Not a recognised timezone",
    },
  },
  currency: { type: String, default: "INR", uppercase: true, maxlength: 3 },
  currencySymbol: { type: String, default: "₹" },
  locale: { type: String, default: "en-IN" },

  branding: { type: brandingSchema, default: () => ({}) },

  status: {
    type: String,
    enum: ["trial", "active", "past_due", "suspended", "cancelled"],
    default: "trial",
    index: true,
  },
  suspendedReason: { type: String, default: null },

  // Subscription snapshot. The authoritative record is the Subscription
  // document; this copy is what the per-request plan guard reads so a limit
  // check never costs an extra query.
  plan: {
    code: { type: String, default: "trial" },
    name: { type: String, default: "Free Trial" },
    trialEndsAt: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    limits: {
      employees: { type: Number, default: 25 },
      admins: { type: Number, default: 3 },
      biometricDevices: { type: Number, default: 1 },
      storageMb: { type: Number, default: 1024 },
      apiAccess: { type: Boolean, default: false },
    },
    features: { type: [String], default: [] },
  },

  // Per-organization overrides on top of the plan's feature list. Lets support
  // switch one customer's payroll on without inventing a new plan.
  featureOverrides: { type: Map, of: Boolean, default: {} },

  onboarding: {
    status: {
      type: String,
      enum: ["not_started", "in_progress", "completed"],
      default: "not_started",
    },
    steps: { type: [onboardingStepSchema], default: [] },
    completedAt: { type: Date, default: null },
    dismissed: { type: Boolean, default: false },
  },

  usage: {
    employeeCount: { type: Number, default: 0 },
    activeEmployeeCount: { type: Number, default: 0 },
    storageBytes: { type: Number, default: 0 },
    lastRecalculatedAt: { type: Date, default: null },
  },

  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  deletedAt: { type: Date, default: null },
});

organizationSchema.index({ status: 1, createdAt: -1 });
organizationSchema.index({ "plan.code": 1 });

organizationSchema.virtual("isActive").get(function isActive() {
  return this.status === "trial" || this.status === "active";
});

/** Drive folder name for this tenant — stable and human-readable. */
organizationSchema.virtual("storageFolderName").get(function folderName() {
  return `${this.slug}-${String(this._id).slice(-6)}`;
});

module.exports = mongoose.model("Organization", organizationSchema);
