"use strict";

const nodemailer = require("nodemailer");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../../core/errors/AppError");

/**
 * Outbound mail, over Brevo's HTTP API or SMTP.
 *
 * Two transports, chosen by `MAIL_DRIVER` and defaulting to Brevo whenever an
 * API key is set. The HTTP API is the one that works in practice on managed
 * hosts: Render, Fly and most container platforms block outbound port 587, so
 * an SMTP-only mailer fails there in a way that looks like a hang rather than
 * a misconfiguration.
 *
 * When mail is disabled (the default in development and tests) messages are
 * logged instead of sent, and the send still "succeeds" — a developer running
 * the platform without credentials should be able to complete a password reset
 * flow by reading the log, not hit a 500.
 */

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

let transport = null;
const outbox = []; // dev/test only, capped

function getTransport() {
  if (!env.mail.enabled) return null;
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure,
    auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
  });
  return transport;
}

/** Minimal, safe HTML wrapper honouring the organization's brand colour. */
function wrapHtml({ title, body, branding = {}, companyName }) {
  const accent = branding.emailHeaderColor || branding.primaryColor || "#4F46E5";
  const logo = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(companyName || "")}" style="max-height:40px;max-width:180px" />`
    : `<span style="color:#fff;font-size:18px;font-weight:600">${escapeHtml(companyName || "Chefotech HRMS")}</span>`;

  const paragraphs = String(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;color:#334155">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:${escapeHtml(accent)};padding:20px 24px">${logo}</td></tr>
      <tr><td style="padding:28px 24px">
        <h1 style="margin:0 0 16px;font-size:19px;color:#0f172a">${escapeHtml(title || "")}</h1>
        ${paragraphs}
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">
        ${escapeHtml(branding.emailFooterText || "")}
        ${branding.showPoweredBy === false ? "" : "<div style=\"margin-top:6px\">Powered by Chefotech</div>"}
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Split "Name <a@b.com>" into the pair Brevo's API wants.
 *
 * MAIL_FROM is conventionally written in that combined form, and Brevo
 * rejects the whole request if `sender.email` is not a bare address.
 */
function parseAddress(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].replace(/^"|"$/g, "") || undefined, email: match[2].trim() };
  return { email: raw };
}

/** Brevo takes a list of recipients; callers pass one address or several. */
function recipientList(to) {
  const values = Array.isArray(to) ? to : String(to || "").split(",");
  return values
    .map((value) => parseAddress(value))
    .filter((entry) => entry.email);
}

async function sendViaBrevo({ to, subject, text, html, replyTo }) {
  const apiKey = env.mail.brevo.apiKey;
  if (!apiKey) {
    throw new AppError("MAIL_ERROR", {
      message: "Email is not configured. Set BREVO_API_KEY, or set MAIL_DRIVER=smtp.",
    });
  }

  const payload = {
    sender: parseAddress(env.mail.from),
    to: recipientList(to),
    subject,
    htmlContent: html || undefined,
    textContent: text || undefined,
  };
  if (replyTo) payload.replyTo = parseAddress(replyTo);

  const response = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    // The API key is in scope here; log the reason, never the credential.
    logger.error(
      { status: response.status, reason: body?.message, code: body?.code },
      "Brevo rejected the message"
    );
    throw new AppError("MAIL_ERROR", {
      message: body?.message || "The email could not be sent.",
    });
  }

  return { delivered: true, messageId: body.messageId || null };
}

async function sendViaSmtp(message) {
  const tx = getTransport();
  const info = await tx.sendMail(message);
  return { delivered: true, messageId: info.messageId };
}

async function send({ to, subject, text, html, replyTo }) {
  const message = {
    from: env.mail.from,
    to,
    subject,
    text,
    html,
    replyTo,
  };

  if (!env.mail.enabled) {
    // In development the outbox is the point: a developer without SMTP or a
    // Brevo key can still walk through a password reset by reading the log.
    //
    // In PRODUCTION it is a trap, and it is the bug this whole area had.
    // Nothing anywhere checks the `delivered` / `simulated` flags — grep the
    // modules, there is not one caller — so a swallowed send reads as a
    // complete success all the way back up: the reset token is issued, the
    // audit log records that the mail went out, and the person is told to
    // check their inbox for something that was never sent. MAIL_ENABLED
    // simply being absent (it defaults to false) is enough to do that to
    // every password reset, invitation and payslip notice in the system,
    // and it does it silently, at info level.
    //
    // Refusing loudly is the honest failure: the request 502s, the caller
    // sees a real error, and the cause names itself.
    if (env.isProd) {
      logger.error(
        { to, subject },
        "Refusing to silently drop an email in production — MAIL_ENABLED is not on"
      );
      throw new AppError("MAIL_ERROR", {
        message:
          "Email is switched off on this server, so nothing was sent. Set MAIL_ENABLED=true and configure a mail provider.",
      });
    }

    outbox.push({ ...message, at: new Date() });
    if (outbox.length > 100) outbox.shift();
    logger.info({ to, subject }, "Email not sent (mail disabled); captured in the dev outbox");
    return { delivered: false, simulated: true };
  }

  const result =
    env.mail.driver === "brevo" ? await sendViaBrevo(message) : await sendViaSmtp(message);

  logger.info(
    { to, subject, messageId: result.messageId, driver: env.mail.driver },
    "Email sent"
  );
  return result;
}

/** Dev affordance: read what would have been sent. */
function devOutbox() {
  return [...outbox].reverse();
}

async function verify() {
  if (!env.mail.enabled) return { ok: true, simulated: true };

  if (env.mail.driver === "brevo") {
    if (!env.mail.brevo.apiKey) return { ok: false, reason: "BREVO_API_KEY is not set" };
    try {
      // The account endpoint is the cheapest call that proves the key works.
      const response = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": env.mail.brevo.apiKey, Accept: "application/json" },
      });
      if (response.ok) return { ok: true, driver: "brevo" };
      const body = await response.json().catch(() => ({}));
      return { ok: false, reason: body?.message || `HTTP ${response.status}` };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  const tx = getTransport();
  if (!tx) return { ok: true, simulated: true };
  try {
    await tx.verify();
    return { ok: true, driver: "smtp" };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { send, wrapHtml, devOutbox, verify, escapeHtml, parseAddress, recipientList };
