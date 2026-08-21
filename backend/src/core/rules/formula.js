"use strict";

const { AppError } = require("../errors/AppError");

/**
 * A safe arithmetic expression engine for tenant-configured formulas.
 *
 *   "BASIC * 0.5"
 *   "min(BASIC * 0.4, 15000)"
 *   "if(PRESENT_DAYS < WORKING_DAYS, GROSS / WORKING_DAYS * PRESENT_DAYS, GROSS)"
 *
 * Tenants type these into the salary-structure and attendance-policy editors,
 * so this is untrusted input executed on our server. It is therefore a real
 * tokenizer + recursive-descent parser + tree walker — never `eval`, `new
 * Function`, or a template literal handed to a sandbox library. There is no
 * property access, no assignment, no loop construct and no way to reach a
 * host object: the only things an expression can name are the variables and
 * whitelisted functions supplied by the caller.
 */

const MAX_EXPRESSION_LENGTH = 2000;
const MAX_DEPTH = 40;
const MAX_STEPS = 10_000;

// ── Tokenizer ────────────────────────────────────────────────────────────────

const TokenType = {
  NUMBER: "number",
  STRING: "string",
  IDENT: "ident",
  OP: "op",
  PAREN: "paren",
  COMMA: "comma",
  EOF: "eof",
};

const MULTI_CHAR_OPS = ["<=", ">=", "==", "!=", "&&", "||"];
const SINGLE_CHAR_OPS = ["+", "-", "*", "/", "%", "^", "<", ">", "!", "?", ":"];

function tokenize(input) {
  if (typeof input !== "string") {
    throw new AppError("FORMULA_ERROR", { message: "A formula must be text." });
  }
  if (input.length > MAX_EXPRESSION_LENGTH) {
    throw new AppError("FORMULA_ERROR", { message: "This formula is too long." });
  }

  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let j = i;
      let seenDot = false;
      while (j < input.length) {
        const c = input[j];
        if (c >= "0" && c <= "9") j += 1;
        else if (c === "." && !seenDot) {
          seenDot = true;
          j += 1;
        } else if (c === "_") j += 1; // 1_00_000 reads naturally for salaries
        else break;
      }
      const raw = input.slice(i, j).replace(/_/g, "");
      tokens.push({ type: TokenType.NUMBER, value: Number(raw), pos: i });
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = "";
      while (j < input.length && input[j] !== quote) {
        value += input[j];
        j += 1;
      }
      if (j >= input.length) {
        throw new AppError("FORMULA_ERROR", {
          message: `Unterminated text value at position ${i}.`,
        });
      }
      tokens.push({ type: TokenType.STRING, value, pos: i });
      i = j + 1;
      continue;
    }

    // Identifiers: BASIC, employee.grade, WORKING_DAYS
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_.]/.test(input[j])) j += 1;
      tokens.push({ type: TokenType.IDENT, value: input.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (ch === "(" || ch === ")") {
      tokens.push({ type: TokenType.PAREN, value: ch, pos: i });
      i += 1;
      continue;
    }

    if (ch === ",") {
      tokens.push({ type: TokenType.COMMA, value: ch, pos: i });
      i += 1;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (MULTI_CHAR_OPS.includes(two)) {
      tokens.push({ type: TokenType.OP, value: two, pos: i });
      i += 2;
      continue;
    }
    if (SINGLE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: TokenType.OP, value: ch, pos: i });
      i += 1;
      continue;
    }

    throw new AppError("FORMULA_ERROR", {
      message: `Unexpected character '${ch}' at position ${i}.`,
    });
  }

  tokens.push({ type: TokenType.EOF, value: null, pos: input.length });
  return tokens;
}

// ── Parser ───────────────────────────────────────────────────────────────────

