"use strict";

const { Ticket, TICKET_STATUSES } = require("./ticket.model");
const Employee = require("../employees/employee.model");
const User = require("../users/user.model");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const settings = require("../../core/settings/settings.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery, searchFilter } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");

/** Help desk. See ticket.model.js. */

async function nextNumber() {
  const last = await Ticket.findOne({}).sort({ number: -1 }).select("number").lean();
  return (last ? last.number : 0) + 1;
}

async function slaHoursFor(category, priority) {
  const hours = await settings.get("helpdesk.sla_hours").catch(() => null);
  const table = hours && typeof hours === "object" ? hours : {};
  const byPriority = { urgent: 4, high: 24, normal: 72, low: 168 };
  return Number(table[priority] || table[category] || byPriority[priority] || 72);
}

function isAgent(auth) {
  return (auth.permissions || []).includes("ticket.manage");
}

async function create({ subject, description, category, priority, attachmentFileIds }, auth, req) {
  const hours = await slaHoursFor(category || "other", priority || "normal");
  const ticket = await Ticket.create({
    number: await nextNumber(),
    subject,
    description: description || "",
    category: category || "other",
    priority: priority || "normal",
    requesterUserId: auth.userId,
    requesterEmployeeId: auth.employeeId || null,
    attachmentFileIds: attachmentFileIds || [],
    dueAt: new Date(Date.now() + hours * 3600000),
    createdBy: auth.userId,
  });

  await audit.record({ action: "ticket.created", entityType: "Ticket", entityId: ticket._id, entityLabel: `#${ticket.number} ${subject}`, after: { category: ticket.category, priority: ticket.priority }, severity: "notice" }, req);

  // Agents hear about new tickets; the auto-assignment setting can route by category.
  const agents = await recipients.usersWithPermission("ticket.manage");
  const routing = await settings.get("helpdesk.category_owners").catch(() => ({}));
  const owner = routing && typeof routing === "object" ? routing[ticket.category] : null;
  if (owner) {
    const ownerUser = await User.findOne({ email: String(owner).toLowerCase() }).select("_id firstName lastName email").lean();
    if (ownerUser && agents.some((a) => String(a.userId) === String(ownerUser._id))) {
      ticket.assigneeUserId = ownerUser._id;
      await ticket.save();
    }
  }
  const audience = ticket.assigneeUserId ? agents.filter((a) => String(a.userId) === String(ticket.assigneeUserId)) : agents;
  notifications
    .notify({
      template: "ticket_created",
      recipients: audience,
      organization: await recipients.organization(),
      data: { ticket: { id: String(ticket._id), number: ticket.number, subject, category: humanise(ticket.category), priority: humanise(ticket.priority), requester: auth.name, preview: String(description || "").slice(0, 200) } },
      severity: ticket.priority === "urgent" ? "warning" : "info",
      entity: { type: "Ticket", id: ticket._id },
    })
    .catch((err) => logger.warn({ err }, "Ticket notification failed"));

  return shape(await Ticket.findById(ticket._id).populate(POPULATE).lean(), auth);
}

const POPULATE = [
  { path: "requesterUserId", select: "firstName lastName email" },
  { path: "assigneeUserId", select: "firstName lastName email" },
  { path: "requesterEmployeeId", select: "employeeCode employment.departmentId", populate: { path: "employment.departmentId", select: "name" } },
];

async function list(query, auth) {
  const { page, limit, skip, search } = parseListQuery(query, { allowedSort: ["createdAt", "lastActivityAt", "dueAt"], maxLimit: 200 });
  const filter = {};
  const agent = isAgent(auth);

  if (query.scope === "mine" || !agent) filter.requesterUserId = auth.userId;
  else if (query.scope === "assigned") filter.assigneeUserId = auth.userId;
  else if (query.scope === "unassigned") filter.assigneeUserId = null;

  if (query.status) filter.status = Array.isArray(query.status) ? { $in: query.status } : query.status;
  else if (query.scope !== "mine" && agent && query.includeClosed !== "true") filter.status = { $in: ["open", "in_progress", "waiting_on_requester"] };
  if (query.category) filter.category = query.category;
  if (query.priority) filter.priority = query.priority;
  if (query.overdue === "true") {
    filter.dueAt = { $lt: new Date() };
    filter.status = { $in: ["open", "in_progress"] };
  }

  const search$ = searchFilter(search, ["subject", "description"]);
  const final = search$ ? { $and: [filter, search$] } : filter;
  if (search && /^#?\d+$/.test(search.trim())) {
    final.$and = [{ ...filter }, { $or: [{ number: Number(search.replace("#", "")) }, search$] }];
  }

  const [items, total] = await Promise.all([
    Ticket.find(final).populate(POPULATE).sort({ lastActivityAt: -1 }).skip(skip).limit(limit).lean(),
    Ticket.countDocuments(final),
  ]);
  return { items: items.map((t) => shape(t, auth, { comments: false })), page, limit, total };
}

