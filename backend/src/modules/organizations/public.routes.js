"use strict";

const express = require("express");
const { z } = require("zod");
const Organization = require("./organization.model");
const storage = require("../../core/storage/storage.service");
const { PLANS } = require("./plans");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { validate } = require("../../core/validation/validate");
const { ok } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const tenant = require("../../core/tenancy/tenantContext");
const { SUPPORTED_TIMEZONES } = require("../../shared/datetime");
const { strictLimiter } = require("../../core/security/rateLimit");

/**
 * Unauthenticated endpoints for the marketing site and the sign-in screen.
 *
 * Everything here is deliberately minimal. The branding lookup returns colours
 * and a logo URL and nothing else — no employee counts, no plan, no contact
 * details — because it answers to an anonymous caller who has only guessed a
 * workspace name.
 */
const router = express.Router();

router.get(
  "/plans",
  asyncHandler(async (_req, res) =>
    ok(
      res,
      PLANS.filter((p) => p.isPublic).map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        monthlyPricePerEmployee: p.monthlyPricePerEmployee,
        minimumBillable: p.minimumBillable || null,
        trialDays: p.trialDays || null,
        limits: p.limits.employees === Number.MAX_SAFE_INTEGER
          ? { ...p.limits, employees: null, admins: null, biometricDevices: null, storageMb: null }
          : p.limits,
        features: p.features,
        isPopular: Boolean(p.isPopular),
      }))
    )
  )
);

router.get(
  "/timezones",
  asyncHandler(async (_req, res) =>
    ok(
      res,
      SUPPORTED_TIMEZONES.map((tz) => ({
        value: tz,
        label: tz.replace(/_/g, " "),
        offset: offsetLabel(tz),
      }))
    )
  )
);

/** Login-page branding for a workspace, by slug. */
router.get(
  "/branding/:slug",
  strictLimiter,
  validate({ params: z.object({ slug: z.string().max(64) }) }),
  asyncHandler(async (req, res) => {
    const organization = await Organization.findOne({
      slug: req.params.slug.toLowerCase(),
      deletedAt: null,
    })
      .select("name displayName slug branding status")
      .lean();

    if (!organization || organization.status === "cancelled") {
      throw AppError.notFound("Workspace");
    }

    const branding = organization.branding || {};
    const resolve = async (fileId, width) => {
      if (!fileId) return null;
      const file = await tenant.runAsSystem(
        () => storage.StoredFile.findById(fileId).setOptions({ bypassTenant: true }).lean(),
        "public.branding"
      );
      if (!file || file.visibility !== "public") return null;
      return storage.publicImageUrl(file, { width });
    };

    return ok(res, {
      name: organization.displayName || organization.name,
      slug: organization.slug,
      logoUrl: await resolve(branding.logoFileId, 400),
      faviconUrl: await resolve(branding.faviconFileId, 64),
      loginBackgroundUrl: await resolve(branding.loginBackgroundFileId, 1920),
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      accentColor: branding.accentColor,
      loginHeadline: branding.loginHeadline,
      loginSubtext: branding.loginSubtext,
    });
  })
);

function offsetLabel(timezone) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    });
    const part = formatter.formatToParts(now).find((p) => p.type === "timeZoneName");
    return part ? part.value : "";
  } catch {
    return "";
  }
}

module.exports = router;
