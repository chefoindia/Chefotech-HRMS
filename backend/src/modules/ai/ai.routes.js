"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./ai.service");
const assistant = require("./aiAssistant.service");
const chatbot = require("./chatbot.service");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { ok } = require("../../core/http/response");
const { strictLimiter } = require("../../core/security/rateLimit");

/**
 * AI features, all built on one organization-supplied Gemini key.
 *
 * Two trust boundaries worth stating up front, because they shape every route
 * below:
 *
 *   1. Only `settings.manage_ai` can see, set or remove the key. Everyone else
 *      can USE what it enables (the assistant), but never touch the
 *      credential — the same split as any other integration.
 *
 *   2. AI never writes anything by itself. Every "draft" endpoint returns a
 *      proposal for a human to review; applying it goes through the ordinary,
 *      permission-checked endpoint for that resource. An AI-drafted leave
 *      policy is exactly as reviewable, and exactly as gated, as one a person
 *      typed by hand.
 */

const router = express.Router();
router.use(authenticate());

router.get(
  "/status",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => ok(res, await service.status()))
);

router.get(
  "/models",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => ok(res, service.AVAILABLE_MODELS))
);

router.put(
  "/credential",
  requirePermission("settings.manage_ai"),
  strictLimiter,
  validate({
    body: z.object({
      apiKey: z.string().trim().min(20).max(200),
      model: z.string().max(60).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.saveKey(req.body, req.auth.userId)))
);

router.patch(
  "/credential/enabled",
  requirePermission("settings.manage_ai"),
  validate({ body: z.object({ isEnabled: z.boolean() }) }),
  asyncHandler(async (req, res) => ok(res, await service.setEnabled(req.body.isEnabled)))
);

router.delete(
  "/credential",
  requirePermission("settings.manage_ai"),
  asyncHandler(async (req, res) => {
    await service.removeKey();
    return ok(res, { removed: true });
  })
);

/**
 * The setup assistant. Open to anyone signed in — no special permission,
 * because its whole job is unblocking someone who is already looking at a
 * screen they are allowed to see. If AI is not configured it fails with
 * AI_NOT_CONFIGURED, which the frontend reads to fall back to the ordinary,
 * non-AI help content rather than showing a dead end.
 */
router.post(
  "/assistant",
  strictLimiter,
  validate({
    body: z.object({
      question: z.string().trim().min(1).max(1000),
      screen: z.string().trim().max(80).optional(),
      fieldLabel: z.string().trim().max(120).optional(),
      fieldHint: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await assistant.answer(req.body)))
);

/**
 * "Fill this for me" — turns one plain-English sentence into a structured
 * leave policy for review. Gated on the SAME permission that would be needed
 * to save the policy for real, so asking the AI to draft one is never a way
 * around the access control on the thing it drafts.
 */
router.post(
  "/draft/leave-policy",
  requirePermission("leave.manage_policies"),
  strictLimiter,
  validate({ body: z.object({ instruction: z.string().trim().min(5).max(1000) }) }),
  asyncHandler(async (req, res) => ok(res, await assistant.draftLeavePolicy(req.body.instruction)))
);

/**
 * The always-available setup guide. Open to anyone signed in, same reasoning
 * as /assistant — every action it can hand back is already filtered to what
 * the caller's own permissions allow, so this is never a way to discover or
 * reach a screen the caller could not already navigate to directly.
 */
router.post(
  "/chat",
  strictLimiter,
  validate({
    body: z.object({
      message: z.string().trim().min(1).max(1000),
      history: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            text: z.string().max(4000),
          })
        )
        .max(40)
        .optional(),
      route: z.string().max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await chatbot.chat(req.body, { permissions: req.auth.permissions }))
  )
);

module.exports = router;
