"use strict";

const { z } = require("zod");
const {
  objectId,
  dateString,
  listQuery,
  nullableDateString,
  nullableObjectId,
  optionalInt,
  optionalNumber,
} = require("../../core/validation/common");

const AddressSchema = z.object({
  line1: z.string().max(120).optional(),
  line2: z.string().max(120).optional(),
  city: z.string().max(60).optional(),
  state: z.string().max(60).optional(),
  country: z.string().max(60).optional(),
  postalCode: z.string().max(20).optional(),
});

const EmergencyContactSchema = z.object({
  name: z.string().trim().min(1).max(80),
  relationship: z.string().max(40).optional(),
  phone: z.string().max(30).optional(),
  alternatePhone: z.string().max(30).optional(),
  address: z.string().max(200).optional(),
  isPrimary: z.boolean().optional(),
});

const PersonalSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  middleName: z.string().max(60).optional(),
  lastName: z.string().max(60).optional(),
  displayName: z.string().max(120).optional(),
  gender: z.enum(["male", "female", "other", "undisclosed"]).optional(),
  dateOfBirth: nullableDateString(),
  bloodGroup: z.string().max(10).optional(),
  maritalStatus: z.enum(["single", "married", "divorced", "widowed", "undisclosed"]).optional(),
  nationality: z.string().max(60).optional(),
  fatherName: z.string().max(80).optional(),
  motherName: z.string().max(80).optional(),
  spouseName: z.string().max(80).optional(),
  workEmail: z.string().email().optional().or(z.literal("")),
  personalEmail: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  alternatePhone: z.string().max(30).optional(),
  currentAddress: AddressSchema.optional(),
  permanentAddress: AddressSchema.optional(),
  sameAsCurrentAddress: z.boolean().optional(),
  emergencyContacts: z.array(EmergencyContactSchema).max(5).optional(),
});

const EmploymentSchema = z.object({
  departmentId: nullableObjectId(),
  designationId: nullableObjectId(),
  locationId: nullableObjectId(),
  managerId: nullableObjectId(),
  employmentType: z
    .enum(["full_time", "part_time", "contract", "intern", "consultant", "temporary"])
    .optional(),
  workMode: z.enum(["on_site", "remote", "hybrid"]).optional(),
  joiningDate: nullableDateString(),
  confirmationDate: nullableDateString(),
  probationMonths: optionalInt(0, 36),
  noticePeriodDays: optionalInt(0, 365),
  shiftId: nullableObjectId(),
  weeklyOffPolicyId: nullableObjectId(),
  attendancePolicyId: nullableObjectId(),
  leavePolicyId: nullableObjectId(),
  holidayCalendarId: nullableObjectId(),
  isAttendanceExempt: z.boolean().optional(),
});

const BankSchema = z.object({
  accountHolderName: z.string().max(120).optional(),
  accountNumber: z.string().max(40).optional(),
  bankName: z.string().max(80).optional(),
  branch: z.string().max(80).optional(),
  ifscCode: z.string().max(20).optional(),
  swiftCode: z.string().max(20).optional(),
  accountType: z.enum(["savings", "current", ""]).optional(),
  paymentMode: z.enum(["bank_transfer", "cheque", "cash", "upi"]).optional(),
});

const StatutorySchema = z.object({
  pfNumber: z.string().max(40).optional(),
  uan: z.string().max(40).optional(),
  esiNumber: z.string().max(40).optional(),
  pfApplicable: z.boolean().optional(),
  esiApplicable: z.boolean().optional(),
  ptApplicable: z.boolean().optional(),
  taxRegime: z.enum(["old", "new", ""]).optional(),
  taxId: z.string().max(40).optional(),
});

const IdentityDocumentSchema = z.object({
  type: z.string().min(1).max(40),
  label: z.string().max(60).optional(),
  number: z.string().min(1).max(60),
  issuedOn: nullableDateString(),
  expiresOn: nullableDateString(),
  issuingAuthority: z.string().max(80).optional(),
  fileId: nullableObjectId(),
});

