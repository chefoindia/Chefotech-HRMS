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
const { SurveyResponse } = require("../../src/modules/surveys/survey.model");
const Notification = require("../../src/modules/notifications/notification.model");

/**
 * Surveys and performance.
 *
 * A pulse survey goes to an audience, takes one answer per person, and
 * aggregates without identities when anonymous. A review cycle creates one
 * review per participant with their manager as reviewer, walks self →
 * manager → complete → acknowledged, and keeps the manager's notes private
 * until they are done. Goals belong to a person, move to 100, and are
 * snapshotted into the review.
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

  const owner = await createUser("hr@engage.test", "Asha", "Menon");
  const { organization } = await organizationService.provision({ name: "Engage Co", ownerUserId: owner._id });
  state.organizationId = organization._id;

  await tenant.runWithTenant(organization._id, async () => {
    const managerRole = await Role.findOne({ key: "MANAGER" });
    const employeeRole = await Role.findOne({ key: "EMPLOYEE" });

    const managerUser = await createUser("manager@engage.test", "Bala", "Iyer");
    state.manager = await Employee.create({ employeeCode: "M001", personal: { firstName: "Bala", lastName: "Iyer", workEmail: "manager@engage.test" }, employment: { joiningDate: new Date("2023-01-01") }, status: "active", userId: managerUser._id });
    await Membership.create({ organizationId: organization._id, userId: managerUser._id, employeeId: state.manager._id, roleIds: [managerRole._id], permissions: managerRole.permissions, status: "active", isManager: true });

    const employeeUser = await createUser("ravi@engage.test", "Ravi", "Kumar");
    state.employee = await Employee.create({ employeeCode: "E001", personal: { firstName: "Ravi", lastName: "Kumar", workEmail: "ravi@engage.test" }, employment: { joiningDate: new Date("2024-02-01"), managerId: state.manager._id, managerChain: [state.manager._id] }, status: "active", userId: employeeUser._id });
    await Membership.create({ organizationId: organization._id, userId: employeeUser._id, employeeId: state.employee._id, roleIds: [employeeRole._id], permissions: employeeRole.permissions, status: "active" });

    const otherUser = await createUser("meena@engage.test", "Meena", "R");
    state.other = await Employee.create({ employeeCode: "E002", personal: { firstName: "Meena", lastName: "R", workEmail: "meena@engage.test" }, employment: { joiningDate: new Date("2024-03-01"), managerId: state.manager._id, managerChain: [state.manager._id] }, status: "active", userId: otherUser._id });
    await Membership.create({ organizationId: organization._id, userId: otherUser._id, employeeId: state.other._id, roleIds: [employeeRole._id], permissions: employeeRole.permissions, status: "active" });
  });

  state.hr = await signIn("hr@engage.test");
  state.mgr = await signIn("manager@engage.test");
  state.emp = await signIn("ravi@engage.test");
  state.emp2 = await signIn("meena@engage.test");
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

test("an anonymous pulse survey takes one answer per person and aggregates without names", async () => {
  const created = await api("POST", "/surveys", {
    token: state.hr,
    body: {
      title: "How are we doing?",
      questions: [
        { type: "rating", prompt: "How supported do you feel by your manager?", max: 5 },
        { type: "single", prompt: "Where do you work best?", options: ["Office", "Home", "Mix"] },
        { type: "yes_no", prompt: "Would you recommend working here?" },
        { type: "text", prompt: "One thing we should change", required: false },
      ],
      closesAt: "2099-12-31",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const survey = created.body.data;
  assert.equal(survey.anonymous, true, "anonymous by default");
  assert.equal(survey.status, "draft");
  assert.equal(survey.questions.length, 4);
  assert.ok(survey.questions.every((q) => q.id));

  // Not visible to employees until open.
  assert.equal((await api("GET", "/surveys/me", { token: state.emp })).body.data.length, 0);

  const opened = await api("POST", `/surveys/${survey.id}/open`, { token: state.hr });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.data.status, "open");
  assert.equal(opened.body.data.invitedCount, 3, "manager and both employees");

  const invited = await tenant.runWithTenant(state.organizationId, () => Notification.countDocuments({ templateKey: "survey_opened" }));
  assert.equal(invited, 3, "everyone in the audience was told");

  const mine = await api("GET", "/surveys/me", { token: state.emp });
  assert.equal(mine.body.data.length, 1);
  assert.equal(mine.body.data[0].responded, false);

  const [q1, q2, q3, q4] = survey.questions;
  const incomplete = await api("POST", `/surveys/me/${survey.id}/respond`, { token: state.emp, body: { answers: [{ questionId: q1.id, value: 4 }] } });
  assert.equal(incomplete.status, 422, "required questions are enforced");
  const outOfRange = await api("POST", `/surveys/me/${survey.id}/respond`, { token: state.emp, body: { answers: [{ questionId: q1.id, value: 9 }, { questionId: q2.id, value: "Home" }, { questionId: q3.id, value: true }] } });
  assert.equal(outOfRange.status, 422);

  const answered = await api("POST", `/surveys/me/${survey.id}/respond`, { token: state.emp, body: { answers: [{ questionId: q1.id, value: 4 }, { questionId: q2.id, value: "Home" }, { questionId: q3.id, value: true }, { questionId: q4.id, value: "Better coffee" }] } });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  const twice = await api("POST", `/surveys/me/${survey.id}/respond`, { token: state.emp, body: { answers: [{ questionId: q1.id, value: 1 }, { questionId: q2.id, value: "Office" }, { questionId: q3.id, value: false }] } });
  assert.equal(twice.status, 409, "one answer per person");
  assert.equal((await api("GET", "/surveys/me", { token: state.emp })).body.data[0].responded, true);

  await api("POST", `/surveys/me/${survey.id}/respond`, { token: state.emp2, body: { answers: [{ questionId: q1.id, value: 2 }, { questionId: q2.id, value: "Office" }, { questionId: q3.id, value: false }, { questionId: q4.id, value: "Less noise" }] } });

  const stored = await tenant.runWithTenant(state.organizationId, () => SurveyResponse.find({}).lean());
  assert.equal(stored.length, 2);
  assert.ok(stored.every((r) => r.employeeId === null), "anonymous responses carry no employee id");

  const reminded = await api("POST", `/surveys/${survey.id}/remind`, { token: state.hr });
  assert.equal(reminded.body.data.reminded, 1, "only the manager, who has not answered, is reminded");

  const results = await api("GET", `/surveys/${survey.id}/results`, { token: state.hr });
  assert.equal(results.status, 200);
  const r = results.body.data;
  assert.equal(r.responded, 2);
  assert.equal(r.invited, 3);
  assert.equal(r.rate, 67);
  assert.equal(r.respondents, null, "no respondent list for an anonymous survey");
  const rating = r.questions.find((q) => q.id === q1.id);
  assert.equal(rating.average, 3);
  assert.deepEqual(rating.distribution, { 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
  const single = r.questions.find((q) => q.id === q2.id);
  assert.deepEqual(single.counts, { Office: 1, Home: 1, Mix: 0 });
  const yesNo = r.questions.find((q) => q.id === q3.id);
  assert.deepEqual(yesNo.counts, { yes: 1, no: 1 });
  const text = r.questions.find((q) => q.id === q4.id);
  assert.equal(text.texts.length, 2);
  assert.ok(text.texts.every((t) => t.by === null));

  const noQuestions = await api("PATCH", `/surveys/${survey.id}`, { token: state.hr, body: { questions: [] } });
  assert.equal(noQuestions.status, 409, "questions are frozen while open");

  const closed = await api("POST", `/surveys/${survey.id}/close`, { token: state.hr });
  assert.equal(closed.body.data.status, "closed");
  const late = await api("POST", `/surveys/me/${survey.id}/respond`, { token: state.mgr, body: { answers: [{ questionId: q1.id, value: 5 }, { questionId: q2.id, value: "Mix" }, { questionId: q3.id, value: true }] } });
  assert.equal(late.status, 409);

  assert.equal((await api("GET", "/surveys", { token: state.emp })).status, 403, "employees cannot manage surveys");
});

test("a named survey to one department records who answered", async () => {
  const Department = require("../../src/modules/departments/department.model");
  const dept = await tenant.runWithTenant(state.organizationId, async () => {
    const d = await Department.create({ name: "Kitchen", code: "KIT" });
    await Employee.updateOne({ _id: state.employee._id }, { $set: { "employment.departmentId": d._id } });
    return d;
  });
  const created = await api("POST", "/surveys", { token: state.hr, body: { title: "Kitchen check-in", anonymous: false, audience: { type: "department", departmentId: String(dept._id) }, questions: [{ type: "scale", prompt: "Workload this week", max: 10 }] } });
  const survey = created.body.data;
  const opened = await api("POST", `/surveys/${survey.id}/open`, { token: state.hr });
  assert.equal(opened.body.data.invitedCount, 1);

  assert.equal((await api("GET", "/surveys/me", { token: state.emp2 })).body.data.length, 0, "outside the department, not invited");
  const outsider = await api("POST", `/surveys/me/${survey.id}/respond`, { token: state.emp2, body: { answers: [{ questionId: survey.questions[0].id, value: 5 }] } });
  assert.equal(outsider.status, 403);

  await api("POST", `/surveys/me/${survey.id}/respond`, { token: state.emp, body: { answers: [{ questionId: survey.questions[0].id, value: 7 }] } });
  const results = (await api("GET", `/surveys/${survey.id}/results`, { token: state.hr })).body.data;
  assert.equal(results.respondents.length, 1);
  assert.equal(results.respondents[0].name, "Ravi Kumar");
  assert.equal(results.questions[0].average, 7);
});

test("goals belong to a person, move to 100, and are scoped by role", async () => {
  const own = await api("POST", "/performance/goals", { token: state.emp, body: { title: "Cut prep time by 10%", metric: "Average prep minutes", target: "18", weight: 40, dueDate: "2099-06-30" } });
  assert.equal(own.status, 201, JSON.stringify(own.body));
  assert.equal(own.body.data.employeeId, String(state.employee._id));

  const forReport = await api("POST", "/performance/goals", { token: state.mgr, body: { employeeId: String(state.employee._id), title: "Train two juniors", weight: 30 } });
  assert.equal(forReport.status, 201, JSON.stringify(forReport.body));
  const told = await tenant.runWithTenant(state.organizationId, () => Notification.countDocuments({ templateKey: "goal_assigned" }));
  assert.equal(told, 1, "the employee is told when someone else sets a goal");

  const forStranger = await api("POST", "/performance/goals", { token: state.emp2, body: { employeeId: String(state.employee._id), title: "Nope" } });
  assert.equal(forStranger.status, 403, "a peer cannot set goals for another");

  assert.equal((await api("GET", "/performance/goals", { token: state.emp })).body.data.length, 2);
  assert.equal((await api("GET", "/performance/goals?scope=team", { token: state.mgr })).body.data.length, 2);
  assert.equal((await api("GET", "/performance/goals?scope=all", { token: state.hr })).body.data.length, 2);
  assert.equal((await api("GET", "/performance/goals?scope=all", { token: state.emp })).status, 403);
  assert.equal((await api("GET", `/performance/goals?employeeId=${state.employee._id}`, { token: state.emp2 })).status, 403);

  const progressed = await api("POST", `/performance/goals/${own.body.data.id}/progress`, { token: state.emp, body: { progress: 60, note: "Two stations reorganised" } });
  assert.equal(progressed.body.data.progress, 60);
  assert.equal(progressed.body.data.updates[0].note, "Two stations reorganised");
  const done = await api("POST", `/performance/goals/${own.body.data.id}/progress`, { token: state.mgr, body: { progress: 100 } });
  assert.equal(done.body.data.status, "completed");
  assert.ok(done.body.data.completedAt);
});

test("a review cycle walks self-review to acknowledgement and keeps the manager's notes private until done", async () => {
  await api("POST", "/performance/goals", { token: state.emp, body: { title: "Ship the new menu", weight: 50 } });

  const created = await api("POST", "/performance/cycles", { token: state.hr, body: { name: "H1 2026", periodStart: "2026-01-01", periodEnd: "2026-06-30", selfDueAt: "2099-07-07", managerDueAt: "2099-07-14" } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cycle = created.body.data;
  assert.equal(cycle.status, "draft");
  assert.equal(cycle.sections.length, 5, "default sections");

  const started = await api("POST", `/performance/cycles/${cycle.id}/start`, { token: state.hr });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.data.status, "self_review");
  assert.equal(started.body.data.participants, 3);
  assert.equal(started.body.data.reviews.length, 3);
  const raviReview = started.body.data.reviews.find((r) => r.employee.id === String(state.employee._id));
  assert.equal(raviReview.reviewer.id, String(state.manager._id), "the reviewer is the manager");
  assert.equal(raviReview.goals.length, 1, "goals are snapshotted");
  assert.equal(raviReview.status, "pending_self");

  const selfTold = await tenant.runWithTenant(state.organizationId, () => Notification.countDocuments({ templateKey: "review_self_due" }));
  assert.equal(selfTold, 3);

  const again = await api("POST", `/performance/cycles/${cycle.id}/start`, { token: state.hr });
  assert.equal(again.status, 409);

  const mine = await api("GET", "/performance/reviews/me", { token: state.emp });
  assert.equal(mine.body.data.length, 1);
  assert.equal(mine.body.data[0].cycle.name, "H1 2026");

  // The manager cannot write before the self-review while the cycle is in that stage.
  const early = await api("POST", `/performance/reviews/${raviReview.id}/manager`, { token: state.mgr, body: { overallRating: 4 } });
  assert.equal(early.status, 409);

  const wrongPerson = await api("POST", `/performance/reviews/${raviReview.id}/self`, { token: state.emp2, body: { ratings: { results: 5 } } });
  assert.equal(wrongPerson.status, 403);

  const badRating = await api("POST", `/performance/reviews/${raviReview.id}/self`, { token: state.emp, body: { ratings: { results: 9 } } });
  assert.equal(badRating.status, 422);

  const self = await api("POST", `/performance/reviews/${raviReview.id}/self`, { token: state.emp, body: { ratings: { results: 4, quality: 4, collaboration: 5, growth: 3 }, answers: { overall: "Proud of the menu launch." } } });
  assert.equal(self.status, 200, JSON.stringify(self.body));
  assert.equal(self.body.data.status, "pending_manager");
  assert.equal(self.body.data.manager, null, "the manager's side is hidden from the employee until complete");

  const queue = await api("GET", "/performance/reviews/to-review", { token: state.mgr });
  assert.equal(queue.body.data.length, 2, "the manager reviews the two people who report to them, not themselves");
  assert.ok(queue.body.data.some((r) => r.id === raviReview.id && r.self.submittedAt));

  const managerReview = await api("POST", `/performance/reviews/${raviReview.id}/manager`, { token: state.mgr, body: { ratings: { results: 4, quality: 3, collaboration: 5, growth: 4 }, answers: { overall: "Strong half. Work on delegation." }, overallRating: 4, summary: "Exceeds in most areas." } });
  assert.equal(managerReview.status, 200, JSON.stringify(managerReview.body));
  assert.equal(managerReview.body.data.status, "completed");

  const completedTold = await tenant.runWithTenant(state.organizationId, () => Notification.countDocuments({ templateKey: "review_completed" }));
  assert.equal(completedTold, 1);

  const seen = await api("GET", `/performance/reviews/${raviReview.id}`, { token: state.emp });
  assert.equal(seen.body.data.manager.overallRating, 4, "now the employee can read it");
  assert.equal((await api("GET", `/performance/reviews/${raviReview.id}`, { token: state.emp2 })).status, 403);

  const acknowledged = await api("POST", `/performance/reviews/${raviReview.id}/acknowledge`, { token: state.emp, body: { comment: "Agreed on delegation." } });
  assert.equal(acknowledged.body.data.status, "acknowledged");
  assert.equal(acknowledged.body.data.employeeComment, "Agreed on delegation.");

  // HR moves the cycle on for the stragglers, then the summary shows the distribution.
  const advanced = await api("POST", `/performance/cycles/${cycle.id}/advance`, { token: state.hr });
  assert.equal(advanced.body.data.status, "manager_review");
  assert.equal(advanced.body.data.counts.pending_self, 0);
  const managerTold = await tenant.runWithTenant(state.organizationId, () => Notification.countDocuments({ templateKey: "review_manager_due" }));
  assert.ok(managerTold >= 1, "managers are told what is waiting");

  const summary = await api("GET", `/performance/cycles/${cycle.id}/summary`, { token: state.hr });
  assert.equal(summary.body.data.distribution["4"], 1);
  assert.equal(summary.body.data.average, 4);
  assert.equal(summary.body.data.sectionAverages.collaboration, 5);

  const closed = await api("POST", `/performance/cycles/${cycle.id}/close`, { token: state.hr });
  assert.equal(closed.body.data.status, "closed");
  assert.equal((await api("GET", "/performance/reviews/to-review", { token: state.mgr })).body.data.length, 0, "closed cycles leave the queue");
  assert.equal((await api("GET", "/performance/cycles", { token: state.emp })).status, 403);
});
