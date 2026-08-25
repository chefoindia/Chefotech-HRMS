import type { FieldHelpContent } from "@/components/ui";

/**
 * Field-level help for the configuration screens whose forms are written by
 * hand rather than generated from the backend settings registry — attendance
 * policies, leave policies, shifts and payroll.
 *
 * The registry-driven settings carry their own `help` from the server. These
 * screens cannot, because the fields belong to a policy document rather than
 * a settings key, so the explanations live here and are looked up by the same
 * dotted path the form writes to. Keeping the key identical to the state path
 * means a renamed field shows up as missing help rather than help attached
 * silently to the wrong input.
 *
 * Every example uses concrete numbers, because the whole difficulty with
 * these screens is that a number typed today only reveals itself in someone's
 * pay three weeks later.
 */
export const ATTENDANCE_POLICY_HELP: Record<string, FieldHelpContent> = {
  name: {
    why: "How this policy is identified when you assign it to employees. Companies usually run more than one — office staff and factory workers rarely share the same lateness rules — so name it after the group it governs, not after a rule inside it.",
    example: "'Office staff' or 'Plant — general shift' tells the next person which group it applies to. 'Policy 1' or '15 min grace' does not, and becomes actively misleading the day you change the grace period.",
  },

  // ── Arrival ──────────────────────────────────────────────────────────────
  "arrival.graceMinutes": {
    why: "A buffer after shift start where arriving is simply not late — no mark, no consequence. It exists so ordinary life (a slow lift, a traffic light) does not generate a disciplinary record. Everything else in this section is measured from the end of this window, not from shift start.",
    example: "Shift starts 09:00 with grace 15: arriving 09:12 is on time and nothing is recorded. Arriving 09:16 is one minute late, not sixteen — because lateness is counted past the grace window.",
  },
  "arrival.lateAfterMinutes": {
    why: "How far past the grace window someone must be before a late mark is actually recorded. Set 0 and any arrival past grace is marked late immediately. A small value here gives a second, quieter cushion for people who are barely over.",
    example: "Grace 15, this set to 5: arriving 09:18 uses up grace but records no late mark; arriving 09:21 does. Set this to 0 instead and 09:16 already counts as a late mark.",
  },
  "arrival.halfDayAfterMinutes": {
    why: "Arriving this many minutes after shift start converts the day to a half day, regardless of how long the person then works. This is a deduction rule, so it has real money attached — it is the one people dispute most. Set 0 to switch it off and let hours worked decide the day instead.",
    example: "Set to 240 with a 09:00 shift: someone arriving at 13:30 is a half day even if they stay until 20:00. Set to 0 and that same person is judged only on hours worked, which on a 9-hour shift could still be a full day.",
  },
  "arrival.absentAfterMinutes": {
    why: "Arriving later than this marks the whole day absent — the harshest arrival rule, and normally reserved for someone who effectively did not come in. Set 0 to switch it off. Keep it well above the half-day threshold or it will overrule it.",
    example: "Set to 480 with a 09:00 shift: someone first punching at 17:30 is marked absent for the day. If you set this to 200 while half-day is 240, the absent rule fires first and the half-day rule can never apply.",
  },

  // ── Working hours ────────────────────────────────────────────────────────
  "hours.basis": {
    why: "Whether a full and half day are judged as a share of each person's own scheduled shift, or as a fixed number of hours for everyone. Shift-based is the safer default when teams work different shift lengths, because one number stays fair across all of them. Fixed hours is simpler to explain when everyone works the same day.",
    example: "Two teams work 9-hour and 6-hour shifts. Shift-based at 90%: full day is 8h 6m for one and 5h 24m for the other — proportionate. Fixed at 480 minutes: the 6-hour team can never reach a full day, no matter how completely they work their shift.",
  },
  "hours.fullDayPercent": {
    why: "The share of a scheduled shift someone must actually work to be credited a full day. Set it below 100 so ordinary variation — a slightly early exit, a late punch — does not cost someone a full day's pay. Too high and almost nobody achieves a full day; too low and half a shift counts as a whole one.",
    example: "90% of a 9-hour shift = 8h 6m to earn a full day. Someone working 8h 30m is a full day; someone working 7h is not. Set this to 100 and leaving even two minutes early costs a full day.",
  },
  "hours.halfDayPercent": {
    why: "The share of the shift below which the day is no longer a half day at all — it becomes an absence. Anything between this and the full-day threshold is a half day. This is the floor, so keep it comfortably under the full-day figure.",
    example: "Full day 90%, half day 45% on a 9-hour shift: 8h 6m+ is a full day, 4h 3m to 8h 5m is a half day, under 4h 3m is absent. So someone working 5 hours gets half a day's pay, not none.",
  },
  "hours.fullDayMinutes": {
    why: "The actual minutes worked to earn a full day, applied identically to everyone on this policy regardless of their shift length. Only use fixed hours if your teams genuinely work the same length of day.",
    example: "Set 480 (8 hours): someone working 8h 15m gets a full day, 7h 45m does not. Note that anyone on a 6-hour shift under this policy can never reach 480 minutes and so never earns a full day.",
  },
  "hours.halfDayMinutes": {
    why: "The minutes worked below which the day stops counting as a half day and becomes an absence. Anything between this and the full-day figure is a half day.",
    example: "Full day 480, half day 240: 8h+ is a full day, 4h to 7h 59m is a half day, under 4h is absent. Someone leaving after 3h 30m for a family emergency is therefore marked absent, not half day.",
  },
  "hours.minimumMinutesForPresence": {
    why: "The shortest stay that registers as attendance at all. Below this the day is treated as absent even though there are punches on it — which stops someone touching the reader and leaving from generating a partial day.",
    example: "Set to 60: someone who punches in, works 20 minutes and goes home is marked absent. Set to 0 and that same 20 minutes produces a record, which on a low half-day threshold could still earn part of a day's pay.",
  },

  // ── Late marks ───────────────────────────────────────────────────────────
  "lateMarks.enabled": {
    why: "Whether repeated lateness accumulates into an actual deduction, rather than each late arrival being noted and forgotten. Turn it on if you need a consistent, automatic consequence; leave it off if managers handle punctuality in conversation instead.",
    example: "On: three late marks in a month automatically become a half-day deduction, applied identically for everyone. Off: late arrivals are still recorded and visible in reports, but never convert into pay on their own.",
  },
  "lateMarks.countForDeduction": {
    why: "How many late marks add up before a deduction is applied. This is the tolerance dial: a low number is strict, a high number effectively decorative. Whatever you pick, tell staff — an automatic deduction nobody was warned about is the fastest route to a dispute.",
    example: "Set to 3 with a half-day deduction: the 3rd late arrival in the period costs half a day, and the counter starts again. Set to 10 and, in a month with 22 working days, most people will never reach it.",
  },
  "lateMarks.deductionType": {
    why: "What is actually deducted once the late-mark count is reached — typically half a day or a full day of pay. This flows straight into payroll as loss of pay, so it is a real deduction on a real payslip, not just a note.",
    example: "3 late marks with a half-day deduction: on a ₹30,000 monthly salary with a 30-day basis, that is roughly ₹500 off. Choosing a full day doubles it to about ₹1,000 for the same three late arrivals.",
  },
  "lateMarks.resetPeriod": {
    why: "When the late-mark counter goes back to zero. Monthly is the usual choice because it lines up with payroll, so a deduction lands in the same month as the lateness that caused it. A longer period is much stricter — marks accumulate for longer before forgiveness.",
    example: "Monthly: two late marks in January do not carry into February, so someone starts each month clean. Yearly with a threshold of 3: three scattered late arrivals across twelve months still trigger a deduction.",
  },

  // ── Overtime ─────────────────────────────────────────────────────────────
  "overtime.enabled": {
    why: "Whether time worked past the shift is tracked and paid at all. Off, extra hours are simply not counted — no record, no payment. On, everything below applies and overtime becomes a payroll input.",
    example: "On: someone staying two hours past shift end accrues overtime at the rates below. Off: those two hours are invisible to payroll no matter how often they happen.",
  },
  "overtime.startsAfterMinutes": {
    why: "A buffer past shift end before overtime begins accruing. It stops the few minutes people naturally spend finishing up or waiting for a lift from becoming a payable claim for everyone, every day.",
    example: "Set to 30 on an 18:00 shift end: leaving at 18:20 earns nothing; leaving at 19:00 accrues 30 minutes of overtime (from 18:30, not 18:00). Set to 0 and every day's few extra minutes becomes payable.",
  },
  "overtime.minimumMinutes": {
    why: "Discards an overtime stint shorter than this entirely. Distinct from the buffer above: this tests the total accrued, not when accrual starts, so it filters out trivial amounts that are not worth processing.",
    example: "Starts-after 30 and minimum 30: leaving at 19:05 accrues 35 minutes, which clears the minimum and is paid. Leaving at 18:50 accrues 20 minutes, which is under the minimum and is dropped.",
  },
  "overtime.roundToMinutes": {
    why: "Rounds accrued overtime down to a block, so payroll deals in clean quarter- or half-hours instead of odd minutes. Always rounds down, never up — set 0 to pay the exact minutes worked.",
    example: "Set to 15: 47 minutes of overtime is paid as 45. Set to 30: the same 47 minutes is paid as 30, quietly costing the employee 17 minutes each time — worth being deliberate about.",
  },
  "overtime.normalDayRate": {
    why: "The multiplier applied to the hourly rate for overtime on an ordinary working day. 1.5 is the common statutory expectation in many jurisdictions including India — check what applies to you, since this is one of the few settings with a legal floor.",
    example: "Someone on ₹300/hour working 2 hours overtime at 1.5 earns ₹900 rather than ₹600. Set it to 1 and they are paid ordinary rate for the extra time, which may not be lawful where you operate.",
  },
  "overtime.weeklyOffRate": {
    why: "The multiplier for overtime worked on the person's weekly off. Set higher than the normal-day rate: giving up a rest day is worth more than staying late on a working day, and many jurisdictions require the premium.",
    example: "At 2× on ₹300/hour, a 4-hour Sunday call-in earns ₹2,400 instead of the ₹1,800 the same hours would earn at 1.5 on a weekday.",
  },
  "overtime.holidayRate": {
    why: "The multiplier for overtime on a declared holiday from your holiday calendar. Usually matches or exceeds the weekly-off rate. It reads the holiday list, so a day missing from that calendar will be paid at the ordinary rate instead.",
    example: "At 2× on ₹300/hour, 5 hours worked on Diwali earns ₹3,000. If Diwali was never added to the holiday calendar, the same 5 hours quietly pays ₹2,250 at the normal 1.5 rate.",
  },
  "overtime.requiresApproval": {
    why: "Whether accrued overtime must be approved by a manager before it can be paid. On is the safer default — it stops someone simply staying late and generating a claim, and gives a manager the chance to confirm the work was actually needed. The cost is that unapproved overtime sits pending and never reaches payroll.",
    example: "On: 12 hours of overtime this month waits for a manager's approval before appearing on the payslip. Off: it flows straight into payroll on trust. If you turn it on, watch the pending queue — forgotten approvals mean people are not paid.",
  },

  // ── Missing punches and corrections ──────────────────────────────────────
  "missingPunch.treatAs": {
    why: "What to do with a day that has an in-punch but no out-punch (or the reverse) — normally someone forgetting, or a reader failing. This decides the default before any correction is raised, so it sets who has to act: a generous default means HR reviews later, a strict one means the employee notices and raises a correction.",
    example: "Treat as absent: a forgotten evening punch costs a full day until the employee spots it and corrects it — noticeable, but harsh if the reader was at fault. Treat as half day: they keep half the day automatically while the correction is sorted out.",
  },
  "regularization.enabled": {
    why: "Whether employees can raise a request to fix their own attendance, rather than every missed punch coming to HR by email. It creates an auditable trail with an approval step, which is generally far better than HR silently editing records.",
    example: "On: an employee whose evening punch failed submits a correction with a reason, their manager approves it, and the day is fixed with both names on the record. Off: they message HR, who edits the record directly with no approval trail.",
  },
  "regularization.windowDays": {
    why: "How far back a correction may reach. It exists to stop someone reopening a month that has already been paid. Balance it against your payroll cut-off: too short and genuine fixes become impossible, too long and no month is ever final.",
    example: "Set to 7 with payroll cut-off on the 25th: on the 20th someone can still fix the 14th, but not the 5th. Anyone who notices an error after a month has closed has to go to HR instead.",
  },
  "regularization.maxPerMonth": {
    why: "Caps how many corrections one person may raise per month, so the process stays an exception rather than a routine substitute for punching properly. Set it too low and someone with a genuinely faulty reader runs out of requests.",
    example: "Set to 3: someone who forgets four times in a month must go to HR for the fourth. If a whole team hits the cap regularly, the real problem is usually the reader, not the people.",
  },
};

