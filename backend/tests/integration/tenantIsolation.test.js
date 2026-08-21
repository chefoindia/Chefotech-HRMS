"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const tenant = require("../../src/core/tenancy/tenantContext");

const Department = require("../../src/modules/departments/department.model");
const Employee = require("../../src/modules/employees/employee.model");
const Organization = require("../../src/modules/organizations/organization.model");

/**
 * Tenant isolation.
 *
 * This is the test that matters most in a multi-tenant HRMS. Everything else
 * is a feature; this is the difference between a product you can sell and a
 * data breach.
 *
 * The isolation is enforced by a mongoose plugin rather than by discipline in
 * each service, so these tests exercise the plugin directly — if it holds,
 * every query in the platform inherits the guarantee.
 */

const ORG_A = new mongoose.Types.ObjectId();
const ORG_B = new mongoose.Types.ObjectId();

test.before(async () => {
  await startDatabase();
});

test.after(async () => {
  await stopDatabase();
});

test.beforeEach(async () => {
  await clearDatabase();

  await tenant.runAsSystem(async () => {
    await Organization.create([
      { _id: ORG_A, name: "Alpha Textiles", slug: "alpha-textiles" },
      { _id: ORG_B, name: "Beta Foods", slug: "beta-foods" },
    ]);
  }, "test.setup");

  await tenant.runWithTenant(ORG_A, async () => {
    await Department.create([
      { name: "Alpha Operations", code: "OPS" },
      { name: "Alpha Quality", code: "QC" },
    ]);
  });

  await tenant.runWithTenant(ORG_B, async () => {
    await Department.create([{ name: "Beta Kitchen", code: "KITCHEN" }]);
  });
});

// ── Reads ───────────────────────────────────────────────────────────────────

test("a tenant sees only its own records", async () => {
  const alpha = await tenant.runWithTenant(ORG_A, () => Department.find({}).lean());
  const beta = await tenant.runWithTenant(ORG_B, () => Department.find({}).lean());

  assert.equal(alpha.length, 2);
  assert.equal(beta.length, 1);
  assert.ok(alpha.every((d) => d.name.startsWith("Alpha")));
  assert.equal(beta[0].name, "Beta Kitchen");
});

test("counts are scoped too", async () => {
  const alphaCount = await tenant.runWithTenant(ORG_A, () => Department.countDocuments({}));
  const betaCount = await tenant.runWithTenant(ORG_B, () => Department.countDocuments({}));

  assert.equal(alphaCount, 2);
  assert.equal(betaCount, 1);
});

test("fetching another tenant's record by id returns nothing", async () => {
  const betaDepartment = await tenant.runWithTenant(ORG_B, () => Department.findOne({}).lean());

  const seenFromAlpha = await tenant.runWithTenant(ORG_A, () =>
    Department.findById(betaDepartment._id).lean()
  );

  assert.equal(seenFromAlpha, null, "Alpha cannot read a Beta record even with its exact id");
});

