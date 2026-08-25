"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const tenant = require("../../src/core/tenancy/tenantContext");
const { seedStarterData } = require("../../src/core/setup/starterData.service");
const formula = require("../../src/core/rules/formula");
const engine = require("../../src/modules/payroll/payrollEngine");
const { SalaryComponent } = require("../../src/modules/payroll/payroll.model");

/**
 * Every new organization is created with this configuration already in place,
 * so it is the first thing a customer ever sees — and a broken formula in
 * here would not surface as an error on screen. It would surface as a wrong
 * number on somebody's payslip, weeks later.
 *
 * These tests run the seeded components through the real expression engine
 * and a real payroll calculation, rather than just asserting the rows exist.
 */

const ORG_ID = new mongoose.Types.ObjectId();

test.before(async () => {
  await startDatabase();
});
test.after(async () => {
  await stopDatabase();
});
test.beforeEach(async () => {
  await clearDatabase();
});

test("starter data", async (t) => {
  await t.test("seeds a working configuration into an empty organization", async () => {
    const created = await tenant.runWithTenant(ORG_ID, () => seedStarterData());

    assert.ok(created.shifts > 0, "a new company needs at least one shift");
    assert.ok(created.attendancePolicies > 0, "attendance cannot be calculated without a policy");
    assert.ok(created.leaveTypes > 0, "employees cannot apply for leave with no leave types");
    assert.ok(created.salaryComponents > 0, "payroll cannot run with no salary components");
  });

  await t.test("running it twice does not duplicate anything", async () => {
    await tenant.runWithTenant(ORG_ID, () => seedStarterData());
    const second = await tenant.runWithTenant(ORG_ID, () => seedStarterData());

    assert.deepEqual(
      second,
      { shifts: 0, attendancePolicies: 0, leaveTypes: 0, salaryComponents: 0 },
      "the on-demand endpoint must never duplicate rows or overwrite a customer's edits"
    );
  });

  await t.test("every seeded formula parses against the real engine", async () => {
    await tenant.runWithTenant(ORG_ID, () => seedStarterData());
    const components = await tenant.runWithTenant(ORG_ID, () =>
      SalaryComponent.find({}).sort({ order: 1 }).lean()
    );

    const broken = [];
    for (const component of components) {
      if (component.calculation.method !== "formula") continue;
      // Only components calculated BEFORE this one are legitimately available
      // to it — validating against all codes would hide an ordering mistake.
      const earlier = components.filter((o) => o.order < component.order).map((o) => o.code);
      const check = formula.validateExpression(
        component.calculation.expression,
        engine.availableVariables(earlier)
      );
      if (!check.valid) {
        broken.push(`${component.code}: ${component.calculation.expression} — ${check.error}`);
      }
    }

    assert.deepEqual(broken, [], `seeded formulas that do not evaluate:\n${broken.join("\n")}`);
  });

  await t.test("the seeded components produce a payslip that adds up to CTC", async () => {
    await tenant.runWithTenant(ORG_ID, () => seedStarterData());
    const components = await tenant.runWithTenant(ORG_ID, () =>
      SalaryComponent.find({}).sort({ order: 1 }).lean()
    );

    const CTC = 50000;
    const context = {
      CTC, CTC_MONTHLY: CTC, CTC_ANNUAL: CTC * 12,
      DAYS_IN_PERIOD: 30, WORKING_DAYS: 26, PAYABLE_DAYS: 30, PRESENT_DAYS: 30,
      ABSENT_DAYS: 0, LOP_DAYS: 0, PAID_LEAVE_DAYS: 0, UNPAID_LEAVE_DAYS: 0,
      OVERTIME_HOURS: 0, PRORATION_FACTOR: 1,
      GROSS: 0, TOTAL_EARNINGS: 0, TOTAL_DEDUCTIONS: 0,
    };

    let gross = 0;
    let deductions = 0;
    for (const component of components) {
      let amount = 0;
      if (component.calculation.method === "formula") {
        amount = formula.evaluate(component.calculation.expression, context, { strict: false }).value;
      } else if (component.calculation.method === "fixed") {
        amount = component.calculation.amount;
      }
      context[component.code] = amount;
      if (component.type === "earning") {
        gross += amount;
        context.GROSS = gross;
      }
      if (component.type === "deduction") deductions += amount;
    }

    // The balancing Special Allowance exists precisely so this holds. If it
    // ever stops holding, the seeded chain is wrong and every new customer
    // would be quietly paying staff more or less than their agreed CTC.
    assert.equal(
      Math.round(gross),
      CTC,
      `earnings should total exactly the monthly CTC, got ${Math.round(gross)} against ${CTC}`
    );

    assert.ok(deductions > 0, "the statutory deductions should produce a non-zero total");
    assert.ok(
      Math.round(gross - deductions) < CTC,
      "net pay must be lower than gross once deductions apply"
    );
  });

  await t.test("Provident Fund respects its statutory ceiling", async () => {
    await tenant.runWithTenant(ORG_ID, () => seedStarterData());
    const pf = await tenant.runWithTenant(ORG_ID, () => SalaryComponent.findOne({ code: "PF" }).lean());

    // 12% of a 40,000 Basic would be 4,800 — the cap is the whole point.
    const capped = formula.evaluate(pf.calculation.expression, { BASIC: 40000 }, { strict: false }).value;
    assert.equal(capped, 1800, "PF should cap at 1800, not pay 12% of a high Basic");

    const uncapped = formula.evaluate(pf.calculation.expression, { BASIC: 10000 }, { strict: false }).value;
    assert.equal(uncapped, 1200, "below the ceiling PF should be a straight 12%");
  });
});
