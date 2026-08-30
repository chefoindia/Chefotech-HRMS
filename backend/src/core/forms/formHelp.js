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

const department = {
  name: {
    why: "The grouping every headcount, attendance and payroll report rolls up to, and the unit approval chains resolve against when a step routes to the department head. Rename it and last quarter's reports silently re-label, because they read the department rather than a stored copy of the name.",
    example: "'Cutting' sitting under 'Production' reads correctly in a rollup. Calling it 'Production - Cutting' instead double-counts the parent's name in every grouped report heading.",
  },
  code: {
    why: "The stable key that employee imports, biometric device mappings and payroll exports match on. It is what an outside file names when it says which department a row belongs to, so changing it later leaves those rows pointing at a department that no longer answers.",
    example: "PROD for production, PROD-CUT for the cutting sub-department. A spreadsheet column carrying 'Production Dept.' will not match either, and those employees import with no department at all.",
  },
  description: {
    why: "A note for the next administrator, visible nowhere an employee looks and used in no calculation. Its only job is to record why a department exists separately when the org chart alone makes it look redundant.",
    example: "'Kept separate from Production because it has its own cost centre in Tally' stops the next person merging two departments that finance reports on independently.",
  },
  costCentre: {
    why: "The finance code every salary paid to this department's employees is booked against in the payroll cost report and the accounting export. Wrong here and the money is real but lands in another team's budget line, which is usually only noticed at the month-end close.",
    example: "Set CC-1100 on Cutting and 40 salaries land on that line; leave it blank and the same 40 salaries fall into the unallocated bucket, where finance has to split them by hand.",
  },
  isActive: {
    why: "Whether the department can still be picked when adding or moving an employee. Turning it off hides it from the pickers without deleting it, so historic payroll and attendance still resolve the department name for people who were in it.",
    example: "Fold Embroidery into Production: deactivate it and nobody new can be placed there, while last year's payroll register still prints 'Embroidery' against the 12 people who were in it then.",
  },
};

const designation = {
  name: {
    why: "The job title that prints on offer letters, appointment letters, experience certificates and the ID card, straight from this field. Nothing in the product branches on the text, so it is documentation for humans — but it is documentation that leaves the building on signed paper.",
    example: "'Senior Machine Operator' reads correctly on an experience certificate years later. 'Sr. Op. II' is fine internally but becomes a title an employee has to explain at their next interview.",
  },
  code: {
    why: "The short identifier employee imports and HR exports carry instead of the full title. External files key off it, so a rename after the first import quietly breaks the match and those rows land with no designation.",
    example: "SR-OP for Senior Machine Operator, ASST-MGR for Assistant Manager. Under about ten uppercase characters keeps it usable as a CSV value that nobody has to quote.",
  },
  description: {
    why: "A free-text note recording what this title is actually for, changing no behaviour anywhere. It exists so two near-identical titles are not merged by whoever tidies the list next, when the distinction was deliberate.",
    example: "'Distinct from Operator only for the shop-floor allowance in the plant structure' explains a title that otherwise looks like a duplicate begging to be deleted.",
  },
  grade: {
    why: "The pay band this title sits in, which is what salary structures and increment rules are matched against when they apply to a group rather than to named people. Two titles sharing a grade are paid off the same structure even though they read differently on paper.",
    example: "Put Senior Operator and Line Inspector both on grade M3 and one structure covers both. Give the inspector M4 instead and they pick up M4's higher HRA percentage from the next payroll run.",
  },
  level: {
    why: "The seniority rank as a number, used to order the designation list and to resolve approval steps that ask for a manager a given number of levels up. A request climbing the chain counts these numbers, not the reporting tree alone, so a flat set of levels collapses the escalation path.",
    example: "Operator 3, Supervisor 5, Manager 8: a step asking for two levels up from an operator lands on the supervisor. Set every title to 1 and that same step finds nobody and the request stalls unapproved.",
  },
  isActive: {
    why: "Whether this title can still be assigned to anyone. Switching it off keeps it out of new employee records and promotions while leaving it resolvable for the people who already hold it and for documents already issued under it.",
    example: "Retire 'Trainee Operator' after the intake closes: nobody new can be given it, yet the 25 confirmed employees who held it last year still show it in their service history.",
  },
};

const location = {
  timezone: {
    why: "The zone every punch at this site is interpreted in, so it decides what counts as late and which calendar day a night shift's attendance lands on. It must be an IANA name, not an offset, because an offset cannot express daylight saving and would drift by an hour twice a year in regions that observe it.",
    example: "Asia/Kolkata reads a 09:05 punch as five minutes past a 09:00 start. Leave the site on America/New_York by mistake and the same punch arrives as 23:35 the previous day, filing a full day of attendance against the wrong date.",
  },
  name: {
    why: "How the site is identified on attendance reports, in holiday-calendar assignment and on any statutory register produced per workplace. Attendance is grouped by it, so a person at the wrong location appears in the wrong site's muster roll for as long as it stays wrong.",
    example: "'Bhiwandi Plant' or 'Andheri Head Office' tells a regional manager whose numbers they are reading. 'Unit 2' means opening the address to find out which state's holidays apply.",
  },
  code: {
    why: "The stable short key employee imports and biometric device registrations reference. Devices in particular are mapped to a location once and then left alone for years, so editing this later can leave punches arriving with no site to attach to.",
    example: "BHW for the Bhiwandi plant, HO for head office. An import column reading 'Bhiwandi Plant, Maharashtra' matches nothing, and every row in it lands without a location.",
  },
  type: {
    why: "What kind of workplace this is, which drives the defaults offered for geofencing and which sites are treated as fixed premises for statutory registers. 'remote' and 'client_site' in particular are the ones the product stops expecting a fixed punch point from.",
    example: "A 'factory' offers a geofence around the gate; setting the same site to 'remote' stops expecting anyone to punch inside a radius at all, so field staff are no longer flagged for being outside it.",
  },
  "address.line1": {
    why: "The first line of the address printed on offer letters, appointment letters and salary certificates generated for anyone posted here, and on the statutory registers kept per workplace. It is the version of the site that leaves the building on signed paper.",
    example: "'Plot 14, MIDC Industrial Area' on line one and the unit detail on line two prints cleanly. Cramming both into one line overflows the letterhead box in a generated offer letter.",
  },
  "address.line2": {
    why: "The continuation of the address — unit number, landmark, building name. It is optional, but whatever is here follows line one onto every generated document, so leaving it empty simply shortens the block rather than breaking it.",
    example: "'Near Kalyan Naka' helps a courier find a plant that a plot number alone will not. Repeating the city here instead makes it print twice, once on this line and again from the city field.",
  },
  "address.city": {
    why: "The city on printed documents and the field most reports and site filters group by when someone wants a regional view. It is also the first thing a payroll query is narrowed by when a state-specific rule such as professional tax is being checked.",
    example: "'Bhiwandi' groups this plant with the other Thane-district sites in a regional headcount. Typing 'Mumbai' because it is nearer the truth for post collapses two genuinely separate labour jurisdictions into one row.",
  },
  "address.state": {
    why: "The state that decides which statutory rules and which regional holiday calendar this site is reasonably assigned — professional tax, shops-and-establishment registration and gazetted holidays all differ across state lines in India.",
    example: "'Maharashtra' and 'Karnataka' plants need separate holiday calendars because their gazetted lists diverge. Leaving this blank leaves nothing to justify why one site got 11 holidays and the other 13.",
  },
  "address.country": {
    why: "The country on printed documents and the outer boundary used when addresses are formatted for export. For a single-country organization it rarely changes anything, which is exactly why an inconsistent value survives unnoticed across dozens of sites.",
    example: "Write 'India' on every site rather than mixing 'India', 'IND' and 'Bharat' — a grouped location export otherwise splits one country into three headings.",
  },
  "address.postalCode": {
    why: "The PIN code carried onto generated letters and any address export. Some statutory filings and courier integrations match on it rather than on the city text, so a wrong digit here fails silently in places the city field would not.",
    example: "421302 for Bhiwandi prints and files correctly; typing 42130 leaves five digits where six are expected and the address is rejected by anything validating an Indian PIN.",
  },
  "geo.latitude": {
    why: "The north-south half of the point a mobile punch is measured against when attendance at this site is geofenced. Every check-in compares its own coordinates to this one, so a value that is off by even a fraction of a degree marks genuinely present people as outside the boundary.",
    example: "19.2965 for the Bhiwandi plant. Enter 19.2 instead and the centre shifts roughly ten kilometres south, putting the entire workforce outside any sane radius from their first punch.",
  },
  "geo.longitude": {
    why: "The east-west half of the same point. It is stored and compared independently of latitude, so the classic failure is a correct pair entered the wrong way round — which produces a valid-looking point somewhere in the sea and rejects every punch.",
    example: "73.0629 pairs with a latitude of 19.2965. Swap the two and the site resolves near the Indian Ocean, so nobody at the gate is ever inside the fence.",
  },
  "geo.radiusMetres": {
    why: "How far from that point a punch may be and still count as on-site. It is the whole tolerance of the geofence, absorbing both GPS drift indoors and the real size of the premises, and it decides who gets marked absent while standing at their machine.",
    example: "Set 200 and someone at the far end of a large shed still punches in; set 50 and the same person, with normal indoor GPS drift, is rejected and has to raise an attendance correction.",
  },
  contactPerson: {
    why: "Who to reach at this site when something operational needs a human — a device that has stopped syncing, a register that needs signing. It drives no logic; it saves the next administrator working out who runs a plant they have never visited.",
    example: "'Ramesh Patil, Plant Admin' is actionable at 6pm when a punch device stops reporting. 'HR' is not, in an organization with nine sites and one shared HR inbox.",
  },
  contactPhone: {
    why: "The number dialled for that person, kept beside the site rather than in someone's phone so it survives a change of administrator. Nothing sends to it automatically, so its accuracy is only ever tested on the day it is urgently needed.",
    example: "Store it as +91 98200 12345 with the country code, so the same record works from a phone roaming outside India, where a bare 9820012345 will not connect.",
  },
  isActive: {
    why: "Whether the site can still be assigned to employees or devices. Deactivating hides it from pickers without deleting it, so attendance already stamped against it and letters already issued naming it stay intact and reportable.",
    example: "Close a warehouse and switch this off: no new employee can be posted there, while the 8 months of attendance recorded at that site still resolve correctly in an annual report.",
  },
};

