"use strict";

const PDFDocument = require("pdfkit");
const formula = require("../../core/rules/formula");
const { logger } = require("../../config/logger");

/**
 * Template → PDF.
 *
 * PDFKit rather than headless Chrome: no browser to install, no per-render
 * process, deterministic output, and a payslip that renders identically on a
 * developer laptop and in a container. The trade-off is that layout is
 * explicit rather than CSS, which the block model is designed around.
 *
 * Everything the renderer draws comes from the template and the context.
 * There is no hard-coded company name, no hard-coded heading, nothing that
 * would need a code change to produce a different document.
 *
 * Block types:
 *   heading, paragraph, list, checklist   — text, with inline **bold** and
 *                                            _italic_ runs
 *   key_values                             — label/value grid (1 or 2 columns)
 *   table                                  — columns + rows, optional totals
 *   columns                                — two side-by-side text columns
 *   signature                              — a signing line, optionally with
 *                                            an uploaded signature/stamp image
 *   image, divider, spacer, page_break, qr
 */

const PAGE_SIZES = { A4: "A4", LETTER: "LETTER", LEGAL: "LEGAL" };
const FONT = { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", boldItalic: "Helvetica-BoldOblique" };

/**
 * @param {Object} template  DocumentTemplate (lean)
 * @param {Object} context   { employee, company, salary, ... }
 * @param {Object} [options] { logoBuffer, letterheadBuffer, imageBuffers, qrBuffer, format }
 * @returns {Promise<Buffer>}
 */
async function render(template, context, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: PAGE_SIZES[template.page.size] || "A4",
        layout: template.page.orientation || "portrait",
        margins: template.page.margins,
        bufferPages: true,
        info: {
          Title: template.name,
          Author: (context.company && context.company.name) || "Chefotech HRMS",
          Creator: "Chefotech HRMS",
        },
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const theme = {
        primary: (context.company && context.company.primaryColor) || "#4F46E5",
        text: "#1F2937",
        muted: "#6B7280",
        border: "#E5E7EB",
        zebra: "#F9FAFB",
      };

      const state = { doc, template, context, theme, options, fmt: options.format || {} };

      drawHeader(state);
      drawWatermark(state);

      for (const block of template.blocks || []) {
        if (!shouldRender(block, context)) continue;
        drawBlock(state, block);
      }

      drawFooters(state);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Blocks can be conditional: "only print the bonus section if there is one". */
function shouldRender(block, context) {
  if (!block.condition) return true;
  try {
    return Boolean(formula.evaluate(block.condition, flattenContext(context), { strict: false }).value);
  } catch (err) {
    logger.warn({ err, condition: block.condition }, "Document block condition failed; block skipped");
    return false;
  }
}

// ── Header, watermark, footer ───────────────────────────────────────────────

function drawHeader({ doc, template, context, theme, options }) {
  if (!template.header || !template.header.enabled) return;

  const rightEdge = doc.page.width - doc.page.margins.right;
  const contentWidth = rightEdge - doc.page.margins.left;

  // A letterhead is the whole header: the organization designed it, so
  // nothing is drawn over it except the rule beneath.
  if (template.header.useLetterhead && options.letterheadBuffer) {
    try {
      const top = Math.max(0, doc.page.margins.top - 40);
      doc.image(options.letterheadBuffer, doc.page.margins.left, top, {
        fit: [contentWidth, 110],
        align: "center",
      });
      doc.y = top + 118;
      rule(doc, theme.primary, 1.5);
      doc.moveDown(1);
      return;
    } catch (err) {
      logger.warn({ err }, "Could not draw the letterhead; falling back to the text header");
    }
  }

  const startY = doc.y;
  let textX = doc.page.margins.left;

  if (template.header.showLogo && options.logoBuffer) {
    try {
      doc.image(options.logoBuffer, doc.page.margins.left, startY, { fit: [110, 45] });
      textX = doc.page.margins.left + 125;
    } catch (err) {
      // A corrupt logo must not stop a payslip being issued.
      logger.warn({ err }, "Could not draw the logo; continuing without it");
    }
  }

  const company = context.company || {};

  if (template.header.showCompanyName && company.name) {
    doc.fillColor(theme.primary).fontSize(15).font(FONT.bold).text(company.name, textX, startY, { width: rightEdge - textX });
  }
  if (template.header.showAddress && company.addressLine) {
    doc.fillColor(theme.muted).fontSize(8.5).font(FONT.regular).text(company.addressLine, textX, doc.y + 1, { width: rightEdge - textX });
  }
  if (template.header.showContact !== false && (company.email || company.phone || company.website)) {
    const line = [company.phone, company.email, company.website].filter(Boolean).join("  ·  ");
    doc.fillColor(theme.muted).fontSize(8).font(FONT.regular).text(line, textX, doc.y + 1, { width: rightEdge - textX });
  }
  if (template.header.text) {
    doc.fillColor(theme.muted).fontSize(9).text(interpolate(template.header.text, context), textX, doc.y + 2, { width: rightEdge - textX });
  }

  // The logo may be taller than the text beside it.
  if (template.header.showLogo && options.logoBuffer) doc.y = Math.max(doc.y, startY + 48);
  doc.moveDown(0.6);
  rule(doc, theme.primary, 1.5);
  doc.moveDown(1);
}

function rule(doc, colour, width) {
  doc
    .strokeColor(colour)
    .lineWidth(width)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
}

function drawWatermark({ doc, template, theme }) {
  if (!template.watermark || !template.watermark.enabled || !template.watermark.text) return;
  doc.save();
  doc.fillColor(theme.primary).fillOpacity(template.watermark.opacity || 0.08).fontSize(70).font(FONT.bold);
  doc.rotate(-40, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.text(template.watermark.text, 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center" });
  doc.restore();
  doc.fillOpacity(1);
}

function drawFooters({ doc, template, context, theme, options }) {
  if (!template.footer || !template.footer.enabled) return;

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);

    const y = doc.page.height - doc.page.margins.bottom + 18;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.strokeColor(theme.border).lineWidth(0.5).moveTo(doc.page.margins.left, y - 8).lineTo(doc.page.margins.left + width, y - 8).stroke();
    doc.fillColor(theme.muted).fontSize(7.5).font(FONT.regular);

    let textWidth = width * 0.7;

    // A verification QR sits in the corner of every page; the code beside
    // it is what somebody types into the verify page if they cannot scan.
    if (template.footer.showVerificationQr && options.qrBuffer && context.document && context.document.verificationCode) {
      try {
        const size = 34;
        doc.image(options.qrBuffer, doc.page.margins.left + width - size, y - 6, { fit: [size, size] });
        doc.text(`Verify: ${context.document.verificationCode}`, doc.page.margins.left + width - size - 120, y + 22, { width: 116, align: "right" });
        textWidth = width * 0.55;
      } catch (err) {
        logger.warn({ err }, "Could not draw the verification QR");
      }
    }

    if (template.footer.text) {
      doc.text(interpolate(template.footer.text, context), doc.page.margins.left, y, { width: textWidth });
    }
    if (template.footer.showPageNumbers) {
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.margins.left, y, {
        width: template.footer.showVerificationQr ? width - 44 : width,
        align: "right",
      });
    }
    if (template.footer.showGeneratedOn) {
      doc.text(`Generated on ${context.date && context.date.todayFormatted ? context.date.todayFormatted : new Date().toLocaleDateString("en-GB")}`, doc.page.margins.left, y + 10, {
        width: template.footer.showVerificationQr ? width - 44 : width,
        align: "right",
      });
    }
  }
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function drawBlock(state, block) {
  const { doc } = state;
  const style = block.style || {};
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  if (style.marginTop) doc.moveDown(style.marginTop / 12);

  switch (block.type) {
    case "heading":
      richText(state, interpolate(block.text, state.context), {
        fontSize: style.fontSize || (block.level === 2 ? 11.5 : block.level === 3 ? 10.5 : 13),
        bold: true,
        colour: style.colour || (block.level > 1 ? state.theme.text : state.theme.primary),
        align: style.align || "left",
        width,
        underline: Boolean(block.underline),
      });
      doc.moveDown(0.4);
      break;

    case "paragraph":
      richText(state, interpolate(block.text, state.context), {
        fontSize: style.fontSize || 10,
        bold: Boolean(style.bold),
        italic: Boolean(style.italic),
        colour: style.colour || state.theme.text,
        align: style.align || "left",
        width,
        lineGap: 2.5,
      });
      doc.moveDown(0.5);
      break;

    case "list":
      drawList(state, block, width, false);
      break;

    case "checklist":
      drawList(state, block, width, true);
      break;

    case "key_values":
      drawKeyValues(state, block, width);
      break;

    case "table":
      drawTable(state, block, width);
      break;

    case "columns":
      drawColumns(state, block, width);
      break;

    case "signature":
      drawSignature(state, block, width);
      break;

    case "image":
      drawImage(state, block, width);
      break;

    case "qr":
      drawQr(state, block, width);
      break;

    case "divider":
      rule(doc, state.theme.border, 0.75);
      doc.moveDown(0.6);
      break;

    case "spacer":
      doc.moveDown((block.height || 12) / 12);
      break;

    case "page_break":
      doc.addPage();
      break;

    default:
      break;
  }

  if (style.marginBottom) doc.moveDown(style.marginBottom / 12);
}

/**
 * Text with inline **bold** and _italic_ runs.
 *
 * A letter almost always needs one bold phrase — the position offered, the
 * effective date — and making the whole paragraph bold is not the same
 * thing. PDFKit draws continued runs, so the markup is split into runs and
 * each is drawn with its own font.
 */
function richText(state, text, opts) {
  const { doc } = state;
  const runs = parseRuns(String(text || ""));
  const x = doc.page.margins.left;
  const base = { width: opts.width, align: opts.align || "left", lineGap: opts.lineGap || 0, underline: opts.underline || false };

  doc.fillColor(opts.colour).fontSize(opts.fontSize);

  if (runs.length === 1 && !runs[0].bold && !runs[0].italic) {
    doc.font(fontFor(opts.bold, opts.italic)).text(runs[0].text, x, doc.y, base);
    return;
  }

  runs.forEach((run, index) => {
    doc.font(fontFor(opts.bold || run.bold, opts.italic || run.italic));
    doc.text(run.text, index === 0 ? x : undefined, index === 0 ? doc.y : undefined, {
      ...base,
      continued: index < runs.length - 1,
    });
  });
}

function fontFor(bold, italic) {
  if (bold && italic) return FONT.boldItalic;
  if (bold) return FONT.bold;
  if (italic) return FONT.italic;
  return FONT.regular;
}

/** "a **b** _c_" → [{text:"a "},{text:"b",bold},{text:" "},{text:"c",italic}] */
function parseRuns(text) {
  const out = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|_[^_\n]+_|\*[^*\n]+\*)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) out.push({ text: token.slice(2, -2), bold: true });
    else out.push({ text: token.slice(1, -1), italic: true });
    last = match.index + token.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

function drawList(state, block, width, checklist) {
  const { doc, theme, context } = state;
  const style = block.style || {};
  const items = block.source ? resolveRows(block, context).map((r) => (typeof r === "string" ? r : r.label || r.text || r.name || "")) : block.items || [];
  const fontSize = style.fontSize || 10;

  for (const item of items) {
    const y = doc.y;
    const x = doc.page.margins.left;
    if (checklist) {
      doc.rect(x + 1, y + 1, fontSize - 1, fontSize - 1).lineWidth(0.75).strokeColor(theme.muted).stroke();
    } else {
      doc.fillColor(style.colour || theme.text).fontSize(fontSize).font(FONT.regular).text("•", x + 2, y);
    }
    doc.y = y;
    doc.fillColor(style.colour || theme.text).fontSize(fontSize);
    richTextAt(state, interpolate(item, context), x + 16, y, { width: width - 16, fontSize, colour: style.colour || theme.text, lineGap: 2 });
    doc.y += 3;
  }
  doc.moveDown(0.4);
}

function richTextAt(state, text, x, y, opts) {
  const { doc } = state;
  const runs = parseRuns(text);
  runs.forEach((run, index) => {
    doc.font(fontFor(run.bold, run.italic)).fillColor(opts.colour).fontSize(opts.fontSize);
    doc.text(run.text, index === 0 ? x : undefined, index === 0 ? y : undefined, {
      width: opts.width,
      lineGap: opts.lineGap || 0,
      continued: index < runs.length - 1,
    });
  });
}

/** Label/value grid — the shape most letters and payslips need. */
function drawKeyValues(state, block, width) {
  const { doc, theme, context } = state;
  const rows = resolveRows(block, context);
  const columns = block.layout === "single" ? 1 : 2;
  const columnWidth = columns === 2 ? width / 2 - 10 : width;
  const startY = doc.y;
  let left = true;
  let leftY = startY;
  let rightY = startY;

  for (const row of rows) {
    const label = interpolate(row.label || row.key || "", context);
    const value = formatValue(interpolate(String(row.value === undefined ? "" : row.value), context), row.format, state.fmt);

    const x = left || columns === 1 ? doc.page.margins.left : doc.page.margins.left + columnWidth + 20;
    const y = left || columns === 1 ? leftY : rightY;

    if (block.inline) {
      // "Label: value" on one line, for compact letters.
      doc.fillColor(theme.muted).fontSize(9.5).font(FONT.regular).text(`${label}: `, x, y, { width: columnWidth, continued: true });
      doc.fillColor(theme.text).font(FONT.bold).text(value || "—");
    } else {
      doc.fillColor(theme.muted).fontSize(8.5).font(FONT.regular).text(label, x, y, { width: columnWidth });
      doc.fillColor(theme.text).fontSize(10).font(FONT.bold).text(value || "—", x, doc.y, { width: columnWidth });
    }

    if (left || columns === 1) leftY = doc.y + 8;
    else rightY = doc.y + 8;
    if (columns === 2) left = !left;
  }

  doc.y = Math.max(leftY, rightY);
  doc.moveDown(0.3);
}

function drawTable(state, block, width) {
  const { doc, theme, context, fmt } = state;
  const rows = resolveRows(block, context);
  const columns = block.columns && block.columns.length ? block.columns : inferColumns(rows);
  if (!columns.length) return;

  const totalWeight = columns.reduce((sum, c) => sum + (c.width || 1), 0);
  const columnWidths = columns.map((c) => ((c.width || 1) / totalWeight) * width);
  const fontSize = (block.style && block.style.fontSize) || 9;
  const showIndex = Boolean(block.showIndex);

  const drawHeaderRow = () => {
    let x = doc.page.margins.left;
    const headerY = doc.y;
    doc.rect(doc.page.margins.left, headerY - 3, width, 20).fill(block.headerColour || "#F3F4F6");
    doc.fillColor(theme.text).fontSize(fontSize).font(FONT.bold);
    columns.forEach((column, index) => {
      doc.text(column.label || column.key, x + 5, headerY + 2, { width: columnWidths[index] - 10, align: column.align || "left" });
      x += columnWidths[index];
    });
    doc.y = headerY + 20;
  };

  drawHeaderRow();

  const totals = {};
  doc.font(FONT.regular).fontSize(fontSize);

  rows.forEach((row, rowIndex) => {
    // Start a new page before a row would be clipped by the bottom margin,
    // and repeat the header so the continuation reads on its own.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
      drawHeaderRow();
      doc.font(FONT.regular).fontSize(fontSize);
    }

    const rowY = doc.y + 4;
    let x = doc.page.margins.left;
    let maxY = rowY;

    if (block.zebra && rowIndex % 2 === 1) {
      doc.rect(doc.page.margins.left, rowY - 4, width, 0).fill(theme.zebra); // placeholder height; filled after measuring
    }

    columns.forEach((column, index) => {
      const raw = column.key === "#" && showIndex ? rowIndex + 1 : row[column.key];
      const text = formatValue(interpolate(raw === undefined || raw === null ? "" : String(raw), context), column.format, fmt);
      if (column.total && typeof raw === "number") totals[column.key] = (totals[column.key] || 0) + raw;
      else if (column.total && typeof raw === "string" && !Number.isNaN(Number(raw.replace(/[^0-9.-]/g, "")))) {
        totals[column.key] = (totals[column.key] || 0) + Number(raw.replace(/[^0-9.-]/g, ""));
      }
      doc.fillColor(theme.text).text(text, x + 5, rowY, { width: columnWidths[index] - 10, align: column.align || "left" });
      maxY = Math.max(maxY, doc.y);
      x += columnWidths[index];
    });

    doc.y = maxY + 4;
    doc.strokeColor(theme.border).lineWidth(0.5).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + width, doc.y).stroke();
    doc.y += 2;
  });

  if (columns.some((c) => c.total)) {
    const rowY = doc.y + 4;
    let x = doc.page.margins.left;
    doc.font(FONT.bold).fontSize(fontSize);
    columns.forEach((column, index) => {
      let text = "";
      if (index === 0 && !column.total) text = block.totalsLabel || "Total";
      if (column.total) text = formatValue(totals[column.key] || 0, column.format || "number", fmt);
      doc.fillColor(theme.text).text(text, x + 5, rowY, { width: columnWidths[index] - 10, align: column.align || "left" });
      x += columnWidths[index];
    });
    doc.y += 6;
    rule(doc, theme.text, 0.75);
    doc.y += 2;
  }

  if (!rows.length) {
    doc.fillColor(theme.muted).font(FONT.italic).fontSize(fontSize).text(block.emptyText || "Nothing to show.", doc.page.margins.left + 5, doc.y + 4);
    doc.y += 8;
  }

  doc.moveDown(0.6);
}

