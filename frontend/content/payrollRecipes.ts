/**
 * Guided salary-component recipes.
 *
 * A salary formula typed as free text is one typo away from paying everybody
 * the wrong amount, and the person most likely to be editing it is an HR
 * administrator who does not write code. So the formula is not typed here at
 * all: an admin picks the shape of the calculation in plain English, fills in
 * the blanks from dropdowns and number boxes, and the expression is generated
 * for them.
 *
 * These shapes are not invented — they are the handful that real Indian
 * payroll actually uses (basic as a share of CTC, HRA as a share of basic,
 * PF capped at a ceiling, ESI below an eligibility threshold, a balancing
 * allowance that absorbs the remainder). Anything genuinely bespoke can still
 * drop to the raw expression, but nobody has to start there.
 */

export interface RecipeSlot {
  /** Key used in the template, e.g. {source}. */
  key: string;
  label: string;
  /** `component` renders a picker of component codes + system variables. */
  kind: "component" | "number" | "percent" | "money";
  hint?: string;
  default?: string | number;
}

export interface PayrollRecipe {
  id: string;
  /** Plain-English name — this is what the admin actually chooses. */
  title: string;
  /** One sentence: when you would reach for this. */
  summary: string;
  /** Reads like a sentence with the slots filled in. */
  sentence: string;
  slots: RecipeSlot[];
  /** Produces the real expression the engine evaluates. */
  build: (values: Record<string, string>) => string;
  /** A concrete worked example, shown under the builder. */
  worked: (values: Record<string, string>) => string | null;
  /** Typical real-world use, shown when choosing the recipe. */
  usedFor: string;
}

const n = (v: string | undefined, fallback = 0) => {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Math.round(value * 100) / 100);