const leave_type = {
  name: {
    why: "How this leave is identified on the apply screen, the balance card, the leave register and the payslip line if it is unpaid. Employees choose from these names under time pressure, so an ambiguous one produces requests filed against the wrong balance that HR then has to reverse.",
    example: "'Casual Leave' and 'Sick Leave' are picked correctly without thought. 'Leave Type 2' guarantees somebody burns earned leave on a one-day errand and asks for it back later.",
  },
  code: {
    why: "The short key the leave register, payroll export and any import file references instead of the name. Payroll in particular maps unpaid types to a deduction by this code, so renaming it after the first payroll run can quietly stop that deduction applying.",
    example: "CL, SL, EL and LOP are the codes Indian payroll teams already expect. Using 'CASUAL_LEAVE_2026' works in the app but breaks the column width every downstream statutory template assumes.",
  },
  description: {
    why: "The explanation shown to employees beside the type when they are choosing what to apply for. It is the cheapest place to prevent a wrong application, because it is read at the exact moment the decision is made.",
    example: "'For planned personal work — apply at least 2 days ahead' redirects someone who would otherwise file sick leave for a bank appointment and trigger a needless medical-certificate chase.",
  },
  colour: {
    why: "The colour this type is drawn in on the team calendar and leave dashboards. Visual only, but on a month view with several types overlapping it is the only thing that makes a cluster of sick leave in one team obvious before it becomes a staffing problem.",
    example: "Give sick leave a red like #DC2626 against a blue casual leave, and a week where half a shift is red stands out; two similar greys would just look like ordinary absence.",
  },
  isPaid: {
    why: "Whether days taken against this type are still paid. Unpaid types feed a loss-of-pay deduction into payroll for exactly the days approved, so this single switch is the difference between an approved absence costing the employee nothing and costing them a day's salary.",
    example: "Three days of casual leave with this on pays a full month; the same three days on an unpaid type cuts roughly 3/30ths of gross from that month's net, visible as an LOP line on the payslip.",
  },
  hasBalance: {
    why: "Whether this type draws down a tracked quota at all. With it off there is no balance to check, so requests are limited only by the policy's per-request rules — which is how a type meant to be occasional becomes unlimited without anyone choosing that.",
    example: "Sick leave with a balance stops at the 12 days allocated. Turn this off and the same type approves a 13th, 14th and 30th day with nothing to push back, because there is no counter to run out.",
  },
  isCompOff: {
    why: "Marks this as the type credited when someone works on a weekly off or a holiday, rather than one allocated by a policy. Balance arrives from approved compensatory-work entries instead of an allocation cycle, so the policy's allocation settings stop being the source of the days.",
    example: "An employee working Sunday 14 June earns one day here and can take it on 3 July. On an ordinary type that Sunday earns nothing, and the person simply worked a seventh day for free.",
  },
  isSpecial: {
    why: "Flags a type that sits outside the ordinary balance cycle — maternity, paternity, bereavement — so it is kept out of routine balance summaries and encashment maths that would otherwise treat it as accruable entitlement.",
    example: "Maternity leave of 182 days marked special stays off the annual balance card; left unmarked it inflates one employee's apparent entitlement and any average-balance report the whole team appears in.",
  },
  unit: {
    why: "Whether balance and requests for this type are counted in days or in hours. It decides the shape of every number attached to the type — the allocation, the balance shown, the deduction on approval — so changing it once requests exist makes existing figures mean something different.",
    example: "A 'day' type showing 12 means 12 days off; switch it to 'hour' and that same 12 is a day and a half on an eight-hour shift.",
  },
  allowHalfDay: {
    why: "Whether an employee can spend half a day of this balance instead of a whole one. Turning it off forces a full day for a two-hour absence, which is the usual reason balances run out faster than the allocation was meant to allow.",
    example: "With it on, a morning at the passport office costs 0.5 day and 11.5 remain. With it off the same morning costs a full day, so the year's 12 days cover 12 short errands rather than 24.",
  },
  allowHourly: {
    why: "Whether time can be taken in hours against a day-based balance, converted using the employee's shift length. It is what lets a short absence be recorded honestly rather than rounded up, and it makes attendance for that day partial instead of a clean leave day.",
    example: "Two hours off a nine-hour shift deducts about 0.22 day and still records six-plus hours present; without it the same absence is a half day and the attendance row reads as half worked.",
  },
  requiresAttachment: {
    why: "Whether a document must be attached before the request can be submitted at all. It moves the evidence to the moment of application, so an approver is never in the position of approving on trust and chasing a certificate that never arrives.",
    example: "Turn it on for sick leave and a medical certificate is uploaded before submit; leave it off and the approver either blocks a genuinely ill employee or approves 5 days with nothing on file for an audit.",
  },
  attachmentRequiredAfterDays: {
    why: "The length past which the attachment becomes compulsory, letting short absences through without paperwork while longer ones carry proof. It is the setting that keeps a certificate rule proportionate instead of demanding a doctor's note for a single afternoon.",
    example: "Set 3 and a 2-day sick leave submits with nothing attached while a 4-day one demands a certificate. Set 0 and even a half-day headache needs a signed document.",
  },
  "eligibility.genders": {
    why: "Restricts who can even see this type on the apply screen, based on the gender recorded on the employee record. Anyone outside the list never sees the option, so this is a filter on visibility rather than a rule an approver enforces later.",
    example: "Maternity leave limited to female employees keeps it off every other apply screen; left unrestricted it appears for all 400 staff and someone eventually files against it by mistake.",
  },
  "eligibility.employmentTypes": {
    why: "Which categories of employment can claim this type — permanent, contract, intern, consultant. It is how a benefit funded for the permanent roll stays off the apply screen for contractors whose terms never included it, without maintaining a separate policy per group.",
    example: "Earned leave limited to permanent staff keeps 60 contractors out of a 21-day entitlement they were never budgeted for, while casual leave stays open to everyone on site.",
  },
  "eligibility.departmentIds": {
    why: "Limits this type to named departments. Leave the list empty and every department qualifies — an empty list is not a restriction that blocks everyone, which is the reverse of how it reads and the most common misconfiguration on this screen.",
    example: "Pick only Production and a shop-floor heat allowance leave stays off the sales team's screen. Clear the list entirely and all 14 departments get it back, not none of them.",
  },
  "eligibility.locationIds": {
    why: "Restricts the type to particular sites, which is how a state-specific or plant-specific entitlement stays with the site that owes it. Like the department list, empty means every location rather than no location.",
    example: "Restrict a local festival leave to the Bhiwandi plant and head office never sees it; leaving the list empty grants it to all 9 sites including the ones in another state.",
  },
  "eligibility.minimumServiceMonths": {
    why: "How long someone must have been employed before this type becomes available to them. It is checked against the joining date at the moment of applying, so a new joiner's screen changes on its own the month they cross the line.",
    example: "Set 6 and someone who joined in March can first apply in September. Set 0 and they can apply for earned leave on day one, before a single day of it has accrued.",
  },
  "eligibility.availableDuringProbation": {
    why: "Whether someone still on probation can take this type. It is the switch that separates leave meant as an immediate safety net from leave meant as a reward for confirmed service, and it stops applying the day the employee is confirmed.",
    example: "Sick leave on during probation lets a new joiner take 2 days in their first month; earned leave off means they accrue quietly and can only spend it after confirmation.",
  },
  "eligibility.availableDuringNotice": {
    why: "Whether the type can be applied for once resignation is accepted and the notice period has begun. Turning it off is what stops a notice period being served on paper while being spent on leave, and it interacts directly with whatever the exit settlement encashes.",
    example: "Off, an employee serving 60 days notice must work them and carries the balance into their final settlement. On, they take 15 of those days as leave and the settlement pays out that much less.",
  },
  isActive: {
    why: "Whether the type can still be applied for. Deactivating removes it from the apply screen without deleting history, so past requests, balances and leave registers that reference it continue to resolve and report correctly.",
    example: "Retire a one-off pandemic leave: nobody can file a new request, while the 340 days already approved under it still appear in last year's leave register.",
  },
  order: {
    why: "Where this type sits in the list employees pick from, ascending. The first few entries take most of the traffic simply because they are read first, so ordering is a quiet way of steering people toward the type they usually actually mean.",
    example: "Give casual leave 1 and loss of pay 99 and the common choice is at the top. Leave every type at 0 and they fall into whatever order the database returns, which changes between screens.",
  },
};

