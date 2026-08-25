"use strict";

const { DocumentTemplate, EmployeeDocument } = require("./document.model");
const renderer = require("./pdfRenderer");
const defaultTemplates = require("./defaultTemplates");
const Employee = require("../employees/employee.model");
const Organization = require("../organizations/organization.model");
const storage = require("../../core/storage/storage.service");
const employeeService = require("../employees/employee.service");
const payrollService = require("../payroll/payroll.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/**
 * Document generation and employee document storage.
 *
 * Generated documents are stored exactly like uploaded ones — as private
 * files behind the authenticated proxy — so an offer letter is no more
 * reachable by URL guessing than a passport scan.
 */

// ── Templates ───────────────────────────────────────────────────────────────

async function seedDefaultTemplates(req) {
  const existing = await DocumentTemplate.find({}).select("code").lean();
  const have = new Set(existing.map((t) => t.code));

  const toCreate = defaultTemplates.TEMPLATES.filter((t) => !have.has(t.code)).map((t) => ({
    ...t,
    organizationId: tenant.requireOrganizationId(),
    isSystem: true,
  }));

  if (toCreate.length) await DocumentTemplate.insertMany(toCreate);
  return { created: toCreate.length };
}

async function listTemplates(query = {}) {
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.contextType) filter.contextType = query.contextType;
  if (query.isActive !== undefined) filter.isActive = query.isActive !== "false";
  return DocumentTemplate.find(filter).sort({ category: 1, name: 1 }).lean();
}

async function getTemplate(templateId) {
  const template = await DocumentTemplate.findById(templateId).lean();
  if (!template) throw AppError.notFound("Template");
  return template;
}

async function createTemplate(data, req) {
  const template = await DocumentTemplate.create({ ...data, createdBy: tenant.getUserId() });
  await audit.record(
    {
      action: "documenttemplate.created",
      entityType: "DocumentTemplate",
      entityId: template._id,
      entityLabel: template.name,
      severity: "notice",
    },
    req
  );
  return template;
}

async function updateTemplate(templateId, data, req) {
  const template = await DocumentTemplate.findById(templateId);
  if (!template) throw AppError.notFound("Template");

  const before = { name: template.name, blockCount: (template.blocks || []).length };
  Object.assign(template, data, { updatedBy: tenant.getUserId() });
  await template.save();

  await audit.record(
    {
      action: "documenttemplate.updated",
      entityType: "DocumentTemplate",
      entityId: template._id,
      entityLabel: template.name,
      before,
      after: { name: template.name, blockCount: (template.blocks || []).length },
      skipIfUnchanged: true,
    },
    req
  );
  return template;
}

async function deleteTemplate(templateId, req) {
  const template = await DocumentTemplate.findById(templateId);
  if (!template) throw AppError.notFound("Template");
  if (template.isSystem) {
    // Built-ins can be edited or deactivated, but deleting one would remove a
    // capability from the organization with no way back.
    template.isActive = false;
    await template.save();
    return { id: String(template._id), deactivated: true };
  }
  await template.softDelete(tenant.getUserId());
  await audit.record(
    {
      action: "documenttemplate.deleted",
      entityType: "DocumentTemplate",
      entityId: template._id,
      entityLabel: template.name,
      severity: "warning",
    },
    req
  );
  return { id: String(template._id), deleted: true };
}

// ── Context assembly ────────────────────────────────────────────────────────

/**
 * Build the placeholder context a template renders against.
 * This is the contract the template editor's variable list documents.
 */
