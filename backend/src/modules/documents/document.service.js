"use strict";

const crypto = require("node:crypto");
const { customAlphabet } = require("nanoid");
const {
  DocumentTemplate,
  DocumentTemplateVersion,
  EmployeeDocument,
  CompanyDocument,
  DocumentRequest,
} = require("./document.model");
const renderer = require("./pdfRenderer");
const defaultTemplates = require("./defaultTemplates");
const Employee = require("../employees/employee.model");
const Organization = require("../organizations/organization.model");
const storage = require("../../core/storage/storage.service");
const employeeService = require("../employees/employee.service");
const payrollService = require("../payroll/payroll.service");
const settings = require("../../core/settings/settings.service");
const queue = require("../../core/jobs/queue");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");
const recipients = require("../notifications/recipients");

/**
 * Document generation and employee document storage.
 *
 * Generated documents are stored exactly like uploaded ones — as private
 * files behind the authenticated proxy — so an offer letter is no more
 * reachable by URL guessing than a passport scan.
 */

// Unambiguous alphabet: no 0/O or 1/I, since people read these aloud.
const verificationCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 10);

const SALARY_CATEGORIES = new Set([
  "salary_slip", "salary_certificate", "salary_annexure", "offer_letter", "letter_of_intent",
  "appointment_letter", "increment_letter", "promotion_letter", "appraisal_letter",
  "contract_extension", "full_final_settlement",
]);

// ── Templates ───────────────────────────────────────────────────────────────

async function seedDefaultTemplates() {
  const existing = await DocumentTemplate.find({}).select("code").lean();
  const have = new Set(existing.map((t) => t.code));

  const toCreate = defaultTemplates.TEMPLATES.filter((t) => !have.has(t.code)).map((t) => ({
    ...t,
    organizationId: tenant.requireOrganizationId(),
    isSystem: true,
  }));

  if (toCreate.length) await DocumentTemplate.insertMany(toCreate);
  return { created: toCreate.length, total: defaultTemplates.TEMPLATES.length };
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
    { action: "documenttemplate.created", entityType: "DocumentTemplate", entityId: template._id, entityLabel: template.name, severity: "notice" },
    req
  );
  return template;
}

/**
 * Save an edit, keeping the previous state as a version.
 *
 * A payslip template edited halfway through a month used to be simply gone;
 * now every save leaves the state before it, restorable from the editor.
 */
async function updateTemplate(templateId, data, req, { note = "" } = {}) {
  const template = await DocumentTemplate.findById(templateId);
  if (!template) throw AppError.notFound("Template");

  const before = template.toObject();
  await DocumentTemplateVersion.create({
    templateId: template._id,
    version: before.version || 1,
    snapshot: snapshotOf(before),
    note,
    changedBy: tenant.getUserId(),
  });
  // Keep the last twenty; a template edited three hundred times is noise.
  const surplus = await DocumentTemplateVersion.find({ templateId: template._id }).sort({ version: -1 }).skip(20).select("_id").lean();
  if (surplus.length) await DocumentTemplateVersion.deleteMany({ _id: { $in: surplus.map((v) => v._id) } });

  Object.assign(template, data, { updatedBy: tenant.getUserId(), version: (before.version || 1) + 1 });
  await template.save();

  await audit.record(
    {
      action: "documenttemplate.updated",
      entityType: "DocumentTemplate",
      entityId: template._id,
      entityLabel: template.name,
      before: { name: before.name, blockCount: (before.blocks || []).length, version: before.version },
      after: { name: template.name, blockCount: (template.blocks || []).length, version: template.version },
      skipIfUnchanged: true,
    },
    req
  );
  return template;
}

function snapshotOf(template) {
  const { _id, organizationId, createdAt, updatedAt, createdBy, updatedBy, deletedAt, deletedBy, version, ...rest } = template;
  return rest;
}

async function listVersions(templateId) {
  const rows = await DocumentTemplateVersion.find({ templateId })
    .sort({ version: -1 })
    .populate("changedBy", "firstName lastName")
    .lean();
  return rows.map((v) => ({
    id: String(v._id),
    version: v.version,
    note: v.note,
    blockCount: (v.snapshot.blocks || []).length,
    name: v.snapshot.name,
    changedBy: v.changedBy && v.changedBy.firstName ? [v.changedBy.firstName, v.changedBy.lastName].filter(Boolean).join(" ") : null,
    createdAt: v.createdAt,
  }));
}

async function getVersion(templateId, versionId) {
  const version = await DocumentTemplateVersion.findOne({ _id: versionId, templateId }).lean();
  if (!version) throw AppError.notFound("Template version");
  return { id: String(version._id), version: version.version, snapshot: version.snapshot, createdAt: version.createdAt };
}

async function restoreVersion(templateId, versionId, req) {
  const version = await DocumentTemplateVersion.findOne({ _id: versionId, templateId }).lean();
  if (!version) throw AppError.notFound("Template version");
  const { code, isSystem, ...restorable } = version.snapshot;
  return updateTemplate(templateId, restorable, req, { note: `Restored version ${version.version}` });
}

/** A portable copy: everything except identity and tenancy. */
async function exportTemplate(templateId) {
  const template = await getTemplate(templateId);
  const { _id, organizationId, createdAt, updatedAt, createdBy, updatedBy, deletedAt, deletedBy, isSystem, version, ...rest } = template;
  return {
    format: "chefotech.document-template",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    template: {
      ...rest,
      // Image blocks reference files in this tenant's store; they cannot travel.
      blocks: (rest.blocks || []).map(({ _id: blockId, fileId, ...block }) => ({ ...block, fileId: null })),
    },
  };
}

