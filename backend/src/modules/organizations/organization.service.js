"use strict";

const Organization = require("./organization.model");
const Membership = require("../rbac/membership.model");
const Role = require("../rbac/role.model");
const rbac = require("../rbac/rbac.service");
const onboarding = require("./onboardingSteps");
const { snapshotFor } = require("./plans");
const { featuresFor } = require("./planGuard");
const { AppError } = require("../../core/errors/AppError");
const tenant = require("../../core/tenancy/tenantContext");
const audit = require("../../core/audit/audit.service");
const storage = require("../../core/storage/storage.service");
const { invalidateOrganizationCache } = require("../auth/authenticate");
const { logger } = require("../../config/logger");

/**
 * Organization lifecycle: provisioning, profile, branding and onboarding.
 */

const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "chefotech", "support", "help", "status",
  "login", "signup", "register", "docs", "blog", "mail", "static", "assets",
]);

async function slugify(name) {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "company";

  let candidate = base;
  let suffix = 1;
  // Slugs are global, so a collision has to be resolved at creation time.
  while (
    RESERVED_SLUGS.has(candidate) ||
    (await Organization.exists({ slug: candidate }))
  ) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
    if (suffix > 500) throw AppError.conflict("Could not generate a unique workspace address.");
  }
  return candidate;
}

/**
 * Create an organization and everything it needs to be usable:
 * roles, an owner membership, and the onboarding checklist.
 *
 * Runs in a system context because the tenant it is scoping to does not exist
 * until halfway through.
 */
async function provision({ name, ownerUserId, planCode = "trial", timezone, currency, country }, req) {
  return tenant.runAsSystem(async () => {
    const slug = await slugify(name);

    const organization = await Organization.create({
      name,
      displayName: name,
      slug,
      timezone: timezone || "Asia/Kolkata",
      currency: currency || "INR",
      currencySymbol: currencySymbolFor(currency || "INR"),
      address: { country: country || "India" },
      status: "trial",
      plan: snapshotFor(planCode),
      onboarding: { status: "in_progress", steps: onboarding.initialSteps() },
      ownerUserId,
      createdByUserId: ownerUserId,
    });

    // From here on, work inside the new tenant.
    const membership = await tenant.runWithTenant(organization._id, async () => {
      await rbac.seedRoles(organization._id);
      const ownerRole = await Role.findOne({ isOwner: true });

      const created = await Membership.create({
        organizationId: organization._id,
        userId: ownerUserId,
        roleIds: [ownerRole._id],
        permissions: ownerRole.permissions,
        status: "active",
        joinedAt: new Date(),
        isManager: true,
      });

      await Role.updateOne({ _id: ownerRole._id }, { $inc: { memberCount: 1 } });
      return created;
    });

    await audit.record(
      {
        organizationId: organization._id,
        actorId: ownerUserId,
        actorType: "user",
        action: "organization.created",
        entityType: "Organization",
        entityId: organization._id,
        entityLabel: organization.name,
        severity: "notice",
        description: `Organization "${organization.name}" created`,
      },
      req
    );

    logger.info({ organizationId: String(organization._id), slug }, "Organization provisioned");
    return { organization, membership };
  }, "organization.provision");
}

function currencySymbolFor(code) {
  return { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "د.إ", SGD: "S$", AUD: "A$" }[code] || code;
}

/** The current organization, resolved with branding URLs expanded. */
async function current() {
  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "organization.read-self"
  );
  if (!organization) throw AppError.notFound("Organization");
  return decorate(organization);
}

/**
 * Expand StoredFile references into renderable URLs.
 *
 * Branding assets are the one class of file that is deliberately public — a
 * logo has to load on the login page before anyone has authenticated — so
 * these come back as lh3 URLs rather than proxy paths.
 */
async function decorate(organization) {
  const branding = organization.branding || {};
  const fileIds = [
    branding.logoFileId,
    branding.logoDarkFileId,
    branding.faviconFileId,
    branding.letterheadFileId,
    branding.watermarkFileId,
    branding.loginBackgroundFileId,
  ].filter(Boolean);

  let files = [];
  if (fileIds.length) {
    files = await storage.StoredFile.find({ _id: { $in: fileIds } })
      .setOptions({ bypassTenant: tenant.isSystemContext() })
      .lean()
      .catch(() => []);
  }
  const byId = Object.fromEntries(files.map((f) => [String(f._id), f]));
  /**
   * Delegate to the storage layer rather than deciding here.
   *
   * This used to branch on provider itself and fall back to a hard-coded
   * relative path — which meant a logo stored anywhere except public Drive
   * came back as `/api/v1/files/...`, and the browser resolved that against
   * the FRONTEND origin, where nothing serves it. The sidebar logo silently
   * failed to load, and the API prefix was duplicated here where it could
   * drift from the configured one. `publicImageUrl` already knows every
   * provider and returns an absolute URL.
   */
  const urlFor = (id, width) => {
    const file = id && byId[String(id)];
    if (!file) return null;
    return storage.publicImageUrl(file, { width });
  };

  const progress = onboarding.computeProgress(
    (organization.onboarding && organization.onboarding.steps) || []
  );

  return {
    ...organization,
    id: String(organization._id),
    features: featuresFor(organization),
    branding: {
      ...branding,
      logoUrl: urlFor(branding.logoFileId, 400),
      logoDarkUrl: urlFor(branding.logoDarkFileId, 400),
      faviconUrl: urlFor(branding.faviconFileId, 64),
      letterheadUrl: urlFor(branding.letterheadFileId, 1600),
      watermarkUrl: urlFor(branding.watermarkFileId, 800),
      loginBackgroundUrl: urlFor(branding.loginBackgroundFileId, 1920),
    },
    onboardingProgress: progress,
  };
}

