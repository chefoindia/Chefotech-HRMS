"use strict";

const mongoose = require("mongoose");
const { Goal, ReviewCycle, Review, DEFAULT_SECTIONS } = require("./performance.model");
const Employee = require("../employees/employee.model");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");

/** Goals and reviews. See performance.model.js. */

const ACTIVE = ["active", "on_leave", "notice_period"];
const EMPLOYEE_FIELDS = "employeeCode userId personal.firstName personal.lastName personal.workEmail employment.managerId employment.departmentId employment.designationId";

function audienceFilter(audience = {}) {
  const filter = { status: { $in: ACTIVE } };
  if (audience.type === "department" && audience.departmentId) filter["employment.departmentId"] = audience.departmentId;
  if (audience.type === "location" && audience.locationId) filter["employment.locationId"] = audience.locationId;
  if (audience.type === "employees") filter._id = { $in: audience.employeeIds || [] };
  return filter;
}

function has(auth, permission) {
  return (auth.permissions || []).includes(permission);
}

/** May this caller act on this employee's goals or review as a manager? */
async function isManagerOf(auth, employeeId) {
  if (!auth.employeeId) return false;
  if (String(auth.employeeId) === String(employeeId)) return false;
  const employee = await Employee.findById(employeeId).select("employment.managerId employment.managerChain").lean();
  if (!employee) return false;
  const chain = (employee.employment.managerChain || []).map(String);
  return String(employee.employment.managerId) === String(auth.employeeId) || chain.includes(String(auth.employeeId));
}

async function assertCanManageEmployee(auth, employeeId) {
  if (has(auth, "performance.manage")) return "hr";
  if (has(auth, "performance.review") && (await isManagerOf(auth, employeeId))) return "manager";
  if (auth.employeeId && String(auth.employeeId) === String(employeeId) && has(auth, "performance.view_own")) return "self";
  throw AppError.forbidden("You cannot manage goals for this employee.");
}

async function assertCanViewEmployee(auth, employeeId) {
  if (has(auth, "performance.manage")) return true;
  if (auth.employeeId && String(auth.employeeId) === String(employeeId)) return true;
  if (has(auth, "performance.review") && (await isManagerOf(auth, employeeId))) return true;
  throw AppError.forbidden("You cannot see this employee's performance records.");
}

// ── Goals ────────────────────────────────────────────────────────────────────

async function listGoals({ scope = "mine", employeeId, status, cycleId } = {}, auth) {
  const filter = {};
  if (status) filter.status = status;
  if (cycleId) filter.cycleId = cycleId;

  if (employeeId) {
    await assertCanViewEmployee(auth, employeeId);
    filter.employeeId = employeeId;
  } else if (scope === "all") {
    if (!has(auth, "performance.manage")) throw AppError.forbidden("You cannot see every goal.");
  } else if (scope === "team") {
    if (!auth.employeeId || !has(auth, "performance.review")) throw AppError.forbidden("You do not manage a team.");
    const team = await Employee.find({ "employment.managerChain": auth.employeeId }).select("_id").lean();
    filter.employeeId = { $in: team.map((e) => e._id) };
  } else {
    if (!auth.employeeId) return [];
    filter.employeeId = auth.employeeId;
  }

  const rows = await Goal.find(filter).populate("employeeId", EMPLOYEE_FIELDS).populate("alignedToId", "title").sort({ status: 1, dueDate: 1, createdAt: -1 }).lean();
  return rows.map(shapeGoal);
}