export const PAYROLL_RECIPES: PayrollRecipe[] = [
  {
    id: "percent_of",
    title: "A percentage of something else",
    summary: "Take a share of another line on the payslip.",
    usedFor: "Basic as a share of CTC, HRA as a share of Basic, most allowances.",
    sentence: "Take {percent}% of {source}",
    slots: [
      { key: "percent", label: "Percentage", kind: "percent", default: 40, hint: "40 means 40%." },
      { key: "source", label: "Of which line", kind: "component", default: "CTC_MONTHLY" },
    ],
    build: (v) => `pct(${v.source || "CTC_MONTHLY"}, ${n(v.percent, 0)})`,
    worked: (v) => {
      const pct = n(v.percent);
      if (!pct) return null;
      const base = 50000;
      return `If ${v.source || "CTC_MONTHLY"} is ₹${money(base)}, this pays ₹${money((base * pct) / 100)} (${pct}% of it).`;
    },
  },

  {
    id: "percent_capped",
    title: "A percentage, but never more than a ceiling",
    summary: "A share of something, stopped at a maximum.",
    usedFor: "Provident Fund — 12% of Basic, capped at ₹1,800 a month.",
    sentence: "Take {percent}% of {source}, but never more than ₹{cap}",
    slots: [
      { key: "percent", label: "Percentage", kind: "percent", default: 12 },
      { key: "source", label: "Of which line", kind: "component", default: "BASIC" },
      { key: "cap", label: "Maximum amount", kind: "money", default: 1800, hint: "The most this can ever pay." },
    ],
    build: (v) => `min(pct(${v.source || "BASIC"}, ${n(v.percent, 0)}), ${n(v.cap, 0)})`,
    worked: (v) => {
      const pct = n(v.percent);
      const cap = n(v.cap);
      if (!pct || !cap) return null;
      const low = 10000;
      const high = Math.ceil((cap / pct) * 100) + 5000;
      return `If ${v.source || "BASIC"} is ₹${money(low)}, ${pct}% is ₹${money((low * pct) / 100)} — under the ceiling, so that is what is paid. If ${v.source || "BASIC"} is ₹${money(high)}, ${pct}% would be ₹${money((high * pct) / 100)}, so it is capped at ₹${money(cap)}.`;
    },
  },

  {
    id: "percent_floor",
    title: "A percentage, but never less than a minimum",
    summary: "A share of something, with a guaranteed floor.",
    usedFor: "An allowance that must not fall below a set amount for lower salaries.",
    sentence: "Take {percent}% of {source}, but never less than ₹{floor}",
    slots: [
      { key: "percent", label: "Percentage", kind: "percent", default: 10 },
      { key: "source", label: "Of which line", kind: "component", default: "BASIC" },
      { key: "floor", label: "Minimum amount", kind: "money", default: 500 },
    ],
    build: (v) => `max(pct(${v.source || "BASIC"}, ${n(v.percent, 0)}), ${n(v.floor, 0)})`,
    worked: (v) => {
      const pct = n(v.percent);
      const floor = n(v.floor);
      if (!pct || !floor) return null;
      const low = 2000;
      return `If ${v.source || "BASIC"} is ₹${money(low)}, ${pct}% is only ₹${money((low * pct) / 100)}, so the minimum of ₹${money(floor)} is paid instead. Above that, the percentage applies normally.`;
    },
  },

  {
    id: "percent_between",
    title: "A percentage, kept between a floor and a ceiling",
    summary: "A share of something that can never go below or above set limits.",
    usedFor: "An allowance with both a guaranteed minimum and a statutory cap.",
    sentence: "Take {percent}% of {source}, keeping it between ₹{floor} and ₹{cap}",
    slots: [
      { key: "percent", label: "Percentage", kind: "percent", default: 12 },
      { key: "source", label: "Of which line", kind: "component", default: "BASIC" },
      { key: "floor", label: "Minimum amount", kind: "money", default: 500 },
      { key: "cap", label: "Maximum amount", kind: "money", default: 1800 },
    ],
    build: (v) => `clamp(pct(${v.source || "BASIC"}, ${n(v.percent, 0)}), ${n(v.floor, 0)}, ${n(v.cap, 0)})`,
    worked: (v) => {
      const pct = n(v.percent);
      const floor = n(v.floor);
      const cap = n(v.cap);
      if (!pct || !cap) return null;
      return `Whatever ${v.source || "BASIC"} is, this never pays less than ₹${money(floor)} or more than ₹${money(cap)}. In between, it is ${pct}% of ${v.source || "BASIC"}.`;
    },
  },

  {
    id: "conditional_threshold",
    title: "Only applies below a salary threshold",
    summary: "Pays a share only while another line stays under a limit; nothing above it.",
    usedFor: "ESI — 0.75% of gross, but only for employees earning ₹21,000 or less.",
    sentence: "If {source} is ₹{threshold} or less, take {percent}% of it — otherwise nothing",
    slots: [
      { key: "source", label: "Which line decides", kind: "component", default: "GROSS" },
      { key: "threshold", label: "Eligibility limit", kind: "money", default: 21000 },
      { key: "percent", label: "Percentage", kind: "percent", default: 0.75 },
    ],
    build: (v) =>
      `if(${v.source || "GROSS"} <= ${n(v.threshold, 0)}, pct(${v.source || "GROSS"}, ${n(v.percent, 0)}), 0)`,
    worked: (v) => {
      const threshold = n(v.threshold);
      const pct = n(v.percent);
      if (!threshold || !pct) return null;
      const under = Math.round(threshold * 0.8);
      return `${v.source || "GROSS"} of ₹${money(under)} is under the limit, so this pays ₹${money((under * pct) / 100)}. ${v.source || "GROSS"} of ₹${money(threshold + 1000)} is over the limit, so it pays ₹0 — the employee is no longer eligible.`;
    },
  },

  {
    id: "remainder",
    title: "Whatever is left over",
    summary: "Absorbs the balance so the components add up exactly to the total.",
    usedFor: "Special Allowance — the balancing figure that makes everything sum to CTC.",
    sentence: "Take {total} and subtract {subtract}",
    slots: [
      { key: "total", label: "Start from", kind: "component", default: "CTC_MONTHLY" },
      {
        key: "subtract",
        label: "Subtract these lines",
        kind: "component",
        default: "BASIC",
        hint: "Separate several codes with a comma, e.g. BASIC, HRA, CONVEYANCE.",
      },
    ],
    build: (v) => {
      const parts = String(v.subtract || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const total = v.total || "CTC_MONTHLY";
      return parts.length ? `max(${total} - ${parts.join(" - ")}, 0)` : `${total}`;
    },
    worked: (v) => {
      const parts = String(v.subtract || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return null;
      return `If ${v.total || "CTC_MONTHLY"} is ₹50,000 and ${parts.join(" + ")} together come to ₹38,000, this pays the remaining ₹12,000. It can never go negative — if the other lines already exceed the total, it pays ₹0.`;
    },
  },

  {
    id: "per_day",
    title: "A daily rate for each day worked",
    summary: "Multiplies a per-day amount by the days actually payable.",
    usedFor: "A daily attendance bonus, or wages for staff paid by the day.",
    sentence: "Pay ₹{rate} for each of the {days}",
    slots: [
      { key: "rate", label: "Amount per day", kind: "money", default: 100 },
      { key: "days", label: "Count which days", kind: "component", default: "PAYABLE_DAYS" },
    ],
    build: (v) => `${n(v.rate, 0)} * ${v.days || "PAYABLE_DAYS"}`,
    worked: (v) => {
      const rate = n(v.rate);
      if (!rate) return null;
      return `At ₹${money(rate)} a day, someone with 24 payable days earns ₹${money(rate * 24)}. Someone absent for 4 of those earns ₹${money(rate * 20)}.`;
    },
  },

  {
    id: "overtime_pay",
    title: "Payment for overtime hours",
    summary: "An hourly rate multiplied by the overtime hours recorded.",
    usedFor: "Turning approved overtime hours into money on the payslip.",
    sentence: "Pay ₹{rate} for every overtime hour worked",
    slots: [{ key: "rate", label: "Rate per overtime hour", kind: "money", default: 150 }],
    build: (v) => `${n(v.rate, 0)} * OVERTIME_HOURS`,
    worked: (v) => {
      const rate = n(v.rate);
      if (!rate) return null;
      return `At ₹${money(rate)} an hour, 12 approved overtime hours pay ₹${money(rate * 12)}. Overtime hours come from the attendance policy, so only approved hours reach this line.`;
    },
  },
];

export const RECIPES_BY_ID = Object.fromEntries(PAYROLL_RECIPES.map((r) => [r.id, r]));

/**
 * System variables an admin can reference, grouped and explained. The engine
 * accepts these plus any component code — this list is what makes them
 * choosable rather than something you have to already know exist.
 */
export const SYSTEM_VARIABLE_GROUPS: Array<{
  label: string;
  variables: Array<{ code: string; label: string; description: string }>;
}> = [
  {
    label: "Salary",
    variables: [
      { code: "CTC_MONTHLY", label: "Monthly CTC", description: "The employee's total monthly cost to company." },
      { code: "CTC_ANNUAL", label: "Annual CTC", description: "The same figure for a full year." },
      { code: "GROSS", label: "Gross pay", description: "All earnings added up, before deductions." },
      { code: "TOTAL_EARNINGS", label: "Total earnings", description: "Sum of every earning line." },
      { code: "TOTAL_DEDUCTIONS", label: "Total deductions", description: "Sum of every deduction line." },
    ],
  },
  {
    label: "Days",
    variables: [
      { code: "PAYABLE_DAYS", label: "Payable days", description: "Days the employee is actually paid for this month." },
      { code: "PRESENT_DAYS", label: "Present days", description: "Days marked present." },
      { code: "ABSENT_DAYS", label: "Absent days", description: "Days marked absent." },
      { code: "LOP_DAYS", label: "Loss-of-pay days", description: "Unpaid days that reduce salary." },
      { code: "PAID_LEAVE_DAYS", label: "Paid leave days", description: "Approved leave that is still paid." },
      { code: "WORKING_DAYS", label: "Working days", description: "Working days in the month, excluding weekly offs and holidays." },
      { code: "DAYS_IN_PERIOD", label: "Calendar days", description: "Every day in the month, including weekends." },
    ],
  },
  {
    label: "Overtime",
    variables: [
      { code: "OVERTIME_HOURS", label: "Overtime hours", description: "Approved overtime hours for the period." },
    ],
  },
];

export const ALL_SYSTEM_VARIABLES = SYSTEM_VARIABLE_GROUPS.flatMap((g) => g.variables);
