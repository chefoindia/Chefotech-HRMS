"use strict";

/**
 * Built-in notification and email templates.
 *
 * Every template is overridable per organization (see EmailTemplate); these
 * are the defaults a tenant starts from. Bodies use {{dotted.path}}
 * placeholders resolved against the event data plus `company` and `recipient`,
 * which the service always injects.
 *
 * `event` is what notification rules bind to and what the event bus emits.
 * Several templates can share an event (a manager-facing and an
 * employee-facing message about the same thing); a rule listens to the event.
 *
 * `actionUrl` is a web route. The mobile app maps it onto its own screens.
 * Every literal route here is checked against the frontend by the deep-link
 * test suite, so a renamed page fails a test rather than a customer.
 */

const TEMPLATES = {
  // ── Account ──────────────────────────────────────────────────────────────
  welcome: {
    event: "account.welcome",
    channels: ["email"],
    subject: "Welcome to {{company.name}} on Chefotech HRMS",
    title: "Welcome aboard",
    body:
      "Hi {{firstName}},\n\n" +
      "Your Chefotech HRMS workspace for {{companyName}} is ready.\n\n" +
      "Please confirm your email address to finish setting up:\n{{verifyUrl}}\n\n" +
      "— The Chefotech team",
  },
  email_verification: {
    event: "account.email_verification",
    channels: ["email"],
    subject: "Confirm your email address",
    title: "Confirm your email",
    body:
      "Hi {{firstName}},\n\n" +
      "Use this link to confirm that this address belongs to you. It expires in 48 hours:\n\n" +
      "{{verifyUrl}}\n\n" +
      "If you did not request this, you can ignore it.",
  },
  duplicate_signup_attempt: {
    event: "account.duplicate_signup",
    channels: ["email"],
    subject: "Someone tried to sign up with your email",
    title: "Sign-up attempt",
    body:
      "Hi {{firstName}},\n\n" +
      "Someone just tried to create a Chefotech HRMS account with this email address. " +
      "You already have one, so nothing has changed.\n\n" +
      "If this was you, sign in instead. If it was not, you can safely ignore this message.",
  },
  password_reset: {
    event: "account.password_reset",
    channels: ["email"],
    subject: "Reset your Chefotech HRMS password",
    title: "Password reset",
    body:
      "Hi {{firstName}},\n\n" +
      "Use this link to choose a new password. It expires in {{expiresInMinutes}} minutes:\n\n" +
      "{{resetUrl}}\n\n" +
      "If you did not ask for this, no action is needed — your password has not changed.",
  },
  mfa_changed: {
    event: "account.mfa_changed",
    channels: ["email"],
    subject: "Two-factor authentication was {{state}}",
    title: "Two-factor authentication {{state}}",
    body:
      "Hi {{firstName}},\n\n" +
      "Two-factor authentication on your account was {{state}} on {{when}} from {{ip}}.\n\n" +
      "If this was not you, change your password immediately and tell your administrator.",
  },
  password_changed: {
    event: "account.password_changed",
    channels: ["email"],
    subject: "Your password was changed",
    title: "Password changed",
    body:
      "Hi {{firstName}},\n\n" +
      "The password on your account was changed on {{when}} from {{ip}}. Every other session has been signed out.\n\n" +
      "If this was not you, reset your password immediately from the sign-in page and tell your administrator.",
  },
  new_device_login: {
    event: "account.new_device_login",
    channels: ["email"],
    subject: "New sign-in to your account",
    title: "New sign-in",
    body:
      "Hi {{firstName}},\n\n" +
      "Your account was just used to sign in from a device we have not seen before.\n\n" +
      "Device: {{device}}\nLocation (IP): {{ip}}\nTime: {{when}}\n\n" +
      "If this was you, there is nothing to do. If it was not, change your password now and review your active sessions under My profile.",
    actionUrl: "/me/profile",
  },
  mfa_enabled: {
    event: "account.mfa_enabled",
    channels: ["email"],
    subject: "Two-factor authentication is on",
    title: "Two-factor authentication enabled",
    body:
      "Hi {{firstName}},\n\n" +
      "Two-factor authentication was switched on for your account on {{when}}. You will be asked for a code from your authenticator app whenever you sign in.\n\n" +
      "Keep your backup codes somewhere safe — they are the only way back in if you lose the phone.",
  },
  account_locked: {
    event: "account.locked",
    channels: ["email"],
    subject: "Your account is temporarily locked",
    title: "Account locked",
    body:
      "Hi {{firstName}},\n\n" +
      "Your account was locked for {{minutes}} minutes after several failed sign-in attempts from {{ip}}.\n\n" +
      "If this was not you, reset your password once the lock lifts.",
  },
  user_invitation: {
    event: "account.invited",
    channels: ["email"],
    subject: "{{inviterName}} invited you to {{company.name}}",
    title: "You have been invited",
    body:
      "Hi {{firstName}},\n\n" +
      "{{inviterName}} has invited you to join {{company.name}} on Chefotech HRMS as {{roleName}}.\n\n" +
      "Set your password to get started:\n{{acceptUrl}}\n\n" +
      "This invitation expires in {{expiresInDays}} days.",
  },

  // ── Leave ────────────────────────────────────────────────────────────────
  leave_applied: {
    event: "leave.applied",
    channels: ["in_app", "email", "push"],
    subject: "Leave request from {{employee.name}}",
    title: "New leave request",
    body:
      "{{employee.name}} has applied for {{leave.type}} from {{leave.from}} to {{leave.to}} " +
      "({{leave.days}} day(s)).\n\nReason: {{leave.reason}}",
    actionUrl: "/app/approvals",
  },
  leave_approved: {
    event: "leave.approved",
    channels: ["in_app", "email", "push"],
    subject: "Your leave has been approved",
    title: "Leave approved",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Your {{leave.type}} from {{leave.from}} to {{leave.to}} has been approved by {{approver.name}}.",
    actionUrl: "/me/leave",
  },
  leave_rejected: {
    event: "leave.rejected",
    channels: ["in_app", "email", "push"],
    subject: "Your leave request was not approved",
    title: "Leave rejected",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Your {{leave.type}} from {{leave.from}} to {{leave.to}} was not approved.\n\n" +
      "Reason: {{leave.rejectionReason}}",
    actionUrl: "/me/leave",
  },
  leave_cancelled: {
    event: "leave.cancelled",
    channels: ["in_app"],
    subject: "Leave request cancelled",
    title: "Leave cancelled",
    body: "{{employee.name}} cancelled their {{leave.type}} from {{leave.from}} to {{leave.to}}.",
    actionUrl: "/app/leave",
  },
  leave_starting_tomorrow: {
    event: "leave.starting_tomorrow",
    channels: ["in_app", "push"],
    subject: "{{employee.name}} is on leave tomorrow",
    title: "On leave tomorrow",
    body: "{{employee.name}} is on {{leave.type}} from {{leave.from}} to {{leave.to}}. Plan cover if you need to.",
    actionUrl: "/app/leave/calendar",
  },
  leave_balance_low: {
    event: "leave.balance_low",
    channels: ["in_app"],
    subject: "Your {{leave.type}} balance is running low",
    title: "Leave balance low",
    body: "You have {{leave.available}} day(s) of {{leave.type}} left this year.",
    actionUrl: "/me/leave",
  },
  comp_off_requested: {
    event: "leave.comp_off_requested",
    channels: ["in_app", "email"],
    subject: "Comp-off claim from {{employee.name}}",
    title: "Comp-off claim",
    body: "{{employee.name}} is claiming {{claim.days}} day(s) of compensatory off for working on {{claim.date}}.\n\nReason: {{claim.reason}}",
    actionUrl: "/app/approvals",
  },
  comp_off_decided: {
    event: "leave.comp_off_decided",
    channels: ["in_app", "push"],
    subject: "Your comp-off claim was {{claim.status}}",
    title: "Comp-off {{claim.status}}",
    body: "Your compensatory off claim for {{claim.date}} was {{claim.status}}.{{claim.note}}",
    actionUrl: "/me/leave",
  },
  encashment_requested: {
    event: "leave.encashment_requested",
    channels: ["in_app", "email"],
    subject: "Leave encashment request from {{employee.name}}",
    title: "Leave encashment request",
    body: "{{employee.name}} has asked to encash {{request.days}} day(s) of {{leave.type}}.",
    actionUrl: "/app/approvals",
  },
  encashment_decided: {
    event: "leave.encashment_decided",
    channels: ["in_app", "email", "push"],
    subject: "Your encashment request was {{request.status}}",
    title: "Encashment {{request.status}}",
    body: "Your request to encash {{request.days}} day(s) of {{leave.type}} was {{request.status}}.{{request.note}}",
    actionUrl: "/me/leave",
  },

  // ── Attendance ───────────────────────────────────────────────────────────
  attendance_late: {
    event: "attendance.late",
    channels: ["in_app"],
    subject: "You were marked late today",
    title: "Marked late",
    body:
      "You checked in at {{attendance.checkIn}} on {{attendance.date}}, which is {{attendance.lateBy}} " +
      "after your shift start of {{attendance.shiftStart}}.",
    actionUrl: "/me/attendance",
  },
  attendance_missing_punch: {
    event: "attendance.missing_punch",
    channels: ["in_app", "email", "push"],
    subject: "A punch is missing for {{attendance.date}}",
    title: "Missing punch",
    body:
      "We recorded a check-in but no check-out for {{attendance.date}}. " +
      "Raise a regularization request so your attendance is correct.",
    actionUrl: "/me/attendance",
  },
  absent_unmarked: {
    event: "attendance.absent",
    channels: ["in_app", "push"],
    subject: "You were marked absent on {{attendance.date}}",
    title: "Marked absent",
    body:
      "No attendance was recorded for you on {{attendance.date}}, so the day is marked absent. " +
      "If you were working, raise a correction before payroll closes.",
    actionUrl: "/me/attendance",
  },
  attendance_correction_requested: {
    event: "attendance.correction_requested",
    channels: ["in_app", "email"],
    subject: "Attendance correction from {{employee.name}}",
    title: "Attendance correction request",
    body: "{{employee.name}} has requested a correction for {{correction.date}}.\n\nReason: {{correction.reason}}",
    actionUrl: "/app/attendance/corrections",
  },
  attendance_correction_resolved: {
    event: "attendance.correction_resolved",
    channels: ["in_app", "push"],
    subject: "Your attendance correction was {{correction.status}}",
    title: "Correction {{correction.status}}",
    body: "Your correction request for {{correction.date}} was {{correction.status}}.",
    actionUrl: "/me/attendance",
  },
  overtime_approved: {
    event: "attendance.overtime_approved",
    channels: ["in_app", "push"],
    subject: "Overtime approved for {{attendance.date}}",
    title: "Overtime approved",
    body: "{{attendance.hours}} hour(s) of overtime on {{attendance.date}} have been approved and will be paid with your next salary.",
    actionUrl: "/me/attendance",
  },
  shift_assigned: {
    event: "shift.assigned",
    channels: ["in_app", "push"],
    subject: "Your shift has changed",
    title: "Shift assigned",
    body: "You are on the {{shift.name}} shift ({{shift.startTime}}–{{shift.endTime}}) from {{shift.from}} to {{shift.to}}.",
    actionUrl: "/me/attendance",
  },
  shift_swap_requested: {
    event: "shift.swap_requested",
    channels: ["in_app", "push"],
    subject: "{{employee.name}} wants to swap a shift with you",
    title: "Shift swap request",
    body: "{{employee.name}} has asked to swap their {{swap.fromShift}} on {{swap.date}} for your {{swap.toShift}}. Accept or decline from your attendance page.",
    actionUrl: "/me/attendance",
  },
  shift_swap_decided: {
    event: "shift.swap_decided",
    channels: ["in_app", "push"],
    subject: "Shift swap {{swap.status}}",
    title: "Shift swap {{swap.status}}",
    body: "The shift swap for {{swap.date}} was {{swap.status}}.",
    actionUrl: "/me/attendance",
  },
  holiday_tomorrow: {
    event: "holiday.tomorrow",
    channels: ["in_app", "push"],
    subject: "Tomorrow is a holiday: {{holiday.name}}",
    title: "Holiday tomorrow",
    body: "{{holiday.name}} is on {{holiday.date}}. Enjoy the day off.",
    actionUrl: "/me",
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  payslip_published: {
    event: "payroll.payslip_published",
    channels: ["in_app", "email", "push"],
    subject: "Your payslip for {{period.label}} is ready",
    title: "Payslip available",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Your payslip for {{period.label}} is now available in your Chefotech HRMS portal.",
    actionUrl: "/me/payslips",
  },
  payroll_completed: {
    event: "payroll.completed",
    channels: ["in_app", "email"],
    subject: "Payroll for {{period.label}} has been processed",
    title: "Payroll processed",
    body:
      "Payroll for {{period.label}} finished: {{run.employeeCount}} employees, " +
      "net payable {{run.netTotal}}.{{run.exceptionsNote}}",
    actionUrl: "/app/payroll",
  },
  payroll_run_approved: {
    event: "payroll.run_approved",
    channels: ["in_app"],
    subject: "Payroll for {{period.label}} was approved",
    title: "Payroll approved",
    body: "{{approver.name}} approved the payroll run for {{period.label}}. Payslips can now be published.",
    actionUrl: "/app/payroll",
  },
  payroll_cutoff_reminder: {
    event: "payroll.cutoff_reminder",
    channels: ["in_app", "email"],
    subject: "Payroll cut-off in {{days}} day(s)",
    title: "Payroll cut-off approaching",
    body:
      "Attendance for {{period.label}} closes in {{days}} day(s). " +
      "There are {{pending.corrections}} attendance correction(s) and {{pending.leave}} leave request(s) still waiting.",
    actionUrl: "/app/approvals",
  },
  salary_revised: {
    event: "payroll.salary_revised",
    channels: ["in_app", "email", "push"],
    subject: "Your compensation has been revised",
    title: "Salary revised",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Your compensation has been revised with effect from {{salary.effectiveFrom}}. " +
      "The details are in your documents.",
    actionUrl: "/me/documents",
  },
  loan_approved: {
    event: "payroll.loan_approved",
    channels: ["in_app", "email", "push"],
    subject: "Your {{loan.type}} has been approved",
    title: "{{loan.type}} approved",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Your {{loan.type}} of {{loan.amount}} has been approved. {{loan.installments}} instalment(s) of {{loan.installmentAmount}} will be deducted from your salary starting {{loan.startPeriod}}.",
    actionUrl: "/me/payslips",
  },
  loan_installment: {
    event: "payroll.loan_installment",
    channels: ["in_app"],
    subject: "Loan instalment deducted",
    title: "Instalment deducted",
    body: "{{loan.installmentAmount}} was deducted for your {{loan.type}} this period. {{loan.remaining}} remaining.",
    actionUrl: "/me/payslips",
  },
  expense_submitted: {
    event: "expense.submitted",
    channels: ["in_app", "email"],
    subject: "Expense claim from {{employee.name}}: {{claim.amount}}",
    title: "Expense claim",
    body: "{{employee.name}} submitted an expense claim for {{claim.amount}} — {{claim.title}}.",
    actionUrl: "/app/approvals",
  },
  expense_decided: {
    event: "expense.decided",
    channels: ["in_app", "email", "push"],
    subject: "Your expense claim was {{claim.status}}",
    title: "Expense claim {{claim.status}}",
    body: "Your claim for {{claim.amount}} ({{claim.title}}) was {{claim.status}}.{{claim.note}}",
    actionUrl: "/me/expenses",
  },
  expense_reimbursed: {
    event: "expense.reimbursed",
    channels: ["in_app", "push"],
    subject: "Expense reimbursed: {{claim.amount}}",
    title: "Expense reimbursed",
    body: "{{claim.amount}} for {{claim.title}} {{claim.how}}.",
    actionUrl: "/me/expenses",
  },

  // ── Documents and employees ──────────────────────────────────────────────
  document_expiring: {
    event: "document.expiring",
    channels: ["in_app", "email"],
    subject: "{{document.name}} expires in {{document.daysLeft}} days",
    title: "Document expiring",
    body:
      "{{document.name}} for {{employee.name}} expires on {{document.expiresOn}} " +
      "({{document.daysLeft}} days from now).",
    actionUrl: "/app/employees/{{employee.id}}",
  },
  document_uploaded: {
    event: "document.uploaded",
    channels: ["in_app"],
    subject: "{{employee.name}} uploaded a document",
    title: "Document to review",
    body: "{{employee.name}} uploaded {{document.name}} ({{document.category}}). It is waiting for verification.",
    actionUrl: "/app/employees/{{employee.id}}",
  },
  document_reviewed: {
    event: "document.reviewed",
    channels: ["in_app", "push"],
    subject: "Your document was {{document.status}}",
    title: "Document {{document.status}}",
    body: "{{document.name}} was {{document.status}}.{{document.note}}",
    actionUrl: "/me/documents",
  },
  document_generated: {
    event: "document.generated",
    channels: ["in_app", "email", "push"],
    subject: "A new document has been shared with you",
    title: "New document",
    body: "Hi {{employee.firstName}},\n\n{{document.name}} has been added to your documents.",
    actionUrl: "/me/documents",
  },
  document_acknowledgement_requested: {
    event: "document.acknowledgement_requested",
    channels: ["in_app", "email", "push"],
    subject: "Please acknowledge: {{document.name}}",
    title: "Acknowledgement needed",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Please read and acknowledge {{document.name}}.{{document.dueNote}}",
    actionUrl: "/me/documents",
  },
  document_request: {
    event: "document.requested",
    channels: ["in_app", "email", "push"],
    subject: "Please upload: {{request.name}}",
    title: "Document requested",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "{{request.requestedBy}} has asked you to upload {{request.name}}.{{request.dueNote}}\n\n{{request.note}}",
    actionUrl: "/me/documents",
  },
  employee_joined: {
    event: "employee.joined",
    channels: ["in_app"],
    subject: "{{employee.name}} joins today",
    title: "New joiner",
    body: "{{employee.name}} joins {{employee.department}} as {{employee.designation}} today.",
    actionUrl: "/app/employees/{{employee.id}}",
  },
  birthday_today: {
    event: "employee.birthday",
    channels: ["in_app"],
    subject: "Birthdays today",
    title: "Birthdays today",
    body: "{{names}} — wish them a happy birthday.",
    actionUrl: "/app/employees",
  },
  birthday_greeting: {
    event: "employee.birthday_greeting",
    channels: ["in_app", "push"],
    subject: "Happy birthday, {{employee.firstName}}!",
    title: "Happy birthday!",
    body: "Everyone at {{company.name}} wishes you a wonderful birthday, {{employee.firstName}}.",
    actionUrl: "/me",
  },
  work_anniversary: {
    event: "employee.work_anniversary",
    channels: ["in_app", "push"],
    subject: "Happy work anniversary, {{employee.firstName}}!",
    title: "{{years}} year(s) with {{company.name}}",
    body: "Today marks {{years}} year(s) since you joined {{company.name}}. Thank you for everything you do.",
    actionUrl: "/me",
  },
  probation_ending: {
    event: "employee.probation_ending",
    channels: ["in_app", "email"],
    subject: "{{employee.name}}: probation ends {{probation.when}}",
    title: "Probation review due",
    body:
      "{{employee.name}} ({{employee.designation}}) completes probation on {{probation.endsOn}}. " +
      "Confirm their employment, extend probation, or record a decision before then.",
    actionUrl: "/app/employees/{{employee.id}}",
  },
  employee_confirmed: {
    event: "employee.confirmed",
    channels: ["in_app", "email", "push"],
    subject: "Your employment has been confirmed",
    title: "Employment confirmed",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Congratulations — your employment with {{company.name}} is confirmed with effect from {{confirmation.date}}.",
    actionUrl: "/me/documents",
  },
  exit_initiated: {
    event: "employee.exit_initiated",
    channels: ["in_app", "email"],
    subject: "{{employee.name}} is leaving: last day {{exit.lastWorkingDay}}",
    title: "Exit initiated",
    body:
      "{{employee.name}} ({{employee.designation}}, {{employee.department}}) is leaving. " +
      "Exit type: {{exit.type}}. Last working day: {{exit.lastWorkingDay}}.",
    actionUrl: "/app/employees/{{employee.id}}",
  },
  resignation_submitted: {
    event: "employee.resignation_submitted",
    channels: ["in_app", "email"],
    subject: "Resignation from {{employee.name}}",
    title: "Resignation submitted",
    body:
      "{{employee.name}} has submitted their resignation. Proposed last working day: {{resignation.proposedLastDay}}.\n\n" +
      "Reason: {{resignation.reason}}",
    actionUrl: "/app/approvals",
  },
  resignation_decided: {
    event: "employee.resignation_decided",
    channels: ["in_app", "email", "push"],
    subject: "Your resignation has been {{resignation.status}}",
    title: "Resignation {{resignation.status}}",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Your resignation has been {{resignation.status}}.{{resignation.note}}",
    actionUrl: "/me/profile",
  },
  employee_transferred: {
    event: "employee.transferred",
    channels: ["in_app", "email", "push"],
    subject: "Your transfer is effective from {{movement.effectiveFrom}}",
    title: "Transfer",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "From {{movement.effectiveFrom}} you move to {{movement.summary}}.",
    actionUrl: "/me/profile",
  },
  employee_promoted: {
    event: "employee.promoted",
    channels: ["in_app", "email", "push"],
    subject: "Congratulations on your promotion",
    title: "Promotion",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Congratulations — you are promoted to {{movement.toDesignation}} with effect from {{movement.effectiveFrom}}.",
    actionUrl: "/me/documents",
  },
  bank_details_changed: {
    event: "employee.bank_details_changed",
    channels: ["email"],
    subject: "Your bank details were changed",
    title: "Bank details changed",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "The bank account used for your salary was changed on {{when}} by {{actor.name}}. " +
      "New account ending {{bank.last4}} at {{bank.bankName}}.\n\n" +
      "If you did not expect this, contact HR immediately.",
  },
  onboarding_task_assigned: {
    event: "employee.onboarding_task",
    channels: ["in_app", "email"],
    subject: "Joining task: {{task.title}}",
    title: "Joining task assigned",
    body: "{{task.title}} for {{employee.name}} is assigned to you.{{task.dueNote}}",
    actionUrl: "/app/employees/{{employee.id}}",
  },
  exit_task_assigned: {
    event: "employee.exit_task",
    channels: ["in_app", "email"],
    subject: "Exit clearance: {{task.title}}",
    title: "Exit clearance task",
    body: "{{task.title}} for {{employee.name}} (leaving {{exit.lastWorkingDay}}) is assigned to you.",
    actionUrl: "/app/employees/{{employee.id}}",
  },

  // ── Workflow ─────────────────────────────────────────────────────────────
  approval_pending: {
    event: "workflow.approval_pending",
    channels: ["in_app", "email", "push"],
    subject: "{{request.type}} awaiting your approval",
    title: "Approval needed",
    body: "{{request.requesterName}} raised a {{request.type}} that needs your approval.",
    actionUrl: "{{request.url}}",
  },
  approval_escalated: {
    event: "workflow.escalated",
    channels: ["in_app", "email"],
    subject: "An approval has been escalated to you",
    title: "Escalated approval",
    body:
      "A {{request.type}} from {{request.requesterName}} has been waiting for " +
      "{{request.pendingDays}} days and has been escalated to you.",
    actionUrl: "{{request.url}}",
  },
  request_submitted: {
    event: "request.submitted",
    channels: ["in_app", "email", "push"],
    subject: "{{request.type}} request from {{employee.name}}",
    title: "Request to decide",
    body: "{{employee.name}} asks: {{request.summary}}.{{request.reasonNote}}",
    actionUrl: "/app/requests",
  },
  request_approved: {
    event: "workflow.approved",
    channels: ["in_app", "push"],
    subject: "Your {{request.type}} was approved",
    title: "{{request.type}} approved",
    body: "Your {{request.type}} ({{request.label}}) has been approved.{{request.note}}{{request.effectNote}}",
    actionUrl: "/me/requests",
  },
  request_rejected: {
    event: "workflow.rejected",
    channels: ["in_app", "push"],
    subject: "Your {{request.type}} was not approved",
    title: "{{request.type}} rejected",
    body: "Your {{request.type}} ({{request.label}}) was not approved.{{request.reasonNote}}",
    actionUrl: "/me/requests",
  },
  loan_requested: {
    event: "payroll.loan_requested",
    channels: ["in_app", "email"],
    subject: "{{loan.type}} request from {{employee.name}}: {{loan.amount}}",
    title: "Loan request",
    body: "{{employee.name}} has asked for a {{loan.type}} of {{loan.amount}} over {{loan.installments}} instalment(s).\n\nPurpose: {{loan.purpose}}",
    actionUrl: "/app/loans",
  },
  loan_rejected: {
    event: "payroll.loan_rejected",
    channels: ["in_app", "email", "push"],
    subject: "Your {{loan.type}} request was not approved",
    title: "{{loan.type}} not approved",
    body: "Hi {{employee.firstName}},\n\nYour {{loan.type}} request of {{loan.amount}} was not approved.{{loan.note}}",
    actionUrl: "/me/loans",
  },

  // ── Help desk ────────────────────────────────────────────────────────────
  ticket_created: {
    event: "ticket.created",
    channels: ["in_app", "email"],
    subject: "New ticket #{{ticket.number}}: {{ticket.subject}}",
    title: "New ticket",
    body: "{{ticket.requester}} raised a {{ticket.category}} ticket: {{ticket.subject}}.\n\n{{ticket.preview}}",
    actionUrl: "/app/tickets",
  },
  ticket_assigned: {
    event: "ticket.assigned",
    channels: ["in_app", "email", "push"],
    subject: "Ticket #{{ticket.number}} assigned to you",
    title: "Ticket assigned",
    body: "{{ticket.subject}} ({{ticket.priority}} priority) has been assigned to you.",
    actionUrl: "/app/tickets",
  },
  ticket_commented: {
    event: "ticket.commented",
    channels: ["in_app", "email", "push"],
    subject: "Reply on ticket #{{ticket.number}}: {{ticket.subject}}",
    title: "New reply on your ticket",
    body: "{{comment.author}} replied:\n\n{{comment.preview}}",
    actionUrl: "/me/tickets",
  },
  ticket_resolved: {
    event: "ticket.resolved",
    channels: ["in_app", "email", "push"],
    subject: "Ticket #{{ticket.number}} resolved",
    title: "Ticket resolved",
    body: "Your ticket {{ticket.subject}} has been marked {{ticket.status}}.{{ticket.note}}",
    actionUrl: "/me/tickets",
  },
  ticket_waiting: {
    event: "ticket.waiting",
    channels: ["in_app", "email", "push"],
    subject: "Ticket #{{ticket.number}} needs something from you",
    title: "Your reply is needed",
    body: "The help desk needs more information on {{ticket.subject}} before it can continue.{{ticket.note}}",
    actionUrl: "/me/tickets",
  },

  // ── Surveys ──────────────────────────────────────────────────────────────
  survey_opened: {
    event: "survey.opened",
    channels: ["in_app", "email", "push"],
    subject: "A quick survey: {{survey.title}}",
    title: "Your opinion is wanted",
    body: "{{survey.title}} is open.{{survey.closes}}{{survey.anonymous}} It takes a couple of minutes.",
    actionUrl: "/me/surveys",
  },
  survey_reminder: {
    event: "survey.reminder",
    channels: ["in_app", "push"],
    subject: "Reminder: {{survey.title}}",
    title: "Still waiting on your answers",
    body: "{{survey.title}} has not been answered yet.{{survey.closes}}",
    actionUrl: "/me/surveys",
  },
  survey_closed: {
    event: "survey.closed",
    channels: ["in_app", "email"],
    subject: "Survey closed: {{survey.title}}",
    title: "Results are ready",
    body: "{{survey.title}} has closed with {{survey.responded}} of {{survey.invited}} responses ({{survey.rate}}%).",
    actionUrl: "/app/surveys",
  },

  // ── Performance ──────────────────────────────────────────────────────────
  goal_assigned: {
    event: "performance.goal_assigned",
    channels: ["in_app", "email", "push"],
    subject: "A new goal: {{goal.title}}",
    title: "A goal was set for you",
    body: "{{actor.name}} set the goal \"{{goal.title}}\".{{goal.due}} Track your progress on it as you go.",
    actionUrl: "/me/performance",
  },
  review_self_due: {
    event: "performance.review_started",
    channels: ["in_app", "email", "push"],
    subject: "{{cycle.name}}: your self-review is open",
    title: "Time for your self-review",
    body: "{{cycle.name}} has started. Write up your own view of the period first; your manager reviews after.{{cycle.due}}",
    actionUrl: "/me/performance",
  },
  review_self_submitted: {
    event: "performance.self_submitted",
    channels: ["in_app", "push"],
    subject: "{{employee.name}} finished their self-review",
    title: "A self-review is in",
    body: "{{employee.name}} has submitted their self-review for {{cycle.name}}. Their manager review is ready for you.",
    actionUrl: "/app/performance",
  },
  review_manager_due: {
    event: "performance.manager_review_due",
    channels: ["in_app", "email", "push"],
    subject: "{{cycle.name}}: {{count}} {{people}} to review",
    title: "Reviews are waiting for you",
    body: "You have {{count}} {{people}} to review in {{cycle.name}}.{{cycle.due}}",
    actionUrl: "/app/performance",
  },
  review_completed: {
    event: "performance.review_completed",
    channels: ["in_app", "email", "push"],
    subject: "Your {{cycle.name}} review is ready",
    title: "Your review is complete",
    body: "Your manager has completed your review for {{cycle.name}}. Read it, add a comment if you like, and acknowledge it.",
    actionUrl: "/me/performance",
  },

  // ── Assets ───────────────────────────────────────────────────────────────
  asset_assigned: {
    event: "asset.assigned",
    channels: ["in_app", "email", "push"],
    subject: "{{asset.name}} has been assigned to you",
    title: "Asset assigned",
    body: "{{asset.name}} ({{asset.tag}}) is now in your care.{{asset.returnNote}}",
    actionUrl: "/me/assets",
  },
  asset_return_due: {
    event: "asset.return_due",
    channels: ["in_app", "push"],
    subject: "{{asset.name}} is due back on {{asset.dueDate}}",
    title: "Asset return due",
    body: "Please return {{asset.name}} ({{asset.tag}}) by {{asset.dueDate}}.",
    actionUrl: "/me/assets",
  },

  // ── Announcements and digests ────────────────────────────────────────────
  announcement: {
    event: "announcement",
    channels: ["in_app", "email", "push"],
    subject: "{{title}}",
    title: "{{title}}",
    body: "{{message}}",
    actionUrl: "/me/notifications",
  },
  daily_digest: {
    event: "notification.digest",
    channels: ["email"],
    subject: "Your day at {{company.name}} — {{digest.dateLabel}}",
    title: "Your morning summary",
    body: "{{digest.body}}",
    actionUrl: "/app/approvals",
  },
};

const TEMPLATE_KEYS = Object.keys(TEMPLATES);

/** Resolve {{a.b.c}} placeholders. Unknown paths render as an empty string. */
function render(text, data) {
  if (!text) return "";
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = path.split(".").reduce((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      return acc[key];
    }, data);
    return value === null || value === undefined ? "" : String(value);
  });
}