async function createGoal(data, auth, req) {
  const employeeId = data.employeeId || auth.employeeId;
  if (!employeeId) throw AppError.badRequest("Choose whose goal this is.");
  const role = await assertCanManageEmployee(auth, employeeId);
  const employee = await Employee.findById(employeeId).select(EMPLOYEE_FIELDS).lean();
  if (!employee) throw AppError.notFound("Employee");
  if (data.alignedToId) {
    const parent = await Goal.findById(data.alignedToId).select("_id").lean();
    if (!parent) throw AppError.badRequest("The goal to align with does not exist.");
  }

  const goal = await Goal.create({
    employeeId,
    cycleId: data.cycleId || null,
    title: data.title,
    description: data.description || "",
    metric: data.metric || "",
    target: data.target || "",
    weight: data.weight || 25,
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    alignedToId: data.alignedToId || null,
    createdBy: tenant.getUserId(),
  });

  if (role !== "self") {
    const organization = await recipients.organization();
    notifications
      .notify({ template: "goal_assigned", recipients: [recipients.employeeToRecipient(employee)], organization, data: { goal: { id: String(goal._id), title: goal.title, due: goal.dueDate ? ` Due ${goal.dueDate.toDateString()}.` : "" }, actor: { userId: auth.userId, name: auth.name } }, entity: { type: "Goal", id: goal._id } })
      .catch((err) => logger.warn({ err }, "Goal notification failed"));
  }
  await audit.record({ action: "performance.goal_created", entityType: "Goal", entityId: goal._id, entityLabel: goal.title, after: { employeeId: String(employeeId), weight: goal.weight }, severity: "info" }, req);
  return getGoal(goal._id, auth);
}

async function getGoal(id, auth) {
  const goal = await Goal.findById(id).populate("employeeId", EMPLOYEE_FIELDS).populate("alignedToId", "title").lean();
  if (!goal) throw AppError.notFound("Goal");
  await assertCanViewEmployee(auth, goal.employeeId._id);
  return shapeGoal(goal);
}

async function updateGoal(id, data, auth, req) {
  const goal = await Goal.findById(id);
  if (!goal) throw AppError.notFound("Goal");
  await assertCanManageEmployee(auth, goal.employeeId);
  for (const key of ["title", "description", "metric", "target", "weight", "status", "cycleId", "alignedToId"]) if (data[key] !== undefined) goal[key] = data[key];
  if (data.dueDate !== undefined) goal.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.status === "completed" && !goal.completedAt) {
    goal.completedAt = new Date();
    goal.progress = 100;
  }
  goal.updatedBy = tenant.getUserId();
  await goal.save();
  await audit.record({ action: "performance.goal_updated", entityType: "Goal", entityId: goal._id, entityLabel: goal.title, after: data, severity: "info" }, req);
  return getGoal(goal._id, auth);
}

async function updateProgress(id, { progress, note }, auth, req) {
  const goal = await Goal.findById(id);
  if (!goal) throw AppError.notFound("Goal");
  await assertCanManageEmployee(auth, goal.employeeId);
  if (goal.status !== "active") throw AppError.conflict("Only an active goal can be updated.");
  goal.progress = progress;
  goal.updates.push({ by: tenant.getUserId(), byName: auth.name || "", progress, note: note || "" });
  if (progress >= 100) {
    goal.status = "completed";
    goal.completedAt = new Date();
  }
  goal.updatedBy = tenant.getUserId();
  await goal.save();
  return getGoal(goal._id, auth);
}

async function removeGoal(id, auth, req) {
  const goal = await Goal.findById(id);
  if (!goal) throw AppError.notFound("Goal");
  await assertCanManageEmployee(auth, goal.employeeId);
  await goal.softDelete(tenant.getUserId());
  await audit.record({ action: "performance.goal_deleted", entityType: "Goal", entityId: goal._id, entityLabel: goal.title, severity: "warning" }, req);
  return { id: String(id), deleted: true };
}

// ── Cycles ───────────────────────────────────────────────────────────────────

async function listCycles() {
  const rows = await ReviewCycle.find({}).sort({ periodStart: -1 }).lean();
  const counts = await Review.aggregate([
    { $match: { organizationId: new mongoose.Types.ObjectId(String(tenant.requireOrganizationId())), deletedAt: null } },
    { $group: { _id: { cycleId: "$cycleId", status: "$status" }, count: { $sum: 1 } } },
  ]);
  const byCycle = {};
  for (const c of counts) {
    const key = String(c._id.cycleId);
    byCycle[key] = byCycle[key] || {};
    byCycle[key][c._id.status] = c.count;
  }
  return rows.map((c) => shapeCycle(c, byCycle[String(c._id)] || {}));
}

