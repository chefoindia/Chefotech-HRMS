"use strict";

/**
 * Demo tenant.
 *
 *   node scripts/seedDemoTenant.js
 *
 * Builds one complete, realistic organization: structure, policies, shifts,
 * holidays, leave, salary, thirty employees, and a month of attendance
 * generated from simulated punches. Every number you see afterwards was
 * produced by the real engines, not written directly into the database — which
 * is the point: it exercises the whole pipeline end to end.
 *
 * Safe to re-run: it reuses the existing demo organization if one is there.
 */

const { connectDB, disconnectDB } = require("../src/config/db");
const { logger } = require("../src/config/logger");
const tenant = require("../src/core/tenancy/tenantContext");
const dt = require("../src/shared/datetime");

const User = require("../src/modules/users/user.model");
const Organization = require("../src/modules/organizations/organization.model");
const organizationService = require("../src/modules/organizations/organization.service");
const Department = require("../src/modules/departments/department.model");
const Designation = require("../src/modules/designations/designation.model");
const Location = require("../src/modules/locations/location.model");
const Shift = require("../src/modules/shifts/shift.model");
const WeeklyOffPolicy = require("../src/modules/shifts/weeklyOffPolicy.model");
const { HolidayCalendar, Holiday } = require("../src/modules/holidays/holiday.model");
const AttendancePolicy = require("../src/modules/attendance/attendancePolicy.model");
const { LeaveType, LeavePolicy } = require("../src/modules/leave/leave.model");
const { SalaryComponent, SalaryStructure } = require("../src/modules/payroll/payroll.model");
const employeeService = require("../src/modules/employees/employee.service");
const attendanceService = require("../src/modules/attendance/attendance.service");
const payrollService = require("../src/modules/payroll/payroll.service");
const documentService = require("../src/modules/documents/document.service");
const Membership = require("../src/modules/rbac/membership.model");
const Role = require("../src/modules/rbac/role.model");

const DEMO_EMAIL = "hr@brightweave.demo";
const DEMO_PASSWORD = "Demo@Chefotech1";
const YEAR = new Date().getFullYear();

const FIRST_NAMES = [
  "Ravi", "Priya", "Arjun", "Meera", "Karthik", "Ananya", "Vikram", "Divya",
  "Rahul", "Sneha", "Aditya", "Kavya", "Sanjay", "Pooja", "Nikhil", "Ishita",
  "Manish", "Riya", "Suresh", "Neha", "Rohan", "Lakshmi", "Amit", "Shreya",
  "Gopal", "Tanvi", "Deepak", "Aarti", "Vishal", "Kiran",
];
const LAST_NAMES = [
  "Kumar", "Sharma", "Nair", "Reddy", "Iyer", "Patel", "Singh", "Menon",
  "Das", "Bose", "Joshi", "Rao", "Gupta", "Pillai", "Verma",
];

async function main() {
  await connectDB();

  const owner = await ensureOwner();
  const organization = await ensureOrganization(owner);

  await tenant.runWithTenant(organization._id, async () => {
    logger.info("Seeding structure…");
    const { locations, departments, designations } = await seedStructure();

    logger.info("Seeding policies…");
    const { shifts, weeklyOff } = await seedShifts();
    const calendar = await seedHolidays(locations);
    const attendancePolicy = await seedAttendancePolicy();
    const { leaveTypes, leavePolicy } = await seedLeave();
    const { structure } = await seedPayroll();
    await documentService.seedDefaultTemplates();

    logger.info("Seeding employees…");
    const employees = await seedEmployees({
      departments,
      designations,
      locations,
      shifts,
      weeklyOff,
      attendancePolicy,
      leavePolicy,
      calendar,
      structure,
    });

    logger.info("Crediting accrued leave…");
    await seedLeaveBalances(employees, leaveTypes);

    logger.info("Simulating punches and processing attendance…");
    await simulateAttendance(employees, shifts);

    logger.info("Applying some leave…");
    await simulateLeave(employees, leaveTypes);

    logger.info("Recomputing attendance so the approved leave is reflected…");
    const today = dt.todayString(organization.timezone);
    await attendanceService.processRange({
      fromDate: dt.addDays(today, -35),
      toDate: today,
      force: true,
    });
  }, { userId: owner._id });

  logger.info(
    {
      organization: organization.name,
      slug: organization.slug,
      signIn: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    },
    "Demo tenant ready"
  );

  await disconnectDB();
}

