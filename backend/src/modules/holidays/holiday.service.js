"use strict";

const { HolidayCalendar, Holiday, OptionalHolidaySelection } = require("./holiday.model");
const Location = require("../locations/location.model");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const organizationService = require("../organizations/organization.service");

/**
 * Holiday resolution.
 *
 * The attendance engine asks "is this date a holiday for this employee", and
 * the answer depends on the employee's calendar, which depends on their
 * location. That chain is resolved once per batch and cached.
 */

/** Which calendar applies to an employee. */
async function resolveCalendarId(employee, year, cache = null) {
  const direct = employee.employment && employee.employment.holidayCalendarId;
  if (direct) return String(direct);

  const locationId = employee.employment && employee.employment.locationId;
  if (locationId) {
    if (cache && cache.locationCalendars) {
      const fromLocation = cache.locationCalendars[String(locationId)];
      if (fromLocation) return String(fromLocation);
    } else {
      const location = await Location.findById(locationId).select("holidayCalendarId").lean();
      if (location && location.holidayCalendarId) return String(location.holidayCalendarId);
    }
  }

  if (cache && cache.defaultCalendarId !== undefined) return cache.defaultCalendarId;
  const fallback = await HolidayCalendar.findOne({ year, isDefault: true, isActive: true })
    .select("_id")
    .lean();
  return fallback ? String(fallback._id) : null;
}

/**
 * Preload the holiday map for a date range:
 *   { [calendarId]: { [date]: holiday } }
 */
