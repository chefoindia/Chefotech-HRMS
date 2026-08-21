"use strict";

const mongoose = require("mongoose");

/**
 * A message from the public contact form.
 *
 * Deliberately NOT tenant-scoped. Almost every other model in this system
 * carries the tenant plugin, which refuses to read or write without an
 * organisation in context — correct everywhere else, and wrong here, because
 * the whole point of this record is that it arrives from someone who does not
 * have an account yet.
 *
 * Handled by the platform team through the super-admin panel rather than by
 * any tenant.
 */

const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    company: { type: String, default: null, trim: true, maxlength: 160 },
    phone: { type: String, default: null, trim: true, maxlength: 40 },
    employeeCount: { type: Number, default: null, min: 0 },

    subject: {
      type: String,
      enum: ["sales", "demo", "support", "partnership", "privacy", "other"],
      default: "sales",
      index: true,
    },
    message: { type: String, required: true, maxlength: 5000 },

    /** Whether they ticked the marketing-contact box. Consent has to be evidenced. */
    consent: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ["new", "in_progress", "resolved", "spam"],
      default: "new",
      index: true,
    },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    handledAt: { type: Date, default: null },
    internalNote: { type: String, default: null, maxlength: 2000 },

    /**
     * Kept only to spot a flood from one source. Both are personal data under
     * most regimes, which is why they are pruned with the record rather than
     * copied anywhere else.
     */
    sourceIp: { type: String, default: null, maxlength: 64 },
    userAgent: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: true }
);

// The triage view: newest unhandled first.
contactMessageSchema.index({ status: 1, createdAt: -1 });

/**
 * Enquiries are not kept indefinitely. Two years is long enough to recognise a
 * returning prospect and short enough that we are not sitting on a growing
 * pile of other people's contact details for no stated purpose.
 */
contactMessageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 365 * 2, name: "contact_retention" }
);

module.exports =
  mongoose.models.ContactMessage || mongoose.model("ContactMessage", contactMessageSchema);
