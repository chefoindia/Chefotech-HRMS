"use strict";

/**
 * What every input in the product actually means.
 *
 * This is the half of the form registry no schema can supply. A Zod type says
 * `breakMinutes` is an integer between 0 and 480; it cannot say that making
 * it unpaid is what turns a nine-hour day into eight paid hours, which is the
 * only part the person choosing the number needs to know.
 *
 * Keyed by entity, then by the dotted path the form writes to — the same
 * string on both sides, so a renamed field surfaces as missing help rather
 * than help quietly attached to the wrong input.
 *
 * Two rules, enforced by formRegistry.test.js rather than left to goodwill:
 *
 *   `why` explains the downstream consequence, not the label. "The time the
 *   shift starts" is worthless next to a field called Start time. What earns
 *   the click is what the value goes on to decide.
 *
 *   `example` uses real values and shows a contrast. The recurring failure of
 *   these screens is that a number typed today only reveals itself in
 *   someone's pay three weeks later, so the example has to make that visible
 *   now — "set 15 and 09:12 is on time; set 5 and it is a late mark".
 */

const shift = {
  name: {
    why: "How this shift is identified everywhere it is chosen — on an employee's record, in the roster, and on every attendance report that groups by shift. Most organizations run several, so name it for the group or the hours it covers rather than for a rule inside it.",
    example: "'General 09:00-18:00' or 'Night shift' tells the next person who it is for. 'Shift 1' does not, and becomes actively misleading the day you reorder them.",
  },
  code: {
    why: "The short, stable identifier used in imports, biometric device mappings and payroll exports. Unlike the name, this is what external systems key off, so changing it later can orphan rows in files that already reference the old value.",
    example: "GEN for the general shift, NIGHT for the 22:00-06:00 one. Keep it under about six characters and uppercase — 'General Shift 2024' works as a name but is painful in a CSV column.",
  },
  description: {
    why: "A free-text note for whoever configures this next. It appears nowhere an employee can see and affects no calculation — its only job is recording the intent behind an unusual choice so the next administrator does not undo it.",
    example: "'Plant floor only — break is unpaid because the line stops' explains a setting that would otherwise look like a mistake beside the office shift's paid break.",
  },
  type: {
    why: "Decides how strictly arrival is judged. 'fixed' measures everyone against startTime. 'flexible' ignores exact arrival and only checks total hours worked, optionally inside a core window. 'rotational' means the shift is handed out by a pattern rather than held permanently.",
    example: "A developer on 'flexible' arriving 11:00 and leaving 20:00 is on time if they met the minimum hours. The same person on 'fixed' with a 09:00 start is two hours late every single day.",
  },
  startTime: {
    why: "The moment lateness is measured from. Every arrival rule in the attendance policy — grace, late mark, half day, absent — counts forward from this time, so moving it shifts all four thresholds together.",
    example: "Set 09:00 with a 15-minute grace and arriving 09:12 is on time. Move the shift to 08:30 and that same 09:12 arrival is now 27 minutes late, without anyone touching the policy.",
  },
  endTime: {
    why: "When the shift is due to finish. Early-leaving rules and overtime both measure from here. If this is earlier than the start time the shift is treated as overnight automatically — the platform records the whole night against the date the shift began.",
    example: "22:00 to 06:00 is an overnight shift: someone who works the night of the 3rd into the 4th produces one attendance record dated the 3rd, not two half records.",
  },
  breakMinutes: {
    why: "Time subtracted from the day before paid hours are worked out, unless the break is marked paid below. This is the difference between hours present and hours paid, so it flows straight into overtime and any component computed per hour.",
    example: "09:00-18:00 is nine hours present; a 60-minute unpaid break makes it eight paid. Set 30 instead and the same day pays 8.5 hours, which on a per-hour overtime rate is a real difference every shift.",
  },
  isBreakPaid: {
    why: "Whether the break above still counts as working time. Turning it on means the deduction is tracked for attendance but never removed from paid hours — common where staff cannot actually leave the floor during their break.",
    example: "A 60-minute break on a 09:00-18:00 shift: off, the day pays 8 hours; on, it pays the full 9. Across 26 working days that is 26 paid hours of difference for one checkbox.",
  },
  flexibleMinimumMinutes: {
    why: "For a flexible shift, the total working time someone must actually put in before the day counts as complete. Arrival time stops mattering; this number becomes the whole test of a full day.",
    example: "Set 480 and someone working 11:00 to 19:00 has met it exactly, while 11:00 to 18:30 is half an hour short and falls to whatever the policy does with an incomplete day.",
  },
  coreStartTime: {
    why: "The beginning of the window a flexible employee must be present for regardless of when they choose to start. It exists so that meetings and handovers have a time everyone is reliably reachable. Leave it empty to impose no core window at all.",
    example: "Core 11:00-16:00 lets someone work 08:00-17:00 or 11:00-20:00, but not 06:00-14:00 — that misses the last two core hours even though it is a full eight-hour day.",
  },
  coreEndTime: {
    why: "The end of that mandatory-presence window. Leaving before this is treated as leaving early even if the person has already met the minimum hours for the day, which is the point — the hours are met but the overlap with colleagues is not.",
    example: "With core hours ending 16:00, someone who started at 07:00 and leaves at 15:30 has done 8.5 hours yet still records an early departure, because the last half hour of core time is unattended.",
  },
  colour: {
    why: "The colour this shift is drawn in on the roster and attendance calendars. Purely visual, but on a rota showing several shifts at once it is the only thing making a mis-assignment obvious at a glance.",
    example: "Give the night shift a dark blue like #1E3A8A and the day shift a light amber. A stray night block in a week of amber is then visible instantly, where two similar greys would not be.",
  },
  isDefault: {
    why: "Marks the shift new employees are placed on when nobody chooses one explicitly — including people created by a spreadsheet import, which is where it matters most. Only one shift holds this at a time; setting it here clears it elsewhere.",
    example: "Import 300 employees with no shift column and every one lands on the default. If that is the 22:00-06:00 night shift, all 300 are measured against a night start from day one.",
  },
  isActive: {
    why: "Whether the shift can still be assigned. Turning it off hides it from every picker without deleting it, so historic attendance already measured against it stays intact and reportable.",
    example: "Retiring a seasonal 06:00-14:00 shift: switch this off and nobody new can be put on it, while last summer's attendance records still resolve against it correctly in reports.",
  },
};