async function importTemplate(payload, req) {
  if (!payload || payload.format !== "chefotech.document-template" || !payload.template) {
    throw AppError.badRequest("That file is not a Chefotech document template export.");
  }
  const incoming = payload.template;
  const { TemplateSchema } = require("./document.schema");
  const parsed = TemplateSchema.safeParse({ ...incoming, code: String(incoming.code || "IMPORTED").slice(0, 30) });
  if (!parsed.success) {
    throw AppError.validation(parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  }
  let code = parsed.data.code.toUpperCase();
  if (await DocumentTemplate.exists({ code })) code = `${code}_${Date.now().toString(36).toUpperCase()}`.slice(0, 30);
  return createTemplate({ ...parsed.data, code, isSystem: false }, req);
}

async function deleteTemplate(templateId, req) {
  const template = await DocumentTemplate.findById(templateId);
  if (!template) throw AppError.notFound("Template");
  if (template.isSystem) {
    template.isActive = false;
    await template.save();
    return { id: String(template._id), deactivated: true };
  }
  await template.softDelete(tenant.getUserId());
  await audit.record(
    { action: "documenttemplate.deleted", entityType: "DocumentTemplate", entityId: template._id, entityLabel: template.name, severity: "warning" },
    req
  );
  return { id: String(template._id), deleted: true };
}

// ── Context assembly ────────────────────────────────────────────────────────

const DATE_FORMATS = {
  "DD/MM/YYYY": { day: "2-digit", month: "2-digit", year: "numeric" },
  "MM/DD/YYYY": { month: "2-digit", day: "2-digit", year: "numeric" },
  "YYYY-MM-DD": { year: "numeric", month: "2-digit", day: "2-digit" },
  "DD MMM YYYY": { day: "numeric", month: "short", year: "numeric" },
};

function makeDateFormatter(format, locale) {
  return (value) => {
    if (!value) return "";
    const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(value);
    if (format === "YYYY-MM-DD") return s;
    return new Intl.DateTimeFormat(format === "MM/DD/YYYY" ? "en-US" : locale || "en-GB", {
      ...(DATE_FORMATS[format] || DATE_FORMATS["DD MMM YYYY"]),
      timeZone: "UTC",
    }).format(new Date(`${s}T12:00:00Z`));
  };
}

function longDate(value, locale) {
  if (!value) return "";
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(value);
  return new Intl.DateTimeFormat(locale || "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`));
}

function formatMoney(amount, organization) {
  const symbol = (organization && organization.currencySymbol) || "";
  return `${symbol}${new Intl.NumberFormat((organization && organization.locale) || "en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amount || 0)}`;
}

/** 1234567.5 → "Twelve lakh thirty-four thousand five hundred sixty-seven rupees and fifty paise". */
function amountInWords(amount, currency = "INR") {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const below100 = (n) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? `-${ones[n % 10]}` : ""}`);
  const below1000 = (n) => (n >= 100 ? `${ones[Math.floor(n / 100)]} hundred${n % 100 ? ` ${below100(n % 100)}` : ""}` : below100(n));

  const whole = Math.floor(Math.abs(amount || 0));
  const paise = Math.round((Math.abs(amount || 0) - whole) * 100);
  if (whole === 0 && paise === 0) return "Zero";

  const parts = [];
  if (currency === "INR") {
    const crore = Math.floor(whole / 10000000);
    const lakh = Math.floor((whole % 10000000) / 100000);
    const thousand = Math.floor((whole % 100000) / 1000);
    const rest = whole % 1000;
    if (crore) parts.push(`${below1000(crore)} crore`);
    if (lakh) parts.push(`${below1000(lakh)} lakh`);
    if (thousand) parts.push(`${below1000(thousand)} thousand`);
    if (rest) parts.push(below1000(rest));
  } else {
    const billion = Math.floor(whole / 1e9);
    const million = Math.floor((whole % 1e9) / 1e6);
    const thousand = Math.floor((whole % 1e6) / 1000);
    const rest = whole % 1000;
    if (billion) parts.push(`${below1000(billion)} billion`);
    if (million) parts.push(`${below1000(million)} million`);
    if (thousand) parts.push(`${below1000(thousand)} thousand`);
    if (rest) parts.push(below1000(rest));
  }

  const unit = { INR: ["rupees", "paise"], USD: ["dollars", "cents"], EUR: ["euros", "cents"], GBP: ["pounds", "pence"], AED: ["dirhams", "fils"] }[currency] || [currency, "cents"];
  let text = `${parts.join(" ")} ${unit[0]}`;
  if (paise) text += ` and ${below100(paise)} ${unit[1]}`;
  text = text.trim();
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} only`;
}

/**
 * Build the placeholder context a template renders against.
 * This is the contract the template editor's variable list documents.
 */
async function buildContext(template, { employeeId, payslipId, leaveRequestId } = {}) {
  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "document.context"
  );
  const dateFormat = await settings.get("org.date_format").catch(() => "DD MMM YYYY");
  const fmt = makeDateFormatter(dateFormat, organization.locale);
  const today = dt.todayString(organization.timezone);
  const now = dt.nowIn(organization.timezone);
  const fyStart = Number(await settings.get("org.financial_year_start_month").catch(() => 4)) || 4;
  const fy = dt.financialYearOf(today, fyStart);

  const address = organization.address || {};
  const context = {
    __formatDate: fmt,
    company: {
      name: organization.name,
      legalName: organization.legalName || organization.name,
      displayName: organization.displayName || organization.name,
      email: organization.email,
      phone: organization.phone,
      website: organization.website,
      taxId: organization.taxId,
      pan: organization.panNumber,
      pfNumber: organization.pfNumber,
      esiNumber: organization.esiNumber,
      registrationNumber: organization.registrationNumber,
      addressLine: [address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join(", "),
      addressLine1: address.line1,
      addressLine2: address.line2,
      city: address.city,
      state: address.state,
      country: address.country,
      postalCode: address.postalCode,
      currency: organization.currency,
      currencySymbol: organization.currencySymbol,
      primaryColor: organization.branding && organization.branding.primaryColor,
    },
    date: {
      today,
      todayFormatted: longDate(today, organization.locale),
      todayShort: fmt(today),
      year: now.year(),
      month: now.month() + 1,
      monthName: now.format("MMMM"),
      monthYear: now.format("MMMM YYYY"),
      financialYear: typeof fy === "string" ? fy : fy && fy.label ? fy.label : `${now.year()}-${String(now.year() + 1).slice(2)}`,
      plus7: dt.addDays(today, 7),
      plus7Formatted: longDate(dt.addDays(today, 7), organization.locale),
      plus14Formatted: longDate(dt.addDays(today, 14), organization.locale),
      plus30Formatted: longDate(dt.addDays(today, 30), organization.locale),
    },
  };

  if (employeeId) {
    const employee = await Employee.findById(employeeId)
      .populate([
        { path: "employment.departmentId", select: "name code" },
        { path: "employment.designationId", select: "name grade" },
        { path: "employment.locationId", select: "name address" },
        { path: "employment.managerId", select: "employeeCode personal.firstName personal.lastName personal.workEmail" },
        { path: "employment.shiftId", select: "name startTime endTime" },
      ])
      .lean();

    if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

    const personal = employee.personal || {};
    const employment = employee.employment || {};
    const bank = employee.bank || {};
    const statutory = employee.statutory || {};
    const exit = employee.exit || {};
    const current = personal.currentAddress || {};
    const permanent = personal.permanentAddress || {};
    const joining = employment.joiningDate ? dt.toDateString(employment.joiningDate, organization.timezone) : null;
    const lastDay = exit.lastWorkingDay ? dt.toDateString(exit.lastWorkingDay, organization.timezone) : null;
    const probationMonths = employment.probationMonths ?? Number(await settings.get("employee.probation_months").catch(() => 3));
    const probationEnds = joining && probationMonths ? addMonths(joining, probationMonths) : null;
    const emergency = (personal.emergencyContacts || []).find((c) => c.isPrimary) || (personal.emergencyContacts || [])[0];
    const identity = (type) => ((employee.identityDocuments || []).find((d) => String(d.type).toLowerCase() === type) || {}).number || "";
    const aadhaar = identity("aadhaar");

    context.employee = {
      id: String(employee._id),
      employeeId: employee.employeeCode,
      employeeCode: employee.employeeCode,
      name: personal.displayName || [personal.firstName, personal.middleName, personal.lastName].filter(Boolean).join(" "),
      fullName: [personal.firstName, personal.middleName, personal.lastName].filter(Boolean).join(" "),
      firstName: personal.firstName,
      middleName: personal.middleName,
      lastName: personal.lastName,
      salutation: personal.gender === "female" ? "Ms." : personal.gender === "male" ? "Mr." : "",
      gender: humanise(personal.gender),
      dateOfBirth: personal.dateOfBirth,
      dateOfBirthFormatted: personal.dateOfBirth ? longDate(dt.toDateString(personal.dateOfBirth, organization.timezone), organization.locale) : "",
      age: personal.dateOfBirth ? Math.floor(dt.yearsSince(dt.toDateString(personal.dateOfBirth, organization.timezone), today)) : "",
      bloodGroup: personal.bloodGroup,
      maritalStatus: humanise(personal.maritalStatus),
      nationality: personal.nationality,
      fatherName: personal.fatherName,
      motherName: personal.motherName,
      spouseName: personal.spouseName,
      email: personal.workEmail,
      personalEmail: personal.personalEmail,
      phone: personal.phone,
      alternatePhone: personal.alternatePhone,
      address: [current.line1, current.line2, current.city, current.state, current.postalCode].filter(Boolean).join(", "),
      city: current.city,
      state: current.state,
      postalCode: current.postalCode,
      permanentAddress: [permanent.line1, permanent.line2, permanent.city, permanent.state, permanent.postalCode].filter(Boolean).join(", "),
      emergencyContact: emergency ? `${emergency.name}${emergency.relationship ? ` (${emergency.relationship})` : ""} ${emergency.phone || ""}`.trim() : "",
      department: employment.departmentId && employment.departmentId.name,
      departmentCode: employment.departmentId && employment.departmentId.code,
      designation: employment.designationId && employment.designationId.name,
      grade: employment.designationId && employment.designationId.grade,
      location: employment.locationId && employment.locationId.name,
      manager: employment.managerId && employment.managerId.personal ? [employment.managerId.personal.firstName, employment.managerId.personal.lastName].filter(Boolean).join(" ") : "",
      managerCode: employment.managerId && employment.managerId.employeeCode,
      managerEmail: employment.managerId && employment.managerId.personal && employment.managerId.personal.workEmail,
      shift: employment.shiftId ? `${employment.shiftId.name} (${employment.shiftId.startTime}–${employment.shiftId.endTime})` : "",
      joiningDate: employment.joiningDate,
      joiningDateFormatted: joining ? longDate(joining, organization.locale) : "",
      joiningDateShort: joining ? fmt(joining) : "",
      confirmationDate: employment.confirmationDate,
      confirmationDateFormatted: employment.confirmationDate ? longDate(dt.toDateString(employment.confirmationDate, organization.timezone), organization.locale) : "",
      probationMonths: probationMonths || "",
      probationEnds,
      probationEndsFormatted: probationEnds ? longDate(probationEnds, organization.locale) : "",
      noticePeriodDays: employment.noticePeriodDays ?? Number(await settings.get("employee.notice_period_days").catch(() => 30)),
      employmentType: humanise(employment.employmentType),
      workMode: humanise(employment.workMode),
      status: humanise(employee.status),
      biometricId: employee.biometricId || "",
      lastWorkingDay: exit.lastWorkingDay,
      lastWorkingDayFormatted: lastDay ? longDate(lastDay, organization.locale) : "",
      resignationDate: exit.resignationDate,
      resignationDateFormatted: exit.resignationDate ? longDate(dt.toDateString(exit.resignationDate, organization.timezone), organization.locale) : "",
      exitType: humanise(exit.exitType),
      exitReason: exit.reason || "",
      tenure: joining ? describeTenure(joining, lastDay) : "",
      tenureMonths: joining ? Math.floor(dt.monthsSince(joining, lastDay || today)) : "",
      bankName: bank.bankName || "",
      bankBranch: bank.branch || "",
      bankAccountLast4: bank.accountNumber ? String(bank.accountNumber).slice(-4) : "",
      bankAccountNumber: bank.accountNumber || "",
      ifsc: bank.ifscCode || "",
      accountHolder: bank.accountHolderName || "",
      paymentMode: humanise(bank.paymentMode),
      uan: statutory.uan || "",
      pfNumber: statutory.pfNumber || "",
      esiNumber: statutory.esiNumber || "",
      pan: statutory.taxId || identity("pan"),
      aadhaar: aadhaar,
      aadhaarMasked: aadhaar ? `XXXX XXXX ${String(aadhaar).replace(/\s/g, "").slice(-4)}` : "",
      passport: identity("passport"),
      skills: (employee.skills || []).join(", "),
      tags: (employee.tags || []).join(", "),
    };

    const custom = employee.customFields instanceof Map ? Object.fromEntries(employee.customFields) : employee.customFields || {};
    context.custom = Object.fromEntries(
      Object.entries(custom).map(([k, v]) => [k, v instanceof Date ? fmt(dt.toDateString(v, organization.timezone)) : v])
    );

    // Salary is only added when the template asks for it, so an offer letter
    // template cannot accidentally leak CTC into an address-proof letter.
    if (SALARY_CATEGORIES.has(template.category) || ["payslip", "exit"].includes(template.contextType)) {
      const salary = await payrollService.salaryFor(employeeId, today);
      if (salary) {
        const effective = salary.effectiveFrom;
        const { lines, structureName } = await salaryLines(salary, organization);
        context.salary = {
          ctcAnnual: salary.ctcAnnual,
          ctcMonthly: salary.ctcMonthly,
          ctcAnnualFormatted: formatMoney(salary.ctcAnnual, organization),
          ctcMonthlyFormatted: formatMoney(salary.ctcMonthly, organization),
          ctcAnnualInWords: amountInWords(salary.ctcAnnual, organization.currency),
          effectiveFrom: effective,
          effectiveFromFormatted: effective ? longDate(effective, organization.locale) : "",
          structure: structureName,
          revisionType: humanise(salary.revisionType),
          components: Object.fromEntries(lines.map((l) => [l.code, l.monthly])),
          componentsFormatted: Object.fromEntries(lines.map((l) => [l.code, l.monthlyFormatted])),
          lines,
        };
      } else {
        // No salary on file yet: every key still exists, blank, so a letter
        // renders with gaps a reviewer can see rather than failing outright.
        context.salary = {
          ctcAnnual: 0,
          ctcMonthly: 0,
          ctcAnnualFormatted: "",
          ctcMonthlyFormatted: "",
          ctcAnnualInWords: "",
          effectiveFrom: null,
          effectiveFromFormatted: "",
          structure: "",
          revisionType: "",
          components: {},
          componentsFormatted: {},
          lines: [],
        };
      }
    }

    if (template.contextType === "exit") {
      context.settlement = await settlementFor(employee, context.salary, organization, today);
    }
  }

  if (payslipId) {
    const payslip = await payrollService.Payslip.findById(payslipId).populate("periodId").lean();
    if (payslip) {
      const snapshot = payslip.snapshot || {};
      const period = payslip.periodId || {};
      context.payslip = {
        number: payslip.payslipNumber,
        period: payslip.periodLabel,
        month: period.month,
        year: period.year,
        payDate: period.payDate,
        payDateFormatted: period.payDate ? longDate(period.payDate, organization.locale) : "",
        gross: payslip.gross,
        grossFormatted: formatMoney(payslip.gross, organization),
        deductions: payslip.totalDeductions,
        deductionsFormatted: formatMoney(payslip.totalDeductions, organization),
        net: payslip.net,
        netFormatted: formatMoney(payslip.net, organization),
        netInWords: amountInWords(payslip.net, organization.currency),
        employerContributions: snapshot.employerContributions || 0,
        employerContributionsFormatted: formatMoney(snapshot.employerContributions || 0, organization),
        attendance: snapshot.attendance || {},
        earnings: (snapshot.lines || [])
          .filter((l) => l.type === "earning" && l.showOnPayslip)
          .map((l) => ({ code: l.code, name: l.name, amount: formatMoney(l.amount, organization), amountRaw: l.amount })),
        deductionLines: (snapshot.lines || [])
          .filter((l) => l.type === "deduction" && l.showOnPayslip)
          .map((l) => ({ code: l.code, name: l.name, amount: formatMoney(l.amount, organization), amountRaw: l.amount })),
        contributions: (snapshot.lines || [])
          .filter((l) => l.type === "employer_contribution")
          .map((l) => ({ code: l.code, name: l.name, amount: formatMoney(l.amount, organization), amountRaw: l.amount })),
        adjustments: (snapshot.adjustments || []).map((a) => ({ name: a.label, type: a.type, amount: formatMoney(a.amount, organization), amountRaw: a.amount })),
        components: Object.fromEntries((snapshot.lines || []).map((l) => [l.code, l.amount])),
      };
    }
  }

  if (leaveRequestId) {
    const { LeaveRequest } = require("../leave/leave.model");
    const request = await LeaveRequest.findById(leaveRequestId).populate("leaveTypeId", "name").lean();
    if (request) {
      const decided = (request.approvals || []).find((a) => a.decision !== "pending");
      context.leave = {
        type: request.leaveTypeId && request.leaveTypeId.name,
        from: request.fromDate,
        to: request.toDate,
        fromFormatted: longDate(request.fromDate, organization.locale),
        toFormatted: longDate(request.toDate, organization.locale),
        days: request.leaveDays,
        calendarDays: request.calendarDays,
        reason: request.reason,
        status: humanise(request.status),
        approver: decided ? decided.approverName : "",
      };
    }
  }

  return context;
}

/**
 * Monthly and annual amounts per component, for annexures and offers.
 *
 * Runs the real payroll engine over an idealised full month (no absence,
 * no proration) so a formula-driven component — Basic as 40% of CTC, HRA
 * as half of Basic — shows the same figure the first payslip will.
 */
async function salaryLines(salary, organization) {
  const { SalaryComponent, SalaryStructure } = require("../payroll/payroll.model");
  const engine = require("../payroll/payrollEngine");

  const [structure, all] = await Promise.all([
    salary.structureId ? SalaryStructure.findById(salary.structureId).lean() : null,
    SalaryComponent.find({ isActive: true }).lean(),
  ]);
  const byId = Object.fromEntries(all.map((c) => [String(c._id), c]));
  const components = structure
    ? (structure.components || [])
        .map((entry) => {
          const component = byId[String(entry.componentId)];
          return component ? engine.resolveComponent(component, entry) : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
    : all.sort((a, b) => a.order - b.order);

  let lines = [];
  try {
    const result = engine.calculate({
      employee: {},
      salary,
      components,
      attendance: { totalDays: 30, workingDays: 30, payableDays: 30, presentDays: 30, paidLeaveDays: 0, absentDays: 0, unpaidLeaveDays: 0, overtimeHours: 0 },
      settings: { "payroll.working_days_basis": "fixed_days", "payroll.fixed_days_in_month": 30, "payroll.rounding": "none" },
      adjustments: [],
    });
    lines = result.lines || [];
  } catch (err) {
    logger.warn({ err, salaryId: String(salary._id) }, "Could not compute salary lines for a document; using stored amounts");
    const amounts = salary.componentAmounts instanceof Map ? Object.fromEntries(salary.componentAmounts) : salary.componentAmounts || {};
    lines = components.map((c) => ({ code: c.code, name: c.name, type: c.type, fullAmount: amounts[c.code] || 0, order: c.order }));
  }

  return {
    structureName: structure ? structure.name : "",
    lines: lines
      .filter((l) => l.type !== "deduction" && l.type !== "informational")
      .map((l) => {
        const monthly = l.fullAmount ?? l.amount ?? 0;
        return {
          code: l.code,
          name: l.name,
          type: humanise(l.type),
          monthly,
          annual: monthly * 12,
          monthlyFormatted: formatMoney(monthly, organization),
          annualFormatted: formatMoney(monthly * 12, organization),
        };
      }),
  };
}

/**
 * A full-and-final estimate from what the record holds. Labelled as an
 * estimate on the template: it is the starting point for payroll, not the
 * final word, because loans and pending claims live in their own modules.
 */
async function settlementFor(employee, salary, organization, today) {
  const dues = [];
  const recoveries = [];
  const monthly = salary ? salary.ctcMonthly : 0;
  const perDay = monthly / 30;
  const exit = employee.exit || {};
  const lastDay = exit.lastWorkingDay ? dt.toDateString(exit.lastWorkingDay, organization.timezone) : null;

  if (monthly && lastDay) {
    const monthStart = `${lastDay.slice(0, 7)}-01`;
    const worked = dt.daysBetween(monthStart, lastDay);
    const inMonth = dt.monthBounds(Number(lastDay.slice(0, 4)), Number(lastDay.slice(5, 7))).days;
    dues.push({ label: "Salary for final month", detail: `${worked} of ${inMonth} days`, amount: Math.round(perDay * worked) });
  }

  try {
    const leaveService = require("../leave/leave.service");
    const balances = await leaveService.balancesFor(employee._id, today);
    for (const b of balances) {
      const encash = b.rule && b.rule.encashment;
      if (!b.hasBalance || !encash || !encash.enabled) continue;
      const days = Math.max(0, Math.min(b.available || 0, encash.maximumDays || b.available || 0));
      if (days > 0 && monthly) dues.push({ label: `${b.leaveType.name} encashment`, detail: `${days} day(s)`, amount: Math.round(perDay * days) });
    }
  } catch {
    /* no leave configured */
  }

  const noticeDays = employee.employment && employee.employment.noticePeriodDays;
  if (noticeDays && exit.resignationDate && lastDay && monthly) {
    const served = dt.daysBetween(dt.toDateString(exit.resignationDate, organization.timezone), lastDay);
    const shortfall = noticeDays - served;
    if (shortfall > 0) recoveries.push({ label: "Notice period shortfall", detail: `${shortfall} of ${noticeDays} days`, amount: Math.round(perDay * shortfall) });
  }

  try {
    const loans = require("../loans/loan.service");
    const outstanding = await loans.outstandingFor(employee._id);
    if (outstanding > 0) recoveries.push({ label: "Outstanding loan / advance", detail: "balance", amount: Math.round(outstanding) });
  } catch {
    /* loans module absent */
  }

  const totalDues = dues.reduce((s, d) => s + d.amount, 0);
  const totalRecoveries = recoveries.reduce((s, d) => s + d.amount, 0);
  return {
    dues: dues.map((d) => ({ ...d, amount: d.amount })),
    recoveries: recoveries.map((d) => ({ ...d, amount: d.amount })),
    totalDues,
    totalRecoveries,
    net: totalDues - totalRecoveries,
    totalDuesFormatted: formatMoney(totalDues, organization),
    totalRecoveriesFormatted: formatMoney(totalRecoveries, organization),
    netFormatted: formatMoney(totalDues - totalRecoveries, organization),
    netInWords: amountInWords(totalDues - totalRecoveries, organization.currency),
  };
}

function humanise(value) {
  if (!value) return "";
  return String(value).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function addMonths(dateString, months) {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function describeTenure(joiningDate, lastWorkingDay) {
  const from = new Date(`${joiningDate}T00:00:00Z`);
  const to = lastWorkingDay ? new Date(`${lastWorkingDay}T00:00:00Z`) : new Date();
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (remaining) parts.push(`${remaining} month${remaining === 1 ? "" : "s"}`);
  return parts.join(" and ") || "less than a month";
}

// ── Generation ──────────────────────────────────────────────────────────────

async function loadAssets(template) {
  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).select("branding").lean(),
    "document.assets"
  );
  const branding = (organization && organization.branding) || {};

  const read = async (fileId) => {
    if (!fileId) return null;
    try {
      const file = await storage.StoredFile.findById(fileId).lean();
      if (!file) return null;
      const { stream } = await storage.openStream(file);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch (err) {
      logger.warn({ err, fileId: String(fileId) }, "Could not load a document asset");
      return null;
    }
  };

  const wantsLogo = template.header && template.header.enabled && template.header.showLogo && !template.header.useLetterhead;
  const wantsLetterhead = template.header && template.header.enabled && template.header.useLetterhead;

  const fileIds = [...new Set((template.blocks || []).filter((b) => ["image", "signature"].includes(b.type) && b.fileId).map((b) => String(b.fileId)))];
  const imageBuffers = {};
  await Promise.all(fileIds.map(async (id) => { const buffer = await read(id); if (buffer) imageBuffers[id] = buffer; }));

  return {
    logoBuffer: wantsLogo ? await read(branding.logoFileId) : null,
    letterheadBuffer: wantsLetterhead ? await read(branding.letterheadFileId) : null,
    imageBuffers,
  };
}

async function qrFor(code) {
  if (!code) return null;
  try {
    const QRCode = require("qrcode");
    const url = `${env.app.publicUrl}/verify/${code}`;
    return await QRCode.toBuffer(url, { type: "png", margin: 0, width: 240, errorCorrectionLevel: "M" });
  } catch (err) {
    logger.warn({ err }, "Could not build the verification QR");
    return null;
  }
}

/**
 * Render a template to PDF.
 *
 * `dryRun` is the preview: nothing is numbered, nothing is stored, and the
 * document number prints as a placeholder. Preview used to consume a real
 * number every time someone looked, so the offer letters a customer sent had
 * gaps in their references.
 *
 * @returns {Promise<{buffer, fileName, template, context, documentNumber}>}
 */
async function generate(templateId, params, req, { dryRun = false, verificationCode: code = null } = {}) {
  const template = await getTemplate(templateId);
  if (template.isActive === false && !dryRun) {
    throw AppError.badRequest("This template is inactive. Activate it to generate documents from it.");
  }
  const context = await buildContext(template, params);

  let documentNumber = null;
  if (template.numbering && template.numbering.enabled) {
    const next = String(template.numbering.nextNumber).padStart(template.numbering.padding || 4, "0");
    documentNumber = dryRun ? `${template.numbering.prefix}${next} (preview)` : `${template.numbering.prefix}${next}`;
    if (!dryRun) {
      await DocumentTemplate.updateOne({ _id: template._id }, { $inc: { "numbering.nextNumber": 1 } });
    }
  }
  context.document = {
    number: documentNumber || "",
    verificationCode: code || (dryRun ? "PREVIEW" : ""),
    templateName: template.name,
  };

  const wantsQr = (template.footer && template.footer.showVerificationQr) || (template.blocks || []).some((b) => b.type === "qr");
  const assets = await loadAssets(template);
  const qrBuffer = wantsQr ? await qrFor(code || (dryRun ? "PREVIEW" : null)) : null;

  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).select("locale currencySymbol").lean(),
    "document.format"
  );

  const buffer = await renderer.render(template, context, {
    ...assets,
    qrBuffer,
    format: { locale: organization.locale, currencySymbol: organization.currencySymbol, formatDate: context.__formatDate },
  });

  const subject = context.employee ? context.employee.employeeCode : "document";
  const fileName = `${template.code.toLowerCase()}-${subject}-${dt.todayString()}.pdf`;

  return { buffer, fileName, template, context, documentNumber };
}

/** Generate and attach the result to the employee's document list. */
async function generateAndStore(templateId, params, req, { notify = true } = {}) {
  const code = verificationCode();
  const { buffer, fileName, template, documentNumber } = await generate(templateId, params, req, { verificationCode: code });

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
    metadata: { templateCode: template.code, documentNumber, verificationCode: code },
  });

  const storeAs = template.storeAs || {};
  const requireAck = params.requireAcknowledgement !== undefined ? params.requireAcknowledgement : Boolean(storeAs.requireAcknowledgement);
  const visible = params.visibleToEmployee !== undefined ? params.visibleToEmployee !== false : storeAs.visibleToEmployee !== false;

  const document = await EmployeeDocument.create({
    employeeId: params.employeeId,
    name: documentNumber ? `${template.name} ${documentNumber}` : template.name,
    category: storeAs.category || categoryFor(template.category),
    fileId: stored._id,
    documentNumber: documentNumber || "",
    issuedOn: new Date(),
    status: "verified",
    source: "generated",
    templateId: template._id,
    generatedAt: new Date(),
    visibleToEmployee: visible,
    acknowledgement: requireAck
      ? { required: true, requestedAt: new Date(), requestedBy: tenant.getUserId(), dueOn: params.acknowledgementDueOn ? new Date(params.acknowledgementDueOn) : null }
      : { required: false },
    verification: { code, sha256: crypto.createHash("sha256").update(buffer).digest("hex") },
    createdBy: tenant.getUserId(),
  });

  await audit.record(
    {
      action: "document.generated",
      entityType: "EmployeeDocument",
      entityId: document._id,
      entityLabel: `${template.name} — ${params.employeeId}`,
      after: { template: template.code, documentNumber, verificationCode: code, requireAcknowledgement: requireAck },
      severity: "notice",
    },
    req
  );

  if (notify && visible) {
    const owner = await Employee.findById(params.employeeId).select("userId personal.firstName personal.lastName personal.workEmail").lean();
    if (owner && owner.userId) {
      notifyDocumentEvent(
        requireAck ? "document_acknowledgement_requested" : "document_generated",
        [recipients.employeeToRecipient(owner)],
        {
          employee: { firstName: owner.personal.firstName },
          document: { name: document.name, dueNote: params.acknowledgementDueOn ? ` Please do so by ${params.acknowledgementDueOn}.` : "" },
        },
        document
      ).catch(() => {});
    }
  }

  return { document, file: storage.toPublicShape(stored.toObject()) };
}