async function buildContext(template, { employeeId, payslipId, leaveRequestId } = {}) {
  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "document.context"
  );

  const address = organization.address || {};
  const context = {
    company: {
      name: organization.name,
      legalName: organization.legalName || organization.name,
      email: organization.email,
      phone: organization.phone,
      website: organization.website,
      taxId: organization.taxId,
      registrationNumber: organization.registrationNumber,
      addressLine: [address.line1, address.line2, address.city, address.state, address.postalCode]
        .filter(Boolean)
        .join(", "),
      city: address.city,
      state: address.state,
      country: address.country,
      currency: organization.currency,
      currencySymbol: organization.currencySymbol,
      primaryColor: organization.branding && organization.branding.primaryColor,
    },
    date: {
      today: dt.todayString(organization.timezone),
      todayFormatted: new Date().toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      year: new Date().getFullYear(),
    },
  };

  if (employeeId) {
    const employee = await Employee.findById(employeeId)
      .populate([
        { path: "employment.departmentId", select: "name" },
        { path: "employment.designationId", select: "name grade" },
        { path: "employment.locationId", select: "name address" },
        { path: "employment.managerId", select: "personal.firstName personal.lastName" },
      ])
      .lean();

    if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

    const personal = employee.personal || {};
    const employment = employee.employment || {};

    context.employee = {
      id: String(employee._id),
      employeeId: employee.employeeCode,
      employeeCode: employee.employeeCode,
      name: [personal.firstName, personal.middleName, personal.lastName].filter(Boolean).join(" "),
      firstName: personal.firstName,
      lastName: personal.lastName,
      gender: personal.gender,
      dateOfBirth: personal.dateOfBirth,
      email: personal.workEmail,
      personalEmail: personal.personalEmail,
      phone: personal.phone,
      fatherName: personal.fatherName,
      address: [
        personal.currentAddress && personal.currentAddress.line1,
        personal.currentAddress && personal.currentAddress.city,
        personal.currentAddress && personal.currentAddress.state,
        personal.currentAddress && personal.currentAddress.postalCode,
      ]
        .filter(Boolean)
        .join(", "),
      department: employment.departmentId && employment.departmentId.name,
      designation: employment.designationId && employment.designationId.name,
      grade: employment.designationId && employment.designationId.grade,
      location: employment.locationId && employment.locationId.name,
      manager:
        employment.managerId &&
        [employment.managerId.personal.firstName, employment.managerId.personal.lastName]
          .filter(Boolean)
          .join(" "),
      joiningDate: employment.joiningDate,
      joiningDateFormatted: employment.joiningDate
        ? new Date(employment.joiningDate).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "",
      confirmationDate: employment.confirmationDate,
      employmentType: String(employment.employmentType || "").replace(/_/g, " "),
      status: employee.status,
      lastWorkingDay: employee.exit && employee.exit.lastWorkingDay,
      // Tenure in whole years and months, which is what an experience letter
      // needs and what nobody wants to compute by hand.
      tenure: employment.joiningDate ? describeTenure(employment.joiningDate, employee.exit && employee.exit.lastWorkingDay) : "",
    };

    // Salary is only added when the template asks for it, so an offer letter
    // template cannot accidentally leak CTC into an address-proof letter.
    if (["salary_slip", "salary_certificate", "offer_letter", "appointment_letter", "increment_letter"].includes(template.category)) {
      const salary = await payrollService.salaryFor(employeeId, context.date.today);
      if (salary) {
        context.salary = {
          ctcAnnual: salary.ctcAnnual,
          ctcMonthly: salary.ctcMonthly,
          ctcAnnualFormatted: formatMoney(salary.ctcAnnual, organization),
          ctcMonthlyFormatted: formatMoney(salary.ctcMonthly, organization),
          effectiveFrom: salary.effectiveFrom,
          components: salary.componentAmounts instanceof Map
            ? Object.fromEntries(salary.componentAmounts)
            : salary.componentAmounts || {},
        };
      }
    }
  }

  if (payslipId) {
    const payslip = await payrollService.Payslip.findById(payslipId).populate("periodId").lean();
    if (payslip) {
      const snapshot = payslip.snapshot || {};
      context.payslip = {
        number: payslip.payslipNumber,
        period: payslip.periodLabel,
        gross: payslip.gross,
        grossFormatted: formatMoney(payslip.gross, organization),
        deductions: payslip.totalDeductions,
        deductionsFormatted: formatMoney(payslip.totalDeductions, organization),
        net: payslip.net,
        netFormatted: formatMoney(payslip.net, organization),
        payDate: payslip.periodId && payslip.periodId.payDate,
        attendance: snapshot.attendance || {},
        earnings: (snapshot.lines || [])
          .filter((l) => l.type === "earning" && l.showOnPayslip)
          .map((l) => ({ name: l.name, amount: formatMoney(l.amount, organization) })),
        deductionLines: (snapshot.lines || [])
          .filter((l) => l.type === "deduction" && l.showOnPayslip)
          .map((l) => ({ name: l.name, amount: formatMoney(l.amount, organization) })),
      };
    }
  }

  if (leaveRequestId) {
    const { LeaveRequest } = require("../leave/leave.model");
    const request = await LeaveRequest.findById(leaveRequestId).populate("leaveTypeId", "name").lean();
    if (request) {
      context.leave = {
        type: request.leaveTypeId && request.leaveTypeId.name,
        from: request.fromDate,
        to: request.toDate,
        days: request.leaveDays,
        reason: request.reason,
        status: request.status,
      };
    }
  }

  return context;
}

