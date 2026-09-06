"use strict";

const crypto = require("node:crypto");
const { customAlphabet } = require("nanoid");
const { Survey, SurveyResponse } = require("./survey.model");
const Employee = require("../employees/employee.model");
const User = require("../users/user.model");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const settings = require("../../core/settings/settings.service");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");

/** Pulse surveys. See survey.model.js. */

const questionId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);
const ACTIVE = ["active", "on_leave", "notice_period"];

function audienceFilter(audience = {}) {
  const filter = { status: { $in: ACTIVE } };
  if (audience.type === "department" && audience.departmentId) filter["employment.departmentId"] = audience.departmentId;
  if (audience.type === "location" && audience.locationId) filter["employment.locationId"] = audience.locationId;
  if (audience.type === "employees") filter._id = { $in: audience.employeeIds || [] };
  return filter;
}

async function audienceEmployees(survey) {
  return Employee.find(audienceFilter(survey.audience)).select("userId personal.firstName personal.lastName personal.workEmail").lean();
}

function respondentKey(survey, employeeId) {
  return crypto.createHmac("sha256", survey.salt || String(survey._id)).update(String(employeeId)).digest("hex");
}

function normaliseQuestions(questions = []) {
  return questions.map((q) => ({
    id: q.id || questionId(),
    type: q.type,
    prompt: q.prompt,
    help: q.help || "",
    options: ["single", "multi"].includes(q.type) ? (q.options || []).map((o) => String(o).trim()).filter(Boolean) : [],
    required: q.required !== false,
    max: ["rating", "scale"].includes(q.type) ? q.max || 5 : 5,
    lowLabel: q.lowLabel || "",
    highLabel: q.highLabel || "",
  }));
}

// ── Admin ────────────────────────────────────────────────────────────────────

async function list({ status } = {}) {
  const filter = status ? { status } : {};
  const rows = await Survey.find(filter).sort({ createdAt: -1 }).populate("createdBy", "firstName lastName").lean();
  return rows.map(shape);
}

async function get(id) {
  const survey = await Survey.findById(id).populate("createdBy", "firstName lastName").lean();
  if (!survey) throw AppError.notFound("Survey");
  return shape(survey);
}

async function create(data, req) {
  const anonymousDefault = await settings.get("survey.default_anonymous");
  const survey = await Survey.create({
    title: data.title,
    description: data.description || "",
    questions: normaliseQuestions(data.questions),
    audience: { type: data.audience?.type || "all", departmentId: data.audience?.departmentId || null, locationId: data.audience?.locationId || null, employeeIds: data.audience?.employeeIds || [] },
    anonymous: data.anonymous === undefined ? anonymousDefault !== false : Boolean(data.anonymous),
    closesAt: data.closesAt ? new Date(data.closesAt) : null,
    salt: crypto.randomBytes(16).toString("hex"),
    createdBy: tenant.getUserId(),
  });
  await audit.record({ action: "survey.created", entityType: "Survey", entityId: survey._id, entityLabel: survey.title, severity: "info" }, req);
  return get(survey._id);
}

async function update(id, data, req) {
  const survey = await Survey.findById(id);
  if (!survey) throw AppError.notFound("Survey");
  if (survey.status === "closed") throw AppError.conflict("A closed survey cannot be edited.");
  if (survey.status === "open" && data.questions) throw AppError.conflict("Questions cannot change while a survey is open — answers would stop lining up. Close it and create a new one.");
  if (survey.status === "open" && data.anonymous !== undefined && data.anonymous !== survey.anonymous) throw AppError.conflict("Anonymity cannot change once people have been invited.");
  for (const key of ["title", "description", "anonymous"]) if (data[key] !== undefined) survey[key] = data[key];
  if (data.questions) survey.questions = normaliseQuestions(data.questions);
  if (data.audience) survey.audience = { type: data.audience.type || "all", departmentId: data.audience.departmentId || null, locationId: data.audience.locationId || null, employeeIds: data.audience.employeeIds || [] };
  if (data.closesAt !== undefined) survey.closesAt = data.closesAt ? new Date(data.closesAt) : null;
  survey.updatedBy = tenant.getUserId();
  await survey.save();
  await audit.record({ action: "survey.updated", entityType: "Survey", entityId: survey._id, entityLabel: survey.title, severity: "info" }, req);
  return get(survey._id);
}

