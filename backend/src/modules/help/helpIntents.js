"use strict";

const { TOURS_BY_ID } = require("./tours");

/**
 * Intent matching for the help assistant.
 *
 * Deliberately local: scoring is a keyword/phrase match run in-process, with
 * no external AI call. The help system has to work in an air-gapped
 * deployment, when an API key expires, and when a customer's network blocks
 * outbound calls — an HR admin asking "how do I configure half day" must never
 * get a spinner and a timeout.
 *
 * The structure is ready for an LLM to sit in FRONT of it later: a model would
 * map free text to an intent id, and everything downstream stays identical.
 */

const INTENTS = [
  {
    id: "create_leave_policy",
    tourId: "create_leave_policy",
    phrases: [
      "how do i create a leave policy",
      "create leave policy",
      "set up leave",
      "configure leave rules",
      "add leave type",
      "leave allocation",
      "how many leaves per year",
      "casual leave setup",
      "annual leave configuration",
    ],
    keywords: ["leave", "policy", "casual", "sick", "earned", "allocation", "carry forward"],
    answer:
      "Leave policies live under Settings → Leave policies. A policy groups one rule per leave type: how many days, when they are credited, whether unused days carry forward, and who approves.",
  },
  {
    id: "add_employee",
    tourId: "add_employee",
    phrases: [
      "how do i add an employee",
      "create employee",
      "new joiner",
      "onboard employee",
      "add staff",
      "register employee",
    ],
    keywords: ["employee", "add", "new", "joiner", "onboard", "staff", "hire"],
    answer:
      "Employees → Add employee. Only a name and a joining date are required; everything else can be filled in later. Employee codes are generated automatically from your numbering settings.",
  },
  {
    id: "configure_half_day",
    tourId: "configure_half_day",
    phrases: [
      "how do i configure half day",
      "half day rule",
      "half day hours",
      "when is someone marked half day",
      "attendance half day setting",
      "minimum hours for half day",
    ],
    keywords: ["half", "day", "hours", "threshold", "attendance", "absent"],
    answer:
      "Half-day rules are part of an attendance policy: Settings → Attendance policies. You can set the threshold as a percentage of the shift or as fixed hours, and separately make a very late arrival count as a half day.",
  },
  {
    id: "connect_biometric_device",
    tourId: "connect_biometric_device",
    phrases: [
      "how do i configure biometric",
      "connect biometric device",
      "add attendance machine",
      "setup fingerprint device",
      "zkteco setup",
      "essl device",
      "punch machine not syncing",
    ],
    keywords: ["biometric", "device", "fingerprint", "machine", "punch", "sync", "zkteco", "essl"],
    answer:
      "Settings → Biometric → Add device. Devices on your office LAN cannot be reached from the cloud directly — use Webhook mode with our LAN bridge, or File import, both of which work without opening your network.",
  },
  {
    id: "run_payroll",
    tourId: "run_payroll",
    phrases: [
      "how do i generate payroll",
      "run payroll",
      "process salary",
      "monthly salary processing",
      "generate payslips",
      "pay employees",
    ],
    keywords: ["payroll", "salary", "payslip", "process", "run", "pay"],
    answer:
      "Payroll → New run. Process it, review the exceptions, approve, then publish payslips. Payroll reads attendance rather than recalculating it, so process attendance for the month first.",
  },
  {
    id: "change_company_logo",
    tourId: "change_company_logo",
    phrases: [
      "how do i change the company logo",
      "upload logo",
      "change branding",
      "company colours",
      "customise theme",
      "brand colors",
    ],
    keywords: ["logo", "brand", "branding", "colour", "color", "theme", "letterhead"],
    answer:
      "Settings → Branding. Your logo and primary colour flow through the whole app, your outbound emails, and every generated PDF.",
  },
  {
    id: "create_shift",
    tourId: "create_shift",
    phrases: [
      "how do i create a shift",
      "add shift timing",
      "night shift setup",
      "shift configuration",
      "working hours setup",
    ],
    keywords: ["shift", "timing", "night", "hours", "roster"],
    answer:
      "Settings → Shifts. Enter a start and end time; if the end is earlier than the start we treat it as a night shift automatically and attribute the punches to the right day.",
  },
  {
    id: "import_employees",
    tourId: "import_employees",
    phrases: [
      "how do i import employees",
      "bulk upload employees",
      "excel import",
      "csv import staff",
      "upload employee list",
    ],
    keywords: ["import", "bulk", "upload", "excel", "csv", "spreadsheet"],
    answer:
      "Employees → Import. Download the template first — it already contains your custom fields. Nothing is written until you have seen the validation report.",
  },

  // Intents without a tour: a direct answer is the right response.
  {
    id: "apply_leave",
    phrases: ["how do i apply for leave", "request time off", "book holiday", "apply leave"],
    keywords: ["apply", "leave", "request", "time off", "holiday"],
    route: "/me/leave",
    answer:
      "Open **My leave → Apply**. Pick the type and dates, and the form shows exactly how many days will be deducted before you submit — including how weekends inside the range are treated.",
  },
  {
    id: "regularize_attendance",
    phrases: [
      "i forgot to punch",
      "missing punch",
      "attendance correction",
      "regularize attendance",
      "wrong attendance",
    ],
    keywords: ["forgot", "punch", "missing", "correction", "regularize", "regularise"],
    route: "/me/attendance",
    answer:
      "Open **My attendance**, find the day, and choose **Request correction**. Your manager approves it and the day is recalculated automatically. Your policy sets how far back you can go.",
  },
  {
    id: "view_payslip",
    phrases: ["where is my payslip", "download payslip", "salary slip", "view payslip"],
    keywords: ["payslip", "salary", "slip", "download"],
    route: "/me/payslips",
    answer: "**My payslips** in the portal. Every published payslip stays available to download as a PDF.",
  },
  {
    id: "approve_leave",
    phrases: ["how do i approve leave", "approve request", "pending approvals", "team leave requests"],
    keywords: ["approve", "approval", "pending", "reject"],
    route: "/app/approvals",
    answer:
      "**Approvals** in the sidebar shows everything waiting on you. Approving a leave request updates the employee's balance and their attendance for those days immediately.",
  },
  {
    id: "add_holiday",
    phrases: ["add holiday", "holiday calendar", "public holidays", "festival list"],
    keywords: ["holiday", "calendar", "festival", "public"],
    route: "/app/settings/holidays",
    answer:
      "Settings → Holidays. Create a calendar for the year, then add holidays — or paste the whole list at once. Different locations can have different calendars.",
  },
  {
    id: "invite_user",
    phrases: ["invite user", "give access", "add hr user", "create login", "add admin"],
    keywords: ["invite", "access", "login", "user", "admin", "permission"],
    route: "/app/settings/users",
    answer:
      "Settings → Users → Invite. Choose their role, and they will receive an email to set their own password. Roles decide exactly what they can see and do.",
  },
  {
    id: "create_role",
    phrases: ["create role", "custom permissions", "restrict access", "role permissions"],
    keywords: ["role", "permission", "access", "restrict"],
    route: "/app/settings/roles",
    answer:
      "Settings → Roles. Start from an existing role, copy it, and adjust the permissions. Nothing in the platform keys off a role's name, so you can name them whatever suits your organization.",
  },
  {
    id: "lock_attendance",
    phrases: ["lock attendance", "freeze attendance", "close the month"],
    keywords: ["lock", "freeze", "close", "period"],
    route: "/app/attendance",
    answer:
      "Attendance → Locks → Lock period. Locked days cannot be edited or recalculated, which is what payroll depends on. Unlocking is possible but is recorded as a critical audit event.",
  },
  {
    id: "use_the_api",
    phrases: [
      "how do i use the api",
      "api documentation",
      "connect another system",
      "integrate with our erp",
      "rest api",
      "api base url",
      "how to call the api",
      "api key",
      "developer docs",
    ],
    keywords: ["api", "integration", "integrate", "developer", "rest", "endpoint", "key", "token", "curl"],
    route: "/app/settings/integrations",
    answer:
      "Settings → API & webhooks → Guide & testing. It shows your base URL, how to create a key, working examples in curl, JavaScript, Python and PHP, a console that sends a real request from the page, the full endpoint list with the permission each one needs, and a Postman collection to download.",
  },
  {
    id: "test_the_api",
    phrases: [
      "test the api",
      "postman collection",
      "try an api request",
      "api not working",
      "401 unauthorized api",
      "403 forbidden api",
      "api returns error",
    ],
    keywords: ["postman", "test", "401", "403", "unauthorized", "forbidden", "curl", "insomnia"],
    route: "/app/settings/integrations",
    answer:
      "Use the request console in Settings → API & webhooks → Guide & testing: paste a key, pick an endpoint, press Send. A 401 means the key is wrong, expired or revoked; a 403 means the key is valid but lacks that permission, which the endpoint reference names. The same screen downloads a Postman collection of every endpoint.",
  },
  {
    id: "set_up_webhook",
    phrases: [
      "set up a webhook",
      "webhook",
      "get notified when something happens",
      "push events to my system",
      "webhook signature",
      "verify webhook",
    ],
    keywords: ["webhook", "event", "signature", "hmac", "callback", "push", "subscribe"],
    route: "/app/settings/integrations",
    answer:
      "Settings → API & webhooks → Webhooks. Add a URL that answers 200 within ten seconds, tick the events, and copy the signing secret shown once. Press Test to send a synthetic event. Verify the X-Chefotech-Signature header before trusting a payload — the guide tab has copy-paste code for Node, Python and PHP.",
  },
  {
    id: "sandwich_leave",
    phrases: [
      "sandwich leave rule",
      "weekend counted in leave",
      "why were 4 days deducted",
      "holiday inside leave",
    ],
    keywords: ["sandwich", "weekend", "deducted", "between", "holiday"],
    answer:
      "That is the counting rule on the leave type, in your leave policy. There are three options: exclude days off entirely, count every calendar day, or the sandwich rule — where a weekend is deducted only when there is leave on both sides of it.",
  },
];

