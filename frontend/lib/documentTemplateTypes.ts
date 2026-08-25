export const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "spacer",
  "divider",
  "table",
  "key_values",
  "signature",
  "page_break",
  "image",
  "list",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export interface BlockColumn {
  key: string;
  label: string;
  width?: number;
  align?: "left" | "center" | "right";
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
  columns?: BlockColumn[];
  rows?: unknown[];
  source?: string | null;
  items?: string[];
  condition?: string | null;
  style?: BlockStyle;
  height?: number | null;
  fileId?: string | null;
}

export const TEMPLATE_CATEGORIES = [
  "offer_letter",
  "appointment_letter",
  "experience_certificate",
  "relieving_letter",
  "salary_slip",
  "salary_certificate",
  "leave_approval",
  "warning_letter",
  "increment_letter",
  "promotion_letter",
  "confirmation_letter",
  "id_card",
  "attendance_report",
  "custom",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const CONTEXT_TYPES = ["employee", "payslip", "leave_request", "organization"] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

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
    text: string;
    useLetterhead: boolean;
  };
  footer: {
    enabled: boolean;
    text: string;
    showPageNumbers: boolean;
    showGeneratedOn: boolean;
  };
  watermark: { enabled: boolean; text: string; opacity: number };
  blocks: TemplateBlock[];
  numbering: { enabled: boolean; prefix: string; nextNumber: number; padding: number };
  isSystem: boolean;
  isActive: boolean;
}

export interface TemplateVariable {
  path: string;
  example: string;
}

export const BLANK_TEMPLATE = {
  name: "Untitled template",
  code: "",
  description: "",
  category: "custom" as TemplateCategory,
  contextType: "employee" as ContextType,
  page: { size: "A4" as const, orientation: "portrait" as const, margins: { top: 60, bottom: 60, left: 50, right: 50 } },
  header: { enabled: true, showLogo: true, showCompanyName: true, showAddress: true, text: "", useLetterhead: false },
  footer: { enabled: true, text: "", showPageNumbers: true, showGeneratedOn: false },
  watermark: { enabled: false, text: "", opacity: 0.08 },
  blocks: [] as TemplateBlock[],
  numbering: { enabled: false, prefix: "", nextNumber: 1, padding: 4 },
};

export function blankBlock(type: BlockType): TemplateBlock {
  const base: TemplateBlock = { type, style: { align: "left" } };
  switch (type) {
    case "heading":
      return { ...base, text: "Section heading", style: { fontSize: 13, bold: true, align: "left" } };
    case "paragraph":
      return { ...base, text: "Write the paragraph text here. Use {{employee.name}} style placeholders for anything that should come from the data." };
    case "list":
      return { ...base, items: ["First point"] };
    case "spacer":
      return { ...base, height: 12 };
    case "divider":
    case "page_break":
      return base;
    case "table":
      return { ...base, source: "", columns: [{ key: "name", label: "Name", width: 1 }], rows: [] };
    case "key_values":
      return { ...base, source: "", rows: [] };
    case "signature":
      return { ...base, text: "Authorised Signatory" };
    case "image":
      return { ...base, height: 100 };
    default:
      return base;
  }
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  spacer: "Spacer",
  divider: "Divider line",
  table: "Table",
  key_values: "Label / value grid",
  signature: "Signature line",
  page_break: "Page break",
  image: "Image",
  list: "Bulleted list",
};
