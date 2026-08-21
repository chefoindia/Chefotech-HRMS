/**
 * Product documentation, as data.
 *
 * One source feeds three places: the public documentation site, the in-app
 * help centre, and the search behind the help assistant. Written separately
 * they drift, and the version a customer reads before buying stops matching
 * the one their admin reads afterwards.
 *
 * Each article explains what a feature is FOR before it explains where the
 * buttons are. An HR admin arriving at "sandwich leave" needs to know what the
 * rule does to a balance, not that there is a dropdown labelled "counting
 * mode".
 */

export interface DocArticle {
  slug: string;
  title: string;
  summary: string;
  category: string;
  /** Where this lives in the product, so the reader can go and try it. */
  appPath?: string;
  /** Tour that walks the reader through it, if one exists. */
  tourId?: string;
  sections: { heading: string; body: (string | string[])[] }[];
  related?: string[];
}

export const DOC_CATEGORIES = [
  {
    id: "getting-started",
    title: "Getting started",
    description: "Set the platform up for your organisation, in the order that works.",
  },
  {
    id: "people",
    title: "People",
    description: "Employee records, org structure and documents.",
  },
  {
    id: "attendance",
    title: "Attendance and time",
    description: "Shifts, policies, biometric devices and corrections.",
  },
  { id: "leave", title: "Leave", description: "Types, policies, balances and approvals." },
  { id: "payroll", title: "Payroll", description: "Components, structures and pay runs." },
  {
    id: "administration",
    title: "Administration",
    description: "Users, roles, security, audit and billing.",
  },
] as const;

