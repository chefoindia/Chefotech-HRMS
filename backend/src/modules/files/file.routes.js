"use strict";

const express = require("express");
const { z } = require("zod");
const storage = require("../../core/storage/storage.service");
const { authenticate } = require("../auth/authenticate");
const { requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { uploadSingle } = require("../../core/http/upload");
const { objectIdParam } = require("../../core/validation/common");
const { ok, created } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const Organization = require("../organizations/organization.model");

/**
 * The file proxy.
 *
 * This is the ONLY route through which a private file's bytes leave the
 * platform. Public branding images bypass it and render straight from Google's
 * lh3 host, which is what makes a logo work in an unauthenticated <img> tag;
 * everything else — payslips, identity scans, contracts — is streamed from
 * here after the caller's tenant and permissions have been checked.
 *
 * A leaked Drive file id is therefore worthless on its own: the file is never
 * shared publicly, and this route resolves ids only inside the caller's own
 * organization.
 */

const router = express.Router();
router.use(authenticate());

/**
 * Can this caller read this file?
 *
 * Ownership is delegated to whichever module owns the entity, because the rule
 * "who may see this employee's payslip" belongs to payroll, not to storage.
 */
async function assertCanRead(file, auth) {
  const permissions = auth.permissions || [];

  // The uploader can always retrieve what they uploaded.
  if (file.uploadedBy && String(file.uploadedBy) === String(auth.userId)) return;

  switch (file.ownerType) {
    case "Employee": {
      const isSelf = auth.employeeId && String(auth.employeeId) === String(file.ownerId);
      if (isSelf) return;
      if (file.category === "avatar" && permissions.includes("employee.view")) return;
      if (permissions.includes("document.view") || permissions.includes("employee.view_sensitive")) {
        const employeeService = require("../employees/employee.service");
        await employeeService.assertCanView(auth, file.ownerId);
        return;
      }
      break;
    }

    case "Payslip": {
      if (permissions.includes("payroll.view")) return;
      const { Payslip } = require("../payroll/payroll.model");
      const payslip = await Payslip.findById(file.ownerId).select("employeeId").lean();
      if (payslip && auth.employeeId && String(payslip.employeeId) === String(auth.employeeId)) {
        if (permissions.includes("payroll.view_own_payslip")) return;
      }
      break;
    }

    case "Organization":
      // Branding and company-wide documents: any member may read them.
      return;

    case "OrganizationExport":
      // The whole tenant in one zip: only whoever can change settings.
      if (permissions.includes("settings.manage")) return;
      break;

    case "SheetSchedule":
      if (permissions.includes("report.export")) return;
      break;

    default:
      if (permissions.includes("document.view")) return;
      break;
  }

  // 404 rather than 403 — the caller should not learn that the file exists.
  throw AppError.notFound("File");
}

router.get(
  "/:id/content",
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const file = await storage.StoredFile.findById(req.params.id).lean();
    if (!file) throw AppError.notFound("File");

    await assertCanRead(file, req.auth);

    const { stream, mimeType, fileName } = await storage.openStream(file);

    const forceDownload =
      req.query.download === "1" || storage.shouldForceDownload(file.mimeType);

    res.setHeader("Content-Type", mimeType || file.mimeType);
    res.setHeader(
      "Content-Disposition",
      `${forceDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(
        file.originalName || fileName || "file"
      )}"`
    );
    // An HR document must never sit in a shared cache, and must never be
    // interpreted as a document with script access to our origin.
    res.setHeader("Cache-Control", "private, max-age=300, no-transform");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");

    stream.on("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    });

    return stream.pipe(res);
  })
);

router.get(
  "/:id",
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const file = await storage.StoredFile.findById(req.params.id).lean();
    if (!file) throw AppError.notFound("File");
    await assertCanRead(file, req.auth);
    return ok(res, storage.toPublicShape(file));
  })
);

/** Generic upload. Modules with their own rules use their own endpoints. */
router.post(
  "/",
  requireAnyPermission("document.upload", "employee.update", "profile.update_own"),
  uploadSingle("file"),
  validate({
    body: z.object({
      category: z
        .enum(["employee-document", "company-document", "attachment", "other"])
        .optional(),
      ownerType: z.string().max(40).optional(),
      ownerId: z.string().max(40).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "file.upload"
    );

    const stored = await storage.save({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      category: req.body.category || "attachment",
      ownerType: req.body.ownerType || null,
      ownerId: req.body.ownerId || null,
      orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
    });

    await audit.record(
      {
        action: "file.uploaded",
        entityType: "StoredFile",
        entityId: stored._id,
        entityLabel: stored.originalName,
        after: { category: stored.category, size: stored.size, mimeType: stored.mimeType },
      },
      req
    );

    return created(res, storage.toPublicShape(stored.toObject()));
  })
);

router.delete(
  "/:id",
  requireAnyPermission("document.delete", "employee.update"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const file = await storage.StoredFile.findById(req.params.id);
    if (!file) throw AppError.notFound("File");
    await assertCanRead(file.toObject(), req.auth);

    await storage.destroy(file, req.auth.userId);

    await audit.record(
      {
        action: "file.deleted",
        entityType: "StoredFile",
        entityId: file._id,
        entityLabel: file.originalName,
        severity: "warning",
      },
      req
    );

    return ok(res, { id: String(file._id), deleted: true });
  })
);

module.exports = router;