/**
 * Many documents at once — increment letters for a department, payslip
 * letters for everyone. Runs on the queue and delivers a zip.
 */
async function requestBulkGenerate({ templateId, employeeIds, visibleToEmployee, requireAcknowledgement }, req) {
  const template = await getTemplate(templateId);
  if (!employeeIds || !employeeIds.length) throw AppError.badRequest("Choose at least one employee.");
  const count = await Employee.countDocuments({ _id: { $in: employeeIds } });
  if (count !== employeeIds.length) throw AppError.badRequest("One or more of the selected employees do not exist.");

  const job = await queue.enqueue(
    "documents.bulk-generate",
    { templateId: String(templateId), employeeIds: employeeIds.map(String), visibleToEmployee, requireAcknowledgement, requestedBy: String(tenant.getUserId()), requestedByName: req && req.auth && req.auth.name },
    { priority: 2 }
  );

  await audit.record(
    { action: "document.bulk_requested", entityType: "DocumentTemplate", entityId: template._id, entityLabel: template.name, after: { employees: employeeIds.length, jobId: String(job._id) }, severity: "notice" },
    req
  );

  // In tests and single-process dev runs the worker may be off; the caller
  // can still poll the job and, with jobs disabled, it is run inline.
  if (!env.jobs.enabled) {
    await queue.drainOnce();
  }
  return { jobId: String(job._id), employees: employeeIds.length, template: template.name };
}

