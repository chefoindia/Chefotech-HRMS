"use strict";

const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A tenant's override of a built-in template. Only customised templates are
 * stored, so a platform update to the default copy reaches every organization
 * that has not rewritten it.
 */
const emailTemplateSchema = createTenantSchema({
  templateKey: { type: String, required: true },
  subject: { type: String, default: null },
  title: { type: String, default: null },
  body: { type: String, default: null },
  actionUrl: { type: String, default: null },
  channels: { type: [String], default: null },
  enabled: { type: Boolean, default: true },
  isHtml: { type: Boolean, default: false },
});

tenantUnique(emailTemplateSchema, "templateKey");

module.exports = require("mongoose").model("EmailTemplate", emailTemplateSchema);