const weekly_off = {
  name: {
    why: "How this week-off pattern is identified when assigning it to people. Organizations almost always need more than one — office staff on a five-day week and plant staff on six with alternate Saturdays — so name it after the group it governs.",
    example: "'Office — 5 day week' or 'Plant — alternate Saturdays' says who it is for. 'Pattern A' forces the next person to open it and read all seven rules to find out.",
  },
  code: {
    why: "The short stable identifier used in imports and exports. Like a shift code, external files reference it, so renaming later can break a spreadsheet that already carries the old value.",
    example: "OFF5 for a five-day week, PLANT6 for six days with alternate Saturdays. Short and uppercase keeps it usable as a CSV column value.",
  },
  description: {
    why: "A note recording why this pattern is shaped the way it is. It changes no calculation; it exists so an unusual rule is not quietly normalised away by whoever edits it next.",
    example: "'2nd and 4th Saturday off per the 2019 union agreement' stops a later administrator simplifying it to every Saturday off and creating 26 extra days of leave a year.",
  },
  days: {
    why: "One rule for each of the seven weekdays, from Sunday through Saturday. Every day must be present — a missing entry is not treated as a working day, it is rejected, because guessing at silence here would be guessing at somebody's weekend.",
    example: "A standard Indian six-day week: Sunday off, Monday to Friday working, and Saturday set to 'alternate' with occurrences 2 and 4 so only the 2nd and 4th Saturday of each month are off.",
  },
  "days.day": {
    why: "Which weekday this rule applies to, as a number: 0 is Sunday, 1 is Monday, through to 6 for Saturday. The numbering is fixed and does not follow the organization's week-start setting.",
    example: "6 is always Saturday, even in an organization whose reports start the week on Monday. Setting 0 there instead would make Sunday alternate and leave Saturday fully off.",
  },
  "days.type": {
    why: "What this weekday actually is. 'working' is an ordinary day, 'off' is a weekly off, 'half_day' expects only part of the shift, and 'alternate' means it is off on some occurrences of that weekday and working on the rest.",
    example: "Saturday set to 'off' gives 52 non-working Saturdays a year. Set to 'alternate' with occurrences 2 and 4 it gives roughly 24, and the other Saturdays are ordinary full working days.",
  },
  "days.offOccurrences": {
    why: "For an 'alternate' day, which occurrences of that weekday in the month are the off ones. Counted by position within the calendar month, so the 2nd Saturday is the second Saturday to fall in that month, not the Saturday of the second week.",
    example: "[2, 4] on Saturday gives the familiar 2nd-and-4th-Saturday-off pattern. A month with five Saturdays leaves the 1st, 3rd and 5th as working days.",
  },
  "days.halfDaySession": {
    why: "For a half day, which part of the shift is expected — 'first' means the morning is worked and the afternoon is off, 'second' is the reverse. It decides whether a midday departure is normal or an early exit.",
    example: "On a 09:00-18:00 Saturday set to first-half, leaving at 13:30 is a completed half day. Set it to 'second' and that same person is marked absent for the morning they were never expected to attend.",
  },
  isDefault: {
    why: "Marks the pattern applied to employees who are not explicitly given one, including everyone created by an import. Only one pattern holds it at a time, so setting it here clears it from whichever pattern had it before.",
    example: "Import 200 staff with no pattern column and all 200 inherit the default. If that is the six-day plant pattern, 200 office workers acquire a working Saturday nobody assigned them.",
  },
  isActive: {
    why: "Whether this pattern can still be assigned. Switching it off removes it from the pickers while leaving past attendance that was judged against it intact, so historic reports do not change retrospectively.",
    example: "Move the plant to a five-day week: deactivate the old six-day pattern and nobody new gets it, while last year's Saturday attendance still resolves correctly in an annual report.",
  },
};