async function get(id, auth) {
  const ticket = await Ticket.findById(id).populate(POPULATE).lean();
  if (!ticket) throw AppError.notFound("Ticket");
  if (!isAgent(auth) && String(ticket.requesterUserId._id || ticket.requesterUserId) !== String(auth.userId)) throw AppError.notFound("Ticket");
  return shape(ticket, auth);
}

async function loadFor(id, auth) {
  const ticket = await Ticket.findById(id);
  if (!ticket) throw AppError.notFound("Ticket");
  const own = String(ticket.requesterUserId) === String(auth.userId);
  if (!isAgent(auth) && !own) throw AppError.notFound("Ticket");
  return { ticket, own };
}

async function comment(id, { body, internal, attachmentFileIds }, auth, req) {
  const { ticket, own } = await loadFor(id, auth);
  if (internal && !isAgent(auth)) throw AppError.forbidden("Only agents can add internal notes.");
  if (["closed"].includes(ticket.status)) throw AppError.conflict("This ticket is closed. Open a new one.");

  ticket.comments.push({ authorUserId: auth.userId, authorName: auth.name, body, internal: Boolean(internal), attachmentFileIds: attachmentFileIds || [] });
  ticket.lastActivityAt = new Date();
  if (!own && !internal && !ticket.firstResponseAt) ticket.firstResponseAt = new Date();
  // A requester replying re-opens a "waiting on you" ticket; an agent replying
  // on an open ticket moves it into progress.
  if (own && ticket.status === "waiting_on_requester") ticket.status = "in_progress";
  if (!own && !internal && ticket.status === "open") ticket.status = "in_progress";
  if (own && ticket.status === "resolved") ticket.status = "in_progress";
  await ticket.save();

  if (!internal) {
    const target = own ? await assigneeOrAgents(ticket) : [await requesterRecipient(ticket)];
    notifications
      .notify({
        template: "ticket_commented",
        recipients: target.filter(Boolean),
        organization: await recipients.organization(),
        data: { ticket: { id: String(ticket._id), number: ticket.number, subject: ticket.subject }, comment: { author: auth.name, preview: body.slice(0, 200) }, actor: { userId: auth.userId } },
        entity: { type: "Ticket", id: ticket._id },
      })
      .catch(() => {});
  }
  return shape(await Ticket.findById(ticket._id).populate(POPULATE).lean(), auth);
}

async function assigneeOrAgents(ticket) {
  if (ticket.assigneeUserId) {
    const user = await User.findById(ticket.assigneeUserId).select("email firstName lastName").lean();
    return user ? [recipients.userToRecipient(user)] : [];
  }
  return recipients.usersWithPermission("ticket.manage");
}

async function requesterRecipient(ticket) {
  const user = await User.findById(ticket.requesterUserId).select("email firstName lastName").lean();
  return user ? recipients.userToRecipient(user) : null;
}