async function remove(id, req) {
  const survey = await Survey.findById(id);
  if (!survey) throw AppError.notFound("Survey");
  await survey.softDelete(tenant.getUserId());
  await audit.record({ action: "survey.deleted", entityType: "Survey", entityId: survey._id, entityLabel: survey.title, severity: "warning" }, req);
  return { id: String(id), deleted: true };
}

/** Open it: the audience is counted and told. */
async function open(id, req) {
  const survey = await Survey.findById(id).select("+salt");
  if (!survey) throw AppError.notFound("Survey");
  if (survey.status !== "draft") throw AppError.conflict("Only a draft survey can be opened.");
  if (!survey.questions.length) throw AppError.badRequest("Add at least one question before opening the survey.");
  const audience = await audienceEmployees(survey);
  if (!audience.length) throw AppError.badRequest("Nobody is in this audience yet.");

  survey.status = "open";
  survey.opensAt = new Date();
  survey.invitedCount = audience.length;
  await survey.save();

  // Awaited on purpose: "open" means "everyone has been told", and the
  // in-app rows are what the employee list reads from.
  const organization = await recipients.organization();
  await notifications
    .notify({
      template: "survey_opened",
      recipients: audience.map(recipients.employeeToRecipient),
      organization,
      data: { survey: { id: String(survey._id), title: survey.title, closes: survey.closesAt ? ` It closes on ${survey.closesAt.toDateString()}.` : "", anonymous: survey.anonymous ? " Your answers are anonymous." : "" } },
      entity: { type: "Survey", id: survey._id },
    })
    .catch((err) => logger.warn({ err }, "Survey open notification failed"));

  await audit.record({ action: "survey.opened", entityType: "Survey", entityId: survey._id, entityLabel: survey.title, after: { invited: audience.length }, severity: "notice" }, req);
  return get(survey._id);
}

async function close(id, req, { reason = "closed" } = {}) {
  const survey = await Survey.findById(id).populate("createdBy", "email firstName lastName");
  if (!survey) throw AppError.notFound("Survey");
  if (survey.status !== "open") throw AppError.conflict("Only an open survey can be closed.");
  survey.status = "closed";
  survey.closedAt = new Date();
  await survey.save();

  if (survey.createdBy && survey.createdBy.email) {
    const organization = await recipients.organization();
    notifications
      .notify({
        template: "survey_closed",
        recipients: [recipients.userToRecipient(survey.createdBy)],
        organization,
        data: { survey: { id: String(survey._id), title: survey.title, responded: survey.respondedCount, invited: survey.invitedCount, rate: survey.invitedCount ? Math.round((survey.respondedCount / survey.invitedCount) * 100) : 0 } },
        entity: { type: "Survey", id: survey._id },
      })
      .catch(() => {});
  }
  await audit.record({ action: "survey.closed", entityType: "Survey", entityId: survey._id, entityLabel: survey.title, after: { reason, responded: survey.respondedCount }, severity: "notice" }, req);
  return get(survey._id);
}

/** Everyone invited who has not answered. Works for anonymous surveys too: the key is computable, the identity is not stored. */
async function pending(survey) {
  const audience = await audienceEmployees(survey);
  const keys = new Set((await SurveyResponse.find({ surveyId: survey._id }).select("respondentKey").lean()).map((r) => r.respondentKey));
  return audience.filter((e) => !keys.has(respondentKey(survey, e._id)));
}

async function remind(id, req) {
  const survey = await Survey.findById(id).select("+salt");
  if (!survey) throw AppError.notFound("Survey");
  if (survey.status !== "open") throw AppError.conflict("Only an open survey can send reminders.");
  const waiting = await pending(survey);
  if (waiting.length) {
    const organization = await recipients.organization();
    await notifications.notify({
      template: "survey_reminder",
      recipients: waiting.map(recipients.employeeToRecipient),
      organization,
      data: { survey: { id: String(survey._id), title: survey.title, closes: survey.closesAt ? ` It closes on ${survey.closesAt.toDateString()}.` : "" } },
      entity: { type: "Survey", id: survey._id },
    });
  }
  survey.reminderSentAt = new Date();
  await survey.save();
  await audit.record({ action: "survey.reminded", entityType: "Survey", entityId: survey._id, entityLabel: survey.title, after: { reminded: waiting.length }, severity: "info" }, req);
  return { reminded: waiting.length };
}

