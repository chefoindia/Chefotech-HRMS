"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const tenant = require("../../src/core/tenancy/tenantContext");
const { createApp } = require("../../src/app");
const User = require("../../src/modules/users/user.model");
const Employee = require("../../src/modules/employees/employee.model");
const Membership = require("../../src/modules/rbac/membership.model");
const Role = require("../../src/modules/rbac/role.model");
const organizationService = require("../../src/modules/organizations/organization.service");
const rbac = require("../../src/modules/rbac/rbac.service");
const { AttendanceRecord } = require("../../src/modules/attendance/attendance.model");
const PayrollInput = require("../../src/modules/payroll/payrollInput.model");
const payrollService = require("../../src/modules/payroll/payroll.service");
const dt = require("../../src/shared/datetime");

/**
 * The employee-facing modules over real HTTP: requests (with the manager
 * approving and the effect landing in attendance and payroll), the help
 * desk, expense claims through to reimbursement, assets with acknowledgement
 * and recovery, and loans recovered by a payroll run.
 *
 * The thread running through all of them is payroll inputs: every module
 * that puts money on a payslip files one, and one run applies them all.
 */

let server;
let baseUrl;
const state = {};

test.before(async () => {
  await startDatabase();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await stopDatabase();
});

test.beforeEach(async () => {
  await clearDatabase();
  rbac.invalidateOrganization("*");

  const owner = await createUser("hr@modules.test", "Asha", "Menon");
  const { organization } = await organizationService.provision({ name: "Modules Co", ownerUserId: owner._id });
  state.organizationId = organization._id;

  await tenant.runWithTenant(organization._id, async () => {
    const managerRole = await Role.findOne({ key: "MANAGER" });
    const employeeRole = await Role.findOne({ key: "EMPLOYEE" });

    const managerUser = await createUser("manager@modules.test", "Bala", "Iyer");
    state.manager = await Employee.create({ employeeCode: "M001", personal: { firstName: "Bala", lastName: "Iyer", workEmail: "manager@modules.test" }, employment: { joiningDate: new Date("2023-01-01") }, status: "active", userId: managerUser._id });
    await Membership.create({ organizationId: organization._id, userId: managerUser._id, employeeId: state.manager._id, roleIds: [managerRole._id], permissions: managerRole.permissions, status: "active", isManager: true });

    const employeeUser = await createUser("ravi@modules.test", "Ravi", "Kumar");
    state.employee = await Employee.create({ employeeCode: "E001", personal: { firstName: "Ravi", lastName: "Kumar", workEmail: "ravi@modules.test" }, employment: { joiningDate: new Date("2024-02-01"), managerId: state.manager._id }, status: "active", userId: employeeUser._id });
    await Membership.create({ organizationId: organization._id, userId: employeeUser._id, employeeId: state.employee._id, roleIds: [employeeRole._id], permissions: employeeRole.permissions, status: "active" });
  });

  state.hr = await signIn("hr@modules.test");
  state.mgr = await signIn("manager@modules.test");
  state.emp = await signIn("ravi@modules.test");
});

async function createUser(email, firstName, lastName) {
  const user = new User({ email, firstName, lastName, status: "active", emailVerifiedAt: new Date() });
  await user.setPassword("Password@12345");
  await user.save();
  return user;
}

async function signIn(email) {
  const response = await api("POST", "/auth/login", { body: { email, password: "Password@12345" } });
  assert.equal(response.status, 200, `sign-in failed for ${email}: ${JSON.stringify(response.body)}`);
  return response.body.data.accessToken;
}

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

function thisPeriod() {
  return dt.todayString().slice(0, 7);
}

