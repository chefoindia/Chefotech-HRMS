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
 * Everything the renderer draws comes from the template and the context. There
 * is no hard-coded company name, no hard-coded heading, nothing that would
 * need a code change to produce a different document.
 */

const PAGE_SIZES = { A4: "A4", LETTER: "LETTER", LEGAL: "LEGAL" };

/**
 * @param {Object} template  DocumentTemplate (lean)
 * @param {Object} context   { employee, company, salary, ... }
 * @param {Object} [options] { logoBuffer }
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
      };

      drawHeader(doc, template, context, theme, options);
      drawWatermark(doc, template, theme);

      for (const block of template.blocks || []) {
        if (!shouldRender(block, context)) continue;
        drawBlock(doc, block, context, theme);
      }

      drawFooters(doc, template, context, theme);

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

function drawHeader(doc, template, context, theme, options) {
  if (!template.header || !template.header.enabled) return;

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
  const rightEdge = doc.page.width - doc.page.margins.right;

  if (template.header.showCompanyName && company.name) {
    doc
      .fillColor(theme.primary)
      .fontSize(15)
      .font("Helvetica-Bold")
      .text(company.name, textX, startY, { width: rightEdge - textX });
  }

  if (template.header.showAddress && company.addressLine) {
    doc
      .fillColor(theme.muted)
      .fontSize(8.5)
      .font("Helvetica")
      .text(company.addressLine, textX, doc.y + 1, { width: rightEdge - textX });
  }

  if (template.header.text) {
    doc
      .fillColor(theme.muted)
      .fontSize(9)
      .text(interpolate(template.header.text, context), textX, doc.y + 2, {
        width: rightEdge - textX,
      });
  }

  doc.moveDown(0.6);
  doc
    .strokeColor(theme.primary)
    .lineWidth(1.5)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(rightEdge, doc.y)
    .stroke();
  doc.moveDown(1);
}

function drawWatermark(doc, template, theme) {
  if (!template.watermark || !template.watermark.enabled || !template.watermark.text) return;

  doc.save();
  doc
    .fillColor(theme.primary)
    .fillOpacity(template.watermark.opacity || 0.08)
    .fontSize(70)
    .font("Helvetica-Bold");

  doc.rotate(-40, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.text(template.watermark.text, 0, doc.page.height / 2 - 40, {
    width: doc.page.width,
    align: "center",
  });
  doc.restore();
  doc.fillOpacity(1);
}

function drawBlock(doc, block, context, theme) {
  const style = block.style || {};
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  if (style.marginTop) doc.moveDown(style.marginTop / 12);

  switch (block.type) {
    case "heading":
      doc
        .fillColor(style.colour || theme.text)
        .fontSize(style.fontSize || 13)
        .font("Helvetica-Bold")
        .text(interpolate(block.text, context), { align: style.align || "left", width });
      doc.moveDown(0.4);
      break;

    case "paragraph":
      doc
        .fillColor(style.colour || theme.text)
        .fontSize(style.fontSize || 10)
        .font(style.bold ? "Helvetica-Bold" : style.italic ? "Helvetica-Oblique" : "Helvetica")
        .text(interpolate(block.text, context), {
          align: style.align || "left",
          width,
          lineGap: 2.5,
        });
      doc.moveDown(0.5);
      break;

    case "list": {
      doc.fillColor(style.colour || theme.text).fontSize(style.fontSize || 10).font("Helvetica");
      for (const item of block.items || []) {
        doc.text(`•  ${interpolate(item, context)}`, {
          width: width - 12,
          indent: 12,
          lineGap: 2,
        });
      }
      doc.moveDown(0.5);
      break;
    }

    case "key_values":
      drawKeyValues(doc, block, context, theme, width);
      break;

    case "table":
      drawTable(doc, block, context, theme, width);
      break;

    case "signature":
      drawSignature(doc, block, context, theme, width);
      break;

    case "divider":
      doc
        .strokeColor(theme.border)
        .lineWidth(0.75)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
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

/** Two-column label/value grid — the shape most letters and payslips need. */
function drawKeyValues(doc, block, context, theme, width) {
  const rows = resolveRows(block, context);
  const columnWidth = width / 2 - 10;
  const startY = doc.y;
  let left = true;
  let leftY = startY;
  let rightY = startY;

  for (const row of rows) {
    const label = interpolate(row.label || row.key || "", context);
    const value = interpolate(String(row.value === undefined ? "" : row.value), context);

    const x = left ? doc.page.margins.left : doc.page.margins.left + columnWidth + 20;
    const y = left ? leftY : rightY;

    doc.fillColor(theme.muted).fontSize(8.5).font("Helvetica").text(label, x, y, { width: columnWidth });
    doc
      .fillColor(theme.text)
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(value || "—", x, doc.y, { width: columnWidth });

    if (left) leftY = doc.y + 8;
    else rightY = doc.y + 8;
    left = !left;
  }

  doc.y = Math.max(leftY, rightY);
  doc.moveDown(0.3);
}

