/** Shared shapes returned by the API. */

export interface Branding {
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  letterheadUrl: string | null;
  watermarkUrl: string | null;
  loginBackgroundUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  sidebarStyle: "light" | "dark" | "brand";
  borderRadius: "none" | "small" | "medium" | "large";
  fontFamily: string;
  loginHeadline: string;
  loginSubtext: string;
  emailHeaderColor: string;
  emailFooterText: string;
  pdfHeaderText: string;
  pdfFooterText: string;
  showPoweredBy: boolean;
}

export interface OnboardingStep {
  key: string;
  title: string;
  description: string;
  required: boolean;
  route: string;
  permission?: string;
  feature?: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  completedAt: string | null;
}

export interface OnboardingProgress {
  percent: number;
  completedCount: number;
  requiredCount: number;
  isComplete: boolean;
  nextStep: { key: string; title: string; route: string } | null;
}

export interface Organization {
  id: string;
  name: string;
  legalName: string;
  displayName: string;
  slug: string;
  registrationNumber: string;
  taxId: string;
  panNumber: string;
  pfNumber: string;
  esiNumber: string;
  industry: string;
  businessType: string;
  companySize: string;
  website: string;
  email: string;
  phone: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
  timezone: string;
  currency: string;
  currencySymbol: string;
  locale: string;
  status: "trial" | "active" | "past_due" | "suspended" | "cancelled";
  branding: Branding;
  features: string[];
  plan: {
    code: string;
    name: string;
    trialEndsAt: string | null;
    limits: Record<string, number | boolean>;
    features: string[];
  };
  onboardingProgress: OnboardingProgress;
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  status: string;
  emailVerified: boolean;
  isPlatformUser: boolean;
  locale: string;
  timezone: string | null;
}

export interface Session {
  user: SessionUser;
  organization: Organization | null;
  organizations?: Array<{ id: string; name: string; slug: string; status: string }>;
  permissions: string[];
  roles: Array<{ id: string; key: string; name: string; isOwner: boolean }>;
  membershipId?: string;
  employeeId: string | null;
  isOwner?: boolean;
  isManager?: boolean;
  isPlatformUser: boolean;
  platformRole?: string | null;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string;
  parentId: string | null;
  headEmployeeId: { employeeCode: string; firstName?: string; lastName?: string } | string | null;
  costCentre: string;
  isActive: boolean;
  employeeCount: number;
  children?: Department[];
}

export interface Designation {
  id: string;
  name: string;
  code: string;
  grade: string;
  level: number;
  departmentId: { id: string; name: string } | string | null;
  isActive: boolean;
  employeeCount: number;
}

export interface Location {
  id: string;
  name: string;
  code: string;
  type: string;
  address: Record<string, string>;
  timezone: string | null;
  geo: { latitude: number | null; longitude: number | null; radiusMetres: number };
  isActive: boolean;
  employeeCount: number;
}

export type EmployeeStatus =
  | "draft"
  | "invited"
  | "active"
  | "on_leave"
  | "suspended"
  | "notice_period"
  | "resigned"
  | "terminated"
  | "inactive";

export interface Employee {
  id: string;
  employeeCode: string;
  biometricId: string | null;
  fullName: string;
  avatarUrl: string | null;
  status: EmployeeStatus;
  sensitiveHidden?: boolean;
  personal: {
    firstName: string;
    middleName: string;
    lastName: string;
    displayName: string;
    gender: string;
    dateOfBirth: string | null;
    bloodGroup: string;
    maritalStatus: string;
    workEmail: string;
    personalEmail: string;
    phone: string;
    alternatePhone: string;
    currentAddress: Record<string, string>;
    permanentAddress: Record<string, string>;
    emergencyContacts: Array<{
      _id?: string;
      name: string;
      relationship: string;
      phone: string;
      isPrimary: boolean;
    }>;
  };
  employment: {
    departmentId: { id?: string; _id?: string; name: string; code: string } | string | null;
    designationId: { id?: string; _id?: string; name: string; code: string } | string | null;
    locationId: { id?: string; _id?: string; name: string; code: string } | string | null;
    managerId: { id?: string; _id?: string; employeeCode: string; personal?: { firstName: string; lastName: string } } | string | null;
    employmentType: string;
    workMode: string;
    joiningDate: string | null;
    confirmationDate: string | null;
    probationMonths: number | null;
    noticePeriodDays: number | null;
    shiftId: string | null;
    isAttendanceExempt: boolean;
  };
  bank?: Record<string, string>;
  statutory?: Record<string, string | boolean>;
  identityDocuments?: Array<Record<string, unknown>>;
  education?: Array<Record<string, unknown>>;
  experience?: Array<Record<string, unknown>>;
  skills?: string[];
  customFields?: Record<string, unknown>;
  exit?: Record<string, unknown>;
  tags?: string[];
  createdAt: string;
}