/** The job handler: generate each, zip, store, notify. */
async function runBulkGenerate(payload) {
  const archiver = require("archiver");
  const { templateId, employeeIds, visibleToEmployee, requireAcknowledgement, requestedBy } = payload;
  const template = await getTemplate(templateId);
  const organization = await tenant.runAsSystem(() => Organization.findById(tenant.requireOrganizationId()).lean(), "document.bulk");

  const results = [];
  const failures = [];
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks = [];
  archive.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });

  for (const employeeId of employeeIds) {
    try {
      const code = verificationCode();
      const { buffer, fileName, documentNumber } = await generate(templateId, { employeeId }, null, { verificationCode: code });
      const stored = await storage.save({
        buffer,
        originalName: fileName,
        mimeType: "application/pdf",
        category: "generated-document",
        ownerType: "Employee",
        ownerId: employeeId,
        orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
        metadata: { templateCode: template.code, documentNumber, verificationCode: code, bulk: true },
        uploadedBy: requestedBy,
      });
      const storeAs = template.storeAs || {};
      const document = await EmployeeDocument.create({
        employeeId,
        name: documentNumber ? `${template.name} ${documentNumber}` : template.name,
        category: storeAs.category || categoryFor(template.category),
        fileId: stored._id,
        documentNumber: documentNumber || "",
        issuedOn: new Date(),
        status: "verified",
        source: "generated",
        templateId: template._id,
        generatedAt: new Date(),
        visibleToEmployee: visibleToEmployee !== undefined ? visibleToEmployee !== false : storeAs.visibleToEmployee !== false,
        acknowledgement: (requireAcknowledgement !== undefined ? requireAcknowledgement : storeAs.requireAcknowledgement)
          ? { required: true, requestedAt: new Date(), requestedBy }
          : { required: false },
        verification: { code, sha256: crypto.createHash("sha256").update(buffer).digest("hex") },
        createdBy: requestedBy,
      });
      archive.append(buffer, { name: fileName });
      results.push({ employeeId, documentId: String(document._id), fileName });
    } catch (err) {
      logger.warn({ err, employeeId }, "Bulk document generation failed for an employee");
      failures.push({ employeeId, error: err.message });
    }
  }

  archive.finalize();
  await done;
  const zip = Buffer.concat(chunks);

  const stored = await storage.save({
    buffer: zip,
    originalName: `${template.code.toLowerCase()}-bulk-${dt.todayString(organization.timezone)}.zip`,
    mimeType: "application/zip",
    category: "export",
    ownerType: "User",
    ownerId: requestedBy,
    orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
    metadata: { templateCode: template.code, count: results.length, failures: failures.length },
    uploadedBy: requestedBy,
  });

  // Tell whoever asked. The link goes through the file proxy, so only they
  // (and anyone with document.view) can fetch it.
  try {
    const User = require("../users/user.model");
    const user = await User.findById(requestedBy).select("email firstName lastName").lean();
    if (user) {
      const notifications = require("../notifications/notification.service");
      await notifications.notify({
        template: "announcement",
        recipients: [recipients.userToRecipient(user)],
        organization,
        data: {
          title: `${results.length} ${template.name} document(s) ready`,
          message: `${results.length} generated${failures.length ? `, ${failures.length} failed` : ""}. Download the bundle from Documents → Bulk downloads.`,
        },
        channels: ["in_app", "push"],
        entity: { type: "StoredFile", id: stored._id },
      });
    }
  } catch (err) {
    logger.warn({ err }, "Bulk generation notification failed");
  }

  return { generated: results.length, failed: failures.length, failures, fileId: String(stored._id), file: storage.toPublicShape(stored.toObject()) };
}

