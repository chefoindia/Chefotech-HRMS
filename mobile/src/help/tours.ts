/**
 * Tour definitions.
 *
 * Kept as data, and deliberately short. A twelve-step tour on a phone is a
 * twelve-step tour nobody finishes; each of these covers one screen and ends
 * while the user still has the patience to act on it.
 *
 * `target` matches a <TourTarget id="…"> in a screen. A step with no target is
 * a plain card, which is the right shape for an opening or closing message.
 */
import { BRAND } from "../brand";


export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** The id of a TourTarget on the current screen, if any. */
  target?: string;
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    id: "getting-started",
    title: "Getting around",
    description: "The three things you will use most.",
    steps: [
      {
        id: "welcome",
        title: `Welcome to ${BRAND.name}`,
        body: "A short tour of the three things people use most. It takes about a minute, and you can leave at any point.",
      },
      {
        id: "check-in",
        target: "check-in-card",
        title: "Check in and out here",
        body: "One tap. If your employer records work locations, your position is read at that moment — and only then, never in the background.",
      },
      {
        id: "quick-actions",
        target: "quick-actions",
        title: "The things you do most",
        body: "Apply for leave, fix a day the system got wrong, or open your payslips — without hunting through menus.",
      },
      {
        id: "tabs",
        title: "Everything else is in the tabs",
        body: "Attendance shows your month day by day. Leave holds your balances and requests. More has your profile, documents and help.",
      },
    ],
  },
  {
    id: "apply-leave",
    title: "Applying for leave",
    description: "How the day count is worked out before you submit.",
    steps: [
      {
        id: "type",
        target: "leave-type",
        title: "Start with the type",
        body: "Your available balance for that type appears as soon as you pick it, so you know what you have before choosing dates.",
      },
      {
        id: "dates",
        target: "leave-dates",
        title: "Choose your dates",
        body: "Half days are supported at either end of the range — useful when you only need the afternoon.",
      },
      {
        id: "preview",
        target: "leave-preview",
        title: "This is the part worth reading",
        body: "The cost is calculated before you submit, day by day, naming the rule that produced it. If a weekend inside your range is being deducted, you will see exactly why.",
      },
    ],
  },
  {
    id: "attendance",
    title: "Reading your attendance",
    description: "What each day means, and how to correct one.",
    steps: [
      {
        id: "calendar",
        target: "attendance-calendar",
        title: "Your month at a glance",
        body: "Each day is coloured by its status. Tap any day to see the times recorded and which rule decided it.",
      },
      {
        id: "correction",
        target: "attendance-summary",
        title: "If a day looks wrong",
        body: "Forgot to check out? Raise a correction from the day itself. Your manager approves it and the day is recalculated automatically.",
      },
    ],
  },
];

export const TOURS_BY_ID: Record<string, Tour> = Object.fromEntries(
  TOURS.map((tour) => [tour.id, tour])
);
