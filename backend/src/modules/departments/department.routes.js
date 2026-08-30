"use strict";

const express = require("express");
const { z } = require("zod");
const Department = require("./department.model");
const { createCrudService, createCrudController } = require("../../shared/crudFactory");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery } = require("../../core/validation/common");
const { AppError } = require("../../core/errors/AppError");
const { ok } = require("../../core/http/response");
const organizationService = require("../organizations/organization.service");

const {
  CreateSchema,
  UpdateSchema,
} = require("./department.schema");

/** Recompute the ancestor path, refusing to create a cycle. */
async function resolveHierarchy(parentId, selfId) {
  if (!parentId) return { ancestorIds: [], depth: 0 };

  const parent = await Department.findById(parentId).lean();
  if (!parent) throw AppError.badRequest("The selected parent department does not exist.");

  if (selfId && (String(parentId) === String(selfId) ||
      (parent.ancestorIds || []).some((a) => String(a) === String(selfId)))) {
    throw AppError.badRequest("A department cannot sit underneath itself.");
  }

  return {
    ancestorIds: [...(parent.ancestorIds || []), parent._id],
    depth: (parent.depth || 0) + 1,
  };
}

const service = createCrudService({
  model: Department,
  entityType: "Department",
  searchFields: ["name", "code"],
  populate: { path: "headEmployeeId", select: "employeeCode firstName lastName" },
  async beforeCreate(data) {
    return { ...data, ...(await resolveHierarchy(data.parentId, null)) };
  },
  async afterCreate() {
    await organizationService.markStepCompleteIfPending("departments");
  },
  async beforeUpdate(data, doc) {
    if (data.parentId === undefined) return data;
    return { ...data, ...(await resolveHierarchy(data.parentId, doc._id)) };
  },
  async beforeDelete(doc) {
    const children = await Department.countDocuments({ parentId: doc._id });
    if (children) {
      throw AppError.conflict(
        "Move or archive the sub-departments before archiving this one."
      );
    }
    const Employee = require("../employees/employee.model");
    const staffed = await Employee.countDocuments({
      "employment.departmentId": doc._id,
      status: { $nin: ["resigned", "terminated", "inactive"] },
    });
    if (staffed) {
      throw AppError.conflict(
        `${staffed} active ${staffed === 1 ? "employee is" : "employees are"} still in this department. Move them first.`
      );
    }
  },
});

const controller = createCrudController(service);
const router = express.Router();
router.use(authenticate());

/** The whole tree in one call — the org-chart view needs it nested, not paged. */
router.get(
  "/tree",
  requirePermission("department.view"),
  asyncHandler(async (_req, res) => {
    const rows = await Department.find({ isActive: true }).sort({ name: 1 }).lean();
    const byId = new Map(rows.map((r) => [String(r._id), { ...r, id: String(r._id), children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
      const parent = node.parentId && byId.get(String(node.parentId));
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return ok(res, roots);
  })
);

router.get(
  "/",
  requirePermission("department.view"),
  validate({ query: listQuery({ parentId: z.string().optional() }) }),
  asyncHandler(controller.list)
);

router.get(
  "/:id",
  requirePermission("department.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(controller.get)
);

router.post(
  "/",
  requirePermission("department.manage"),
  validate({ body: CreateSchema }),
  asyncHandler(controller.create)
);

router.patch(
  "/:id",
  requirePermission("department.manage"),
  validate({ params: objectIdParam(), body: UpdateSchema }),
  asyncHandler(controller.update)
);

router.delete(
  "/:id",
  requirePermission("department.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(controller.remove)
);

module.exports = router;