const shift_pattern = {
  name: {
    why: "How this rotation is identified when putting people on it. A rotation is hard to recognise from its configuration alone, so the name is doing real work — it is usually the only description anyone reads before assigning it.",
    example: "'3 on, 3 off — plant' or 'Weekly: late Wednesdays' conveys the shape immediately. 'Pattern 2' means opening the editor and reading the whole cycle to find out what it does.",
  },
  code: {
    why: "The short stable identifier for imports and exports. It is set once when the pattern is created and then locked, because files and integrations that already reference it would otherwise silently point at nothing.",
    example: "ROT3 for a three-on-three-off rotation, WKLATE for a weekly pattern with late Wednesdays. Short, uppercase and unchanged once anything references it.",
  },
  description: {
    why: "A note explaining the intent behind the rotation. Rotations encode agreements — union terms, statutory rest requirements — that are invisible in the cycle itself, and this is where that reasoning survives a change of administrator.",
    example: "'Rest day after three nights is required under the 2021 plant agreement' stops someone shortening the cycle to squeeze in an extra working day.",
  },
  type: {
    why: "The single most consequential choice here. 'weekly' repeats every calendar week, so the same weekday always gets the same shift. 'rotating' repeats every N days regardless of weekday, so it deliberately drifts across the week — that drift is the entire difference between the two.",
    example: "An 8-day rotating cycle starting Monday puts the next Monday at position 7, not back at position 0. The same configuration as 'weekly' would put every Monday on the same shift forever.",
  },
  days: {
    why: "For a weekly pattern, which shift each weekday uses. A weekday left unset is not a day off — it falls through to whatever standing shift the employee already has, which is what makes a partial pattern safe to save.",
    example: "Set only Wednesday to the late shift and everyone keeps their normal shift the other six days, moving to late on Wednesdays only. Setting Wednesday to no shift instead would make it a rest day.",
  },
  cycle: {
    why: "For a rotating pattern, the ordered list of positions the rotation steps through, one per day, before returning to the start. The number of positions is the cycle length, so adding one entry changes every future date the pattern resolves.",
    example: "Three mornings, three nights, one rest day is a 7-day cycle. Add a second rest day and it becomes 8 days, which then drifts across weekdays instead of repeating every Sunday.",
  },
  "cycle.position": {
    why: "Where this entry sits in the rotation, counting from 0. Position 0 is the day that lands on the anchor date, and every other position is measured forward from there.",
    example: "With an anchor of 2026-08-24, position 0 is that Monday, position 3 is the Thursday, and in a 7-day cycle position 0 comes round again on 2026-08-31.",
  },
  "cycle.shiftId": {
    why: "Which shift this position of the rotation uses. Leave it empty to make the position a rest day — that is how a rotation expresses time off, rather than through a separate week-off pattern.",
    example: "In a three-on-three-off cycle, positions 0-2 carry the morning shift, 3-5 the night shift, and position 6 is left empty as the rest day between rotations.",
  },
  "days.day": {
    why: "Which weekday this entry covers in a weekly pattern, as a number from 0 for Sunday to 6 for Saturday. The numbering is fixed and does not follow the organization's week-start setting.",
    example: "3 is always Wednesday. In a pattern meant to put the late shift midweek, using 2 instead silently moves it to Tuesday and nothing reports an error.",
  },
  // Weekly entries and rotating entries are validated by the same schema, so
  // each list technically accepts the other's positioning field. Only one is
  // ever read. Saying so plainly here is worth more than hiding it, because
  // the ignored field is otherwise indistinguishable from a broken one.
  "days.position": {
    why: "Not used by a weekly pattern, which is positioned by weekday alone. It is accepted only because weekly and rotating entries share one shape, and a value set here is ignored when the pattern resolves.",
    example: "Setting position 4 on the Wednesday entry of a weekly pattern changes nothing — Wednesday still resolves from day 3. Switch the pattern to rotating and the weekday is ignored instead.",
  },
  "cycle.day": {
    why: "Not used by a rotating pattern, which is positioned by its offset from the anchor date rather than by weekday. It is accepted only because weekly and rotating entries share one shape, and any value here is ignored.",
    example: "Setting day 1 on cycle position 0 does not pin that position to Mondays — with a 7-day cycle it lands on whatever weekday the anchor date falls on, and drifts if the cycle is not 7 days.",
  },
  "days.shiftId": {
    why: "Which shift that weekday uses. Left empty the day becomes a rest day within the pattern; omit the weekday from the list entirely and it instead falls through to the employee's standing shift.",
    example: "Saturday with no shift set is a rest day for everyone on the pattern. Saturday simply absent from the list leaves each person on whatever shift their record already says.",
  },
  anchorDate: {
    why: "The real calendar date that sits at position 0 of a rotating cycle. It is what converts an abstract cycle into actual dates, and moving it by one day shifts every past and future assignment by one position.",
    example: "Anchor 2026-08-24 on a 7-day cycle puts position 0 on that Monday and again on 31 August. Change it to the 25th and the whole rotation slides a day, moving every rest day with it.",
  },
  colour: {
    why: "The colour the pattern is drawn in on roster views. Visual only, but on a roster showing several rotations at once it is what makes a person on the wrong pattern stand out.",
    example: "Give the night rotation a dark blue like #1E3A8A against an amber day rotation, and one mis-assigned employee is obvious in a wall of colour blocks.",
  },
  isActive: {
    why: "Whether the pattern still resolves. Switching it off does not strand the people on it — their standing shift applies again from that moment — while attendance already judged against the pattern stays as it was.",
    example: "Deactivate a rotation mid-month and tomorrow everyone on it is measured against their own shift instead, with the first two weeks of the month still recorded against the rotation.",
  },
};

module.exports = { shift, weekly_off, shift_pattern };
