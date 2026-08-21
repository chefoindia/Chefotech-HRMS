/**
 * Marketing site content.
 *
 * Held as data so the page components stay layout-only, and so the things that
 * MUST be true before launch are visible in one file rather than buried in
 * JSX.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  Two blocks below are deliberately empty: TESTIMONIALS and TRUST_METRICS.
 *
 *  Publishing invented customer quotes or invented adoption numbers is not a
 *  placeholder problem, it is a false-advertising problem — in India that is
 *  the Consumer Protection Act 2019 and the CCPA misleading-advertisement
 *  guidelines, and comparable rules apply nearly everywhere else. The sections
 *  that render these hide themselves completely while the arrays are empty, so
 *  the site is honest today and becomes richer the moment you have real ones.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface FeatureModule {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  href: string;
  /** Which mockup to render beside it. */
  visual: "dashboard" | "attendance" | "leave" | "payroll";
  /** Image on the right by default; alternates down the page. */
  flip?: boolean;
}

export const FEATURE_MODULES: FeatureModule[] = [
  {
    id: "core-hr",
    eyebrow: "Core HR",
    title: "One record per person, and it stays correct",
    body: "Employee profiles, org structure, documents and history in one place — with the fields your organisation actually uses, not the ones a vendor guessed at.",
    points: [
      "Add custom fields without waiting for a release",
      "Reporting lines that drive approvals automatically",
      "Documents with expiry tracking and reminders",
      "Full change history on every record",
    ],
    href: "/docs/employee-records",
    visual: "dashboard",
  },
  {
    id: "time-attendance",
    eyebrow: "Time & attendance",
    title: "Attendance that matches your rules, not ours",
    body: "Grace periods, late marks, half-day thresholds and overtime are settings. Night shifts and rotating rosters are handled properly rather than as an afterthought.",
    points: [
      "Biometric devices over API, webhook or file import",
      "Night shifts produce one record, not two half days",
      "Raw device events kept, so a mis-mapped device is recoverable",
      "Every day shows which rule decided its status",
    ],
    href: "/docs/attendance-policy",
    visual: "attendance",
    flip: true,
  },
  {
    id: "leave",
    eyebrow: "Leave",
    title: "Including the parts that cause arguments",
    body: "Accruals, carry forward, encashment and the sandwich rule. Employees see exactly what a request costs — and why — before they submit it.",
    points: [
      "Three counting modes for weekends inside a request",
      "Prorated allocation for mid-year joiners",
      "Eligibility by service, probation, notice period or gender",
      "Approval updates the balance and the attendance together",
    ],
    href: "/docs/sandwich-rule",
    visual: "leave",
  },
  {
    id: "payroll",
    eyebrow: "Payroll",
    title: "Every payslip carries its own working",
    body: "Salary structures built from formulas you control. When someone queries a deduction, the answer is on the payslip rather than in someone's memory.",
    points: [
      "Components that reference each other in a defined order",
      "Proration basis is configuration, not an assumption",
      "Exceptions are surfaced, not silently rounded away",
      "Deterministic: the same inputs always give the same output",
    ],
    href: "/docs/payroll-run",
    visual: "payroll",
    flip: true,
  },
];