function describeTenure(joiningDate, lastWorkingDay) {
  const from = new Date(joiningDate);
  const to = lastWorkingDay ? new Date(lastWorkingDay) : new Date();
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (remaining) parts.push(`${remaining} month${remaining === 1 ? "" : "s"}`);
  return parts.join(" and ") || "less than a month";
}

function formatMoney(amount, organization) {
  const symbol = (organization && organization.currencySymbol) || "";
  return `${symbol}${new Intl.NumberFormat(organization && organization.locale ? organization.locale : "en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amount || 0)}`;
}

// ── Generation ──────────────────────────────────────────────────────────────

/**
 * Render a template to PDF.
 * @returns {Promise<{buffer, fileName, template, documentNumber}>}
 */
async function generate(templateId, params, req) {
  const template = await getTemplate(templateId);
  const context = await buildContext(template, params);

  let documentNumber = null;
  if (template.numbering && template.numbering.enabled) {
    documentNumber = `${template.numbering.prefix}${String(template.numbering.nextNumber).padStart(
      template.numbering.padding || 4,
      "0"
    )}`;
    context.document = { number: documentNumber };
    await DocumentTemplate.updateOne({ _id: template._id }, { $inc: { "numbering.nextNumber": 1 } });
  }

  const logoBuffer = await loadLogo(template);
  const imageBuffers = await loadBlockImages(template);
  const buffer = await renderer.render(template, context, { logoBuffer, imageBuffers });

  const subject = context.employee ? context.employee.employeeCode : "document";
  const fileName = `${template.code.toLowerCase()}-${subject}-${dt.todayString()}.pdf`;

  return { buffer, fileName, template, context, documentNumber };
}

async function loadLogo(template) {
  if (!template.header || !template.header.showLogo) return null;
  try {
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).select("branding").lean(),
      "document.logo"
    );
    const fileId = organization.branding && organization.branding.logoFileId;
    if (!fileId) return null;

    const file = await storage.StoredFile.findById(fileId).lean();
    if (!file) return null;

    const { stream } = await storage.openStream(file);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (err) {
    logger.warn({ err }, "Could not load the logo for a document");
    return null;
  }
}

/** Every image block's file, loaded once per render and keyed by fileId so pdfRenderer can look each one up by block.fileId. */
async function loadBlockImages(template) {
  const fileIds = [...new Set((template.blocks || []).filter((b) => b.type === "image" && b.fileId).map((b) => String(b.fileId)))];
  if (!fileIds.length) return {};

  const buffers = {};
  await Promise.all(
    fileIds.map(async (fileId) => {
      try {
        const file = await storage.StoredFile.findById(fileId).lean();
        if (!file) return;
        const { stream } = await storage.openStream(file);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        buffers[fileId] = Buffer.concat(chunks);
      } catch (err) {
        logger.warn({ err, fileId }, "Could not load a document template image block");
      }
    })
  );
  return buffers;
}