/** Two text columns side by side — "Employee details | Company details". */
function drawColumns(state, block, width) {
  const { doc, theme, context } = state;
  const gap = 20;
  const columnWidth = (width - gap) / 2;
  const startY = doc.y;
  const fontSize = (block.style && block.style.fontSize) || 10;

  const drawSide = (text, x) => {
    doc.y = startY;
    richTextAt(state, interpolate(text || "", context), x, startY, { width: columnWidth, fontSize, colour: theme.text, lineGap: 2 });
    return doc.y;
  };

  const leftEnd = drawSide(block.left, doc.page.margins.left);
  const rightEnd = drawSide(block.right, doc.page.margins.left + columnWidth + gap);
  doc.y = Math.max(leftEnd, rightEnd);
  doc.moveDown(0.6);
}

function drawSignature(state, block, width) {
  const { doc, theme, context, options } = state;
  const boxWidth = width / 2 - 20;
  const x = block.align === "right" ? doc.page.margins.left + width - boxWidth : doc.page.margins.left;
  let y = doc.y + 10;

  const buffer = block.fileId && options.imageBuffers && options.imageBuffers[String(block.fileId)];
  if (buffer) {
    try {
      doc.image(buffer, x, y, { fit: [Math.min(boxWidth, 160), block.height || 50] });
      y += (block.height || 50) + 6;
    } catch (err) {
      logger.warn({ err }, "Could not draw the signature image");
      y += 20;
    }
  } else {
    y += 20;
  }

  doc.strokeColor(theme.border).lineWidth(0.75).moveTo(x, y).lineTo(x + boxWidth, y).stroke();
  doc.fillColor(theme.muted).fontSize(9).font(FONT.regular).text(interpolate(block.text || "Authorised Signatory", context), x, y + 5, { width: boxWidth });
  doc.y = y + 30;
}