async function bulkStatus(jobId) {
  const job = await queue.Job.findById(jobId).lean();
  if (!job || job.name !== "documents.bulk-generate" || String(job.organizationId) !== String(tenant.requireOrganizationId())) {
    throw AppError.notFound("Bulk generation job");
  }
  return { id: String(job._id), status: job.status, attempts: job.attempts, result: job.result, error: job.lastError, createdAt: job.createdAt, finishedAt: job.finishedAt };
}

async function listBulkDownloads(auth) {
  const files = await storage.StoredFile.find({ category: "export", ownerType: "User", ownerId: auth.userId, mimeType: "application/zip" })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
  return files.map((f) => ({ ...storage.toPublicShape(f), metadata: f.metadata }));
}

/**
 * Every generated document's file must open only for people allowed to see
 * that employee — the same rule as an uploaded one.
 */
function categoryFor(templateCategory) {
  const map = {
    offer_letter: "employment", letter_of_intent: "employment", appointment_letter: "employment",
    confirmation_letter: "employment", probation_extension: "employment", promotion_letter: "employment",
    transfer_letter: "employment", appraisal_letter: "employment", contract_extension: "employment",
    warning_letter: "employment", show_cause_notice: "employment", termination_letter: "employment",
    resignation_acceptance: "employment", relieving_letter: "employment",
    experience_certificate: "certificate", bonafide_certificate: "certificate", address_proof: "certificate",
    no_objection_certificate: "certificate", internship_certificate: "certificate", training_certificate: "certificate",
    salary_slip: "salary", salary_certificate: "salary", salary_annexure: "salary", increment_letter: "salary",
    full_final_settlement: "salary", id_card: "identity", leave_approval: "employment",
    joining_checklist: "employment", exit_checklist: "employment",
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
    .populate("acknowledgement.requestedBy", "firstName lastName")
    .sort({ createdAt: -1 })
    .lean();

  return documents.map(shapeDocument);
}

function shapeDocument(d) {
  const ack = d.acknowledgement || {};
  return {
    ...d,
    id: String(d._id),
    file: d.fileId ? storage.toPublicShape(d.fileId) : null,
    fileId: d.fileId ? String(d.fileId._id || d.fileId) : null,
    isExpired: d.expiresOn ? new Date(d.expiresOn) < new Date() : false,
    daysToExpiry: d.expiresOn ? Math.ceil((new Date(d.expiresOn) - Date.now()) / 86400000) : null,
    acknowledgement: {
      required: Boolean(ack.required),
      requestedAt: ack.requestedAt || null,
      requestedBy: ack.requestedBy && ack.requestedBy.firstName ? [ack.requestedBy.firstName, ack.requestedBy.lastName].filter(Boolean).join(" ") : null,
      dueOn: ack.dueOn || null,
      acknowledgedAt: ack.acknowledgedAt || null,
      acknowledgedName: ack.acknowledgedName || "",
      isOverdue: Boolean(ack.required && !ack.acknowledgedAt && ack.dueOn && new Date(ack.dueOn) < new Date()),
    },
    verificationCode: d.verification && d.verification.code ? d.verification.code : null,
  };
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

  // Fulfilling a request: the request names the category and the document.
  let request = null;
  if (data.requestId) {
    request = await DocumentRequest.findOne({ _id: data.requestId, employeeId, status: "pending" });
  }

  const document = await EmployeeDocument.create({
    employeeId,
    name: data.name || (request ? request.name : file.originalname),
    category: data.category || (request ? request.category : "other"),
    fileId: stored._id,
    documentNumber: data.documentNumber || "",
    issuedOn: data.issuedOn || null,
    expiresOn: data.expiresOn || null,
    status: "pending_review",
    source: request ? "requested" : "uploaded",
    requestId: request ? request._id : null,
    visibleToEmployee: data.visibleToEmployee !== false,
    notes: data.notes || "",
    version,
    supersedesId,
    createdBy: tenant.getUserId(),
  });

  if (request) {
    request.status = "fulfilled";
    request.fulfilledDocumentId = document._id;
    request.fulfilledAt = new Date();
    await request.save();
  }

  await audit.record(
    {
      action: "document.uploaded",
      entityType: "EmployeeDocument",
      entityId: document._id,
      entityLabel: `${employee.employeeCode} — ${document.name}`,
      after: { name: document.name, category: document.category, version, fulfilledRequest: request ? String(request._id) : null },
      severity: "notice",
    },
    req
  );

  // An employee uploading their own document is asking HR to look at it.
  const uploadedBySelf = employee.userId && String(employee.userId) === String(tenant.getUserId());
  if (uploadedBySelf) {
    notifyDocumentEvent("document_uploaded", await recipients.usersWithPermission("document.view"), {
      employee: { id: String(employee._id), name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" ") },
      document: { name: document.name, category: document.category },
    }, document).catch(() => {});
  }

  return { ...shapeDocument({ ...document.toObject(), fileId: stored.toObject() }) };
}

