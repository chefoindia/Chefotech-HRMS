"use strict";

/**
 * The rules a new organization starts with.
 *
 * An empty rules screen is a worse default than a slightly noisy one. An
 * administrator opening this for the first time should see the notifications
 * any HR team would have asked for anyway, already switched on and worded in
 * terms they recognise — and then edit or disable what does not fit, which is
 * a far easier job than working out from a blank page which of twenty events
 * are worth wiring up.
 *
 * Every one of these is additive over what the product already sends. The
 * employee is told their own leave was approved by the code; these rules are
 * about the people around them — the manager who needs to plan cover, the
 * payroll clerk who needs to know before a run, the HR admin who is
 * accountable when something is missed.
 *
 * Deliberately conservative:
 *
 *   Nothing here mails an entire company. Every recipient is either the person
 *   the event is about, their manager, their department head, or a named role.
 *   A default that emails 400 people on every join is how a customer's first
 *   week ends with the notification system turned off entirely.
 *
 *   Anything that carries money or personal data goes to a role, never a
 *   broad audience. A payslip notification copied to the wrong list is a
 *   payroll breach, not an annoyance.
 *
 *   `channels: null` means "whatever the template already declares", so these
 *   inherit the in-app/email split that was chosen per message rather than
 *   forcing email on everything.
 */

const DEFAULT_RULES = [
  // ── Leave ────────────────────────────────────────────────────────────────
  {
    name: "Tell the manager when their report applies for leave",
    description:
      "The approver needs to see a request to act on it. Without this the request only appears in their approvals queue, which is easy to miss on a busy day.",
    event: "leave.applied",
    recipients: [{ type: "reporting_manager" }],
  },
  {
    name: "Tell the manager when a long leave is approved",
    description:
      "Short absences look after themselves. A week or more means arranging cover, so the manager is told even when someone else approved it.",
    event: "leave.approved",
    condition: "days >= 5",
    recipients: [{ type: "reporting_manager" }],
  },
  {
    name: "Copy HR when leave is rejected",
    description:
      "Rejections are the ones that get disputed. HR having a record of them as they happen, rather than reconstructing it later, is what makes the conversation short.",
    event: "leave.rejected",
    recipients: [{ type: "role", roleName: "HR Manager" }],
  },

  // ── Attendance ───────────────────────────────────────────────────────────
  {
    name: "Tell the manager about a missing punch",
    description:
      "A missing punch becomes a pay dispute at the end of the month. Raising it the same day is the difference between a correction and an argument.",
    event: "attendance.missing_punch",
    recipients: [{ type: "reporting_manager" }],
  },
  {
    name: "Tell the manager when a correction is requested",
    description:
      "Attendance corrections change what someone is paid, so the person who can confirm what actually happened should see the request.",
    event: "attendance.correction_requested",
    recipients: [{ type: "reporting_manager" }],
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  {
    name: "Tell payroll when a run completes",
    description:
      "The run finishing is the cue to review and release payslips. It goes to the payroll role rather than an individual so it survives that person being on leave.",
    event: "payroll.completed",
    recipients: [{ type: "role", roleName: "Payroll Admin" }],
    channels: ["in_app", "email"],
  },

  // ── People ───────────────────────────────────────────────────────────────
  {
    name: "Tell the department head when someone joins their team",
    description:
      "The head of the department the new joiner lands in usually finds out last. This tells them on the day the record is created, not on the day the person appears.",
    event: "employee.joined",
    recipients: [{ type: "department_head" }],
  },
  {
    name: "Tell HR when a document is about to expire",
    description:
      "Expiring identity and right-to-work documents are a compliance problem the moment they lapse, and the employee often does not notice. HR is the one who has to chase it.",
    event: "document.expiring",
    recipients: [{ type: "role", roleName: "HR Manager" }],
    channels: ["in_app", "email"],
  },

  // ── Approvals ────────────────────────────────────────────────────────────
  {
    name: "Tell the department head when an approval escalates",
    description:
      "An escalation means a step went unanswered long enough to time out. Somebody above the stalled approver needs to know it happened, or it simply stalls again.",
    event: "workflow.escalated",
    recipients: [{ type: "department_head" }],
    channels: ["in_app", "email"],
  },
];

/**
 * Resolve the role names above into ids for this organization.
 *
 * The defaults name roles rather than carrying ids because ids do not exist
 * until a tenant is created. A role that is missing — a customer who deleted
 * "Payroll Admin", or renamed it — means that rule is skipped rather than
 * seeded pointing at nothing, which would look active while reaching nobody.
 */
async function materialise(Role) {
  const roles = await Role.find({}).select("name").lean();
  const byName = new Map(roles.map((role) => [role.name.toLowerCase(), role._id]));

  const out = [];
  const skipped = [];

  for (const rule of DEFAULT_RULES) {
    const recipients = [];
    let resolvable = true;

    for (const spec of rule.recipients) {
      if (spec.type !== "role") {
        recipients.push({ ...spec });
        continue;
      }
      const roleId = byName.get(String(spec.roleName).toLowerCase());
      if (!roleId) {
        resolvable = false;
        break;
      }
      recipients.push({ type: "role", roleIds: [roleId] });
    }

    if (!resolvable) {
      skipped.push({ name: rule.name, reason: "a role it names does not exist here" });
      continue;
    }

    const { roleName, ...rest } = rule;
    out.push({ ...rest, recipients, isActive: true, isSystemDefault: true });
  }

  return { rules: out, skipped };
}

module.exports = { DEFAULT_RULES, materialise };
