"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./organization.service");
const storage = require("../../core/storage/storage.service");
const Organization = require("./organization.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { uploadSingle } = require("../../core/http/upload");
const { ok } = require("../../core/http/response");
const { hexColor, phone } = require("../../core/validation/common");
const { isValidTimezone } = require("../../shared/datetime");
const { AppError } = require("../../core/errors/AppError");
const tenant = require("../../core/tenancy/tenantContext");
const { STEP_KEYS } = require("./onboardingSteps");

const AddressSchema = z.object({
  line1: z.string().max(120).optional(),
  line2: z.string().max(120).optional(),
  city: z.string().max(60).optional(),
  state: z.string().max(60).optional(),
  country: z.string().max(60).optional(),
  postalCode: z.string().max(20).optional(),
});

const UpdateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().max(160).optional(),
  displayName: z.string().max(120).optional(),
  registrationNumber: z.string().max(60).optional(),
  taxId: z.string().max(40).optional(),
  panNumber: z.string().max(20).optional(),
  pfNumber: z.string().max(40).optional(),
  esiNumber: z.string().max(40).optional(),
  industry: z.string().max(60).optional(),
  businessType: z
    .enum(["private_limited", "public_limited", "llp", "partnership", "proprietorship", "ngo", "government", "other"])
    .optional(),
  companySize: z.enum(["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"]).optional(),
  website: z.string().max(160).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: phone().optional().or(z.literal("")),
  address: AddressSchema.optional(),
  timezone: z.string().refine(isValidTimezone, "Not a recognised timezone").optional(),
  currency: z.string().length(3).optional(),
  locale: z.string().max(10).optional(),
});

const BrandingSchema = z.object({
  primaryColor: hexColor().optional(),
  secondaryColor: hexColor().optional(),
  accentColor: hexColor().optional(),
  sidebarStyle: z.enum(["light", "dark", "brand"]).optional(),
  borderRadius: z.enum(["none", "small", "medium", "large"]).optional(),
  fontFamily: z.string().max(60).optional(),
  loginHeadline: z.string().max(120).optional(),
  loginSubtext: z.string().max(240).optional(),
  emailHeaderColor: hexColor().optional(),
  emailFooterText: z.string().max(300).optional(),
  pdfHeaderText: z.string().max(300).optional(),
  pdfFooterText: z.string().max(300).optional(),
  showPoweredBy: z.boolean().optional(),
});

const BRANDING_ASSETS = {
  logo: "logoFileId",
  logoDark: "logoDarkFileId",
  favicon: "faviconFileId",
  letterhead: "letterheadFileId",
  watermark: "watermarkFileId",
  loginBackground: "loginBackgroundFileId",
};

const router = express.Router();
router.use(authenticate());

/** The caller's own organization. Never takes an id — it comes from the token. */
router.get(
  "/current",
  asyncHandler(async (_req, res) => ok(res, await service.current()))
);

router.patch(
  "/current",
  requirePermission("settings.manage"),
  validate({ body: UpdateOrganizationSchema }),
  asyncHandler(async (req, res) => {
    const result = await service.update(req.body, req);
    // Filling in the company profile ticks that step off the checklist.
    if (req.body.legalName || req.body.registrationNumber || req.body.address) {
      await service.markStepCompleteIfPending("company");
    }
    return ok(res, result);
  })
);

// ── Branding ────────────────────────────────────────────────────────────────

router.get(
  "/current/branding",
  asyncHandler(async (_req, res) => {
    const organization = await service.current();
    return ok(res, organization.branding);
  })
);

router.patch(
  "/current/branding",
  requirePermission("settings.manage_branding"),
  validate({ body: BrandingSchema }),
  asyncHandler(async (req, res) => {
    const branding = await service.updateBranding(req.body, req);
    await service.markStepCompleteIfPending("branding");
    return ok(res, branding);
  })
);

/**
 * Branding assets are the one deliberately public class of file: the logo has
 * to render on the login page before anyone has signed in. They are stored
 * with public visibility and served from Google's lh3 host.
 */