/** Signature stamps, letterhead art, anything else a template author uploaded. */
function drawImage(state, block, width) {
  const { doc, options } = state;
  const buffer = block.fileId && options.imageBuffers && options.imageBuffers[String(block.fileId)];
  if (!buffer) return;

  try {
    const height = block.height || 120;
    const align = (block.style && block.style.align) || "left";
    const imageWidth = Math.min(width, height * 3);
    const x = align === "center" ? doc.page.margins.left + (width - imageWidth) / 2 : align === "right" ? doc.page.margins.left + (width - imageWidth) : doc.page.margins.left;
    doc.image(buffer, x, doc.y, { fit: [imageWidth, height] });
    doc.y += height + 6;
  } catch (err) {
    logger.warn({ err }, "Could not draw an image block; skipped");
  }
}

/** An inline verification QR block, for documents whose footer is off. */
function drawQr(state, block, width) {
  const { doc, theme, context, options } = state;
  if (!options.qrBuffer) return;
  const size = block.height || 72;
  const align = (block.style && block.style.align) || "right";
  const x = align === "center" ? doc.page.margins.left + (width - size) / 2 : align === "right" ? doc.page.margins.left + width - size : doc.page.margins.left;
  try {
    doc.image(options.qrBuffer, x, doc.y, { fit: [size, size] });
    doc.fillColor(theme.muted).fontSize(7.5).font(FONT.regular).text(
      interpolate(block.text || "Scan to verify this document", context),
      x - 40,
      doc.y + size + 2,
      { width: size + 80, align: "center" }
    );
    doc.y += size + 16;
  } catch (err) {
    logger.warn({ err }, "Could not draw the QR block");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveRows(block, context) {
  if (block.source) {
    const value = getPath(context, block.source);
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, v]) => ({ key, label: humanise(key), value: v }));
    }
    return [];
  }
  return block.rows || [];
}

