"use strict";

const express = require("express");
const { z } = require("zod");
const Designation = require("./designation.model");
const { createCrudService, createCrudController } = require("../../shared/crudFactory");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery } = require("../../core/validation/common");
const { AppError } = require("../../core/errors/AppError");
const organizationService = require("../organizations/organization.service");

const {
  CreateSchema,
  UpdateSchema,
} = require("./designation.schema");

const service = createCrudService({
  model: Designation,
  entityType: "Designation",
  searchFields: ["name", "code", "grade"],
  defaultSort: "level",
  allowedSort: ["name", "level", "grade", "createdAt"],
  populate: { path: "departmentId", select: "name code" },
  buildFilter: (query) => (query.departmentId ? { departmentId: query.departmentId } : {}),
  async afterCreate() {
    await organizationService.markStepCompleteIfPending("designations");
  },
  async beforeDelete(doc) {
    const Employee = require("../employees/employee.model");
    const inUse = await Employee.countDocuments({
      "employment.designationId": doc._id,
      status: { $nin: ["resigned", "terminated", "inactive"] },
    });
    if (inUse) {
      throw AppError.conflict(
        `${inUse} active ${inUse === 1 ? "employee holds" : "employees hold"} this designation. Reassign them first.`
      );
    }
  },
});

const controller = createCrudController(service);
const router = express.Router();
router.use(authenticate());

router.get(
  "/",
  requirePermission("designation.view"),
  validate({ query: listQuery({ departmentId: z.string().optional() }) }),
  asyncHandler(controller.list)
);
router.get(
  "/:id",
  requirePermission("designation.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(controller.get)
);
router.post(
  "/",
  requirePermission("designation.manage"),
  validate({ body: CreateSchema }),
  asyncHandler(controller.create)
);
router.patch(
  "/:id",
  requirePermission("designation.manage"),
  validate({ params: objectIdParam(), body: UpdateSchema }),
  asyncHandler(controller.update)
);
router.delete(
  "/:id",
  requirePermission("designation.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(controller.remove)
);

module.exports = router;
