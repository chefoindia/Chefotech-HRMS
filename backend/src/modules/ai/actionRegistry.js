"use strict";

const { TOURS } = require("../help/tours");
const { ONBOARDING_STEPS } = require("../organizations/onboardingSteps");
const { SETTINGS, SETTING_GROUPS } = require("../../core/settings/settingsRegistry");

/**
 * The chatbot's grounding data — the only place it is allowed to get a route,
 * a tour id or a settings group from.
 *
 * This is deliberately not new content: it is built by combining three
 * registries that already exist and already drive real UI (the guided-tour
 * engine, the onboarding checklist, the settings screen). A generic-purpose
 * chatbot that free-associates a plausible-sounding route or a tour id that
 * does not exist would reproduce exactly the class of bug the deep-link guard
 * tests in this codebase exist to catch — grounding the chatbot in the same
 * registries closes that off at the source instead of testing for it after
 * the fact.
 *
 * Each action gets a short, stable `id`. Those ids are the enum Gemini's
 * function-calling schema is constrained to — the model can select one, it
 * cannot invent one.
 */

const TOUR_ACTIONS = TOURS.map((tour) => ({
  id: tour.id,
  kind: "tour",
  title: tour.title,
  description: tour.description,
  route: (tour.steps.find((s) => s.route) || {}).route || null,
  permission: tour.permission || null,
  fields: tour.steps.filter((s) => s.field).map((s) => ({ field: s.field, about: s.title })),
}));

const SETTINGS_ACTIONS = SETTING_GROUPS.map((group) => ({
  id: `settings_${group.key}`,
  kind: "settings_group",
  title: `${group.label} settings`,
  description: `Values under Settings — ${group.label}.`,
  route: "/app/settings",
  permission: group.permission,
  settingKeys: SETTINGS.filter((s) => s.group === group.key).map((s) => s.key),
}));

/**
 * Screens with no tour and no settings-registry entry — CRUD reference-data
 * pages and the onboarding steps that just point at one. Kept short and
 * literal on purpose: a wrong route here is a wrong route the chatbot will
 * confidently send someone to, so every entry is one already verified against
 * the frontend's route table (the same discipline as
 * backend/tests/unit/deepLinks.test.js).
 */
const PAGE_ACTIONS = [
  { id: "company_profile", title: "Company information", description: "Legal name, registration numbers, address, timezone and currency.", route: "/app/settings", permission: "settings.manage" },
  { id: "locations", title: "Work locations", description: "Offices, plants and sites.", route: "/app/organization/locations", permission: "location.manage" },
  { id: "departments", title: "Departments", description: "How the organization is divided.", route: "/app/organization/departments", permission: "department.manage" },
  { id: "designations", title: "Designations", description: "Job titles and grades.", route: "/app/organization/designations", permission: "designation.manage" },
  { id: "holidays", title: "Holiday calendar", description: "Public and company holidays.", route: "/app/settings/holidays", permission: "holiday.manage" },
  { id: "leave_types", title: "Leave types", description: "The list of leave types before they get a policy rule.", route: "/app/settings/leave-types", permission: "leave.manage_types" },
  { id: "users_invite", title: "Invite your team", description: "Give HR and managers access to the platform.", route: "/app/settings/users", permission: "user.invite" },
  { id: "roles", title: "Roles and permissions", description: "Custom roles — nothing in the product keys off a role's name, only its permissions.", route: "/app/settings/roles", permission: "role.manage" },
  { id: "payroll_components", title: "Payroll components", description: "Salary components and the formulas that compute them.", route: "/app/payroll/components", permission: "payroll.manage_components" },
  { id: "employees", title: "Employees", description: "Add people one at a time or import a spreadsheet.", route: "/app/employees", permission: "employee.create" },
  { id: "employee_fields", title: "Custom employee fields", description: "Extra fields captured on an employee record.", route: "/app/settings/employee-fields", permission: "settings.manage" },
  { id: "security_settings", title: "Security", description: "Session timeout, password policy, two-factor, IP restrictions.", route: "/app/settings/security", permission: "settings.manage_security" },
  { id: "ai_settings", title: "AI assistant", description: "Where the organization's own Gemini API key is set up.", route: "/app/settings/ai", permission: "settings.manage_ai" },
].map((a) => ({ ...a, kind: "page" }));

const ACTIONS = [...TOUR_ACTIONS, ...SETTINGS_ACTIONS, ...PAGE_ACTIONS];
const ACTIONS_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

function visibleActions(permissions) {
  return ACTIONS.filter((a) => !a.permission || permissions.includes(a.permission));
}

function visibleTourIds(permissions) {
  return TOUR_ACTIONS.filter((a) => !a.permission || permissions.includes(a.permission)).map((a) => a.id);
}

/** A compact, token-cheap catalogue for the system prompt — one line per action. */
function describeForPrompt(permissions) {
  return visibleActions(permissions)
    .map((a) => {
      const bits = [`- ${a.id} (${a.kind}): ${a.title} — ${a.description}. Route: ${a.route}.`];
      if (a.kind === "tour") bits.push("Has an interactive walkthrough.");
      return bits.join(" ");
    })
    .join("\n");
}

/** Onboarding progress, phrased for the prompt rather than the checklist UI. */
function describeOnboardingForPrompt(onboarding) {
  if (!onboarding) return "";
  const pending = ONBOARDING_STEPS.filter((step) => {
    const state = onboarding.steps?.find((s) => s.key === step.key);
    return step.required && (!state || state.status === "pending" || state.status === "in_progress");
  });
  const lines = [
    `Setup is ${onboarding.progress?.percent ?? 0}% complete (${onboarding.progress?.completedCount ?? 0} of ${onboarding.progress?.requiredCount ?? 0} required steps).`,
  ];
  if (pending.length) {
    lines.push(
      "Required steps not yet done, in the order a new organization should do them:",
      ...pending.map((s) => `  - ${s.key}: ${s.title} — ${s.description}`)
    );
  } else {
    lines.push("Every required setup step is done.");
  }
  return lines.join("\n");
}

module.exports = {
  ACTIONS,
  ACTIONS_BY_ID,
  visibleActions,
  visibleTourIds,
  describeForPrompt,
  describeOnboardingForPrompt,
};