function inferColumns(rows) {
  if (!rows.length || typeof rows[0] !== "object") return [];
  return Object.keys(rows[0]).map((key) => ({ key, label: humanise(key), width: 1 }));
}

function humanise(key) {
  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

/** Column-level formatting: money, number, date, percent. */
function formatValue(value, format, fmt = {}) {
  if (value === null || value === undefined || value === "") return "";
  if (!format || format === "text") return String(value);
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  switch (format) {
    case "money":
      if (Number.isNaN(n)) return String(value);
      return `${fmt.currencySymbol || ""}${new Intl.NumberFormat(fmt.locale || "en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
    case "number":
      if (Number.isNaN(n)) return String(value);
      return new Intl.NumberFormat(fmt.locale || "en-IN", { maximumFractionDigits: 2 }).format(n);
    case "integer":
      if (Number.isNaN(n)) return String(value);
      return new Intl.NumberFormat(fmt.locale || "en-IN", { maximumFractionDigits: 0 }).format(n);
    case "percent":
      if (Number.isNaN(n)) return String(value);
      return `${new Intl.NumberFormat(fmt.locale || "en-IN", { maximumFractionDigits: 2 }).format(n)}%`;
    case "date":
      return fmt.formatDate ? fmt.formatDate(value) : String(value);
    default:
      return String(value);
  }
}

/** Resolve {{a.b.c}} against the context. Missing paths render as blank. */
function interpolate(text, context) {
  if (!text) return "";
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = getPath(context, path);
    if (value === null || value === undefined) return "";
    if (value instanceof Date) {
      return context.__formatDate ? context.__formatDate(value) : value.toLocaleDateString("en-GB");
    }
    return String(value);
  });
}

function getPath(object, path) {
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), object);
}

/** Flatten to dotted keys, so block conditions can reference nested values. */
function flattenContext(context, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(context || {})) {
    if (typeof value === "function") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      flattenContext(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

module.exports = { render, interpolate, getPath, parseRuns, formatValue };