// ── Owner and organization ──────────────────────────────────────────────────

async function ensureOwner() {
  let user = await User.findOne({ email: DEMO_EMAIL }).select("+passwordHash");
  if (user) return user;

  user = new User({
    email: DEMO_EMAIL,
    firstName: "Anita",
    lastName: "Fernandes",
    status: "active",
    emailVerifiedAt: new Date(),
  });
  await user.setPassword(DEMO_PASSWORD);
  await user.save();
  return user;
}

async function ensureOrganization(owner) {
  const existing = await Organization.findOne({ slug: /^brightweave/ });
  if (existing) {
    logger.info({ slug: existing.slug }, "Reusing the existing demo organization");
    return existing;
  }

  const { organization } = await organizationService.provision({
    name: "BrightWeave Apparel",
    ownerUserId: owner._id,
    timezone: "Asia/Kolkata",
    currency: "INR",
    country: "India",
  });

  // The demo organization has thirty employees, which is past the trial's
  // 25-seat limit — the limit guard correctly refuses to create the rest. Put
  // the demo on a plan whose limits match the story it is telling.
  const { snapshotFor } = require("../src/modules/organizations/plans");

  await Organization.updateOne(
    { _id: organization._id },
    {
      $set: {
        status: "active",
        plan: snapshotFor("professional"),
        legalName: "BrightWeave Apparel Private Limited",
        industry: "Apparel Manufacturing",
        companySize: "11-50",
        email: "contact@brightweave.demo",
        phone: "+914842345678",
        website: "https://brightweave.demo",
        address: {
          line1: "Plot 14, Industrial Estate",
          city: "Kochi",
          state: "Kerala",
          country: "India",
          postalCode: "682019",
        },
        "branding.primaryColor": "#4F46E5",
        "branding.accentColor": "#06B6D4",
      },
    }
  );

  await User.updateOne({ _id: owner._id }, { $set: { lastOrganizationId: organization._id } });
  return Organization.findById(organization._id);
}

// ── Structure ───────────────────────────────────────────────────────────────

async function seedStructure() {
  const locations = await upsertMany(Location, "code", [
    {
      name: "Kochi Head Office",
      code: "HO",
      type: "head_office",
      address: { line1: "Plot 14, Industrial Estate", city: "Kochi", state: "Kerala", country: "India", postalCode: "682019" },
      geo: { latitude: 9.9312, longitude: 76.2673, radiusMetres: 250 },
    },
    {
      name: "Aluva Production Unit",
      code: "PROD",
      type: "factory",
      address: { line1: "Survey 88, Aluva", city: "Aluva", state: "Kerala", country: "India", postalCode: "683101" },
      geo: { latitude: 10.1081, longitude: 76.3517, radiusMetres: 400 },
    },
  ]);

  const departments = await upsertMany(Department, "code", [
    { name: "Operations", code: "OPS" },
    { name: "Production", code: "PROD" },
    { name: "Quality", code: "QC" },
    { name: "Sales", code: "SALES" },
    { name: "Human Resources", code: "HR" },
    { name: "Finance", code: "FIN" },
  ]);

  const designations = await upsertMany(Designation, "code", [
    { name: "General Manager", code: "GM", level: 1, grade: "M1" },
    { name: "Manager", code: "MGR", level: 2, grade: "M2" },
    { name: "Team Lead", code: "TL", level: 3, grade: "S1" },
    { name: "Senior Executive", code: "SREXEC", level: 4, grade: "S2" },
    { name: "Executive", code: "EXEC", level: 5, grade: "E1" },
    { name: "Machine Operator", code: "OPER", level: 6, grade: "W1" },
    { name: "Trainee", code: "TRN", level: 7, grade: "T1" },
  ]);

  return { locations, departments, designations };
}