async function getCycle(id) {
  const cycle = await ReviewCycle.findById(id).lean();
  if (!cycle) throw AppError.notFound("Review cycle");
  const reviews = await Review.find({ cycleId: cycle._id }).populate("employeeId", EMPLOYEE_FIELDS).populate("reviewerId", "personal.firstName personal.lastName").sort({ status: 1 }).lean();
  const counts = {};
  for (const r of reviews) counts[r.status] = (counts[r.status] || 0) + 1;
  return { ...shapeCycle(cycle, counts), reviews: reviews.map(shapeReview) };
}

async function createCycle(data, req) {
  if (new Date(data.periodEnd) < new Date(data.periodStart)) throw AppError.validation("The period ends before it starts.");
  const cycle = await ReviewCycle.create({
    name: data.name,
    periodStart: new Date(data.periodStart),
    periodEnd: new Date(data.periodEnd),
    audience: { type: data.audience?.type || "all", departmentId: data.audience?.departmentId || null, locationId: data.audience?.locationId || null, employeeIds: data.audience?.employeeIds || [] },
    sections: data.sections && data.sections.length ? data.sections : DEFAULT_SECTIONS,
    ratingScale: data.ratingScale || 5,
    selfReviewRequired: data.selfReviewRequired !== false,
    selfDueAt: data.selfDueAt ? new Date(data.selfDueAt) : null,
    managerDueAt: data.managerDueAt ? new Date(data.managerDueAt) : null,
    createdBy: tenant.getUserId(),
  });
  await audit.record({ action: "performance.cycle_created", entityType: "ReviewCycle", entityId: cycle._id, entityLabel: cycle.name, severity: "info" }, req);
  return getCycle(cycle._id);
}

async function updateCycle(id, data, req) {
  const cycle = await ReviewCycle.findById(id);
  if (!cycle) throw AppError.notFound("Review cycle");
  if (cycle.status === "closed") throw AppError.conflict("A closed cycle cannot be edited.");
  if (cycle.status !== "draft" && (data.sections || data.audience || data.ratingScale)) throw AppError.conflict("Sections, audience and the rating scale are fixed once a cycle has started.");
  for (const key of ["name", "selfReviewRequired", "ratingScale"]) if (data[key] !== undefined) cycle[key] = data[key];
  if (data.sections) cycle.sections = data.sections;
  if (data.audience) cycle.audience = { type: data.audience.type || "all", departmentId: data.audience.departmentId || null, locationId: data.audience.locationId || null, employeeIds: data.audience.employeeIds || [] };
  for (const key of ["periodStart", "periodEnd", "selfDueAt", "managerDueAt"]) if (data[key] !== undefined) cycle[key] = data[key] ? new Date(data[key]) : null;
  cycle.updatedBy = tenant.getUserId();
  await cycle.save();
  return getCycle(cycle._id);
}

/** Start: one review per participant, reviewer = their manager, goals snapshotted. */
async function startCycle(id, req) {
  const cycle = await ReviewCycle.findById(id);
  if (!cycle) throw AppError.notFound("Review cycle");
  if (cycle.status !== "draft") throw AppError.conflict("This cycle has already started.");
  const participants = await Employee.find(audienceFilter(cycle.audience)).select(EMPLOYEE_FIELDS).lean();
  if (!participants.length) throw AppError.badRequest("Nobody is in this audience yet.");

  const goals = await Goal.find({ employeeId: { $in: participants.map((p) => p._id) }, status: { $ne: "cancelled" } }).lean();
  const goalsByEmployee = {};
  for (const g of goals) (goalsByEmployee[String(g.employeeId)] = goalsByEmployee[String(g.employeeId)] || []).push({ goalId: g._id, title: g.title, progress: g.progress, weight: g.weight, status: g.status });

  const initial = cycle.selfReviewRequired ? "pending_self" : "pending_manager";
  for (const employee of participants) {
    await Review.updateOne(
      { cycleId: cycle._id, employeeId: employee._id },
      { $setOnInsert: { cycleId: cycle._id, employeeId: employee._id, reviewerId: employee.employment.managerId || null, status: initial, goalsSnapshot: goalsByEmployee[String(employee._id)] || [], createdBy: tenant.getUserId() } },
      { upsert: true }
    );
  }
  cycle.status = cycle.selfReviewRequired ? "self_review" : "manager_review";
  cycle.startedAt = new Date();
  cycle.participants = participants.length;
  await cycle.save();

  const organization = await recipients.organization();
  const cycleData = { id: String(cycle._id), name: cycle.name, due: cycle.selfDueAt ? ` Please finish by ${cycle.selfDueAt.toDateString()}.` : "" };
  if (cycle.selfReviewRequired) {
    await notifications
      .notify({ template: "review_self_due", recipients: participants.map(recipients.employeeToRecipient), organization, data: { cycle: cycleData }, entity: { type: "ReviewCycle", id: cycle._id } })
      .catch((err) => logger.warn({ err }, "Review start notification failed"));
  } else {
    await notifyManagers(cycle, organization);
  }
  await audit.record({ action: "performance.cycle_started", entityType: "ReviewCycle", entityId: cycle._id, entityLabel: cycle.name, after: { participants: participants.length }, severity: "notice" }, req);
  return getCycle(cycle._id);
}