/** Salary plumbing so a run can process: one fixed component, one structure, one assignment. */
async function setUpSalary(employeeId) {
  const component = await api("POST", "/payroll/components", { token: state.hr, body: { name: "Basic", code: "BASIC", type: "earning", calculation: { method: "fixed", amount: 30000 } } });
  assert.equal(component.status, 201, JSON.stringify(component.body));
  const structure = await api("POST", "/payroll/structures", { token: state.hr, body: { name: "Standard", code: "STD", components: [{ componentId: component.body.data.id }] } });
  assert.equal(structure.status, 201, JSON.stringify(structure.body));
  const salary = await api("POST", `/payroll/salary/${employeeId}`, { token: state.hr, body: { structureId: structure.body.data.id, effectiveFrom: "2024-02-01", ctcAnnual: 360000 } });
  assert.equal(salary.status, 201, JSON.stringify(salary.body));
}

async function runPayroll() {
  const [year, month] = thisPeriod().split("-").map(Number);
  const run = await api("POST", "/payroll/runs", { token: state.hr, body: { year, month } });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  const processed = await tenant.runWithTenant(state.organizationId, () => payrollService.processRun(run.body.data.id), { userId: null });
  assert.equal(processed.status, "processed", JSON.stringify(processed.exceptions));
  const items = await api("GET", `/payroll/runs/${run.body.data.id}/items`, { token: state.hr });
  assert.equal(items.status, 200);
  return { run: run.body.data, items: items.body.data };
}

// ── Requests ────────────────────────────────────────────────────────────────

test("a work-from-home request goes to the manager, and approval marks the days in attendance", async () => {
  const types = await api("GET", "/requests/types", { token: state.emp });
  assert.ok(types.body.data.some((t) => t.key === "wfh"));

  const from = dt.addDays(dt.todayString(), 7);
  const to = dt.addDays(from, 1);
  const submitted = await api("POST", "/requests", { token: state.emp, body: { type: "wfh", payload: { fromDate: from, toDate: to }, reason: "Plumber visit" } });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  assert.equal(submitted.body.data.status, "pending");
  assert.match(submitted.body.data.summary, /Work from home/);

  const duplicate = await api("POST", "/requests", { token: state.emp, body: { type: "wfh", payload: { fromDate: from, toDate: to } } });
  assert.equal(duplicate.status, 409, "an identical pending request is refused");

  const bad = await api("POST", "/requests", { token: state.emp, body: { type: "wfh", payload: { fromDate: to, toDate: from } } });
  assert.equal(bad.status, 422, "the type's schema is enforced");

  const selfApprove = await api("POST", `/requests/${submitted.body.data.id}/decide`, { token: state.emp, body: { decision: "approve" } });
  assert.equal(selfApprove.status, 403, "the requester is not an approver");

  const queue = await api("GET", "/requests", { token: state.mgr, query: {} });
  const mine = await api("GET", "/requests?scope=to_approve", { token: state.mgr });
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.data.length, 1, "the manager sees it in their queue");
  void queue;

  const approved = await api("POST", `/requests/${submitted.body.data.id}/decide`, { token: state.mgr, body: { decision: "approve", comment: "Fine" } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.status, "completed", "approval applies the effect immediately");
  assert.deepEqual(approved.body.data.effect.markedDates, [from, to]);

  await tenant.runWithTenant(state.organizationId, async () => {
    const record = await AttendanceRecord.findOne({ employeeId: state.employee._id, date: from }).lean();
    assert.ok(record, "an attendance record exists for the day");
    assert.equal(record.status, "work_from_home");
  });

  const employeeView = await api("GET", "/requests?scope=mine", { token: state.emp });
  assert.equal(employeeView.body.data[0].decidedBy, "Bala Iyer");
});