function parse(tokens) {
  let pos = 0;
  let depth = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expect(type, value) {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new AppError("FORMULA_ERROR", {
        message: `Expected ${value || type} at position ${t.pos}.`,
      });
    }
    return next();
  }

  function guardDepth() {
    if (++depth > MAX_DEPTH) {
      throw new AppError("FORMULA_ERROR", { message: "This formula is nested too deeply." });
    }
  }

  function expression() {
    guardDepth();
    const node = ternary();
    depth -= 1;
    return node;
  }

  function ternary() {
    const condition = logicalOr();
    if (peek().type === TokenType.OP && peek().value === "?") {
      next();
      const whenTrue = expression();
      expect(TokenType.OP, ":");
      const whenFalse = expression();
      return { kind: "conditional", condition, whenTrue, whenFalse };
    }
    return condition;
  }

  function binaryLevel(operators, nextLevel) {
    let left = nextLevel();
    while (peek().type === TokenType.OP && operators.includes(peek().value)) {
      const op = next().value;
      const right = nextLevel();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  const logicalOr = () => binaryLevel(["||"], logicalAnd);
  const logicalAnd = () => binaryLevel(["&&"], equality);
  const equality = () => binaryLevel(["==", "!="], comparison);
  const comparison = () => binaryLevel(["<", ">", "<=", ">="], additive);
  const additive = () => binaryLevel(["+", "-"], multiplicative);
  const multiplicative = () => binaryLevel(["*", "/", "%"], power);

  function power() {
    const base = unary();
    if (peek().type === TokenType.OP && peek().value === "^") {
      next();
      // Right-associative: 2^3^2 === 2^(3^2)
      return { kind: "binary", op: "^", left: base, right: power() };
    }
    return base;
  }

  function unary() {
    const t = peek();
    if (t.type === TokenType.OP && (t.value === "-" || t.value === "!" || t.value === "+")) {
      next();
      return { kind: "unary", op: t.value, operand: unary() };
    }
    return primary();
  }

  function primary() {
    const t = peek();

    if (t.type === TokenType.NUMBER) {
      next();
      return { kind: "number", value: t.value };
    }

    if (t.type === TokenType.STRING) {
      next();
      return { kind: "string", value: t.value };
    }

    if (t.type === TokenType.PAREN && t.value === "(") {
      next();
      const inner = expression();
      expect(TokenType.PAREN, ")");
      return inner;
    }

    if (t.type === TokenType.IDENT) {
      next();
      // Function call?
      if (peek().type === TokenType.PAREN && peek().value === "(") {
        next();
        const args = [];
        if (!(peek().type === TokenType.PAREN && peek().value === ")")) {
          args.push(expression());
          while (peek().type === TokenType.COMMA) {
            next();
            args.push(expression());
          }
        }
        expect(TokenType.PAREN, ")");
        return { kind: "call", name: t.value, args };
      }
      const lower = t.value.toLowerCase();
      if (lower === "true") return { kind: "boolean", value: true };
      if (lower === "false") return { kind: "boolean", value: false };
      if (lower === "null") return { kind: "null" };
      return { kind: "variable", name: t.value };
    }

    throw new AppError("FORMULA_ERROR", {
      message: `Unexpected ${t.type === TokenType.EOF ? "end of formula" : `'${t.value}'`} at position ${t.pos}.`,
    });
  }

  const ast = expression();
  if (peek().type !== TokenType.EOF) {
    throw new AppError("FORMULA_ERROR", {
      message: `Unexpected '${peek().value}' at position ${peek().pos}.`,
    });
  }
  return ast;
}

// ── Built-in functions ───────────────────────────────────────────────────────

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const FUNCTIONS = {
  min: { arity: [1, Infinity], fn: (...a) => Math.min(...a.map(num)) },
  max: { arity: [1, Infinity], fn: (...a) => Math.max(...a.map(num)) },
  abs: { arity: [1, 1], fn: (a) => Math.abs(num(a)) },
  floor: { arity: [1, 1], fn: (a) => Math.floor(num(a)) },
  ceil: { arity: [1, 1], fn: (a) => Math.ceil(num(a)) },
  round: {
    arity: [1, 2],
    fn: (a, digits = 0) => {
      const d = Math.min(Math.max(Math.trunc(num(digits)), 0), 8);
      const factor = 10 ** d;
      return Math.round((num(a) + Number.EPSILON) * factor) / factor;
    },
  },
  sqrt: { arity: [1, 1], fn: (a) => Math.sqrt(Math.max(0, num(a))) },
  pow: { arity: [2, 2], fn: (a, b) => num(a) ** num(b) },
  /** if(condition, whenTrue, whenFalse) — the workhorse of policy formulas. */
  if: { arity: [3, 3], fn: (c, t, f) => (truthy(c) ? t : f), lazy: true },
  /** pct(value, percent) — 40% of basic reads better than basic * 0.4 */
  pct: { arity: [2, 2], fn: (v, p) => (num(v) * num(p)) / 100 },
  /** clamp(value, lower, upper) */
  clamp: {
    arity: [3, 3],
    fn: (v, lo, hi) => Math.min(Math.max(num(v), num(lo)), num(hi)),
  },
  /** Proportion of a monthly amount for days worked. */
  prorate: {
    arity: [3, 3],
    fn: (amount, actualDays, totalDays) => {
      const total = num(totalDays);
      if (total === 0) return 0;
      return round2((num(amount) * num(actualDays)) / total);
    },
  },
  coalesce: {
    arity: [1, Infinity],
    fn: (...args) => {
      for (const a of args) if (a !== null && a !== undefined && a !== "") return a;
      return 0;
    },
  },
  sum: { arity: [1, Infinity], fn: (...a) => a.reduce((acc, v) => acc + num(v), 0) },
};

function num(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new AppError("FORMULA_ERROR", {
      message: `'${value}' is not a number.`,
    });
  }
  return n;
}

