"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../tenancy/baseSchema");

/**
 * The registry of every byte the platform stores.
 *
 * The Drive file id is an implementation detail that lives here and is never
 * sent to a browser for a private file. Clients address files by this
 * document's own id, and the proxy route resolves it — inside the tenant
 * context — to a provider id.
 */
const storedFileSchema = createTenantSchema({
  // Every provider in storage.service's PROVIDERS map. This list was missing
  // cloudinary and firebase, so an upload routed to either failed Mongoose
  // validation on the registry row AFTER the bytes had been stored — every
  // avatar, logo and document upload on a Firebase-backed deployment
  // returned a 500, with an orphaned file left behind each time.
  provider: { type: String, enum: ["drive", "local", "cloudinary", "firebase"], required: true },
  providerId: { type: String, required: true },

  fileName: { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  checksum: { type: String, default: null },

  category: {
    type: String,
    enum: [
      "branding",
      "avatar",
      "employee-document",
      "company-document",
      "payslip",
      "generated-document",
      "import",
      "export",
      "attachment",
      "other",
    ],
    default: "other",
    index: true,
  },

  visibility: {
    type: String,
    enum: ["public", "private"],
    default: "private",
    index: true,
  },

  // What this file is attached to. Access checks are delegated to the owning
  // module: an employee document is readable by whoever may read that
  // employee, which is a rule the employee module owns, not this one.
  ownerType: { type: String, default: null, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
});

storedFileSchema.index({ organizationId: 1, ownerType: 1, ownerId: 1 });
storedFileSchema.index({ organizationId: 1, category: 1, createdAt: -1 });

module.exports = mongoose.model("StoredFile", storedFileSchema);