async function notifyDocumentEvent(template, audience, data, document, severity = "info") {
  if (!audience || !audience.length) return;
  const notifications = require("../notifications/notification.service");
  await notifications.notify({
    template,
    recipients: audience,
    organization: await recipients.organization(),
    data,
    severity,
    entity: { type: "EmployeeDocument", id: document._id },
  });
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
    { action: `document.${status}`, entityType: "EmployeeDocument", entityId: document._id, entityLabel: document.name, after: { status, rejectionReason }, severity: "notice" },
    req
  );

  const owner = await Employee.findById(document.employeeId).select("userId personal.firstName personal.lastName personal.workEmail").lean();
  if (owner && owner.userId) {
    notifyDocumentEvent(
      "document_reviewed",
      [recipients.employeeToRecipient(owner)],
      { employee: { firstName: owner.personal.firstName }, document: { name: document.name, status, note: status === "rejected" && rejectionReason ? ` Reason: ${rejectionReason}` : "" } },
      document,
      status === "rejected" ? "warning" : "success"
    ).catch(() => {});
  }

  return document;
}

async function updateDocument(documentId, data, req) {
  const document = await EmployeeDocument.findById(documentId);
  if (!document) throw AppError.notFound("Document");
  const before = { name: document.name, category: document.category, expiresOn: document.expiresOn, visibleToEmployee: document.visibleToEmployee };
  for (const key of ["name", "category", "documentNumber", "issuedOn", "expiresOn", "visibleToEmployee", "notes"]) {
    if (data[key] !== undefined) document[key] = data[key];
  }
  document.updatedBy = tenant.getUserId();
  await document.save();
  await audit.record(
    { action: "document.updated", entityType: "EmployeeDocument", entityId: document._id, entityLabel: document.name, before, after: { name: document.name, category: document.category, expiresOn: document.expiresOn, visibleToEmployee: document.visibleToEmployee }, skipIfUnchanged: true },
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
    { action: "document.deleted", entityType: "EmployeeDocument", entityId: document._id, entityLabel: document.name, severity: "warning" },
    req
  );

  return { id: String(document._id), deleted: true };
}

/** Documents expiring soon — drives the reminder job and the HR dashboard. */
async function expiring(withinDays = 30) {
  const cutoff = new Date(Date.now() + withinDays * 86400000);
  return EmployeeDocument.find({ isLatest: true, expiresOn: { $ne: null, $lte: cutoff }, status: { $ne: "rejected" } })
    .populate({ path: "employeeId", select: "employeeCode personal.firstName personal.lastName personal.workEmail userId" })
    .sort({ expiresOn: 1 })
    .limit(500)
    .lean();
}

// ── Acknowledgements ────────────────────────────────────────────────────────

async function requestAcknowledgement(documentId, { dueOn } = {}, req) {
  const document = await EmployeeDocument.findById(documentId);
  if (!document) throw AppError.notFound("Document");
  if (!document.visibleToEmployee) throw AppError.badRequest("Share the document with the employee first — they cannot acknowledge what they cannot see.");

  document.acknowledgement = {
    ...(document.acknowledgement || {}),
    required: true,
    requestedAt: new Date(),
    requestedBy: tenant.getUserId(),
    dueOn: dueOn ? new Date(dueOn) : null,
    acknowledgedAt: null,
    acknowledgedName: "",
  };
  await document.save();

  await audit.record(
    { action: "document.acknowledgement_requested", entityType: "EmployeeDocument", entityId: document._id, entityLabel: document.name, after: { dueOn }, severity: "notice" },
    req
  );

  const owner = await Employee.findById(document.employeeId).select("userId personal.firstName personal.lastName personal.workEmail").lean();
  if (owner && owner.userId) {
    notifyDocumentEvent(
      "document_acknowledgement_requested",
      [recipients.employeeToRecipient(owner)],
      { employee: { firstName: owner.personal.firstName }, document: { name: document.name, dueNote: dueOn ? ` Please do so by ${dueOn}.` : "" } },
      document
    ).catch(() => {});
  }
  return shapeDocument(document.toObject());
}

async function acknowledge(documentId, auth, { name } = {}, req) {
  const document = await EmployeeDocument.findById(documentId);
  if (!document) throw AppError.notFound("Document");
  if (!auth.employeeId || String(document.employeeId) !== String(auth.employeeId)) {
    throw AppError.forbidden("You can only acknowledge your own documents.");
  }
  if (!document.visibleToEmployee) throw AppError.forbidden("This document is not shared with you.");
  if (document.acknowledgement && document.acknowledgement.acknowledgedAt) {
    return { acknowledged: true, at: document.acknowledgement.acknowledgedAt, already: true };
  }

  document.acknowledgement = {
    ...(document.acknowledgement || {}),
    required: true,
    acknowledgedAt: new Date(),
    acknowledgedBy: auth.userId,
    acknowledgedName: (name || auth.name || "").slice(0, 120),
    ip: (req && req.ip) || null,
    userAgent: (req && req.headers && String(req.headers["user-agent"]).slice(0, 300)) || null,
  };
  await document.save();

  await audit.record(
    { action: "document.acknowledged", entityType: "EmployeeDocument", entityId: document._id, entityLabel: document.name, after: { name: document.acknowledgement.acknowledgedName }, severity: "notice" },
    req
  );

  return { acknowledged: true, at: document.acknowledgement.acknowledgedAt };
}

