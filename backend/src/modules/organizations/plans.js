"use strict";

/**
 * Subscription plans.
 *
 * Limits and features are data. No module checks a plan CODE — modules ask
 * "is feature X available" and "is limit Y reached", which means a new plan is
 * a row here rather than a change in fifteen files.
 */

const FEATURES = {
  CORE_HR: "core_hr",
  ATTENDANCE: "attendance",
  LEAVE: "leave",
  SHIFTS: "shifts",
  BIOMETRIC: "biometric",
  PAYROLL: "payroll",
  DOCUMENTS: "documents",
  DOCUMENT_TEMPLATES: "document_templates",
  WORKFLOWS: "workflows",
  REPORTS: "reports",
  CUSTOM_REPORTS: "custom_reports",
  EXPENSES: "expenses",
  ASSETS: "assets",
  PERFORMANCE: "performance",
  RECRUITMENT: "recruitment",
  API_ACCESS: "api_access",
  WEBHOOKS: "webhooks",
  SSO: "sso",
  AUDIT_EXPORT: "audit_export",
  GUIDED_HELP: "guided_help",
  MULTI_LOCATION: "multi_location",
  CUSTOM_FIELDS: "custom_fields",
};

const ALL_FEATURES = Object.values(FEATURES);

const PLANS = [
  {
    code: "trial",
    name: "Free Trial",
    description: "Everything unlocked for 14 days.",
    monthlyPricePerEmployee: 0,
    trialDays: 14,
    limits: {
      employees: 25,
      admins: 3,
      biometricDevices: 1,
      storageMb: 1024,
      apiAccess: false,
    },
    features: ALL_FEATURES,
    isPublic: true,
  },
  {
    code: "starter",
    name: "Starter",
    description: "Core HR, attendance and leave for a growing team.",
    monthlyPricePerEmployee: 39,
    minimumBillable: 10,
    limits: {
      employees: 50,
      admins: 3,
      biometricDevices: 2,
      storageMb: 5120,
      apiAccess: false,
    },
    features: [
      FEATURES.CORE_HR,
      FEATURES.ATTENDANCE,
      FEATURES.LEAVE,
      FEATURES.SHIFTS,
      FEATURES.DOCUMENTS,
      FEATURES.REPORTS,
      FEATURES.GUIDED_HELP,
    ],
    isPublic: true,
  },
  {
    code: "professional",
    name: "Professional",
    description: "Adds payroll, biometric devices and approval workflows.",
    monthlyPricePerEmployee: 69,
    minimumBillable: 20,
    limits: {
      employees: 250,
      admins: 10,
      biometricDevices: 10,
      storageMb: 25600,
      apiAccess: true,
    },
    features: [
      FEATURES.CORE_HR,
      FEATURES.ATTENDANCE,
      FEATURES.LEAVE,
      FEATURES.SHIFTS,
      FEATURES.BIOMETRIC,
      FEATURES.PAYROLL,
      FEATURES.DOCUMENTS,
      FEATURES.DOCUMENT_TEMPLATES,
      FEATURES.WORKFLOWS,
      FEATURES.REPORTS,
      FEATURES.EXPENSES,
      FEATURES.ASSETS,
      FEATURES.API_ACCESS,
      FEATURES.GUIDED_HELP,
      FEATURES.MULTI_LOCATION,
      FEATURES.CUSTOM_FIELDS,
    ],
    isPopular: true,
    isPublic: true,
  },
  {
    code: "business",
    name: "Business",
    description: "For multi-location organizations that need everything.",
    monthlyPricePerEmployee: 99,
    minimumBillable: 50,
    limits: {
      employees: 1000,
      admins: 25,
      biometricDevices: 50,
      storageMb: 102400,
      apiAccess: true,
    },
    features: ALL_FEATURES.filter((f) => f !== FEATURES.SSO),
    isPublic: true,
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description: "Unlimited scale, SSO and a dedicated success manager.",
    monthlyPricePerEmployee: null, // talk to sales
    limits: {
      employees: Number.MAX_SAFE_INTEGER,
      admins: Number.MAX_SAFE_INTEGER,
      biometricDevices: Number.MAX_SAFE_INTEGER,
      storageMb: Number.MAX_SAFE_INTEGER,
      apiAccess: true,
    },
    features: ALL_FEATURES,
    isPublic: true,
  },
];

const PLANS_BY_CODE = Object.fromEntries(PLANS.map((p) => [p.code, p]));

function planOf(code) {
  return PLANS_BY_CODE[code] || PLANS_BY_CODE.trial;
}

function snapshotFor(code) {
  const plan = planOf(code);
  return {
    code: plan.code,
    name: plan.name,
    limits: { ...plan.limits },
    features: [...plan.features],
    trialEndsAt: plan.trialDays
      ? new Date(Date.now() + plan.trialDays * 86400000)
      : null,
  };
}

module.exports = { PLANS, PLANS_BY_CODE, FEATURES, ALL_FEATURES, planOf, snapshotFor };