// ── Policies ────────────────────────────────────────────────────────────────

async function seedShifts() {
  const shifts = await upsertMany(Shift, "code", [
    { name: "General", code: "GEN", startTime: "09:00", endTime: "18:00", breakMinutes: 60, isDefault: true, colour: "#4F46E5" },
    { name: "Morning", code: "MOR", startTime: "06:00", endTime: "14:00", breakMinutes: 30, colour: "#F59E0B" },
    { name: "Evening", code: "EVE", startTime: "14:00", endTime: "22:00", breakMinutes: 30, colour: "#8B5CF6" },
    // Deliberately included: the overnight case is where most HRMS products
    // get attendance wrong, and the demo should prove this one does not.
    { name: "Night", code: "NGT", startTime: "22:00", endTime: "06:00", breakMinutes: 45, colour: "#0F172A" },
  ]);

  const weeklyOff = await upsertOne(WeeklyOffPolicy, "code", {
    name: "Sunday off, alternate Saturdays",
    code: "STD",
    isDefault: true,
    days: [
      { day: 0, type: "off" },
      { day: 1, type: "working" },
      { day: 2, type: "working" },
      { day: 3, type: "working" },
      { day: 4, type: "working" },
      { day: 5, type: "working" },
      { day: 6, type: "alternate", offOccurrences: [2, 4] },
    ],
  });

  return { shifts, weeklyOff };
}

async function seedHolidays(locations) {
  const calendar = await upsertOne(HolidayCalendar, "code", {
    name: `Kerala ${YEAR}`,
    code: "KL",
    year: YEAR,
    isDefault: true,
    optionalHolidayQuota: 2,
    locationIds: locations.map((l) => l._id),
  });

  const holidays = [
    { name: "New Year's Day", date: `${YEAR}-01-01`, type: "public" },
    { name: "Republic Day", date: `${YEAR}-01-26`, type: "national" },
    { name: "Vishu", date: `${YEAR}-04-14`, type: "regional" },
    { name: "May Day", date: `${YEAR}-05-01`, type: "public" },
    { name: "Independence Day", date: `${YEAR}-08-15`, type: "national" },
    { name: "Onam", date: `${YEAR}-09-05`, type: "regional" },
    { name: "Gandhi Jayanti", date: `${YEAR}-10-02`, type: "national" },
    { name: "Deepavali", date: `${YEAR}-10-20`, type: "public" },
    { name: "Christmas", date: `${YEAR}-12-25`, type: "public" },
    { name: "Good Friday", date: `${YEAR}-04-03`, type: "optional", isOptional: true },
    { name: "Bakrid", date: `${YEAR}-06-07`, type: "optional", isOptional: true },
  ];

  for (const holiday of holidays) {
    const exists = await Holiday.findOne({ calendarId: calendar._id, date: holiday.date });
    if (exists) continue;
    await Holiday.create({
      ...holiday,
      calendarId: calendar._id,
      organizationId: tenant.getOrganizationId(),
    });
  }

  await Location.updateMany({}, { $set: { holidayCalendarId: calendar._id } });
  return calendar;
}

async function seedAttendancePolicy() {
  return upsertOne(AttendancePolicy, "code", {
    name: "Standard Policy",
    code: "STD",
    isDefault: true,
    arrival: { graceMinutes: 10, lateAfterMinutes: 0, halfDayAfterMinutes: 240, absentAfterMinutes: 0 },
    departure: { graceMinutes: 10, earlyLeavingAfterMinutes: 0, halfDayBeforeMinutes: 240 },
    hours: { basis: "shift_based", fullDayPercent: 90, halfDayPercent: 45, minimumMinutesForPresence: 60 },
    breaks: { calculation: "first_last", maxBreakMinutes: 60, deductExcessBreak: true },
    lateMarks: { enabled: true, countForDeduction: 3, deductionType: "half_day", resetPeriod: "monthly" },
    overtime: {
      enabled: true,
      startsAfterMinutes: 30,
      minimumMinutes: 30,
      maximumMinutesPerDay: 240,
      roundToMinutes: 30,
      requiresApproval: true,
      normalDayRate: 1.5,
      weeklyOffRate: 2,
      holidayRate: 2,
    },
    weeklyOff: { grantsCompOff: true, compOffFullDayMinutes: 480, compOffHalfDayMinutes: 240, countsAsOvertime: true },
    holiday: { grantsCompOff: true, countsAsOvertime: true },
    missingPunch: { treatAs: "pending", notifyEmployee: true },
    regularization: { enabled: true, windowDays: 7, maxPerMonth: 3, requiresApproval: true },
  });
}

