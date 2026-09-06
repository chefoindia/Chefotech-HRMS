"use strict";

const express = require("express");

/**
 * API surface, organized by domain.
 *
 * Mounting happens in one place so the whole route tree is readable at a
 * glance — there is no route registration hidden inside a service or a
 * conditional halfway down a 2000-line server file.
 */
function buildRoutes() {
  const router = express.Router();

  router.use("/auth", require("./modules/auth/auth.routes"));
  router.use("/organizations", require("./modules/organizations/organization.routes"));
  router.use("/settings", require("./modules/settings/settings.routes"));
  router.use("/users", require("./modules/users/user.routes"));
  router.use("/roles", require("./modules/rbac/rbac.routes"));
  router.use("/files", require("./modules/files/file.routes"));

  router.use("/departments", require("./modules/departments/department.routes"));
  router.use("/designations", require("./modules/designations/designation.routes"));
  router.use("/locations", require("./modules/locations/location.routes"));
  router.use("/employees", require("./modules/employees/employee.routes"));

  router.use("/shifts", require("./modules/shifts/shift.routes"));
  router.use("/holidays", require("./modules/holidays/holiday.routes"));
  router.use("/attendance", require("./modules/attendance/attendance.routes"));
  router.use("/biometric", require("./modules/biometric/biometric.routes"));
  router.use("/leave", require("./modules/leave/leave.routes"));
  router.use("/workflows", require("./modules/workflow/workflow.routes"));
  router.use("/payroll", require("./modules/payroll/payroll.routes"));
  router.use("/documents", require("./modules/documents/document.routes"));
  router.use("/sheets", require("./modules/documents/sheet.routes"));
  router.use("/requests", require("./modules/requests/request.routes"));
  router.use("/tickets", require("./modules/tickets/ticket.routes"));
  router.use("/expenses", require("./modules/expenses/expense.routes"));
  router.use("/assets", require("./modules/assets/asset.routes"));
  router.use("/loans", require("./modules/loans/loan.routes"));
  router.use("/exits", require("./modules/exits/exit.routes"));
  router.use("/onboarding", require("./modules/onboarding/onboarding.routes"));
  router.use("/integrations", require("./modules/integrations/integration.routes"));
  router.use("/surveys", require("./modules/surveys/survey.routes"));
  router.use("/performance", require("./modules/performance/performance.routes"));
  router.use("/reports", require("./modules/reports/report.routes"));
  router.use("/notifications", require("./modules/notifications/notification.routes"));
  router.use("/dashboard", require("./modules/dashboard/dashboard.routes"));
  router.use("/audit", require("./modules/audit/audit.routes"));
  router.use("/help", require("./modules/help/help.routes"));
  router.use("/ai", require("./modules/ai/ai.routes"));

  // Chefotech's own control plane. Tenant users get a 404 here, not a 403 —
  // the existence of these routes is not something a customer needs to learn.
  router.use("/platform", require("./modules/superadmin/superadmin.routes"));

  // Unauthenticated marketing/public data (plans, org branding by slug).
  router.use("/public", require("./modules/organizations/public.routes"));
  // Public contact / demo requests. Unauthenticated by design; rate limited
  // and honeypotted inside the router.
  router.use("/contact", require("./modules/organizations/contact.routes"));

  return router;
}

module.exports = buildRoutes;