const leave_policy = {
  name: {
    why: "Identifies the whole bundle of rules being attached to a group of employees, and it is the only thing most administrators read before assigning someone to it. Everything about how that person's leave accrues, counts and expires follows from this one pick.",
    example: "'Permanent staff — India' and 'Contract staff — 6 month' say who each is for. 'Policy 1' and 'Policy 2' guarantee somebody eventually puts a contractor on the permanent bundle.",
  },
  code: {
    why: "The stable identifier employee imports use to place a person on a policy without naming it in full. Because assignment is what decides an employee's entire entitlement, a mismatched code here silently leaves them on the default policy instead.",
    example: "PERM-IN for permanent staff in India, CONTR6 for six-month contracts. An import column reading 'Permanent staff - India' matches neither and those rows quietly inherit the default.",
  },
  description: {
    why: "A note recording the reasoning behind an unusual combination of rules — the agreement, statute or historical decision that shaped it. Policies outlive the people who write them, and this is the only place that context survives.",
    example: "'Earned leave capped at 30 days under the 2019 settlement — do not raise' stops a later administrator lifting the cap and creating an encashment liability nobody budgeted for.",
  },
  rules: {
    why: "The list of per-leave-type rules this policy carries — one entry for each type an employee on it can use. A type with no entry here is not merely unlimited or zero; it is unavailable to everyone on the policy, which is how a benefit disappears without anyone deleting it.",
    example: "A policy with entries for CL, SL and EL gives its people three types. Add LOP as a fourth entry and unpaid leave becomes applicable; omit it and there is no way to record an unpaid absence at all.",
  },
  "rules.allocation.mode": {
    why: "The single most consequential choice in the policy — it decides when days appear in someone's balance and therefore what they can take in January versus December. 'annual' drops the whole year at once, 'monthly' and 'quarterly' release it in slices, 'accrual' earns it per completed month, 'unlimited' never counts, and 'none' grants nothing at all.",
    example: "On 'annual' a January joiner can take all 12 days in February. On 'accrual' they have about 1 that month and reach 12 only in December, so the same request is refused for want of balance.",
  },
  "rules.allocation.daysPerPeriod": {
    why: "How many days are credited each time the allocation period turns over. Its meaning changes with the mode above — the same number is a whole year's entitlement under annual and twelve times that under monthly — so this pair must always be read together.",
    example: "12 under 'annual' is 12 days a year; 12 under 'monthly' is 144 days a year. Under 'quarterly' the intended 12 has to be entered as 3.",
  },
  "rules.allocation.accrualPerMonth": {
    why: "For accrual mode, the fraction of a day earned for each completed month of service, which is what a balance grows by month after month rather than arriving in one credit. It is the number that decides whether an employee can afford a week off in March or must wait until August.",
    example: "1.75 a month reaches 21 days across a full year, and someone six months in holds about 10.5. Set 1 instead and that same person has 6 and cannot take a ten-day break.",
  },
  "rules.allocation.creditTiming": {
    why: "Whether the period's days land at its start or only after it has been served. 'advance' lets someone spend a month they have not yet worked; 'arrears' means the balance always trails service, which is what protects the organization when someone resigns mid-cycle.",
    example: "On advance, a joiner has January's day on 1 January and can resign on the 20th having spent it. On arrears the same day appears on 1 February, so an unearned day is never taken.",
  },
  "rules.allocation.prorateOnJoining": {
    why: "Whether a mid-year joiner gets a share of the annual entitlement or the whole thing. It is the difference between a December joiner holding one day and holding a full year's worth in their first month, which then flows into anything encashed on exit.",
    example: "With 24 annual days and a 1 July join: on, they get 12; off, they get all 24 and could take three weeks before completing six months of service.",
  },
  "rules.allocation.prorateOnExit": {
    why: "Whether someone leaving part-way through the year keeps the full credit or only the portion earned up to their last working day. It decides the balance the final settlement is computed on, so it turns into money on the day someone exits.",
    example: "24 days credited in January and an exit on 30 June: on, the balance is trimmed to 12 and 12 are encashed; off, all 24 remain and the settlement pays double.",
  },
  "rules.allocation.rounding": {
    why: "How a fractional allocation is tidied before it lands in the balance. Proration and monthly accrual routinely produce awkward figures, and this decides whether the employee or the organization absorbs the fraction — every cycle, for everyone on the policy.",
    example: "10.4 accrued days become 10 under 'down', 11 under 'up', and 10.5 under 'nearest_half'. Across 300 employees that half day is 150 days of collective entitlement.",
  },
  "rules.allocation.maximumBalance": {
    why: "The ceiling a balance is not allowed to exceed, checked as new days are credited. Once it is reached, further allocation is simply not granted, which is the mechanism that stops an unused entitlement compounding into an unfunded encashment liability years later.",
    example: "Cap at 45 and an employee sitting at 45 gains nothing from April's credit. No cap at all and ten years of unused earned leave reaches 200 days, all of it payable on exit.",
  },
  "rules.carryForward.enabled": {
    why: "Whether an unused balance survives the end of the leave year or is wiped when the new year starts. Turning it off means every unspent day is lost on one date, which is what drives the December rush of applications every organization without it experiences.",
    example: "Ending the year with 8 unused days: on, the employee starts January with 8 plus the new credit; off, they start with the new credit alone and those 8 are gone.",
  },
  "rules.carryForward.maximumDays": {
    why: "How much of that leftover balance is allowed across the year boundary. Anything above it lapses at the turn, so this number is the actual limit on how large a balance can be built up over successive years, regardless of how generous the annual credit is.",
    example: "Carry 15 with 22 unused and 7 lapse on 31 March. Raise the limit to 30 and all 22 survive, and next year's balance opens at 22 plus the fresh allocation.",
  },
  "rules.carryForward.expiryMonths": {
    why: "How long carried-forward days survive into the new year before lapsing, as distinct from freshly allocated ones. It creates a use-it-or-lose-it window that keeps old balance moving instead of sitting on the books indefinitely.",
    example: "Set 6 on an April year start and carried days must be taken by September. Set 0 and they never expire, so a balance carried in 2021 is still payable at exit in 2028.",
  },
  "rules.encashment.enabled": {
    why: "Whether unused days of this type can be converted into money at all. It is what turns a leave balance into a payroll liability, so switching it on changes what the organization owes every employee on the policy, not just those who ask.",
    example: "45 days of earned leave with this off is time someone may take; with it on it is roughly a month and a half of salary owed to that one person on exit.",
  },
  "rules.encashment.maximumDays": {
    why: "The most days that may be converted to money in one encashment, which caps the payroll impact of a single request no matter how large the underlying balance is. The remainder stays as leave rather than being paid out.",
    example: "Cap at 15 and an employee sitting on 40 encashes 15 and keeps 25 as time. Leave it uncapped and the whole 40 turns into a single payroll line in one month.",
  },
  "rules.encashment.minimumBalanceToRetain": {
    why: "The floor that must be left behind after encashing, so nobody can convert their entire balance and then face the year with no leave available. It is a staffing protection as much as a financial one — an employee with zero days takes unpaid absence instead.",
    example: "Retain 10 and someone with 30 may encash 20. Set it to 0 and they can cash out all 30, then take loss of pay the first time a family emergency arrives.",
  },
  "rules.encashment.onExitOnly": {
    why: "Whether encashment is available at any time or only in the full-and-final settlement. Restricting it to exit keeps the balance functioning as leave during employment and confines the cash impact to a single, budgeted event.",
    example: "On, an employee with 40 days cannot cash any of it in March and takes time off instead; off, they encash 15 mid-year and the payroll for that month carries an extra half-month of salary.",
  },
  "rules.application.minimumDaysPerRequest": {
    why: "The smallest request that will be accepted for this type, which is how a leave meant to be taken in blocks is stopped from being spent one day at a time. It is checked at submission, so it shapes behaviour before an approver is ever involved.",
    example: "Set 3 on earned leave and a single-day request is refused at submit, pushing short absences to casual leave. Set 0.5 and half days are accepted against the same balance.",
  },
  "rules.application.maximumDaysPerRequest": {
    why: "The longest single stretch that can be applied for, forcing anything longer to be split into separate requests that each pass approval. It is a control on how much continuous absence one approval can authorise, independent of how much balance exists.",
    example: "Cap at 10 and a 21-day sabbatical must be filed as three requests, each reviewable. Leave it at 0 or unset and one click can approve a month away.",
  },
  "rules.application.maximumRequestsPerYear": {
    why: "How many separate applications of this type are allowed in a leave year, counted regardless of length. It targets frequency rather than volume, which is what stops a 12-day entitlement becoming twelve separate single-day disruptions to a shift.",
    example: "Set 6 and those 12 days must be taken in at most six goes, so the seventh Friday-off request is refused with balance still remaining. Set 0 and there is no frequency limit at all.",
  },
  "rules.application.noticeDays": {
    why: "How far ahead of the first leave date a request must be filed, measured from the day of submission. It is what makes planned leave actually plannable for a roster, and it is enforced at submit rather than left to an approver to police.",
    example: "Set 7 and a request filed on 10 August cannot start before the 17th. Set 0 and someone applies at 08:55 for a day beginning at 09:00, with the shift already short.",
  },
  "rules.application.allowBackdated": {
    why: "Whether leave can be applied for on dates already past. Without it, an unexplained absence can never be regularised as leave and stays as absent on the attendance record — which becomes a loss-of-pay deduction in that month's payroll.",
    example: "Off, someone hospitalised last Tuesday has no way to convert that absent day and loses a day's pay. On, they file it as sick leave on their return and the deduction never happens.",
  },
  "rules.application.backdatedLimitDays": {
    why: "How far into the past a backdated request may reach. It is the guard that lets a genuine absence be regularised soon after while stopping records from an already-closed payroll month being reopened and re-computed.",
    example: "Set 7 and a Tuesday absence can be regularised until the following Tuesday. Set 90 and someone can rewrite a day from three months back, after that payroll has been paid and filed.",
  },
  "rules.application.allowNegativeBalance": {
    why: "Whether an employee may take leave they have not yet earned, pushing the balance below zero to be recovered from future accrual. It is what keeps an emergency from becoming loss of pay for someone who joined recently, at the cost of a debt that follows them.",
    example: "A new joiner with 1 day accrued needing 4: off, three days are unpaid; on, the balance goes to -3 and clears itself over the next two months of accrual.",
  },
  "rules.application.maximumNegativeDays": {
    why: "How far below zero the balance is permitted to go, bounding the debt a departing employee could leave behind. Anything beyond it is refused, because a negative balance at exit has to be recovered from the final settlement or written off.",
    example: "Limit 5 and someone at -5 is refused a sixth day and takes it unpaid instead. Limit 30 and a resignation at -28 means most of a month's salary being clawed back from the settlement.",
  },
  "rules.application.maximumConcurrentInTeam": {
    why: "How many people from the same team may be on this leave on any one date, checked against already-approved requests when a new one is submitted. It protects shift coverage automatically rather than relying on a manager remembering who else is already out.",
    example: "Set 2 on a 10-person line and the third request for 15 August is refused at submit. Set 0 and all 10 can be approved for the day either side of a long weekend.",
  },
  "rules.counting.holidays": {
    why: "Whether a public holiday falling inside a leave request is deducted from the balance. 'exclude' never charges for it, 'include' always does, and 'sandwich' charges only when leave sits on both sides — the rule that stops a holiday being used to split one absence into two cheap halves.",
    example: "Leave on 14 and 16 August with the 15th a holiday: 'exclude' costs 2 days, 'include' costs 3, and 'sandwich' also costs 3 because leave brackets the holiday on both sides.",
  },
  "rules.counting.weeklyOffs": {
    why: "The same decision for weekly offs inside a request, and the one employees notice most because weekends fall inside almost every long leave. It is the difference between a fortnight away costing ten days of balance and costing fourteen.",
    example: "Friday to Monday with Saturday and Sunday off: 'exclude' costs 2 days, 'include' costs 4, and 'sandwich' costs 4 because leave lands on both sides of the weekend.",
  },
  "rules.approval.required": {
    why: "Whether a request of this type waits for a human decision or takes effect the moment it is submitted. Switching it off removes the only checkpoint between an employee's intent and the attendance record, for every request on this policy.",
    example: "On, a 5-day request sits pending until the manager acts and the roster can be adjusted. Off, it is approved instantly and the first anyone hears is an empty seat on Monday.",
  },
  "rules.approval.escalateAfterDays": {
    why: "How long a pending request may sit untouched before it is pushed to the next approver up. It exists because the common failure is not rejection but silence — a manager on leave themselves, and a request that quietly expires past its own start date.",
    example: "Set 2 and a request filed Monday reaches the department head on Wednesday if untouched. Set 0 and it waits indefinitely, still pending on the morning the leave was meant to begin.",
  },
  "rules.approval.autoApprove": {
    why: "Whether a request that reaches the end of its waiting period is approved on its own rather than left pending. It converts approver silence into a yes, which keeps employees from being stranded but does mean absence can be authorised by nobody in particular.",
    example: "With escalation at 3 days, on: an untouched request is granted on the fourth day and the roster must adapt. Off: it stays pending and the employee still does not know whether to come in.",
  },
  yearStartMonth: {
    why: "The month the leave year begins, which fixes when annual allocation is credited, when carry-forward is evaluated and when unused days lapse. Moving it re-dates every one of those events for everyone on the policy, including balances mid-flight.",
    example: "Set 4 for an April-to-March Indian financial year and balances reset on 1 April. Set 1 and the same policy resets on 1 January, three months out of step with payroll's own year.",
  },
  isDefault: {
    why: "Marks the policy applied to employees who are not explicitly given one, which includes everyone created by a spreadsheet import. Only one policy holds it at a time, so setting it here takes it away from whichever policy had it.",
    example: "Import 250 employees with no policy column and all 250 land on the default. If that is the permanent-staff policy, 60 contractors acquire 21 days of earned leave nobody granted them.",
  },
  isActive: {
    why: "Whether the policy can still be assigned. Deactivating keeps it out of the pickers while leaving the people currently on it governed by it, so this hides a policy from future use rather than migrating anyone off it.",
    example: "Replace last year's contract policy: switch this off and no new hire can be placed on it, while the 30 contractors already assigned keep accruing under it until they are moved individually.",
  },
};

