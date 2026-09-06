/**
 * Types shared by the document designer, the sheet designer and every
 * screen that lists or acts on documents.
 *
 * These mirror `backend/src/modules/documents/document.model.js` and
 * `sheetTemplate.model.js` field for field. When one side gains a field the
 * other must too — the renderer ignores nothing it is sent, and the editor
 * offers nothing the renderer cannot draw.
 */

// ── PDF templates ───────────────────────────────────────────────────────────

export const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "checklist",
  "key_values",
  "table",
  "columns",
  "signature",
  "image",
  "qr",
  "spacer",
  "divider",
  "page_break",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const COLUMN_FORMATS = ["text", "number", "integer", "money", "percent", "date"] as const;
export type ColumnFormat = (typeof COLUMN_FORMATS)[number];

export interface BlockColumn {
  key: string;
  label: string;
  width?: number;
  align?: "left" | "center" | "right";
  format?: ColumnFormat;
  total?: boolean;
}

export interface BlockStyle {
  fontSize?: number | null;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right" | "justify";
  colour?: string | null;
  marginTop?: number | null;
  marginBottom?: number | null;
}

export interface TemplateBlock {
  _id?: string;
  type: BlockType;
  text?: string;
  level?: number;
  underline?: boolean;
  columns?: BlockColumn[];
  rows?: unknown[];
  source?: string | null;
  zebra?: boolean;
  showIndex?: boolean;
  totalsLabel?: string;
  emptyText?: string;
  headerColour?: string | null;
  layout?: "double" | "single";
  inline?: boolean;
  left?: string;
  right?: string;
  items?: string[];
  condition?: string | null;
  align?: "left" | "right";
  style?: BlockStyle;
  height?: number | null;
  fileId?: string | null;
}

