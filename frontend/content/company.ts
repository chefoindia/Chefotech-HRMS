/**
 * Company identity, in one place.
 *
 * Legal documents, the marketing site, support pages and outbound email all
 * need the same handful of facts — the registered entity, the addresses people
 * write to, the response times promised. Repeating them across twenty files
 * guarantees they drift, and a privacy policy that names a different entity
 * than the terms is precisely the kind of inconsistency a regulator or a
 * customer's procurement team notices first.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  BEFORE GOING LIVE, replace every value marked TODO with the real details
 *  of the registered company. The documents that read from this file are
 *  drafted to be complete and honest, but they are not legal advice and have
 *  not been reviewed by a lawyer — have counsel review them against the
 *  jurisdictions you actually sell into.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const COMPANY = {
  /** Trading name, used throughout the product and the marketing site. */
  name: "Chefotech",
  product: "Chefotech HRMS",

  /** TODO: the registered legal entity, exactly as incorporated. */
  legalName: "Chefotech Technologies Private Limited",
  /** TODO: company identification number from the registrar. */
  registrationNumber: "[COMPANY REGISTRATION NUMBER]",
  /** TODO: tax registration, where one applies. */
  taxId: "[GSTIN / TAX REGISTRATION NUMBER]",

  address: {
    /** TODO: the registered office address on file with the registrar. */
    lines: ["[REGISTERED OFFICE ADDRESS LINE 1]", "[ADDRESS LINE 2]"],
    city: "[CITY]",
    state: "[STATE]",
    postcode: "[POSTCODE]",
    country: "India",
  },

  email: {
    support: "support@chefotech.com",
    sales: "sales@chefotech.com",
    privacy: "privacy@chefotech.com",
    security: "security@chefotech.com",
    legal: "legal@chefotech.com",
    grievance: "grievance@chefotech.com",
    billing: "billing@chefotech.com",
  },

  /** TODO: a monitored telephone number, or remove the field entirely. */
  phone: "[SUPPORT TELEPHONE NUMBER]",

  /**
   * India's DPDP Act and IT Rules both require a named grievance officer with
   * published contact details, and several other regimes expect an
   * identifiable privacy contact. A generic inbox alone does not satisfy that.
   */
  grievanceOfficer: {
    name: "[GRIEVANCE OFFICER NAME]",
    title: "Grievance Officer",
    email: "grievance@chefotech.com",
  },
  dataProtectionOfficer: {
    name: "[DATA PROTECTION OFFICER NAME]",
    title: "Data Protection Officer",
    email: "privacy@chefotech.com",
  },

  /** The law and courts the customer contract is written against. */
  governingLaw: "the laws of India",
  jurisdiction: "the courts at [CITY], India",

  supportHours: "Monday to Friday, 9:30am to 6:30pm IST, excluding public holidays",
  domain: "chefotech.com",
} as const;

export function formattedAddress(): string {
  const { lines, city, state, postcode, country } = COMPANY.address;
  return [...lines, `${city}, ${state} ${postcode}`, country].filter(Boolean).join(", ");
}

/**
 * Documents state the date they last changed rather than today's date. A
 * policy that appears to have been revised this morning, every morning, tells
 * a reader nothing about whether the terms they agreed to still hold.
 */
export const LEGAL_LAST_UPDATED = "2026-08-21";