/** Everything still waiting to be acknowledged, for HR. */
async function pendingAcknowledgements(query = {}) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt"], maxLimit: 200 });
  const filter = { "acknowledgement.required": true, "acknowledgement.acknowledgedAt": null, isLatest: true };
  if (query.overdue === "true") filter["acknowledgement.dueOn"] = { $ne: null, $lt: new Date() };
  const [items, total] = await Promise.all([
    EmployeeDocument.find(filter)
      .populate({ path: "employeeId", select: "employeeCode personal.firstName personal.lastName userId" })
      .sort({ "acknowledgement.dueOn": 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EmployeeDocument.countDocuments(filter),
  ]);
  return { items: items.map((d) => ({ ...shapeDocument(d), employee: d.employeeId })), page, limit, total };
}

/** Nudge everyone whose acknowledgement is due or overdue. Once every 3 days. */
async function sendAcknowledgementReminders() {
  const soon = new Date(Date.now() + 3 * 86400000);
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
  const documents = await EmployeeDocument.find({
    "acknowledgement.required": true,
    "acknowledgement.acknowledgedAt": null,
    isLatest: true,
    visibleToEmployee: true,
    $or: [{ "acknowledgement.dueOn": { $ne: null, $lte: soon } }, { "acknowledgement.requestedAt": { $lte: threeDaysAgo } }],
  })
    .populate({ path: "employeeId", select: "userId personal.firstName personal.lastName personal.workEmail" })
    .limit(500)
    .lean();

  let sent = 0;
  for (const document of documents) {
    const last = (document.acknowledgement.remindersSent || []).slice(-1)[0];
    if (last && new Date(last) > threeDaysAgo) continue;
    const owner = document.employeeId;
    if (!owner || !owner.userId) continue;
    await notifyDocumentEvent(
      "document_acknowledgement_requested",
      [recipients.employeeToRecipient(owner)],
      { employee: { firstName: owner.personal.firstName }, document: { name: document.name, dueNote: document.acknowledgement.dueOn ? ` It was due by ${dt.toDateString(document.acknowledgement.dueOn)}.` : "" } },
      document,
      "warning"
    ).catch(() => {});
    await EmployeeDocument.updateOne({ _id: document._id }, { $push: { "acknowledgement.remindersSent": new Date() } });
    sent += 1;
  }
  return { checked: documents.length, sent };
}

// ── Document requests ───────────────────────────────────────────────────────

async function createRequests({ employeeIds, name, category, note, dueOn }, req) {
  const employees = await Employee.find({ _id: { $in: employeeIds } })
    .select("userId personal.firstName personal.lastName personal.workEmail")
    .lean();
  if (!employees.length) throw AppError.badRequest("Choose at least one employee.");

  const created = await DocumentRequest.insertMany(
    employees.map((e) => ({
      organizationId: tenant.requireOrganizationId(),
      employeeId: e._id,
      name,
      category: category || "other",
      note: note || "",
      dueOn: dueOn ? new Date(dueOn) : null,
      requestedBy: tenant.getUserId(),
      createdBy: tenant.getUserId(),
    }))
  );

  await audit.record(
    { action: "document.requested", entityType: "DocumentRequest", entityLabel: name, after: { employees: employees.length, dueOn }, severity: "notice" },
    req
  );

  const organization = await recipients.organization();
  const notifications = require("../notifications/notification.service");
  for (const e of employees) {
    if (!e.userId && !e.personal.workEmail) continue;
    await notifications
      .notify({
        template: "document_request",
        recipients: [recipients.employeeToRecipient(e)],
        organization,
        data: {
          employee: { firstName: e.personal.firstName },
          request: { name, requestedBy: (req && req.auth && req.auth.name) || "HR", dueNote: dueOn ? ` Please upload it by ${dueOn}.` : "", note: note || "" },
        },
        entity: { type: "DocumentRequest", id: created.find((c) => String(c.employeeId) === String(e._id))?._id || null },
      })
      .catch(() => {});
  }

  return { created: created.length };
}

async function listRequests(query = {}) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt"], maxLimit: 200 });
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.employeeId) filter.employeeId = query.employeeId;
  const [items, total] = await Promise.all([
    DocumentRequest.find(filter)
      .populate({ path: "employeeId", select: "employeeCode personal.firstName personal.lastName" })
      .populate("requestedBy", "firstName lastName")
      .sort({ status: 1, dueOn: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    DocumentRequest.countDocuments(filter),
  ]);
  return { items: items.map(shapeRequest), page, limit, total };
}

function shapeRequest(r) {
  return {
    id: String(r._id),
    name: r.name,
    category: r.category,
    note: r.note,
    dueOn: r.dueOn,
    status: r.status,
    isOverdue: Boolean(r.status === "pending" && r.dueOn && new Date(r.dueOn) < new Date()),
    employee: r.employeeId && r.employeeId.personal
      ? { id: String(r.employeeId._id), employeeCode: r.employeeId.employeeCode, name: [r.employeeId.personal.firstName, r.employeeId.personal.lastName].filter(Boolean).join(" ") }
      : null,
    requestedBy: r.requestedBy && r.requestedBy.firstName ? [r.requestedBy.firstName, r.requestedBy.lastName].filter(Boolean).join(" ") : null,
    fulfilledAt: r.fulfilledAt,
    fulfilledDocumentId: r.fulfilledDocumentId ? String(r.fulfilledDocumentId) : null,
    createdAt: r.createdAt,
  };
}

async function myRequests(auth) {
  if (!auth.employeeId) return [];
  const rows = await DocumentRequest.find({ employeeId: auth.employeeId, status: "pending" })
    .populate("requestedBy", "firstName lastName")
    .sort({ dueOn: 1, createdAt: -1 })
    .lean();
  return rows.map(shapeRequest);
}

async function cancelRequest(requestId, req) {
  const request = await DocumentRequest.findById(requestId);
  if (!request) throw AppError.notFound("Document request");
  if (request.status !== "pending") throw AppError.conflict("Only a pending request can be cancelled.");
  request.status = "cancelled";
  await request.save();
  await audit.record({ action: "document.request_cancelled", entityType: "DocumentRequest", entityId: request._id, entityLabel: request.name, severity: "notice" }, req);
  return shapeRequest(request.toObject());
}

/** Overdue and due-soon requests get a reminder, every three days. */
async function sendRequestReminders() {
  const soon = new Date(Date.now() + 3 * 86400000);
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
  const requests = await DocumentRequest.find({ status: "pending", dueOn: { $ne: null, $lte: soon } })
    .populate({ path: "employeeId", select: "userId personal.firstName personal.lastName personal.workEmail" })
    .limit(500)
    .lean();
  const organization = await recipients.organization();
  const notifications = require("../notifications/notification.service");
  let sent = 0;
  for (const request of requests) {
    const last = (request.remindersSent || []).slice(-1)[0];
    if (last && new Date(last) > threeDaysAgo) continue;
    const e = request.employeeId;
    if (!e || (!e.userId && !e.personal.workEmail)) continue;
    await notifications
      .notify({
        template: "document_request",
        recipients: [recipients.employeeToRecipient(e)],
        organization,
        data: { employee: { firstName: e.personal.firstName }, request: { name: request.name, requestedBy: "HR", dueNote: ` It is due by ${dt.toDateString(request.dueOn)}.`, note: request.note || "" } },
        severity: "warning",
        entity: { type: "DocumentRequest", id: request._id },
      })
      .catch(() => {});
    await DocumentRequest.updateOne({ _id: request._id }, { $push: { remindersSent: new Date() } });
    sent += 1;
  }
  return { checked: requests.length, sent };
}

// ── Company documents ───────────────────────────────────────────────────────

async function createCompanyDocument(file, data, req) {
  const organization = await tenant.runAsSystem(() => Organization.findById(tenant.requireOrganizationId()).lean(), "document.company");
  const stored = await storage.save({
    buffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    category: "company-document",
    ownerType: "CompanyDocument",
    ownerId: null,
    orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
  });

  const document = await CompanyDocument.create({
    title: data.title,
    description: data.description || "",
    category: data.category || "policy",
    fileId: stored._id,
    version: data.version || "1.0",
    effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
    audience: { type: data.audience || "all", departmentIds: data.departmentIds || [], locationIds: data.locationIds || [] },
    requireAcknowledgement: Boolean(data.requireAcknowledgement),
    isActive: data.isActive !== false,
    createdBy: tenant.getUserId(),
  });
  await storage.StoredFile.updateOne({ _id: stored._id }, { $set: { ownerId: document._id } });

  await audit.record(
    { action: "companydocument.published", entityType: "CompanyDocument", entityId: document._id, entityLabel: document.title, after: { category: document.category, requireAcknowledgement: document.requireAcknowledgement }, severity: "notice" },
    req
  );

  if (document.requireAcknowledgement) {
    notifyCompanyDocument(document, organization).catch((err) => logger.warn({ err }, "Company document notification failed"));
  }
  return shapeCompanyDocument({ ...document.toObject(), fileId: stored.toObject() });
}

async function notifyCompanyDocument(document, organization) {
  const employees = await audienceFor(document);
  const notifications = require("../notifications/notification.service");
  await notifications.notify({
    template: "document_acknowledgement_requested",
    recipients: employees.map(recipients.employeeToRecipient),
    organization,
    data: { document: { name: document.title, dueNote: "" } },
    entity: { type: "CompanyDocument", id: document._id },
  });
}

async function audienceFor(document) {
  const filter = { status: { $in: ["active", "on_leave", "notice_period"] } };
  const a = document.audience || {};
  if (a.type === "departments" && a.departmentIds && a.departmentIds.length) filter["employment.departmentId"] = { $in: a.departmentIds };
  if (a.type === "locations" && a.locationIds && a.locationIds.length) filter["employment.locationId"] = { $in: a.locationIds };
  return Employee.find(filter).select("userId personal.firstName personal.lastName personal.workEmail employment.departmentId employment.locationId").lean();
}

async function updateCompanyDocument(id, data, req, file = null) {
  const document = await CompanyDocument.findById(id);
  if (!document) throw AppError.notFound("Company document");
  const before = { title: document.title, version: document.version, isActive: document.isActive };

  if (file) {
    const organization = await tenant.runAsSystem(() => Organization.findById(tenant.requireOrganizationId()).lean(), "document.company");
    const stored = await storage.save({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      category: "company-document",
      ownerType: "CompanyDocument",
      ownerId: document._id,
      orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
    });
    document.fileId = stored._id;
    // A new file is a new version: acknowledgements start over.
    document.acknowledgements = [];
  }
  for (const key of ["title", "description", "category", "version", "requireAcknowledgement", "isActive"]) {
    if (data[key] !== undefined) document[key] = data[key];
  }
  if (data.effectiveFrom !== undefined) document.effectiveFrom = data.effectiveFrom ? new Date(data.effectiveFrom) : null;
  if (data.audience !== undefined) document.audience = { type: data.audience, departmentIds: data.departmentIds || [], locationIds: data.locationIds || [] };
  document.updatedBy = tenant.getUserId();
  await document.save();

  await audit.record(
    { action: "companydocument.updated", entityType: "CompanyDocument", entityId: document._id, entityLabel: document.title, before, after: { title: document.title, version: document.version, isActive: document.isActive }, skipIfUnchanged: true },
    req
  );
  const populated = await CompanyDocument.findById(document._id).populate("fileId").lean();
  return shapeCompanyDocument(populated);
}

async function listCompanyDocuments(auth, { manage = false } = {}) {
  const filter = manage ? {} : { isActive: true };
  let rows = await CompanyDocument.find(filter).populate("fileId").sort({ category: 1, publishedAt: -1 }).lean();

  if (!manage && auth.employeeId) {
    const me = await Employee.findById(auth.employeeId).select("employment.departmentId employment.locationId").lean();
    rows = rows.filter((d) => {
      const a = d.audience || {};
      if (!a.type || a.type === "all") return true;
      if (a.type === "departments") return me && (a.departmentIds || []).some((id) => String(id) === String(me.employment.departmentId));
      if (a.type === "locations") return me && (a.locationIds || []).some((id) => String(id) === String(me.employment.locationId));
      return true;
    });
  }
  return rows.map((d) => shapeCompanyDocument(d, auth));
}

function shapeCompanyDocument(d, auth) {
  const mine = auth ? (d.acknowledgements || []).find((a) => String(a.userId) === String(auth.userId)) : null;
  return {
    id: String(d._id),
    title: d.title,
    description: d.description,
    category: d.category,
    version: d.version,
    effectiveFrom: d.effectiveFrom,
    audience: d.audience,
    requireAcknowledgement: d.requireAcknowledgement,
    acknowledgedCount: (d.acknowledgements || []).length,
    acknowledged: Boolean(mine),
    acknowledgedAt: mine ? mine.at : null,
    isActive: d.isActive,
    publishedAt: d.publishedAt,
    file: d.fileId && d.fileId.mimeType ? storage.toPublicShape(d.fileId) : null,
  };
}

async function acknowledgeCompanyDocument(id, auth, { name } = {}, req) {
  const document = await CompanyDocument.findById(id);
  if (!document || !document.isActive) throw AppError.notFound("Company document");
  if (!document.acknowledgements.some((a) => String(a.userId) === String(auth.userId))) {
    document.acknowledgements.push({ userId: auth.userId, employeeId: auth.employeeId || null, name: (name || auth.name || "").slice(0, 120), at: new Date(), ip: (req && req.ip) || null });
    await document.save();
  }
  return { acknowledged: true };
}

async function companyDocumentAcknowledgements(id) {
  const document = await CompanyDocument.findById(id).lean();
  if (!document) throw AppError.notFound("Company document");
  const employees = await audienceFor(document);
  const acked = new Map((document.acknowledgements || []).map((a) => [String(a.userId), a]));
  const rows = employees.map((e) => ({
    employeeId: String(e._id),
    name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "),
    hasAccount: Boolean(e.userId),
    acknowledged: Boolean(e.userId && acked.has(String(e.userId))),
    acknowledgedAt: e.userId && acked.get(String(e.userId)) ? acked.get(String(e.userId)).at : null,
  }));
  return { total: rows.length, acknowledged: rows.filter((r) => r.acknowledged).length, pending: rows.filter((r) => !r.acknowledged), rows };
}

async function deleteCompanyDocument(id, req) {
  const document = await CompanyDocument.findById(id);
  if (!document) throw AppError.notFound("Company document");
  await document.softDelete(tenant.getUserId());
  await audit.record({ action: "companydocument.deleted", entityType: "CompanyDocument", entityId: document._id, entityLabel: document.title, severity: "warning" }, req);
  return { id: String(document._id), deleted: true };
}

// ── Public verification ─────────────────────────────────────────────────────

/**
 * Anyone with the code on a printed document can check it was issued by this
 * platform and has not been altered — without learning anything else. Runs
 * outside any tenant, which is why it reads with bypassTenant.
 */
async function verifyByCode(code) {
  const clean = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length < 8) return { valid: false };

  return tenant.runAsSystem(async () => {
    const document = await EmployeeDocument.findOne({ "verification.code": clean })
      .setOptions({ bypassTenant: true })
      .select("organizationId name documentNumber issuedOn templateId employeeId verification createdAt")
      .lean();
    if (!document) return { valid: false };

    const [organization, employee] = await Promise.all([
      Organization.findById(document.organizationId).select("name legalName").lean(),
      Employee.findById(document.employeeId).setOptions({ bypassTenant: true }).select("employeeCode").lean(),
    ]);

    await EmployeeDocument.updateOne(
      { _id: document._id },
      { $inc: { "verification.verifiedCount": 1 }, $set: { "verification.lastVerifiedAt": new Date() } }
    ).setOptions({ bypassTenant: true });

    const codeMasked = employee && employee.employeeCode ? `${employee.employeeCode.slice(0, 2)}${"•".repeat(Math.max(0, employee.employeeCode.length - 2))}` : null;
    return {
      valid: true,
      code: clean,
      documentName: document.name,
      documentNumber: document.documentNumber || null,
      issuedOn: document.issuedOn || document.createdAt,
      issuedBy: (organization && (organization.legalName || organization.name)) || null,
      employeeCodeMasked: codeMasked,
      fingerprint: document.verification && document.verification.sha256 ? document.verification.sha256.slice(0, 12) : null,
    };
  }, "document.verify");
}