const payroll_component = {
  name: {
    why: "The wording an employee reads on their payslip every month and quotes back when they query it, and the label their next employer matches against when verifying salary. Use the term staff already recognise rather than an internal abbreviation.",
    example: "'House Rent Allowance' answers itself. 'ALW-2' pays the identical ₹12,000 and earns a support ticket from every new joiner in their first month.",
  },
  code: {
    why: "The stable handle other components point at inside their calculations, and the column payroll exports and bulk uploads carry. Editing it does not rename the link — the referring component simply resolves to nothing and pays out zero.",
    example: "Code it BASIC and an allowance can be built as 40% of BASIC. Rename it to BASIC_PAY afterwards and that allowance quietly drops from ₹12,000 to ₹0 on the next run.",
  },
  description: {
    why: "An internal note that reaches nobody on the payroll and changes no figure. Its only job is recording why an unusual cap or an odd base was chosen, so the next administrator does not tidy it away and move everyone's net pay.",
    example: "'Held at the ₹15,000 wage ceiling by board decision' stops a successor lifting the limit and adding roughly ₹600 a month of employer cost for every person above it.",
  },
  type: {
    why: "Decides which direction the money moves and whether it touches take-home at all. Earnings add to gross, deductions subtract from it, employer contributions are company cost that never reduces net pay, reimbursements repay spending already made, and informational lines display a figure and move nothing.",
    example: "Provident Fund appears twice on the same salary: the employee's ₹1,800 as a deduction that cuts what is credited, and the company's ₹1,800 as an employer contribution that raises cost while the credit stays unchanged.",
  },
  category: {
    why: "Purely a reporting bucket — it alters no amount — but statutory returns and cost breakups group by it, so a misfiled line lands in the wrong total on a report somebody signs rather than on a payslip anybody checks.",
    example: "Tag PF and ESI as statutory and a quarterly compliance sheet totals ₹4,32,000 on its own; tag them 'other' and they sit beside the ₹1,600 conveyance allowance in a lump nobody can file from.",
  },
  "calculation.method": {
    why: "Selects which of the fields below is actually read, and silently ignores the rest. A value left behind from an earlier edit stays visible in the form while a different one drives the payslip, which is how a screen and a payment stop agreeing.",
    example: "Switch a line from percentage to fixed while both 40 and ₹1,600 sit stored: the run pays a flat ₹1,600, not the ₹12,000 the leftover forty-percent-of-Basic setting implies to whoever reads the record.",
  },
  "calculation.amount": {
    why: "The rupee figure paid identically to everyone carrying this line, frozen until somebody edits it by hand. Because it never moves with salary, an increment cycle leaves it exactly where it was and it shrinks as a proportion of pay without anyone deciding that.",
    example: "1,600 is 8% of a ₹20,000 salary and 0.8% of a ₹2,00,000 one — after two rounds of raises the line means nothing and still costs the same.",
  },
  "calculation.percentage": {
    why: "The share taken from whichever line is chosen as the base, recomputed every run, which is why it survives an increment where a typed amount goes stale. A stray extra digit multiplies straight through into gross with nothing to stop it.",
    example: "On a Basic of ₹30,000, 40 pays ₹12,000 and 50 pays ₹15,000. Fat-finger 400 and it pays ₹1,20,000, and no validation objects, because values over 100 are legitimate on some lines.",
  },
  "calculation.ofComponent": {
    why: "Names the base the share is taken from, and it must be a line already computed earlier in the sequence. Pointing at something that runs later does not raise an error — it reads zero, and the payslip prints a confident blank.",
    example: "Pointed at BASIC on a ₹30,000 Basic this pays ₹12,000; pointed at a gross figure that resolves after it, the very same line pays ₹0 to everyone that month.",
  },
  "calculation.expression": {
    why: "The only place a cap, a floor, a threshold or a balancing remainder can be expressed, because a flat share cannot bend. It runs against every employee on the structure at once, so something that parses but is subtly wrong is wrong for the whole payroll with no error to catch it.",
    example: "min(0.12 * BASIC, 1800) pays ₹1,440 on a ₹12,000 Basic and stops at ₹1,800 on a ₹25,000 one, where an unbounded twelve percent would have paid ₹3,000.",
  },
  "calculation.minAmount": {
    why: "A floor applied after the calculation finishes, which is how a proportional line is stopped from collapsing to a token sum for the lowest-paid people. It only ever raises pay, so it raises cost precisely on the employees whose totals nobody audits.",
    example: "Ten percent of an ₹8,000 Basic works out to ₹800; a floor of 1,500 lifts it, adding ₹8,400 a year for each person sitting under that threshold.",
  },
  "calculation.maxAmount": {
    why: "A ceiling applied after the calculation, usually to hold a statutory contribution at its legal wage limit instead of letting it track full salary. Everyone above the ceiling receives the identical figure, so moving it changes cost for senior staff only.",
    example: "Twelve percent capped at 1,800 pays the same ₹1,800 on a ₹40,000 Basic and a ₹90,000 one; lift the cap to 3,600 and only the higher earners' cost moves at all.",
  },
  "calculation.rounding": {
    why: "Decides how the computed paise are resolved before the line reaches the payslip and the bank file. It looks cosmetic, but the rounded figure is the one that totals into gross, so a whole workforce rounded one way drifts against the budget every month.",
    example: "A computed 1,443.60 stays as it is under none, becomes 1,444 at nearest_1 and 1,440 at nearest_10 — across 500 employees that spread is about ₹2,000 a month.",
  },
  prorateOnAttendance: {
    why: "Determines whether unpaid absence cuts this line down. On, the amount scales with the days actually payable; off, it pays in full even in a month somebody worked three weeks. This single choice is the whole difference between a loss-of-pay day costing something and costing nothing.",
    example: "Three unpaid days in a 30-day month against a ₹30,000 Basic: on, ₹27,000 is paid; off, the full amount lands and the absence shows up nowhere on the slip.",
  },
  includeInGross: {
    why: "Controls whether this line counts inside the gross figure that other components, statutory bases and the payslip total all read from. Excluding an earning does not stop it being paid — it removes it from the number every later calculation trusts.",
    example: "A ₹5,000 allowance left out of gross still reaches the bank, but a bonus defined as 8.33% of gross then computes on ₹45,000 rather than ₹50,000 and pays about ₹416 less.",
  },
  includeInCtc: {
    why: "Decides whether the line is counted into the annual cost-to-company figure printed in offer letters, quoted at appraisal and held up by candidates comparing offers. It changes what the company appears to spend, never what it actually credits.",
    example: "Employer PF of ₹1,800 a month counted in means a ₹6,00,000 package is presented as ₹6,21,600, with the amount reaching the employee identical either way.",
  },
  taxable: {
    why: "Marks whether this line feeds the income base that tax deducted at source is worked out from. A mistake here surfaces nowhere in the month it is made — it surfaces as a shortfall the employee has to settle when the year is reconciled.",
    example: "A ₹5,000 monthly allowance wrongly flagged non-taxable understates annual income by ₹60,000, leaving roughly ₹12,000 of tax to claw back in a single March payslip.",
  },
  order: {
    why: "The sequence lines are computed in, lowest first, and a component can read only values already produced above it. A dependency placed below its base does not fail loudly — it reads zero and pays out a plausible, wrong number to everyone.",
    example: "Basic at 10 with the allowance at 20 pays ₹12,000 on a ₹30,000 Basic. Move the allowance to 5 and every payslip that month shows ₹0 against it, with no warning raised anywhere.",
  },
  showOnPayslip: {
    why: "Controls only what the employee sees on the document they receive; the amount is calculated and paid either way. Hiding a line that genuinely moves take-home is what turns a correct payslip into one whose figures visibly refuse to add up.",
    example: "Hide an internal grossing-up factor and nobody misses it. Hide a ₹1,800 deduction and the slip shows ₹50,000 of earnings against ₹48,200 credited, with nothing on the page explaining the gap.",
  },
  isStatutory: {
    why: "Flags the line as required by law rather than by company policy, which keeps it out of the set an administrator may freely restructure and pulls it into compliance exports and challan workings.",
    example: "Provident Fund and Professional Tax carry the flag so their ₹1,800 and ₹200 reach the statutory return; a ₹2,000 performance incentive must not, or it inflates a filing the company signs.",
  },
  isActive: {
    why: "Whether the line can still be attached to structures and included in future runs. Switching it off leaves every payslip that already carried it intact, which deleting would not — reprinting last year's slip still needs the component to resolve.",
    example: "Retire a ₹1,200 city allowance in April and May onwards stops paying it, while March's payslip still reprints showing the ₹1,200 exactly as it was issued.",
  },
};

const salary_structure = {
  "components.override.ofComponent": {
    why: "Which component a percentage override is taken from, naming it rather than pointing at an id. It only has meaning when the override method is percentage; with a fixed amount or a formula it is ignored entirely.",
    example: "Override HRA to 50% of Basic and a Basic of 30,000 pays 15,000. Point the same 50% at Gross instead and it compounds against a figure that already contains HRA, which is how a structure quietly inflates every month.",
  },
  name: {
    why: "This is chosen by name every time somebody is hired or moved between grades, and that one selection fixes every earning and deduction on their payslip until it is changed again. Name it for the population it governs, not for one component inside it.",
    example: "'Factory workmen — 2026' or 'Managers — Bengaluru' lets a recruiter pick correctly at speed; 'Structure B' means opening it and reading twelve lines to find out who it is for.",
  },
  code: {
    why: "The short handle joining sheets, bulk salary uploads and integrations carry instead of the display name. A row referencing a code that no longer exists does not half-apply — the row is rejected or lands on nothing at all.",
    example: "STAFF26 in a joining sheet places 300 new hires correctly; rename it to STAFF2026 afterwards and re-uploading that same sheet fails on every single row.",
  },
  description: {
    why: "A note for whoever inherits this configuration. It affects no calculation and no employee ever sees it, but it is the only record of why a grade was given a structure of its own rather than an override on an existing one.",
    example: "'Split from the 2025 set because the settlement fixed the allowance at 50%, not 40%' explains why one grade shows ₹15,000 where the other shows ₹12,000, instead of it reading as a typo.",
  },
  components: {
    why: "The full set of lines that run for anyone on this structure, and the outer boundary of what their payslip can ever contain — a component that exists in the system but is absent from this list simply never pays for these employees.",
    example: "Leave Professional Tax out of a Karnataka set and 200 people go untaxed at ₹200 a month, appearing only as a ₹4,80,000 arrear when somebody notices a year later.",
  },
  "components.override.method": {
    why: "Replaces the component's own calculation style for this structure alone, which is how one grade gets different treatment without cloning the component and doubling the number of lines anyone has to maintain and keep in step.",
    example: "The allowance is proportional everywhere else; override it to fixed here and a director on ₹80,000 Basic receives a flat ₹25,000 rather than the ₹32,000 the forty-percent rule would have produced.",
  },
  "components.override.amount": {
    why: "The rupee figure this structure pays for that line, ignoring whatever the component itself defines. It is read only when the override method is fixed, so setting it alongside a proportional override changes nothing and warns nobody.",
    example: "A line paying 1,600 everywhere, set to 2,500 here, prints ₹2,500 for this grade only — about ₹10,800 a year more per head than the company-wide figure.",
  },
  "components.override.percentage": {
    why: "The share this structure applies in place of the component's own, taken against the same base the component names. It is the usual way one grade earns a richer allowance without a second component competing for the same payslip row.",
    example: "With Basic at ₹30,000, the component's 40 pays ₹12,000 while an override of 50 pays ₹15,000 — ₹36,000 a year more for every person on this structure.",
  },
  "components.override.expression": {
    why: "A calculation used instead of the component's own for these employees only, and the sole way to give one population a different cap or threshold. It is evaluated in the same pass, so it can still read anything already computed above it.",
    example: "min(0.12 * BASIC, 1800) on the staff set against min(0.12 * BASIC, 3600) on the senior one means a ₹50,000 Basic contributes ₹1,800 in the first and ₹3,600 in the second.",
  },
  "components.order": {
    why: "Repositions the line within this structure only, overriding the sequence the component carries by default. Since a line can read only what ran before it, moving one entry rewrites what every entry after it sees.",
    example: "A balancing allowance defined as gross minus the other earnings must sit last: at 90 it pays the intended ₹4,000 remainder, at 15 it computes against a near-empty gross and pays ₹0.",
  },
  isDefault: {
    why: "Marks the structure applied whenever nobody picks one, including every row of a bulk employee import — which is where it actually bites, because an import sheet rarely carries a structure column at all.",
    example: "Upload 300 joiners with no structure named and all 300 land on the default; if that is the ₹15,000-Basic workmen set, incoming managers are onboarded at workmen pay.",
  },
  isActive: {
    why: "Whether the structure can still be assigned going forward. Turning it off does not strip it from anyone already on it and does not disturb payslips already issued against it — it only removes it from the pickers.",
    example: "Deactivate the 2025 set in April and new hires can no longer be placed on it, while the 40 people still assigned carry on drawing their ₹28,000 Basic untouched.",
  },
};

const holiday_calendar = {
  name: {
    why: "Chosen by name whenever a site or an employee group is pointed at a calendar, and shown on the screens staff check before booking travel. One per region per year is normal, so the name has to separate them without anyone opening either.",
    example: "'Karnataka 2026' and 'Tamil Nadu 2026' pick themselves apart. Two calendars both called 'Holidays' guarantee somebody attaches Chennai staff to the Bengaluru list.",
  },
  code: {
    why: "The stable handle imports and integrations use to assign calendars in bulk, independent of the display name. Files already written against the old value stop resolving the moment it changes, and they fail quietly rather than loudly.",
    example: "KA2026 and TN2026 keep two states apart in a spreadsheet column; rename one mid-year and the next bulk assignment run attaches nobody at all.",
  },
  year: {
    why: "Scopes every date inside to one payroll year and decides which set attendance consults for a given day. Set it wrong and the holidays land in a year those dates do not belong to, so the real days are processed as ordinary working days.",
    example: "26 January sitting on a calendar marked 2025 does not make 26-01-2026 a holiday — that day runs as normal and staying home becomes loss of pay.",
  },
  description: {
    why: "An internal note, invisible to employees and irrelevant to every calculation. It exists so the reason a region was given a calendar of its own outlives the person who created it.",
    example: "'Excludes Ganesh Chaturthi — the plant runs that day under the shift agreement' stops a later administrator adding it back and losing a full day of production.",
  },
  locationIds: {
    why: "Restricts this calendar to specific sites, which is what makes regional holidays workable in a company spread across states. Left empty it applies everywhere, so an unrestricted regional list quietly hands a national workforce somebody else's festivals.",
    example: "Attach the Kerala list to the Kochi site alone and 400 Bengaluru staff work a normal day at an open office, instead of all 400 being paid for a closure nobody planned.",
  },
  optionalHolidayQuota: {
    why: "How many of the optional days any one employee may actually claim in the year. The pool can be long; this number is the part that costs anything, because each claimed day is a paid day nobody works.",
    example: "List eight optional festivals with a quota of 2 and each person takes two paid days off. Raise it to 4 and the identical list costs two more paid days per head.",
  },
  isDefault: {
    why: "The calendar used for anyone whose location does not match a more specific one, including new sites nobody has configured yet. It is the fallback, so it should be the most conservative list rather than the most generous.",
    example: "Open a Pune office mid-year with nothing attached and its staff inherit the default; if that is an eighteen-day regional list, they get closures the branch never budgeted.",
  },
  isActive: {
    why: "Whether the calendar is consulted at all. Switching it off does not rewrite attendance already processed against it, but from that moment its dates stop being holidays, so a day everybody stayed home becomes an unexplained absence.",
    example: "Deactivate a calendar in June and 15 August runs as an ordinary working day, turning a company-wide closure into loss of pay for anyone who did not apply for leave.",
  },
};

