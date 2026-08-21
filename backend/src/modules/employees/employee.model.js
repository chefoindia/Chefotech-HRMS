"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * The employee record.
 *
 * Grouped into sub-documents rather than a flat sheet of 80 fields, because
 * access control is applied per group: `employee.view` gets you the profile,
 * `employee.view_sensitive` is what unlocks bank, identity and statutory data.
 * A flat schema would make that distinction impossible to express.
 *
 * Note there is no `salary` field here. Compensation lives in EmployeeSalary
 * with its own history and its own permission, so that reading an employee
 * never accidentally exposes what they earn.
 */

const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    relationship: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    alternatePhone: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: true }
);

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, default: "" },
    line2: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "India" },
    postalCode: { type: String, default: "" },
  },
  { _id: false }
);

/**
 * Identity documents are modelled generically rather than as aadhaarNumber /
 * ssnNumber / nationalIdNumber columns — the platform sells to more than one
 * country and the set of documents differs in each.
 */
const identityDocumentSchema = new mongoose.Schema(
  {
    type: { type: String, required: true }, // "aadhaar" | "pan" | "passport" | ...
    label: { type: String, default: "" },
    number: { type: String, required: true, trim: true },
    issuedOn: { type: Date, default: null },
    expiresOn: { type: Date, default: null },
    issuingAuthority: { type: String, default: "" },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
    verified: { type: Boolean, default: false },
  },
  { _id: true }
);

const educationSchema = new mongoose.Schema(
  {
    qualification: { type: String, required: true },
    specialisation: { type: String, default: "" },
    institution: { type: String, default: "" },
    board: { type: String, default: "" },
    yearOfCompletion: { type: Number, default: null },
    grade: { type: String, default: "" },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
  },
  { _id: true }
);

