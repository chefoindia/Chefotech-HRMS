"use strict";

const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const formula = require("../../core/rules/formula");
const { logger } = require("../../config/logger");

/**
 * SheetTemplate + rows → XLSX, CSV or PDF.
 *
 * The same prepared rows feed all three, so the totals on the PDF are the
 * totals in the spreadsheet. Formula columns are evaluated once, here, by
 * the same safe expression engine payroll uses — a column can say
 * "BASIC + HRA" or "net / payableDays" and never touch JavaScript.
 */

const NUM_FMT = {
  money: "#,##0.00",
  number: "#,##0.##",
  integer: "0",
  percent: "0.00%",
  date: "dd-mmm-yyyy",
};

/**
 * Turn source rows into the final grid: visible columns, evaluated formulas,
 * grouping, and totals.
 */
function prepare(template, rows, options = {}) {
  const columns = (template.columns || []).filter((c) => !c.hidden);
  const numeric = new Set(["number", "integer", "money", "percent"]);

  const computed = rows.map((row) => {
    const out = { ...row };
    for (const column of columns) {
      if (column.expression) {
        try {
          const result = formula.evaluate(column.expression, numericView(row), { strict: false });
          out[column.key] = result && typeof result === "object" && "value" in result ? result.value : result;
        } catch (err) {
          out[column.key] = null;
        }
      }
    }
    return out;
  });

  if (template.sort) {
    const desc = template.sort.startsWith("-");
    const key = desc ? template.sort.slice(1) : template.sort;
    computed.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return desc ? -cmp : cmp;
    });
  }

  const groups = [];
  if (template.groupBy) {
    const byKey = new Map();
    for (const row of computed) {
      const key = row[template.groupBy] === null || row[template.groupBy] === undefined ? "" : String(row[template.groupBy]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row);
    }
    for (const [key, groupRows] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      groups.push({ label: key || "(none)", rows: groupRows, totals: sumColumns(columns, groupRows, numeric) });
    }
  } else {
    groups.push({ label: null, rows: computed, totals: null });
  }

  return {
    columns,
    groups,
    totals: sumColumns(columns, computed, numeric),
    rowCount: computed.length,
    numeric,
    meta: options.meta || {},
  };
}

/** Numbers as numbers for the formula engine; everything else left alone. */
function numericView(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("_")) continue;
    out[k] = typeof v === "boolean" ? (v ? 1 : 0) : v === null || v === undefined ? 0 : v;
  }
  return out;
}