/** The mega-menu, and the source of the mobile menu. */
export const NAV_SECTIONS = [
  {
    label: "Product",
    columns: [
      {
        heading: "Modules",
        links: [
          { label: "Core HR", description: "Records, org structure, documents", href: "/docs/employee-records" },
          { label: "Time & attendance", description: "Shifts, policies, corrections", href: "/docs/attendance-policy" },
          { label: "Leave", description: "Types, accrual, approvals", href: "/docs/leave-policy" },
          { label: "Payroll", description: "Components, structures, runs", href: "/docs/payroll-run" },
        ],
      },
      {
        heading: "Platform",
        links: [
          { label: "Biometric devices", description: "API, webhook or file import", href: "/docs/biometric-devices" },
          { label: "Approval workflows", description: "Conditions, escalation, delegation", href: "/docs/approval-workflows" },
          { label: "Roles & permissions", description: "Define your own roles", href: "/docs/roles-and-permissions" },
          { label: "Audit trail", description: "Append-only, exportable", href: "/docs/audit-trail" },
        ],
      },
    ],
    featured: {
      title: "See everything it does",
      body: "The full feature list, each linked to its documentation.",
      href: "/features",
      cta: "Browse features",
    },
  },
  {
    label: "Resources",
    columns: [
      {
        heading: "Learn",
        links: [
          { label: "Documentation", description: "How every feature works", href: "/docs" },
          { label: "Getting started", description: "Your first hour, in order", href: "/docs/quick-start" },
          { label: "Help centre", description: "Answers to common questions", href: "/support" },
        ],
      },
      {
        heading: "Trust",
        links: [
          { label: "Security", description: "How we protect employee data", href: "/security" },
          { label: "System status", description: "Live service health", href: "/status" },
          { label: "Legal", description: "Terms, privacy, DPA", href: "/legal" },
        ],
      },
    ],
    featured: {
      title: "Guided walkthroughs",
      body: "Ask in your own words and the product walks you through the real screens.",
      href: "/support",
      cta: "How it works",
    },
  },
  {
    label: "Employee app",
    columns: [
      {
        heading: "For your team",
        links: [
          { label: "Check in and out", description: "One tap, with an optional location", href: "/download#features" },
          { label: "Apply for leave", description: "See the exact cost before submitting", href: "/download#features" },
          { label: "Payslips and documents", description: "Downloadable, always with you", href: "/download#features" },
        ],
      },
    ],
    featured: {
      title: "Get the app",
      body: "Android and the web app today. Themed with your own brand colour automatically.",
      href: "/download",
      cta: "Download",
    },
  },
];

/** Capability strip under the hero. Claims here are about the product itself. */
export const CAPABILITY_STRIP = [
  "Configurable policy engine",
  "Biometric device support",
  "Multi-location & multi-shift",
  "Role-based access control",
  "Append-only audit trail",
];

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
}

/**
 * REAL customer quotes only. Add entries once you have written permission to
 * use each person's name, role and employer — the testimonial section does not
 * render at all while this is empty.
 */
export const TESTIMONIALS: Testimonial[] = [];

/**
 * REAL, verifiable figures only — the number of organisations actually using
 * the platform, employees actually managed, uptime actually measured. The
 * metrics band does not render while this is empty.
 */
export const TRUST_METRICS: { value: string; label: string; note?: string }[] = [];

/**
 * Integrations that genuinely work today. Listing a logo the product cannot
 * actually connect to is the kind of claim a customer discovers during
 * implementation, which is the worst possible moment.
 */
export const INTEGRATIONS: { name: string; category: string; available: boolean }[] = [
  { name: "ZKTeco devices", category: "Biometric", available: true },
  { name: "eSSL devices", category: "Biometric", available: true },
  { name: "Generic webhook bridge", category: "Biometric", available: true },
  { name: "CSV / Excel import", category: "Data", available: true },
  { name: "Excel & CSV export", category: "Data", available: true },
  { name: "SMTP email", category: "Notifications", available: true },
  { name: "Google Drive", category: "Storage", available: true },
  { name: "Cloudinary", category: "Storage", available: true },
];

/**
 * The employee app's platforms. Android and the web app are real today;
 * iOS is genuinely deferred — an Apple Developer Program membership is a
 * recurring cost that only makes sense once there is revenue to justify it.
 * That is stated on the download page rather than hidden, because a "Coming
 * soon" with no reason reads as vapourware.
 */