/** Normalise text for comparison. */
function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "how", "do", "i", "to", "the", "a", "an", "in", "on", "for", "of", "is",
  "can", "my", "me", "we", "what", "where", "and", "with", "does", "it",
]);

/**
 * Score a query against every intent and return the best matches.
 *
 * The scoring is intentionally simple and inspectable:
 *   exact phrase match      100
 *   phrase substring        60 + overlap
 *   keyword hits            12 each
 *   title/word overlap      4 each
 */
function match(query, { permissions = [], limit = 4 } = {}) {
  const text = normalise(query);
  if (!text) return [];

  const words = text.split(" ").filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const results = [];

  for (const intent of INTENTS) {
    let score = 0;
    let reason = "";

    for (const phrase of intent.phrases) {
      const normalisedPhrase = normalise(phrase);
      if (normalisedPhrase === text) {
        score = Math.max(score, 100);
        reason = "exact";
      } else if (text.includes(normalisedPhrase) || normalisedPhrase.includes(text)) {
        const overlap = Math.min(text.length, normalisedPhrase.length) /
          Math.max(text.length, normalisedPhrase.length);
        score = Math.max(score, 60 + overlap * 20);
        reason = reason || "phrase";
      }
    }

    for (const keyword of intent.keywords) {
      if (words.includes(normalise(keyword))) {
        score += 12;
        reason = reason || "keyword";
      }
    }

    const tour = intent.tourId ? TOURS_BY_ID[intent.tourId] : null;
    if (tour) {
      const titleWords = normalise(tour.title).split(" ");
      for (const word of words) if (titleWords.includes(word)) score += 4;
    }

    if (score <= 0) continue;

    // Never offer a walkthrough the user is not allowed to complete.
    if (tour && tour.permission && permissions.length && !permissions.includes(tour.permission)) {
      continue;
    }

    results.push({
      intentId: intent.id,
      score: Math.round(score),
      matchedOn: reason,
      answer: intent.answer,
      route: intent.route || (tour && tour.steps[0] && tour.steps[0].route) || null,
      tour: tour
        ? {
            id: tour.id,
            title: tour.title,
            description: tour.description,
            stepCount: tour.steps.length,
            estimatedMinutes: tour.estimatedMinutes,
          }
        : null,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Suggestions shown before the user types anything. */
function suggestions(permissions = []) {
  return INTENTS.filter((intent) => {
    const tour = intent.tourId ? TOURS_BY_ID[intent.tourId] : null;
    if (!tour) return true;
    return !tour.permission || !permissions.length || permissions.includes(tour.permission);
  })
    .slice(0, 8)
    .map((intent) => ({
      intentId: intent.id,
      question: intent.phrases[0].replace(/^./, (c) => c.toUpperCase()),
      tourId: intent.tourId || null,
    }));
}

module.exports = { INTENTS, match, suggestions, normalise };