async function seedLeave() {
  const leaveTypes = await upsertMany(LeaveType, "code", [
    { name: "Casual Leave", code: "CL", colour: "#3B82F6", order: 1 },
    { name: "Sick Leave", code: "SL", colour: "#EF4444", order: 2, attachmentRequiredAfterDays: 2 },
    { name: "Earned Leave", code: "EL", colour: "#10B981", order: 3 },
    { name: "Compensatory Off", code: "COMP", colour: "#F59E0B", order: 4, isCompOff: true },
    { name: "Maternity Leave", code: "ML", colour: "#EC4899", order: 5, eligibility: { genders: ["female"], minimumServiceMonths: 6 } },
    { name: "Loss of Pay", code: "LOP", colour: "#6B7280", order: 6, isPaid: false, hasBalance: false },
  ]);

  const byCode = Object.fromEntries(leaveTypes.map((t) => [t.code, t]));

  const leavePolicy = await upsertOne(LeavePolicy, "code", {
    name: "Standard Staff Policy",
    code: "STAFF",
    isDefault: true,
    yearStartMonth: 1,
    rules: [
      {
        leaveTypeId: byCode.CL._id,
        allocation: { mode: "annual", daysPerPeriod: 12, prorateOnJoining: true, rounding: "nearest_half" },
        carryForward: { enabled: false },
        application: { noticeDays: 1, maximumDaysPerRequest: 3, allowBackdated: true, backdatedLimitDays: 15 },
        // The humane default: a weekend inside a leave is not deducted.
        counting: { holidays: "exclude", weeklyOffs: "exclude" },
        approval: { required: true },
      },
      {
        leaveTypeId: byCode.SL._id,
        allocation: { mode: "annual", daysPerPeriod: 6, prorateOnJoining: true },
        carryForward: { enabled: false },
        application: { noticeDays: 0, allowBackdated: true, backdatedLimitDays: 30 },
        counting: { holidays: "exclude", weeklyOffs: "exclude" },
        approval: { required: true },
      },
      {
        leaveTypeId: byCode.EL._id,
        allocation: { mode: "accrual", accrualPerMonth: 1.25, prorateOnJoining: true, maximumBalance: 45 },
        carryForward: { enabled: true, maximumDays: 30 },
        encashment: { enabled: true, maximumDays: 15, minimumBalanceToRetain: 5, onExitOnly: true },
        application: { noticeDays: 7, minimumDaysPerRequest: 1 },
        // Earned leave uses the sandwich rule, which is the common
        // manufacturing arrangement and the one employees ask about most.
        counting: { holidays: "sandwich", weeklyOffs: "sandwich" },
        approval: { required: true, escalateAfterDays: 3 },
      },
      {
        leaveTypeId: byCode.COMP._id,
        allocation: { mode: "none" },
        carryForward: { enabled: true, maximumDays: 5, expiryMonths: 3 },
        application: { noticeDays: 1 },
        counting: { holidays: "exclude", weeklyOffs: "exclude" },
        approval: { required: true },
      },
      {
        leaveTypeId: byCode.ML._id,
        allocation: { mode: "none", daysPerPeriod: 182 },
        application: { noticeDays: 30, maximumDaysPerRequest: 182, allowNegativeBalance: true, maximumNegativeDays: 182 },
        counting: { holidays: "include", weeklyOffs: "include" },
        approval: { required: true },
      },
      {
        leaveTypeId: byCode.LOP._id,
        allocation: { mode: "unlimited" },
        application: { noticeDays: 0, allowNegativeBalance: true },
        counting: { holidays: "exclude", weeklyOffs: "exclude" },
        approval: { required: true },
      },
    ],
  });

  return { leaveTypes, leavePolicy };
}