function drawTable(doc, block, context, theme, width) {
  const rows = resolveRows(block, context);
  const columns = block.columns && block.columns.length
    ? block.columns
    : inferColumns(rows);

  if (!columns.length) return;

  const totalWeight = columns.reduce((sum, c) => sum + (c.width || 1), 0);
  const columnWidths = columns.map((c) => ((c.width || 1) / totalWeight) * width);

  // Header
  let x = doc.page.margins.left;
  const headerY = doc.y;
  doc.rect(doc.page.margins.left, headerY - 3, width, 20).fill("#F3F4F6");
  doc.fillColor(theme.text).fontSize(9).font("Helvetica-Bold");
  columns.forEach((column, index) => {
    doc.text(column.label || column.key, x + 5, headerY + 2, {
      width: columnWidths[index] - 10,
      align: column.align || "left",
    });
    x += columnWidths[index];
  });
  doc.y = headerY + 20;

  // Body
  doc.font("Helvetica").fontSize(9);
  for (const row of rows) {
    // Start a new page before a row would be clipped by the bottom margin.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
    }

    x = doc.page.margins.left;
    const rowY = doc.y + 4;
    let maxY = rowY;

    columns.forEach((column, index) => {
      const raw = row[column.key];
      const value = interpolate(
        raw === undefined || raw === null ? "" : String(raw),
        context
      );
      doc.fillColor(theme.text).text(value, x + 5, rowY, {
        width: columnWidths[index] - 10,
        align: column.align || "left",
      });
      maxY = Math.max(maxY, doc.y);
      x += columnWidths[index];
    });

    doc.y = maxY + 4;
    doc
      .strokeColor(theme.border)
      .lineWidth(0.5)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + width, doc.y)
      .stroke();
    doc.y += 2;
  }

  doc.moveDown(0.6);
}

function drawSignature(doc, block, context, theme, width) {
  const y = doc.y + 30;
  const boxWidth = width / 2 - 20;

  doc
    .strokeColor(theme.border)
    .lineWidth(0.75)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.margins.left + boxWidth, y)
    .stroke();

  doc
    .fillColor(theme.muted)
    .fontSize(9)
    .font("Helvetica")
    .text(interpolate(block.text || "Authorised Signatory", context), doc.page.margins.left, y + 5, {
      width: boxWidth,
    });

  doc.y = y + 30;
}

function resolveRows(block, context) {
  if (block.source) {
    const value = getPath(context, block.source);
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, v]) => ({ key, label: key, value: v }));
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

function drawFooters(doc, template, context, theme) {
  if (!template.footer || !template.footer.enabled) return;

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);

    const y = doc.page.height - doc.page.margins.bottom + 18;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc
      .strokeColor(theme.border)
      .lineWidth(0.5)
      .moveTo(doc.page.margins.left, y - 8)
      .lineTo(doc.page.margins.left + width, y - 8)
      .stroke();

    doc.fillColor(theme.muted).fontSize(7.5).font("Helvetica");

    if (template.footer.text) {
      doc.text(interpolate(template.footer.text, context), doc.page.margins.left, y, {
        width: width * 0.7,
      });
    }

    if (template.footer.showPageNumbers) {
      doc.text(
        `Page ${i - range.start + 1} of ${range.count}`,
        doc.page.margins.left,
        y,
        { width, align: "right" }
      );
    }

    if (template.footer.showGeneratedOn) {
      doc.text(
        `Generated on ${new Date().toLocaleDateString("en-GB")}`,
        doc.page.margins.left,
        y + 10,
        { width, align: "right" }
      );
    }
  }
}

/** Resolve {{a.b.c}} against the context. Missing paths render as blank. */
function interpolate(text, context) {
  if (!text) return "";
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = getPath(context, path);
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toLocaleDateString("en-GB");
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
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      flattenContext(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

module.exports = { render, interpolate, getPath };
