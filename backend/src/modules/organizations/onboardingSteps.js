"use strict";

/**
 * The setup checklist a new organization works through.
 *
 * Only `required: true` steps count toward the completion percentage, so a
 * company that does not run payroll through Chefotech is not stuck at 80%
 * forever. Every step is skippable and revisitable — nothing is a wall between
 * signing up and using the product.
 *
 * Each step's `route` points at the screen that already does that job, rather
 * than at a wizard page of its own. A parallel set of onboarding forms would
 * duplicate every settings form in the product and then drift from it — the
 * wizard's copy of the leave policy editor would quietly fall behind the real
 * one. The checklist tracks progress; the real screens do the work, so what a
 * new administrator learns during setup is where things actually live.
 */
const ONBOARDING_STEPS = [
  {
    key: "account",
    title: "Create your account",
    description: "Your sign-in and the organization record.",
    required: true,
    route: "/app",
    autoCompleted: true,
  },
  {
    key: "company",
    title: "Company information",
    description: "Legal name, registration details and address.",
    required: true,
    route: "/app/settings",
    permission: "settings.manage",
  },
  {
    key: "branding",
    title: "Branding",
    description: "Logo and colours for the app, emails and documents.",
    required: false,
    route: "/app/settings/branding",
    permission: "settings.manage_branding",
  },
  {
    key: "locations",
    title: "Work locations",
    description: "Offices, plants and sites your people work from.",
    required: true,
    route: "/app/organization/locations",
    permission: "location.manage",
  },
  {
    key: "departments",
    title: "Departments",
    description: "How the organization is divided.",
    required: true,
    route: "/app/organization/departments",
    permission: "department.manage",
  },
  {
    key: "designations",
    title: "Designations",
    description: "Job titles and grades.",
    required: true,
    route: "/app/organization/designations",
    permission: "designation.manage",
  },
  {
    key: "workweek",
    title: "Working days",
    description: "Which days are working days and which are weekly offs.",
    required: true,
    route: "/app/settings/shifts",
    permission: "settings.manage_policies",
  },
  {
    key: "shifts",
    title: "Shifts",
    description: "Start and end times, including night shifts.",
    required: true,
    route: "/app/settings/shifts",
    permission: "shift.manage",
  },
  {
    key: "holidays",
    title: "Holiday calendar",
    description: "Public and company holidays for the year.",
    required: false,
    route: "/app/settings/holidays",
    permission: "holiday.manage",
  },
  {
    key: "leave",
    title: "Leave policy",
    description: "Leave types, allocations and approval rules.",
    required: true,
    route: "/app/settings/leave",
    permission: "leave.manage_policies",
  },
  {
    key: "attendance",
    title: "Attendance policy",
    description: "Grace periods, late marks and half-day rules.",
    required: true,
    route: "/app/settings/attendance",
    permission: "settings.manage_policies",
  },
  {
    key: "payroll",
    title: "Payroll setup",
    description: "Salary components, structures and the pay cycle.",
    required: false,
    route: "/app/payroll/components",
    permission: "payroll.manage_components",
    feature: "payroll",
  },
  {
    key: "biometric",
    title: "Biometric devices",
    description: "Connect attendance devices, or skip and use web check-in.",
    required: false,
    route: "/app/settings/biometric",
    permission: "biometric.manage",
    feature: "biometric",
  },
  {
    key: "employees",
    title: "Add employees",
    description: "Import a spreadsheet or add people one at a time.",
    required: true,
    route: "/app/employees",
    permission: "employee.create",
  },
  {
    key: "invite_admins",
    title: "Invite your team",
    description: "Give HR and managers access.",
    required: false,
    route: "/app/settings/users",
    permission: "user.invite",
  },
];

const STEP_KEYS = ONBOARDING_STEPS.map((s) => s.key);

function initialSteps() {
  return ONBOARDING_STEPS.map((s) => ({
    key: s.key,
    status: s.autoCompleted ? "completed" : "pending",
    completedAt: s.autoCompleted ? new Date() : null,
    completedBy: null,
  }));
}

/**
 * Completion percentage over required steps only. A skipped required step
 * still counts as handled — the user made a decision about it.
 */
function computeProgress(steps = []) {
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
  const required = ONBOARDING_STEPS.filter((s) => s.required);
  const done = required.filter((s) => {
    const state = byKey[s.key];
    return state && (state.status === "completed" || state.status === "skipped");
  });
  const percent = required.length ? Math.round((done.length / required.length) * 100) : 100;

  return {
    percent,
    completedCount: done.length,
    requiredCount: required.length,
    isComplete: percent === 100,
    nextStep:
      ONBOARDING_STEPS.find((s) => {
        const state = byKey[s.key];
        return s.required && (!state || state.status === "pending" || state.status === "in_progress");
      }) || null,
  };
}

/** Merge the definitions with an organization's stored progress, for the UI. */
function describe(steps = []) {
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
  return ONBOARDING_STEPS.map((definition) => ({
    ...definition,
    status: (byKey[definition.key] && byKey[definition.key].status) || "pending",
    completedAt: (byKey[definition.key] && byKey[definition.key].completedAt) || null,
  }));
}

module.exports = { ONBOARDING_STEPS, STEP_KEYS, initialSteps, computeProgress, describe };