/** Generate and attach the result to the employee's document list. */
async function generateAndStore(templateId, params, req) {
  const { buffer, fileName, template, documentNumber } = await generate(templateId, params, req);

  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "document.store"
  );

  const stored = await storage.save({
    buffer,
    originalName: fileName,
    mimeType: "application/pdf",
    category: "generated-document",
    ownerType: "Employee",
    ownerId: params.employeeId,
    orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
    metadata: { templateCode: template.code, documentNumber },
  });

  const document = await EmployeeDocument.create({
    employeeId: params.employeeId,
    name: template.name,
    category: categoryFor(template.category),
    fileId: stored._id,
    documentNumber: documentNumber || "",
    issuedOn: new Date(),
    status: "verified",
    templateId: template._id,
    generatedAt: new Date(),
    visibleToEmployee: params.visibleToEmployee !== false,
    createdBy: tenant.getUserId(),
  });

  await audit.record(
    {
      action: "document.generated",
      entityType: "EmployeeDocument",
      entityId: document._id,
      entityLabel: `${template.name} — ${params.employeeId}`,
      after: { template: template.code, documentNumber },
      severity: "notice",
    },
    req
  );

  return { document, file: storage.toPublicShape(stored.toObject()) };
}

function categoryFor(templateCategory) {
  const map = {
    offer_letter: "employment",
    appointment_letter: "employment",
    experience_certificate: "certificate",
    relieving_letter: "employment",
    salary_slip: "salary",
    salary_certificate: "salary",
    warning_letter: "employment",
    increment_letter: "salary",
    promotion_letter: "employment",
    confirmation_letter: "employment",
    id_card: "identity",
  };
  return map[templateCategory] || "other";
}

// ── Employee documents ──────────────────────────────────────────────────────

async function listEmployeeDocuments(employeeId, auth, query = {}) {
  await employeeService.assertCanView(auth, employeeId);

  const filter = { employeeId, isLatest: true };
  if (query.category) filter.category = query.category;
  if (query.status) filter.status = query.status;

  // An employee looking at their own record only sees what HR shared.
  const isSelf = auth.employeeId && String(auth.employeeId) === String(employeeId);
  const canManage = (auth.permissions || []).includes("document.view");
  if (isSelf && !canManage) filter.visibleToEmployee = true;

  const documents = await EmployeeDocument.find(filter)
    .populate("fileId")
    .sort({ createdAt: -1 })
    .lean();

  return documents.map((d) => ({
    ...d,
    id: String(d._id),
    file: d.fileId ? storage.toPublicShape(d.fileId) : null,
    isExpired: d.expiresOn ? new Date(d.expiresOn) < new Date() : false,
    daysToExpiry: d.expiresOn
      ? Math.ceil((new Date(d.expiresOn) - Date.now()) / 86400000)
      : null,
  }));
}

async function uploadEmployeeDocument(employeeId, file, data, req) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "document.upload"
  );

  const stored = await storage.save({
    buffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    category: "employee-document",
    ownerType: "Employee",
    ownerId: employeeId,
    orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
  });

  // A replacement supersedes the previous version rather than overwriting it.
  let version = 1;
  let supersedesId = null;
  if (data.supersedesId) {
    const previous = await EmployeeDocument.findById(data.supersedesId);
    if (previous) {
      previous.isLatest = false;
      await previous.save();
      version = previous.version + 1;
      supersedesId = previous._id;
    }
  }

  const document = await EmployeeDocument.create({
    employeeId,
    name: data.name || file.originalname,
    category: data.category || "other",
    fileId: stored._id,
    documentNumber: data.documentNumber || "",
    issuedOn: data.issuedOn || null,
    expiresOn: data.expiresOn || null,
    status: "pending_review",
    visibleToEmployee: data.visibleToEmployee !== false,
    notes: data.notes || "",
    version,
    supersedesId,
    createdBy: tenant.getUserId(),
  });

  await audit.record(
    {
      action: "document.uploaded",
      entityType: "EmployeeDocument",
      entityId: document._id,
      entityLabel: `${employee.employeeCode} — ${document.name}`,
      after: { name: document.name, category: document.category, version },
      severity: "notice",
    },
    req
  );

  return { ...document.toObject(), file: storage.toPublicShape(stored.toObject()) };
}