async function notifyManagers(cycle, organization) {
  const reviews = await Review.find({ cycleId: cycle._id, status: "pending_manager", reviewerId: { $ne: null } }).select("reviewerId").lean();
  const counts = {};
  for (const r of reviews) counts[String(r.reviewerId)] = (counts[String(r.reviewerId)] || 0) + 1;
  const managers = await Employee.find({ _id: { $in: Object.keys(counts) } }).select(EMPLOYEE_FIELDS).lean();
  for (const manager of managers) {
    const count = counts[String(manager._id)];
    await notifications
      .notify({
        template: "review_manager_due",
        recipients: [recipients.employeeToRecipient(manager)],
        organization,
        data: { cycle: { id: String(cycle._id), name: cycle.name, due: cycle.managerDueAt ? ` Please finish by ${cycle.managerDueAt.toDateString()}.` : "" }, count, people: count === 1 ? "person" : "people" },
        entity: { type: "ReviewCycle", id: cycle._id },
      })
      .catch(() => {});
  }
  return managers.length;
}

/** Move to manager review: whoever has not self-reviewed is moved along without one. */
async function advanceCycle(id, req) {
  const cycle = await ReviewCycle.findById(id);
  if (!cycle) throw AppError.notFound("Review cycle");
  if (cycle.status !== "self_review") throw AppError.conflict("Only a cycle in self-review can move to manager review.");
  const moved = await Review.updateMany({ cycleId: cycle._id, status: "pending_self" }, { $set: { status: "pending_manager" } });
  cycle.status = "manager_review";
  await cycle.save();
  const organization = await recipients.organization();
  const managers = await notifyManagers(cycle, organization);
  await audit.record({ action: "performance.cycle_advanced", entityType: "ReviewCycle", entityId: cycle._id, entityLabel: cycle.name, after: { movedWithoutSelfReview: moved.modifiedCount, managersTold: managers }, severity: "notice" }, req);
  return getCycle(cycle._id);
}

async function closeCycle(id, req) {
  const cycle = await ReviewCycle.findById(id);
  if (!cycle) throw AppError.notFound("Review cycle");
  if (cycle.status === "closed") throw AppError.conflict("This cycle is already closed.");
  cycle.status = "closed";
  cycle.closedAt = new Date();
  await cycle.save();
  await audit.record({ action: "performance.cycle_closed", entityType: "ReviewCycle", entityId: cycle._id, entityLabel: cycle.name, severity: "notice" }, req);
  return getCycle(cycle._id);
}

