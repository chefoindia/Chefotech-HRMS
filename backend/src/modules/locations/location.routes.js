"use strict";

const express = require("express");
const { z } = require("zod");
const Location = require("./location.model");
const { createCrudService, createCrudController } = require("../../shared/crudFactory");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery } = require("../../core/validation/common");
const { AppError } = require("../../core/errors/AppError");
const { isValidTimezone } = require("../../shared/datetime");
const organizationService = require("../organizations/organization.service");

const AddressSchema = z.object({
  line1: z.string().max(120).optional(),
  line2: z.string().max(120).optional(),
  city: z.string().max(60).optional(),
  state: z.string().max(60).optional(),
  country: z.string().max(60).optional(),
  postalCode: z.string().max(20).optional(),
});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(20),
  type: z
    .enum(["head_office", "branch", "factory", "warehouse", "site", "remote", "client_site"])
    .optional(),
  address: AddressSchema.optional(),
  timezone: z
    .string()
    .refine(isValidTimezone, "Not a recognised timezone")
    .nullable()
    .optional(),
  holidayCalendarId: objectId().nullable().optional(),
  geo: z
    .object({
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
      radiusMetres: z.number().int().min(20).max(5000).optional(),
    })
    .optional(),
  contactPerson: z.string().max(80).optional(),
  contactPhone: z.string().max(30).optional(),
  isActive: z.boolean().optional(),
});
const UpdateSchema = CreateSchema.partial();

const service = createCrudService({
  model: Location,
  entityType: "Location",
  searchFields: ["name", "code", "address.city"],
  populate: { path: "holidayCalendarId", select: "name year" },
  async afterCreate() {
    await organizationService.markStepCompleteIfPending("locations");
  },
  async beforeDelete(doc) {
    const Employee = require("../employees/employee.model");
    const inUse = await Employee.countDocuments({
      "employment.locationId": doc._id,
      status: { $nin: ["resigned", "terminated", "inactive"] },
    });
    if (inUse) {
      throw AppError.conflict(
        `${inUse} active ${inUse === 1 ? "employee works" : "employees work"} from this location. Move them first.`
      );
    }
  },
});

const controller = createCrudController(service);
const router = express.Router();
router.use(authenticate());

router.get(
  "/",
  requirePermission("location.view"),
  validate({ query: listQuery({ type: z.string().optional() }) }),
  asyncHandler(controller.list)
);
router.get(
  "/:id",
  requirePermission("location.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(controller.get)
);
router.post(
  "/",
  requirePermission("location.manage"),
  validate({ body: CreateSchema }),
  asyncHandler(controller.create)
);
router.patch(
  "/:id",
  requirePermission("location.manage"),
  validate({ params: objectIdParam(), body: UpdateSchema }),
  asyncHandler(controller.update)
);
router.delete(
  "/:id",
  requirePermission("location.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(controller.remove)
);

module.exports = router;
