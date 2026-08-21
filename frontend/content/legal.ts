import { COMPANY, formattedAddress, LEGAL_LAST_UPDATED } from "./company";

/**
 * The legal documents, as data.
 *
 * These are drafted specifically for what this product actually does: a
 * multi-tenant HRMS where the customer is the controller of their employees'
 * personal data and Chefotech is the processor. That distinction drives most
 * of the wording — a generic SaaS template gets it wrong, and getting it wrong
 * is what turns a data-subject request into a dispute about who was supposed
 * to answer it.
 *
 * NOT LEGAL ADVICE. These are complete, honest drafts written to describe the
 * system as built. Have a lawyer review them against the jurisdictions you
 * sell into before you rely on them.
 */

export interface LegalSection {
  heading: string;
  /** Paragraphs. A nested array renders as a bulleted list. */
  body: (string | string[])[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  /** One line, shown on the legal index and as the page description. */
  summary: string;
  updated: string;
  sections: LegalSection[];
}

const ADDRESS = formattedAddress();

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  // ───────────────────────────────────────────────────────────── Terms ────
  {
    slug: "terms",
    title: "Terms of Service",
    summary:
      "The contract between your organisation and Chefotech for use of the platform.",
    updated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "1. Who these terms are between",
        body: [
          `These Terms of Service ("Terms") are a contract between ${COMPANY.legalName} ("${COMPANY.name}", "we", "us"), a company registered in India with registered office at ${ADDRESS}, and the organisation that creates an account to use ${COMPANY.product} ("Customer", "you").`,
          "By creating an account, accepting these Terms in the product, or using the platform, you confirm that you have the authority to bind your organisation to them. If you do not have that authority, do not use the platform.",
          "Individual employees who are given access by a Customer use the platform under that Customer's account. Their relationship is with their employer, not with us.",
        ],
      },
      {
        heading: "2. What the service is",
        body: [
          `${COMPANY.product} is a hosted, multi-tenant human resources platform. Depending on the plan you subscribe to, it provides employee records, attendance capture and processing, leave management, payroll calculation, document storage, reporting, and related administrative tools.`,
          "The platform performs calculations — attendance days, leave balances, salary components — according to the policies and formulas that you configure. We provide the engine; you decide the rules it applies.",
          "This distinction matters and is not a disclaimer of convenience: we cannot know whether your leave policy matches your employment contracts, or whether your salary structure satisfies the statutory requirements applicable to your workforce. You are responsible for the correctness of the rules you configure and for the legal compliance of the outcomes they produce.",
        ],
      },
      {
        heading: "3. Accounts, access and security",
        body: [
          "You are responsible for all activity that occurs under your account. That includes:",
          [
            "Keeping credentials confidential and not sharing logins between people.",
            "Granting each user the narrowest role that lets them do their job, and removing access promptly when someone leaves.",
            "Telling us without undue delay at " +
              COMPANY.email.security +
              " if you believe an account has been compromised.",
          ],
          "We provide role-based access control, an audit trail, and session management so that you can meet these responsibilities. We do not monitor how you choose to use them.",
        ],
      },
      {
        heading: "4. Your data",
        body: [
          "You retain all rights in the data you and your users put into the platform (\"Customer Data\"). We claim no ownership of it.",
          "We process Customer Data only to provide and support the service, as instructed by you through your use of the platform, and as set out in the Data Processing Addendum. We do not sell Customer Data. We do not use the personal data in your account to train machine learning models.",
          "You may export your data at any time while your subscription is active, using the export functions in the product.",
        ],
      },
      {
        heading: "5. Acceptable use",
        body: [
          "You agree not to use the platform to store or transmit unlawful content, to attempt to gain access to another tenant's data, to probe or test the security of the service except under a written agreement with us, to resell the service without authorisation, or to interfere with its operation for other customers.",
          "The Acceptable Use Policy sets this out in full and forms part of these Terms.",
        ],
      },
      {
        heading: "6. Fees, billing and renewal",
        body: [
          "Fees depend on the plan you select and, where the plan is priced per employee, on the number of active employee records in your account.",
          "Subscriptions renew automatically for successive periods unless cancelled before the end of the current period. You can cancel at any time from Settings, or by writing to " +
            COMPANY.email.billing +
            ".",
          "Fees are exclusive of taxes, which are added where applicable. Cancellation and refund handling is set out in the Cancellation and Refund Policy.",
          "If a payment fails, we will attempt to contact you and may suspend access after a reasonable notice period. We will not delete your data solely because a payment has failed.",
        ],
      },
      {
        heading: "7. Availability and support",
        body: [
          "We aim to keep the service available continuously, and the Service Level Agreement sets out the target and what happens when we miss it.",
          "Planned maintenance is announced in advance where it is likely to be noticed. Emergency maintenance to address a security issue may happen without notice.",
          `Support is available by email at ${COMPANY.email.support} during ${COMPANY.supportHours}.`,
        ],
      },
      {
        heading: "8. Suspension",
        body: [
          "We may suspend access where there is a genuine and immediate risk — a compromised account being used to attack the platform, activity that threatens other customers, or a legal obligation requiring it.",
          "Except where the risk requires immediate action, we will tell you first and give you a chance to resolve the issue. Suspension is not termination, and your data is retained through it.",
        ],
      },
      {
        heading: "9. Termination and what happens to your data",
        body: [
          "You may terminate at any time. We may terminate for material breach that is not remedied within 30 days of written notice.",
          "On termination your account becomes read-only for 30 days so that you can export your data. After that period we delete Customer Data from live systems within a further 60 days, and from backups in line with the backup rotation described in the Data Processing Addendum.",
          "We will not hold your data hostage against a billing dispute. Export remains available during the read-only period regardless.",
        ],
      },
      {
        heading: "10. Warranties and what we do not promise",
        body: [
          "We warrant that we will provide the service with reasonable skill and care, and that we will not materially reduce the functionality of a plan you are paying for during a subscription period.",
          "Beyond that, the service is provided as-is. We do not warrant that it will be uninterrupted or error-free, and we do not warrant that the outputs of the calculation engines will satisfy any particular legal or regulatory requirement — because those outputs depend on the rules you configure.",
          "Nothing in these Terms excludes liability that cannot lawfully be excluded, including for death or personal injury caused by negligence, or for fraud.",
        ],
      },
      {
        heading: "11. Limitation of liability",
        body: [
          "Subject to the paragraph above, our total aggregate liability arising out of or in connection with these Terms in any twelve-month period is limited to the fees you paid us in the twelve months preceding the event giving rise to the claim.",
          "Neither party is liable for indirect or consequential loss, or for loss of profit, revenue, goodwill or anticipated savings.",
        ],
      },
      {
        heading: "12. Indemnity",
        body: [
          "You will indemnify us against claims arising from Customer Data that infringes a third party's rights or breaches applicable law, and from your use of the platform in breach of these Terms.",
          "We will indemnify you against claims that the platform itself, used as permitted, infringes a third party's intellectual property rights.",
        ],
      },
      {
        heading: "13. Changes to these terms",
        body: [
          "We may update these Terms. For changes that materially affect your rights we will give at least 30 days' notice by email to your account administrators and in the product.",
          "If you do not accept a material change, you may terminate before it takes effect and we will refund any prepaid fees covering the period after termination.",
        ],
      },
      {
        heading: "14. Governing law and disputes",
        body: [
          `These Terms are governed by ${COMPANY.governingLaw}, and the parties submit to the exclusive jurisdiction of ${COMPANY.jurisdiction}.`,
          `Before starting proceedings, please write to ${COMPANY.email.legal} so that we can try to resolve the matter directly.`,
        ],
      },
      {
        heading: "15. Contact",
        body: [
          `${COMPANY.legalName}`,
          ADDRESS,
          `General: ${COMPANY.email.support} · Legal: ${COMPANY.email.legal}`,
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────── Privacy ────
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary:
      "What personal data the platform handles, why, and the rights people have over it.",
    updated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "The two roles, and why the difference matters",
        body: [
          "This platform holds personal data in two quite different capacities, and almost every question about privacy depends on which one is in play.",
          [
            "Employee data belongs to our customers. When an employer uses this platform to manage their staff, the employer decides what data to collect and why. In data protection language the employer is the controller and we are the processor. We act on their instructions, and we do not decide what happens to that data.",
            "Account and marketing data is ours. When someone signs up, contacts sales, or browses the marketing site, we decide how that data is used. For that data we are the controller, and this policy is the full description of what we do.",
          ],
          "If you are an employee and want to see, correct or delete data your employer holds about you in this platform, your employer is the right place to ask — they control it. We will help them respond, and if you contact us directly we will refer you to them and tell them you asked.",
        ],
      },
      {
        heading: "Data we handle as processor, for our customers",
        body: [
          "The categories depend on what each customer chooses to configure, but typically include:",
          [
            "Identity and contact details — name, employee code, work and personal email, telephone number, address.",
            "Employment details — job title, department, location, manager, joining date, employment type, salary structure.",
            "Attendance data — clock-in and clock-out times, the device or method used, computed working hours, and the resulting attendance status.",
            "Biometric identifiers where a customer connects a biometric device. The platform stores the device's user identifier and the punch events it reports. It does not store fingerprint or facial templates — those remain on the device.",
            "Leave and absence records, including reasons where the customer's policy asks for them.",
            "Payroll data — earnings, deductions, statutory contributions and payslips.",
            "Documents that the customer or employee uploads.",
          ],
          "We do not use any of this data for our own purposes. We do not sell it, we do not share it for advertising, and we do not use it to train models.",
        ],
      },
      {
        heading: "Data we handle as controller",
        body: [
          "For people who deal with us directly rather than through an employer:",
          [
            "Account data — the name, work email and organisation of people who register, and the security data needed to authenticate them.",
            "Billing data — plan, invoices and payment status. Card details are handled by our payment processor and do not reach our servers.",
            "Support data — the content of messages you send us and our replies.",
            "Product telemetry — which features are used and errors encountered, so we can find and fix problems. This is tied to an account, not to an individual employee's records.",
            "Marketing site analytics, only where you consent to non-essential cookies.",
          ],
        ],
      },
      {
        heading: "Why we are allowed to process it",
        body: [
          "As processor, our lawful basis is our customer's instruction; the customer is responsible for having a basis of their own — usually the performance of the employment contract, compliance with a legal obligation such as payroll and statutory filings, or their legitimate interests.",
          "As controller, we rely on: performance of a contract (running your account); legitimate interests (keeping the service secure, improving it, and telling existing customers about relevant changes); legal obligation (tax and accounting records); and consent (non-essential cookies and marketing email, which you can withdraw at any time).",
        ],
      },
      {
        heading: "Who else sees the data",
        body: [
          "We use a small number of sub-processors to run the service — hosting, image delivery, email delivery, and error monitoring. Each is bound by a written contract with data protection terms. The current list is published on the Sub-processors page, and we give notice before adding a new one.",
          "We disclose data to law enforcement or a regulator only where legally compelled. Where we are lawfully able to, we will tell the affected customer first so that they can challenge it.",
          "We do not sell personal data to anyone, in any capacity.",
        ],
      },
      {
        heading: "Where the data is held",
        body: [
          "Customer Data is hosted in the region selected for the customer's account. Where data is transferred out of its region — for example to a support engineer in another country — we rely on the transfer mechanisms described in the Data Processing Addendum.",
        ],
      },
      {
        heading: "How long it is kept",
        body: [
          "As processor, we keep Customer Data for as long as the customer's account is active, and delete it after termination on the timeline in the Terms: read-only for 30 days, deleted from live systems within a further 60, and cycled out of backups after that.",
          "As controller, we keep account and billing records for as long as is required for tax and accounting purposes, and support correspondence for three years.",
          "Audit logs are deliberately kept for longer and cannot be edited or selectively deleted, because an audit trail that can be trimmed is not an audit trail.",
        ],
      },
      {
        heading: "Security",
        body: [
          "Data is encrypted in transit and at rest. Access to production systems is restricted, individually authenticated and logged. Each tenant's data is isolated at the database query layer, not merely by a filter in application code — a request without a tenant context fails rather than returning everything.",
          "The Security page describes our practices in more detail.",
          "No system is immune. If a breach affects personal data, we will notify affected customers without undue delay and give them what they need to meet their own notification obligations.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "Depending on where you live, you may have the right to access a copy of your data, to have it corrected, to have it deleted, to restrict or object to processing, to receive it in a portable format, and to withdraw consent.",
          "For data we control, write to " +
            COMPANY.email.privacy +
            " and we will respond within 30 days. For data your employer controls, contact your employer.",
          `If you are not satisfied with our response you may complain to your local data protection authority. In India, you may also contact our Grievance Officer, ${COMPANY.grievanceOfficer.name}, at ${COMPANY.grievanceOfficer.email}, who will respond within the statutory period.`,
        ],
      },
      {
        heading: "Children",
        body: [
          "The platform is a workplace tool and is not intended for anyone under 18. We do not knowingly collect data from children. If a customer uses the platform to manage lawfully employed young people, that data is Customer Data and the customer is responsible for the additional protections that apply.",
        ],
      },
      {
        heading: "Changes and contact",
        body: [
          "We will post any change here and, if it is significant, notify account administrators by email.",
          `Data Protection Officer: ${COMPANY.dataProtectionOfficer.name} — ${COMPANY.dataProtectionOfficer.email}`,
          `${COMPANY.legalName}, ${ADDRESS}`,
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────── Cookies ────
  {
    slug: "cookies",
    title: "Cookie Policy",
    summary: "The cookies we set, what each is for, and how to refuse the optional ones.",
    updated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "What we set, and why",
        body: [
          "We keep this deliberately short because we use very few cookies.",
        ],
      },
      {
        heading: "Strictly necessary",
        body: [
          "These make the product work at all and cannot be switched off. They are set only once you interact with the application.",
          [
            "Session and refresh tokens — keep you signed in and let the session be renewed without asking for your password again. Removing them signs you out.",
            "Security tokens — protect against cross-site request forgery.",
            "Consent record — remembers your cookie choice, so that we do not ask on every visit.",
          ],
        ],
      },
      {
        heading: "Analytics — optional",
        body: [
          "If you accept, we record aggregate usage of the marketing site so we can tell which pages are useful. This is off until you accept, and you can change your mind at any time from the link in the footer.",
          "We do not use advertising cookies, and we do not allow third parties to track you across other sites from ours.",
        ],
      },
      {
        heading: "Controlling cookies",
        body: [
          "Use the cookie settings link in the footer to change your choice. Your browser can also block or delete cookies, though blocking the strictly necessary ones will stop you being able to sign in.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────── DPA ────
  {
    slug: "data-processing",
    title: "Data Processing Addendum",
    summary:
      "The processor terms that apply when we handle personal data on a customer's behalf.",
    updated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "Scope",
        body: [
          `This Addendum forms part of the Terms of Service between ${COMPANY.legalName} ("Processor") and the Customer ("Controller"). Where it conflicts with the Terms on the subject of personal data, this Addendum prevails.`,
          "It applies for as long as we process personal data on the Controller's behalf.",
        ],
      },
      {
        heading: "Subject matter and duration",
        body: [
          "Subject matter: provision of the Chefotech HRMS platform. Duration: the term of the subscription, plus the deletion period described below.",
          "Nature and purpose: hosting, storing, computing and making available human resources data as directed by the Controller through their configuration and use of the platform.",
          "Categories of data subject: the Controller's employees, contractors, and applicants where the Controller uses the platform for recruitment.",
          "Categories of personal data: as listed in the Privacy Policy.",
        ],
      },
      {
        heading: "Our obligations",
        body: [
          "We will:",
          [
            "Process personal data only on the Controller's documented instructions, which include the Controller's use of the platform's configuration. If we believe an instruction breaches applicable law, we will tell the Controller.",
            "Ensure that personnel with access are bound by confidentiality obligations.",
            "Implement and maintain the technical and organisational measures described in the Security section below.",
            "Not engage a new sub-processor without giving the Controller prior notice and an opportunity to object.",
            "Assist the Controller, taking into account the nature of the processing, in responding to data subject requests, in carrying out impact assessments, and in consulting supervisory authorities.",
            "Notify the Controller without undue delay after becoming aware of a personal data breach, with the information the Controller needs to meet their own obligations.",
            "Delete or return personal data at the end of the engagement, as described below.",
            "Make available the information reasonably necessary to demonstrate compliance, and allow for audits as described below.",
          ],
        ],
      },
      {
        heading: "Security measures",
        body: [
          "Without limiting the above, we maintain:",
          [
            "Encryption of personal data in transit (TLS) and at rest.",
            "Tenant isolation enforced at the data access layer, so that a query without an authenticated tenant context fails rather than returning data.",
            "Role-based access control with least-privilege defaults, and immediate revocation when access is removed.",
            "An append-only audit trail of security-relevant events.",
            "Individually authenticated, logged and time-limited access to production systems.",
            "Regular backups, and testing that they can actually be restored.",
            "Segregated development, staging and production environments; production personal data is not used for development or testing.",
          ],
        ],
      },
      {
        heading: "Sub-processors",
        body: [
          "The current sub-processor list is published and maintained on the Sub-processors page.",
          "We give at least 30 days' notice before adding or replacing a sub-processor. If the Controller reasonably objects on data protection grounds, and we cannot offer a practical alternative, the Controller may terminate the affected part of the service without penalty.",
          "We remain liable for our sub-processors' performance of these obligations.",
        ],
      },
      {
        heading: "International transfers",
        body: [
          "Where personal data is transferred out of its region of origin, we rely on an adequacy decision where one exists, or on Standard Contractual Clauses or the equivalent mechanism in the applicable regime, together with any supplementary measures the transfer requires.",
        ],
      },
      {
        heading: "Audit",
        body: [
          "On reasonable notice and no more than once a year — or more often if a supervisory authority requires it, or following a breach — we will respond to a reasonable security questionnaire and provide available third-party assessment reports.",
          "Where that is genuinely insufficient for the Controller's compliance obligations, we will discuss an on-site audit, conducted so as not to disrupt other customers and subject to confidentiality.",
        ],
      },
      {
        heading: "Return and deletion",
        body: [
          "On termination the Controller has 30 days of read-only access to export data. We then delete personal data from live systems within 60 days, and it is cycled out of encrypted backups within a further 90 days as the backup rotation completes.",
          "We will certify deletion in writing on request. Where law requires us to retain something, we will say so and retain only what is required, for only as long as required.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────── Sub-processors ────
  {
    slug: "sub-processors",
    title: "Sub-processors",
    summary: "The third parties that help us run the service, and what each one does.",
    updated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "Current sub-processors",
        body: [
          "We keep this list short on purpose — every addition is another party with access to customer data and another contract to police.",
          [
            "Cloud hosting — runs the application and databases. Processes all Customer Data. TODO: confirm provider and hosting region before publishing.",
            "Image delivery network (Cloudinary) — stores and serves images such as company logos and profile photos. Processes images only.",
            "Document storage (Google Drive) — stores customer documents and generated files. Processes uploaded documents.",
            "Transactional email delivery — sends notifications, invitations and password resets. Processes recipient name and email address, and the content of those messages.",
            "Error monitoring — records diagnostic information about failures. Configured to redact personal data from reports.",
          ],
          "TODO: replace each entry above with the named legal entity, the country it processes in, and the date it was added, before this page is published.",
        ],
      },
      {
        heading: "Notice of changes",
        body: [
          "We give at least 30 days' notice before adding or replacing a sub-processor. Account administrators are notified by email, and this page is updated.",
          `To be added to the notification list, write to ${COMPANY.email.privacy}.`,
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────── Acceptable use ────
  {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    summary: "What the platform may not be used for.",
    updated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "The rule",
        body: [
          "Do not use the platform to break the law, to harm other people, or to interfere with the service for other customers. Everything below is an application of that.",
        ],
      },
      {
        heading: "Content",
        body: [
          "Do not store or transmit content that is unlawful, that infringes someone else's intellectual property, that is malicious code, or that you have no lawful basis to hold.",
          "Employee data deserves particular care: collect what you need for employment purposes, and not more. The platform lets you add custom fields; that is not an invitation to record data you have no reason to hold.",
        ],
      },
      {
        heading: "Security",
        body: [
          "Do not attempt to access another tenant's data, circumvent access controls, or probe, scan or load-test the service without our prior written agreement.",
          `We welcome security research conducted responsibly. Write to ${COMPANY.email.security} before you start, and we will agree a scope. We will not pursue legal action against researchers who follow an agreed scope and give us a reasonable chance to fix what they find.`,
        ],
      },
      {
        heading: "Fair use",
        body: [
          "Do not resell or white-label the service without authorisation, use it to build a competing product, or drive automated traffic at a volume that degrades the service for others. API rate limits apply and are published in the documentation.",
        ],
      },
      {
        heading: "Enforcement",
        body: [
          "Where we can, we will contact you and give you a chance to put things right. Where a violation poses immediate risk to other customers or to the platform, we may suspend access first and explain afterwards.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────── SLA ────
  {
    slug: "sla",
    title: "Service Level Agreement",
    summary: "The uptime we target, how it is measured, and what you get if we miss it.",
    updated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "Applies to",
        body: [
          "This SLA applies to customers on a paid plan. Trial and free accounts are provided without an availability commitment.",
        ],
      },
      {
        heading: "The commitment",
        body: [
          "We target 99.9% monthly availability of the application and API.",
          "Availability is measured per calendar month as the percentage of one-minute intervals in which the service responded successfully to a health request. Excluded from the calculation are: announced planned maintenance; emergency security maintenance; failures caused by the customer's own configuration, network or third-party integrations; and events outside our reasonable control.",
        ],
      },
      {
        heading: "Service credits",
        body: [
          "If we miss the target in a month, you may claim a credit against the following month's fees:",
          [
            "Below 99.9% but at or above 99.0% — 10% of the monthly fee.",
            "Below 99.0% but at or above 95.0% — 25% of the monthly fee.",
            "Below 95.0% — 50% of the monthly fee.",
          ],
          `Claim within 30 days of the end of the affected month by writing to ${COMPANY.email.support} with the dates and times you observed. Credits are the exclusive remedy for missed availability.`,
        ],
      },
      {
        heading: "Support response targets",
        body: [
          `Support operates ${COMPANY.supportHours}. First response targets, measured within those hours:`,
          [
            "Critical — the service is unavailable or payroll cannot be processed: 2 hours.",
            "High — a major function is broken with no workaround: 1 business day.",
            "Normal — a function is impaired but has a workaround: 2 business days.",
            "Low — questions, guidance and feature requests: 5 business days.",
          ],
          "These are targets for a first substantive response, not for resolution. We will tell you what we know and what happens next rather than sending an automated acknowledgement.",
        ],
      },
      {
        heading: "Backups and recovery",
        body: [
          "Databases are backed up daily and retained for 30 days, with restores tested regularly. Our recovery point objective is 24 hours and our recovery time objective is 8 hours.",
          "A backup that has never been restored is a hope rather than a backup, which is why the testing is part of the commitment and not an aspiration.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────── Refunds ────
  {
    slug: "refunds",
    title: "Cancellation and Refund Policy",
    summary: "How to cancel, and when money comes back.",
    updated: LEGAL_LAST_UPDATED,
    sections: [
      {
        heading: "Cancelling",
        body: [
          `You can cancel at any time from Settings → Plan and usage, or by writing to ${COMPANY.email.billing}. No notice period and no cancellation fee.`,
          "Cancelling stops the next renewal. Your subscription continues to the end of the period you have already paid for.",
        ],
      },
      {
        heading: "Trials",
        body: [
          "Trials are free and require no payment method. A trial that ends without a subscription becomes read-only rather than being deleted, so nothing is lost while you decide.",
        ],
      },
      {
        heading: "Refunds",
        body: [
          "Monthly plans are not refunded for a partial month; cancel and you keep access until the period ends.",
          "Annual plans cancelled within 14 days of the initial purchase are refunded in full. After 14 days, we refund the unused whole months on a pro-rata basis if you cancel because of a material unremedied breach by us.",
          "If we are at fault — a billing error, a charge after cancellation, or a material failure we cannot fix — we refund it. We do not require you to argue for that.",
          "Refunds are made to the original payment method, normally within 7 to 10 business days of approval.",
        ],
      },
      {
        heading: "Changing plans",
        body: [
          "Upgrading takes effect immediately and is charged pro-rata for the remainder of the period. Downgrading takes effect at the next renewal, so that you keep what you have paid for.",
          "If a downgrade would put you above the limits of the lower plan, we will tell you what needs to change before it takes effect rather than deleting anything.",
        ],
      },
      {
        heading: "Disputes",
        body: [
          `Write to ${COMPANY.email.billing} before raising a chargeback. Almost every billing dispute is a misunderstanding that we can resolve in a day, and a chargeback suspends the account automatically, which helps nobody.`,
        ],
      },
    ],
  },
];

export const LEGAL_BY_SLUG: Record<string, LegalDocument> = Object.fromEntries(
  LEGAL_DOCUMENTS.map((doc) => [doc.slug, doc])
);