async function update(id, data, auth, req) {
  if (!isAgent(auth)) throw AppError.forbidden();
  const ticket = await Ticket.findById(id);
  if (!ticket) throw AppError.notFound("Ticket");
  const before = { status: ticket.status, priority: ticket.priority, assigneeUserId: ticket.assigneeUserId, category: ticket.category };

  if (data.assigneeUserId !== undefined) {
    if (data.assigneeUserId) {
      const agents = await recipients.usersWithPermission("ticket.manage");
      if (!agents.some((a) => String(a.userId) === String(data.assigneeUserId))) throw AppError.badRequest("That person is not a help desk agent.");
    }
    ticket.assigneeUserId = data.assigneeUserId || null;
  }
  for (const key of ["priority", "category", "tags", "subject"]) if (data[key] !== undefined) ticket[key] = data[key];
  if (data.status !== undefined) await transition(ticket, data.status, data.resolutionNote);
  ticket.lastActivityAt = new Date();
  await ticket.save();

  await audit.record({ action: "ticket.updated", entityType: "Ticket", entityId: ticket._id, entityLabel: `#${ticket.number} ${ticket.subject}`, before, after: { status: ticket.status, priority: ticket.priority, assigneeUserId: ticket.assigneeUserId, category: ticket.category }, skipIfUnchanged: true }, req);

  const organization = await recipients.organization();
  if (data.assigneeUserId && String(before.assigneeUserId || "") !== String(data.assigneeUserId)) {
    const user = await User.findById(data.assigneeUserId).select("email firstName lastName").lean();
    if (user) {
      notifications
        .notify({ template: "ticket_assigned", recipients: [recipients.userToRecipient(user)], organization, data: { ticket: { id: String(ticket._id), number: ticket.number, subject: ticket.subject, priority: humanise(ticket.priority) }, actor: { userId: auth.userId } }, entity: { type: "Ticket", id: ticket._id } })
        .catch(() => {});
    }
  }
  if (data.status && data.status !== before.status && ["resolved", "closed", "waiting_on_requester"].includes(data.status)) {
    const requester = await requesterRecipient(ticket);
    if (requester) {
      notifications
        .notify({
          template: data.status === "waiting_on_requester" ? "ticket_waiting" : "ticket_resolved",
          recipients: [requester],
          organization,
          data: { ticket: { id: String(ticket._id), number: ticket.number, subject: ticket.subject, status: humanise(ticket.status), note: ticket.resolutionNote ? ` ${ticket.resolutionNote}` : "" }, actor: { userId: auth.userId } },
          severity: "success",
          entity: { type: "Ticket", id: ticket._id },
        })
        .catch(() => {});
    }
  }
  return shape(await Ticket.findById(ticket._id).populate(POPULATE).lean(), auth);
}

async function transition(ticket, status, resolutionNote) {
  if (!TICKET_STATUSES.includes(status)) throw AppError.badRequest("Unknown status.");
  if (status === "resolved" || status === "closed") {
    ticket.resolvedAt = ticket.resolvedAt || new Date();
    if (resolutionNote !== undefined) ticket.resolutionNote = resolutionNote;
  }
  if (status === "closed") ticket.closedAt = new Date();
  if (["open", "in_progress"].includes(status)) {
    ticket.resolvedAt = null;
    ticket.closedAt = null;
  }
  ticket.status = status;
}

/** The requester closes their own ticket, optionally rating the help. */
async function close(id, { rating, ratingComment }, auth, req) {
  const { ticket, own } = await loadFor(id, auth);
  if (!own && !isAgent(auth)) throw AppError.forbidden();
  await transition(ticket, "closed");
  if (own && rating) {
    ticket.rating = rating;
    ticket.ratingComment = ratingComment || "";
  }
  ticket.lastActivityAt = new Date();
  await ticket.save();
  await audit.record({ action: "ticket.closed", entityType: "Ticket", entityId: ticket._id, entityLabel: `#${ticket.number} ${ticket.subject}`, after: { rating }, severity: "info" }, req);
  return shape(await Ticket.findById(ticket._id).populate(POPULATE).lean(), auth);
}

async function reopen(id, auth, req) {
  const { ticket } = await loadFor(id, auth);
  if (!["resolved", "closed"].includes(ticket.status)) throw AppError.conflict("Only a resolved or closed ticket can be reopened.");
  await transition(ticket, "in_progress");
  ticket.lastActivityAt = new Date();
  await ticket.save();
  await audit.record({ action: "ticket.reopened", entityType: "Ticket", entityId: ticket._id, entityLabel: `#${ticket.number} ${ticket.subject}`, severity: "notice" }, req);
  const agents = await assigneeOrAgents(ticket);
  notifications
    .notify({ template: "ticket_commented", recipients: agents, organization: await recipients.organization(), data: { ticket: { id: String(ticket._id), number: ticket.number, subject: ticket.subject }, comment: { author: auth.name, preview: "Reopened the ticket." }, actor: { userId: auth.userId } }, entity: { type: "Ticket", id: ticket._id } })
    .catch(() => {});
  return shape(await Ticket.findById(ticket._id).populate(POPULATE).lean(), auth);
}

