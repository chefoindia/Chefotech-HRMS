/**
 * In-app help.
 *
 * A focused subset of the web documentation: only the things an *employee* can
 * act on. An employee has no attendance policy to configure and no payroll to
 * run, and burying the four answers they need under twenty they cannot use is
 * how a help centre stops being read.
 *
 * Each answer explains the rule rather than the button, because almost every
 * support ticket from an employee is really a question about why a number came
 * out the way it did.
 */
import { BRAND } from "../brand";


export interface HelpArticle {
  id: string;
  question: string;
  answer: string;
  /** Where in the app this is done, if anywhere. */
  route?: string;
  routeLabel?: string;
  keywords: string[];
}

export const HELP_CATEGORIES = [
  { id: "attendance", title: "Attendance and check-in", icon: "time-outline" as const },
  { id: "leave", title: "Leave", icon: "airplane-outline" as const },
  { id: "pay", title: "Pay and documents", icon: "wallet-outline" as const },
  { id: "app", title: "Using the app", icon: "phone-portrait-outline" as const },
];

export const HELP_ARTICLES: (HelpArticle & { category: string })[] = [
  // ── Attendance ────────────────────────────────────────────────────────────
  {
    id: "how-check-in",
    category: "attendance",
    question: "How do I check in and out?",
    answer:
      "Open the Home tab and tap the large button. It says Check in when you are out and Check out when you are in — the app takes that from what the server has actually recorded, not from what the phone remembers, so it stays correct even if you were offline for a while.\n\nIf your employer records work locations, your position is read at the moment you tap and only then. The app never follows you in the background.",
    route: "/(app)",
    routeLabel: "Go to Home",
    keywords: ["check in", "check out", "punch", "clock", "attendance"],
  },
  {
    id: "location-denied",
    category: "attendance",
    question: "I said no to location. Can I still check in?",
    answer:
      "Yes. The app will still record your check-in without a location.\n\nWhether that is accepted is your employer's policy, not the app's — if they require a location, the server will tell you so when you tap. You can turn location back on for " + BRAND.name + " in your phone's Settings at any time.",
    keywords: ["location", "gps", "permission", "denied", "geofence"],
  },
  {
    id: "forgot-punch",
    category: "attendance",
    question: "I forgot to check out. What now?",
    answer:
      "Open Attendance, tap the day, and choose \"Something looks wrong\". Describe what happened and submit it.\n\nYou do not have to know the exact times — leave them blank if you are not sure and your approver can set them. Once approved, the day is recalculated automatically.",
    route: "/(app)/correction",
    routeLabel: "Request a correction",
    keywords: ["forgot", "missing", "punch", "correction", "regularize", "wrong"],
  },
  {
    id: "why-half-day",
    category: "attendance",
    question: "Why was I marked half day?",
    answer:
      "Tap that day in Attendance. The detail shows exactly which rule decided it — the hours you worked, the threshold your attendance policy sets, and whether it was met.\n\nThresholds are set by your employer and can be a share of your shift or a fixed number of hours. If the reasoning is right but the times are wrong, request a correction from the same screen.",
    route: "/(app)/attendance",
    routeLabel: "Open Attendance",
    keywords: ["half day", "absent", "late", "status", "why"],
  },

  // ── Leave ─────────────────────────────────────────────────────────────────
  {
    id: "apply-leave",
    category: "leave",
    question: "How do I apply for leave?",
    answer:
      "Leave tab → Apply. Pick the type, choose your dates, and the app shows exactly how many days will be deducted before you submit — day by day, with the reason for each one.\n\nThat figure comes from the same engine that will do the real deduction, so what you see is what will happen.",
    route: "/(app)/apply-leave",
    routeLabel: "Apply for leave",
    keywords: ["apply", "leave", "holiday", "time off", "request"],
  },
  {
    id: "sandwich",
    category: "leave",
    question: "Why does my request cost more days than I asked for?",
    answer:
      "Because of how your leave type treats non-working days that fall inside the range. There are three possibilities, and your employer chooses one per leave type:\n\n• Excluded — weekends and holidays inside your range are not deducted.\n• Included — every calendar day is deducted.\n• Sandwich — a day off is deducted only when there is leave on both sides of it. Taking Friday and Monday means the weekend is deducted too; taking Friday alone does not.\n\nThe preview on the apply screen names which one applied to each day, so you can see the arithmetic before you submit.",
    keywords: ["sandwich", "weekend", "extra days", "deducted", "more days", "cost"],
  },
  {
    id: "leave-rejected",
    category: "leave",
    question: "My leave was rejected and I do not know why",
    answer:
      "The reason your approver gave is shown on the request itself, in the Leave tab. Rejections require a reason, so there should always be one.\n\nIf it is not clear, speak to your approver directly — they decided it, not the system.",
    route: "/(app)/leave",
    routeLabel: "Open Leave",
    keywords: ["rejected", "declined", "refused", "reason"],
  },
  {
    id: "balance-wrong",
    category: "leave",
    question: "My leave balance looks wrong",
    answer:
      "Check the Leave tab: each type shows how much was allocated, how much you have used, and anything still pending approval. Pending requests are held against your balance so you cannot accidentally book the same days twice.\n\nIf the allocation itself looks wrong, that is set by your leave policy and only your HR team can change it.",
    route: "/(app)/leave",
    routeLabel: "Open Leave",
    keywords: ["balance", "wrong", "missing", "days", "allocation"],
  },

  // ── Pay and documents ─────────────────────────────────────────────────────
  {
    id: "payslip-missing",
    category: "pay",
    question: "Where is my payslip?",
    answer:
      "Payslips appear in the Payslips tab once your employer publishes them for a pay period. A payslip that has been calculated but not yet approved and published will not appear — that is deliberate, so you never see a figure that is still being checked.",
    route: "/(app)/payslips",
    routeLabel: "Open Payslips",
    keywords: ["payslip", "salary", "pay", "missing", "not showing"],
  },
  {
    id: "payslip-download",
    category: "pay",
    question: "Can I download my payslip as a PDF?",
    answer:
      "Yes. Open Payslips and tap Download PDF on any payslip. Your phone's share sheet opens so you can save it, email it, or send it wherever you need — which is usually a bank or a landlord.",
    route: "/(app)/payslips",
    routeLabel: "Open Payslips",
    keywords: ["download", "pdf", "payslip", "save", "bank"],
  },
  {
    id: "deduction-query",
    category: "pay",
    question: "I do not understand a deduction on my payslip",
    answer:
      "Every line on a payslip carries the working behind it — the formula, the values that went into it, and the number of days used. Open the payslip and look at the line in question.\n\nIf the working is right but an input is wrong (an absence that should have been leave, for example), fix the underlying day rather than the payslip: request an attendance correction and speak to HR about reprocessing.",
    keywords: ["deduction", "loss of pay", "lop", "less", "salary", "cut"],
  },

  // ── Using the app ─────────────────────────────────────────────────────────
  {
    id: "app-lock",
    category: "app",
    question: "Can I lock the app with my fingerprint or face?",
    answer:
      "Yes. Settings → Require unlock. Once on, the app asks for your fingerprint, face or device passcode when you come back to it after being away for a minute or more.\n\nIt is off by default, and it needs a biometric or passcode already set up on your phone.",
    route: "/(app)/settings",
    routeLabel: "Open Settings",
    keywords: ["lock", "fingerprint", "face id", "biometric", "security", "passcode"],
  },
  {
    id: "offline",
    category: "app",
    question: "Does the app work without a connection?",
    answer:
      "You can read anything already loaded, but check-in needs a connection — the time has to be recorded by the server so it cannot be altered on the phone.\n\nIf you tap check in while offline the app tells you it was not recorded, rather than pretending it worked. Try again once you have signal.",
    keywords: ["offline", "no internet", "network", "connection", "signal"],
  },
  {
    id: "wrong-details",
    category: "app",
    question: "My personal details are wrong",
    answer:
      "Open Profile from the More tab. Some fields you can edit yourself; the rest — your designation, department, joining date, salary — are maintained by HR and are shown read-only, because they are contractual.\n\nTo change one of those, contact your HR team.",
    route: "/(app)/profile",
    routeLabel: "Open Profile",
    keywords: ["profile", "details", "wrong", "change", "update", "edit"],
  },
  {
    id: "signed-out",
    category: "app",
    question: "The app keeps signing me out",
    answer:
      "Sessions end for a few reasons: your employer's security settings set how long a session lasts, signing in on another device can end this one depending on that policy, and changing your password ends every session everywhere.\n\nIf it happens repeatedly and none of those apply, tell your HR team — they can see the sign-in history on your account.",
    keywords: ["signed out", "logout", "session", "expired", "keeps"],
  },
];

export function searchHelp(query: string) {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  return HELP_ARTICLES.filter((article) => {
    const haystack = [
      article.question,
      article.answer,
      ...article.keywords,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(text);
  });
}
