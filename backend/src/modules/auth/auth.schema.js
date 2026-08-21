"use strict";

const { z } = require("zod");
const { email, password, objectId, phone } = require("../../core/validation/common");

const RegisterSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(60),
  lastName: z.string().trim().max(60).optional().default(""),
  email: email(),
  password: password(),
  companyName: z.string().trim().min(2, "Enter your company name").max(120),
  phone: phone().optional(),
  timezone: z.string().optional(),
  country: z.string().optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "You need to accept the terms to continue" }),
  }),
});

const LoginSchema = z.object({
  email: email(),
  password: z.string().min(1, "Enter your password").max(128),
  organizationId: objectId().optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

const ForgotPasswordSchema = z.object({ email: email() });

const ResetPasswordSchema = z.object({
  token: z.string().min(10),
  password: password(),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password(),
});

const AcceptInvitationSchema = z.object({
  token: z.string().min(10),
  password: password(),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
});

const VerifyEmailSchema = z.object({ token: z.string().min(10) });

const SwitchOrganizationSchema = z.object({ organizationId: objectId() });

module.exports = {
  RegisterSchema,
  LoginSchema,
  RefreshSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
  AcceptInvitationSchema,
  VerifyEmailSchema,
  SwitchOrganizationSchema,
};