test("an advance request approved by HR files a payroll deduction; a withdrawn request files nothing", async () => {
  const first = await api("POST", "/requests", { token: state.emp, body: { type: "advance", payload: { amount: 5000 }, reason: "Festival" } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const withdrawn = await api("POST", `/requests/${first.body.data.id}/cancel`, { token: state.emp });
  assert.equal(withdrawn.body.data.status, "cancelled");

  const second = await api("POST", "/requests", { token: state.emp, body: { type: "advance", payload: { amount: 5000 } } });
  const managerTry = await api("POST", `/requests/${second.body.data.id}/decide`, { token: state.mgr, body: { decision: "approve" } });
  assert.equal(managerTry.status, 200, "a manager holding request.approve may decide HR-owned types too");
  assert.equal(managerTry.body.data.status, "completed");

  await tenant.runWithTenant(state.organizationId, async () => {
    const inputs = await PayrollInput.find({ employeeId: state.employee._id, "source.type": "advance" }).lean();
    assert.equal(inputs.length, 1, "exactly one recovery is filed");
    assert.equal(inputs[0].type, "deduction");
    assert.equal(inputs[0].amount, 5000);
    assert.equal(inputs[0].status, "pending");
  });
});

// ── Help desk ───────────────────────────────────────────────────────────────

test("a ticket is raised, assigned, discussed (with a private note), resolved and rated", async () => {
  const created = await api("POST", "/tickets", { token: state.emp, body: { subject: "Laptop will not charge", description: "Since Monday", category: "it", priority: "high" } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.number, 1);
  assert.ok(created.body.data.dueAt, "an SLA due time is set from the priority");

  const stats = await api("GET", "/tickets/stats", { token: state.hr });
  assert.equal(stats.body.data.unassigned, 1);
  const employeeStats = await api("GET", "/tickets/stats", { token: state.emp });
  assert.equal(employeeStats.status, 403, "only agents see the queue numbers");

  const agents = await api("GET", "/tickets/agents", { token: state.hr });
  const me = agents.body.data.find((a) => a.email === "hr@modules.test");
  const assigned = await api("PATCH", `/tickets/${created.body.data.id}`, { token: state.hr, body: { assigneeUserId: me.id, status: "in_progress" } });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.data.assignee.email, "hr@modules.test");

  const note = await api("POST", `/tickets/${created.body.data.id}/comments`, { token: state.hr, body: { body: "Battery swollen, order a replacement", internal: true } });
  assert.equal(note.status, 200);
  const reply = await api("POST", `/tickets/${created.body.data.id}/comments`, { token: state.hr, body: { body: "We are ordering a new battery." } });
  assert.equal(reply.status, 200);

  const asEmployee = await api("GET", `/tickets/${created.body.data.id}`, { token: state.emp });
  assert.equal(asEmployee.body.data.comments.length, 1, "the internal note is invisible to the requester");
  assert.equal(asEmployee.body.data.comments[0].body, "We are ordering a new battery.");
  const employeeNote = await api("POST", `/tickets/${created.body.data.id}/comments`, { token: state.emp, body: { body: "sneaky", internal: true } });
  assert.equal(employeeNote.status, 403);

  const resolved = await api("PATCH", `/tickets/${created.body.data.id}`, { token: state.hr, body: { status: "resolved", resolutionNote: "Battery replaced" } });
  assert.equal(resolved.body.data.status, "resolved");

  const closed = await api("POST", `/tickets/${created.body.data.id}/close`, { token: state.emp, body: { rating: 5, ratingComment: "Quick" } });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.data.status, "closed");
  assert.equal(closed.body.data.rating, 5);

  const after = await api("GET", "/tickets/stats", { token: state.hr });
  assert.equal(after.body.data.averageRating, 5);
  assert.equal(after.body.data.resolvedThisWeek, 1);

  const other = await api("GET", `/tickets/${created.body.data.id}`, { token: state.mgr });
  assert.equal(other.status, 404, "another employee cannot read somebody else's ticket");
});

// ── Expenses, assets, loans and the payroll run that settles them ───────────

test("claims, asset recoveries and loan instalments all land on one payroll run", async () => {
  await setUpSalary(state.employee._id);

  // Expense: submitted under policy, trimmed by the manager, paid via payroll.
  await tenant.runWithTenant(state.organizationId, () => require("../../src/core/settings/settings.service").set("expense.receipt_required_above", 1000));
  const overLimit = await api("POST", "/expenses", { token: state.emp, body: { title: "Client visit", lines: [{ date: dt.todayString(), category: "travel", amount: 1800 }], submit: true } });
  assert.equal(overLimit.status, 422, "a receipt is required above the threshold");

  const claim = await api("POST", "/expenses", { token: state.emp, body: { title: "Client visit", purpose: "Pune", lines: [{ date: dt.todayString(), category: "travel", amount: 800 }, { date: dt.todayString(), category: "food", amount: 300 }], submit: true } });
  assert.equal(claim.status, 201, JSON.stringify(claim.body));
  assert.equal(claim.body.data.status, "submitted");
  assert.equal(claim.body.data.total, 1100);

  const own = await api("POST", `/expenses/${claim.body.data.id}/decide`, { token: state.emp, body: { decision: "approve" } });
  assert.equal(own.status, 403);
  const approved = await api("POST", `/expenses/${claim.body.data.id}/decide`, { token: state.mgr, body: { decision: "approve", approvedTotal: 1000, comment: "Food capped" } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.approvedTotal, 1000);

  const employeePay = await api("POST", `/expenses/${claim.body.data.id}/reimburse`, { token: state.mgr, body: { method: "payroll" } });
  assert.equal(employeePay.status, 403, "a manager cannot mark claims paid");
  const paid = await api("POST", `/expenses/${claim.body.data.id}/reimburse`, { token: state.hr, body: { method: "payroll" } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.data.status, "reimbursed");
  assert.equal(paid.body.data.reimbursement.viaPayroll, true);

  // Asset: assigned, acknowledged, returned damaged with a recovery.
  const asset = await api("POST", "/assets", { token: state.hr, body: { name: "ThinkPad", category: "laptop", serialNumber: "SN1", purchaseCost: 60000 } });
  assert.equal(asset.status, 201, JSON.stringify(asset.body));
  assert.match(asset.body.data.tag, /^LT-0001$/);
  const assigned = await api("POST", `/assets/${asset.body.data.id}/assign`, { token: state.hr, body: { employeeId: String(state.employee._id), expectedReturnOn: dt.addDays(dt.todayString(), 30) } });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.data.status, "assigned");
  const mine = await api("GET", "/assets/me", { token: state.emp });
  assert.equal(mine.body.data.length, 1);
  const ack = await api("POST", `/assets/assignments/${mine.body.data[0].id}/acknowledge`, { token: state.emp, body: { name: "Ravi Kumar" } });
  assert.equal(ack.status, 200);
  const otherAck = await api("POST", `/assets/assignments/${mine.body.data[0].id}/acknowledge`, { token: state.mgr, body: {} });
  assert.equal(otherAck.status, 403, "only the holder can acknowledge");
  const returned = await api("POST", `/assets/${asset.body.data.id}/return`, { token: state.hr, body: { condition: "damaged", notes: "Cracked screen", recoveryAmount: 2500, newStatus: "in_repair" } });
  assert.equal(returned.status, 200, JSON.stringify(returned.body));
  assert.equal(returned.body.data.status, "in_repair");
  assert.equal(returned.body.data.history[0].recoveryAmount, 2500);
  assert.equal(returned.body.data.history[0].acknowledgedName, "Ravi Kumar");

  // Loan: recorded by HR, disbursed, three instalments from this month.
  const loan = await api("POST", `/loans/employee/${state.employee._id}`, { token: state.hr, body: { principal: 9000, instalments: 3, startPeriod: thisPeriod(), purpose: "Bike" } });
  assert.equal(loan.status, 201, JSON.stringify(loan.body));
  assert.equal(loan.body.data.status, "approved");
  assert.equal(loan.body.data.instalmentAmount, 3000);
  const disbursed = await api("POST", `/loans/${loan.body.data.id}/disburse`, { token: state.hr, body: { via: "bank_transfer", reference: "UTR123" } });
  assert.equal(disbursed.status, 200, JSON.stringify(disbursed.body));
  assert.equal(disbursed.body.data.status, "active");
  const detail = await api("GET", `/loans/${loan.body.data.id}`, { token: state.emp });
  assert.equal(detail.status, 200, "the borrower can see their own loan");
  assert.equal(detail.body.data.schedule.length, 3);
  assert.equal(detail.body.data.outstanding, 9000);

  const second = await api("POST", "/loans", { token: state.emp, body: { principal: 1000, instalments: 1 } });
  assert.equal(second.status, 409, "one open loan at a time by default");

  // The queue of inputs, as finance sees it.
  const queued = await api("GET", "/payroll/inputs?status=pending", { token: state.hr });
  assert.equal(queued.status, 200, JSON.stringify(queued.body));
  const labels = queued.body.data.map((i) => i.label).join(" | ");
  assert.match(labels, /Expense reimbursement #1/);
  assert.match(labels, /Asset recovery/);
  assert.match(labels, /Loan #1 recovery \(1\/3\)/);

  // One run applies this month's inputs: reimbursement, recovery, first instalment. Not the later instalments.
  const { run, items } = await runPayroll();
  const item = items.find((i) => String(i.employeeId) === String(state.employee._id) || (i.employeeSnapshot && i.employeeSnapshot.employeeCode === "E001"));
  assert.ok(item, "the employee was paid");
  const adjustmentLabels = item.adjustments.map((a) => a.label);
  assert.ok(adjustmentLabels.some((l) => /Expense reimbursement/.test(l)));
  assert.ok(adjustmentLabels.some((l) => /Asset recovery/.test(l)));
  assert.ok(adjustmentLabels.some((l) => /Loan #1 recovery \(1\/3\)/.test(l)));
  assert.ok(!adjustmentLabels.some((l) => /\(2\/3\)/.test(l)), "next month's instalment waits");
  assert.equal(item.gross, 30000 + 1000, "the reimbursement is an earning");
  assert.equal(item.totalDeductions, 2500 + 3000, "recovery and instalment are deductions");

  const afterRun = await api("GET", `/loans/${loan.body.data.id}`, { token: state.hr });
  assert.equal(afterRun.body.data.outstanding, 6000, "the outstanding balance moved with the run");
  assert.equal(afterRun.body.data.schedule[0].status, "applied");

  // A repayment outside payroll cancels the last instalment.
  const repaid = await api("POST", `/loans/${loan.body.data.id}/repayments`, { token: state.hr, body: { amount: 3000, reference: "cash" } });
  assert.equal(repaid.status, 200, JSON.stringify(repaid.body));
  assert.equal(repaid.body.data.outstanding, 3000);

  // Reprocessing the same run applies nothing twice: inputs are released and re-applied once.
  const reprocessed = await tenant.runWithTenant(state.organizationId, () => payrollService.processRun(run.id), { userId: null });
  assert.equal(reprocessed.status, "processed");
  const itemsAgain = await api("GET", `/payroll/runs/${run.id}/items`, { token: state.hr });
  const itemAgain = itemsAgain.body.data.find((i) => i.employeeSnapshot && i.employeeSnapshot.employeeCode === "E001");
  assert.equal(itemAgain.adjustments.filter((a) => /Loan #1 recovery/.test(a.label)).length, 1, "one instalment, not two, after reprocessing");
  assert.equal(itemAgain.totalDeductions, 2500 + 3000);
  await tenant.runWithTenant(state.organizationId, async () => {
    const applied = await PayrollInput.countDocuments({ employeeId: state.employee._id, status: "applied" });
    assert.equal(applied, 3, "reimbursement, recovery and one instalment — applied once each");
  });
});