/**
 * Render a payslip PDF from the organization's payslip template.
 *
 * Looks the template up by code rather than taking an id, because the caller
 * (payroll) has no business knowing which template document an organization
 * happens to have configured — only that it wants "the payslip one".
 */
async function generateForPayslip(payslip, req) {
  let template = await DocumentTemplate.findOne({ code: "PAYSLIP", isActive: true }).lean();

  if (!template) {
    await seedDefaultTemplates();
    template = await DocumentTemplate.findOne({ code: "PAYSLIP", isActive: true }).lean();
  }
  if (!template) {
    throw new AppError("DOCUMENT_TEMPLATE_MISSING", { message: "No payslip template is configured for your organization.", status: 422 });
  }

  return generate(String(template._id), { employeeId: String(payslip.employeeId), payslipId: String(payslip._id ?? payslip.id) }, req);
}

module.exports = {
  seedDefaultTemplates,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listVersions,
  getVersion,
  restoreVersion,
  exportTemplate,
  importTemplate,
  buildContext,
  generate,
  generateAndStore,
  requestBulkGenerate,
  runBulkGenerate,
  bulkStatus,
  listBulkDownloads,
  generateForPayslip,
  listEmployeeDocuments,
  uploadEmployeeDocument,
  reviewDocument,
  updateDocument,
  deleteDocument,
  expiring,
  requestAcknowledgement,
  acknowledge,
  pendingAcknowledgements,
  sendAcknowledgementReminders,
  createRequests,
  listRequests,
  myRequests,
  cancelRequest,
  sendRequestReminders,
  createCompanyDocument,
  updateCompanyDocument,
  listCompanyDocuments,
  acknowledgeCompanyDocument,
  companyDocumentAcknowledgements,
  deleteCompanyDocument,
  verifyByCode,
  settlementFor,
  amountInWords,
  formatMoney,
  DocumentTemplate,
  EmployeeDocument,
  CompanyDocument,
  DocumentRequest,
};