/**
 * Salary components — written for someone who has never run payroll.
 *
 * A payslip is a list of lines: money added (earnings), money taken off
 * (deductions), and money the employer pays on top. Each line is one
 * "component". These explanations assume no prior payroll knowledge, because
 * the person configuring this usually has none and the cost of a wrong guess
 * lands in somebody's bank account.
 */
export const PAYROLL_COMPONENT_HELP: Record<string, FieldHelpContent> = {
  name: {
    why: "The name that appears on the payslip, exactly as the employee will read it. Use the wording your staff already recognise from their previous employer, not an internal abbreviation — this line is the one they check first.",
    example: "'House Rent Allowance' is understood immediately. 'HRA-2' or 'Comp 4' is not, and generates a support question every single month.",
  },
  code: {
    why: "A short internal name for this line, used when one component refers to another in a calculation. Once other components point at this code, changing it breaks them — so decide it now and leave it alone. Always uppercase, no spaces.",
    example: "Name the line 'House Rent Allowance' and code it HRA. Another component can then be built as '50% of HRA'. If you later rename the code to HOUSE_RENT, anything pointing at HRA stops working.",
  },
  type: {
    why: "Which side of the payslip this line sits on. Earning adds to pay. Deduction subtracts from it. Employer contribution is money the company pays on the employee's behalf (it never reduces their take-home). Reimbursement repays money they already spent. Informational shows a figure without moving any money.",
    example: "Basic and HRA are earnings. Provident Fund (employee share) and Professional Tax are deductions. The company's own PF share is an employer contribution — it costs the company but does not reduce the employee's salary.",
  },
  category: {
    why: "A grouping used for reports and statutory filings. It does not change any calculation — it decides how this line is summarised when you export payroll data or file a return.",
    example: "Mark Provident Fund and ESI as 'Statutory' and a compliance report can total them separately from ordinary allowances, without you listing every component by hand.",
  },
  order: {
    why: "The sequence lines are calculated in — lower numbers run first. This matters enormously: a component can only use the result of one calculated BEFORE it. Get the order wrong and a formula reads a zero instead of a real value, silently.",
    example: "Basic at order 10, HRA at order 20 works: HRA can be '50% of Basic' because Basic already has a value. Reverse them and HRA calculates against a Basic of 0, quietly paying ₹0 to everyone.",
  },
  "calculation.method": {
    why: "How this line's amount is worked out. A fixed amount is the same rupee value for everyone. A percentage of another component scales with salary. A step-by-step calculation covers caps, thresholds and remainders. A per-day rate multiplies by days worked. Set per employee means you type the figure on each person's record instead.",
    example: "A ₹1,600 conveyance allowance for everyone → fixed amount. HRA at 50% of Basic → percentage. PF at 12% of Basic capped at ₹1,800 → step-by-step calculation, because a plain percentage cannot express the cap.",
  },
  "calculation.amount": {
    why: "The exact rupee amount this line pays every month, identical for every employee on it. Use this only when the figure genuinely does not vary with salary — otherwise a percentage keeps it fair as people are promoted.",
    example: "Set ₹1,600: everyone with this component gets ₹1,600 a month, whether they earn ₹20,000 or ₹200,000. If it should scale with salary, use a percentage instead.",
  },
  "calculation.percentage": {
    why: "What share of another line this one pays. The great advantage over a fixed amount is that it stays correct as salaries change — nobody has to revisit it after an increment.",
    example: "Set 50 with 'of Basic': someone on ₹20,000 Basic gets ₹10,000, someone on ₹30,000 Basic gets ₹15,000. Both stay correct automatically after a raise.",
  },
  "calculation.ofComponent": {
    why: "Which line the percentage is taken from. It must be a component calculated earlier than this one (check the order number), or a built-in figure such as monthly CTC.",
    example: "HRA is normally a percentage of BASIC, so choose Basic here. Basic itself is usually a percentage of CTC_MONTHLY, since there is nothing earlier to reference.",
  },
  "calculation.expression": {
    why: "The step-by-step calculation, built from the choices above. Use this when a plain percentage cannot express what you need — a cap, a minimum, an eligibility threshold, or a balancing remainder. Build it with the guided options rather than typing it: a formula that parses but is subtly wrong pays the wrong amount to everyone on it, every month, without any error appearing.",
    example: "Provident Fund is '12% of Basic, but never more than ₹1,800'. On a ₹12,000 Basic it pays ₹1,440; on a ₹20,000 Basic it would be ₹2,400, so it caps at ₹1,800. A plain percentage cannot express that ceiling.",
  },
  prorateOnAttendance: {
    why: "Whether this line shrinks when the employee was absent without paid leave. On is right for regular salary — miss 3 of 30 days and you are paid for 27. Off is right for anything that should be paid in full regardless of attendance.",
    example: "On, for Basic: someone with 3 loss-of-pay days on a ₹30,000 Basic receives ₹27,000. Off, for a fixed phone reimbursement: they receive the full amount even in a month with absences.",
  },
  showOnPayslip: {
    why: "Whether the employee sees this line on their payslip. Turn it off for figures used only inside a calculation, or for employer-side costs you do not want to display. Turning it off never changes the amount — it only hides the line.",
    example: "Show Basic and HRA — employees expect to see them. Hide an internal 'CTC loading factor' used only as an input to other components, which would just cause confusion on the payslip.",
  },
};

