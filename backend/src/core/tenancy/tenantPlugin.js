"use strict";

const mongoose = require("mongoose");
const { AppError } = require("../errors/AppError");
const tenant = require("./tenantContext");

/**
 * Mongoose plugin that makes tenant isolation a property of the data layer.
 *
 * Applied to every tenant-owned schema, it:
 *   1. adds a required, indexed `organizationId`;
 *   2. stamps it from the ambient context on save/insert;
 *   3. injects it into the filter of every read, update and delete;
 *   4. prepends a $match to every aggregate;
 *   5. throws when there is no context at all, unless the caller explicitly
 *      opted out with `.bypassTenant()` from inside a system context.
 *
 * The consequence is that a forgotten `organizationId` in a service is a loud
 * 400 in development, never a quiet cross-tenant read in production.
 */

const READ_HOOKS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "count",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
];

function tenantPlugin(schema, options = {}) {
  const field = options.field || "organizationId";
  const ref = options.ref || "Organization";

  schema.add({
    [field]: {
      type: mongoose.Schema.Types.ObjectId,
      ref,
      required: true,
      index: true,
      immutable: true, // an entity can never be moved between tenants
    },
  });

  /** Resolve the org id to apply, or signal "skip scoping". */
  function resolveScope(query) {
    const bypass = query && query.getOptions && query.getOptions().bypassTenant;
    if (bypass) {
      tenant.assertSystemAllowed(query.op);
      return null;
    }
    const orgId = tenant.getOrganizationId();
    if (!orgId) {
      if (tenant.isSystemContext()) {
        // System context without an explicit bypass is a programming error:
        // it would read across every tenant by accident.
        throw new AppError("TENANT_CONTEXT_MISSING", {
          message:
            "A tenant-scoped query ran in a system context without .bypassTenant().",
          meta: { model: query && query.model && query.model.modelName },
        });
      }
      throw new AppError("TENANT_CONTEXT_MISSING");
    }
    return orgId;
  }

  for (const hook of READ_HOOKS) {
    schema.pre(hook, function applyTenantFilter() {
      const orgId = resolveScope(this);
      if (!orgId) return;

      const filter = this.getFilter() || {};
      const existing = filter[field];

      if (existing !== undefined && String(existing) !== String(orgId)) {
        // A caller tried to read another tenant explicitly. Report it as a
        // 404 so the API never confirms that the other tenant's id exists.
        throw new AppError("CROSS_TENANT_ACCESS", {
          meta: {
            model: this.model.modelName,
            requested: String(existing),
            actual: String(orgId),
          },
        });
      }

      this.setQuery({ ...filter, [field]: new mongoose.Types.ObjectId(orgId) });

      // Upserts must also write the tenant, or the new doc fails validation.
      if (["findOneAndUpdate", "updateOne", "updateMany"].includes(this.op)) {
        const update = this.getUpdate() || {};
        if (!Array.isArray(update)) {
          update.$setOnInsert = {
            ...(update.$setOnInsert || {}),
            [field]: new mongoose.Types.ObjectId(orgId),
          };
          // Never let an update payload rewrite the tenant.
          if (update.$set) delete update.$set[field];
          delete update[field];
          this.setUpdate(update);
        }
      }
    });
  }

  schema.pre("aggregate", function applyTenantMatch() {
    const opts = this.options || {};
    if (opts.bypassTenant) {
      tenant.assertSystemAllowed("aggregate");
      return;
    }
    const orgId = tenant.getOrganizationId();
    if (!orgId) throw new AppError("TENANT_CONTEXT_MISSING");
    this.pipeline().unshift({
      $match: { [field]: new mongoose.Types.ObjectId(orgId) },
    });
  });

  // Stamped on `validate`, not `save`. Mongoose runs validation BEFORE the
  // save hooks, so stamping in pre('save') would leave `organizationId`
  // missing at the moment the "required" validator runs and every create
  // would fail.
  schema.pre("validate", function stampTenant(next) {
    const orgId = tenant.getOrganizationId();

    if (!this[field]) {
      if (!orgId) return next(new AppError("TENANT_CONTEXT_MISSING"));
      this[field] = new mongoose.Types.ObjectId(orgId);
      return next();
    }

    // Document already carries a tenant: it must match the ambient one.
    // System contexts (seeding, super-admin provisioning) are exempt.
    if (orgId && String(this[field]) !== String(orgId)) {
      return next(
        new AppError("CROSS_TENANT_ACCESS", {
          meta: { model: this.constructor.modelName },
        })
      );
    }
    if (!orgId && !tenant.isSystemContext()) {
      return next(new AppError("TENANT_CONTEXT_MISSING"));
    }
    return next();
  });

  schema.pre("insertMany", function stampMany(next, docs) {
    const orgId = tenant.getOrganizationId();
    if (!orgId) {
      if (tenant.isSystemContext()) return next();
      return next(new AppError("TENANT_CONTEXT_MISSING"));
    }
    const oid = new mongoose.Types.ObjectId(orgId);
    for (const doc of docs || []) {
      if (doc[field] && String(doc[field]) !== String(orgId)) {
        return next(new AppError("CROSS_TENANT_ACCESS"));
      }
      doc[field] = oid;
    }
    return next();
  });

  /**
   * Explicit, greppable opt-out. Reads as:
   *   Organization.find().bypassTenant()
   * and only works inside runAsSystem().
   */
  schema.query.bypassTenant = function bypassTenant() {
    return this.setOptions({ bypassTenant: true });
  };

  /** Convenience: the current tenant filter, for hand-built pipelines. */
  schema.statics.tenantFilter = function tenantFilter(extra = {}) {
    return {
      [field]: new mongoose.Types.ObjectId(tenant.requireOrganizationId()),
      ...extra,
    };
  };
}

module.exports = { tenantPlugin };