/** Results, aggregated per question. Text answers are listed without identity when anonymous. */
async function results(id) {
  const survey = await Survey.findById(id).lean();
  if (!survey) throw AppError.notFound("Survey");
  const rows = await SurveyResponse.find({ surveyId: survey._id }).populate("employeeId", "personal.firstName personal.lastName employeeCode").lean();

  const questions = survey.questions.map((q) => {
    const values = rows.map((r) => (r.answers.find((a) => a.questionId === q.id) || {}).value).filter((v) => v !== null && v !== undefined && v !== "");
    const base = { id: q.id, type: q.type, prompt: q.prompt, answered: values.length };
    if (q.type === "rating" || q.type === "scale") {
      const numbers = values.map(Number).filter((n) => !Number.isNaN(n));
      const distribution = Object.fromEntries(Array.from({ length: q.max }, (_, i) => [String(i + 1), 0]));
      for (const n of numbers) if (distribution[String(n)] !== undefined) distribution[String(n)] += 1;
      const average = numbers.length ? Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100 : null;
      return { ...base, max: q.max, average, distribution };
    }
    if (q.type === "yes_no") {
      const yes = values.filter((v) => v === true || v === "yes").length;
      return { ...base, counts: { yes, no: values.length - yes } };
    }
    if (q.type === "single" || q.type === "multi") {
      const counts = Object.fromEntries(q.options.map((o) => [o, 0]));
      for (const v of values) for (const choice of Array.isArray(v) ? v : [v]) if (counts[choice] !== undefined) counts[choice] += 1;
      return { ...base, counts };
    }
    const texts = rows
      .map((r) => ({ text: (r.answers.find((a) => a.questionId === q.id) || {}).value, by: survey.anonymous || !r.employeeId ? null : [r.employeeId.personal.firstName, r.employeeId.personal.lastName].filter(Boolean).join(" ") }))
      .filter((t) => typeof t.text === "string" && t.text.trim());
    if (survey.anonymous) texts.sort((a, b) => a.text.localeCompare(b.text));
    return { ...base, texts };
  });

  return {
    survey: shape(survey),
    responded: rows.length,
    invited: survey.invitedCount,
    rate: survey.invitedCount ? Math.round((rows.length / survey.invitedCount) * 100) : 0,
    questions,
    respondents: survey.anonymous ? null : rows.map((r) => ({ employeeId: r.employeeId ? String(r.employeeId._id) : null, name: r.employeeId ? [r.employeeId.personal.firstName, r.employeeId.personal.lastName].filter(Boolean).join(" ") : "—", code: r.employeeId ? r.employeeId.employeeCode : null, submittedAt: r.submittedAt })),
  };
}

// ── Employee ─────────────────────────────────────────────────────────────────

async function mine(auth) {
  if (!auth.employeeId) return [];
  const open = await Survey.find({ status: "open" }).select("+salt").lean();
  const out = [];
  for (const survey of open) {
    const inAudience = await Employee.exists({ ...audienceFilter(survey.audience), _id: auth.employeeId });
    if (!inAudience) continue;
    const responded = await SurveyResponse.exists({ surveyId: survey._id, respondentKey: respondentKey(survey, auth.employeeId) });
    out.push({ ...shape(survey), responded: Boolean(responded) });
  }
  return out.sort((a, b) => Number(a.responded) - Number(b.responded) || new Date(b.opensAt) - new Date(a.opensAt));
}

async function getForEmployee(id, auth) {
  const rows = await mine(auth);
  const found = rows.find((s) => s.id === String(id));
  if (!found) throw AppError.notFound("Survey");
  return found;
}

function validateAnswer(question, value) {
  const missing = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  if (missing) {
    if (question.required) throw AppError.validation(`"${question.prompt}" needs an answer.`);
    return null;
  }
  switch (question.type) {
    case "rating":
    case "scale": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > question.max) throw AppError.validation(`"${question.prompt}" must be between 1 and ${question.max}.`);
      return n;
    }
    case "yes_no":
      if (typeof value !== "boolean") throw AppError.validation(`"${question.prompt}" must be yes or no.`);
      return value;
    case "single":
      if (!question.options.includes(String(value))) throw AppError.validation(`"${question.prompt}": pick one of the options.`);
      return String(value);
    case "multi": {
      const list = Array.isArray(value) ? value.map(String) : [String(value)];
      if (list.some((v) => !question.options.includes(v))) throw AppError.validation(`"${question.prompt}": pick from the options.`);
      return [...new Set(list)];
    }
    default:
      return String(value).slice(0, 4000);
  }
}

