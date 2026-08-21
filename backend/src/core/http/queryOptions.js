"use strict";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/**
 * Parse the shared list-query contract:
 *   ?page=1&limit=25&sort=-createdAt&q=ravi&status=active&from=&to=
 *
 * Every list endpoint in the platform uses this, which is what makes
 * "never load thousands of employees into the browser" a property of the
 * framework rather than a rule people have to remember.
 */
function parseListQuery(query = {}, options = {}) {
  const {
    allowedSort = ["createdAt"],
    defaultSort = "-createdAt",
    maxLimit = MAX_LIMIT,
  } = options;

  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const rawLimit = Number.parseInt(query.limit, 10) || DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, rawLimit), maxLimit);

  const sort = parseSort(query.sort, allowedSort, defaultSort);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sort,
    search: typeof query.q === "string" ? query.q.trim() : "",
  };
}

function parseSort(raw, allowed, fallback) {
  const spec = typeof raw === "string" && raw.trim() ? raw : fallback;
  const out = {};
  for (const token of spec.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const desc = trimmed.startsWith("-");
    const field = desc ? trimmed.slice(1) : trimmed;
    // Silently drop unknown sort fields rather than 400-ing: a stale bookmark
    // should still render a list.
    if (!allowed.includes(field)) continue;
    out[field] = desc ? -1 : 1;
  }
  if (!Object.keys(out).length) out.createdAt = -1;
  return out;
}

/**
 * Build a case-insensitive OR-match across the given fields.
 * Input is escaped, so a user searching for "a.b*" cannot inject a regex.
 */
function searchFilter(term, fields) {
  if (!term || !fields.length) return null;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp(escaped, "i");
  return { $or: fields.map((f) => ({ [f]: rx })) };
}

module.exports = { parseListQuery, searchFilter, DEFAULT_LIMIT, MAX_LIMIT };