async function seedPayroll() {
  const components = await upsertMany(SalaryComponent, "code", [
    {
      name: "Basic Salary",
      code: "BASIC",
      type: "earning",
      category: "basic",
      order: 10,
      calculation: { method: "formula", expression: "pct(CTC_MONTHLY, 40)", rounding: "nearest_1" },
    },
    {
      name: "House Rent Allowance",
      code: "HRA",
      type: "earning",
      category: "allowance",
      order: 20,
      calculation: { method: "formula", expression: "pct(BASIC, 50)", rounding: "nearest_1" },
    },
    {
      name: "Conveyance Allowance",
      code: "CONV",
      type: "earning",
      category: "allowance",
      order: 30,
      calculation: { method: "fixed", amount: 1600 },
    },
    {
      name: "Special Allowance",
      code: "SPECIAL",
      type: "earning",
      category: "allowance",
      order: 40,
      // Whatever is left of the monthly CTC once the fixed heads are taken.
      calculation: {
        method: "formula",
        expression: "max(CTC_MONTHLY - BASIC - HRA - CONV, 0)",
        rounding: "nearest_1",
      },
    },
    {
      name: "Overtime",
      code: "OT",
      type: "earning",
      category: "overtime",
      order: 50,
      prorateOnAttendance: false,
      calculation: {
        method: "formula",
        expression: "round(BASIC / DAYS_IN_PERIOD / 8 * OVERTIME_HOURS * 1.5)",
      },
    },
    {
      name: "Provident Fund",
      code: "PF",
      type: "deduction",
      category: "statutory",
      order: 100,
      isStatutory: true,
      calculation: { method: "formula", expression: "min(pct(BASIC, 12), 1800)", rounding: "nearest_1" },
    },
    {
      name: "Professional Tax",
      code: "PT",
      type: "deduction",
      category: "statutory",
      order: 110,
      isStatutory: true,
      prorateOnAttendance: false,
      calculation: { method: "formula", expression: "if(GROSS > 20000, 200, if(GROSS > 15000, 150, 0))" },
    },
    {
      name: "Employer PF",
      code: "PF_EMPLOYER",
      type: "employer_contribution",
      category: "statutory",
      order: 200,
      showOnPayslip: false,
      calculation: { method: "formula", expression: "min(pct(BASIC, 12), 1800)", rounding: "nearest_1" },
    },
  ]);

  const structure = await upsertOne(SalaryStructure, "code", {
    name: "Standard Structure",
    code: "STD",
    isDefault: true,
    components: components.map((c) => ({ componentId: c._id })),
  });

  return { components, structure };
}

// ── Employees ───────────────────────────────────────────────────────────────

