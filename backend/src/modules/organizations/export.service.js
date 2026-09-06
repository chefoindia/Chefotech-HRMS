"use strict";

const archiver = require("archiver");
const Organization = require("./organization.model");
const storage = require("../../core/storage/storage.service");
const queue = require("../../core/jobs/queue");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const { env } = require("../../config/env");
const dt = require("../../shared/datetime");

/**
 * Take everything with you.
 *
 * A zip of JSON files, one per collection, plus a manifest — the shape a
 * customer's own engineers or a migration partner can work with, and the
 * answer to "can we get our data out" that every procurement asks.
 * Files (documents, photos) are listed with their metadata but not bundled;
 * they are reachable through the file endpoints with the same permissions.
 */

const COLLECTIONS = [
  ["employees", () => require("../employees/employee.model")],
  ["departments", () => require("../departments/department.model")],
  ["designations", () => require("../designations/designation.model")],
  ["locations", () => require("../locations/location.model")],
  ["shifts", () => require("../shifts/shift.model")],
  ["holidays", () => require("../holidays/holiday.model")],
  ["attendance_records", () => require("../attendance/attendance.model").AttendanceRecord],
  ["leave_types", () => require("../leave/leave.model").LeaveType],
  ["leave_requests", () => require("../leave/leave.model").LeaveRequest],
  ["leave_balances", () => require("../leave/leave.model").LeaveBalance],
  ["salary_components", () => require("../payroll/payroll.model").SalaryComponent],
  ["salary_structures", () => require("../payroll/payroll.model").SalaryStructure],
  ["employee_salaries", () => require("../payroll/payroll.model").EmployeeSalary],
  ["payroll_runs", () => require("../payroll/payroll.model").PayrollRun],
  ["payroll_items", () => require("../payroll/payroll.model").PayrollItem],
  ["payslips", () => require("../payroll/payroll.model").Payslip],
  ["payroll_inputs", () => require("../payroll/payrollInput.model")],
  ["documents", () => require("../documents/document.model").EmployeeDocument],
  ["document_templates", () => require("../documents/document.model").DocumentTemplate],
  ["company_documents", () => require("../documents/document.model").CompanyDocument],
  ["sheet_templates", () => require("../documents/sheetTemplate.model")],
  ["requests", () => require("../requests/request.model").EmployeeRequest],
  ["tickets", () => require("../tickets/ticket.model").Ticket],
  ["expense_claims", () => require("../expenses/expense.model").ExpenseClaim],
  ["assets", () => require("../assets/asset.model").Asset],
  ["asset_assignments", () => require("../assets/asset.model").AssetAssignment],
  ["loans", () => require("../loans/loan.model").Loan],
  ["exits", () => require("../exits/exit.model").Exit],
  ["onboarding", () => require("../onboarding/onboarding.model").Onboarding],
  ["employee_changes", () => require("../employees/change.model").EmployeeChange],
  ["workflows", () => require("../workflow/workflow.model").Workflow],
  ["roles", () => require("../rbac/role.model")],
  ["memberships", () => require("../rbac/membership.model")],
  ["settings", () => require("../../core/settings/setting.model")],
  ["files", () => require("../../core/storage/storedFile.model")],
];

const SENSITIVE_STRIP = ["passwordHash", "refreshTokens", "mfaSecret", "mfaPendingSecret", "mfaRecoveryCodes", "secret", "hash", "tokenHash"];

function strip(doc) {
  const out = { ...doc };
  for (const key of SENSITIVE_STRIP) delete out[key];
  return out;
}

/** Ask for an export. Runs on the queue and tells the requester when the zip is ready. */
async function request(req) {
  const recent = await storage.StoredFile.findOne({ category: "export", ownerType: "OrganizationExport", createdAt: { $gte: new Date(Date.now() - 10 * 60000) } }).lean();
  if (recent) throw AppError.conflict("An export was produced in the last ten minutes. Download that one, or try again shortly.");
  const job = await queue.enqueue("organization.export", { requestedBy: String(tenant.getUserId()) }, { priority: 1 });
  await audit.record({ action: "organization.export_requested", entityType: "Organization", entityId: tenant.requireOrganizationId(), after: { jobId: String(job._id) }, severity: "warning" }, req);
  if (!env.jobs.enabled) await queue.drainOnce();
  return { jobId: String(job._id), queued: true };
}