const holiday = {
  name: {
    why: "The wording that appears on the published holiday list, on the attendance calendar for that day, and in the notice employees plan travel around. It is the only explanation anyone gets for a day the workplace is shut.",
    example: "'Diwali (Deepavali)' is recognised across regions, where 'Festival Holiday 3' sends people to HR to ask which day they are actually being given.",
  },
  date: {
    why: "The exact day attendance is suspended for. Land it on the wrong day and the real festival is processed as ordinary work while a working day is paid as a closure, and neither error shows up until somebody is marked absent for it.",
    example: "Entering 2026-10-08 for a festival that falls on 2026-10-09 marks the whole workforce absent on the day nobody came in, and pays them for the day they did.",
  },
  type: {
    why: "Groups the day for reporting and for the rules that decide whether it can be swapped, compensated in lieu or drawn from a pool. It does not by itself decide who is off — the calendar's locations and the optional flag do that.",
    example: "Republic Day marked national reaches every site's list, while Ugadi marked regional belongs only to the calendars of the states that observe it.",
  },
  description: {
    why: "A free-text note carried alongside the date, useful for recording that a holiday was shifted, is being observed on a different day, or was granted in lieu of something else. Nothing that is calculated reads it.",
    example: "'Observed on Monday 2026-03-02 because the actual date fell on a Sunday' explains a closure that would otherwise look like an extra day slipped into the year.",
  },
  isHalfDay: {
    why: "Marks the holiday as covering only part of the day. Nothing currently reads it: the attendance and leave calendars take only whether a date is a holiday and what it is called, so a value here does not shorten anyone's working day.",
    example: "Setting first on a 09:00-18:00 site does not release the afternoon — the day is still measured in full. To close half a day for real, use a week off pattern's half day rule, which the resolver does read.",
  },
  isOptional: {
    why: "Moves the day out of the compulsory list and into the pool employees choose from, capped by the calendar's quota. The workplace stays open, so anyone who does not claim it works a normal day and is paid for it as one.",
    example: "Ten people claim a festival and the other 90 keep working. Make the identical day compulsory and all 100 are paid for a closed office, costing a full day of output.",
  },
  isPaid: {
    why: "Whether the closure is paid or merely a day the workplace is shut. Unpaid, it behaves as a non-working day that still reduces the month's payable days, which lands directly on the slip of anyone paid per day worked.",
    example: "Paid, a ₹26,000 monthly wage is untouched. Unpaid in a 26-day month, the same day removes ₹1,000 from every daily-rated worker's pay.",
  },
  colour: {
    why: "The colour the date is drawn in on calendars and rosters. It changes nothing that is calculated, but on a month showing leave, week-offs and closures together it is the only cue separating a holiday from a booked absence.",
    example: "Draw closures in a strong red like #DC2626 against amber leave blocks and a month carrying both is readable at a glance, without opening either entry.",
  },
};

const role = {
  name: {
    why: "The label shown wherever this is granted, reviewed or audited — and nothing in the product behaves differently because of it, since access comes entirely from the permission list. A name that overstates what is inside is how people end up holding more than anyone intended.",
    example: "Something called 'Read-only auditor' that carries payroll approval will still approve payroll, because whoever hands it out trusts the wording and never opens the list.",
  },
  key: {
    why: "A stable machine handle that imports, provisioning scripts and API callers use to refer to this without depending on the display name. Change it once anything references it and those callers grant nothing, without reporting a failure.",
    example: "PAYROLL_APPROVER survives the display name shifting from 'Payroll Approver' to 'Finance Approver'; edit the handle instead and the nightly provisioning job stops assigning anybody.",
  },
  description: {
    why: "The one place the intent behind a permission set is written down. Permission lists are long and unreadable at a glance, so this is what a reviewer actually reads during an access audit before deciding whether somebody should still hold it.",
    example: "'Approves payroll but cannot edit components — finance controller only' tells an auditor in a line what 40 separate permission strings would take an afternoon to reconstruct.",
  },
  permissions: {
    why: "The entire definition of what this can reach; everything the product gates is decided here and nowhere else. An entry added for one person's convenience is granted to every current holder and to everyone assigned it afterwards.",
    example: "Adding payroll approval so one manager can cover a fortnight's leave hands it to all 12 people holding the same role, including the 11 who never needed it and nobody reviews again.",
  },
  rank: {
    why: "A seniority number the platform orders roles by and uses to decide which may act on another in approval and administration chains — the wording of the name carries none of that weight. Lower numbers sit higher.",
    example: "A controller at 10 can act on what a supervisor at 40 raises; give both 40 and neither outranks the other, so those requests sit until somebody reassigns them by hand.",
  },
};

const user_invite = {
  email: {
    why: "Both the address the invitation is delivered to and the identity the account is permanently keyed on afterwards, so a typo does not merely fail to arrive — it creates an account nobody can ever sign into, which then has to be revoked and reissued.",
    example: "Sending to priya@company.co rather than priya@company.com leaves a pending invite that never converts, while the real Priya waits and eventually asks why she has no access.",
  },
  firstName: {
    why: "Carried into the invitation message and then into audit trails, approval queues and every screen listing who did what, until the person edits their own profile. Left blank, those trails read as a bare address for as long as the account exists.",
    example: "With 'Priya' filled in, an approval log entry reads as a person rather than as priya.sharma@company.com, which a reviewer three months later can actually match to somebody.",
  },
  lastName: {
    why: "Completes the display name that administrator lists sort and search by, which starts to matter the moment a tenant has more than a handful of people sharing a common first name.",
    example: "Three users shown only as Priya are indistinguishable in a picker; with Sharma, Nair and Reddy attached, whoever is granting payroll access picks the right one of the 3.",
  },
  roleIds: {
    why: "Fixes what the invitee can reach the instant they accept, before anybody reviews the account again. The invitation is usually the only moment access is deliberately chosen, so an over-broad grant here tends to survive the person's entire tenure.",
    example: "Invite a recruiter carrying the HR administrator role and they can open salary structures on day 1; invite them with a recruitment-only role and payroll never appears in their menu.",
  },
};