function truthy(value) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") return value !== 0;
  return true;
}

// ── Evaluator ────────────────────────────────────────────────────────────────

function evaluateNode(node, ctx) {
  if (++ctx.steps > MAX_STEPS) {
    throw new AppError("FORMULA_ERROR", { message: "This formula is too complex to evaluate." });
  }

  switch (node.kind) {
    case "number":
    case "string":
    case "boolean":
      return node.value;
    case "null":
      return null;

    case "variable": {
      const value = lookup(ctx.variables, node.name);
      if (value === undefined) {
        if (ctx.strict) {
          throw new AppError("FORMULA_ERROR", {
            message: `'${node.name}' is not available in this formula.`,
            details: { variable: node.name, available: Object.keys(ctx.variables).sort() },
          });
        }
        return 0;
      }
      ctx.used.add(node.name);
      return value;
    }

    case "unary": {
      const v = evaluateNode(node.operand, ctx);
      if (node.op === "-") return -num(v);
      if (node.op === "+") return num(v);
      return !truthy(v);
    }

    case "binary": {
      // Short-circuit before evaluating the right side.
      if (node.op === "&&") {
        return truthy(evaluateNode(node.left, ctx)) ? truthy(evaluateNode(node.right, ctx)) : false;
      }
      if (node.op === "||") {
        return truthy(evaluateNode(node.left, ctx)) ? true : truthy(evaluateNode(node.right, ctx));
      }

      const l = evaluateNode(node.left, ctx);
      const r = evaluateNode(node.right, ctx);

      switch (node.op) {
        case "+":
          // String concatenation is intentional: document templates use it.
          if (typeof l === "string" || typeof r === "string") return `${l}${r}`;
          return num(l) + num(r);
        case "-":
          return num(l) - num(r);
        case "*":
          return num(l) * num(r);
        case "/": {
          const d = num(r);
          // Division by zero in a salary formula must not silently yield
          // Infinity and then NaN three steps later.
          if (d === 0) {
            throw new AppError("FORMULA_ERROR", { message: "This formula divides by zero." });
          }
          return num(l) / d;
        }
        case "%": {
          const d = num(r);
          if (d === 0) {
            throw new AppError("FORMULA_ERROR", { message: "This formula divides by zero." });
          }
          return num(l) % d;
        }
        case "^":
          return num(l) ** num(r);
        case "<":
          return num(l) < num(r);
        case ">":
          return num(l) > num(r);
        case "<=":
          return num(l) <= num(r);
        case ">=":
          return num(l) >= num(r);
        case "==":
          return typeof l === "string" || typeof r === "string" ? String(l) === String(r) : num(l) === num(r);
        case "!=":
          return typeof l === "string" || typeof r === "string" ? String(l) !== String(r) : num(l) !== num(r);
        default:
          throw new AppError("FORMULA_ERROR", { message: `Unsupported operator '${node.op}'.` });
      }
    }

    case "conditional":
      return truthy(evaluateNode(node.condition, ctx))
        ? evaluateNode(node.whenTrue, ctx)
        : evaluateNode(node.whenFalse, ctx);

    case "call": {
      const name = node.name.toLowerCase();
      const spec = FUNCTIONS[name];
      if (!spec) {
        throw new AppError("FORMULA_ERROR", {
          message: `'${node.name}' is not a known function.`,
          details: { available: Object.keys(FUNCTIONS) },
        });
      }
      const [minArgs, maxArgs] = spec.arity;
      if (node.args.length < minArgs || node.args.length > maxArgs) {
        throw new AppError("FORMULA_ERROR", {
          message: `${name}() expects ${minArgs === maxArgs ? minArgs : `${minArgs} to ${maxArgs}`} arguments.`,
        });
      }
      if (spec.lazy) {
        // if(): only the taken branch is evaluated, so
        // if(days > 0, total / days, 0) never divides by zero.
        const condition = evaluateNode(node.args[0], ctx);
        return truthy(condition)
          ? evaluateNode(node.args[1], ctx)
          : evaluateNode(node.args[2], ctx);
      }
      return spec.fn(...node.args.map((a) => evaluateNode(a, ctx)));
    }

    default:
      throw new AppError("FORMULA_ERROR", { message: "This formula could not be understood." });
  }
}