async function run({ requestedBy }) {
  const organization = await tenant.runAsSystem(() => Organization.findById(tenant.requireOrganizationId()).lean(), "organization.export");
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks = [];
  archive.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });

  const manifest = { organization: { id: String(organization._id), name: organization.name, slug: organization.slug, timezone: organization.timezone, currency: organization.currency }, exportedAt: new Date().toISOString(), format: "chefotech.organization-export", formatVersion: 1, collections: {} };
  for (const [name, load] of COLLECTIONS) {
    try {
      const Model = load();
      const query = Model.find({});
      if (typeof query.withDeleted === "function") query.withDeleted();
      const rows = await query.lean();
      // Files carry the URL their bytes are served from, built by the storage
      // layer so it is right for whichever store holds them.
      const clean = rows.map((row) => (name === "files" ? { ...strip(row), downloadUrl: storage.toPublicShape(row).proxyUrl } : strip(row)));
      archive.append(JSON.stringify(clean, null, 1), { name: `${name}.json` });
      manifest.collections[name] = clean.length;
    } catch (err) {
      logger.warn({ err, collection: name }, "Collection skipped in export");
      manifest.collections[name] = `error: ${err.message}`;
    }
  }
  archive.append(JSON.stringify({ ...organization, branding: undefined }, null, 1), { name: "organization.json" });
  archive.append(JSON.stringify(manifest, null, 1), { name: "manifest.json" });
  archive.append(README, { name: "README.txt" });
  archive.finalize();
  await done;

  const stored = await storage.save({
    buffer: Buffer.concat(chunks),
    originalName: `${organization.slug}-export-${dt.todayString(organization.timezone)}.zip`,
    mimeType: "application/zip",
    category: "export",
    ownerType: "OrganizationExport",
    ownerId: requestedBy,
    orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
    metadata: { collections: manifest.collections },
    uploadedBy: requestedBy,
  });

  try {
    const User = require("../users/user.model");
    const user = await User.findById(requestedBy).select("email firstName lastName").lean();
    if (user) {
      await notifications.notify({
        template: "announcement",
        recipients: [recipients.userToRecipient(user)],
        organization,
        data: { title: "Your data export is ready", message: `${Object.keys(manifest.collections).length} collections, ${Math.round(stored.size / 1024)} KB. Download it from Settings → Plan & usage → Data export. The link needs you to be signed in.` },
        channels: ["in_app", "email"],
        entity: { type: "StoredFile", id: stored._id },
      });
    }
  } catch (err) {
    logger.warn({ err }, "Export notification failed");
  }
  await audit.record({ action: "organization.exported", entityType: "Organization", entityId: organization._id, after: { fileId: String(stored._id), bytes: stored.size }, severity: "warning" }, null);
  return { fileId: String(stored._id), bytes: stored.size, collections: manifest.collections };
}

async function list() {
  const files = await storage.StoredFile.find({ category: "export", ownerType: "OrganizationExport" }).sort({ createdAt: -1 }).limit(10).lean();
  return files.map((f) => ({ ...storage.toPublicShape(f), createdAt: f.createdAt, collections: f.metadata && f.metadata.collections }));
}

const README = `ChefoTech HRMS — organization data export

Each JSON file holds one collection as an array of records, exactly as stored,
minus credentials and secrets. Identifiers are MongoDB ObjectIds as strings;
references between collections use those ids (for example an attendance
record's employeeId matches an employee's _id).

Dates are ISO 8601. Money is in the organization's currency (see
manifest.json). Attendance and leave dates are calendar dates ("2026-03-04")
in the organization's time zone.

Files themselves (documents, photos, receipts) are listed in files.json with
their metadata and a downloadUrl each; fetch them with an API key or a
signed-in session. The same permissions apply as in the portal.
`;

module.exports = { request, run, list };