const EducationSchema = z.object({
  qualification: z.string().min(1).max(80),
  specialisation: z.string().max(80).optional(),
  institution: z.string().max(120).optional(),
  board: z.string().max(80).optional(),
  yearOfCompletion: optionalInt(1950, 2100),
  grade: z.string().max(20).optional(),
  fileId: nullableObjectId(),
});

const ExperienceSchema = z.object({
  company: z.string().min(1).max(120),
  designation: z.string().max(80).optional(),
  from: nullableDateString(),
  to: nullableDateString(),
  lastDrawnSalary: optionalNumber(0),
  reasonForLeaving: z.string().max(200).optional(),
  fileId: nullableObjectId(),
});

const CreateEmployeeSchema = z.object({
  employeeCode: z.string().trim().max(30).optional(),
  biometricId: z.string().trim().max(30).nullable().optional(),
  personal: PersonalSchema,
  employment: EmploymentSchema.optional(),
  bank: BankSchema.optional(),
  statutory: StatutorySchema.optional(),
  identityDocuments: z.array(IdentityDocumentSchema).max(20).optional(),
  education: z.array(EducationSchema).max(20).optional(),
  experience: z.array(ExperienceSchema).max(20).optional(),
  skills: z.array(z.string().max(40)).max(50).optional(),
  customFields: z.record(z.any()).optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["draft", "invited", "active"]).optional(),
  sendInvite: z.boolean().optional(),
  inviteRoleKey: z.string().max(40).optional(),
});

const UpdateEmployeeSchema = CreateEmployeeSchema.omit({
  status: true,
  sendInvite: true,
  inviteRoleKey: true,
})
  .partial()
  .extend({ personal: PersonalSchema.partial().optional() });

const SelfUpdateSchema = z.object({
  personal: PersonalSchema.partial().optional(),
  bank: BankSchema.optional(),
});

const ChangeStatusSchema = z.object({
  status: z.enum([
    "draft", "invited", "active", "on_leave", "suspended",
    "notice_period", "resigned", "terminated", "inactive",
  ]),
  effectiveFrom: dateString().optional(),
  reason: z.string().max(500).optional(),
  exit: z
    .object({
      resignationDate: nullableDateString(),
      lastWorkingDay: nullableDateString(),
      exitType: z
        .enum(["resignation", "termination", "retirement", "end_of_contract", "absconded", ""])
        .optional(),
      reason: z.string().max(500).optional(),
      isRehirable: z.boolean().optional(),
      exitInterviewNotes: z.string().max(2000).optional(),
      clearanceCompleted: z.boolean().optional(),
    })
    .optional(),
});

const InviteSchema = z.object({ roleKey: z.string().max(40).optional() });

const ListEmployeesQuery = listQuery({
  status: z.union([z.string(), z.array(z.string())]).optional(),
  departmentId: objectId().optional(),
  designationId: objectId().optional(),
  locationId: objectId().optional(),
  managerId: objectId().optional(),
  employmentType: z.string().optional(),
  tag: z.string().optional(),
  includeInactive: z.string().optional(),
  joinedFrom: dateString().optional(),
  joinedTo: dateString().optional(),
});

const CustomFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, "Use lowercase letters, numbers and underscores"),
  label: z.string().trim().min(1).max(60),
  helpText: z.string().max(200).optional(),
  type: z.enum([
    "text", "textarea", "number", "date", "dropdown", "multiselect",
    "boolean", "email", "phone", "file", "currency",
  ]),
  section: z.enum(["personal", "employment", "statutory", "bank", "other"]).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).max(100).optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  defaultValue: z.any().optional(),
  validation: z
    .object({
      min: z.number().nullable().optional(),
      max: z.number().nullable().optional(),
      minLength: z.number().int().nullable().optional(),
      maxLength: z.number().int().nullable().optional(),
      pattern: z.string().nullable().optional(),
    })
    .optional(),
  isSensitive: z.boolean().optional(),
  employeeEditable: z.boolean().optional(),
  showInList: z.boolean().optional(),
  order: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  SelfUpdateSchema,
  ChangeStatusSchema,
  InviteSchema,
  ListEmployeesQuery,
  CustomFieldSchema,
  PersonalSchema,
  EmploymentSchema,
};