async function buildHolidayCache({ fromDate, toDate }) {
  const years = [
    Number(fromDate.slice(0, 4)),
    Number(toDate.slice(0, 4)),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const [holidays, locations, defaults] = await Promise.all([
    Holiday.find({ date: { $gte: fromDate, $lte: toDate } }).lean(),
    Location.find({}).select("holidayCalendarId").lean(),
    HolidayCalendar.find({ year: { $in: years }, isDefault: true, isActive: true })
      .select("_id year")
      .lean(),
  ]);

  const byCalendar = {};
  for (const h of holidays) {
    const key = String(h.calendarId);
    byCalendar[key] = byCalendar[key] || {};
    byCalendar[key][h.date] = h;
  }

  return {
    byCalendar,
    locationCalendars: Object.fromEntries(
      locations.filter((l) => l.holidayCalendarId).map((l) => [String(l._id), String(l.holidayCalendarId)])
    ),
    defaultCalendarId: defaults.length ? String(defaults[0]._id) : null,
  };
}

/** The holiday on `dateString` for this employee, or null. */
async function holidayFor(employee, dateString, cache = null) {
  const year = Number(dateString.slice(0, 4));
  const calendarId = await resolveCalendarId(employee, year, cache);
  if (!calendarId) return null;

  if (cache && cache.byCalendar) {
    const holiday = (cache.byCalendar[calendarId] || {})[dateString] || null;
    // Optional holidays only apply to employees who selected them.
    if (holiday && holiday.isOptional) {
      const selected = cache.optionalSelections &&
        (cache.optionalSelections[String(employee._id)] || []).includes(String(holiday._id));
      return selected ? holiday : null;
    }
    return holiday;
  }

  const holiday = await Holiday.findOne({ calendarId, date: dateString }).lean();
  if (holiday && holiday.isOptional) {
    const selected = await OptionalHolidaySelection.findOne({
      employeeId: employee._id,
      holidayId: holiday._id,
    }).lean();
    return selected ? holiday : null;
  }
  return holiday;
}

async function listCalendars(query = {}) {
  const filter = {};
  if (query.year) filter.year = Number(query.year);
  if (query.isActive !== undefined) filter.isActive = query.isActive !== "false";
  return HolidayCalendar.find(filter).sort({ year: -1, name: 1 }).lean();
}

async function createCalendar(data, req) {
  const calendar = await HolidayCalendar.create({ ...data, createdBy: tenant.getUserId() });
  await organizationService.markStepCompleteIfPending("holidays");
  await audit.record(
    {
      action: "holidaycalendar.created",
      entityType: "HolidayCalendar",
      entityId: calendar._id,
      entityLabel: `${calendar.name} ${calendar.year}`,
      after: calendar.toObject(),
      severity: "notice",
    },
    req
  );
  return calendar;
}

async function updateCalendar(id, data, req) {
  const calendar = await HolidayCalendar.findById(id);
  if (!calendar) throw AppError.notFound("Holiday calendar");
  const before = calendar.toObject();
  Object.assign(calendar, data, { updatedBy: tenant.getUserId() });
  await calendar.save();
  await audit.record(
    {
      action: "holidaycalendar.updated",
      entityType: "HolidayCalendar",
      entityId: calendar._id,
      entityLabel: calendar.name,
      before,
      after: calendar.toObject(),
      skipIfUnchanged: true,
    },
    req
  );
  return calendar;
}

async function deleteCalendar(id, req) {
  const calendar = await HolidayCalendar.findById(id);
  if (!calendar) throw AppError.notFound("Holiday calendar");

  const Employee = require("../employees/employee.model");
  const inUse = await Employee.countDocuments({ "employment.holidayCalendarId": id });
  if (inUse) {
    throw AppError.conflict(`${inUse} employees use this calendar. Reassign them first.`);
  }

  await Holiday.deleteMany({ calendarId: id });
  await calendar.softDelete(tenant.getUserId());

  await audit.record(
    {
      action: "holidaycalendar.deleted",
      entityType: "HolidayCalendar",
      entityId: calendar._id,
      entityLabel: calendar.name,
      severity: "warning",
    },
    req
  );
  return { id: String(calendar._id), deleted: true };
}

async function listHolidays(query = {}) {
  const filter = {};
  if (query.calendarId) filter.calendarId = query.calendarId;
  if (query.year) {
    filter.date = { $gte: `${query.year}-01-01`, $lte: `${query.year}-12-31` };
  }
  if (query.fromDate || query.toDate) {
    filter.date = {};
    if (query.fromDate) filter.date.$gte = query.fromDate;
    if (query.toDate) filter.date.$lte = query.toDate;
  }
  return Holiday.find(filter).sort({ date: 1 }).lean();
}

async function addHoliday(data, req) {
  const calendar = await HolidayCalendar.findById(data.calendarId).lean();
  if (!calendar) throw AppError.badRequest("The selected holiday calendar does not exist.");

  if (Number(data.date.slice(0, 4)) !== calendar.year) {
    throw AppError.badRequest(
      `That date is not in ${calendar.year}, which is the year this calendar covers.`
    );
  }

  const holiday = await Holiday.create({ ...data, createdBy: tenant.getUserId() });
  await HolidayCalendar.updateOne({ _id: calendar._id }, { $inc: { holidayCount: 1 } });

  await audit.record(
    {
      action: "holiday.created",
      entityType: "Holiday",
      entityId: holiday._id,
      entityLabel: `${holiday.name} (${holiday.date})`,
      after: holiday.toObject(),
    },
    req
  );
  return holiday;
}

/** Bulk-add — pasting a year's holiday list is the normal way to set this up. */
async function addHolidaysBulk({ calendarId, holidays }, req) {
  const calendar = await HolidayCalendar.findById(calendarId).lean();
  if (!calendar) throw AppError.badRequest("The selected holiday calendar does not exist.");

  const existing = await Holiday.find({ calendarId }).select("date").lean();
  const taken = new Set(existing.map((h) => h.date));

  const toInsert = [];
  const skipped = [];
  for (const h of holidays) {
    if (taken.has(h.date)) {
      skipped.push({ date: h.date, name: h.name, reason: "A holiday already exists on this date" });
      continue;
    }
    if (Number(h.date.slice(0, 4)) !== calendar.year) {
      skipped.push({ date: h.date, name: h.name, reason: `Not in ${calendar.year}` });
      continue;
    }
    taken.add(h.date);
    toInsert.push({
      organizationId: tenant.requireOrganizationId(),
      calendarId,
      ...h,
      createdBy: tenant.getUserId(),
    });
  }

  if (toInsert.length) await Holiday.insertMany(toInsert);
  await HolidayCalendar.updateOne({ _id: calendarId }, { $inc: { holidayCount: toInsert.length } });

  await audit.record(
    {
      action: "holiday.bulk_created",
      entityType: "HolidayCalendar",
      entityId: calendarId,
      entityLabel: calendar.name,
      after: { added: toInsert.length, skipped: skipped.length },
      severity: "notice",
    },
    req
  );

  return { added: toInsert.length, skipped };
}

async function deleteHoliday(id, req) {
  const holiday = await Holiday.findById(id);
  if (!holiday) throw AppError.notFound("Holiday");
  const calendarId = holiday.calendarId;
  await holiday.softDelete(tenant.getUserId());
  await HolidayCalendar.updateOne({ _id: calendarId }, { $inc: { holidayCount: -1 } });
  await audit.record(
    {
      action: "holiday.deleted",
      entityType: "Holiday",
      entityId: holiday._id,
      entityLabel: `${holiday.name} (${holiday.date})`,
      severity: "notice",
    },
    req
  );
  return { id: String(holiday._id), deleted: true };
}

/** The holiday list an employee actually sees. */
async function forEmployee(employee, year) {
  const calendarId = await resolveCalendarId(employee, year);
  if (!calendarId) return { calendarId: null, holidays: [], optional: [], quota: 0, selected: [] };

  const [calendar, holidays, selections] = await Promise.all([
    HolidayCalendar.findById(calendarId).lean(),
    Holiday.find({
      calendarId,
      date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
    })
      .sort({ date: 1 })
      .lean(),
    OptionalHolidaySelection.find({ employeeId: employee._id, year }).lean(),
  ]);

  const selectedIds = new Set(selections.map((s) => String(s.holidayId)));

  return {
    calendarId,
    calendarName: calendar && calendar.name,
    quota: (calendar && calendar.optionalHolidayQuota) || 0,
    holidays: holidays.filter((h) => !h.isOptional),
    optional: holidays
      .filter((h) => h.isOptional)
      .map((h) => ({ ...h, selected: selectedIds.has(String(h._id)) })),
    selected: [...selectedIds],
  };
}

/** Employee picks their restricted holidays, bounded by the calendar's quota. */
async function selectOptional(employeeId, { year, holidayIds }, req) {
  const employee = await require("../employees/employee.model").findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const calendarId = await resolveCalendarId(employee, year);
  const calendar = await HolidayCalendar.findById(calendarId).lean();
  if (!calendar) throw AppError.badRequest("No holiday calendar is assigned for that year.");

  if (holidayIds.length > calendar.optionalHolidayQuota) {
    throw AppError.badRequest(
      `You can choose at most ${calendar.optionalHolidayQuota} optional holiday${calendar.optionalHolidayQuota === 1 ? "" : "s"}.`
    );
  }

  const holidays = await Holiday.find({
    _id: { $in: holidayIds },
    calendarId,
    isOptional: true,
  }).lean();
  if (holidays.length !== holidayIds.length) {
    throw AppError.badRequest("One or more of those holidays are not selectable.");
  }

  await OptionalHolidaySelection.deleteMany({ employeeId, year });
  if (holidays.length) {
    await OptionalHolidaySelection.insertMany(
      holidays.map((h) => ({
        organizationId: tenant.requireOrganizationId(),
        employeeId,
        holidayId: h._id,
        year,
        date: h.date,
      }))
    );
  }

  await audit.record(
    {
      action: "holiday.optional_selected",
      entityType: "Employee",
      entityId: employeeId,
      after: { year, holidays: holidays.map((h) => h.name) },
    },
    req
  );

  return { year, selected: holidays.map((h) => ({ id: String(h._id), name: h.name, date: h.date })) };
}

module.exports = {
  resolveCalendarId,
  buildHolidayCache,
  holidayFor,
  listCalendars,
  createCalendar,
  updateCalendar,
  deleteCalendar,
  listHolidays,
  addHoliday,
  addHolidaysBulk,
  deleteHoliday,
  forEmployee,
  selectOptional,
  HolidayCalendar,
  Holiday,
  OptionalHolidaySelection,
};
