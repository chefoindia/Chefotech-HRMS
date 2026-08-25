"use strict";

const { parseListQuery, searchFilter } = require("../core/http/queryOptions");
const { AppError } = require("../core/errors/AppError");
const audit = require("../core/audit/audit.service");
const tenant = require("../core/tenancy/tenantContext");
const { ok, created, paged } = require("../core/http/response");
const { jsonTransform } = require("../core/tenancy/baseSchema");

/**
 * A CRUD factory for the reference-data modules — departments, designations,
 * locations and the like.
 *
 * These entities are genuinely the same shape: list with search and paging,
 * read one, create, update, archive. Writing five near-identical controllers
 * would mean five places for a tenant-scoping or audit bug to hide. Modules
 * with real domain logic (attendance, leave, payroll) do NOT use this — they
 * have their own services, because pretending they are CRUD is what turns an
 * HRMS into a spreadsheet with a login page.
 */
function createCrudService({
  model,
  entityType,
  labelField = "name",
  searchFields = ["name"],
  allowedSort = ["name", "createdAt", "updatedAt"],
  defaultSort = "name",
  populate = null,
  buildFilter = null,
  beforeCreate = null,
  afterCreate = null,
  beforeUpdate = null,
  afterUpdate = null,
  beforeDelete = null,
  projection = null,
}) {
  async function list(query = {}) {
    const { page, limit, skip, sort, search } = parseListQuery(query, {
      allowedSort,
      defaultSort,
    });

    const filter = {};
    if (buildFilter) Object.assign(filter, buildFilter(query) || {});
    if (query.status) filter.status = query.status;
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive === "true" || query.isActive === true;
    }

    const search$ = searchFilter(search, searchFields);
    const finalFilter = search$ ? { $and: [filter, search$] } : filter;

    let q = model.find(finalFilter).sort(sort).skip(skip).limit(limit);
    if (populate) q = q.populate(populate);
    if (projection) q = q.select(projection);

    const [items, total] = await Promise.all([
      q.lean(),
      model.countDocuments(finalFilter),
    ]);

    // `.lean()` skips Mongoose documents entirely, so the schema's own
    // `toJSON` transform (which renames `_id` to `id`) never runs — every
    // other method here returns a real document and gets that for free.
    // Without this, a list response has `_id` and no `id` at all, which
    // means every row's edit/archive action (built on `row.id`) silently
    // targets `/resource/undefined` and the list's React key is `undefined`
    // for every row.
    return { items: items.map((item) => jsonTransform(null, item)), page, limit, total };
  }

  async function getById(id) {
    let q = model.findById(id);
    if (populate) q = q.populate(populate);
    const doc = await q;
    if (!doc) throw AppError.notFound(entityType);
    return doc;
  }

  async function create(data, req) {
    const payload = beforeCreate ? await beforeCreate(data, req) : data;
    const doc = await model.create({
      ...payload,
      createdBy: tenant.getUserId(),
      updatedBy: tenant.getUserId(),
    });

    await audit.record(
      {
        action: `${entityType.toLowerCase()}.created`,
        entityType,
        entityId: doc._id,
        entityLabel: doc[labelField],
        after: doc.toObject(),
        severity: "notice",
      },
      req
    );

    if (afterCreate) await afterCreate(doc, req);
    return doc;
  }

  async function update(id, data, req) {
    const doc = await getById(id);
    const before = doc.toObject();

    const payload = beforeUpdate ? await beforeUpdate(data, doc, req) : data;
    Object.assign(doc, payload, { updatedBy: tenant.getUserId() });
    await doc.save();

    await audit.record(
      {
        action: `${entityType.toLowerCase()}.updated`,
        entityType,
        entityId: doc._id,
        entityLabel: doc[labelField],
        before,
        after: doc.toObject(),
        severity: "notice",
        skipIfUnchanged: true,
      },
      req
    );

    if (afterUpdate) await afterUpdate(doc, before, req);
    return doc;
  }

  /** Archive, never destroy: HR reference data is referenced by history. */
  async function remove(id, req) {
    const doc = await getById(id);
    if (beforeDelete) await beforeDelete(doc, req);

    await doc.softDelete(tenant.getUserId());

    await audit.record(
      {
        action: `${entityType.toLowerCase()}.archived`,
        entityType,
        entityId: doc._id,
        entityLabel: doc[labelField],
        severity: "warning",
      },
      req
    );

    return { id: String(doc._id), archived: true };
  }

  return { list, getById, create, update, remove, model };
}

/** Thin controllers over a CRUD service. */
function createCrudController(service, { transform = (d) => d } = {}) {
  return {
    async list(req, res) {
      const result = await service.list(req.query);
      return paged(res, result.items.map(transform), result);
    },
    async get(req, res) {
      const doc = await service.getById(req.params.id);
      return ok(res, transform(doc.toObject ? doc.toObject() : doc));
    },
    async create(req, res) {
      const doc = await service.create(req.body, req);
      return created(res, transform(doc.toObject()));
    },
    async update(req, res) {
      const doc = await service.update(req.params.id, req.body, req);
      return ok(res, transform(doc.toObject()));
    },
    async remove(req, res) {
      return ok(res, await service.remove(req.params.id, req));
    },
  };
}

module.exports = { createCrudService, createCrudController };