/** Rating distribution and completion, for the calibration view. */
async function cycleSummary(id) {
  const cycle = await ReviewCycle.findById(id).lean();
  if (!cycle) throw AppError.notFound("Review cycle");
  const reviews = await Review.find({ cycleId: cycle._id }).populate("employeeId", "personal.firstName personal.lastName employment.departmentId employeeCode").lean();
  const distribution = Object.fromEntries(Array.from({ length: cycle.ratingScale }, (_, i) => [String(i + 1), 0]));
  const rated = reviews.filter((r) => typeof r.manager?.overallRating === "number");
  for (const r of rated) if (distribution[String(r.manager.overallRating)] !== undefined) distribution[String(r.manager.overallRating)] += 1;
  const sectionAverages = {};
  for (const section of cycle.sections.filter((s) => s.rated)) {
    const values = rated.map((r) => Number(r.manager.ratings && r.manager.ratings[section.key])).filter((n) => !Number.isNaN(n) && n > 0);
    sectionAverages[section.key] = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null;
  }
  const counts = {};
  for (const r of reviews) counts[r.status] = (counts[r.status] || 0) + 1;
  return {
    cycle: shapeCycle(cycle, counts),
    distribution,
    average: rated.length ? Math.round((rated.reduce((a, r) => a + r.manager.overallRating, 0) / rated.length) * 100) / 100 : null,
    sectionAverages,
    ratings: rated.map((r) => ({ employeeId: String(r.employeeId._id), name: [r.employeeId.personal.firstName, r.employeeId.personal.lastName].filter(Boolean).join(" "), code: r.employeeId.employeeCode, overallRating: r.manager.overallRating })).sort((a, b) => b.overallRating - a.overallRating),
  };
}

// ── Reviews ──────────────────────────────────────────────────────────────────

async function myReviews(auth) {
  if (!auth.employeeId) return [];
  const rows = await Review.find({ employeeId: auth.employeeId }).populate("cycleId").populate("reviewerId", "personal.firstName personal.lastName").sort({ createdAt: -1 }).lean();
  return rows.map(shapeReview);
}

async function toReview(auth) {
  const filter = has(auth, "performance.manage") && !auth.employeeId ? {} : { reviewerId: auth.employeeId };
  const rows = await Review.find({ ...filter, status: { $in: ["pending_self", "pending_manager", "completed"] } }).populate("cycleId").populate("employeeId", EMPLOYEE_FIELDS).sort({ status: -1 }).lean();
  return rows.filter((r) => r.cycleId && r.cycleId.status !== "closed").map(shapeReview);
}

async function getReview(id, auth) {
  const review = await Review.findById(id).populate("cycleId").populate("employeeId", EMPLOYEE_FIELDS).populate("reviewerId", "personal.firstName personal.lastName").lean();
  if (!review) throw AppError.notFound("Review");
  const isSubject = auth.employeeId && String(auth.employeeId) === String(review.employeeId._id);
  const isReviewer = auth.employeeId && review.reviewerId && String(auth.employeeId) === String(review.reviewerId._id);
  if (!isSubject && !isReviewer && !has(auth, "performance.manage")) throw AppError.forbidden("You cannot see this review.");
  const shaped = shapeReview(review);
  // The manager's notes stay private until the review is complete.
  if (isSubject && !isReviewer && !has(auth, "performance.manage") && !["completed", "acknowledged"].includes(review.status)) shaped.manager = null;
  return shaped;
}

function cleanRatings(cycle, ratings = {}, answers = {}) {
  const outRatings = {};
  const outAnswers = {};
  for (const section of cycle.sections) {
    if (section.rated && ratings[section.key] !== undefined && ratings[section.key] !== null && ratings[section.key] !== "") {
      const n = Number(ratings[section.key]);
      if (!Number.isInteger(n) || n < 1 || n > cycle.ratingScale) throw AppError.validation(`"${section.title}" must be rated 1 to ${cycle.ratingScale}.`);
      outRatings[section.key] = n;
    }
    if (answers[section.key] !== undefined) outAnswers[section.key] = String(answers[section.key]).slice(0, 4000);
  }
  return { ratings: outRatings, answers: outAnswers };
}

