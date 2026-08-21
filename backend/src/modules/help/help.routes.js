"use strict";

const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const { TOURS, TOURS_BY_ID } = require("./tours");
const intents = require("./helpIntents");
const { authenticate } = require("../auth/authenticate");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { ok } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");
const settings = require("../../core/settings/settings.service");
const aiAssistant = require("../ai/aiAssistant.service");
const { logger } = require("../../config/logger");

/**
 * The help and guided-tour API.
 *
 * Tours are filtered by the caller's permissions, so the assistant never
 * offers to walk someone through a screen they cannot open.
 */

/** Per-user tour progress, so a half-finished tour can be resumed. */
const tourProgressSchema = createTenantSchema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tourId: { type: String, required: true },
    status: {
      type: String,
      enum: ["started", "in_progress", "completed", "abandoned"],
      default: "started",
    },
    currentStepIndex: { type: Number, default: 0 },
    /** Answers the user gave, so a resumed tour can prefill the form. */
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { softDelete: false }
);
tenantUnique(tourProgressSchema, ["userId", "tourId"]);

const TourProgress =
  mongoose.models.TourProgress || mongoose.model("TourProgress", tourProgressSchema);

const router = express.Router();
router.use(authenticate());

function visibleTours(permissions) {
  return TOURS.filter((t) => !t.permission || permissions.includes(t.permission));
}

router.get(
  "/tours",
  asyncHandler(async (req, res) => {
    const progress = await TourProgress.find({ userId: req.auth.userId }).lean();
    const byTour = Object.fromEntries(progress.map((p) => [p.tourId, p]));

    return ok(
      res,
      visibleTours(req.auth.permissions).map((tour) => ({
        id: tour.id,
        title: tour.title,
        description: tour.description,
        category: tour.category,
        stepCount: tour.steps.length,
        estimatedMinutes: tour.estimatedMinutes,
        status: (byTour[tour.id] && byTour[tour.id].status) || "not_started",
        currentStepIndex: (byTour[tour.id] && byTour[tour.id].currentStepIndex) || 0,
      }))
    );
  })
);

router.get(
  "/tours/:id",
  validate({ params: z.object({ id: z.string().max(60) }) }),
  asyncHandler(async (req, res) => {
    const tour = TOURS_BY_ID[req.params.id];
    if (!tour) throw AppError.notFound("Tour");

    if (tour.permission && !req.auth.permissions.includes(tour.permission)) {
      throw AppError.forbidden("You do not have access to the screens this walkthrough uses.");
    }

    const progress = await TourProgress.findOne({
      userId: req.auth.userId,
      tourId: tour.id,
    }).lean();

    return ok(res, {
      ...tour,
      progress: progress
        ? { status: progress.status, currentStepIndex: progress.currentStepIndex, answers: progress.answers }
        : null,
    });
  })
);

/** Record progress so a tour survives a reload or a change of mind. */
router.post(
  "/tours/:id/progress",
  validate({
    params: z.object({ id: z.string().max(60) }),
    body: z.object({
      status: z.enum(["started", "in_progress", "completed", "abandoned"]),
      currentStepIndex: z.number().int().min(0).max(100).optional(),
      answers: z.record(z.any()).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!TOURS_BY_ID[req.params.id]) throw AppError.notFound("Tour");

    const update = {
      status: req.body.status,
      currentStepIndex: req.body.currentStepIndex || 0,
      userId: req.auth.userId,
      tourId: req.params.id,
    };
    if (req.body.answers) update.answers = req.body.answers;
    if (req.body.status === "completed") update.completedAt = new Date();

    const progress = await TourProgress.findOneAndUpdate(
      { userId: req.auth.userId, tourId: req.params.id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return ok(res, progress);
  })
);

/**
 * The assistant. Free text in, an answer and a runnable walkthrough out.
 *
 * Answers come from the local intent index — no external service, so this
 * keeps working in an air-gapped deployment and never leaks a customer's
 * question to a third party.
 */
router.post(
  "/ask",
  validate({ body: z.object({ query: z.string().trim().min(1).max(300) }) }),
  asyncHandler(async (req, res) => {
    const enabled = await settings.get("help.assistant_enabled").catch(() => true);
    if (!enabled) {
      return ok(res, { enabled: false, matches: [], message: "The help assistant is turned off for this organization." });
    }

    const matches = intents.match(req.body.query, { permissions: req.auth.permissions });
    const confident = Boolean(matches[0] && matches[0].score >= 40);

    // The local matcher only ever recognises the handful of things it was
    // taught. Below its confidence threshold, and only there, the question is
    // handed to the org's own Gemini key if one is configured — this is the
    // "structure ready for a model to sit in front of it" moment. A tenant
    // with no key configured, or an AI call that fails for any reason, still
    // gets the exact static fallback they got before this existed: help must
    // never depend on AI to avoid a dead end, only to do better than one.
    let aiAnswer = null;
    if (!confident) {
      try {
        const result = await aiAssistant.answer({ question: req.body.query });
        aiAnswer = result.answer;
      } catch (err) {
        // AI_NOT_CONFIGURED is the ordinary, expected case for most tenants —
        // not worth a log line. Anything else (a real Gemini failure) is.
        if (err?.code !== "AI_NOT_CONFIGURED") {
          logger.warn({ err: err?.message }, "AI help fallback failed");
        }
      }
    }

    return ok(res, {
      enabled: true,
      query: req.body.query,
      matches,
      best: matches[0] || null,
      // Below this the match is a guess, and saying so is better than
      // confidently walking someone through the wrong screen.
      confident,
      aiAnswer,
      fallback:
        matches.length === 0 && !aiAnswer
          ? "I could not find a walkthrough for that. Try naming the thing you want to change — for example \"leave policy\", \"half day\", \"biometric\" or \"payslip\"."
          : null,
    });
  })
);

router.get(
  "/suggestions",
  asyncHandler(async (req, res) => ok(res, intents.suggestions(req.auth.permissions)))
);

/** Search across tours and intents, for the help centre. */
router.get(
  "/search",
  validate({ query: z.object({ q: z.string().max(200).optional() }) }),
  asyncHandler(async (req, res) => {
    const query = req.query.q;
    if (!query) {
      return ok(res, { tours: visibleTours(req.auth.permissions), articles: [] });
    }

    const matches = intents.match(query, { permissions: req.auth.permissions, limit: 10 });
    const normalised = intents.normalise(query);

    const tours = visibleTours(req.auth.permissions).filter(
      (t) =>
        intents.normalise(t.title).includes(normalised) ||
        intents.normalise(t.description).includes(normalised) ||
        intents.normalise(t.category).includes(normalised)
    );

    return ok(res, { tours, articles: matches });
  })
);

module.exports = router;
