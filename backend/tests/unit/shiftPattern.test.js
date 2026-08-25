"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluatePattern } = require("../../src/modules/shifts/shift.service");

/**
 * Shift patterns decide which shift a person is measured against on a given
 * day, which decides whether they were late, whether they worked a full day,
 * and ultimately what they are paid. An off-by-one in the cycle maths would
 * not raise an error anywhere — it would quietly measure a night worker
 * against a day shift and mark a month of correct attendance as absence.
 *
 * These run the resolver against a real calendar rather than through the
 * attendance engine, so a rostering mistake shows up here as a failing
 * assertion instead of on a payslip.
 */

const MORNING = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NIGHT = "bbbbbbbbbbbbbbbbbbbbbbbb";
const LATE = "cccccccccccccccccccccccc";

test("shift patterns", async (t) => {
  await t.test("a weekly pattern puts the right shift on each weekday", () => {
    const pattern = {
      type: "weekly",
      isActive: true,
      days: [
        { day: 1, shiftId: MORNING }, // Monday
        { day: 2, shiftId: MORNING }, // Tuesday
        { day: 3, shiftId: LATE }, // Wednesday — the late shift
        { day: 4, shiftId: MORNING },
        { day: 5, shiftId: MORNING },
        { day: 6, shiftId: null }, // Saturday off
        { day: 0, shiftId: null }, // Sunday off
      ],
    };

    // 2026-08-24 is a Monday.
    assert.equal(evaluatePattern(pattern, "2026-08-24").shiftId, MORNING, "Monday");
    assert.equal(evaluatePattern(pattern, "2026-08-26").shiftId, LATE, "Wednesday is the late shift");
    assert.equal(evaluatePattern(pattern, "2026-08-29").isOff, true, "Saturday is off");
    assert.equal(evaluatePattern(pattern, "2026-08-30").isOff, true, "Sunday is off");

    // And it must repeat the following week without any further configuration.
    assert.equal(evaluatePattern(pattern, "2026-09-02").shiftId, LATE, "the next Wednesday too");
  });

  await t.test("a weekday the pattern says nothing about falls through", () => {
    const pattern = { type: "weekly", isActive: true, days: [{ day: 3, shiftId: LATE }] };

    assert.equal(evaluatePattern(pattern, "2026-08-26").shiftId, LATE, "the covered day resolves");
    assert.equal(
      evaluatePattern(pattern, "2026-08-24"),
      null,
      "an uncovered weekday must return null so the employee's standing shift still applies"
    );
  });

  await t.test("a rotating cycle advances one position per day and wraps", () => {
    // Three mornings, three nights, one off — the classic 7-day rotation.
    const pattern = {
      type: "rotating",
      isActive: true,
      anchorDate: "2026-08-24",
      cycle: [
        { position: 0, shiftId: MORNING },
        { position: 1, shiftId: MORNING },
        { position: 2, shiftId: MORNING },
        { position: 3, shiftId: NIGHT },
        { position: 4, shiftId: NIGHT },
        { position: 5, shiftId: NIGHT },
        { position: 6, shiftId: null },
      ],
    };

    assert.equal(evaluatePattern(pattern, "2026-08-24").shiftId, MORNING, "the anchor date is position 0");
    assert.equal(evaluatePattern(pattern, "2026-08-26").shiftId, MORNING, "day 3 of the cycle");
    assert.equal(evaluatePattern(pattern, "2026-08-27").shiftId, NIGHT, "switches to nights on day 4");
    assert.equal(evaluatePattern(pattern, "2026-08-30").isOff, true, "day 7 is the rest day");
    assert.equal(evaluatePattern(pattern, "2026-08-31").shiftId, MORNING, "and the cycle restarts");
  });

  await t.test("a rotating cycle is independent of the weekday", () => {
    // The whole point of a rotation: an 8-day cycle must NOT line up with the
    // week, or it would just be a weekly pattern with extra steps.
    const pattern = {
      type: "rotating",
      isActive: true,
      anchorDate: "2026-08-24",
      cycle: [
        { position: 0, shiftId: MORNING },
        { position: 1, shiftId: MORNING },
        { position: 2, shiftId: MORNING },
        { position: 3, shiftId: MORNING },
        { position: 4, shiftId: NIGHT },
        { position: 5, shiftId: NIGHT },
        { position: 6, shiftId: NIGHT },
        { position: 7, shiftId: null },
      ],
    };

    // Both are Mondays, 7 days apart, against an 8-day cycle — so the second
    // one lands on position 7, not back at position 0. That drift is the
    // entire difference between a rotation and a weekly rota.
    const firstMonday = evaluatePattern(pattern, "2026-08-24");
    const secondMonday = evaluatePattern(pattern, "2026-08-31");
    assert.equal(firstMonday.shiftId, MORNING, "the anchor Monday is position 0");
    assert.equal(secondMonday.isOff, true, "the next Monday has drifted to position 7, the rest day");

    // A full cycle later it does come back around, which is what makes it a cycle.
    assert.equal(evaluatePattern(pattern, "2026-09-01").shiftId, MORNING, "position 0 again after 8 days");
  });

  await t.test("a date before the anchor still resolves to a real position", () => {
    // Attendance is often reprocessed for dates before a pattern was created.
    // A negative remainder would index off the end of the cycle and silently
    // return nothing, leaving those days unrostered.
    const pattern = {
      type: "rotating",
      isActive: true,
      anchorDate: "2026-08-24",
      cycle: [
        { position: 0, shiftId: MORNING },
        { position: 1, shiftId: NIGHT },
      ],
    };

    const dayBefore = evaluatePattern(pattern, "2026-08-23");
    assert.ok(dayBefore, "a date before the anchor must still resolve, not return null");
    assert.equal(dayBefore.shiftId, NIGHT, "one day before position 0 wraps to the last position");
  });

  await t.test("an inactive pattern is ignored entirely", () => {
    const pattern = {
      type: "weekly",
      isActive: false,
      days: [{ day: 1, shiftId: MORNING }],
    };
    assert.equal(
      evaluatePattern(pattern, "2026-08-24"),
      null,
      "deactivating a pattern must fall back to the standing shift, not strand people with no shift"
    );
  });

  await t.test("an incomplete rotating pattern does not throw", () => {
    // Half-configured patterns exist in the wild — someone saved before
    // finishing. Resolution must degrade to the standing shift rather than
    // failing an entire attendance run.
    assert.equal(evaluatePattern({ type: "rotating", isActive: true, cycle: [] }, "2026-08-24"), null);
    assert.equal(
      evaluatePattern({ type: "rotating", isActive: true, cycle: [{ position: 0, shiftId: MORNING }] }, "2026-08-24"),
      null,
      "no anchor date means the cycle has no starting point"
    );
    assert.equal(evaluatePattern(null, "2026-08-24"), null);
  });
});