async function submitSelf(id, data, auth, req) {
  const review = await Review.findById(id).populate("cycleId");
  if (!review) throw AppError.notFound("Review");
  if (!auth.employeeId || String(review.employeeId) !== String(auth.employeeId)) throw AppError.forbidden("This is not your review.");
  if (review.status !== "pending_self") throw AppError.conflict("The self-review stage has passed.");
  const { ratings, answers } = cleanRatings(review.cycleId, data.ratings, data.answers);
  review.self = { ratings, answers, submittedAt: new Date() };
  review.status = "pending_manager";
  await review.save();

  if (review.reviewerId) {
    const manager = await Employee.findById(review.reviewerId).select(EMPLOYEE_FIELDS).lean();
    const employee = await Employee.findById(review.employeeId).select(EMPLOYEE_FIELDS).lean();
    if (manager) {
      notifications
        .notify({ template: "review_self_submitted", recipients: [recipients.employeeToRecipient(manager)], organization: await recipients.organization(), data: { cycle: { id: String(review.cycleId._id), name: review.cycleId.name }, employee: { name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" ") } }, entity: { type: "Review", id: review._id } })
        .catch(() => {});
    }
  }
  void req;
  return getReview(review._id, auth);
}

async function submitManager(id, data, auth, req) {
  const review = await Review.findById(id).populate("cycleId");
  if (!review) throw AppError.notFound("Review");
  const isReviewer = auth.employeeId && review.reviewerId && String(review.reviewerId) === String(auth.employeeId);
  if (!isReviewer && !has(auth, "performance.manage")) throw AppError.forbidden("Only the reviewer can complete this review.");
  if (!["pending_self", "pending_manager"].includes(review.status)) throw AppError.conflict("This review is already complete.");
  if (review.status === "pending_self" && review.cycleId.status === "self_review" && !has(auth, "performance.manage")) throw AppError.conflict("Wait for the self-review, or ask HR to move the cycle on.");
  const { ratings, answers } = cleanRatings(review.cycleId, data.ratings, data.answers);
  const overall = Number(data.overallRating);
  if (!Number.isInteger(overall) || overall < 1 || overall > review.cycleId.ratingScale) throw AppError.validation(`The overall rating must be 1 to ${review.cycleId.ratingScale}.`);
  review.manager = { ratings, answers, overallRating: overall, summary: data.summary || "", submittedAt: new Date() };
  review.status = "completed";
  await review.save();

  const employee = await Employee.findById(review.employeeId).select(EMPLOYEE_FIELDS).lean();
  notifications
    .notify({ template: "review_completed", recipients: [recipients.employeeToRecipient(employee)], organization: await recipients.organization(), data: { cycle: { id: String(review.cycleId._id), name: review.cycleId.name } }, entity: { type: "Review", id: review._id } })
    .catch(() => {});
  await audit.record({ action: "performance.review_completed", entityType: "Review", entityId: review._id, entityLabel: `${review.cycleId.name}: ${employee ? employee.personal.firstName : ""}`, after: { overallRating: overall }, severity: "notice" }, req);
  return getReview(review._id, auth);
}

async function acknowledge(id, { comment }, auth, req) {
  const review = await Review.findById(id);
  if (!review) throw AppError.notFound("Review");
  if (!auth.employeeId || String(review.employeeId) !== String(auth.employeeId)) throw AppError.forbidden("This is not your review.");
  if (review.status !== "completed") throw AppError.conflict("There is nothing to acknowledge yet.");
  review.status = "acknowledged";
  review.acknowledgedAt = new Date();
  review.employeeComment = comment || "";
  await review.save();
  void req;
  return getReview(review._id, auth);
}

async function reassignReviewer(id, reviewerId, req) {
  const review = await Review.findById(id);
  if (!review) throw AppError.notFound("Review");
  if (["completed", "acknowledged"].includes(review.status)) throw AppError.conflict("A completed review cannot be reassigned.");
  const reviewer = await Employee.findById(reviewerId).select("_id").lean();
  if (!reviewer) throw AppError.notFound("Reviewer");
  if (String(reviewer._id) === String(review.employeeId)) throw AppError.badRequest("Someone cannot review themselves.");
  review.reviewerId = reviewer._id;
  await review.save();
  await audit.record({ action: "performance.review_reassigned", entityType: "Review", entityId: review._id, after: { reviewerId: String(reviewerId) }, severity: "info" }, req);
  return { id: String(review._id), reviewerId: String(reviewerId) };
}

// ── Shapes ───────────────────────────────────────────────────────────────────

