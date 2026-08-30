"use strict";

const { introspect, fieldNames, toResponseSchema } = require("./schemaIntrospect");
const { ShiftSchema, WeeklyOffSchema, PatternSchema } = require("../../modules/shifts/shift.schema");
const { CreateSchema: DepartmentSchema } = require("../../modules/departments/department.schema");
const { CreateSchema: DesignationSchema } = require("../../modules/designations/designation.schema");
const { CreateSchema: LocationSchema } = require("../../modules/locations/location.schema");
const { LeaveTypeSchema, LeavePolicySchema } = require("../../modules/leave/leave.schema");
const { CalendarSchema, HolidaySchema } = require("../../modules/holidays/holiday.schema");
const { ComponentSchema, StructureSchema } = require("../../modules/payroll/payroll.schema");
const { RoleSchema } = require("../../modules/rbac/rbac.schema");
const { InviteSchema } = require("../../modules/users/user.schema");
const { DeviceSchema } = require("../../modules/biometric/biometric.schema");
const { WorkflowSchema } = require("../../modules/workflow/workflow.schema");
const { TemplateSchema } = require("../../modules/documents/document.schema");
const { CustomFieldSchema } = require("../../modules/employees/employee.schema");
const HELP = require("./formHelp");

/**
 * Every form in the product, described once.
 *
 * Two things in this platform were being solved separately and badly. An
 * administrator looking at an input often cannot tell what it will do — the
 * consequence of a grace period or an accrual mode shows up weeks later in
 * someone's pay, not at the moment of typing. And the assistant could point
 * at a screen but never fill it in, because the only inputs it knew about
 * were the twenty-five hand-listed steps of eight guided tours.
 *
 * Both are the same missing thing: a machine-readable description of what
 * every input means. This is it.
 *
 * The split matters. **Structure** — names, types, bounds, enum values,
 * whether a field is required — is read out of the Zod schema that already
 * guards the endpoint, never restated here. **Meaning** — why a field exists
 * and what a good value looks like — is written by a human in formHelp.js,
 * because no schema can express it. formRegistry.test.js asserts the two
 * halves still line up, so a field added to a schema fails the build here
 * rather than reaching a customer as an unexplained box, and a help entry for
 * a field that no longer exists is caught rather than sitting there rotting.
 *
 * One entity per form the user can actually open. `permission` is the
 * permission needed to SAVE the thing — the AI draft endpoint checks exactly
 * that, so asking the assistant to fill a form is never a way around the
 * access control on the form itself.
 */