async function respond(id, answers, auth, req) {
  if (!auth.employeeId) throw AppError.forbidden("Only employees can answer surveys.");
  const survey = await Survey.findById(id).select("+salt");
  if (!survey) throw AppError.notFound("Survey");
  if (survey.status !== "open") throw AppError.conflict("This survey is not open.");
  if (survey.closesAt && survey.closesAt < new Date()) throw AppError.conflict("This survey has closed.");
  const inAudience = await Employee.exists({ ...audienceFilter(survey.audience), _id: auth.employeeId });
  if (!inAudience) throw AppError.forbidden("This survey was not sent to you.");

  const byQuestion = Object.fromEntries((answers || []).map((a) => [a.questionId, a.value]));
  const cleaned = survey.questions.map((q) => ({ questionId: q.id, value: validateAnswer(q, byQuestion[q.id]) }));

  const key = respondentKey(survey, auth.employeeId);
  // Checked explicitly as well as by the unique index, so the answer is the
  // same whether or not the index has been built yet on a fresh database.
  if (await SurveyResponse.exists({ surveyId: survey._id, respondentKey: key })) throw AppError.conflict("You have already answered this survey.");
  try {
    await SurveyResponse.create({ surveyId: survey._id, employeeId: survey.anonymous ? null : auth.employeeId, respondentKey: key, answers: cleaned });
  } catch (err) {
    if (err && err.code === 11000) throw AppError.conflict("You have already answered this survey.");
    throw err;
  }
  await Survey.updateOne({ _id: survey._id }, { $inc: { respondedCount: 1 } });
  // Anonymous surveys leave no trace of who answered in the audit log either.
  if (!survey.anonymous) {
    await audit.record({ action: "survey.responded", entityType: "Survey", entityId: survey._id, entityLabel: survey.title, severity: "info" }, req);
  }
  return { ok: true };
}

/** Daily: close what is past its date; remind what closes soon. */
async function runDaily() {
  const now = new Date();
  const soon = new Date(now.getTime() + 2 * 86400000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
  let closed = 0;
  let reminded = 0;
  for (const survey of await Survey.find({ status: "open", closesAt: { $ne: null, $lte: now } }).select("_id").lean()) {
    await close(survey._id, null, { reason: "closing date reached" }).catch((err) => logger.warn({ err, surveyId: String(survey._id) }, "Survey auto-close failed"));
    closed += 1;
  }
  for (const survey of await Survey.find({ status: "open", closesAt: { $ne: null, $lte: soon, $gt: now }, $or: [{ reminderSentAt: null }, { reminderSentAt: { $lt: threeDaysAgo } }] }).select("_id").lean()) {
    const result = await remind(survey._id, null).catch((err) => {
      logger.warn({ err, surveyId: String(survey._id) }, "Survey reminder failed");
      return { reminded: 0 };
    });
    reminded += result.reminded;
  }
  return { closed, reminded };
}

function shape(s) {
  return {
    id: String(s._id),
    title: s.title,
    description: s.description,
    questions: (s.questions || []).map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, help: q.help, options: q.options, required: q.required, max: q.max, lowLabel: q.lowLabel, highLabel: q.highLabel })),
    audience: { type: s.audience?.type || "all", departmentId: s.audience?.departmentId ? String(s.audience.departmentId) : null, locationId: s.audience?.locationId ? String(s.audience.locationId) : null, employeeIds: (s.audience?.employeeIds || []).map(String) },
    anonymous: s.anonymous,
    status: s.status,
    opensAt: s.opensAt,
    closesAt: s.closesAt,
    closedAt: s.closedAt,
    invitedCount: s.invitedCount || 0,
    respondedCount: s.respondedCount || 0,
    rate: s.invitedCount ? Math.round(((s.respondedCount || 0) / s.invitedCount) * 100) : 0,
    reminderSentAt: s.reminderSentAt,
    createdBy: s.createdBy && s.createdBy.firstName ? [s.createdBy.firstName, s.createdBy.lastName].filter(Boolean).join(" ") : null,
    createdAt: s.createdAt,
  };
}

module.exports = { list, get, create, update, remove, open, close, remind, results, mine, getForEmployee, respond, runDaily, audienceEmployees, Survey, SurveyResponse, User };