/** Queue numbers for the agent dashboard. */
async function stats(auth) {
  if (!isAgent(auth)) throw AppError.forbidden();
  const now = new Date();
  const [open, inProgress, waiting, unassigned, overdue, mine, resolvedThisWeek] = await Promise.all([
    Ticket.countDocuments({ status: "open" }),
    Ticket.countDocuments({ status: "in_progress" }),
    Ticket.countDocuments({ status: "waiting_on_requester" }),
    Ticket.countDocuments({ status: { $in: ["open", "in_progress"] }, assigneeUserId: null }),
    Ticket.countDocuments({ status: { $in: ["open", "in_progress"] }, dueAt: { $lt: now } }),
    Ticket.countDocuments({ status: { $in: ["open", "in_progress", "waiting_on_requester"] }, assigneeUserId: auth.userId }),
    Ticket.countDocuments({ resolvedAt: { $gte: new Date(now - 7 * 86400000) } }),
  ]);
  const mongoose = require("mongoose");
  const rated = await Ticket.aggregate([{ $match: { organizationId: new mongoose.Types.ObjectId(String(tenant.requireOrganizationId())), rating: { $ne: null } } }, { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } }]);
  return { open, inProgress, waiting, unassigned, overdue, mine, resolvedThisWeek, averageRating: rated[0] ? Math.round(rated[0].avg * 10) / 10 : null, ratings: rated[0] ? rated[0].count : 0 };
}

async function agents() {
  const list = await recipients.usersWithPermission("ticket.manage", { limit: 200 });
  return list.map((a) => ({ id: String(a.userId), name: a.name, email: a.email }));
}

function shape(t, auth, { comments = true } = {}) {
  const agent = auth ? isAgent(auth) : false;
  const requester = t.requesterUserId && t.requesterUserId.email ? t.requesterUserId : null;
  const assignee = t.assigneeUserId && t.assigneeUserId.email ? t.assigneeUserId : null;
  const employee = t.requesterEmployeeId && t.requesterEmployeeId.employeeCode ? t.requesterEmployeeId : null;
  return {
    id: String(t._id),
    number: t.number,
    subject: t.subject,
    description: t.description,
    category: t.category,
    priority: t.priority,
    status: t.status,
    requester: requester ? { id: String(requester._id), name: [requester.firstName, requester.lastName].filter(Boolean).join(" "), email: requester.email, employeeCode: employee ? employee.employeeCode : null, department: employee && employee.employment && employee.employment.departmentId ? employee.employment.departmentId.name : null } : { id: String(t.requesterUserId) },
    assignee: assignee ? { id: String(assignee._id), name: [assignee.firstName, assignee.lastName].filter(Boolean).join(" "), email: assignee.email } : null,
    attachmentFileIds: (t.attachmentFileIds || []).map(String),
    comments: comments ? (t.comments || []).filter((c) => agent || !c.internal).map((c) => ({ id: String(c._id), authorUserId: String(c.authorUserId), authorName: c.authorName, body: c.body, internal: c.internal, attachmentFileIds: (c.attachmentFileIds || []).map(String), createdAt: c.createdAt })) : undefined,
    commentCount: (t.comments || []).filter((c) => agent || !c.internal).length,
    dueAt: t.dueAt,
    isOverdue: Boolean(t.dueAt && ["open", "in_progress"].includes(t.status) && new Date(t.dueAt) < new Date()),
    firstResponseAt: t.firstResponseAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    resolutionNote: t.resolutionNote,
    rating: t.rating,
    ratingComment: t.ratingComment,
    tags: t.tags || [],
    lastActivityAt: t.lastActivityAt,
    createdAt: t.createdAt,
  };
}

function humanise(value) {
  return String(value || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

module.exports = { create, list, get, comment, update, close, reopen, stats, agents, shape, Ticket };
