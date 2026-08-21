"use strict";

const mongoose = require("mongoose");
const { tenantPlugin } = require("./tenantPlugin");
const { softDeletePlugin } = require("./softDeletePlugin");

/**
 * Factory for tenant-owned schemas. Every model in a `modules/*` folder that
 * belongs to a customer organization is built with this, which guarantees a
 * uniform shape: tenant column, soft delete, timestamps, and a JSON transform
 * that renames _id to id and strips internals.
 */
function createTenantSchema(definition, options = {}) {
  const schema = new mongoose.Schema(definition, {
    timestamps: true,
    versionKey: false,
    minimize: false,
    toJSON: { virtuals: true, transform: jsonTransform },
    toObject: { virtuals: true },
    ...options,
  });

  schema.plugin(tenantPlugin);
  if (options.softDelete !== false) schema.plugin(softDeletePlugin);

  schema.add({
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  });

  return schema;
}

/** For platform-level (non tenant-owned) collections: plans, orgs, jobs. */
function createGlobalSchema(definition, options = {}) {
  return new mongoose.Schema(definition, {
    timestamps: true,
    versionKey: false,
    minimize: false,
    toJSON: { virtuals: true, transform: jsonTransform },
    toObject: { virtuals: true },
    ...options,
  });
}

function jsonTransform(_doc, ret) {
  ret.id = ret._id ? String(ret._id) : ret.id;
  delete ret._id;
  delete ret.__v;
  delete ret.passwordHash;
  delete ret.refreshTokenHashes;
  delete ret.mfaSecret;
  return ret;
}

/**
 * Compound unique index scoped to the tenant. Using this instead of
 * `unique: true` on the field keeps "employee code EMP001" free for every
 * organization independently.
 */
function tenantUnique(schema, fields, options = {}) {
  const spec = { organizationId: 1 };
  for (const f of [].concat(fields)) spec[f] = 1;
  schema.index(spec, { unique: true, ...options });
  return schema;
}

module.exports = { createTenantSchema, createGlobalSchema, tenantUnique, jsonTransform };
