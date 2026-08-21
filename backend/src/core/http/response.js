"use strict";

/**
 * One response envelope for the whole API, so clients never have to guess.
 *
 *   { success: true, data, meta? }
 *   { success: false, error: { code, message, details? }, requestId }
 */

function ok(res, data, meta) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(200).json(body);
}

function created(res, data, meta) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(201).json(body);
}

function accepted(res, data) {
  return res.status(202).json({ success: true, data });
}

function noContent(res) {
  return res.status(204).send();
}

/** Paged list response. `page` is 1-indexed. */
function paged(res, items, { page, limit, total, ...extra } = {}) {
  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      hasNext: page * limit < total,
      hasPrev: page > 1,
      ...extra,
    },
  });
}

module.exports = { ok, created, accepted, noContent, paged };