const document_template = {
  "blocks.columns.key": {
    why: "Which value from the document's data each column pulls. It is matched against the context the template is rendered with, so a key that does not exist there produces an empty column rather than an error — the table draws, just blank.",
    example: "A payslip earnings table uses keys like componentName and amount. Rename the key to component_name and the column still renders, silently empty, on every payslip generated from that day on.",
  },
  "blocks.columns.label": {
    why: "The heading printed above the column. Purely presentational — the data comes from the key beside it — but it is what the reader of a payslip or a salary certificate actually sees, and the only text in the table that is yours to word.",
    example: "Key amount with the label 'Amount (INR)' prints that heading over the figures. Leave the label empty and the column prints with a blank header, which reads on paper as a formatting fault rather than a deliberate choice.",
  },
  "blocks.columns.align": {
    why: "Which edge the column's contents sit against. Money and dates belong right-aligned so their digits line up down the page; text belongs left. A misaligned money column is the most common reason a generated payslip looks unprofessional.",
    example: "Set right on an amount column and 1,200 sits directly under 45,000, decimal under decimal. Leave it left and the two start at the same margin, so the eye cannot compare them at a glance.",
  },
  name: {
    why: "Chosen from the template picker, and written into the PDF's own Title metadata, so it is what a browser tab and a PDF reader's window bar show when the employee opens the file they were sent. It travels with the document long after it leaves the platform.",
    example: "'Offer letter — Sales, 2026' reads sensibly in a candidate's inbox. 'Template 3' becomes the window title on a document they forward to their family, which is not the impression intended.",
  },
  code: {
    why: "Forced to uppercase and held unique per organization, this is the handle the rest of the platform reaches for. It becomes the first segment of every generated file's name, and payroll finds the payslip template by looking up this exact string rather than by id.",
    example: "OFFER produces files named offer-EMP0142-2026-08-27.pdf. Rename the payslip template's code from PAYSLIP to SALARY_SLIP and the monthly run finds nothing and issues 0 payslips, silently.",
  },
  description: {
    why: "An internal note for whoever edits this template next. It is never interpolated, never printed and changes nothing about the rendered file — its only job is preserving the reasoning behind a choice that would otherwise look like a mistake.",
    example: "'Wide margins because this prints on the pre-printed stationery ordered in 2024' stops the next administrator tightening them to 20 and pushing body text across the printed border.",
  },
  category: {
    why: "More than a label. The context builder loads salary and CTC only for the pay-bearing categories, so a template filed under the wrong one either cannot see the figures it needs or gains reach over pay data it should never print. It also decides which folder the generated document lands in on the employee's record.",
    example: "Build a salary certificate under 'custom' and every {{salary.ctcAnnualFormatted}} placeholder renders as blank space. Set 'experience_certificate' and it files under Certificates rather than Salary.",
  },
  contextType: {
    why: "Declares which subject this template expects, and it is what the document screens filter on when offering a shortlist against an employee, a payslip or a leave request. The renderer works from whichever id the generate call actually carries, so a mismatch hides a usable template rather than breaking it.",
    example: "Leave a leave-approval letter set to 'employee' and it never appears in the list offered from a leave request, even though generating it against that request would have worked perfectly.",
  },
  "page.size": {
    why: "The physical sheet the file is cut to, which fixes the drawing width every block is laid out against. Change it and each table column, wrapped paragraph and page break recomputes, so a layout tuned on one size can gain or lose a whole page on another.",
    example: "A4 is the standard sheet in Indian offices; LETTER is wider and shorter, so a 12-row salary table that fits one A4 page can spill 2 rows onto a second sheet.",
  },
  "page.orientation": {
    why: "Swaps the sheet's width and height before anything is drawn, so it changes the usable line length rather than merely rotating the result. Tables gain room per column; body prose gains long lines that run the full width and are noticeably harder to read.",
    example: "A 9-column attendance report is unusable in portrait and comfortable in landscape. An offer letter turned landscape gives paragraphs of roughly 130 characters a line.",
  },
  "page.margins.top": {
    why: "The band of blank space above the first thing drawn on every page, the header included. It is the clearance that keeps generated text off pre-printed letterhead art, and it is subtracted from the height available for content, so raising it pushes the last rows of a long table onto another sheet.",
    example: "At 60 the company name starts well down the sheet, clear of a printed logo band. Drop it to 20 and that header rides up into the band and overprints it on every page.",
  },
  "page.margins.bottom": {
    why: "Reserves the strip the footer is drawn into, and sets the line at which a table breaks — a row is carried to the next page once it would fall within about forty units of this boundary. Too small and the footer rule collides with the last line of body text.",
    example: "At 60 the page-number line sits clear below the content. Cut it to 10 and 'Page 1 of 2' prints almost on top of the closing paragraph of every letter issued.",
  },
  "page.margins.left": {
    why: "The left edge every block starts from — headings, paragraphs, table cells, divider rules and the signature line all measure out from it. Together with its opposite number it sets the text width, so changing it rewraps the entire document rather than just shifting it across.",
    example: "50 gives a comfortable column on A4. Widen it to 120 without touching the other side and a two-column key-value grid loses nearly half its width, wrapping labels mid-word.",
  },
  "page.margins.right": {
    why: "The right-hand boundary, which exists purely as a limit — nothing is ever drawn from it. It caps the wrap width of every paragraph and the total width shared out between table columns, making it the quiet half of the pair that decides where lines break.",
    example: "With the left side at 50, matching it here gives a symmetric page. Set 140 instead to leave a comment margin and each of 5 table columns is squeezed, truncating amounts.",
  },
  "header.enabled": {
    why: "The master switch for the whole top-of-document band — logo, company name, address, free text and the coloured rule beneath them. With it off, none of the other header settings do anything at all whatever they hold, and the first block begins at the top margin.",
    example: "Turn it off for a letter printed on stationery that already carries the company details, and the body starts immediately. Turn it on and roughly 3 centimetres of page one goes to the header.",
  },
  "header.showLogo": {
    why: "Draws the organization's uploaded branding mark at the top left and pushes the company name and address across to sit beside it. If no logo is uploaded, or the file fails to decode, the document is still issued — the image is skipped and the text simply starts at the margin.",
    example: "Switched on, the company name begins about 125 units in to leave room for the mark. Switched off, that name starts hard against the left margin, which is what letterhead stock usually wants.",
  },
  "header.showCompanyName": {
    why: "Prints the organization's registered name across the top in the brand colour, which is what makes a generated letter recognisable as issued by the company at all. It is read live from the organization profile rather than stored in the template.",
    example: "Rename the company in organization settings and every future letter picks it up. Type the name into the header text field instead and a rebrand leaves 12 templates to correct by hand.",
  },
  "header.showAddress": {
    why: "Adds the registered address assembled from the organization profile — both address lines, city, state and postcode joined into one line beneath the name. On any letter used as proof of employment or of address, this is the part that makes the issuer verifiable.",
    example: "An experience certificate a bank will check needs it; an internal warning letter does not. Leaving it on adds 1 line of grey 8.5-point type under the company name.",
  },
  "header.text": {
    why: "A free line under the company details that is interpolated exactly like body text, so it can carry the document reference or an issuing department. It renders small and grey, which suits a reference line and not a sentence anyone is meant to read closely.",
    example: "'Ref: {{document.number}} · Issued {{date.todayFormatted}}' resolves per copy. A fixed 'Ref: OFR-0001' typed there stamps the identical reference onto all 300 letters.",
  },
  "header.useLetterhead": {
    why: "Records the intent that this template is printed onto pre-printed stationery, but nothing in the renderer reads it today — the file comes out byte-identical either way. The clearance letterhead actually needs has to be bought with the top margin instead.",
    example: "Ticking it neither shrinks the header nor reserves space. To clear printed stationery, switch the header off and raise the top margin to around 90, which genuinely moves the first line down.",
  },
  "footer.enabled": {
    why: "Gates the strip drawn along the bottom of every page — the thin rule, the footer line, page numbers and the generated-on stamp. It is applied page by page after the body is laid out, so switching it on never reflows content; it draws into space the bottom margin already reserved.",
    example: "Off, a 3-page appointment letter has nothing to distinguish sheet two from sheet three once they are separated. On, each carries its own numbering and whatever legal line is set.",
  },
  "footer.text": {
    why: "The line repeated at the foot of every page, interpolated like body text. Because it appears on each sheet rather than only the last, it is where a confidentiality note or a registration number belongs — the things that must survive one page being photocopied alone.",
    example: "'{{company.legalName}} · CIN {{company.registrationNumber}}' resolves per organization. It prints at about 7.5 point across 70 percent of the width, so more than 2 short clauses will wrap.",
  },
  "footer.showPageNumbers": {
    why: "Prints numbering in the 'Page 1 of 3' form, right-aligned, counted after the whole document has been laid out so the total is real rather than guessed. On anything a signatory certifies, this is the evidence that no sheet was quietly removed.",
    example: "A 4-page appointment letter with an annexure needs it. A single-page leave approval does not, and gains a faintly absurd 'Page 1 of 1' in the corner of an otherwise clean note.",
  },
  "footer.showGeneratedOn": {
    why: "Stamps the date the file was produced, in day/month/year form, on a second line under the page numbers. It is the render date and not any effective date on the letter, so a reissued copy carries today's stamp even when its content is unchanged.",
    example: "Reprint last year's experience certificate and it reads 27/08/2026, not the original issue date. When the date carries weight, put {{date.todayFormatted}} in the body and leave this off.",
  },
  "watermark.enabled": {
    why: "Lays a large diagonal word across the sheet behind the content. It is drawn once, before any block, so on a document running to more than one sheet only the first page is marked — the rest come out clean, which matters when a draft is circulated.",
    example: "A single-page draft offer is unmistakably marked. The same setting on a 3-page appointment letter marks page 1 and leaves pages 2 and 3 looking like a final, signed copy.",
  },
  "watermark.text": {
    why: "The word laid across the page, and the only thing separating an unapproved copy from the real one once both are on paper. It is set at seventy point on one rotated line, so anything beyond a word or two simply runs off the edges of the sheet.",
    example: "'DRAFT' or 'CONFIDENTIAL' spans the page legibly. 'Not for external circulation — draft copy only' at that size overruns both margins and reads as a smear of letters.",
  },
  "watermark.opacity": {
    why: "How heavily the watermark is inked, from barely perceptible to distinctly present. It is painted in the brand colour and sits behind the text, so pushing it high does not merely look heavy — it starts competing with the copy a reader has to get through.",
    example: "0.08 is a faint tint you notice on paper and read straight through. Raise it to 0.4 and a DRAFT band over dark type makes the middle 5 lines of a paragraph genuinely hard to read.",
  },
  blocks: {
    why: "The ordered body of the document. There is no page layout beyond this list: each entry is drawn immediately below the one before it, so the sequence here is literally the sequence on the paper, and moving one entry moves everything after it up or down the sheet.",
    example: "Heading, paragraph, key-value grid, signature is a conventional offer letter. Put the signature second and it prints above the 4 paragraphs it is supposed to be attesting to.",
  },
  "blocks.type": {
    why: "Chooses which drawing routine runs, and therefore which of this block's other settings are even looked at. A paragraph reads its text and ignores columns; a table reads columns and rows and ignores text — so a value filled in on the wrong type is not an error, it just never appears.",
    example: "Switch a block from 'paragraph' to 'table' and its 400 characters of wording vanish from the PDF while staying in the template, ready to reappear if the type is switched back.",
  },
  "blocks.text": {
    why: "The wording drawn for headings, paragraphs and the caption beneath a signature line, with {{dotted.path}} placeholders resolved against the employee, company, salary and date context assembled at generation time. A path that does not resolve is replaced by nothing at all rather than flagged.",
    example: "'Dear {{employee.name}}, your appointment takes effect {{employee.joiningDateFormatted}}' prints in full. Misspell it {{employee.joinDate}} and the sentence ships with a 0-character gap.",
  },
  "blocks.columns": {
    why: "Defines a table's columns — which key each one reads from the row data, the heading printed above it, and its share of the width. Leave the list empty and columns are inferred from the keys of the very first row, in whatever order that object happens to carry them.",
    example: "Declaring three columns keyed component, earnings and deductions guarantees that order on every payslip. Inferred columns can silently reorder the day the data gains a 4th key.",
  },
  "blocks.columns.width": {
    why: "A relative weight, not a measurement. Each column's value is divided by the total of all of them and multiplied by the usable page width, so the numbers only mean anything beside one another, and the table always fills the line exactly however they are chosen.",
    example: "Weights of 3 and 1 give the description three quarters of the row and the amount one quarter. Writing 300 and 100 produces an identical layout, because only the ratio is read.",
  },
  "blocks.rows": {
    why: "Literal row data written into the template itself, read only when no source path is set. It is the right choice for content identical on every copy — a fixed table of terms — and the wrong one for anything that ought to vary from one employee to the next.",
    example: "3 hard-coded salary rows print the same figures on all 200 payslips. Point the source at salary.components instead and each person's own numbers are read at generation time.",
  },
  "blocks.source": {
    why: "A dotted path into the generation context that supplies this block's rows at render time. An array is used as it stands; a plain object is turned into one row per property, which is how a key-value grid prints a whole section without anyone listing every field by hand.",
    example: "'salary.components' fills a payslip table from that employee's actual structure. A path resolving to nothing yields 0 rows, so the headings print above empty space instead of erroring.",
  },
  "blocks.items": {
    why: "The bullet points of a list block, each drawn on its own indented line and each interpolated in its own right. This is the block for enumerated terms — notice period, conditions of employment — where numbering sentences inside a paragraph would be far harder to amend later.",
    example: "Four separate entries each get a bullet and a hanging indent. The same four sentences typed into one paragraph run together as prose, and removing the second means editing around 2 commas.",
  },
  "blocks.condition": {
    why: "An expression evaluated against the flattened context that decides whether this block prints at all. It is how one template covers cases that genuinely differ — a bonus clause, a probation paragraph — instead of maintaining near-duplicate templates that drift apart over time.",
    example: "'salary.ctcAnnual > 1200000' prints a clause only on senior offers. An expression that fails to evaluate never stops the document: the block is quietly dropped and a warning logged.",
  },
  "blocks.style.fontSize": {
    why: "Overrides the size this block is set in, in points. It changes how much vertical space the block consumes as much as how it looks, so enlarging a paragraph near the foot of a sheet can push everything after it onto a page of its own.",
    example: "Left unset, headings print at 13 and body copy at 10. Set a paragraph to 14 and a letter that just fitted one page acquires a second carrying 3 orphan lines.",
  },
  "blocks.style.bold": {
    why: "Sets a paragraph in bold. Headings are drawn bold regardless of what this says, and list items and table cells ignore it entirely, so it is the tool for lifting one clause of body copy out rather than a general emphasis switch.",
    example: "Bolding the single sentence stating the notice period makes it findable in a 2-page letter. Bolding all 6 paragraphs makes none of them stand out and the letter harder to scan.",
  },
  "blocks.style.italic": {
    why: "Sets a paragraph in italic, and only while bold is off — the renderer picks one face and bold wins outright. Choosing both is not reported as a conflict; the italic simply never reaches the page and the setting sits there looking as though it worked.",
    example: "An italic 'This letter is issued at the employee's request' reads as an aside. Tick bold as well and it prints as plain bold text, the 2 settings silently collapsing into one.",
  },
  "blocks.style.align": {
    why: "How the block sits across the text column, and on an image block it is what positions the picture rather than any words. Justify stretches the word spacing to reach both margins, which suits dense contractual prose and looks plainly wrong on a short address.",
    example: "Centre a heading and right-align the date line above it. Justify a 3-line address and the gaps between words open into visible rivers running down the page.",
  },
  "blocks.style.colour": {
    why: "The ink this block is drawn in, as a hex value, overriding the near-black used otherwise. Generated letters are printed and photocopied at least as often as they are read on screen, so a light tint that looks refined on a monitor can disappear completely on paper.",
    example: "#1F2937 is the default near-black. A heading in a brand colour like #4F46E5 still reads well, while body copy at #9CA3AF survives the screen and vanishes on a grey-scale copy.",
  },
  "blocks.style.marginTop": {
    why: "Extra vertical space inserted before this block, counted on the same scale as font size — roughly one blank line for every twelve. It is how a template separates sections, because the renderer otherwise draws each block immediately after the last with no spacing of its own.",
    example: "24 opens about two clear lines above a section heading. 6 gives half a line, which reads as a slightly loose paragraph break rather than the start of something new.",
  },
  "blocks.style.marginBottom": {
    why: "Space added after this block, on the same scale of about twelve to a line. It stacks with the following block's top margin rather than collapsing into it, which is why generous values set on both sides of everything are what quietly turn a two-page letter into three.",
    example: "Put 12 here and 12 on the heading below and the gap between them is roughly 2 lines, not one. Leave both unset and that heading sits tight under the paragraph above it.",
  },
  "blocks.height": {
    why: "Means two different things depending on the block it sits on. For a spacer it is the blank gap inserted, on the twelve-to-a-line scale; for an image it caps the drawn height, with the width fitted to at most three times that figure so the picture keeps its proportions.",
    example: "A spacer of 48 opens about four blank lines above a signature. An image of 48 prints a small stamp, while 120 lets the same file spread across a band as wide as 360.",
  },
  "numbering.enabled": {
    why: "Turns on the sequential reference that makes an issued document auditable, and is what puts {{document.number}} into the context for the header, footer or body to print. With it off that placeholder resolves to nothing and copies become indistinguishable from one another.",
    example: "On, three experience certificates issued the same morning carry distinct references. Off, all 3 are identical apart from the name and none can be cited in an outward register.",
  },
  "numbering.prefix": {
    why: "The unchanging text placed in front of the sequence, and the only thing separating one template's references from another's — each template counts on its own, so two templates sharing a prefix will happily issue the very same reference to different people.",
    example: "'OFR-' yields OFR-0001 while the relieving template's 'REL-' yields REL-0001 the same day. Give both 'DOC-' and the two documents collide on DOC-0001 with nothing to flag it.",
  },
  "numbering.nextNumber": {
    why: "The value the next issued document will take, incremented the moment it is used. The preview button runs the identical generation path, so every preview consumes a reference and leaves a hole in the sequence, which is precisely the sort of hole an audit asks about.",
    example: "Preview an offer letter 5 times before sending and the letter that goes out is numbered 0006, with 0001 through 0005 unaccounted for. Reset it only against a written register.",
  },
  "numbering.padding": {
    why: "How many digits the sequence is zero-padded out to, which is what keeps references sorting correctly as text in a spreadsheet, a file listing or an exported register. Too few and the ordering collapses the moment the counter passes the width chosen here.",
    example: "Set digits to 4 and the first document is OFR-0001; set 6 and it is OFR-000001, which is what a payroll audit expects to sort correctly. At 2, OFR-10 sorts ahead of OFR-9.",
  },
  isActive: {
    why: "Whether the template can still be used. Switching it off withdraws it from the generation screens while leaving every document already issued from it intact, and the platform's own payslip lookup insists on an active template, so deactivating that one halts the monthly run.",
    example: "Retire an old offer format: deactivate it and nobody issues a new one, while the 84 letters already sent stay on file and still resolve to their template in the audit trail.",
  },
};

