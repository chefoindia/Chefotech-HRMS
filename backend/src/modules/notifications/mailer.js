"use strict";

const nodemailer = require("nodemailer");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");

/**
 * SMTP transport.
 *
 * When mail is disabled (the default in development and tests) messages are
 * logged instead of sent, and the send still "succeeds" — a developer running
 * the platform without SMTP credentials should be able to complete a password
 * reset flow by reading the log, not hit a 500.
 */

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

async function send({ to, subject, text, html, replyTo }) {
  const message = {
    from: env.mail.from,
    to,
    subject,
    text,
    html,
    replyTo,
  };

  const tx = getTransport();
  if (!tx) {
    outbox.push({ ...message, at: new Date() });
    if (outbox.length > 100) outbox.shift();
    logger.info({ to, subject }, "Email not sent (mail disabled); captured in the dev outbox");
    return { delivered: false, simulated: true };
  }

  const info = await tx.sendMail(message);
  logger.info({ to, subject, messageId: info.messageId }, "Email sent");
  return { delivered: true, messageId: info.messageId };
}

/** Dev affordance: read what would have been sent. */
function devOutbox() {
  return [...outbox].reverse();
}

async function verify() {
  const tx = getTransport();
  if (!tx) return { ok: true, simulated: true };
  try {
    await tx.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { send, wrapHtml, devOutbox, verify, escapeHtml };
