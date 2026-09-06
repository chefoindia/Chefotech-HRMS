/**
 * Types for surveys and performance. Mirrors the shape() functions in the
 * backend survey and performance services.
 */

// ── Audience (shared with review cycles) ────────────────────────────────────

export type AudienceType = "all" | "department" | "location" | "employees";

export interface Audience {
  type: AudienceType;
  departmentId: string | null;
  locationId: string | null;
  employeeIds: string[];
}

export const EMPTY_AUDIENCE: Audience = { type: "all", departmentId: null, locationId: null, employeeIds: [] };

// ── Surveys ─────────────────────────────────────────────────────────────────

export const QUESTION_TYPES = [
  { value: "rating", label: "Rating (1 to N stars)" },
  { value: "scale", label: "Scale (1 to N)" },
  { value: "single", label: "Choose one" },
  { value: "multi", label: "Choose many" },
  { value: "yes_no", label: "Yes or no" },
  { value: "text", label: "Free text" },
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number]["value"];

export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  help: string;
  options: string[];
  required: boolean;
  max: number;
  lowLabel: string;
  highLabel: string;
}

export type SurveyStatus = "draft" | "open" | "closed";

export interface Survey {
  id: string;
  title: string;
  description: string;
  questions: SurveyQuestion[];
  audience: Audience;
  anonymous: boolean;
  status: SurveyStatus;
  opensAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  invitedCount: number;
  respondedCount: number;
  rate: number;
  reminderSentAt: string | null;
  createdBy: string | null;
  createdAt: string;
  /** Only on the employee list. */
  responded?: boolean;
}

export interface SurveyQuestionResult {
  id: string;
  type: QuestionType;
  prompt: string;
  answered: number;
  max?: number;
  average?: number | null;
  distribution?: Record<string, number>;
  counts?: Record<string, number>;
  texts?: Array<{ text: string; by: string | null }>;
}

export interface SurveyResults {
  survey: Survey;
  responded: number;
  invited: number;
  rate: number;
  questions: SurveyQuestionResult[];
  respondents: Array<{ employeeId: string | null; name: string; code: string | null; submittedAt: string }> | null;
}

export type SurveyAnswer = { questionId: string; value: unknown };

// ── Performance ─────────────────────────────────────────────────────────────

export interface PersonRef {
  id: string;
  name?: string;
  code?: string | null;
  managerId?: string | null;
}

export type GoalStatus = "active" | "completed" | "cancelled";

export interface Goal {
  id: string;
  employee: PersonRef | null;
  employeeId: string;
  cycleId: string | null;
  title: string;
  description: string;
  metric: string;
  target: string;
  weight: number;
  progress: number;
  status: GoalStatus;
  dueDate: string | null;
  alignedTo: { id: string; title: string } | null;
  updates: Array<{ at: string; byName: string; progress: number; note: string }>;
  completedAt: string | null;
  createdAt: string;
}

export interface CycleSection {
  key: string;
  title: string;
  description: string;
  rated: boolean;
}

export type CycleStatus = "draft" | "self_review" | "manager_review" | "closed";
export type ReviewStatus = "pending_self" | "pending_manager" | "completed" | "acknowledged";

export interface ReviewCycle {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: CycleStatus;
  audience: Audience;
  sections: CycleSection[];
  ratingScale: number;
  selfReviewRequired: boolean;
  selfDueAt: string | null;
  managerDueAt: string | null;
  startedAt: string | null;
  closedAt: string | null;
  participants: number;
  counts: Record<ReviewStatus, number>;
  completion: number;
  createdAt: string;
  reviews?: Review[];
}

export interface Review {
  id: string;
  cycle: { id: string; name?: string; status?: CycleStatus; sections?: CycleSection[]; ratingScale?: number; selfDueAt?: string | null; managerDueAt?: string | null; periodStart?: string; periodEnd?: string };
  employee: PersonRef | null;
  reviewer: PersonRef | null;
  status: ReviewStatus;
  self: { ratings: Record<string, number>; answers: Record<string, string>; submittedAt: string | null };
  /** Null on the employee's own view until the review is complete. */
  manager: { ratings: Record<string, number>; answers: Record<string, string>; overallRating: number | null; summary: string; submittedAt: string | null } | null;
  goals: Array<{ goalId: string | null; title: string; progress: number; weight: number; status: string }>;
  employeeComment: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface CycleSummary {
  cycle: ReviewCycle;
  distribution: Record<string, number>;
  average: number | null;
  sectionAverages: Record<string, number | null>;
  ratings: Array<{ employeeId: string; name: string; code: string | null; overallRating: number }>;
}

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending_self: "Self-review due",
  pending_manager: "Manager review due",
  completed: "Completed",
  acknowledged: "Acknowledged",
};

export const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = {
  draft: "Draft",
  self_review: "Self-review",
  manager_review: "Manager review",
  closed: "Closed",
};