const workflow = {
  name: {
    why: "How this chain is recognised in the picker when it is attached to a request type, and the heading an employee reads on the approval trail of their own pending application while they wait on it.",
    example: "'Leave — 5 days or more' says what it catches. 'Workflow 2' means opening all four steps to find out whether this is the one that reaches the plant head.",
  },
  code: {
    why: "The stable identifier that imports, seeds and integrations quote when they attach this chain to something programmatically. Rename it once anything references it and those references resolve to nothing at all.",
    example: "LV5PLUS for the long-leave chain, EXPHIGH for high-value claims. Under about eight characters and uppercase keeps it usable in a config file or a CSV column.",
  },
  description: {
    why: "A note for whoever edits this next. It changes no routing decision whatsoever — its only job is recording the agreement behind an unusual chain so a later administrator does not flatten it back into one step.",
    example: "'Finance sign-off added after the March 2026 audit finding' stops someone deleting the second level because approvals felt slow last quarter.",
  },
  entityType: {
    why: "Which kind of request consults this chain at all. Matching is done inside one type only, so a chain built for expense claims is never even considered for a leave application however broadly it is scoped below.",
    example: "On 'leave_request' a 12-day earned-leave application runs these steps; a 40,000-rupee travel claim ignores them entirely and needs its own chain on 'expense_claim'.",
  },
  steps: {
    why: "The ordered chain a request walks, one level at a time, with the next level activating only once the previous one is answered. The length of this list is literally how many people must act before anything is granted.",
    example: "Two levels, manager then HR, means a Monday application is still pending on Tuesday even though the manager cleared it within the hour. One level and their approval finishes it.",
  },
  "steps.order": {
    why: "Where this level sits in the chain, and therefore what has already been settled before its approver ever sees the request. Renumbering changes who screens first, and so changes who can end a request before anyone senior reads it.",
    example: "Give HR order 1 and the manager order 2 and HR sees every application first, including the ones the manager would have declined in ten seconds at the requester's desk.",
  },
  "steps.name": {
    why: "The label carried into the approval notification and shown on the trail afterwards, so it is what tells the person receiving a request why it landed with them and not with somebody else.",
    example: "'Department head sign-off' explains the ask. 'Step 2' leaves an approver guessing whether they are checking eligibility or budget, so they approve assuming the other was done.",
  },
  "steps.approverType": {
    why: "How the platform works out who is actually asked here, resolved at the moment the level activates rather than when the chain is saved. reporting_manager, manager_level and department_head follow the requester; role, permission and specific_users are the same people for everyone.",
    example: "reporting_manager sends a fitter's leave to their line supervisor and an accountant's to the finance lead. specific_users naming one HR head funnels all 400 requests into that single inbox.",
  },
  "steps.managerLevel": {
    why: "How many hops up the reporting chain to climb before asking. It decides whether a request stops with the person who sees the work daily or travels to someone two desks removed from it, and if the chain is shorter than the number given, nobody resolves.",
    example: "1 is the requester's own manager and 2 is that manager's manager. On a flat plant team where the chain has only one entry, 2 finds no one and the level is skipped rather than held.",
  },
  "steps.roleIds": {
    why: "Which roles are asked here, expanded into every active member holding any of them at the moment the level activates. Granting one of these roles to a new joiner quietly makes them an approver without this chain being touched.",
    example: "List HR Manager alone and 3 people can act. Add Payroll Admin and a fourth can now clear leave — no step was added, but the number of hands able to sign off went from 3 to 4.",
  },
  "steps.permission": {
    why: "A single permission string, expanded into everyone who holds it however they came by it. Unlike naming roles this follows the permission itself, so a new custom role that happens to include it silently starts receiving approvals.",
    example: "'leave.approve' picks up any role carrying it. Grant that permission to a Shift Incharge role next month and shift incharges begin approving leave nobody re-routed to them.",
  },
  "steps.userIds": {
    why: "The exact individuals asked here. These are pinned people rather than positions, so when one of them leaves or is deactivated they simply stop resolving, and a level with nobody left resolving is skipped rather than held open.",
    example: "Pin the two founders and every request waits on those two names; a role-based level would have found their stand-ins the week both were travelling.",
  },
  "steps.mode": {
    why: "Whether every approver resolved here must agree or the first response settles it. This is what decides between one answer and five, and it is the usual reason a request sits untouched over a festival week.",
    example: "Three approvers on 'any' and whoever opens it first at 09:20 clears the level. On 'all' the same request waits for all three, so one person on leave holds it for a week.",
  },
  "steps.condition": {
    why: "An expression that decides whether this level runs for a given request. When it comes out false the level is marked skipped and the request moves straight on, which is how a short absence avoids a chain built for long ones. A condition that cannot be evaluated errs toward running the level rather than skipping it.",
    example: "'days > 5' on the director level means a 2-day casual leave never reaches them while an 8-day request does. Empty, the director sees both.",
  },
  "steps.autoApproveAfterDays": {
    why: "How long this level may sit unanswered before the platform records an approval nobody actually made and carries the request onward. It resolves in the requester's favour, and where escalation is also configured this is what happens instead.",
    example: "3 turns a claim raised Monday into an approved claim on Thursday with no one having opened it. 0 switches it off, and that claim waits for a human however long that takes.",
  },
  "steps.escalateAfterDays": {
    why: "How long the level may sit unanswered before the request is taken off this approver entirely and handed to the next level. The pending approver loses their say, and the person above inherits a decision they were not expecting to make.",
    example: "2 moves a request raised Monday to the department head on Wednesday. 0 leaves it in the manager's queue for the full three weeks they are away, still showing as pending.",
  },
  "steps.canReject": {
    why: "Whether this approver may end the request outright or only pass it along. Turned off, the level becomes a review point rather than a gate, so the only outcomes it can produce are approval and delay.",
    example: "An HR verification level with rejection off can query and forward but never decline; the plant head at the next level stays the only person who can actually say no.",
  },
  "steps.skipIfSelf": {
    why: "Whether the requester is struck out of the approver list when they resolve to their own approver. Left on, a level with nobody else in it is skipped altogether and the request advances without that level ever being answered by anyone.",
    example: "A department head applying under a department_head level: on, it is skipped and the request moves up; off, it lands in their own queue and one click approves it.",
  },
  "appliesTo.departmentIds": {
    why: "Restricts this chain to requesters in the listed departments. Left empty it is considered for everybody, and anyone excluded falls through to whichever other chain matches them, or to the default if none does.",
    example: "List Production alone and a cutting operator's leave runs these steps while a designer's looks elsewhere, landing on the default chain if nothing is scoped to design.",
  },
  "appliesTo.locationIds": {
    why: "Restricts the chain by the requester's work location, which is how one company runs tighter approvals at a plant than at head office without duplicating the leave rules themselves.",
    example: "Scoped to the Bhiwandi factory, an identical 6-day request from the Mumbai office never enters this chain — same leave type, same duration, different routing.",
  },
  "appliesTo.employmentTypes": {
    why: "Restricts the chain by employment type, so contract and probationary staff can be routed through more scrutiny than confirmed employees without maintaining a separate policy for each group.",
    example: "With 'contract' listed, a contractor's 4-day leave takes both levels here while a permanent colleague's identical application only needs their manager.",
  },
  isDefault: {
    why: "Marks the chain that catches a request when nothing else scoped to that request type matches the person raising it. It is the safety net, and without one a request can be raised that nothing knows how to route.",
    example: "With this set on the company-wide chain, a department created next week still routes its leave somewhere on day one rather than stranding every application in it.",
  },
  isActive: {
    why: "Whether new requests may enter this chain. Switching it off stops fresh matching immediately while instances already partway through keep the levels they were given, so nothing in flight is orphaned mid-approval.",
    example: "Retire the old three-level chain on the 15th and requests raised on the 16th use its replacement, while the 6 still pending from the 12th finish through the old levels.",
  },
  priority: {
    why: "Breaks the tie when several chains match the same request. Candidates are tried in ascending order and the first match wins outright — the others never run, so a broadly scoped chain with a low number can shadow a carefully targeted one.",
    example: "Production-scoped at 10 against company-wide at the default 100: the operator gets the Production chain, everyone else falls to the wider one, and neither is ever appended to the other.",
  },
};