function person(e) {
  if (!e || !e.personal) return e ? { id: String(e._id || e) } : null;
  return { id: String(e._id), name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "), code: e.employeeCode || null, managerId: e.employment?.managerId ? String(e.employment.managerId) : null };
}

function shapeGoal(g) {
  return {
    id: String(g._id),
    employee: person(g.employeeId),
    employeeId: g.employeeId && g.employeeId._id ? String(g.employeeId._id) : String(g.employeeId),
    cycleId: g.cycleId ? String(g.cycleId) : null,
    title: g.title,
    description: g.description,
    metric: g.metric,
    target: g.target,
    weight: g.weight,
    progress: g.progress,
    status: g.status,
    dueDate: g.dueDate,
    alignedTo: g.alignedToId && g.alignedToId.title ? { id: String(g.alignedToId._id), title: g.alignedToId.title } : null,
    updates: (g.updates || []).slice(-20).reverse().map((u) => ({ at: u.at, byName: u.byName, progress: u.progress, note: u.note })),
    completedAt: g.completedAt,
    createdAt: g.createdAt,
  };
}

function shapeCycle(c, counts = {}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    id: String(c._id),
    name: c.name,
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    status: c.status,
    audience: { type: c.audience?.type || "all", departmentId: c.audience?.departmentId ? String(c.audience.departmentId) : null, locationId: c.audience?.locationId ? String(c.audience.locationId) : null, employeeIds: (c.audience?.employeeIds || []).map(String) },
    sections: (c.sections || []).map((s) => ({ key: s.key, title: s.title, description: s.description, rated: s.rated })),
    ratingScale: c.ratingScale,
    selfReviewRequired: c.selfReviewRequired,
    selfDueAt: c.selfDueAt,
    managerDueAt: c.managerDueAt,
    startedAt: c.startedAt,
    closedAt: c.closedAt,
    participants: c.participants || total,
    counts: { pending_self: counts.pending_self || 0, pending_manager: counts.pending_manager || 0, completed: counts.completed || 0, acknowledged: counts.acknowledged || 0 },
    completion: total ? Math.round((((counts.completed || 0) + (counts.acknowledged || 0)) / total) * 100) : 0,
    createdAt: c.createdAt,
  };
}

function shapeReview(r) {
  const cycle = r.cycleId && r.cycleId.name ? { id: String(r.cycleId._id), name: r.cycleId.name, status: r.cycleId.status, sections: (r.cycleId.sections || []).map((s) => ({ key: s.key, title: s.title, description: s.description, rated: s.rated })), ratingScale: r.cycleId.ratingScale, selfDueAt: r.cycleId.selfDueAt, managerDueAt: r.cycleId.managerDueAt, periodStart: r.cycleId.periodStart, periodEnd: r.cycleId.periodEnd } : { id: String(r.cycleId) };
  return {
    id: String(r._id),
    cycle,
    employee: person(r.employeeId),
    reviewer: person(r.reviewerId),
    status: r.status,
    self: { ratings: r.self?.ratings || {}, answers: r.self?.answers || {}, submittedAt: r.self?.submittedAt || null },
    manager: { ratings: r.manager?.ratings || {}, answers: r.manager?.answers || {}, overallRating: r.manager?.overallRating ?? null, summary: r.manager?.summary || "", submittedAt: r.manager?.submittedAt || null },
    goals: (r.goalsSnapshot || []).map((g) => ({ goalId: g.goalId ? String(g.goalId) : null, title: g.title, progress: g.progress, weight: g.weight, status: g.status })),
    employeeComment: r.employeeComment,
    acknowledgedAt: r.acknowledgedAt,
    createdAt: r.createdAt,
  };
}

module.exports = {
  listGoals,
  createGoal,
  getGoal,
  updateGoal,
  updateProgress,
  removeGoal,
  listCycles,
  getCycle,
  createCycle,
  updateCycle,
  startCycle,
  advanceCycle,
  closeCycle,
  cycleSummary,
  myReviews,
  toReview,
  getReview,
  submitSelf,
  submitManager,
  acknowledge,
  reassignReviewer,
  Goal,
  ReviewCycle,
  Review,
};