const ENTITIES = [
  {
    key: "shift",
    label: "Shift",
    plural: "Shifts",
    schema: ShiftSchema,
    route: "/app/settings/shifts",
    permission: "shift.manage",
    // Read by the assistant before it drafts. Anything an experienced HR
    // administrator would know from context but a model would not.
    guidance:
      "A shift's end time earlier than its start time means an overnight shift; the platform handles that automatically and produces one attendance record for the night the shift began. Codes are short, uppercase and stable (GEN, NIGHT, MORN). Indian workplaces most often run a 09:00-18:00 general shift with a 60-minute break.",
  },
  {
    key: "weekly_off",
    label: "Week off pattern",
    plural: "Week off patterns",
    schema: WeeklyOffSchema,
    route: "/app/settings/week-off",
    permission: "shift.manage",
    guidance:
      "days must contain all seven entries, day 0 = Sunday through day 6 = Saturday. Use type 'alternate' with offOccurrences to express rules like '2nd and 4th Saturday off' — offOccurrences [2,4] means the 2nd and 4th such weekday of the month. A six-day week with alternate Saturdays is the most common Indian factory pattern.",
  },
  {
    key: "shift_pattern",
    label: "Shift pattern",
    plural: "Shift patterns",
    schema: PatternSchema,
    route: "/app/settings/shift-patterns",
    permission: "shift.manage",
    guidance:
      "A 'weekly' pattern repeats every calendar week and uses days[]. A 'rotating' pattern repeats every N days regardless of weekday and uses cycle[] plus anchorDate, which is the real date that sits at position 0. Leave a position's shiftId null to make it a rest day.",
  },
  {
    key: "department",
    label: "Department",
    plural: "Departments",
    schema: DepartmentSchema,
    route: "/app/organization/departments",
    permission: "department.manage",
    guidance:
      "Departments nest \u2014 parentId points at the department this one sits inside \u2014 so a company can model Production > Cutting without inventing a naming convention. Codes are short and uppercase.",
  },
  {
    key: "designation",
    label: "Designation",
    plural: "Designations",
    schema: DesignationSchema,
    route: "/app/organization/designations",
    permission: "designation.manage",
    guidance:
      "A designation is the job title, and level is its seniority rank, used for ordering and for approval chains. Nothing in the product keys off the title text itself.",
  },
  {
    key: "location",
    label: "Work location",
    plural: "Work locations",
    schema: LocationSchema,
    route: "/app/organization/locations",
    permission: "location.manage",
    guidance:
      "Timezone must be an IANA name such as Asia/Kolkata, because attendance for this site is stamped against it. The geo block is only used when attendance is geofenced; radiusMetres is the allowed distance from the point.",
  },
  {
    key: "leave_type",
    label: "Leave type",
    plural: "Leave types",
    schema: LeaveTypeSchema,
    route: "/app/settings/leave-types",
    permission: "leave.manage_types",
    guidance:
      "This is the leave type itself, not its allocation rule \u2014 how many days it grants is set separately in a leave policy. Typical Indian types are Casual (CL), Sick (SL), Earned or Privilege (EL/PL) and Loss of Pay (LOP).",
  },
  {
    key: "leave_policy",
    label: "Leave policy",
    plural: "Leave policies",
    schema: LeavePolicySchema,
    route: "/app/settings/leave",
    permission: "leave.manage_policies",
    guidance:
      "A policy carries one rule per leave type. Counting rules decide whether weekends and holidays inside a request are deducted: exclude never deducts, include always does, and sandwich deducts only when leave falls on both sides of the gap.",
  },
  {
    key: "holiday_calendar",
    label: "Holiday calendar",
    plural: "Holiday calendars",
    schema: CalendarSchema,
    route: "/app/settings/holidays",
    permission: "holiday.manage",
    guidance:
      "One calendar per year, and usually per region \u2014 Indian organizations commonly run a separate calendar per state because gazetted holidays differ. optionalHolidayQuota is how many of the optional holidays an employee may actually take.",
  },
  {
    key: "holiday",
    label: "Holiday",
    plural: "Holidays",
    schema: HolidaySchema,
    route: "/app/settings/holidays",
    permission: "holiday.manage",
    guidance:
      "A single dated holiday inside a calendar. Mark it optional when employees choose from a pool rather than everyone taking it \u2014 Diwali is usually fixed, a regional new year often optional.",
  },
  {
    key: "payroll_component",
    label: "Salary component",
    plural: "Salary components",
    schema: ComponentSchema,
    route: "/app/payroll/components",
    permission: "payroll.manage_components",
    guidance:
      "Components are evaluated in order, each able to reference ones already computed. The calculation method decides which of amount, percentage or expression is read. Indian structures usually run Basic first, then HRA as a percentage of Basic, then statutory deductions.",
  },
  {
    key: "salary_structure",
    label: "Salary structure",
    plural: "Salary structures",
    schema: StructureSchema,
    route: "/app/payroll/structures",
    permission: "payroll.manage_structures",
    guidance:
      "A named set of components applied together to a group of employees. An override replaces that component's own calculation for this structure only, which is how one grade gets a different HRA without a duplicate component.",
  },
  {
    key: "role",
    label: "Role",
    plural: "Roles",
    schema: RoleSchema,
    route: "/app/settings/roles",
    permission: "role.manage",
    guidance:
      "Nothing in the product keys off a role's name, only its permissions \u2014 so a role called anything at all behaves exactly as its permission list says. Grant the narrowest set that lets the person do their job.",
  },
  {
    key: "user_invite",
    label: "Team invitation",
    plural: "Team invitations",
    schema: InviteSchema,
    route: "/app/settings/users",
    permission: "user.invite",
    guidance:
      "Invites a person to administer the platform, which is not the same as creating an employee record. Roles decide what they can reach once they accept.",
  },
  {
    key: "biometric_device",
    label: "Biometric device",
    plural: "Biometric devices",
    schema: DeviceSchema,
    route: "/app/settings/biometric",
    permission: "biometric.manage",
    guidance:
      "The connection block differs per provider: an API pull needs a host and credentials, a webhook push needs nothing outbound because the device calls in, and a file import needs neither. Devices on a private network cannot be polled and must push.",
  },
  {
    key: "workflow",
    label: "Approval workflow",
    plural: "Approval workflows",
    schema: WorkflowSchema,
    route: "/app/workflows",
    permission: "workflow.manage",
    guidance:
      "Steps run in order, each deciding who approves at that level. An approverType of reporting_manager resolves per employee at request time; role and user are fixed. Escalation moves a request on when a step sits unanswered.",
  },
  {
    key: "document_template",
    label: "Document template",
    plural: "Document templates",
    schema: TemplateSchema,
    route: "/app/documents/templates",
    permission: "document.manage_templates",
    guidance:
      "Templates render to PDF, so page size, orientation and margins are real print settings. Numbering issues a sequential reference per generated document, which is what makes an offer letter auditable.",
  },
  {
    key: "employee_field",
    label: "Custom employee field",
    plural: "Custom employee fields",
    schema: CustomFieldSchema,
    route: "/app/settings/employee-fields",
    permission: "employee.manage_custom_fields",
    guidance:
      "Adds a field to every employee record. The key is permanent \u2014 it is what stored values are filed under, so changing it orphans everything already captured. Mark anything sensitive so it is hidden from managers who only need the basics.",
  },
];