const biometric_device = {
  name: {
    why: "How this unit is identified in the punch log, in sync failure alerts and on every attendance record traced back to where it came from, so it should say where the hardware physically stands.",
    example: "'Gate 1 — main entrance' locates it the moment a punch at 08:47 looks wrong. 'ZK-3' means walking the site to work out which door it guards.",
  },
  code: {
    why: "The stable short identifier that punch files and integrations quote when attributing a record to this unit. Change it once logs exist and older imports no longer match anything on record.",
    example: "GATE1 or PLANT_OUT stays readable in a raw punch CSV. Renaming GATE1 to MAINGATE next quarter leaves last month's imported rows pointing at a device that no longer exists.",
  },
  provider: {
    why: "Which make of hardware this is, and therefore which driver talks to it and how its raw payload is decoded. Choose wrong and the connection can still open cleanly while every timestamp or user id is read out of the wrong field.",
    example: "eSSL and ZKTeco units both answer on the same port, so a wrong pick here connects happily and then files punches against enrolment ids that belong to nobody.",
  },
  mode: {
    why: "How punches actually reach the platform — the server dialling the device, the device calling in, or a log file being uploaded by hand. Where the unit sits behind a firewall the server cannot cross, this stops being a preference.",
    example: "A unit on a private plant LAN set to 'lan' polling never returns a record because nothing outside can reach it; on 'webhook' the same device pushes its 06:00 punches in seconds.",
  },
  "connection.host": {
    why: "Where the server dials to collect punches. Attendance for everyone using this unit stops the instant this points at an address the hardware no longer holds, and a DHCP lease renewal is the usual reason it moves without anyone touching this screen.",
    example: "192.168.1.201 works until the router hands the unit .208 instead — the device keeps recording every punch and not one of them arrives here.",
  },
  "connection.port": {
    why: "The port the polling connection opens on that host. A wrong number fails exactly the way a closed firewall does, as a silent timeout, so it is worth reading off the device's own network page rather than assumed.",
    example: "4370 is the usual TCP port on ZKTeco and eSSL hardware; 80 and 443 belong to its web console and answer politely without ever returning a punch.",
  },
  "connection.baseUrl": {
    why: "The root address of a cloud provider's API, used instead of a host and port. Every pull is built by appending onto it, so a path pasted in with it turns a working integration into a run of not-found responses.",
    example: "https://api.vendor.com/v2 with the driver appending its own paths. Paste the full https://api.vendor.com/v2/punches/list here and the pull asks for /v2/punches/list/punches.",
  },
  "connection.username": {
    why: "The account the server authenticates as when it pulls. This is the device's own admin user rather than a platform login, so resetting the unit to factory defaults quietly invalidates it and collection stops with nothing on this screen changing.",
    example: "Use a dedicated 'hrsync' account rather than the shared 'admin' one, so rotating the admin password across all 12 gates breaks console access and not attendance.",
  },
  "connection.password": {
    why: "The secret paired with that username, stored so the scheduled pull can run unattended rather than typed each time. A password rotated on the hardware itself ends every subsequent collection until someone re-enters it here.",
    example: "Rotate it on the device on Friday and Monday's report shows nothing at that gate since Friday evening — the unit recorded all weekend, none of it was fetched.",
  },
  "connection.apiKey": {
    why: "The token used in place of a username and password by cloud providers. It carries its own scope and expiry on the vendor's side, so a key that worked at setup can stop working months later with nothing here having changed.",
    example: "Paste the vendor key whole, prefix included. Trimming what looks like 4 characters of padding off the end is the usual reason a first sync returns 401 while the key looks right.",
  },
  "connection.serialNumber": {
    why: "The unit's own serial, which is how a pushing device identifies itself when its call arrives. Without a match the platform cannot tell which device sent a punch, and the payload is discarded rather than guessed at.",
    example: "Read it from the device menu or its rear label, e.g. CJXK2024001234. One transposed character and every push from that unit is dropped while the device itself reports success.",
  },
  "connection.deviceNumber": {
    why: "The machine number the hardware stamps onto each record, which is what separates one unit's punches from another's where several share a line or export into a single log file.",
    example: "Two units writing into one file as 1 and 2 stay distinguishable; set both to 1 and the main gate's arrivals and the canteen's become one indistinguishable stream.",
  },
  "connection.useSsl": {
    why: "Whether the pull is made over an encrypted connection. Beyond privacy it has to match what the hardware actually serves, because a mismatch is refused during the handshake before any credential is ever offered.",
    example: "Switched on against a unit serving plain HTTP on port 80, the sync fails instantly with a handshake error that reads like a wrong password — though no password was sent.",
  },
  "connection.timeoutMs": {
    why: "How long the server waits for an answer before abandoning that run and marking the device unreachable. Too short and a slow but healthy unit fails every cycle; too long and one dead unit holds up everything queued behind it.",
    example: "10000 is generous on a LAN. Drop it to 2000 on a congested plant network and a device that replies in 3 seconds is reported down at every single scheduled run.",
  },
  "connection.extra": {
    why: "Provider-specific settings that do not fit the common fields, handed to the driver untouched. Nothing here is validated, so a misspelt key is not an error — it is ignored, and the driver quietly keeps its own default.",
    example: "A commKey of 123456 on a unit with a comm password set. Spell it 'commkey' instead and the value saves, is never read, and the device refuses the connection.",
  },
  timezone: {
    why: "The zone this hardware stamps its punches in, used to convert them before they are matched against a shift. Set it wrong and every arrival is judged against the wrong clock, converting on-time punches into late marks in bulk.",
    example: "Asia/Kolkata on an Indian gate. Left as UTC, a 09:00 arrival lands as 14:30 and an entire shift reads as 5 hours 30 minutes late, every day, until it is corrected.",
  },
  defaultDirection: {
    why: "What a punch means when the hardware itself does not say. Single-door units routinely report no direction at all, and this is what decides whether such a record closes somebody's working day or opens a new one.",
    example: "An exit-only turnstile on 'out' closes the day with an 18:05 punch. Left on 'in', that same punch reopens attendance and the day is reported with no exit at all.",
  },
  "sync.enabled": {
    why: "Whether the scheduled pull runs for this unit at all. Off, the hardware carries on storing punches locally and none of them reach attendance, which on a report looks identical to an entire shift failing to punch.",
    example: "Turned off for maintenance on the 3rd and forgotten, the gate banks 400 punches over four days while the shift shows as absent until someone turns it back on.",
  },
  "sync.intervalMinutes": {
    why: "How often the server polls this unit, and therefore the worst-case delay between someone punching and that punch being visible. Live headcount screens and same-day regularization are both read against this gap.",
    example: "15 means an 09:02 arrival may not surface until 09:17. Set 240 and a supervisor checking the floor at 10:00 sees a morning of arrivals that have not been fetched yet.",
  },
  isActive: {
    why: "Whether this unit is still part of the estate. Switching it off stops polling and stops accepting anything it pushes, while the punches it already contributed stay attached to the attendance they produced.",
    example: "Retire a gate on the 20th and no further records are taken from it, yet the attendance it recorded on the 1st through the 19th still resolves and reports normally.",
  },
  notes: {
    why: "A free-text note for whoever maintains this next. It affects no collection behaviour at all; it exists so an odd setting keeps its reason beside it instead of living in one person's memory.",
    example: "'Polled hourly because the plant link drops under load — do not lower' stops the next administrator setting it to 5 and filling the log with timeouts.",
  },
};

const employee_field = {
  "options.value": {
    why: "What is actually stored on the employee record when someone picks this choice. Reports, filters and exports all group by this string, so changing it after data exists strands every record already carrying the old value in a group of its own.",
    example: "Store married against the label 'Married' and a headcount report groups all of them together. Change the value to Married later and last year's records stay under married, splitting one category into two.",
  },
  "options.label": {
    why: "The wording shown in the dropdown. It can be changed freely at any time because nothing is stored under it — which makes it the right place to fix awkward phrasing, rather than editing the value underneath and orphaning existing records.",
    example: "Value married with label 'Married' reads fine; relabel it to 'Married / partnered' and every existing record still resolves, because they were all filed under married and nothing about the stored data moved.",
  },
  "validation.pattern": {
    why: "A regular expression every entered value must match, checked when the record is saved. It is the strictest control available on a custom field, so a pattern that is slightly too narrow blocks legitimate data with no way for the employee to override it.",
    example: "Use ^[A-Z]{5}[0-9]{4}[A-Z]$ for a PAN and ABCDE1234F is accepted while abcde1234f is refused. Tighten it to ^[A-Z]{5}[0-9]{4}$ and every real PAN fails, because the trailing checksum letter no longer fits.",
  },
  key: {
    why: "The permanent name every captured value is filed under, in the record, in exports and in any document template that prints it. Editing it does not rename the stored data — it abandons that data under the old name where nothing can reach it.",
    example: "Capture PF numbers under 'pf_number' for 300 people, change it to 'pfnumber', and the form is blank for all 300 while the old values sit untouched in the record.",
  },
  label: {
    why: "The wording read above the input by whoever fills the record, and by the employee on their own profile. It is the only text most people ever see, since the key stays internal, so it carries the whole instruction.",
    example: "'UAN (12 digits)' gets the right number typed. 'UAN' alone collects PF account numbers in the same box, and nothing rejects them because both are simply text.",
  },
  helpText: {
    why: "The line shown under the input while somebody is filling it in. It is the last chance to prevent a wrong-but-valid entry, because once saved nothing downstream can tell a mistyped identifier from a genuine one.",
    example: "'From your PF passbook, not the member id' on a UAN field. Without it the two are confused, and the mistake surfaces only when a withdrawal claim bounces months later.",
  },
  type: {
    why: "Decides how the value is captured, validated, sorted and filtered, and it is effectively fixed once data exists because stored values cannot be reinterpreted afterwards. Numbers sort numerically and dates filter by range; text does neither.",
    example: "Hold a joining bonus as 'text' and 90000 sorts below 9500 in the list. As 'currency' it orders correctly and prints with a symbol on generated letters.",
  },
  section: {
    why: "Which tab of the employee record the field lives on, which in most setups also settles who routinely sees it — payroll works in the bank and statutory tabs, HR in personal, and few people open all of them.",
    example: "An IFSC under 'bank' sits beside the account number payroll already verifies. Under 'personal' it is only found by someone scrolling past next-of-kin details.",
  },
  options: {
    why: "The fixed list a dropdown or multiselect offers, where the value is what gets stored and the label is only what people read. Editing a value later leaves existing records holding the old one, matching nothing in the list.",
    example: "Values 'day' and 'night' behind labels 'Day shift' and 'Night shift' reads well and stores tersely. Change the value to 'night_shift' and 40 records still say 'night' and display as blank.",
  },
  required: {
    why: "Whether a record can be saved with this left empty. Turning it on does not fill the gaps already behind it — existing employees keep their blanks and are only blocked the next time somebody opens and saves them.",
    example: "Make a UAN required with 300 employees on file and none are flagged today; the first person edited next week cannot save until they go and find that number.",
  },
  unique: {
    why: "Whether two employees may hold the same value. It is enforced at save time only, so switching it on over data that already contains duplicates cleans nothing — it just refuses the next person who types one.",
    example: "Turn it on for PAN and the 2 employees already sharing a mistyped number stay exactly as they are, while the next entry of that same number is rejected.",
  },
  defaultValue: {
    why: "What sits in the field on a record where nobody has entered anything. It is prefilled rather than suggested, so on a required field it lets a record save without a single person having looked at the value.",
    example: "Default a 'Shift allowance eligible' switch to true and all 200 imported employees arrive marked eligible; leave it empty and each one has to be answered before saving.",
  },
  "validation.min": {
    why: "The lowest value the field accepts for a number or currency entry. It is the only thing standing between a mistyped figure and a value that flows on into reports and printed documents as though it were real.",
    example: "Set 0 on a 'Previous CTC' field and a typo of -50000 is refused at the form. With no floor it saves, and quietly drags a department's average down all year.",
  },
  "validation.max": {
    why: "The highest value accepted. Its real work is catching an extra digit, which is the mistake nobody notices at entry because the number still looks plausible until somebody totals the column.",
    example: "A 'Notice period days' capped at 180 rejects 900 as it is typed. Uncapped, that record reads as a two-and-a-half-year notice on every exit report it appears in.",
  },
  "validation.minLength": {
    why: "The shortest text accepted, which is how an obviously truncated identifier is turned away at entry. It counts characters and nothing else, so it catches a half-typed value but never a fully-typed wrong one.",
    example: "Set 12 on a UAN field and a fragment like 10023 is refused as it is typed. Unset, it saves and stays wrong until a PF filing rejects the whole batch.",
  },
  "validation.maxLength": {
    why: "The longest text accepted. Beyond storage its job is keeping the field printable, because a value that overflows its box on a generated letter is discovered only once that letter has been signed.",
    example: "Cap an emergency contact name at 60 and a pasted paragraph is refused. Leave it open and 400 characters land in the name line of an ID card.",
  },
  isSensitive: {
    why: "Hides the field from anyone without explicit permission for sensitive data, so a manager approving leave never encounters it while payroll still can. It applies to downloads and exports as well as the screen.",
    example: "Mark a disability status field sensitive and 30 line managers stop seeing it both in the record and in their team export; HR and payroll notice no change.",
  },
  employeeEditable: {
    why: "Whether the employee may change their own value from self-service or only HR can. Anything payroll or a statutory filing depends on should stay closed, because a self-service edit lands with no approval behind it.",
    example: "A bank account number left editable can be changed the evening before payroll runs. Closed, that change reaches HR as a request with a record of who approved it.",
  },
  showInList: {
    why: "Whether the field becomes a column on the employee list and in the export taken from it, which is what decides whether a value can be scanned across a whole workforce or only read one record at a time.",
    example: "On for blood group, a safety officer pulls the figures for all 400 staff in one export. Off, they open 400 records one by one to build the same sheet.",
  },
  order: {
    why: "Where the field falls among the others in its section, which in practice decides whether it is reached before whoever is filling the form runs out of patience and saves what they have.",
    example: "Give a required ESIC number order 10 and it is answered before a rarely-used note at order 90. Leave both at 0 and they fall back to the order they were created in.",
  },
  isActive: {
    why: "Whether the field is still collected. Switching it off takes it out of the form, the list and the export while every value already captured stays on the record, so turning it back on later restores the data intact.",
    example: "Retire a vaccination field and nobody is asked again, yet the 300 answers gathered in 2022 are still on file the day an audit asks to see them.",
  },
};

module.exports = {
  shift,
  weekly_off,
  shift_pattern,
  department,
  designation,
  location,
  leave_type,
  leave_policy,
  payroll_component,
  salary_structure,
  holiday_calendar,
  holiday,
  role,
  user_invite,
  document_template,
  workflow,
  biometric_device,
  employee_field,
};