export const TEMPLATE_CATEGORIES = [
  "offer_letter",
  "letter_of_intent",
  "appointment_letter",
  "confirmation_letter",
  "probation_extension",
  "increment_letter",
  "promotion_letter",
  "transfer_letter",
  "appraisal_letter",
  "contract_extension",
  "warning_letter",
  "show_cause_notice",
  "termination_letter",
  "resignation_acceptance",
  "relieving_letter",
  "experience_certificate",
  "full_final_settlement",
  "salary_slip",
  "salary_certificate",
  "salary_annexure",
  "bonafide_certificate",
  "address_proof",
  "no_objection_certificate",
  "internship_certificate",
  "training_certificate",
  "leave_approval",
  "id_card",
  "joining_checklist",
  "exit_checklist",
  "attendance_report",
  "custom",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const CONTEXT_TYPES = ["employee", "payslip", "leave_request", "exit", "organization"] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

export const CONTEXT_LABELS: Record<ContextType, string> = {
  employee: "An employee",
  payslip: "A payslip (employee + pay period)",
  leave_request: "A leave request",
  exit: "An exiting employee (adds settlement figures)",
  organization: "The organization only",
};

export const DOCUMENT_CATEGORIES = ["identity", "employment", "education", "salary", "certificate", "company", "medical", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export interface DocumentTemplate {
  id: string;
  name: string;
  code: string;
  description?: string;
  category: TemplateCategory;
  contextType: ContextType;
  page: {
    size: "A4" | "LETTER" | "LEGAL";
    orientation: "portrait" | "landscape";
    margins: { top: number; bottom: number; left: number; right: number };
  };
  header: {
    enabled: boolean;
    showLogo: boolean;
    showCompanyName: boolean;
    showAddress: boolean;
    showContact: boolean;
    text: string;
    useLetterhead: boolean;
  };
  footer: {
    enabled: boolean;
    text: string;
    showPageNumbers: boolean;
    showGeneratedOn: boolean;
    showVerificationQr: boolean;
  };
  watermark: { enabled: boolean; text: string; opacity: number };
  blocks: TemplateBlock[];
  numbering: { enabled: boolean; prefix: string; nextNumber: number; padding: number };
  storeAs: { category: DocumentCategory | null; visibleToEmployee: boolean; requireAcknowledgement: boolean };
  version: number;
  tags: string[];
  isSystem: boolean;
  isActive: boolean;
  updatedAt?: string;
}

export interface TemplateVariable {
  path: string;
  example: string;
}

export interface TemplateVersion {
  id: string;
  version: number;
  note: string;
  blockCount: number;
  name: string;
  changedBy: string | null;
  createdAt: string;
}

export const BLANK_TEMPLATE = {
  name: "Untitled template",
  code: "",
  description: "",
  category: "custom" as TemplateCategory,
  contextType: "employee" as ContextType,
  page: { size: "A4" as const, orientation: "portrait" as const, margins: { top: 60, bottom: 60, left: 50, right: 50 } },
  header: { enabled: true, showLogo: true, showCompanyName: true, showAddress: true, showContact: true, text: "", useLetterhead: false },
  footer: { enabled: true, text: "", showPageNumbers: true, showGeneratedOn: false, showVerificationQr: false },
  watermark: { enabled: false, text: "", opacity: 0.08 },
  blocks: [] as TemplateBlock[],
  numbering: { enabled: false, prefix: "", nextNumber: 1, padding: 4 },
  storeAs: { category: null, visibleToEmployee: true, requireAcknowledgement: false },
  tags: [] as string[],
};

export function blankBlock(type: BlockType): TemplateBlock {
  const base: TemplateBlock = { type, style: { align: "left" } };
  switch (type) {
    case "heading":
      return { ...base, text: "Section heading", level: 2, style: { align: "left" } };
    case "paragraph":
      return {
        ...base,
        text: "Write the paragraph here. Use **bold** for emphasis and fields such as {{employee.name}} for anything that should come from the record.",
        style: { align: "justify" },
      };
    case "list":
      return { ...base, items: ["First point"] };
    case "checklist":
      return { ...base, items: ["First item to tick off"] };
    case "spacer":
      return { ...base, height: 12 };
    case "divider":
    case "page_break":
      return base;
    case "table":
      return {
        ...base,
        source: "",
        columns: [
          { key: "name", label: "Item", width: 3 },
          { key: "amount", label: "Amount", width: 1, align: "right", format: "money" },
        ],
        rows: [],
        zebra: true,
      };
    case "key_values":
      return { ...base, source: null, rows: [{ label: "Employee code", value: "{{employee.employeeCode}}" }], layout: "double" };
    case "columns":
      return { ...base, left: "Left column text", right: "Right column text" };
    case "signature":
      return { ...base, text: "Authorised Signatory", align: "left" };
    case "image":
      return { ...base, height: 100 };
    case "qr":
      return { ...base, height: 80, align: "right" };
    default:
      return base;
  }
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  list: "Bulleted list",
  checklist: "Checklist",
  key_values: "Label / value grid",
  table: "Table",
  columns: "Two columns",
  signature: "Signature line",
  image: "Image",
  qr: "Verification QR",
  spacer: "Spacer",
  divider: "Divider line",
  page_break: "Page break",
};

export const BLOCK_HINTS: Record<BlockType, string> = {
  heading: "A title or section heading.",
  paragraph: "Body text with fields and **bold** or _italic_ runs.",
  list: "Bulleted points, one per line.",
  checklist: "Tick boxes — for joining and exit checklists.",
  key_values: "Pairs like Employee code → EMP001, laid out in a grid.",
  table: "Rows from live data (salary lines, payslip earnings) or typed in by hand.",
  columns: "Two side-by-side blocks of text — addresses, signatories.",
  signature: "A line with a label, optionally a signature or stamp image.",
  image: "A picture — a seal, a photo, a diagram.",
  qr: "The QR anyone can scan to verify this document is genuine.",
  spacer: "Vertical breathing room.",
  divider: "A horizontal rule.",
  page_break: "Everything after it starts on a new page.",
};

// ── Employee, company and requested documents ───────────────────────────────

export interface StoredFileRef {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
  url?: string | null;
}

export interface Acknowledgement {
  required: boolean;
  requestedAt: string | null;
  requestedBy: string | null;
  dueOn: string | null;
  acknowledgedAt: string | null;
  acknowledgedName: string;
  isOverdue: boolean;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string | { _id?: string; id?: string; employeeCode: string; personal: { firstName: string; lastName: string } };
  name: string;
  category: DocumentCategory;
  status: "pending_review" | "verified" | "rejected" | "expired";
  documentNumber: string;
  issuedOn: string | null;
  expiresOn: string | null;
  isExpired: boolean;
  daysToExpiry: number | null;
  source: "uploaded" | "generated" | "requested";
  visibleToEmployee: boolean;
  version: number;
  notes: string;
  rejectionReason?: string;
  templateId?: string | null;
  createdAt: string;
  file: StoredFileRef | null;
  acknowledgement: Acknowledgement;
  verificationCode: string | null;
}

export interface DocumentRequest {
  id: string;
  name: string;
  category: DocumentCategory;
  note: string;
  dueOn: string | null;
  status: "pending" | "fulfilled" | "cancelled";
  isOverdue: boolean;
  employee: { id: string; employeeCode: string; name: string } | null;
  requestedBy: string | null;
  fulfilledAt: string | null;
  fulfilledDocumentId: string | null;
  createdAt: string;
}

export const COMPANY_DOCUMENT_CATEGORIES = ["policy", "handbook", "form", "circular", "procedure", "other"] as const;
export type CompanyDocumentCategory = (typeof COMPANY_DOCUMENT_CATEGORIES)[number];

export interface CompanyDocument {
  id: string;
  title: string;
  description: string;
  category: CompanyDocumentCategory;
  version: string;
  effectiveFrom: string | null;
  audience: { type: "all" | "departments" | "locations"; departmentIds: string[]; locationIds: string[] };
  requireAcknowledgement: boolean;
  acknowledgedCount: number;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  isActive: boolean;
  publishedAt: string;
  file: StoredFileRef | null;
}

export interface BulkDownload extends StoredFileRef {
  createdAt?: string;
  metadata?: { templateCode?: string; count?: number; failures?: number };
}

export interface BulkJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | string;
  attempts: number;
  result: { generated: number; failed: number; failures: Array<{ employeeId: string; error: string }>; fileId: string; file: StoredFileRef } | null;
  error: string | null;
}

// ── Sheets (designable spreadsheets) ────────────────────────────────────────

export const SHEET_FORMATS = ["text", "number", "integer", "money", "percent", "date", "boolean"] as const;
export type SheetFormat = (typeof SHEET_FORMATS)[number];

export interface SheetColumn {
  _id?: string;
  key: string;
  label: string;
  width?: number;
  format?: SheetFormat;
  align?: "left" | "center" | "right" | null;
  total?: boolean;
  expression?: string | null;
  hidden?: boolean;
}

export interface SheetTemplate {
  id: string;
  name: string;
  code: string;
  description: string;
  source: string;
  columns: SheetColumn[];
  filters: Record<string, unknown>;
  sort: string | null;
  groupBy: string | null;
  header: { showCompany: boolean; title: string; subtitle: string; showPeriod: boolean; showGeneratedOn: boolean };
  footer: { text: string; showTotals: boolean; signatureLabels: string[] };
  page: { orientation: "portrait" | "landscape"; size: "A4" | "LETTER" | "LEGAL" | "A3" };
  freezeHeader: boolean;
  showRowNumbers: boolean;
  isSystem: boolean;
  isActive: boolean;
  updatedAt?: string;
}

export interface SheetField {
  key: string;
  label: string;
  type: SheetFormat | string;
  sensitive?: boolean;
}

export type SheetFilterKey =
  | "fromDate"
  | "toDate"
  | "runId"
  | "departmentId"
  | "locationId"
  | "designationId"
  | "leaveTypeId"
  | "employeeIds"
  | "status"
  | "employmentType"
  | "year"
  | "includeInactive";

export interface SheetSource {
  key: string;
  label: string;
  description: string;
  permission: string;
  sensitivePermission: string | null;
  filters: SheetFilterKey[];
  requiresDateRange: boolean;
  requiresRun: boolean;
  dynamicFields: boolean;
  fields: SheetField[];
}

export type SheetFilters = Partial<Record<SheetFilterKey, string | number | boolean | string[] | undefined>>;

export interface SheetPreview {
  columns: Array<{ key: string; label: string; format?: string; align?: string | null; total?: boolean }>;
  groups: Array<{ label: string | null; rows: Array<Record<string, string>>; totals: Record<string, number> }>;
  totals: Record<string, string>;
  rowCount: number;
  truncated: boolean;
  meta: { company: string; periodLabel: string; generatedOn: string; sourceLabel: string; filters: Record<string, string> };
}

export const BLANK_SHEET = {
  name: "Untitled sheet",
  code: "",
  description: "",
  columns: [] as SheetColumn[],
  filters: {},
  sort: null,
  groupBy: null,
  header: { showCompany: true, title: "", subtitle: "", showPeriod: true, showGeneratedOn: true },
  footer: { text: "", showTotals: true, signatureLabels: [] as string[] },
  page: { orientation: "landscape" as const, size: "A4" as const },
  freezeHeader: true,
  showRowNumbers: true,
};

/** A default column for a field, sized and formatted from the field type. */
export function columnForField(field: SheetField): SheetColumn {
  const format = (SHEET_FORMATS as readonly string[]).includes(field.type) ? (field.type as SheetFormat) : "text";
  const width = format === "text" ? (field.key === "name" || field.key === "address" ? 26 : 16) : format === "date" ? 13 : 12;
  return {
    key: field.key,
    label: field.label,
    width,
    format,
    align: ["money", "number", "integer", "percent"].includes(format) ? "right" : null,
    total: format === "money",
  };
}

// ── Scheduled sheets ─────────────────────────────────────────────────────────

export const SCHEDULE_PERIODS = [
  { value: "none", label: "No period (the sheet as it is today)" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7_days", label: "The last 7 days" },
  { value: "this_week", label: "This week so far" },
  { value: "last_week", label: "Last week (Mon to Sun)" },
  { value: "this_month", label: "This month so far" },
  { value: "last_month", label: "Last month" },
  { value: "last_payroll_run", label: "The latest processed payroll run" },
] as const;
export type SchedulePeriod = (typeof SCHEDULE_PERIODS)[number]["value"];

export interface SheetSchedule {
  id: string;
  sheet: { id: string; name?: string; code?: string; source?: string };
  name: string;
  frequency: "daily" | "weekly" | "monthly";
  dayOfWeek: number;
  dayOfMonth: number;
  hour: number;
  period: SchedulePeriod;
  format: "xlsx" | "csv" | "pdf";
  filters: SheetFilters;
  recipients: string[];
  subject: string;
  message: string;
  isActive: boolean;
  lastRunAt: string | null;
  lastRunStatus: "ok" | "failed" | null;
  lastError: string | null;
  lastFileId: string | null;
  createdAt: string;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Every Monday at 08:00", for lists. */
export function describeSchedule(s: Pick<SheetSchedule, "frequency" | "dayOfWeek" | "dayOfMonth" | "hour">) {
  const hour = `${String(s.hour).padStart(2, "0")}:00`;
  if (s.frequency === "daily") return `Every day at ${hour}`;
  if (s.frequency === "weekly") return `Every ${WEEKDAYS[s.dayOfWeek] || "Monday"} at ${hour}`;
  const d = s.dayOfMonth;
  const suffix = d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th";
  return `On the ${d}${suffix} of every month at ${hour}`;
}