test("asking for another tenant explicitly is refused, not silently rewritten", async () => {
  await assert.rejects(
    () =>
      tenant.runWithTenant(ORG_A, () =>
        Department.find({ organizationId: ORG_B }).lean()
      ),
    (err) => {
      // Reported as a 404 so the API never confirms the other tenant exists.
      assert.equal(err.code, "CROSS_TENANT_ACCESS");
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test("aggregations are scoped", async () => {
  const alphaRows = await tenant.runWithTenant(ORG_A, () =>
    Department.aggregate([{ $group: { _id: null, count: { $sum: 1 } } }])
  );
  const betaRows = await tenant.runWithTenant(ORG_B, () =>
    Department.aggregate([{ $group: { _id: null, count: { $sum: 1 } } }])
  );

  assert.equal(alphaRows[0].count, 2);
  assert.equal(betaRows[0].count, 1);
});

test("distinct is scoped", async () => {
  const codes = await tenant.runWithTenant(ORG_A, () => Department.distinct("code"));
  assert.deepEqual(codes.sort(), ["OPS", "QC"]);
});

// ── Writes ──────────────────────────────────────────────────────────────────

test("a new document is stamped with the ambient tenant", async () => {
  const created = await tenant.runWithTenant(ORG_A, () =>
    Department.create({ name: "Alpha Dispatch", code: "DISPATCH" })
  );

  assert.equal(String(created.organizationId), String(ORG_A));
});

test("a document cannot be created into another tenant", async () => {
  await assert.rejects(
    () =>
      tenant.runWithTenant(ORG_A, () =>
        Department.create({ name: "Smuggled", code: "SMUG", organizationId: ORG_B })
      ),
    (err) => err.code === "CROSS_TENANT_ACCESS"
  );
});

test("an update cannot reach another tenant's records", async () => {
  const betaDepartment = await tenant.runWithTenant(ORG_B, () => Department.findOne({}).lean());

  const result = await tenant.runWithTenant(ORG_A, () =>
    Department.updateOne({ _id: betaDepartment._id }, { $set: { name: "Hijacked" } })
  );

  assert.equal(result.matchedCount, 0, "the filter never matched Beta's record");

  const unchanged = await tenant.runWithTenant(ORG_B, () =>
    Department.findById(betaDepartment._id).lean()
  );
  assert.equal(unchanged.name, "Beta Kitchen");
});

test("updateMany cannot spill across tenants", async () => {
  await tenant.runWithTenant(ORG_A, () =>
    Department.updateMany({}, { $set: { costCentre: "CC-ALPHA" } })
  );

  const betaDepartments = await tenant.runWithTenant(ORG_B, () => Department.find({}).lean());
  assert.equal(betaDepartments[0].costCentre, "", "Beta's records were untouched");
});

test("an update payload cannot rewrite the tenant", async () => {
  const department = await tenant.runWithTenant(ORG_A, () => Department.findOne({}).lean());

  await tenant.runWithTenant(ORG_A, () =>
    Department.updateOne({ _id: department._id }, { $set: { organizationId: ORG_B, name: "Renamed" } })
  );

  const after = await tenant.runWithTenant(ORG_A, () => Department.findById(department._id).lean());
  assert.equal(after.name, "Renamed", "the legitimate part of the update applied");
  assert.equal(String(after.organizationId), String(ORG_A), "the tenant was not moved");
});

test("deletes are scoped", async () => {
  const betaDepartment = await tenant.runWithTenant(ORG_B, () => Department.findOne({}).lean());

  const result = await tenant.runWithTenant(ORG_A, () =>
    Department.deleteOne({ _id: betaDepartment._id })
  );
  assert.equal(result.deletedCount, 0);

  const stillThere = await tenant.runWithTenant(ORG_B, () => Department.countDocuments({}));
  assert.equal(stillThere, 1);
});

// ── Missing context ─────────────────────────────────────────────────────────

test("a query with no tenant context throws instead of reading everything", async () => {
  await assert.rejects(
    () => Department.find({}).lean(),
    (err) => {
      assert.equal(err.code, "TENANT_CONTEXT_MISSING");
      return true;
    }
  );
});

test("a save with no tenant context throws", async () => {
  await assert.rejects(
    () => Department.create({ name: "Orphan", code: "ORPH" }),
    (err) => err.code === "TENANT_CONTEXT_MISSING"
  );
});

test("a system context still requires an explicit opt-out", async () => {
  // This is the important one: running as system must not become an ambient
  // licence to read every tenant. The bypass has to be asked for by name.
  await assert.rejects(
    () => tenant.runAsSystem(() => Department.find({}).lean(), "test"),
    (err) => err.code === "TENANT_CONTEXT_MISSING"
  );

  const all = await tenant.runAsSystem(
    () => Department.find({}).bypassTenant().lean(),
    "test.cross-tenant"
  );
  assert.equal(all.length, 3, "the explicit bypass sees every tenant");
});

test("bypassTenant outside a system context is refused", async () => {
  await assert.rejects(
    () => tenant.runWithTenant(ORG_A, () => Department.find({}).bypassTenant().lean()),
    (err) => err.code === "TENANT_CONTEXT_MISSING"
  );
});

// ── Uniqueness ──────────────────────────────────────────────────────────────

test("the same code can exist in two tenants", async () => {
  await tenant.runWithTenant(ORG_B, () => Department.create({ name: "Beta Operations", code: "OPS" }));

  const alpha = await tenant.runWithTenant(ORG_A, () => Department.findOne({ code: "OPS" }).lean());
  const beta = await tenant.runWithTenant(ORG_B, () => Department.findOne({ code: "OPS" }).lean());

  assert.equal(alpha.name, "Alpha Operations");
  assert.equal(beta.name, "Beta Operations");
});

test("a duplicate code inside one tenant is rejected", async () => {
  await Department.syncIndexes();

  await assert.rejects(
    () => tenant.runWithTenant(ORG_A, () => Department.create({ name: "Another Ops", code: "OPS" })),
    (err) => err.code === 11000
  );
});

// ── Concurrency ─────────────────────────────────────────────────────────────

test("interleaved tenant contexts do not leak into one another", async () => {
  // AsyncLocalStorage is the mechanism; this proves it survives concurrent
  // async work, which is the case a request-scoped global variable would fail.
  const results = await Promise.all([
    tenant.runWithTenant(ORG_A, async () => {
      await new Promise((r) => setTimeout(r, 12));
      return Department.countDocuments({});
    }),
    tenant.runWithTenant(ORG_B, async () => {
      await new Promise((r) => setTimeout(r, 4));
      return Department.countDocuments({});
    }),
    tenant.runWithTenant(ORG_A, async () => {
      await new Promise((r) => setTimeout(r, 8));
      return Department.countDocuments({});
    }),
  ]);

  assert.deepEqual(results, [2, 1, 2]);
});

test("nested contexts restore the outer tenant on the way out", async () => {
  await tenant.runWithTenant(ORG_A, async () => {
    assert.equal(String(tenant.getOrganizationId()), String(ORG_A));

    await tenant.runWithTenant(ORG_B, async () => {
      assert.equal(String(tenant.getOrganizationId()), String(ORG_B));
      assert.equal(await Department.countDocuments({}), 1);
    });

    assert.equal(String(tenant.getOrganizationId()), String(ORG_A));
    assert.equal(await Department.countDocuments({}), 2);
  });
});

// ── Employee-level check ────────────────────────────────────────────────────

test("employee records are isolated, including by employee code", async () => {
  const makeEmployee = (code, firstName) => ({
    employeeCode: code,
    personal: { firstName, workEmail: `${firstName.toLowerCase()}@example.com` },
    status: "active",
  });

  await tenant.runWithTenant(ORG_A, () => Employee.create(makeEmployee("EMP0001", "Ravi")));
  await tenant.runWithTenant(ORG_B, () => Employee.create(makeEmployee("EMP0001", "Meera")));

  const alpha = await tenant.runWithTenant(ORG_A, () =>
    Employee.findOne({ employeeCode: "EMP0001" }).lean()
  );
  const beta = await tenant.runWithTenant(ORG_B, () =>
    Employee.findOne({ employeeCode: "EMP0001" }).lean()
  );

  assert.equal(alpha.personal.firstName, "Ravi");
  assert.equal(beta.personal.firstName, "Meera");
  assert.notEqual(String(alpha._id), String(beta._id));
});

test("soft-deleted records disappear from normal reads but survive", async () => {
  await tenant.runWithTenant(ORG_A, async () => {
    const department = await Department.findOne({ code: "QC" });
    await department.softDelete();

    assert.equal(await Department.countDocuments({}), 1);
    assert.equal(await Department.find({}).withDeleted().countDocuments(), 2);

    const archived = await Department.find({}).onlyDeleted().lean();
    assert.equal(archived.length, 1);
    assert.equal(archived[0].code, "QC");
  });
});