export const DOC_ARTICLES: DocArticle[] = [
  // ── Getting started ─────────────────────────────────────────────────────
  {
    slug: "quick-start",
    title: "Your first hour",
    summary: "The shortest path from an empty account to running attendance and leave.",
    category: "getting-started",
    appPath: "/onboarding",
    sections: [
      {
        heading: "The order matters",
        body: [
          "Almost everything in the platform depends on something else. Set things up in this order and nothing has to be redone:",
          [
            "1. Company details and branding — these appear on every document and email the platform sends.",
            "2. Locations and departments — employees are assigned to these, so they have to exist first.",
            "3. Shifts — when work happens. An attendance policy interprets a shift, so shifts come first.",
            "4. Attendance policy — what counts as late, half day, or absent.",
            "5. Holiday calendar and weekly offs — these change what a working day is, which changes attendance and leave.",
            "6. Leave types, then a leave policy that gives each type its rules.",
            "7. Employees — import them in bulk or add them one at a time.",
            "8. Salary components and a structure, if you are running payroll here.",
          ],
          "The setup checklist on your dashboard tracks this and shows what is still outstanding.",
        ],
      },
      {
        heading: "What you can skip for now",
        body: [
          "Payroll, biometric devices and document templates can all wait. Attendance and leave work without them, and you can add them once people are using the system.",
          "You cannot skip shifts or an attendance policy — without them the platform has no basis on which to decide whether someone was present.",
        ],
      },
    ],
    related: ["import-employees", "attendance-policy", "leave-policy"],
  },
  {
    slug: "import-employees",
    title: "Importing employees in bulk",
    summary: "Bring an existing staff list in from a spreadsheet without creating duplicates.",
    category: "getting-started",
    appPath: "/app/employees/import",
    tourId: "import_employees",
    sections: [
      {
        heading: "Start from the template",
        body: [
          "Download the template from the import screen rather than building your own. It is generated from your account, so it already contains any custom employee fields you have added, and the column headings match exactly what the importer expects.",
        ],
      },
      {
        heading: "Nothing is written until you have seen the report",
        body: [
          "The import runs in two passes. The first validates every row and reports what it found — missing required fields, departments that do not exist, dates it could not read, duplicate employee codes. Nothing is saved at this point.",
          "Only when you confirm does it write. A row that fails validation is skipped and reported; it does not stop the rest of the file.",
        ],
      },
      {
        heading: "Common problems",
        body: [
          [
            "Dates rejected — use YYYY-MM-DD. Spreadsheets often reformat dates on save, so check the file after Excel has touched it.",
            "Department or designation not found — these must exist before the import. The report names the exact value it could not match.",
            "Duplicate employee code — codes must be unique. If you leave the column blank, the platform generates one from your numbering settings.",
            "Biometric ID collisions — two employees cannot share a device ID; attendance would be attributed to whichever record was found first.",
          ],
        ],
      },
    ],
    related: ["quick-start", "employee-records"],
  },

  // ── People ──────────────────────────────────────────────────────────────
  {
    slug: "employee-records",
    title: "Employee records",
    summary: "What a profile holds, and how to add fields the platform did not ship with.",
    category: "people",
    appPath: "/app/employees",
    tourId: "add_employee",
    sections: [
      {
        heading: "Only two things are required",
        body: [
          "A name and a joining date. Everything else can be filled in later, by you or by the employee from their own portal.",
          "This is deliberate: onboarding a new joiner on their first morning should not be blocked because their PAN has not arrived yet.",
        ],
      },
      {
        heading: "Custom fields",
        body: [
          "Settings → Employee fields lets you add fields specific to your organisation — a union membership number, a shift preference, a site pass expiry. They appear on the profile, in the import template, and in reports.",
          "Collect what you have a reason to hold. A custom field is easy to add and easy to forget, and unused personal data is a liability rather than an asset.",
        ],
      },
      {
        heading: "Who can see what",
        body: [
          "Visibility follows roles. An employee sees their own record. A manager sees their team. HR sees everyone. Salary information is a separate permission from the rest of the profile, so a manager can approve leave without seeing pay.",
        ],
      },
    ],
    related: ["roles-and-permissions", "import-employees"],
  },
  {
    slug: "org-structure",
    title: "Locations, departments and reporting lines",
    summary: "The structure that drives approvals, filters and reports.",
    category: "people",
    appPath: "/app/organization",
    sections: [
      {
        heading: "Why it is worth getting right",
        body: [
          "Structure is not decoration. Approvals route along reporting lines, holiday calendars attach to locations, and almost every report filters by department. A vague structure produces approvals that go to the wrong person.",
        ],
      },
      {
        heading: "Reporting lines",
        body: [
          "Each employee has a manager, and the chain above them is derived. Workflow steps can target 'reporting manager' or a specific level up the chain, so you do not have to name individuals in a workflow.",
          "Approvers are resolved when a step becomes active, not when the workflow was written. Change someone's manager and their next request goes to the new one.",
        ],
      },
    ],
    related: ["approval-workflows"],
  },

  // ── Attendance ──────────────────────────────────────────────────────────
  {
    slug: "shifts",
    title: "Shifts, including night shifts",
    summary: "Define when work happens, and let the platform handle midnight properly.",
    category: "attendance",
    appPath: "/app/settings/shifts",
    tourId: "create_shift",
    sections: [
      {
        heading: "A shift is only the timing",
        body: [
          "A shift says when work starts and ends and how long the break is. What counts as late, or as a half day, lives in the attendance policy — so one policy can govern every shift, and changing your late-mark rule does not mean editing twelve shifts.",
        ],
      },
      {
        heading: "Night shifts",
        body: [
          "If the end time is earlier than the start time, the shift crosses midnight and the platform treats it as one shift rather than two.",
          "A 22:00–06:00 shift produces a single attendance record dated to the night it started. Both punches attach to that record, and no phantom half-day appears on the following morning. Payroll and reports then count it as one day worked, which is what it was.",
        ],
      },
    ],
    related: ["attendance-policy", "biometric-devices"],
  },
  {
    slug: "attendance-policy",
    title: "Attendance policies",
    summary: "Grace periods, half-day thresholds, late marks and what a missing punch means.",
    category: "attendance",
    appPath: "/app/settings/attendance",
    tourId: "configure_half_day",
    sections: [
      {
        heading: "How a day is decided",
        body: [
          "For each day, the platform takes the punches, the shift, the policy, and any holiday, weekly off or approved leave, and produces a status and a payable-days figure. Every rule that fired is recorded alongside the result.",
          "That breakdown is visible on the record. When someone asks why they were marked half day, the answer is on screen rather than in someone's memory.",
        ],
      },
      {
        heading: "Thresholds",
        body: [
          "Half-day and full-day thresholds can be set as a percentage of the scheduled shift or as fixed hours. Percentage is usually right when teams work different shift lengths; fixed hours is clearer when everyone works the same day.",
          "Below the half-day threshold, the day is an absence.",
        ],
      },
      {
        heading: "Late marks and grace",
        body: [
          "A grace period forgives arrivals within a few minutes of the shift start. Beyond it, the day gets a late mark. You can set a number of late marks that together cost half a day, and separately make a very late arrival a half day on its own.",
        ],
      },
      {
        heading: "Missing punches",
        body: [
          "Someone punches in and forgets to punch out. You decide what that means: treat the day as present, absent, half day, or leave it pending until it is corrected. The default is pending, because it is the only option that does not silently decide something a person should look at.",
          "Employees can raise a correction request from their portal, and the day is recalculated once it is approved.",
        ],
      },
    ],
    related: ["shifts", "attendance-corrections", "biometric-devices"],
  },
  {
    slug: "biometric-devices",
    title: "Connecting biometric devices",
    summary: "Three ways to get punches in, including from devices with no internet access.",
    category: "attendance",
    appPath: "/app/settings/biometric",
    tourId: "connect_biometric_device",
    sections: [
      {
        heading: "Pick the mode that fits your network",
        body: [
          [
            "API pull — the platform connects to the device or its server on a schedule. Needs the device to be reachable from the internet.",
            "Webhook push — the device or a small bridge on your network posts punches to us. Works when the device is on a private LAN, because the connection goes outward.",
            "File import — export the log from the device software and upload it. Needs no connectivity at all.",
          ],
          "Devices on an office LAN cannot be reached from a cloud service directly. If your device is not internet-facing, use webhook mode with the bridge, or file import. Neither requires opening your network.",
        ],
      },
      {
        heading: "Raw events are kept",
        body: [
          "Every punch is stored twice: as the raw event exactly as the device reported it, and as a mapped punch attached to an employee.",
          "That is why a mis-configured device is recoverable. If a device was reporting IDs that matched nobody, fixing the mapping and reprocessing rebuilds attendance for those days — the underlying events were never discarded.",
          "Re-importing the same file does not create duplicates; events are matched on device, user and timestamp.",
        ],
      },
    ],
    related: ["attendance-policy", "attendance-corrections"],
  },
  {
    slug: "attendance-corrections",
    title: "Attendance corrections",
    summary: "Let people fix a wrong day without giving them the ability to edit attendance.",
    category: "attendance",
    appPath: "/app/attendance/corrections",
    sections: [
      {
        heading: "How it works",
        body: [
          "An employee opens the day in their portal and requests a correction, giving the times and a reason. It goes to their approver. On approval the day is recalculated through the same engine as any other day.",
          "The original record is not overwritten silently — the correction, who approved it and when are all on the audit trail.",
        ],
      },
      {
        heading: "Limits worth setting",
        body: [
          "Your policy sets how many days back a correction can reach. Without a limit, a request can arrive for a month that payroll has already paid.",
          "Locking a period prevents corrections to it entirely, which is what payroll depends on.",
        ],
      },
    ],
    related: ["attendance-policy"],
  },

  // ── Leave ───────────────────────────────────────────────────────────────
  {
    slug: "leave-policy",
    title: "Leave types and policies",
    summary: "Allocation, accrual, carry forward, and who approves what.",
    category: "leave",
    appPath: "/app/settings/leave",
    tourId: "create_leave_policy",
    sections: [
      {
        heading: "Types and policies are separate",
        body: [
          "A leave type is the name — Casual, Sick, Earned. A policy is the set of rules applied to those types for a group of people.",
          "That separation is what lets factory staff and head office share the name 'Casual leave' while getting different numbers of days, without inventing two leave types that mean the same thing.",
        ],
      },
      {
        heading: "How days are credited",
        body: [
          [
            "All at once each year — the full entitlement on a fixed date.",
            "Every month — an equal share credited monthly.",
            "Earned per completed month — accrued only after each month is worked, which is the usual treatment for earned leave.",
            "Unlimited — tracked but never exhausted.",
            "Not allocated — for types like comp off that are granted case by case.",
          ],
          "New joiners can be prorated from their joining date so that someone who starts in September does not receive a full year's entitlement.",
        ],
      },
      {
        heading: "Carry forward and encashment",
        body: [
          "Unused days can lapse, carry into the next year up to a cap, or be encashed. Carried days can be given an expiry so they do not accumulate indefinitely.",
        ],
      },
      {
        heading: "Eligibility",
        body: [
          "A type can require a minimum length of service, exclude people on probation or serving notice, cap the number of requests per year, or apply only to one gender where the leave type genuinely requires it — maternity leave, for example.",
          "When a request is refused on eligibility grounds the employee is told which rule applied, rather than getting a generic refusal.",
        ],
      },
    ],
    related: ["sandwich-rule", "leave-approvals"],
  },
  {
    slug: "sandwich-rule",
    title: "Weekends and holidays inside a leave request",
    summary: "The three counting modes, and why a request sometimes costs more days than expected.",
    category: "leave",
    appPath: "/app/settings/leave",
    sections: [
      {
        heading: "Three ways to count",
        body: [
          "Each leave type decides what happens to non-working days that fall inside a request:",
          [
            "Exclude — weekends and holidays inside the range are not deducted. Friday to Monday costs two days.",
            "Include — every calendar day in the range is deducted. Friday to Monday costs four.",
            "Sandwich — a non-working day is deducted only when there is leave on both sides of it. Friday and Monday off means the weekend is deducted too, so four days; Friday alone costs one.",
          ],
        ],
      },
      {
        heading: "Why the preview matters",
        body: [
          "This is the single most common source of disputes about leave, because the arithmetic is invisible until the balance changes.",
          "The apply screen shows the cost before submission, day by day, naming the rule that produced it. An employee who can see that the weekend was counted, and why, does not need to raise a ticket about it.",
        ],
      },
    ],
    related: ["leave-policy"],
  },
  {
    slug: "leave-approvals",
    title: "Applying for and approving leave",
    summary: "What employees see, what approvers see, and what happens on approval.",
    category: "leave",
    appPath: "/app/leave",
    sections: [
      {
        heading: "Applying",
        body: [
          "The employee picks a type and dates, sees the cost and their remaining balance, and submits. Half days are supported at either end of a range.",
          "If the request would exceed the balance, the platform says so before submission rather than after approval.",
        ],
      },
      {
        heading: "Approving",
        body: [
          "Approvals appear in the approver's queue and as a notification. Approving updates the balance and marks the attendance for those days immediately, so nobody is marked absent for leave that was granted.",
          "Rejections require a reason, which is shown to the employee.",
        ],
      },
    ],
    related: ["approval-workflows", "leave-policy"],
  },

  // ── Payroll ─────────────────────────────────────────────────────────────
  {
    slug: "salary-structure",
    title: "Salary components and structures",
    summary: "Build pay from formulas you control, not fixed fields.",
    category: "payroll",
    appPath: "/app/payroll/components",
    sections: [
      {
        heading: "Components",
        body: [
          "A component is one line on a payslip — Basic, HRA, a conveyance allowance, a professional tax deduction. Each has a formula and a position in the calculation order.",
          "Formulas can reference earlier components, so HRA can be 40% of Basic without Basic being hard-coded anywhere.",
          "The formula language is deliberately small — arithmetic, comparisons, and a set of named functions. It is not JavaScript, and nothing you type can execute code on our servers.",
        ],
      },
      {
        heading: "Proration",
        body: [
          "A component can be marked prorated or not. Prorated components are reduced for unpaid absence; a fixed reimbursement usually is not.",
          "The per-day basis is a setting: calendar days, working days, or a fixed number such as 26. This choice changes the result, so it is stated explicitly rather than assumed.",
        ],
      },
    ],
    related: ["payroll-run"],
  },
  {
    slug: "payroll-run",
    title: "Running payroll",
    summary: "Process, review, approve, publish — and what to check before you do.",
    category: "payroll",
    appPath: "/app/payroll",
    tourId: "run_payroll",
    sections: [
      {
        heading: "Attendance first",
        body: [
          "Payroll reads attendance; it does not recalculate it. Process and lock attendance for the month before you run payroll, or the run will use whatever is there at the time.",
        ],
      },
      {
        heading: "The four stages",
        body: [
          [
            "Process — the engine calculates every payslip and lists exceptions.",
            "Review — look at the exceptions. These are employees whose result the engine could not compute confidently: missing salary structure, negative net pay, a formula that referenced something unavailable.",
            "Approve — locks the figures.",
            "Publish — makes payslips visible to employees and sends the notification.",
          ],
          "An error in one employee's calculation does not abandon the run. That employee appears as an exception and the rest complete.",
        ],
      },
      {
        heading: "Every payslip explains itself",
        body: [
          "Each line carries the working behind it — the formula, the values that went in, and the days figure used. When someone queries a deduction, the answer is on the payslip.",
          "Runs are deterministic: the same inputs produce the same output, every time.",
        ],
      },
    ],
    related: ["salary-structure", "attendance-policy"],
  },

  // ── Administration ──────────────────────────────────────────────────────
  {
    slug: "roles-and-permissions",
    title: "Users, roles and permissions",
    summary: "Give people exactly the access they need, using roles you define.",
    category: "administration",
    appPath: "/app/settings/roles",
    sections: [
      {
        heading: "Roles are yours to define",
        body: [
          "Nothing in the platform keys off a role's name. Copy an existing role, adjust the permissions, and call it whatever your organisation calls it.",
          "The sidebar each person sees is derived from their permissions, so a role without payroll access simply has no payroll section — rather than a section that errors when clicked.",
        ],
      },
      {
        heading: "Least privilege",
        body: [
          "Salary visibility is a separate permission from employee records, and viewing is separate from managing throughout. A manager can approve leave without seeing pay; an HR assistant can maintain records without running payroll.",
          "Removing someone's access takes effect immediately, not at their next sign-in.",
        ],
      },
    ],
    related: ["audit-trail", "security-settings"],
  },
  {
    slug: "approval-workflows",
    title: "Approval workflows",
    summary: "Multi-step approvals with conditions, escalation and delegation.",
    category: "administration",
    appPath: "/app/workflows",
    sections: [
      {
        heading: "Steps and approvers",
        body: [
          "A workflow is an ordered list of steps. Each step names who approves — the reporting manager, a level up the chain, a department head, anyone with a given role or permission, or specific people.",
          "Conditions can skip a step. A leave request of one day might need only the manager, while five days adds a department head.",
        ],
      },
      {
        heading: "When people are away",
        body: [
          "Delegation forwards an approver's queue to someone else for a date range. Escalation moves a request up after it has waited too long, so nothing sits indefinitely because one person is on holiday.",
        ],
      },
    ],
    related: ["roles-and-permissions", "leave-approvals"],
  },
  {
    slug: "audit-trail",
    title: "Audit trail and logs",
    summary: "What is recorded, how long it is kept, and how to search it.",
    category: "administration",
    appPath: "/app/audit",
    sections: [
      {
        heading: "What is recorded",
        body: [
          "Security-relevant and data-changing events: sign-ins and failures, permission and role changes, employee record changes, salary changes, payroll approval and publication, attendance locks and unlocks, exports, and file access.",
          "Each entry records who, what, when, from which address, and — where a value changed — what it was before and after.",
        ],
      },
      {
        heading: "It cannot be edited",
        body: [
          "Audit entries are append-only. They cannot be modified or selectively deleted from the product, including by an account owner, because a log that the administrator can trim proves nothing.",
          "Unlocking a locked attendance period is recorded as a critical event for the same reason.",
        ],
      },
      {
        heading: "Using it",
        body: [
          "Filter by person, date range, action or entity, and export the result. When an auditor asks who changed a salary in March, this is the answer.",
        ],
      },
    ],
    related: ["roles-and-permissions", "security-settings"],
  },
  {
    slug: "security-settings",
    title: "Security settings",
    summary: "Password rules, sessions and the controls available to an account owner.",
    category: "administration",
    appPath: "/app/settings/security",
    sections: [
      {
        heading: "What you control",
        body: [
          [
            "Password strength requirements and expiry.",
            "Session lifetime and whether concurrent sessions are allowed.",
            "Failed sign-in lockout thresholds.",
            "Which email domains may be invited into the account.",
          ],
        ],
      },
      {
        heading: "What we handle",
        body: [
          "Passwords are stored hashed, never recoverable. Sessions use short-lived access tokens with rotating refresh tokens, and reuse of a refresh token invalidates the whole family — a stolen token stops working the moment the real one is used.",
        ],
      },
    ],
    related: ["roles-and-permissions", "audit-trail"],
  },
  {
    slug: "billing",
    title: "Plans, billing and limits",
    summary: "How pricing works, what counts, and what happens at a limit.",
    category: "administration",
    appPath: "/app/settings/plan",
    sections: [
      {
        heading: "What counts",
        body: [
          "Per-employee plans count active employee records. Someone who has left and is marked as such does not count, but their record and history stay for your reporting and statutory obligations.",
        ],
      },
      {
        heading: "At a limit",
        body: [
          "The platform tells you before you hit a plan limit, and refuses the action that would exceed it rather than silently accepting data it cannot bill for. Nothing is deleted for being over a limit.",
        ],
      },
    ],
    related: [],
  },
];

export const DOCS_BY_SLUG: Record<string, DocArticle> = Object.fromEntries(
  DOC_ARTICLES.map((article) => [article.slug, article])
);

export function articlesInCategory(categoryId: string): DocArticle[] {
  return DOC_ARTICLES.filter((article) => article.category === categoryId);
}
