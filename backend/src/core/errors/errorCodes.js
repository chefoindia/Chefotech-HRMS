"use strict";

/**
 * Stable, machine-readable error codes. Clients switch on `code`, never on the
 * human message — messages are free to change or be translated.
 */
const ErrorCodes = {
  // generic
  INTERNAL_ERROR: { status: 500, message: "Something went wrong. Please try again." },
  VALIDATION_ERROR: { status: 422, message: "Some of the submitted values are invalid." },
  NOT_FOUND: { status: 404, message: "The requested resource was not found." },
  CONFLICT: { status: 409, message: "This action conflicts with existing data." },
  BAD_REQUEST: { status: 400, message: "The request could not be processed." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please slow down." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The uploaded file is too large." },
  NOT_IMPLEMENTED: { status: 501, message: "This capability is not available yet." },

  // authentication
  UNAUTHENTICATED: { status: 401, message: "You need to sign in to continue." },
  INVALID_CREDENTIALS: { status: 401, message: "Email or password is incorrect." },
  TOKEN_EXPIRED: { status: 401, message: "Your session has expired. Please sign in again." },
  ACCOUNT_LOCKED: { status: 423, message: "This account is temporarily locked after too many failed sign-in attempts." },
  ACCOUNT_DISABLED: { status: 403, message: "This account has been disabled." },
  EMAIL_NOT_VERIFIED: { status: 403, message: "Please verify your email address to continue." },
  INVALID_TOKEN: { status: 400, message: "This link is invalid or has already been used." },

  // authorization and tenancy
  FORBIDDEN: { status: 403, message: "You do not have permission to perform this action." },
  PERMISSION_DENIED: { status: 403, message: "You do not have permission to perform this action." },
  TENANT_CONTEXT_MISSING: { status: 400, message: "No organization context was supplied." },
  CROSS_TENANT_ACCESS: { status: 404, message: "The requested resource was not found." },
  ORGANIZATION_SUSPENDED: { status: 403, message: "This organization is suspended. Please contact support." },
  FEATURE_NOT_AVAILABLE: { status: 402, message: "This feature is not included in your current plan." },
  PLAN_LIMIT_REACHED: { status: 402, message: "You have reached the limit for your current plan." },

  // domain
  EMPLOYEE_NOT_FOUND: { status: 404, message: "Employee was not found." },
  DUPLICATE_EMPLOYEE_CODE: { status: 409, message: "An employee with this code already exists." },
  ATTENDANCE_LOCKED: { status: 409, message: "Attendance for this period is locked." },
  LEAVE_BALANCE_INSUFFICIENT: { status: 422, message: "The available leave balance is not enough for this request." },
  LEAVE_OVERLAP: { status: 409, message: "A leave request already exists for one or more of these dates." },
  LEAVE_NOT_ELIGIBLE: { status: 422, message: "This employee is not eligible for the selected leave type." },
  PAYROLL_LOCKED: { status: 409, message: "This payroll run is locked and can no longer be modified." },
  PAYROLL_ALREADY_RUN: { status: 409, message: "A payroll run already exists for this period." },
  WORKFLOW_INVALID_STATE: { status: 409, message: "This request is not in a state that allows that action." },
  NOT_AN_APPROVER: { status: 403, message: "You are not an approver for this request." },
  FORMULA_ERROR: { status: 422, message: "A configured formula could not be evaluated." },
  STORAGE_ERROR: { status: 502, message: "The file store could not be reached." },
  DEVICE_UNREACHABLE: { status: 502, message: "The biometric device could not be reached." },
  IMPORT_FAILED: { status: 422, message: "The import could not be completed." },

  // AI (bring-your-own Gemini key)
  AI_NOT_CONFIGURED: { status: 422, message: "No AI provider is configured for your organization." },
  AI_INVALID_KEY: { status: 422, message: "The AI provider rejected this API key." },
  AI_MODEL_NOT_FOUND: { status: 422, message: "That AI model is no longer available." },
  AI_TIMEOUT: { status: 504, message: "The AI did not respond in time." },
  AI_UNAVAILABLE: { status: 502, message: "Could not reach the AI service." },
  AI_UPSTREAM_ERROR: { status: 502, message: "The AI service returned an error." },
  AI_EMPTY_RESPONSE: { status: 502, message: "The AI returned an empty response." },
  AI_MALFORMED_RESPONSE: { status: 502, message: "The AI's response could not be parsed." },
};

module.exports = { ErrorCodes };