async function seedEmployees(context) {
  const existing = await employeeService.Employee.countDocuments({});
  if (existing > 5) {
    logger.info({ existing }, "Employees already seeded; skipping");
    return employeeService.Employee.find({}).lean();
  }

  const { departments, designations, locations, shifts, weeklyOff, attendancePolicy, leavePolicy, calendar, structure } =
    context;

  const byCode = (list) => Object.fromEntries(list.map((x) => [x.code, x]));
  const dept = byCode(departments);
  const desig = byCode(designations);
  const loc = byCode(locations);
  const shift = byCode(shifts);

  const plan = [
    { code: "GM", dept: "OPS", location: "HO", shift: "GEN", ctc: 2400000, manager: null },
    { code: "MGR", dept: "PROD", location: "PROD", shift: "GEN", ctc: 1200000 },
    { code: "MGR", dept: "HR", location: "HO", shift: "GEN", ctc: 1100000 },
    { code: "MGR", dept: "SALES", location: "HO", shift: "GEN", ctc: 1150000 },
    { code: "TL", dept: "PROD", location: "PROD", shift: "MOR", ctc: 720000 },
    { code: "TL", dept: "QC", location: "PROD", shift: "GEN", ctc: 680000 },
    { code: "SREXEC", dept: "SALES", location: "HO", shift: "GEN", ctc: 620000 },
    { code: "SREXEC", dept: "FIN", location: "HO", shift: "GEN", ctc: 640000 },
    { code: "EXEC", dept: "HR", location: "HO", shift: "GEN", ctc: 480000 },
    { code: "EXEC", dept: "SALES", location: "HO", shift: "GEN", ctc: 460000 },
    { code: "EXEC", dept: "FIN", location: "HO", shift: "GEN", ctc: 470000 },
    { code: "EXEC", dept: "QC", location: "PROD", shift: "GEN", ctc: 440000 },
  ];

  // The shop floor: operators across three shifts, including nights.
  for (let i = 0; i < 14; i += 1) {
    plan.push({
      code: "OPER",
      dept: "PROD",
      location: "PROD",
      shift: ["MOR", "EVE", "NGT"][i % 3],
      ctc: 288000 + (i % 4) * 12000,
    });
  }
  for (let i = 0; i < 4; i += 1) {
    plan.push({ code: "TRN", dept: "PROD", location: "PROD", shift: "MOR", ctc: 180000 });
  }

  const created = [];
  const today = dt.todayString("Asia/Kolkata");

  for (let i = 0; i < plan.length; i += 1) {
    const row = plan[i];
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i * 3) % LAST_NAMES.length];
    const gender = i % 3 === 1 ? "female" : "male";

    // Spread joining dates over the last four years.
    const joiningDate = dt.addDays(today, -(120 + i * 47));

    const employee = await employeeService.create({
      biometricId: String(1001 + i),
      personal: {
        firstName,
        lastName,
        gender,
        dateOfBirth: `${1985 + (i % 15)}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`,
        workEmail: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@brightweave.demo`,
        phone: `+9198${String(40000000 + i * 137).slice(0, 8)}`,
        currentAddress: { city: row.location === "HO" ? "Kochi" : "Aluva", state: "Kerala", country: "India" },
        emergencyContacts: [{ name: `${LAST_NAMES[(i + 5) % LAST_NAMES.length]} family`, relationship: "Spouse", phone: "+919800000000", isPrimary: true }],
      },
      employment: {
        departmentId: dept[row.dept]._id,
        designationId: desig[row.code]._id,
        locationId: loc[row.location]._id,
        managerId: created.length && row.code !== "GM" ? pickManager(created, row) : null,
        employmentType: row.code === "TRN" ? "intern" : "full_time",
        workMode: "on_site",
        joiningDate,
        shiftId: shift[row.shift]._id,
        weeklyOffPolicyId: weeklyOff._id,
        attendancePolicyId: attendancePolicy._id,
        leavePolicyId: leavePolicy._id,
        holidayCalendarId: calendar._id,
      },
      bank: {
        accountHolderName: `${firstName} ${lastName}`,
        accountNumber: `50100${String(100000 + i * 7)}`,
        bankName: "State Bank of India",
        ifscCode: "SBIN0001234",
        accountType: "savings",
      },
      statutory: { pfApplicable: true, uan: `1001${String(10000000 + i)}` },
      status: "active",
    });

    await payrollService.assignSalary(employee._id, {
      structureId: structure._id,
      effectiveFrom: joiningDate,
      ctcAnnual: row.ctc,
      ctcMonthly: Math.round(row.ctc / 12),
      revisionType: "initial",
      revisionReason: "Initial appointment",
    });

    created.push(employee);
  }

  // Link the owner's login to the HR manager's employee record, so signing in
  // as the demo user lands on a profile with real data behind it.
  const hrManager = created.find((e) => String(e.employment.departmentId) === String(dept.HR._id));
  if (hrManager) {
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.getOrganizationId()).lean(),
      "demo.link-owner"
    );
    await Membership.updateOne(
      { userId: organization.ownerUserId },
      { $set: { employeeId: hrManager._id, isManager: true } }
    );
    await employeeService.Employee.updateOne(
      { _id: hrManager._id },
      { $set: { userId: organization.ownerUserId } }
    );
  }

  logger.info({ count: created.length }, "Employees created");
  return created;
}

function pickManager(created, row) {
  const manager =
    created.find((e) => e.employeeCode && String(e.employment.departmentId) && row.code !== "MGR") || created[0];
  return manager ? manager._id : null;
}

// ── Leave balances ──────────────────────────────────────────────────────────

/**
 * Credit the earned leave these employees would already have accrued.
 *
 * Earned leave accrues monthly, so a freshly seeded organization would show
 * every balance at zero until the nightly accrual job first runs — which makes
 * the demo look broken rather than new. This walks the same path the job does,
 * through adjustBalance, so the balance history explains where the days came
 * from instead of a number appearing from nowhere.
 */
async function seedLeaveBalances(employees, leaveTypes) {
  const leaveService = require("../src/modules/leave/leave.service");
  const earned = leaveTypes.find((type) => type.code === "EL");
  if (!earned) return;

  const today = dt.todayString("Asia/Kolkata");
  let credited = 0;

  for (const employee of employees) {
    const joining = employee.employment && employee.employment.joiningDate;
    if (!joining) continue;

    const monthsOfService = Math.floor(
      dt.monthsSince(dt.toDateString(joining, "Asia/Kolkata"), today)
    );
    // Only this leave year's accrual, capped at the policy maximum.
    const monthsThisYear = Math.min(monthsOfService, Number(today.slice(5, 7)) - 1);
    const days = Math.min(monthsThisYear * 1.25, 45);
    if (days <= 0) continue;

    const policy = await leaveService.resolvePolicy(employee);
    const balance = await leaveService.getOrCreateBalance(employee, earned, today, policy);

    if (balance.allocated > 0) continue; // already credited on a previous run

    await leaveService.adjustBalance(balance, {
      field: "allocated",
      type: "accrual",
      days,
      note: `Accrued over ${monthsThisYear} completed months this leave year`,
    });
    balance.lastAccruedMonth = Number(today.slice(5, 7));
    await balance.save();
    credited += 1;
  }

  logger.info({ credited }, "Earned leave credited");
}

// ── Attendance simulation ───────────────────────────────────────────────────

/**
 * Generate punches for the last five weeks, then let the real engine turn them
 * into attendance. Deliberately imperfect: some people are late, some leave
 * early, a couple forget to punch out, and a few work overtime — so the
 * dashboard, the reports and the payroll deductions all have something real
 * to show.
 */
async function simulateAttendance(employees, shifts) {
  const shiftById = Object.fromEntries(shifts.map((s) => [String(s._id), s]));
  const today = dt.todayString("Asia/Kolkata");

  // Include today, so the dashboard shows a day in progress rather than an
  // organization where nobody turned up. Punches for today are only generated
  // up to the current time — people who have not reached their shift start yet
  // simply have no punch, which is exactly what a real morning looks like.
  const dates = dt.eachDate(dt.addDays(today, -35), today);
  const nowMinutes = dt.nowIn("Asia/Kolkata").hour() * 60 + dt.nowIn("Asia/Kolkata").minute();

  // A tiny deterministic PRNG, so re-running the seed produces the same
  // demo data rather than a different story every time.
  let seed = 20260820;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  let punches = 0;

  for (const employee of employees) {
    const shift = shiftById[String(employee.employment.shiftId)];
    if (!shift) continue;

    for (const date of dates) {
      const weekday = dt.weekdayIndex(date);
      if (weekday === 0) continue; // Sunday
      if (weekday === 6 && [2, 4].includes(dt.weekdayOccurrence(date))) continue;

      const roll = random();
      if (roll < 0.04) continue; // absent

      const lateMinutes = roll < 0.16 ? Math.floor(random() * 45) + 5 : Math.floor(random() * 8);
      const inTime = addMinutesToTime(shift.startTime, lateMinutes - 3);

      // On today, only punches that have already happened.
      const isToday = date === today;
      if (isToday && dt.timeToMinutes(inTime) > nowMinutes) continue;

      await attendanceService.recordPunch({
        employeeId: employee._id,
        at: dt.combine(date, inTime, "Asia/Kolkata"),
        direction: "in",
        source: "biometric",
      });
      punches += 1;

      // Roughly one day in fifty, somebody forgets to punch out.
      if (random() < 0.02) continue;

      const overtime = random() < 0.12 ? Math.floor(random() * 150) + 45 : 0;
      const early = random() < 0.08 ? Math.floor(random() * 60) + 15 : 0;
      const outTime = addMinutesToTime(shift.endTime, overtime - early + Math.floor(random() * 10));

      // Nobody has clocked out of a shift that has not finished yet.
      if (isToday && (shift.crossesMidnight || dt.timeToMinutes(outTime) > nowMinutes)) continue;

      // A night shift's exit lands on the following calendar day; recordPunch
      // attributes it back to the shift's own date.
      const outDate = shift.crossesMidnight ? dt.addDays(date, 1) : date;

      await attendanceService.recordPunch({
        employeeId: employee._id,
        at: dt.combine(outDate, outTime, "Asia/Kolkata"),
        direction: "out",
        source: "biometric",
      });
      punches += 1;
    }
  }

  logger.info({ punches }, "Punches simulated");
}

function addMinutesToTime(time, minutes) {
  const total = dt.timeToMinutes(time) + minutes;
  return dt.minutesToTime(total);
}

// ── Leave simulation ────────────────────────────────────────────────────────

async function simulateLeave(employees, leaveTypes) {
  const leaveService = require("../src/modules/leave/leave.service");
  const cl = leaveTypes.find((t) => t.code === "CL");
  const el = leaveTypes.find((t) => t.code === "EL");
  const today = dt.todayString("Asia/Kolkata");

  const samples = [
    { employee: employees[4], type: cl, from: dt.addDays(today, -20), days: 1, reason: "Personal work" },
    { employee: employees[6], type: cl, from: dt.addDays(today, -14), days: 2, reason: "Family function" },
    // Friday to Monday: the case that shows the sandwich rule working.
    { employee: employees[8], type: el, from: nearestFriday(today, -12), days: 4, reason: "Short trip" },
    { employee: employees[10], type: cl, from: dt.addDays(today, 3), days: 1, reason: "Medical appointment" },
    { employee: employees[12], type: el, from: dt.addDays(today, 7), days: 3, reason: "Wedding in the family" },
  ];

  for (const sample of samples) {
    if (!sample.employee || !sample.type) continue;
    try {
      const request = await leaveService.apply(
        sample.employee._id,
        {
          leaveTypeId: sample.type._id,
          fromDate: sample.from,
          toDate: dt.addDays(sample.from, sample.days - 1),
          reason: sample.reason,
        },
        null,
        { onBehalf: true }
      );

      // Approve the ones in the past, leave the future ones pending so the
      // approvals screen has something in it.
      if (sample.from < today) {
        await leaveService.decide(request._id, { decision: "approve", comment: "Approved" }, null);
      }
    } catch (err) {
      logger.warn({ err: err.message, employee: sample.employee.employeeCode }, "Demo leave skipped");
    }
  }
}

function nearestFriday(from, offsetDays) {
  let date = dt.addDays(from, offsetDays);
  for (let i = 0; i < 7; i += 1) {
    if (dt.weekdayIndex(date) === 5) return date;
    date = dt.addDays(date, -1);
  }
  return date;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function upsertMany(Model, key, rows) {
  const out = [];
  for (const row of rows) out.push(await upsertOne(Model, key, row));
  return out;
}

async function upsertOne(Model, key, row) {
  const existing = await Model.findOne({ [key]: row[key] });
  if (existing) {
    Object.assign(existing, row);
    await existing.save();
    return existing;
  }
  return Model.create({ ...row, organizationId: tenant.getOrganizationId() });
}

main().catch(async (err) => {
  logger.error({ err }, "Demo seed failed");
  await disconnectDB().catch(() => {});
  process.exit(1);
});