export const APP_PLATFORMS = [
  {
    id: "web",
    name: "Web app",
    status: "live" as const,
    body: "Works in any modern browser, on any device — including an iPhone. No install, no store, no update to wait for.",
    cta: "Open the web app",
    href: "/login",
  },
  {
    id: "android",
    name: "Android",
    status: "live" as const,
    body: "A native app: offline-tolerant, with biometric app-lock and push-ready notifications. Installed directly — no Play Store account needed to try it.",
    cta: "Download for Android",
    href: "/downloads/chefotech-hrms.apk",
  },
  {
    id: "ios",
    name: "iOS",
    status: "planned" as const,
    body: "The app is already built for iOS and is not blocked on engineering — it is one App Store submission away. It ships once an Apple Developer Program membership is in place.",
    cta: "Notify me when it ships",
    href: "/contact",
  },
];

/** What the employee app actually does — used on /download and in the AI/automation sections. */
export const APP_FEATURES = [
  {
    icon: "finger-print" as const,
    title: "Check in from your phone",
    body: "One tap to clock in and out. Your location is read only at that moment, never in the background — and only if your employer's policy asks for one.",
  },
  {
    icon: "calendar" as const,
    title: "Attendance you can read",
    body: "Every day is coloured by its status. Tap one to see exactly which rule decided it, and raise a correction on the spot if it is wrong.",
  },
  {
    icon: "airplane" as const,
    title: "Leave, with the cost shown upfront",
    body: "Pick your dates and see the exact day count — including how weekends inside the range are treated — before you submit.",
  },
  {
    icon: "wallet" as const,
    title: "Payslips, always with you",
    body: "Every published payslip, downloadable as a PDF straight into your phone's share sheet — ready for a bank or a landlord.",
  },
  {
    icon: "color-palette" as const,
    title: "Themed like your company",
    body: "The app's colour is your organisation's own brand colour, applied automatically the moment HR changes it in Settings — no update, no release.",
  },
  {
    icon: "lock-closed" as const,
    title: "Locked behind Face ID or a fingerprint",
    body: "Optional, off by default, and only ever a convenience layer in front of the same secure sign-in — never a replacement for it.",
  },
];

/**
 * What the AI setup assistant actually does, for the homepage highlight
 * section. Every line here corresponds to a real, shipped endpoint — nothing
 * speculative.
 */
export const AI_HIGHLIGHTS = [
  {
    title: "Answers, mid-setup, in seconds",
    body: "Stuck on what a field means while configuring a policy? Ask in plain words. The assistant is grounded in what this platform actually does, so it explains the real screen you are looking at rather than guessing.",
  },
  {
    title: "Drafts the policy, you approve it",
    body: "Describe a leave policy in one sentence — \"18 casual leaves, sandwich rule on weekends, no carry forward\" — and review a structured draft before anything is saved. Nothing is written until a human accepts it.",
  },
  {
    title: "Runs on your own key",
    body: "Bring your own Google Gemini API key. Usage and cost stay inside your own Google account — a busy month for your team never competes with any other customer's budget.",
  },
];

/** Answers on the home page. The full set lives on /support. */
export const HOME_FAQS = [
  {
    q: "Can it handle our specific leave rules?",
    a: "Almost certainly. Counting modes, accrual, carry forward, encashment, proration and eligibility are all configuration. The rule that usually breaks other systems — whether a weekend inside a leave request is deducted — has three settings, and the employee sees the resulting cost before they submit.",
  },
  {
    q: "Our biometric device is on the office LAN. Will it sync?",
    a: "Yes, without opening your network. A cloud service cannot reach a device on a private LAN directly, so the platform also accepts punches pushed by webhook through a small bridge, or imported from the device's own log file.",
  },
  {
    q: "What happens to our data if we leave?",
    a: "Your account becomes read-only for 30 days so you can export everything, then we delete it. Export stays available even during a billing dispute — we do not hold data hostage.",
  },
  {
    q: "Does the trial limit what we can try?",
    a: "No. The trial is a full account, not a sandbox. Configure your real policies and see what the engine does with them. When it ends the account becomes read-only rather than being deleted.",
  },
  {
    q: "Who can see salary information?",
    a: "Only roles you grant it to. Salary visibility is a separate permission from the rest of an employee record, so a manager can approve leave without seeing pay.",
  },
];