const experienceSchema = new mongoose.Schema(
  {
    company: { type: String, required: true },
    designation: { type: String, default: "" },
    from: { type: Date, default: null },
    to: { type: Date, default: null },
    lastDrawnSalary: { type: Number, default: null },
    reasonForLeaving: { type: String, default: "" },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
  },
  { _id: true }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    effectiveFrom: { type: Date, required: true },
    reason: { type: String, default: "" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const EMPLOYEE_STATUSES = [
  "draft",
  "invited",
  "active",
  "on_leave",
  "suspended",
  "notice_period",
  "resigned",
  "terminated",
  "inactive",
];

const employeeSchema = createTenantSchema({
  /** Human-facing id. Unique per organization, never reused. */
  employeeCode: { type: String, required: true, trim: true, index: true },

  /**
   * The id this person has on the attendance devices.
   *
   * Kept as a real, indexed, queryable field rather than a virtual alias of
   * employeeCode. They are different identifiers with different lifetimes —
   * a device enrolment id is assigned by hardware and frequently does not
   * match the HR code — and conflating them silently breaks every punch
   * import for anyone whose two ids differ.
   */
  biometricId: { type: String, default: null, trim: true, index: true },

  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  avatarFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },

  // ── Personal ────────────────────────────────────────────────────────────
  personal: {
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, trim: true, default: "" },
    lastName: { type: String, trim: true, default: "" },
    displayName: { type: String, trim: true, default: "" },
    gender: { type: String, enum: ["male", "female", "other", "undisclosed"], default: "undisclosed" },
    dateOfBirth: { type: Date, default: null },
    bloodGroup: { type: String, default: "" },
    maritalStatus: {
      type: String,
      enum: ["single", "married", "divorced", "widowed", "undisclosed"],
      default: "undisclosed",
    },
    nationality: { type: String, default: "" },
    fatherName: { type: String, default: "" },
    motherName: { type: String, default: "" },
    spouseName: { type: String, default: "" },

    workEmail: { type: String, lowercase: true, trim: true, default: "" },
    personalEmail: { type: String, lowercase: true, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    alternatePhone: { type: String, trim: true, default: "" },

    currentAddress: { type: addressSchema, default: () => ({}) },
    permanentAddress: { type: addressSchema, default: () => ({}) },
    sameAsCurrentAddress: { type: Boolean, default: false },

    emergencyContacts: { type: [emergencyContactSchema], default: [] },
  },

  // ── Employment ──────────────────────────────────────────────────────────
  employment: {
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    designationId: { type: mongoose.Schema.Types.ObjectId, ref: "Designation", default: null, index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null, index: true },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null, index: true },
    /** Ancestor chain up the reporting line. Powers "my team, all levels". */
    managerChain: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],

    employmentType: {
      type: String,
      enum: ["full_time", "part_time", "contract", "intern", "consultant", "temporary"],
      default: "full_time",
      index: true,
    },
    workMode: {
      type: String,
      enum: ["on_site", "remote", "hybrid"],
      default: "on_site",
    },

    joiningDate: { type: Date, default: null, index: true },
    confirmationDate: { type: Date, default: null },
    probationMonths: { type: Number, default: null },
    noticePeriodDays: { type: Number, default: null },

    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift", default: null },
    weeklyOffPolicyId: { type: mongoose.Schema.Types.ObjectId, ref: "WeeklyOffPolicy", default: null },
    attendancePolicyId: { type: mongoose.Schema.Types.ObjectId, ref: "AttendancePolicy", default: null },
    leavePolicyId: { type: mongoose.Schema.Types.ObjectId, ref: "LeavePolicy", default: null },
    holidayCalendarId: { type: mongoose.Schema.Types.ObjectId, ref: "HolidayCalendar", default: null },

    /** Excluded from attendance processing and payroll deductions. */
    isAttendanceExempt: { type: Boolean, default: false },
  },

  // ── Sensitive: gated behind employee.view_sensitive ──────────────────────
  bank: {
    accountHolderName: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    bankName: { type: String, default: "" },
    branch: { type: String, default: "" },
    ifscCode: { type: String, default: "" },
    swiftCode: { type: String, default: "" },
    accountType: { type: String, enum: ["savings", "current", ""], default: "" },
    paymentMode: {
      type: String,
      enum: ["bank_transfer", "cheque", "cash", "upi"],
      default: "bank_transfer",
    },
  },

  statutory: {
    pfNumber: { type: String, default: "" },
    uan: { type: String, default: "" },
    esiNumber: { type: String, default: "" },
    pfApplicable: { type: Boolean, default: true },
    esiApplicable: { type: Boolean, default: false },
    ptApplicable: { type: Boolean, default: true },
    taxRegime: { type: String, enum: ["old", "new", ""], default: "" },
    taxId: { type: String, default: "" }, // PAN / TIN / NI number
  },

  identityDocuments: { type: [identityDocumentSchema], default: [] },
  education: { type: [educationSchema], default: [] },
  experience: { type: [experienceSchema], default: [] },
  skills: { type: [String], default: [] },

  /**
   * Tenant-defined fields. A Map keyed by the custom field's `key`, so adding
   * "Uniform Size" to an organization never touches this schema or triggers a
   * migration.
   */
  customFields: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },

  // ── Lifecycle ───────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: EMPLOYEE_STATUSES,
    default: "draft",
    index: true,
  },
  statusHistory: { type: [statusHistorySchema], default: [] },

  exit: {
    resignationDate: { type: Date, default: null },
    lastWorkingDay: { type: Date, default: null },
    exitType: {
      type: String,
      enum: ["resignation", "termination", "retirement", "end_of_contract", "absconded", ""],
      default: "",
    },
    reason: { type: String, default: "" },
    isRehirable: { type: Boolean, default: true },
    exitInterviewNotes: { type: String, default: "" },
    clearanceCompleted: { type: Boolean, default: false },
  },

  tags: { type: [String], default: [] },
  notes: { type: String, default: "" },
});

tenantUnique(employeeSchema, "employeeCode");
// Sparse so the many employees without a device enrolment do not collide on null.
employeeSchema.index(
  { organizationId: 1, biometricId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { biometricId: { $type: "string" } } }
);
employeeSchema.index({ organizationId: 1, status: 1, "employment.departmentId": 1 });
employeeSchema.index({ organizationId: 1, "employment.managerChain": 1 });
employeeSchema.index({ organizationId: 1, "personal.firstName": 1, "personal.lastName": 1 });
employeeSchema.index({ organizationId: 1, "personal.workEmail": 1 });
employeeSchema.index({ organizationId: 1, "employment.joiningDate": -1 });

employeeSchema.virtual("fullName").get(function fullName() {
  const p = this.personal || {};
  return (
    p.displayName ||
    [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ")
  );
});

employeeSchema.virtual("isEmployed").get(function isEmployed() {
  return ["active", "on_leave", "notice_period", "suspended"].includes(this.status);
});

module.exports = mongoose.model("Employee", employeeSchema);
module.exports.EMPLOYEE_STATUSES = EMPLOYEE_STATUSES;
