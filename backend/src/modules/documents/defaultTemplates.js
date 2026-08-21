"use strict";

/**
 * Templates seeded into every new organization.
 *
 * They are ordinary DocumentTemplate documents, editable and deletable like
 * any other — they exist so a customer has something working on day one, not
 * as privileged built-ins. The wording is deliberately neutral and generic;
 * every organization is expected to rewrite it in their own voice.
 */

const TEMPLATES = [
  {
    name: "Offer Letter",
    code: "OFFER_LETTER",
    category: "offer_letter",
    contextType: "employee",
    description: "Sent to a candidate before joining.",
    numbering: { enabled: true, prefix: "OL/", nextNumber: 1, padding: 4 },
    blocks: [
      { type: "paragraph", text: "Ref: {{document.number}}", style: { align: "right", fontSize: 9 } },
      { type: "paragraph", text: "Date: {{date.todayFormatted}}", style: { align: "right", fontSize: 9 } },
      { type: "spacer", height: 16 },
      { type: "paragraph", text: "{{employee.name}}\n{{employee.address}}" },
      { type: "spacer", height: 12 },
      { type: "heading", text: "Letter of Offer", style: { align: "center", fontSize: 14 } },
      { type: "spacer", height: 12 },
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text: "We are pleased to offer you the position of {{employee.designation}} in our {{employee.department}} department at {{company.name}}. Your appointment will be effective from {{employee.joiningDateFormatted}} and you will be based at {{employee.location}}.",
      },
      {
        type: "paragraph",
        text: "Your annual cost to company will be {{salary.ctcAnnualFormatted}}, payable monthly in accordance with company policy. A detailed breakdown of your compensation is set out below.",
      },
      { type: "spacer", height: 8 },
      {
        type: "key_values",
        rows: [
          { label: "Position", value: "{{employee.designation}}" },
          { label: "Department", value: "{{employee.department}}" },
          { label: "Location", value: "{{employee.location}}" },
          { label: "Date of joining", value: "{{employee.joiningDateFormatted}}" },
          { label: "Employment type", value: "{{employee.employmentType}}" },
          { label: "Annual CTC", value: "{{salary.ctcAnnualFormatted}}" },
        ],
      },
      { type: "spacer", height: 10 },
      {
        type: "paragraph",
        text: "This offer is subject to verification of the documents and references you have provided. Please sign and return a copy of this letter to confirm your acceptance.",
      },
      { type: "spacer", height: 10 },
      { type: "paragraph", text: "We look forward to welcoming you to the team." },
      { type: "spacer", height: 24 },
      { type: "signature", text: "For {{company.name}}" },
    ],
  },

  {
    name: "Appointment Letter",
    code: "APPOINTMENT_LETTER",
    category: "appointment_letter",
    contextType: "employee",
    numbering: { enabled: true, prefix: "AL/", nextNumber: 1, padding: 4 },
    blocks: [
      { type: "paragraph", text: "Ref: {{document.number}}    Date: {{date.todayFormatted}}", style: { align: "right", fontSize: 9 } },
      { type: "spacer", height: 14 },
      { type: "heading", text: "Letter of Appointment", style: { align: "center", fontSize: 14 } },
      { type: "spacer", height: 12 },
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text: "With reference to your application and the subsequent discussions, we are pleased to appoint you as {{employee.designation}} at {{company.name}} with effect from {{employee.joiningDateFormatted}}.",
      },
      { type: "spacer", height: 8 },
      {
        type: "key_values",
        rows: [
          { label: "Employee code", value: "{{employee.employeeCode}}" },
          { label: "Designation", value: "{{employee.designation}}" },
          { label: "Department", value: "{{employee.department}}" },
          { label: "Reporting to", value: "{{employee.manager}}" },
          { label: "Place of posting", value: "{{employee.location}}" },
          { label: "Date of joining", value: "{{employee.joiningDateFormatted}}" },
        ],
      },
      { type: "spacer", height: 10 },
      {
        type: "paragraph",
        text: "Your employment is governed by the policies of {{company.name}} as amended from time to time. You are expected to devote your full working time to the duties assigned to you and to maintain the confidentiality of all company information.",
      },
      { type: "spacer", height: 20 },
      { type: "signature", text: "Authorised Signatory\n{{company.name}}" },
    ],
  },

  {
    name: "Experience Certificate",
    code: "EXPERIENCE_CERTIFICATE",
    category: "experience_certificate",
    contextType: "employee",
    blocks: [
      { type: "paragraph", text: "Date: {{date.todayFormatted}}", style: { align: "right", fontSize: 9 } },
      { type: "spacer", height: 16 },
      { type: "heading", text: "To Whomsoever It May Concern", style: { align: "center", fontSize: 13 } },
      { type: "spacer", height: 16 },
      {
        type: "paragraph",
        text: "This is to certify that {{employee.name}} (Employee Code: {{employee.employeeCode}}) was employed with {{company.name}} from {{employee.joiningDateFormatted}} to {{employee.lastWorkingDay}}, a period of {{employee.tenure}}.",
      },
      {
        type: "paragraph",
        text: "At the time of leaving, {{employee.firstName}} held the position of {{employee.designation}} in the {{employee.department}} department.",
      },
      {
        type: "paragraph",
        text: "We found {{employee.firstName}} to be sincere and diligent in the discharge of duties. We wish them every success in their future endeavours.",
      },
      { type: "spacer", height: 28 },
      { type: "signature", text: "For {{company.name}}" },
    ],
  },

  {
    name: "Relieving Letter",
    code: "RELIEVING_LETTER",
    category: "relieving_letter",
    contextType: "employee",
    blocks: [
      { type: "paragraph", text: "Date: {{date.todayFormatted}}", style: { align: "right", fontSize: 9 } },
      { type: "spacer", height: 16 },
      { type: "heading", text: "Relieving Letter", style: { align: "center", fontSize: 14 } },
      { type: "spacer", height: 14 },
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text: "This is to confirm that your resignation has been accepted and that you have been relieved from your duties as {{employee.designation}} at {{company.name}} with effect from the close of business on {{employee.lastWorkingDay}}.",
      },
      {
        type: "paragraph",
        text: "All company property in your possession has been returned and your dues have been settled in accordance with company policy.",
      },
      { type: "paragraph", text: "We thank you for your contribution and wish you well." },
      { type: "spacer", height: 24 },
      { type: "signature", text: "For {{company.name}}" },
    ],
  },

  {
    name: "Payslip",
    code: "PAYSLIP",
    category: "salary_slip",
    contextType: "payslip",
    footer: { enabled: true, text: "This is a computer-generated payslip and does not require a signature.", showPageNumbers: false },
    blocks: [
      { type: "heading", text: "Payslip for {{payslip.period}}", style: { align: "center", fontSize: 13 } },
      { type: "spacer", height: 10 },
      {
        type: "key_values",
        rows: [
          { label: "Employee name", value: "{{employee.name}}" },
          { label: "Employee code", value: "{{employee.employeeCode}}" },
          { label: "Designation", value: "{{employee.designation}}" },
          { label: "Department", value: "{{employee.department}}" },
          { label: "Date of joining", value: "{{employee.joiningDateFormatted}}" },
          { label: "Payslip number", value: "{{payslip.number}}" },
        ],
      },
      { type: "divider" },
      { type: "heading", text: "Attendance", style: { fontSize: 11 } },
      {
        type: "key_values",
        rows: [
          { label: "Days in period", value: "{{payslip.attendance.totalDays}}" },
          { label: "Payable days", value: "{{payslip.attendance.payableDays}}" },
          { label: "Loss of pay days", value: "{{payslip.attendance.lossOfPayDays}}" },
          { label: "Paid leave", value: "{{payslip.attendance.paidLeaveDays}}" },
        ],
      },
      { type: "spacer", height: 8 },
      { type: "heading", text: "Earnings", style: { fontSize: 11 } },
      {
        type: "table",
        source: "payslip.earnings",
        columns: [
          { key: "name", label: "Component", width: 3 },
          { key: "amount", label: "Amount", width: 1, align: "right" },
        ],
      },
      { type: "heading", text: "Deductions", style: { fontSize: 11 } },
      {
        type: "table",
        source: "payslip.deductionLines",
        columns: [
          { key: "name", label: "Component", width: 3 },
          { key: "amount", label: "Amount", width: 1, align: "right" },
        ],
      },
      { type: "divider" },
      {
        type: "key_values",
        rows: [
          { label: "Gross earnings", value: "{{payslip.grossFormatted}}" },
          { label: "Total deductions", value: "{{payslip.deductionsFormatted}}" },
          { label: "Net payable", value: "{{payslip.netFormatted}}" },
        ],
      },
    ],
  },

  {
    name: "Salary Certificate",
    code: "SALARY_CERTIFICATE",
    category: "salary_certificate",
    contextType: "employee",
    blocks: [
      { type: "paragraph", text: "Date: {{date.todayFormatted}}", style: { align: "right", fontSize: 9 } },
      { type: "spacer", height: 16 },
      { type: "heading", text: "Salary Certificate", style: { align: "center", fontSize: 14 } },
      { type: "spacer", height: 14 },
      {
        type: "paragraph",
        text: "This is to certify that {{employee.name}} (Employee Code: {{employee.employeeCode}}) is employed with {{company.name}} as {{employee.designation}} since {{employee.joiningDateFormatted}}.",
      },
      {
        type: "paragraph",
        text: "Their present annual cost to company is {{salary.ctcAnnualFormatted}}, equivalent to {{salary.ctcMonthlyFormatted}} per month.",
      },
      {
        type: "paragraph",
        text: "This certificate has been issued at the request of the employee for the purpose stated by them.",
      },
      { type: "spacer", height: 26 },
      { type: "signature", text: "For {{company.name}}" },
    ],
  },

  {
    name: "Confirmation Letter",
    code: "CONFIRMATION_LETTER",
    category: "confirmation_letter",
    contextType: "employee",
    blocks: [
      { type: "paragraph", text: "Date: {{date.todayFormatted}}", style: { align: "right", fontSize: 9 } },
      { type: "spacer", height: 14 },
      { type: "heading", text: "Confirmation of Employment", style: { align: "center", fontSize: 14 } },
      { type: "spacer", height: 12 },
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text: "We are pleased to inform you that, following a review of your performance during the probation period, your services with {{company.name}} are confirmed with effect from {{date.todayFormatted}} in the position of {{employee.designation}}.",
      },
      { type: "paragraph", text: "Congratulations, and we look forward to your continued contribution." },
      { type: "spacer", height: 24 },
      { type: "signature", text: "For {{company.name}}" },
    ],
  },

  {
    name: "Increment Letter",
    code: "INCREMENT_LETTER",
    category: "increment_letter",
    contextType: "employee",
    blocks: [
      { type: "paragraph", text: "Date: {{date.todayFormatted}}", style: { align: "right", fontSize: 9 } },
      { type: "spacer", height: 14 },
      { type: "heading", text: "Salary Revision", style: { align: "center", fontSize: 14 } },
      { type: "spacer", height: 12 },
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text: "In recognition of your performance and contribution, we are pleased to inform you that your compensation has been revised with effect from {{salary.effectiveFrom}}.",
      },
      {
        type: "key_values",
        rows: [
          { label: "Revised annual CTC", value: "{{salary.ctcAnnualFormatted}}" },
          { label: "Effective from", value: "{{salary.effectiveFrom}}" },
          { label: "Designation", value: "{{employee.designation}}" },
        ],
      },
      { type: "paragraph", text: "All other terms of your employment remain unchanged." },
      { type: "spacer", height: 24 },
      { type: "signature", text: "For {{company.name}}" },
    ],
  },

  {
    name: "Warning Letter",
    code: "WARNING_LETTER",
    category: "warning_letter",
    contextType: "employee",
    blocks: [
      { type: "paragraph", text: "Date: {{date.todayFormatted}}", style: { align: "right", fontSize: 9 } },
      { type: "spacer", height: 14 },
      { type: "heading", text: "Letter of Warning", style: { align: "center", fontSize: 14 } },
      { type: "spacer", height: 12 },
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text: "This letter is to formally record our concern regarding the matter discussed with you. We expect an immediate and sustained improvement.",
      },
      {
        type: "paragraph",
        text: "Please treat this as a formal warning. Any recurrence may lead to further disciplinary action in accordance with company policy.",
      },
      { type: "spacer", height: 20 },
      { type: "signature", text: "For {{company.name}}" },
    ],
  },
];

module.exports = { TEMPLATES };