function sumColumns(columns, rows, numeric) {
  const totals = {};
  for (const column of columns) {
    if (!column.total) continue;
    totals[column.key] = rows.reduce((sum, r) => {
      const v = r[column.key];
      const n = typeof v === "number" ? v : Number(String(v || "").replace(/[^0-9.-]/g, ""));
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }
  return totals;
}

// ── XLSX ────────────────────────────────────────────────────────────────────

async function toXlsx(template, prepared, meta) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Chefotech HRMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(template.name.slice(0, 30), {
    pageSetup: { orientation: template.page && template.page.orientation === "portrait" ? "portrait" : "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const columns = prepared.columns;
  const showIndex = template.showRowNumbers !== false;
  const totalColumns = columns.length + (showIndex ? 1 : 0);

  let rowIndex = 1;
  const headerLines = [];
  if (template.header && template.header.showCompany && meta.company) headerLines.push({ text: meta.company, size: 14, bold: true });
  if (template.header && template.header.title) headerLines.push({ text: template.header.title, size: 12, bold: true });
  if (template.header && template.header.subtitle) headerLines.push({ text: template.header.subtitle, size: 10 });
  if (template.header && template.header.showPeriod && meta.periodLabel) headerLines.push({ text: meta.periodLabel, size: 10 });
  if (template.header && template.header.showGeneratedOn) headerLines.push({ text: `Generated ${meta.generatedOn || new Date().toLocaleString("en-GB")}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}`, size: 9, italic: true });

  for (const line of headerLines) {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = line.text;
    row.getCell(1).font = { size: line.size, bold: Boolean(line.bold), italic: Boolean(line.italic), color: { argb: "FF1F2937" } };
    if (totalColumns > 1) sheet.mergeCells(rowIndex, 1, rowIndex, totalColumns);
    rowIndex += 1;
  }
  if (headerLines.length) rowIndex += 1;

  // Column header
  const headerRow = sheet.getRow(rowIndex);
  const headerValues = [...(showIndex ? ["#"] : []), ...columns.map((c) => c.label)];
  headerValues.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: "FF1F2937" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFC7D2FE" } } };
  });
  headerRow.height = 22;
  const headerRowIndex = rowIndex;
  rowIndex += 1;

  sheet.columns = [
    ...(showIndex ? [{ key: "_index", width: 6 }] : []),
    ...columns.map((c) => ({ key: c.key, width: c.width || 16 })),
  ];

  if (template.freezeHeader !== false) sheet.views = [{ state: "frozen", ySplit: headerRowIndex }];

  let n = 0;
  for (const group of prepared.groups) {
    if (group.label !== null) {
      const row = sheet.getRow(rowIndex);
      row.getCell(1).value = group.label;
      row.getCell(1).font = { bold: true };
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      if (totalColumns > 1) sheet.mergeCells(rowIndex, 1, rowIndex, totalColumns);
      rowIndex += 1;
    }

    for (const data of group.rows) {
      n += 1;
      const row = sheet.getRow(rowIndex);
      if (showIndex) row.getCell(1).value = n;
      columns.forEach((column, i) => {
        const cell = row.getCell(i + 1 + (showIndex ? 1 : 0));
        cell.value = cellValue(data[column.key], column.format);
        applyFormat(cell, column, prepared.numeric);
      });
      rowIndex += 1;
    }

    if (group.label !== null && group.totals && Object.keys(group.totals).length) {
      writeTotalsRow(sheet, rowIndex, columns, group.totals, showIndex, `Subtotal — ${group.label}`, prepared.numeric);
      rowIndex += 1;
    }
  }

  if (template.footer && template.footer.showTotals !== false && Object.keys(prepared.totals).length) {
    writeTotalsRow(sheet, rowIndex, columns, prepared.totals, showIndex, "Total", prepared.numeric, true);
    rowIndex += 1;
  }

  sheet.autoFilter = { from: { row: headerRowIndex, column: 1 }, to: { row: headerRowIndex, column: totalColumns } };

  if (template.footer && template.footer.text) {
    rowIndex += 1;
    sheet.getRow(rowIndex).getCell(1).value = template.footer.text;
    sheet.getRow(rowIndex).getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
  }
  if (template.footer && template.footer.signatureLabels && template.footer.signatureLabels.length) {
    rowIndex += 3;
    const per = Math.max(1, Math.floor(totalColumns / template.footer.signatureLabels.length));
    template.footer.signatureLabels.forEach((label, i) => {
      const cell = sheet.getRow(rowIndex).getCell(1 + i * per);
      cell.value = `________________________\n${label}`;
      cell.alignment = { wrapText: true };
    });
  }

  const about = workbook.addWorksheet("About");
  about.columns = [{ header: "Field", key: "field", width: 22 }, { header: "Value", key: "value", width: 60 }];
  about.getRow(1).font = { bold: true };
  about.addRow({ field: "Sheet", value: template.name });
  about.addRow({ field: "Source", value: meta.sourceLabel || template.source });
  about.addRow({ field: "Organization", value: meta.company || "" });
  about.addRow({ field: "Period", value: meta.periodLabel || "" });
  about.addRow({ field: "Generated on", value: meta.generatedOn || new Date().toLocaleString("en-GB") });
  about.addRow({ field: "Generated by", value: meta.generatedBy || "" });
  about.addRow({ field: "Rows", value: prepared.rowCount });
  for (const [k, v] of Object.entries(meta.filters || {})) about.addRow({ field: `Filter: ${k}`, value: String(v) });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function writeTotalsRow(sheet, rowIndex, columns, totals, showIndex, label, numeric, grand = false) {
  const row = sheet.getRow(rowIndex);
  let labelled = false;
  columns.forEach((column, i) => {
    const cell = row.getCell(i + 1 + (showIndex ? 1 : 0));
    if (column.key in totals) {
      cell.value = totals[column.key];
      applyFormat(cell, column, numeric);
    } else if (!labelled) {
      cell.value = label;
      labelled = true;
    }
    cell.font = { bold: true };
    cell.border = { top: { style: grand ? "double" : "thin", color: { argb: "FF9CA3AF" } } };
  });
  if (!labelled && showIndex) row.getCell(1).value = label;
}

function cellValue(value, format) {
  if (value === null || value === undefined) return null;
  if (format === "date") {
    if (value instanceof Date) return value;
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(`${s.slice(0, 10)}T00:00:00Z`);
    return s;
  }
  if (format === "boolean") return value ? "Yes" : "No";
  if (["money", "number", "integer", "percent"].includes(format)) {
    const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return value === "" ? null : String(value);
    return format === "percent" ? n / 100 : n;
  }
  const text = String(value);
  // Neutralise formula injection: a cell starting with = is executed by Excel.
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function applyFormat(cell, column, numeric) {
  if (NUM_FMT[column.format]) cell.numFmt = NUM_FMT[column.format];
  const align = column.align || (numeric.has(column.format) ? "right" : "left");
  cell.alignment = { horizontal: align, vertical: "middle" };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function toCsv(template, prepared, meta) {
  const columns = prepared.columns;
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [];
  lines.push(columns.map((c) => escape(c.label)).join(","));
  for (const group of prepared.groups) {
    if (group.label !== null) lines.push(escape(group.label));
    for (const row of group.rows) lines.push(columns.map((c) => escape(displayValue(row[c.key], c.format, meta))).join(","));
  }
  if (template.footer && template.footer.showTotals !== false && Object.keys(prepared.totals).length) {
    lines.push(columns.map((c, i) => (c.key in prepared.totals ? escape(displayValue(prepared.totals[c.key], c.format, meta)) : i === 0 ? "Total" : "")).join(","));
  }
  return `﻿${lines.join("\n")}`;
}

function displayValue(value, format, meta = {}) {
  if (value === null || value === undefined || value === "") return "";
  if (format === "boolean") return value ? "Yes" : "No";
  if (format === "date") {
    const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    return meta.formatDate ? meta.formatDate(s) : s;
  }
  if (["money", "number", "integer", "percent"].includes(format)) {
    const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return String(value);
    const locale = meta.locale || "en-IN";
    if (format === "money") return `${meta.currencySymbol || ""}${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
    if (format === "integer") return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
    if (format === "percent") return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n)}%`;
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  }
  return String(value);
}

// ── PDF ─────────────────────────────────────────────────────────────────────

async function toPdf(template, prepared, meta) {
  return new Promise((resolve, reject) => {
    try {
      const size = (template.page && template.page.size) || "A4";
      const doc = new PDFDocument({
        size,
        layout: (template.page && template.page.orientation) || "landscape",
        margins: { top: 40, bottom: 40, left: 30, right: 30 },
        bufferPages: true,
        info: { Title: template.name, Author: meta.company || "Chefotech HRMS", Creator: "Chefotech HRMS" },
      });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const columns = prepared.columns;
      const showIndex = template.showRowNumbers !== false;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const widths = [...(showIndex ? [{ width: 5 }] : []), ...columns].map((c) => c.width || 16);
      const totalWeight = widths.reduce((s, w) => s + w, 0);
      const colWidths = widths.map((w) => (w / totalWeight) * pageWidth);
      const fontSize = columns.length > 14 ? 6.5 : columns.length > 9 ? 7.5 : 8.5;

      const drawTitle = () => {
        doc.fillColor("#1F2937");
        if (template.header && template.header.showCompany && meta.company) doc.fontSize(13).font("Helvetica-Bold").text(meta.company, { align: "left" });
        if (template.header && template.header.title) doc.fontSize(11).font("Helvetica-Bold").text(template.header.title);
        const sub = [template.header && template.header.subtitle, template.header && template.header.showPeriod ? meta.periodLabel : null].filter(Boolean).join("  ·  ");
        if (sub) doc.fontSize(9).font("Helvetica").fillColor("#6B7280").text(sub);
        doc.moveDown(0.5);
      };

      const drawHeaderRow = () => {
        const y = doc.y;
        doc.rect(doc.page.margins.left, y - 2, pageWidth, fontSize + 10).fill("#EEF2FF");
        doc.fillColor("#1F2937").fontSize(fontSize).font("Helvetica-Bold");
        let x = doc.page.margins.left;
        const labels = [...(showIndex ? ["#"] : []), ...columns.map((c) => c.label)];
        labels.forEach((label, i) => {
          doc.text(label, x + 3, y + 3, { width: colWidths[i] - 6, align: "center", lineBreak: false, ellipsis: true });
          x += colWidths[i];
        });
        doc.y = y + fontSize + 10;
      };

      const ensureRoom = (needed) => {
        if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 10) {
          doc.addPage();
          drawHeaderRow();
        }
      };

      const drawRow = (cells, { bold = false, fill = null } = {}) => {
        const rowHeight = fontSize + 7;
        ensureRoom(rowHeight);
        const y = doc.y;
        if (fill) doc.rect(doc.page.margins.left, y - 1, pageWidth, rowHeight).fill(fill);
        doc.fillColor("#1F2937").fontSize(fontSize).font(bold ? "Helvetica-Bold" : "Helvetica");
        let x = doc.page.margins.left;
        cells.forEach((cell, i) => {
          doc.text(cell.text, x + 3, y + 2, { width: colWidths[i] - 6, align: cell.align, lineBreak: false, ellipsis: true });
          x += colWidths[i];
        });
        doc.y = y + rowHeight;
        doc.strokeColor("#E5E7EB").lineWidth(0.4).moveTo(doc.page.margins.left, doc.y - 1).lineTo(doc.page.margins.left + pageWidth, doc.y - 1).stroke();
      };

      const cellsFor = (row, index) => [
        ...(showIndex ? [{ text: index === null ? "" : String(index), align: "center" }] : []),
        ...columns.map((c) => ({ text: displayValue(row[c.key], c.format, meta), align: c.align || (prepared.numeric.has(c.format) ? "right" : "left") })),
      ];
      const totalsCells = (totals, label) => [
        ...(showIndex ? [{ text: "", align: "center" }] : []),
        ...columns.map((c, i) => ({
          text: c.key in totals ? displayValue(totals[c.key], c.format, meta) : i === 0 ? label : "",
          align: c.align || (prepared.numeric.has(c.format) ? "right" : "left"),
        })),
      ];

      drawTitle();
      drawHeaderRow();

      let n = 0;
      for (const group of prepared.groups) {
        if (group.label !== null) {
          ensureRoom(fontSize + 8);
          const y = doc.y;
          doc.rect(doc.page.margins.left, y - 1, pageWidth, fontSize + 7).fill("#F3F4F6");
          doc.fillColor("#1F2937").fontSize(fontSize).font("Helvetica-Bold").text(group.label, doc.page.margins.left + 3, y + 2);
          doc.y = y + fontSize + 7;
        }
        group.rows.forEach((row, i) => {
          n += 1;
          drawRow(cellsFor(row, n), { fill: i % 2 === 1 ? "#FAFAFA" : null });
        });
        if (group.label !== null && group.totals && Object.keys(group.totals).length) {
          drawRow(totalsCells(group.totals, `Subtotal — ${group.label}`), { bold: true, fill: "#F9FAFB" });
        }
      }
      if (!prepared.rowCount) {
        doc.fillColor("#6B7280").fontSize(fontSize + 1).font("Helvetica-Oblique").text("No rows matched.", doc.page.margins.left + 3, doc.y + 6);
        doc.y += 20;
      }
      if (template.footer && template.footer.showTotals !== false && Object.keys(prepared.totals).length) {
        drawRow(totalsCells(prepared.totals, "Total"), { bold: true, fill: "#EEF2FF" });
      }

      if (template.footer && template.footer.signatureLabels && template.footer.signatureLabels.length) {
        ensureRoom(60);
        doc.y += 30;
        const per = pageWidth / template.footer.signatureLabels.length;
        template.footer.signatureLabels.forEach((label, i) => {
          const x = doc.page.margins.left + i * per + 10;
          doc.strokeColor("#9CA3AF").lineWidth(0.6).moveTo(x, doc.y).lineTo(x + per - 40, doc.y).stroke();
          doc.fillColor("#6B7280").fontSize(8).font("Helvetica").text(label, x, doc.y + 3, { width: per - 40 });
        });
        doc.y += 24;
      }

      // Footer on every page.
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        const y = doc.page.height - doc.page.margins.bottom + 12;
        doc.fillColor("#9CA3AF").fontSize(7).font("Helvetica");
        const left = [template.footer && template.footer.text, template.header && template.header.showGeneratedOn ? `Generated ${meta.generatedOn || ""}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}` : null].filter(Boolean).join("  ·  ");
        if (left) doc.text(left, doc.page.margins.left, y, { width: pageWidth * 0.75, lineBreak: false, ellipsis: true });
        doc.text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.margins.left, y, { width: pageWidth, align: "right" });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { prepare, toXlsx, toCsv, toPdf, displayValue };
