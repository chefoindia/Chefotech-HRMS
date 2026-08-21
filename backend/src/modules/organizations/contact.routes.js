"use strict";

const express = require("express");
const { z } = require("zod");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { ok } = require("../../core/http/response");
const { validate } = require("../../core/validation/validate");
const { strictLimiter } = require("../../core/security/rateLimit");
const { AppError } = require("../../core/errors/AppError");
const mailer = require("../notifications/mailer");
const ContactMessage = require("./contactMessage.model");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");

/**
 * The public contact and demo-request endpoint.
 *
 * Unauthenticated and therefore a target: anything reachable without a login
 * gets scraped and abused within days of going live. Three defences, in order
 * of how much they cost a legitimate visitor:
 *
 *   1. A honeypot field that real people never fill in and bots usually do.
 *   2. A minimum time-on-form, because a human cannot read and complete a
 *      form in under two seconds.
 *   3. A strict rate limit per IP.
 *
 * None of these is a CAPTCHA. A CAPTCHA is a real cost to every honest
 * visitor, and the volume this endpoint attracts does not justify one.
 *
 * The message is persisted BEFORE the email is attempted. Mail delivery fails
 * for reasons outside our control, and losing a sales enquiry because an SMTP
 * host was briefly unreachable is a worse failure than a delayed notification.
 */

const router = express.Router();

const SUBJECTS = ["sales", "demo", "support", "partnership", "privacy", "other"];

const contactSchema = z.object({
  name: z.string().trim().min(2, "Please tell us your name.").max(120),
  email: z.string().trim().toLowerCase().email("That does not look like an email address."),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  employeeCount: z.coerce.number().int().min(0).max(1_000_000).optional(),
  subject: z.enum(SUBJECTS).default("sales"),
  message: z
    .string()
    .trim()
    .min(10, "Please give us a little more detail — at least a sentence.")
    .max(5000),
  /** Honeypot. Hidden from people; only automation fills it in. */
  website: z.string().max(200).optional().or(z.literal("")),
  /** Milliseconds the form was open, sent by the client. */
  elapsedMs: z.coerce.number().int().min(0).optional(),
  consent: z.coerce.boolean().optional(),
});

/** Below this, the submission was not typed by a person. */
const MIN_FILL_MS = 2000;

router.post(
  "/",
  strictLimiter,
  validate({ body: contactSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body;

    // Silent success for the honeypot. Telling a bot why it was rejected just
    // tells whoever wrote it what to change.
    if (body.website) {
      logger.info({ email: body.email }, "Contact honeypot triggered");
      return ok(res, { received: true });
    }

    if (typeof body.elapsedMs === "number" && body.elapsedMs < MIN_FILL_MS) {
      throw AppError.badRequest("That was submitted a little too quickly. Please try again.");
    }

    const message = await ContactMessage.create({
      name: body.name,
      email: body.email,
      company: body.company || null,
      phone: body.phone || null,
      employeeCount: body.employeeCount ?? null,
      subject: body.subject,
      message: body.message,
      consent: Boolean(body.consent),
      // Useful for spotting a flood from one source; not used for anything else.
      sourceIp: req.ip,
      userAgent: String(req.get("user-agent") || "").slice(0, 300),
      status: "new",
    });

    // Best effort, and deliberately after the write.
    const inbox =
      body.subject === "privacy"
        ? env.contact.privacyInbox
        : body.subject === "support"
          ? env.contact.supportInbox
          : env.contact.salesInbox;

    mailer
      .send({
        to: inbox,
        subject: `[${body.subject}] Enquiry from ${body.name}${body.company ? ` at ${body.company}` : ""}`,
        text: [
          `Name: ${body.name}`,
          `Email: ${body.email}`,
          body.company ? `Company: ${body.company}` : null,
          body.phone ? `Phone: ${body.phone}` : null,
          body.employeeCount ? `Employees: ${body.employeeCount}` : null,
          "",
          body.message,
          "",
          `Reference: ${message._id}`,
        ]
          .filter(Boolean)
          .join("\n"),
        replyTo: body.email,
      })
      .catch((err) =>
        // The enquiry is safely stored; this is a notification failure, not a
        // lost message, so it must not fail the request.
        logger.error({ err, messageId: String(message._id) }, "Contact notification failed")
      );

    return ok(res, {
      received: true,
      reference: String(message._id).slice(-8).toUpperCase(),
    });
  })
);

module.exports = router;