async function reviewDocument(documentId, { status, rejectionReason }, req) {
  const document = await EmployeeDocument.findById(documentId);
  if (!document) throw AppError.notFound("Document");

  document.status = status;
  document.verifiedBy = tenant.getUserId();
  document.verifiedAt = new Date();
  if (status === "rejected") document.rejectionReason = rejectionReason || "";
  await document.save();

  await audit.record(
    {
      action: `document.${status}`,
      entityType: "EmployeeDocument",
      entityId: document._id,
      entityLabel: document.name,
      after: { status, rejectionReason },
      severity: "notice",
    },
    req
  );

  return document;
}

async function deleteDocument(documentId, req) {
  const document = await EmployeeDocument.findById(documentId);
  if (!document) throw AppError.notFound("Document");

  const file = await storage.StoredFile.findById(document.fileId);
  if (file) await storage.destroy(file, tenant.getUserId()).catch(() => {});

  await document.softDelete(tenant.getUserId());

  await audit.record(
    {
      action: "document.deleted",
      entityType: "EmployeeDocument",
      entityId: document._id,
      entityLabel: document.name,
      severity: "warning",
    },
    req
  );

  return { id: String(document._id), deleted: true };
}

/** Documents expiring soon — drives the reminder job and the HR dashboard. */
async function expiring(withinDays = 30) {
  const cutoff = new Date(Date.now() + withinDays * 86400000);
  return EmployeeDocument.find({
    isLatest: true,
    expiresOn: { $ne: null, $lte: cutoff },
    status: { $ne: "rejected" },
  })
    .populate({ path: "employeeId", select: "employeeCode personal.firstName personal.lastName personal.workEmail userId" })
    .sort({ expiresOn: 1 })
    .limit(500)
    .lean();
}

/**
 * Render a payslip PDF from the organization's payslip template.
 *
 * Looks the template up by code rather than taking an id, because the caller
 * (payroll) has no business knowing which template document an organization
 * happens to have configured — only that it wants "the payslip one".
 *
 * Falls back to seeding the defaults if the organization has none. A tenant
 * that never opened the template designer should still be able to issue a
 * payslip, and failing here would make a working feature depend on an
 * unrelated screen having been visited.
 */
async function generateForPayslip(payslip, req) {
  let template = await DocumentTemplate.findOne({ code: "PAYSLIP", isActive: true }).lean();

  if (!template) {
    await seedDefaultTemplates();
    template = await DocumentTemplate.findOne({ code: "PAYSLIP", isActive: true }).lean();
  }
  if (!template) {
    throw new AppError("DOCUMENT_TEMPLATE_MISSING", {
      message: "No payslip template is configured for your organization.",
      status: 422,
    });
  }

  return generate(String(template._id), {
    employeeId: String(payslip.employeeId),
    payslipId: String(payslip._id ?? payslip.id),
  }, req);
}

module.exports = {
  seedDefaultTemplates,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  buildContext,
  generate,
  generateAndStore,
  generateForPayslip,
  listEmployeeDocuments,
  uploadEmployeeDocument,
  reviewDocument,
  deleteDocument,
  expiring,
  DocumentTemplate,
  EmployeeDocument,
};