/** Every placeholder a template uses — powers the "available variables" hint. */
function variablesIn(template) {
  const found = new Set();
  for (const field of ["subject", "title", "body", "actionUrl"]) {
    const text = template[field];
    if (!text) continue;
    for (const m of String(text).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
  }
  return [...found];
}

/** Human labels for the settings screen, grouped the way people think. */
const GROUPS = [
  { key: "account", label: "Account and security", prefixes: ["account"] },
  { key: "leave", label: "Leave", prefixes: ["leave"] },
  { key: "attendance", label: "Attendance and shifts", prefixes: ["attendance", "shift", "holiday"] },
  { key: "payroll", label: "Payroll, expenses and loans", prefixes: ["payroll", "expense", "loan"] },
  { key: "employee", label: "People and documents", prefixes: ["employee", "document", "onboarding", "exit", "performance", "survey"] },
  { key: "workflow", label: "Approvals and requests", prefixes: ["workflow", "request"] },
  { key: "ticket", label: "Help desk and assets", prefixes: ["ticket", "asset"] },
  { key: "announcement", label: "Announcements and digests", prefixes: ["announcement", "notification"] },
];

function groupOf(event) {
  const prefix = String(event).split(".")[0];
  const group = GROUPS.find((g) => g.prefixes.includes(prefix));
  return group ? group.key : "other";
}

module.exports = { TEMPLATES, TEMPLATE_KEYS, GROUPS, render, variablesIn, groupOf };