router.post(
  "/current/branding/:asset",
  requirePermission("settings.manage_branding"),
  validate({ params: z.object({ asset: z.enum(Object.keys(BRANDING_ASSETS)) }) }),
  uploadSingle("file", { maxBytes: 5 * 1024 * 1024 }),
  asyncHandler(async (req, res) => {
    const field = BRANDING_ASSETS[req.params.asset];
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "branding.upload"
    );

    const stored = await storage.save({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      category: "branding",
      visibility: "public",
      ownerType: "Organization",
      ownerId: organization._id,
      orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
      metadata: { asset: req.params.asset },
    });

    const previousId = organization.branding && organization.branding[field];
    await service.updateBranding({ [field]: stored._id }, req);

    if (previousId) {
      const previous = await storage.StoredFile.findById(previousId);
      if (previous) await storage.destroy(previous, tenant.getUserId()).catch(() => {});
    }

    await service.markStepCompleteIfPending("branding");

    return ok(res, {
      asset: req.params.asset,
      fileId: String(stored._id),
      url: storage.publicImageUrl(stored, { width: 800 }),
    });
  })
);

router.delete(
  "/current/branding/:asset",
  requirePermission("settings.manage_branding"),
  validate({ params: z.object({ asset: z.enum(Object.keys(BRANDING_ASSETS)) }) }),
  asyncHandler(async (req, res) => {
    const field = BRANDING_ASSETS[req.params.asset];
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "branding.delete"
    );
    const fileId = organization.branding && organization.branding[field];
    if (fileId) {
      const file = await storage.StoredFile.findById(fileId);
      if (file) await storage.destroy(file, tenant.getUserId()).catch(() => {});
    }
    await service.updateBranding({ [field]: null }, req);
    return ok(res, { asset: req.params.asset, removed: true });
  })
);

// ── Onboarding ──────────────────────────────────────────────────────────────

router.get(
  "/current/onboarding",
  asyncHandler(async (_req, res) => ok(res, await service.getOnboarding()))
);

/**
 * Fill in the standard configuration a company needs to get started — a
 * shift, an attendance policy, leave types and salary components.
 *
 * Runs automatically at signup; this endpoint exists for organizations
 * created before it did, and for anyone who cleared something out and wants
 * the conventional starting point back. Idempotent by code, so anything the
 * customer has already set up is left untouched.
 */
router.post(
  "/current/starter-data",
  requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    const { seedStarterData } = require("../../core/setup/starterData.service");
    return ok(res, await seedStarterData());
  })
);

router.post(
  "/current/onboarding/:step",
  requirePermission("settings.manage"),
  validate({
    params: z.object({ step: z.enum(STEP_KEYS) }),
    body: z.object({ status: z.enum(["pending", "in_progress", "completed", "skipped"]) }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await service.setOnboardingStep(req.params.step, req.body.status, req))
  )
);

// ── Plan and usage ──────────────────────────────────────────────────────────

router.get(
  "/current/usage",
  requirePermission("settings.view"),
  asyncHandler(async (req, res) => {
    const Employee = require("../employees/employee.model");
    const Membership = require("../rbac/membership.model");
    const BiometricDevice = require("../biometric/biometricDevice.model");
    const { remaining } = require("./planGuard");

    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "organization.usage"
    );

    const [employees, admins, devices, storageBytes] = await Promise.all([
      Employee.countDocuments({ status: { $in: ["active", "on_leave", "notice_period", "suspended", "invited"] } }),
      Membership.countDocuments({ status: "active", permissions: "settings.manage" }),
      BiometricDevice.countDocuments({ isActive: true }).catch(() => 0),
      storage.StoredFile.aggregate([{ $group: { _id: null, total: { $sum: "$size" } } }])
        .then((r) => (r[0] ? r[0].total : 0))
        .catch(() => 0),
    ]);

    const storageMb = Math.round(storageBytes / 1024 / 1024);

    return ok(res, {
      plan: organization.plan,
      usage: { employees, admins, biometricDevices: devices, storageMb },
      remaining: {
        employees: remaining(organization, "employees", employees),
        admins: remaining(organization, "admins", admins),
        biometricDevices: remaining(organization, "biometricDevices", devices),
        storageMb: remaining(organization, "storageMb", storageMb),
      },
    });
  })
);

module.exports = router;