const BY_KEY = Object.fromEntries(ENTITIES.map((e) => [e.key, e]));

/**
 * Attach the human-authored help to the derived structure.
 *
 * Nested fields are addressed by dotted path (`allocation.mode`), the same
 * string the frontend form writes to, so a renamed field shows up as missing
 * help rather than help silently attached to the wrong input.
 */
function decorate(fields, helpMap, prefix = "") {
  return fields.map((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const help = helpMap[path] || null;

    const decorated = { ...field, path };
    if (help) decorated.help = help;

    if (field.fields) decorated.fields = decorate(field.fields, helpMap, path);
    if (field.itemFields) decorated.itemFields = decorate(field.itemFields, helpMap, path);

    return decorated;
  });
}

/** Every field of one entity, structure and meaning together. */
function describeEntity(key) {
  const entity = BY_KEY[key];
  if (!entity) return null;

  const helpMap = HELP[key] || {};
  return {
    key: entity.key,
    label: entity.label,
    plural: entity.plural,
    route: entity.route,
    permission: entity.permission,
    guidance: entity.guidance,
    fields: decorate(introspect(entity.schema), helpMap),
  };
}

/** Only the entities this caller could actually save, described in full. */
function describeAll(permissions) {
  return ENTITIES.filter((e) => !e.permission || permissions.includes(e.permission)).map((e) =>
    describeEntity(e.key)
  );
}

/** The catalogue line the assistant sees — one entity per line, no fields. */
function describeForPrompt(permissions) {
  return ENTITIES.filter((e) => !e.permission || permissions.includes(e.permission))
    .map((e) => `- ${e.key}: ${e.label} — ${e.plural} are managed at ${e.route}.`)
    .join("\n");
}

/**
 * The JSON schema Gemini is constrained to when drafting this entity, plus
 * the field notes that tell it what each one means. The schema comes straight
 * from the Zod definition, so the model cannot propose a field the endpoint
 * would reject.
 */
function draftSchemaFor(key) {
  const entity = BY_KEY[key];
  if (!entity) return null;

  const fields = introspect(entity.schema);
  return {
    entity,
    responseSchema: toResponseSchema(fields),
    fieldNotes: fieldNotesFor(key, fields),
  };
}

function fieldNotesFor(key, fields, prefix = "") {
  const helpMap = HELP[key] || {};
  const lines = [];

  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;

    if (field.type === "reference") continue; // never offered to the model

    const bits = [`- ${path} (${field.type}${field.required ? ", required" : ""})`];
    if (field.options && field.options.length) bits.push(`one of: ${field.options.join(", ")}.`);
    if (field.min !== undefined || field.max !== undefined) {
      bits.push(`range ${field.min ?? "any"}-${field.max ?? "any"}.`);
    }
    if (helpMap[path] && helpMap[path].why) bits.push(helpMap[path].why);
    lines.push(bits.join(" "));

    if (field.fields) lines.push(...fieldNotesFor(key, field.fields, path));
    if (field.itemFields) lines.push(...fieldNotesFor(key, field.itemFields, path));
  }

  return lines;
}

module.exports = {
  ENTITIES,
  BY_KEY,
  describeEntity,
  describeAll,
  describeForPrompt,
  draftSchemaFor,
  fieldNames,
};
