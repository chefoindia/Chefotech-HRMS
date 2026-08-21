"use strict";

const Papa = require("papaparse");
const ExcelJS = require("exceljs");
const { BiometricAdapter } = require("./BiometricAdapter");
const { AppError } = require("../../../core/errors/AppError");

/**
 * File-based import.
 *
 * The lowest common denominator, and the one that always works: an
 * administrator exports the day's log from the vendor's own desktop software
 * and uploads the CSV or XLSX. Every biometric product on the market can
 * produce one, which makes this the fallback that guarantees a customer is
 * never blocked while a network integration is being arranged.
 */
class FileImportAdapter extends BiometricAdapter {
  static get displayName() {
    return "File import (CSV / Excel)";
  }

  static get capabilities() {
    return {
      fetchPunches: false,
      fetchUsers: false,
      pushUser: false,
      removeUser: false,
      deviceInfo: false,
      realtime: false,
    };
  }

  static get connectionFields() {
    return [
      {
        key: "extra.columnMap",
        label: "Column mapping",
        type: "json",
        required: false,
        help: 'Default: {"userId":"UserID","timestamp":"DateTime","direction":"Status"}',
      },
    ];
  }

  async testConnection() {
    return { ok: true, message: "This device is set up for manual file uploads." };
  }

  async fetchPunches() {
    return [];
  }

  /** Parse an uploaded log file into standard events. */
  async parseFile(file) {
    const rows = await readRows(file);
    if (!rows.length) {
      throw new AppError("IMPORT_FAILED", { message: "That file contains no rows." });
    }

    const map = {
      userId: "UserID",
      timestamp: "DateTime",
      direction: "Status",
      ...((this.device.connection.extra && this.device.connection.extra.columnMap) || {}),
    };

    const headers = Object.keys(rows[0]);
    const resolve = (wanted) =>
      headers.find((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "") === String(wanted).toLowerCase().replace(/[^a-z0-9]/g, "")) ||
      wanted;

    const userIdColumn = resolve(map.userId);
    const timestampColumn = resolve(map.timestamp);
    const directionColumn = resolve(map.direction);

    const events = [];
    const skipped = [];

    rows.forEach((row, index) => {
      const deviceUserId = row[userIdColumn];
      const timestamp = row[timestampColumn];

      if (!deviceUserId || !timestamp) {
        skipped.push({ row: index + 2, reason: "Missing user id or timestamp" });
        return;
      }

      try {
        events.push({
          deviceUserId: String(deviceUserId).trim(),
          occurredAt: this.toInstant(normaliseTimestamp(timestamp)),
          rawTimestamp: String(timestamp),
          direction: normaliseDirection(row[directionColumn]) || this.device.defaultDirection,
          verifyMode: null,
          raw: row,
        });
      } catch (err) {
        skipped.push({ row: index + 2, reason: err.message });
      }
    });

    return { events, skipped, headers };
  }
}

async function readRows(file) {
  const name = String(file.originalname || "").toLowerCase();

  if (name.endsWith(".csv") || name.endsWith(".txt") || file.mimetype === "text/csv") {
    const parsed = Papa.parse(file.buffer.toString("utf8"), {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });
    return parsed.data;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError("IMPORT_FAILED", { message: "That workbook has no sheets." });

  const headers = [];
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cell.value || "").trim();
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col];
      if (!key) return;
      const value = cell.value instanceof Date ? cell.value : cell.text || cell.value;
      record[key] = value;
      if (value !== "" && value !== null && value !== undefined) hasValue = true;
    });
    if (hasValue) rows.push(record);
  });

  return rows;
}

/** Vendor exports use every date format ever invented. Normalise the common ones. */
function normaliseTimestamp(value) {
  if (value instanceof Date) return value;
  const text = String(value).trim();

  // DD-MM-YYYY HH:mm[:ss] and DD/MM/YYYY HH:mm[:ss]
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (dmy) {
    const [, d, m, y, hh, mm, ss] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")} ${hh.padStart(2, "0")}:${mm}:${ss || "00"}`;
  }

  return text;
}

function normaliseDirection(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).toLowerCase().trim();
  if (["in", "0", "c/in", "checkin", "check-in", "entry", "i"].includes(text)) return "in";
  if (["out", "1", "c/out", "checkout", "check-out", "exit", "o"].includes(text)) return "out";
  return null;
}

module.exports = { FileImportAdapter };
