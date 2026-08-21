"use strict";

const mongoose = require("mongoose");

/**
 * HR, payroll and audit data is subject to retention rules — nothing is hard
 * deleted through the API. `deletedAt` is set instead, and every read filters
 * it out unless the caller explicitly asks for archived records.
 */
const SOFT_DELETE_HOOKS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "count",
  "countDocuments",
  "distinct",
  "updateOne",
  "updateMany",
];

function softDeletePlugin(schema) {
  schema.add({
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  });

  for (const hook of SOFT_DELETE_HOOKS) {
    schema.pre(hook, function excludeDeleted() {
      const opts = this.getOptions();
      if (opts.withDeleted || opts.onlyDeleted) {
        if (opts.onlyDeleted) this.where({ deletedAt: { $ne: null } });
        return;
      }
      const filter = this.getFilter() || {};
      if (filter.deletedAt === undefined) this.where({ deletedAt: null });
    });
  }

  schema.query.withDeleted = function withDeleted() {
    return this.setOptions({ withDeleted: true });
  };
  schema.query.onlyDeleted = function onlyDeleted() {
    return this.setOptions({ onlyDeleted: true });
  };

  schema.methods.softDelete = async function softDelete(userId) {
    this.deletedAt = new Date();
    this.deletedBy = userId || null;
    return this.save();
  };

  schema.methods.restore = async function restore() {
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save();
  };
}

module.exports = { softDeletePlugin };