/** Shift patterns — repeating rosters, for teams whose shift is not fixed. */
export const SHIFT_PATTERN_HELP: Record<string, FieldHelpContent> = {
  name: {
    why: "How this roster is identified when you put someone on it. Name it after the team or the rota itself, since one company often runs several — a plant rotation, a weekend support rota, a late-shift arrangement for one department.",
    example: "'Plant — 3 on 3 off' or 'Support — Wednesday late' tells the next person exactly who it is for. 'Pattern 2' does not.",
  },
  type: {
    why: "Whether the roster repeats every week or on a cycle of its own length. Weekly is fixed by day of the week — Wednesday is always the late shift. A rotation advances one day at a time regardless of weekday, so the same person works different days of the week as the cycle turns. Choose rotation only if your roster genuinely does not line up with the week.",
    example: "Weekly: Monday to Friday mornings, Wednesday late, weekend off — the same every week forever. Rotation with a 6-day cycle: three mornings then three nights, so someone working Monday morning this week is on nights the following Monday.",
  },
  isActive: {
    why: "Turning a pattern off does not delete it, and does not leave anyone without a shift — everyone on it falls back to the single standing shift on their own record. Useful for a seasonal roster you want back later without rebuilding it.",
    example: "Switch off a festive-season rotation in January: those employees are measured against their normal shift again, and the pattern is still there to switch back on in October.",
  },
  anchorDate: {
    why: "The date the first day of the cycle falls on. A rotation has no meaning without it — this is what tells the platform where in the cycle any given date sits. Moving it by one day shifts the entire roster for everyone on the pattern, so set it to a date you can point at on a real roster sheet.",
    example: "A 6-day cycle anchored to 1 September: the 1st is day 1, the 7th is day 1 again, the 13th is day 1 again. Change the anchor to 2 September and every one of those shifts moves by a day.",
  },
};
