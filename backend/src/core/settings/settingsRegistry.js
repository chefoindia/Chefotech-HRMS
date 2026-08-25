"use strict";

/**
 * The settings registry.
 *
 * Every configurable value in the platform is declared here once, with its
 * type, default, validation and the permission required to change it. Nothing
 * reads a magic number from a service file, and no module invents its own
 * config storage.
 *
 * Adding a setting means adding a row here — the settings API, the settings UI
 * and the validation all derive from this list, so there is no second place to
 * update and no way for the three to drift apart.
 */

const SETTING_TYPES = [
  "boolean",
  "string",
  "number",
  "date",
  "time",
  "enum",
  "multienum",
  "json",
  "formula",
  "reference",
  "array",
  "color",
];

const define = (rows) => rows;

const SETTINGS = define([
  // ── Organization ─────────────────────────────────────────────────────────
  {
    key: "org.week_start_day",
    group: "organization",
    label: "Week starts on",
    type: "enum",
    options: [
      { value: 0, label: "Sunday" },
      { value: 1, label: "Monday" },
    ],
    default: 1,
    description: "Used by calendars, weekly reports and roster views.",
    help: {
      why: "Decides which day a week begins on everywhere a week is drawn or counted — the attendance calendar, the leave calendar, roster views and any 'this week' total in a report. It does not change anyone's weekly off; that is set per shift.",
      example: "Set it to Monday and a week runs Mon–Sun, so a Sunday absence lands at the end of that week's row. Set it to Sunday and the same absence starts the next week instead, which shifts which week a report counts it in.",
    },
  },
  {
    key: "org.financial_year_start_month",
    group: "organization",
    label: "Financial year starts in",
    type: "enum",
    options: Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: new Date(2000, i, 1).toLocaleString("en", { month: "long" }),
    })),
    default: 4,
    description: "Drives payroll periods, leave-year boundaries and reports.",
    help: {
      why: "The month your financial year opens. Year-to-date figures on payslips and reports reset here, and it is the anchor for annual payroll reporting. Indian companies almost always run April–March; set this wrong and every YTD number on a payslip is measured from the wrong starting point.",
      example: "Set to April: a payslip issued in June 2026 shows YTD earnings counted from 1 April 2026. Set to January instead and that same payslip counts from 1 January 2026 — a much larger figure, for the same employee and the same month.",
    },
  },
  {
    key: "org.date_format",
    group: "organization",
    label: "Date format",
    type: "enum",
    options: [
      { value: "DD/MM/YYYY", label: "31/12/2026" },
      { value: "MM/DD/YYYY", label: "12/31/2026" },
      { value: "YYYY-MM-DD", label: "2026-12-31" },
      { value: "DD MMM YYYY", label: "31 Dec 2026" },
    ],
    default: "DD MMM YYYY",
    help: {
      why: "How every date is printed across the app, on payslips, and in generated letters. Purely presentational — it never changes what is stored — but it removes the 03/04 ambiguity for teams that read dates differently.",
      example: "Pick 'DD MMM YYYY' and an offer letter reads 'Joining date: 3 April 2026'. Pick 'MM/DD/YYYY' and the same date prints as 04/03/2026, which an Indian reader would likely misread as 4 March.",
    },
  },
  {
    key: "org.time_format",
    group: "organization",
    label: "Time format",
    type: "enum",
    options: [
      { value: "12h", label: "05:30 PM" },
      { value: "24h", label: "17:30" },
    ],
    default: "12h",
    help: {
      why: "How clock times are shown — punch times, shift timings, check-in and check-out. Presentational only; shift configuration is always entered as 24-hour HH:mm regardless of this choice.",
      example: "Set 12h and an attendance row reads 'In 09:05 AM, Out 06:12 PM'. Set 24h and the same row reads 'In 09:05, Out 18:12' — which factory and hospital teams working night shifts usually prefer, since 24h never confuses a 6 PM with a 6 AM.",
    },
  },

  // ── Employees ────────────────────────────────────────────────────────────
  {
    key: "employee.code_prefix",
    group: "employee",
    label: "Employee code prefix",
    type: "string",
    default: "EMP",
    validation: { maxLength: 10, pattern: "^[A-Za-z0-9-]*$" },
    description: "Prefix for auto-generated employee codes.",
    help: {
      why: "The letters in front of every auto-generated employee code. The code is the short identifier your team will use on payslips, biometric mapping, imports and reports — so pick something recognisable and then leave it alone. Changing it later does not rename anyone already created.",
      example: "Prefix 'EMP' with a length of 4 produces EMP0001, EMP0002. If your factory numbers workers separately, 'BW-W' would produce BW-W0001 instead.",
    },
  },
  {
    key: "employee.code_padding",
    group: "employee",
    label: "Employee code number length",
    type: "number",
    default: 4,
    validation: { min: 1, max: 10 },
    description: "EMP0001 with a length of 4.",
    help: {
      why: "How many digits the number is padded to, so codes sort correctly and line up in a spreadsheet. Pick enough digits for the headcount you expect to reach — codes stop lining up once you exceed the padding.",
      example: "Length 4 gives EMP0001 … EMP9999. Length 3 gives EMP001, but your 1000th joiner becomes EMP1000 and no longer aligns with the rest in a sorted export.",
    },
  },
  {
    key: "employee.code_next_number",
    group: "employee",
    label: "Next employee number",
    type: "number",
    default: 1,
    validation: { min: 1 },
    help: {
      why: "The number the next auto-generated code will use. It advances by one on every employee created. Set it deliberately when moving from an old system, so new codes continue your existing series instead of colliding with it.",
      example: "You imported 248 staff whose old codes ran to EMP0248. Set this to 249 and the next person created becomes EMP0249. Leave it at 1 and the platform would try to reuse EMP0001, which is already taken.",
    },
  },
  {
    key: "employee.code_auto_generate",
    group: "employee",
    label: "Generate employee codes automatically",
    type: "boolean",
    default: true,
    help: {
      why: "When on, the code is filled in for you from the prefix, padding and next-number settings above. Turn it off only if your codes come from somewhere else — an ERP, a payroll bureau, or a numbering scheme people already have memorised — in which case whoever adds an employee has to type the code themselves.",
      example: "On: adding 'Meera Nair' silently assigns EMP0249 and nobody has to think about it. Off: the Add employee form requires a code, and adding her without one is rejected.",
    },
  },
  {
    key: "employee.probation_months",
    group: "employee",
    label: "Default probation period (months)",
    type: "number",
    default: 3,
    validation: { min: 0, max: 24 },
    help: {
      why: "Pre-fills the probation length on a new employee record, so HR does not retype the same figure for every joiner. It is only a default — you can override it per person for a senior hire or a trainee. It drives the confirmation-due date, which is what confirmation-letter templates print.",
      example: "Set to 3: someone joining 1 April 2026 gets a confirmation date of 1 July 2026 filled in automatically. Set to 6 and the same joiner shows 1 October 2026 instead.",
    },
  },
  {
    key: "employee.notice_period_days",
    group: "employee",
    label: "Default notice period (days)",
    type: "number",
    default: 30,
    validation: { min: 0, max: 365 },
    help: {
      why: "Pre-fills the notice period on a new employee record. Used when an exit is initiated to work out the expected last working day, which relieving and experience letters then print. Override it per person where a contract says something different.",
      example: "Set to 30: an employee resigning on 10 May 2026 gets an expected last working day of 9 June 2026. Senior contracts often use 90 — set that on the individual record rather than changing this default for everyone.",
    },
  },
  {
    key: "employee.self_editable_fields",
    group: "employee",
    label: "Fields an employee may edit themselves",
    type: "multienum",
    options: [
      { value: "personal.phone", label: "Phone" },
      { value: "personal.personalEmail", label: "Personal email" },
      { value: "personal.currentAddress", label: "Current address" },
      { value: "personal.emergencyContacts", label: "Emergency contacts" },
      { value: "personal.maritalStatus", label: "Marital status" },
      { value: "bank", label: "Bank details" },
      { value: "avatar", label: "Profile photo" },
    ],
    default: [
      "personal.phone",
      "personal.personalEmail",
      "personal.currentAddress",
      "personal.emergencyContacts",
      "avatar",
    ],
    description: "Anything not listed is read-only in the employee portal.",
    help: {
      why: "Which parts of their own profile an employee can change without asking HR. Everything you do not tick is visible to them but read-only. The trade-off is real: ticking more fields means less data-entry work for HR, but fields that affect money or identity should stay with HR so they are checked before they change.",
      example: "Tick 'Phone' and 'Current address' and staff keep their own contact details current — HR never chases them. Tick 'Bank details' and an employee could change their salary account the night before payroll runs, with no approval step; most companies deliberately leave that one unticked.",
    },
  },

  // ── Attendance ───────────────────────────────────────────────────────────
  {
    key: "attendance.capture_mode",
    group: "attendance",
    label: "How attendance is captured",
    type: "multienum",
    options: [
      { value: "biometric", label: "Biometric device" },
      { value: "web", label: "Web check-in" },
      { value: "mobile", label: "Mobile check-in" },
      { value: "manual", label: "Manual entry by HR" },
    ],
    default: ["biometric", "web", "manual"],
    help: {
      why: "Which ways a punch is allowed to reach the platform. Tick every method you actually use — an unticked method stops working for everyone. Most companies run more than one: a device at the gate for factory staff, web or mobile for office staff who travel, and manual entry so HR can fix the days a device was down.",
      example: "Tick Biometric + Web + Manual: gate staff punch on the reader, office staff click Check in, and HR can still key in the day the reader lost power. Untick Manual and that outage becomes a day nobody can fix without turning the setting back on.",
    },
  },
  {
    key: "attendance.first_last_punch_only",
    group: "attendance",
    label: "Use only the first and last punch of the day",
    type: "boolean",
    default: true,
    description:
      "When off, every in/out pair is treated as a work session and break time is deducted.",
    help: {
      why: "How a day with many punches is added up. On, only the earliest and latest punch matter and anything between them counts as worked — simplest, and what most offices want. Off, each in/out pair is a separate work session and the gaps between them are deducted as break, which is stricter and needs staff to punch reliably at every break.",
      example: "Someone punches In 09:00, Out 13:00, In 13:45, Out 18:00. On: worked = 09:00 to 18:00 = 9h. Off: worked = 4h + 4h 15m = 8h 15m, with the 45-minute lunch deducted. On a policy with an 8h full-day threshold both still count as a full day; on a 8h 30m threshold the second one would not.",
    },
  },
  {
    key: "attendance.allow_future_dated_correction",
    group: "attendance",
    label: "Allow corrections for future dates",
    type: "boolean",
    default: false,
    help: {
      why: "Whether a correction request can be raised for a day that has not happened yet. Normally off, because attendance is a record of what did happen. Turn it on only if you deliberately pre-record planned on-duty days, such as an offsite or client visit booked in advance.",
      example: "Off: an employee raising a correction for next Tuesday is rejected — they should apply for leave or on-duty instead. On: they can pre-mark next Tuesday as on-duty for a client visit, and it is approved before the day arrives.",
    },
  },
  {
    key: "attendance.correction_window_days",
    group: "attendance",
    label: "Correction window (days)",
    type: "number",
    default: 7,
    validation: { min: 0, max: 90 },
    description: "How far back an employee may raise a regularization request.",
    help: {
      why: "How far back an employee may still ask to fix a missed or wrong punch. It exists to stop someone reopening a month you have already paid. Too short and genuine forgotten punches become unfixable disputes; too long and payroll is never final.",
      example: "Set to 7: on 20 May an employee can still raise a correction for 14 May, but not for 10 May. If your payroll cut-off is the 25th, 7 to 10 days lets people fix a forgotten punch while still closing the month cleanly.",
    },
  },
  {
    key: "attendance.auto_lock_after_days",
    group: "attendance",
    label: "Auto-lock attendance after (days)",
    type: "number",
    default: 0,
    validation: { min: 0, max: 120 },
    description: "0 disables automatic locking.",
    help: {
      why: "Freezes attendance older than this many days so it can no longer be edited at all — by anyone, including HR. This is the guard that keeps a paid month from silently changing after the fact. Leave at 0 while you are still setting up; turn it on once payroll is running for real.",
      example: "Set to 45: on 30 June, anything up to 16 May is locked and a late edit is refused. Set to 0 and someone could still alter March's attendance in December, after those payslips were published — which is exactly the audit problem this prevents.",
    },
  },
  {
    key: "attendance.geofence_enabled",
    group: "attendance",
    label: "Restrict web check-in to work locations",
    type: "boolean",
    default: false,
    help: {
      why: "Requires a web or mobile check-in to be physically near one of your work locations, using the device's location at the moment of punching. Stops check-in from home for roles that must be on site. It needs your work locations to have coordinates saved, and staff must allow location access — so switch it on only once both are true.",
      example: "On with a 200 m radius: a plant supervisor standing at the gate checks in normally, while the same tap from home is refused. Off: the punch is accepted from anywhere with internet.",
    },
  },
  {
    key: "attendance.geofence_radius_metres",
    group: "attendance",
    label: "Geofence radius (metres)",
    type: "number",
    default: 200,
    validation: { min: 20, max: 5000 },
    dependsOn: { key: "attendance.geofence_enabled", equals: true },
    help: {
      why: "How close to a work location a check-in has to be. Phone GPS is only accurate to roughly 10–50 m outdoors and much worse inside a building, so a radius that is too tight will reject people who are genuinely at their desk. Size it to your premises plus a margin, not to the doorway.",
      example: "A single office floor: 150–200 m is comfortable. A large factory campus with several buildings: 500–1000 m, or the guard at the far gate gets rejected. Setting 20 m would refuse most staff sitting one floor up from the pin.",
    },
  },

  // ── Leave ────────────────────────────────────────────────────────────────
  {
    key: "leave.year_start_month",
    group: "leave",
    label: "Leave year starts in",
    type: "enum",
    options: Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: new Date(2000, i, 1).toLocaleString("en", { month: "long" }),
    })),
    default: 1,
    help: {
      why: "The month your leave cycle resets. Annual allocations are credited from here, and carry-forward and lapse are worked out at the end of it. This is a separate decision from the financial year — plenty of companies run payroll April–March but leave January–December, because staff think of leave in calendar years.",
      example: "Set to January: everyone's annual leave is credited on 1 January and unused days lapse or carry forward on 31 December. Set to April and the same policy credits on 1 April instead — so an employee's December leave now comes out of a balance that still has three months left to run.",
    },
  },
  {
    key: "leave.allow_negative_balance",
    group: "leave",
    label: "Allow leave balances to go negative",
    type: "boolean",
    default: false,
    help: {
      why: "Whether someone can take leave they have not accrued yet, going into deficit. Off is the safe default — a request beyond the balance is simply refused. On is a genuine kindness for new joiners who fall ill in month one, but a leaver with a negative balance means recovering money from the final settlement, so pair it with a small cap below.",
      example: "Off: a joiner with 1.5 days accrued who applies for 3 days is blocked at the point of applying. On with a cap of 5: the request goes through, their balance reads −1.5, and it clears itself as the next months accrue.",
    },
  },
  {
    key: "leave.max_negative_days",
    group: "leave",
    label: "Maximum negative balance (days)",
    type: "number",
    default: 0,
    validation: { min: 0, max: 30 },
    dependsOn: { key: "leave.allow_negative_balance", equals: true },
    help: {
      why: "How far into deficit a balance may go. This is the real control on the setting above — it caps what you would have to recover from someone's final settlement if they left tomorrow. Keep it near what one or two months of accrual would repay.",
      example: "Cap of 5 with monthly accrual of 1.5 days: worst case you are recovering about three months of accrual, which usually settles itself. A cap of 30 on the same policy means a leaver could owe you a month's salary back.",
    },
  },
  {
    key: "leave.allow_backdated_application",
    group: "leave",
    label: "Allow backdated leave applications",
    type: "boolean",
    default: true,
    help: {
      why: "Whether leave can be applied for after the fact. Usually on, because sick leave is genuinely applied for on return, not in advance. Turning it off forces every absence to be planned, which suits shift operations that must know staffing ahead of time but leaves no clean way to record a real sick day.",
      example: "On: someone off sick Monday and Tuesday applies on Wednesday when they are back, and those days convert from absent to sick leave. Off: the same person cannot apply at all and those two days stay recorded as unpaid absence unless HR fixes it manually.",
    },
  },
  {
    key: "leave.backdated_limit_days",
    group: "leave",
    label: "Backdated application limit (days)",
    type: "number",
    default: 30,
    validation: { min: 0, max: 365 },
    help: {
      why: "How far back a backdated application may reach. Same reasoning as the attendance correction window: long enough for a genuine illness or emergency, short enough that a closed payroll month stays closed.",
      example: "Set to 30: on 20 June someone can still apply for sick leave taken on 5 June, but not for a day in April that was already paid as absent. Setting it beyond your payroll cut-off means approving leave for a month whose payslips are already published.",
    },
  },
  {
    key: "leave.auto_approve_on_no_action_days",
    group: "leave",
    label: "Auto-approve after no action for (days)",
    type: "number",
    default: 0,
    validation: { min: 0, max: 60 },
    description: "0 disables auto-approval.",
    help: {
      why: "A safety valve for requests nobody acted on — after this many days the request approves itself, so an employee is not left waiting on a manager who is travelling or has left. Use it deliberately: it means leave can be granted with no human decision, so most companies either leave it off or set it generously.",
      example: "Set to 7: a request raised on 1 June and still untouched on 8 June approves automatically and the days are deducted. Set to 0 and that request stays pending indefinitely until someone acts — safer, but the employee never gets an answer.",
    },
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  {
    key: "payroll.cycle_start_day",
    group: "payroll",
    label: "Payroll cycle starts on day",
    type: "number",
    default: 1,
    validation: { min: 1, max: 28 },
    description: "Use 26 for a 26th-to-25th cycle.",
    help: {
      why: "The day of the month a pay period opens. It decides which days of attendance belong to which payslip. Companies that pay on the 1st usually need a cycle that closes a few days earlier, so there is time to review attendance and approve the run before money moves.",
      example: "Set to 1: May's payslip covers 1–31 May, which leaves no gap between the month ending and payday. Set to 26: May's payslip covers 26 April – 25 May, giving you the last five days of the month to finalise attendance and still pay on time.",
    },
  },
  {
    key: "payroll.pay_day",
    group: "payroll",
    label: "Salary credited on day",
    type: "number",
    default: 1,
    validation: { min: 1, max: 31 },
    help: {
      why: "The day salary is expected to reach employees. It is used on payslips and in reminders — it does not itself move any money, since the actual transfer happens through your bank. Setting it accurately is what makes 'when will I be paid' answerable without asking HR.",
      example: "Set to 1 with a 26th–25th cycle: the May payslip (26 Apr – 25 May) shows a pay date of 1 June. Avoid 29, 30 or 31 unless you genuinely pay then — those days do not exist in every month.",
    },
  },
  {
    key: "payroll.working_days_basis",
    group: "payroll",
    label: "Per-day salary is calculated on",
    type: "enum",
    options: [
      { value: "calendar_days", label: "Calendar days in the month" },
      { value: "working_days", label: "Working days in the month" },
      { value: "fixed_days", label: "A fixed number of days" },
    ],
    default: "calendar_days",
    description: "This single choice changes every loss-of-pay deduction.",
    help: {
      why: "The divisor used to turn a monthly salary into a per-day rate, which is what every loss-of-pay deduction is built on. This is the single most consequential payroll setting here — the same absence costs a different amount under each option, and changing it later changes everyone's deductions at once.",
      example: "₹30,000/month, one unpaid day in April (30 days, 22 working days). Calendar days: 30000/30 = ₹1,000 deducted. Working days: 30000/22 = ₹1,364 deducted. Fixed 26 days: 30000/26 = ₹1,154. Same absence, three different answers — pick the one your offer letters and local practice assume.",
    },
  },
  {
    key: "payroll.fixed_days_in_month",
    group: "payroll",
    label: "Fixed days in a month",
    type: "number",
    default: 30,
    validation: { min: 26, max: 31 },
    dependsOn: { key: "payroll.working_days_basis", equals: "fixed_days" },
    help: {
      why: "The constant divisor used when the basis above is set to a fixed number. Its point is fairness across months: with a fixed divisor, one unpaid day costs exactly the same in February as in March. 26 is the common choice where a six-day week is standard; 30 keeps the arithmetic simple.",
      example: "₹30,000/month with 26 fixed days: one unpaid day is ₹1,154, in every month of the year. Without a fixed divisor, that same day would cost ₹1,071 in a 28-day February and ₹968 in a 31-day March.",
    },
  },
  {
    key: "payroll.rounding",
    group: "payroll",
    label: "Round payslip amounts to",
    type: "enum",
    options: [
      { value: "none", label: "No rounding (2 decimals)" },
      { value: "nearest_1", label: "Nearest 1" },
      { value: "nearest_10", label: "Nearest 10" },
    ],
    default: "nearest_1",
    help: {
      why: "How final payslip figures are rounded. Rounding to whole rupees keeps payslips readable and bank transfers clean; keeping paise is more precise but produces amounts nobody can reconcile by eye. Statutory components are still computed at full precision first — this only affects what is printed and paid.",
      example: "A computed net of ₹28,456.73 pays as ₹28,456.73 with no rounding, ₹28,457 to the nearest 1, or ₹28,460 to the nearest 10. Across 200 staff the difference is small in total but very visible on an individual payslip.",
    },
  },
  {
    key: "payroll.lop_from_attendance",
    group: "payroll",
    label: "Deduct loss of pay from attendance automatically",
    type: "boolean",
    default: true,
    help: {
      why: "Whether unpaid absences found in attendance flow into payroll on their own. On is what makes attendance and payroll one system rather than two — but it also means attendance mistakes become pay mistakes, so it depends on attendance being reviewed and corrections closed before you run payroll. Off, someone must enter every LOP day by hand.",
      example: "On: an employee absent 2 days with no approved leave has 2 LOP days appear on the payslip automatically. Off: those 2 days are simply not deducted unless a payroll admin notices and keys them in — which is how people quietly get paid for days they did not work.",
    },
  },
  {
    key: "payroll.payslip_publish_requires_approval",
    group: "payroll",
    label: "Payslips can only be published after approval",
    type: "boolean",
    default: true,
    help: {
      why: "Forces a named person to approve a payroll run before employees can see their payslips. Keep this on: a published payslip is frozen and visible to staff, and an unreviewed error becomes a conversation with every affected employee. The approval is recorded in the audit trail against whoever gave it.",
      example: "On: a run sits in 'pending approval' until someone with payroll approval rights signs it off — a wrong salary caught at review costs nothing. Off: whoever processed the run can publish straight to 200 employees with no second pair of eyes.",
    },
  },

  // ── Notifications ────────────────────────────────────────────────────────
  {
    key: "notification.channels_enabled",
    group: "notification",
    label: "Enabled notification channels",
    type: "multienum",
    options: [
      { value: "in_app", label: "In-app" },
      { value: "email", label: "Email" },
      { value: "push", label: "Push" },
      { value: "sms", label: "SMS" },
    ],
    default: ["in_app", "email"],
    help: {
      why: "Which ways the platform is allowed to reach people — for approval requests, leave decisions, payslip releases and reminders. Unticking a channel silences it everywhere at once. In-app alone is quiet but easy to miss; email is what most people actually notice. Push needs the mobile app installed, and SMS needs an SMS provider configured, so ticking either without that in place simply sends nothing.",
      example: "Tick In-app + Email: a manager sees the bell badge when logged in, and also gets an email so a leave request waiting on them is not missed over a weekend. Untick Email and the same request sits unseen until they happen to log in.",
    },
  },
  {
    key: "notification.daily_digest_time",
    group: "notification",
    label: "Daily digest time",
    type: "time",
    default: "09:00",
    help: {
      why: "When the once-a-day summary goes out — what is pending on you, who is absent, what needs approval. Batching these into one message is what stops the platform from sending a dozen separate emails a day. Set it to land just before people start work, in your organisation's timezone.",
      example: "Set 09:00 and an HR manager opens a single 9 AM mail listing 3 leave requests and 2 corrections waiting on them. Set 18:00 and they get the same list at the end of the day, by which point the people waiting have already lost a day.",
    },
  },
  {
    key: "notification.notify_on_late",
    group: "notification",
    label: "Notify employees when they are marked late",
    type: "boolean",
    default: true,
    help: {
      why: "Tells the employee, on the day, that their punch was recorded as late — before it becomes a payroll deduction they only discover on the payslip. Most disputes come from people not knowing; this removes that. Turn it off only if your culture treats punctuality informally and the alert would read as nagging.",
      example: "On: someone arriving at 09:47 against a 09:15 grace gets a same-day notice, and can raise a correction if the reader misread them. Off: they find out three weeks later when a half-day deduction appears on the payslip and it is too late to correct.",
    },
  },
  {
    key: "notification.document_expiry_reminder_days",
    group: "notification",
    label: "Remind before document expiry (days)",
    type: "array",
    default: [30, 7, 1],
    description: "A reminder is sent this many days before a document expires.",
    help: {
      why: "How many days ahead of a document's expiry to send a warning — for contracts, visas, licences, medical certificates and anything else with a date on it. Enter several numbers so there is an early heads-up and a last-chance nudge, because a single reminder is easily missed on a day off.",
      example: "Set 30, 7, 1: a work permit expiring 30 June triggers a nudge on 31 May (time to start the paperwork), again on 23 June, and a final one on 29 June. Set only 1 and the first anyone hears of it is the day before, which is far too late to renew a permit.",
    },
  },

  // ── Security ─────────────────────────────────────────────────────────────
  {
    key: "security.session_idle_minutes",
    group: "security",
    label: "Sign out after inactivity (minutes)",
    type: "number",
    default: 480,
    validation: { min: 15, max: 10080 },
    help: {
      why: "How long a signed-in session survives with nobody touching it before the platform signs them out. This is what protects an unattended screen — HR laptops hold salary and identity data for the whole company. Shorter is safer but re-logins get annoying; pick something a little longer than a typical meeting.",
      example: "Set 480 (8 hours): someone signs in at 9 AM and stays signed in all working day. Set 30 and a manager returning from a long meeting has to sign in again — safer for a shared terminal on a shop floor, irritating for a private office.",
    },
  },
  {
    key: "security.password_min_length",
    group: "security",
    label: "Minimum password length",
    type: "number",
    default: 10,
    validation: { min: 8, max: 64 },
    help: {
      why: "The shortest password anyone may set. Length matters far more than forcing symbols — a long ordinary phrase beats a short scrambled word. This applies when a password is created or changed; it does not invalidate passwords people already have.",
      example: "Set 10: 'monsoon-tea-9' is accepted, 'Hr@2026' is rejected for being too short despite the symbols. Raising this to 12 later does not lock anyone out — it only applies the next time they change it.",
    },
  },
  {
    key: "security.password_expiry_days",
    group: "security",
    label: "Force password change every (days)",
    type: "number",
    default: 0,
    validation: { min: 0, max: 365 },
    description: "0 disables password expiry.",
    help: {
      why: "Forces everyone to pick a new password on a schedule. Worth knowing before you turn this on: modern guidance (including NIST) now advises against routine expiry, because people respond by cycling Summer1 to Summer2 — measurably weaker than one strong password kept until there is a reason to change it. Use it when a client or auditor contractually requires it; otherwise 0 is the better security choice.",
      example: "Set 0 (recommended): passwords stay until someone chooses or is required to change one. Set 90 and every employee is forced to reset quarterly, which in practice produces predictable variations and more forgotten-password tickets.",
    },
  },
  {
    key: "security.enforce_two_factor",
    group: "security",
    label: "Require two-factor authentication for admins",
    type: "boolean",
    default: false,
    help: {
      why: "Requires a second factor at sign-in for anyone with administrative access. It only covers admins, not every employee, because those are the accounts that can see salaries, change bank details and export the whole employee database — a stolen admin password alone should not be enough. Make sure your admins can actually enrol before switching it on.",
      example: "On: an attacker who phishes your HR admin's password still cannot sign in without their phone. Off: that password alone opens payroll for the entire company.",
    },
  },
  {
    key: "security.allowed_ip_ranges",
    group: "security",
    label: "Restrict access to IP ranges",
    type: "array",
    default: [],
    description: "Leave empty to allow access from anywhere.",
    help: {
      why: "Limits sign-in to specific networks, given as IP addresses or CIDR ranges. Powerful but genuinely risky: if your office IP changes, or you add a range with a typo, everyone including you is locked out — and fixing it needs someone with database access. Only use it with a static office IP you have confirmed, and never as your first setup step.",
      example: "Add '203.0.113.14' and only your office network can reach the platform — staff working from home are refused. Leave it empty and access is allowed from anywhere, with passwords and two-factor doing the protecting instead.",
    },
  },

  // ── Help ─────────────────────────────────────────────────────────────────
  {
    key: "help.tours_enabled",
    group: "help",
    label: "Show guided tours",
    type: "boolean",
    default: true,
    help: {
      why: "Whether the step-by-step walkthroughs are offered — the ones that open the right screen, highlight the exact field and ask for each value in turn. Most useful while you are still setting up or onboarding a new HR person. Turning it off does not delete anything; it just stops offering them.",
      example: "On: a new HR joiner can pick 'Create a leave policy' and be walked through it field by field. Off: the walkthrough option disappears and they are on their own with the form.",
    },
  },
  {
    key: "help.assistant_enabled",
    group: "help",
    label: "Show the guided help assistant",
    type: "boolean",
    default: true,
    help: {
      why: "Whether the help panel appears — the one that answers questions about a screen you are on and can take you to the right place. Leave it on unless you have your own internal documentation and want one less thing on screen.",
      example: "On: typing 'how do I change office timings' opens the shift settings with the right field highlighted. Off: the help button is hidden and people fall back to asking you directly.",
    },
  },
]);

const SETTINGS_BY_KEY = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

const SETTING_GROUPS = [
  { key: "organization", label: "Organization", permission: "settings.manage" },
  { key: "employee", label: "Employees", permission: "settings.manage" },
  { key: "attendance", label: "Attendance", permission: "settings.manage_policies" },
  { key: "leave", label: "Leave", permission: "settings.manage_policies" },
  { key: "payroll", label: "Payroll", permission: "settings.manage_policies" },
  { key: "notification", label: "Notifications", permission: "settings.manage" },
  { key: "security", label: "Security", permission: "settings.manage_security" },
  { key: "help", label: "Help", permission: "settings.manage" },
];

function defaults() {
  return Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));
}

function definitionOf(key) {
  return SETTINGS_BY_KEY[key] || null;
}

module.exports = {
  SETTINGS,
  SETTINGS_BY_KEY,
  SETTING_GROUPS,
  SETTING_TYPES,
  defaults,
  definitionOf,
};