async function update(patch, req) {
  const organizationId = tenant.requireOrganizationId();
  const organization = await tenant.runAsSystem(
    () => Organization.findById(organizationId),
    "organization.update"
  );
  if (!organization) throw AppError.notFound("Organization");

  const before = organization.toObject();
  const editable = [
    "name", "legalName", "displayName", "registrationNumber", "taxId",
    "panNumber", "pfNumber", "esiNumber", "industry", "businessType",
    "companySize", "website", "email", "phone", "address", "timezone",
    "currency", "locale",
  ];

  for (const key of editable) {
    if (patch[key] !== undefined) organization[key] = patch[key];
  }
  if (patch.currency) organization.currencySymbol = currencySymbolFor(patch.currency);

  await tenant.runAsSystem(() => organization.save(), "organization.update");
  invalidateOrganizationCache(organizationId);

  await audit.record(
    {
      action: "organization.updated",
      entityType: "Organization",
      entityId: organization._id,
      entityLabel: organization.name,
      before: pick(before, editable),
      after: pick(organization.toObject(), editable),
      severity: "notice",
      skipIfUnchanged: true,
    },
    req
  );

  return decorate(organization.toObject());
}

async function updateBranding(patch, req) {
  const organizationId = tenant.requireOrganizationId();
  const organization = await tenant.runAsSystem(
    () => Organization.findById(organizationId),
    "organization.branding"
  );
  if (!organization) throw AppError.notFound("Organization");

  const before = { ...(organization.branding || {}) };
  organization.branding = { ...(organization.branding || {}), ...patch };

  await tenant.runAsSystem(() => organization.save(), "organization.branding");
  invalidateOrganizationCache(organizationId);

  await audit.record(
    {
      action: "organization.branding_updated",
      entityType: "Organization",
      entityId: organization._id,
      before,
      after: { ...organization.branding },
      severity: "info",
      skipIfUnchanged: true,
    },
    req
  );

  return (await decorate(organization.toObject())).branding;
}

async function getOnboarding() {
  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "organization.onboarding"
  );
  const steps = (organization.onboarding && organization.onboarding.steps) || [];
  return {
    status: organization.onboarding && organization.onboarding.status,
    dismissed: Boolean(organization.onboarding && organization.onboarding.dismissed),
    steps: onboarding.describe(steps),
    progress: onboarding.computeProgress(steps),
  };
}

/** Mark a checklist step completed, skipped, or back to pending. */
async function setOnboardingStep(stepKey, status, req) {
  if (!onboarding.STEP_KEYS.includes(stepKey)) {
    throw AppError.badRequest(`Unknown onboarding step '${stepKey}'`);
  }
  const organizationId = tenant.requireOrganizationId();

  return tenant.runAsSystem(async () => {
    const organization = await Organization.findById(organizationId);
    if (!organization) throw AppError.notFound("Organization");

    const steps = organization.onboarding.steps || [];
    const existing = steps.find((s) => s.key === stepKey);
    const patch = {
      key: stepKey,
      status,
      completedAt: status === "completed" || status === "skipped" ? new Date() : null,
      completedBy: tenant.getUserId() || null,
    };
    if (existing) Object.assign(existing, patch);
    else steps.push(patch);

    organization.onboarding.steps = steps;
    const progress = onboarding.computeProgress(steps);
    if (progress.isComplete && organization.onboarding.status !== "completed") {
      organization.onboarding.status = "completed";
      organization.onboarding.completedAt = new Date();
    } else if (!progress.isComplete) {
      organization.onboarding.status = "in_progress";
      organization.onboarding.completedAt = null;
    }

    await organization.save();
    invalidateOrganizationCache(organizationId);

    await audit.record(
      {
        organizationId,
        action: "organization.onboarding_step",
        entityType: "Organization",
        entityId: organization._id,
        entityLabel: stepKey,
        after: { step: stepKey, status },
        severity: "info",
      },
      req
    );

    return {
      steps: onboarding.describe(organization.onboarding.steps),
      progress,
    };
  }, "organization.onboarding");
}

/**
 * Called by modules when the user completes the underlying work, so the
 * checklist reflects reality without them clicking anything. Creating the
 * first department ticks "departments" on its own.
 */
async function markStepCompleteIfPending(stepKey) {
  try {
    const organizationId = tenant.getOrganizationId();
    if (!organizationId) return;
    await tenant.runAsSystem(async () => {
      const organization = await Organization.findById(organizationId).select("onboarding");
      if (!organization) return;
      const step = (organization.onboarding.steps || []).find((s) => s.key === stepKey);
      if (step && step.status !== "pending" && step.status !== "in_progress") return;
      if (step) {
        step.status = "completed";
        step.completedAt = new Date();
      } else {
        organization.onboarding.steps.push({
          key: stepKey,
          status: "completed",
          completedAt: new Date(),
        });
      }
      const progress = onboarding.computeProgress(organization.onboarding.steps);
      if (progress.isComplete) {
        organization.onboarding.status = "completed";
        organization.onboarding.completedAt = new Date();
      }
      await organization.save();
      invalidateOrganizationCache(organizationId);
    }, "organization.auto-onboarding");
  } catch (err) {
    // Never fail the user's actual action because a checklist tick failed.
    logger.warn({ err, stepKey }, "Could not auto-complete onboarding step");
  }
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

module.exports = {
  provision,
  current,
  decorate,
  update,
  updateBranding,
  getOnboarding,
  setOnboardingStep,
  markStepCompleteIfPending,
  slugify,
  Organization,
};
