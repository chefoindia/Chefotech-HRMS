"use strict";

const ai = require("./ai.service");

/**
 * The two AI features built on top of ai.service.run().
 *
 * Both share one discipline: the prompt tells Gemini exactly what this
 * product is and is not, so answers stay grounded in the real platform
 * instead of generic HR-software advice that happens to be wrong here. A
 * setup assistant that confidently describes a button that does not exist is
 * worse than one that says "I'm not sure."
 */

const PRODUCT_PRIMER = `You are the setup assistant built into Chefotech HRMS, a multi-tenant HR
platform. You help an HR administrator who is configuring their organization's
policies right now, mid-task, inside the product.

What is actually true about this platform — do not contradict this:
- Attendance policies set grace periods, late-mark thresholds, and half-day /
  full-day thresholds either as a percentage of the shift or as fixed hours.
- Shifts with an end time earlier than the start time are treated as
  overnight shifts automatically; one attendance record is produced for the
  night the shift started.
- Leave policies attach one rule per leave type. Each rule sets how days are
  allocated (all at once yearly, monthly, quarterly, accrued per month,
  unlimited, or not allocated at all), whether unused days carry forward or
  are encashed, and how weekends/holidays inside a request are counted:
  "exclude" (never deducted), "include" (always deducted), or "sandwich"
  (deducted only when leave falls on both sides of the gap).
- Payroll salary components are small formulas evaluated in a defined order;
  there is no code execution, only arithmetic, comparisons and a fixed set of
  named functions.
- Roles are fully custom — nothing in the product keys off a role's name, only
  its permissions.
- Biometric devices connect over an API pull, a webhook push (for devices on
  a private network), or by importing the device's own log file.

Rules for your answers:
1. Answer only what was actually asked, in 2-4 short sentences. This is a
   sidebar in a busy screen, not a document.
2. If you are not certain a described step matches this product, say so
   plainly rather than inventing plausible-sounding UI.
3. Never ask the admin to contact support for something you can explain
   yourself — you exist specifically so they do not have to.
4. Do not discuss anything outside HR software configuration, even if asked.`;

async function answer({ question, screen, fieldLabel, fieldHint }) {
  const context = [
    screen ? `They are currently on the "${screen}" screen.` : null,
    fieldLabel ? `The specific field they are asking about is "${fieldLabel}".` : null,
    fieldHint ? `That field's own description reads: "${fieldHint}"` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const prompt = `${context ? context + "\n\n" : ""}Their question: ${question}`;

  const { text } = await ai.run({
    prompt,
    systemInstruction: PRODUCT_PRIMER,
    temperature: 0.3,
  });

  return { answer: text.trim() };
}

/**
 * Turns one sentence into a leave rule shaped exactly like the real form —
 * same field names, same enum values — so accepting it is a copy, not a
 * translation. `leaveTypeId` is deliberately absent: that binding happens
 * when a human applies the draft to a real leave type, which is also where
 * the real permission check lives.
 */
const LEAVE_RULE_SCHEMA = {
  type: "object",
  properties: {
    suggestedLeaveTypeName: { type: "string" },
    explanation: {
      type: "string",
      description: "One or two sentences: what was set, and why, in terms an HR admin would use.",
    },
    rule: {
      type: "object",
      properties: {
        allocation: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["annual", "monthly", "quarterly", "accrual", "unlimited", "none"] },
            daysPerPeriod: { type: "number" },
            prorateOnJoining: { type: "boolean" },
          },
        },
        carryForward: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            maximumDays: { type: "number" },
            expiryMonths: { type: "integer" },
          },
        },
        encashment: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            maximumDays: { type: "number" },
          },
        },
        application: {
          type: "object",
          properties: {
            maximumDaysPerRequest: { type: "number" },
            noticeDays: { type: "integer" },
            allowBackdated: { type: "boolean" },
          },
        },
        counting: {
          type: "object",
          properties: {
            holidays: { type: "string", enum: ["exclude", "include", "sandwich"] },
            weeklyOffs: { type: "string", enum: ["exclude", "include", "sandwich"] },
          },
        },
      },
    },
  },
  required: ["suggestedLeaveTypeName", "explanation", "rule"],
};

async function draftLeavePolicy(instruction) {
  const { json } = await ai.run({
    prompt: `An HR administrator described a leave policy they want in their own words:\n\n"${instruction}"\n\nPropose a rule for it.`,
    systemInstruction:
      PRODUCT_PRIMER +
      `\n\nYou are now drafting a structured leave rule from a plain-English description. ` +
      `Pick sensible values for anything the admin did not specify explicitly — a typical ` +
      `Indian workplace default is a reasonable choice when nothing else is implied. ` +
      `Only set counting.weeklyOffs or counting.holidays to "sandwich" if the description ` +
      `actually implies that weekends stuck between leave days should be charged.`,
    responseSchema: LEAVE_RULE_SCHEMA,
    temperature: 0.2,
  });

  return json;
}

module.exports = { answer, draftLeavePolicy, PRODUCT_PRIMER };
