"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const tenant = require("../../src/core/tenancy/tenantContext");
const { createCrudService } = require("../../src/shared/crudFactory");
const Department = require("../../src/modules/departments/department.model");
const Organization = require("../../src/modules/organizations/organization.model");

/**
 * `createCrudService().list()` is the read path behind every reference-data
 * screen built on `MasterDataPage` — departments, designations, locations,
 * shifts, leave types and more (nine route files at last count). Its `get`,
 * `create` and `update` return a real Mongoose document, whose schema-level
 * `toJSON` transform renames `_id` to `id`. `list` alone used `.lean()` for
 * speed, which skips that transform entirely — so a list response had `_id`
 * and no `id` at all, and every row's edit/archive action (built on
 * `row.id`) silently targeted `/resource/undefined`. Nothing caught this
 * until it showed up as a live bug, which is exactly why it gets a test now.
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
  await tenant.runAsSystem(
    () => Organization.create({ _id: ORG_ID, name: "Alpha Textiles", slug: "alpha-textiles" }),
    "test.setup"
  );
});

test("a list response shapes every row like get/create/update do", async () => {
  await tenant.runWithTenant(ORG_ID, async () => {
    await Department.create([
      { name: "Operations", code: "OPS" },
      { name: "Quality", code: "QC" },
    ]);

    const service = createCrudService({
      model: Department,
      entityType: "Department",
      searchFields: ["name", "code"],
    });

    const { items } = await service.list({});

    assert.equal(items.length, 2);
    for (const item of items) {
      assert.equal(typeof item.id, "string", "every row needs an id a frontend action can target");
      assert.match(item.id, /^[0-9a-f]{24}$/, "id should be the real Mongo id as a hex string");
      assert.equal(item._id, undefined, "the raw _id should not leak once id exists");
    }

    // The value that would have made every row's edit/archive request go to
    // `/departments/undefined` if this ever regresses.
    assert.notEqual(items[0].id, undefined);
  });
});
