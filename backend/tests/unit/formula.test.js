"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const formula = require("../../src/core/rules/formula");

/**
 * The formula engine executes text that tenants type into a settings screen.
 * These tests exist mainly to prove it cannot be turned into code execution.
 */

test("evaluates arithmetic with the expected precedence", () => {
  assert.equal(formula.evaluate("2 + 3 * 4").value, 14);
  assert.equal(formula.evaluate("(2 + 3) * 4").value, 20);
  assert.equal(formula.evaluate("10 / 4").value, 2.5);
  assert.equal(formula.evaluate("10 % 3").value, 1);
});

test("exponentiation is right-associative", () => {
  // 2^(3^2) = 512, not (2^3)^2 = 64
  assert.equal(formula.evaluate("2 ^ 3 ^ 2").value, 512);
});

test("resolves variables, including dotted paths", () => {
  const result = formula.evaluate("employee.grade * 2", { employee: { grade: 3 } });
  assert.equal(result.value, 6);
  assert.deepEqual(result.used, ["employee.grade"]);
});

test("computes the salary chain a real structure uses", () => {
  const ctcMonthly = 50000;
  const basic = formula.evaluateAmount("pct(CTC_MONTHLY, 40)", { CTC_MONTHLY: ctcMonthly }).value;
  const hra = formula.evaluateAmount("pct(BASIC, 50)", { BASIC: basic }).value;
  const pf = formula.evaluateAmount("min(pct(BASIC, 12), 1800)", { BASIC: basic }).value;

  assert.equal(basic, 20000);
  assert.equal(hra, 10000);
  assert.equal(pf, 1800, "PF is capped at the statutory ceiling");
});

test("if() only evaluates the branch it takes", () => {
  // The false branch divides by zero. If both branches were evaluated this
  // would throw, which is exactly the bug this laziness prevents.
  const result = formula.evaluate("if(DAYS > 0, TOTAL / DAYS, 0)", { DAYS: 0, TOTAL: 100 });
  assert.equal(result.value, 0);
});

test("division by zero is an error, never Infinity", () => {
  assert.throws(() => formula.evaluate("100 / 0"), /divides by zero/);
  assert.throws(() => formula.evaluate("100 / DAYS", { DAYS: 0 }), /divides by zero/);
});

test("unknown variables throw in strict mode and default to 0 otherwise", () => {
  assert.throws(() => formula.evaluate("MISSING + 1", {}), /not available/);
  assert.equal(formula.evaluate("MISSING + 1", {}, { strict: false }).value, 1);
});

test("rejects attempts to reach the host environment", () => {
  const attacks = [
    "process.exit(1)",
    "require('fs')",
    "constructor.constructor('return 1')()",
    "this.constructor",
    "__proto__",
    "globalThis",
    "(function(){})()",
    "1; process.exit(1)",
    "eval('1')",
    "[].constructor",
  ];

  for (const attack of attacks) {
    assert.throws(
      () => formula.evaluate(attack, {}),
      (err) => err.code === "FORMULA_ERROR",
      `"${attack}" should have been rejected`
    );
  }
});

test("prototype pollution through a variable path is not possible", () => {
  assert.throws(() => formula.evaluate("__proto__.polluted", {}), /not available/);
  assert.equal({}.polluted, undefined);
});

test("refuses expressions that are too long or too deeply nested", () => {
  assert.throws(() => formula.evaluate("1 + ".repeat(3000) + "1"), /too long/);
  assert.throws(() => formula.evaluate(`${"(".repeat(60)}1${")".repeat(60)}`), /nested too deeply/);
});

test("validateExpression reports unknown variables without throwing", () => {
  const result = formula.validateExpression("pct(BASIC, 50) + MYSTERY", ["BASIC"]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.unknownVariables, ["MYSTERY"]);
  assert.equal(result.error, null);
});

test("validateExpression reports a syntax error rather than throwing", () => {
  const result = formula.validateExpression("pct(BASIC, ");
  assert.equal(result.valid, false);
  assert.match(result.error, /Unexpected end of formula/);
});

test("built-in functions behave as documented", () => {
  assert.equal(formula.evaluate("min(5, 3, 9)").value, 3);
  assert.equal(formula.evaluate("max(5, 3, 9)").value, 9);
  assert.equal(formula.evaluate("round(1234.567, 2)").value, 1234.57);
  assert.equal(formula.evaluate("clamp(15, 0, 10)").value, 10);
  assert.equal(formula.evaluate("prorate(30000, 20, 30)").value, 20000);
  // coalesce skips only absent values. Zero is a real number and wins.
  assert.equal(formula.evaluate("coalesce(0, 5)").value, 0);
  assert.equal(formula.evaluate("coalesce(MISSING, 5)", {}, { strict: false }).value, 0);
  assert.equal(formula.evaluate("coalesce(BLANK, 5)", { BLANK: "" }).value, 5);
  assert.equal(formula.evaluate("sum(1, 2, 3, 4)").value, 10);
});

test("the same expression evaluates identically every time", () => {
  const variables = { CTC_MONTHLY: 83333, PRESENT_DAYS: 22, DAYS_IN_PERIOD: 30 };
  const expression = "round(pct(CTC_MONTHLY, 40) / DAYS_IN_PERIOD * PRESENT_DAYS, 2)";

  const first = formula.evaluate(expression, variables).value;
  for (let i = 0; i < 50; i += 1) {
    assert.equal(formula.evaluate(expression, variables).value, first);
  }
});