/** Resolve "employee.grade" against a flat-or-nested variable bag. */
function lookup(variables, path) {
  if (Object.prototype.hasOwnProperty.call(variables, path)) return variables[path];
  if (!path.includes(".")) return undefined;
  let current = variables;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

const astCache = new Map();
const AST_CACHE_LIMIT = 500;

function compile(expression) {
  const key = expression;
  const cached = astCache.get(key);
  if (cached) return cached;
  const ast = parse(tokenize(expression));
  if (astCache.size >= AST_CACHE_LIMIT) astCache.clear();
  astCache.set(key, ast);
  return ast;
}

/**
 * Evaluate a formula.
 *
 * @param {string} expression
 * @param {object} variables  values the formula may reference
 * @param {object} [options]
 * @param {boolean} [options.strict=true]  unknown variable throws instead of 0
 * @returns {{ value: any, used: string[] }}
 */
function evaluate(expression, variables = {}, options = {}) {
  const ast = compile(expression);
  const ctx = {
    variables,
    used: new Set(),
    steps: 0,
    strict: options.strict !== false,
  };
  const value = evaluateNode(ast, ctx);
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new AppError("FORMULA_ERROR", {
      message: "This formula produced a value that is not a number.",
    });
  }
  return { value, used: [...ctx.used] };
}

/** Numeric convenience wrapper, rounded to 2 dp — the payroll default. */
function evaluateAmount(expression, variables = {}, options = {}) {
  const { value, used } = evaluate(expression, variables, options);
  return { value: round2(num(value)), used };
}

/**
 * Static check used by the settings UI: does this parse, and does it only
 * reference variables the caller can supply?
 */
function validateExpression(expression, allowedVariables = null) {
  try {
    const ast = compile(expression);
    const referenced = collectVariables(ast);
    const unknownFns = collectFunctions(ast).filter((f) => !FUNCTIONS[f.toLowerCase()]);
    const unknownVars = allowedVariables
      ? referenced.filter((v) => !allowedVariables.includes(v))
      : [];
    return {
      valid: unknownFns.length === 0 && unknownVars.length === 0,
      variables: referenced,
      unknownVariables: unknownVars,
      unknownFunctions: unknownFns,
      error: null,
    };
  } catch (err) {
    return {
      valid: false,
      variables: [],
      unknownVariables: [],
      unknownFunctions: [],
      error: err.message,
    };
  }
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const key of ["left", "right", "operand", "condition", "whenTrue", "whenFalse"]) {
    if (node[key]) walk(node[key], visit);
  }
  if (node.args) for (const a of node.args) walk(a, visit);
}

function collectVariables(ast) {
  const out = new Set();
  walk(ast, (n) => {
    if (n.kind === "variable") out.add(n.name);
  });
  return [...out];
}

function collectFunctions(ast) {
  const out = new Set();
  walk(ast, (n) => {
    if (n.kind === "call") out.add(n.name);
  });
  return [...out];
}

module.exports = {
  evaluate,
  evaluateAmount,
  validateExpression,
  compile,
  tokenize,
  parse,
  FUNCTIONS,
  round2,
};