export type AttendanceStatus =
  | "present"
  | "absent"
  | "half_day"
  | "weekly_off"
  | "holiday"
  | "leave"
  | "on_duty"
  | "work_from_home"
  | "comp_off"
  | "pending"
  | "not_applicable";

export interface AttendanceRecord {
  id?: string;
  date: string;
  status: AttendanceStatus;
  shiftCode: string | null;
  firstPunchAt: string | null;
  lastPunchAt: string | null;
  workedMinutes: number;
  effectiveMinutes: number;
  lateByMinutes: number;
  earlyLeavingByMinutes: number;
  overtimeMinutes: number;
  overtimeRate: number | null;
  overtimeStatus: string;
  isLate: boolean;
  isEarlyLeaving: boolean;
  isMissingPunch: boolean;
  payableDays: number;
  holidayName: string | null;
  leaveType: string | null;
  isLocked: boolean;
  isManualOverride: boolean;
  breakdown: Array<{ rule: string; detail: string; effect: string }>;
  punches?: Array<{ at: string; direction: string | null; source: string; isManual: boolean }>;
  employeeId?: { employeeCode: string; personal: { firstName: string; lastName: string } } | string;
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  weeklyOff: number;
  holiday: number;
  late: number;
  earlyLeaving: number;
  missingPunch: number;
  payableDays: number;
  workedHours: number;
  overtimeHours: number;
  compOffEarned: number;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  colour: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  requiresAttachment: boolean;
  attachmentRequiredAfterDays: number;
}

export interface LeaveBalance {
  leaveType: LeaveType;
  hasBalance: boolean;
  year?: number;
  opening?: number;
  allocated?: number;
  carriedForward?: number;
  credited?: number;
  used?: number;
  pending?: number;
  available: number | null;
  eligible: boolean;
  ineligibleReasons: string[];
  rule: Record<string, unknown> | null;
}

export interface LeaveRequest {
  id: string;
  employeeId: { id?: string; employeeCode: string; personal: { firstName: string; lastName: string } } | string;
  leaveTypeId: LeaveType | string;
  fromDate: string;
  toDate: string;
  fromPortion: string;
  toPortion: string;
  calendarDays: number;
  leaveDays: number;
  reason: string;
  status: "draft" | "pending" | "approved" | "rejected" | "cancelled" | "withdrawn";
  rejectionReason: string;
  createdAt: string;
  calculation?: { breakdown: Array<{ rule: string; detail: string; effect: string }> };
  days?: Array<{ date: string; dayPortion: string; deductedDays: number; isNonWorkingDay: boolean; nonWorkingReason: string | null }>;
}

export interface LeavePreview {
  leaveType: LeaveType;
  calendarDays: number;
  leaveDays: number;
  days: Array<{
    date: string;
    portion: string;
    deductedDays: number;
    isHoliday: boolean;
    isWeeklyOff: boolean;
    reason: string | null;
  }>;
  breakdown: Array<{ rule: string; detail: string; effect: string }>;
  balanceAvailable: number | null;
  balanceAfter: number | null;
  canApply: boolean;
  problems: string[];
  attachmentRequired: boolean;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  severity: "info" | "success" | "warning" | "critical";
  category: string;
  readAt: string | null;
  createdAt: string;
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  category: string;
  stepCount: number;
  estimatedMinutes: number;
  status: string;
  currentStepIndex: number;
  steps?: TourStep[];
}

export interface TourStep {
  id: string;
  action: "navigate" | "click" | "input" | "select" | "toggle" | "wait" | "observe";
  target?: string;
  route?: string;
  field?: string;
  title: string;
  body?: string;
  ask?: string;
  placeholder?: string;
  options?: Array<{ value: string | boolean | number; label: string }>;
  optionsFrom?: string;
  validate?: {
    type?: string;
    required?: boolean;
    min?: number;
    max?: number;
    message?: string;
  };
  completeWhen: string;
  completeTarget?: string;
  completeRoute?: string;
}

export interface HelpMatch {
  intentId: string;
  score: number;
  answer: string;
  route: string | null;
  tour: { id: string; title: string; description: string; stepCount: number; estimatedMinutes: number } | null;
}
