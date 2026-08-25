"use client";

import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatMoney, humanise } from "@/lib/format";
import { Badge, Callout, FieldHelp, NoAccessState, UpgradeState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";
import { FormulaBuilder } from "@/components/payroll/FormulaBuilder";
import { PAYROLL_COMPONENT_HELP } from "@/content/settingsHelp";

/** The info icon for one field, keyed by the path the form writes to. */
function help(path: string, label: string) {
  const content = PAYROLL_COMPONENT_HELP[path];
  return content ? <FieldHelp label={label} help={content} /> : undefined;
}

/** Reads the calculation method out of the in-progress form values. */
function methodOf(values: Record<string, unknown>) {
  const calc = values.calculation as { method?: string } | undefined;
  return calc?.method || "fixed";
}

interface Component {
  id: string;
  name: string;
  code: string;
  type: string;
  category: string;
  order: number;
  prorateOnAttendance: boolean;
  showOnPayslip: boolean;
  isActive: boolean;
  calculation: {
    method: string;
    amount: number;
    percentage: number;
    ofComponent: string;
    expression: string;
  };
}

/**
 * Salary components.
 *
 * Each one is a line on a payslip whose value comes from a fixed amount, a
 * percentage of another component, or a formula. The formulas are evaluated by
 * a purpose-built expression engine — never by running the text as code — and
 * an unparseable formula is rejected when you save it, not discovered halfway
 * through a payroll run.
 */
export default function SalaryComponentsPage() {
  const { session, can, hasFeature } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const currency = session?.organization?.currency || "INR";

  const { data: variables } = useQuery({
    queryKey: ["payroll", "variables"],
    queryFn: async () => {
      const { data } = await api.get<{
        systemVariables: Array<{ code: string }>;
        componentVariables: Array<{ code: string; name: string }>;
        functions: string[];
      }>("/payroll/components/variables");
      return data;
    },
    enabled: can("payroll.manage_components") && hasFeature("payroll"),
    staleTime: 5 * 60_000,
  });

  if (!hasFeature("payroll")) {
    return <UpgradeState feature="Payroll" planName={session?.organization?.plan?.name} />;
  }
  if (!can("payroll.view")) return <NoAccessState what="salary components" />;

  return (
    <>
      <Callout tone="info" className="mb-5">
        <p className="font-medium">What this page is</p>
        <p className="mt-0.5">
          A payslip is a list of lines — money added, money taken off. Each line here is one of
          those. You are describing, once, how each line is worked out; payroll then applies it to
          every employee, every month, without anyone recalculating anything by hand.
        </p>
        <p className="mt-1.5">
          Lines are calculated in <strong>order</strong>, top to bottom, and each one can use the
          results of the ones above it. That is how the usual chain works: Basic is a share of CTC,
          House Rent Allowance is a share of Basic, Provident Fund is a share of Basic with a
          ceiling. You choose those shapes from a list — you never have to write a formula.
        </p>
      </Callout>

      <MasterDataPage<Component>
        title="Salary components"
        description="The building blocks of a payslip — earnings, deductions and employer contributions."
        resource="/payroll/components"
        queryKey="salary-components"
        entityName="Component"
        can={can}
        permissions={{ view: "payroll.view", manage: "payroll.manage_components" }}
        emptyIcon={<Calculator className="h-6 w-6" />}
        emptyDescription="Start with Basic, then add allowances and deductions that reference it."
        columns={[
          {
            key: "order",
            header: "#",
            align: "right",
            width: "56px",
            render: (row) => <span className="tabular text-[12px]">{row.order}</span>,
          },
          {
            key: "name",
            header: "Component",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{row.name}</p>
                <p className="font-mono text-[12px] text-[var(--text-muted)]">{row.code}</p>
              </div>
            ),
          },
          {
            key: "type",
            header: "Type",
            render: (row) => (
              <Badge
                tone={
                  row.type === "earning"
                    ? "success"
                    : row.type === "deduction"
                      ? "danger"
                      : "neutral"
                }
              >
                {humanise(row.type)}
              </Badge>
            ),
          },
          {
            key: "calculation",
            header: "Calculated as",
            hideBelow: "md",
            render: (row) => {
              const calc = row.calculation;
              if (calc.method === "formula") {
                return <code className="font-mono text-[12px]">{calc.expression}</code>;
              }
              if (calc.method === "percentage") {
                return (
                  <span className="text-[12.5px]">
                    {calc.percentage}% of {calc.ofComponent}
                  </span>
                );
              }
              if (calc.method === "fixed") {
                return (
                  <span className="text-[12.5px]">{formatMoney(calc.amount, { locale, currency })}</span>
                );
              }
              return <span className="text-[12.5px]">{humanise(calc.method)}</span>;
            },
          },
          {
            key: "prorateOnAttendance",
            header: "Prorated",
            align: "center",
            hideBelow: "lg",
            render: (row) => (row.prorateOnAttendance ? "Yes" : "No"),
          },
        ]}
        fields={[
          {
            path: "name",
            label: "Name",
            required: true,
            placeholder: "House Rent Allowance",
            hint: "As the employee will read it on their payslip.",
            labelSuffix: help("name", "Name"),
          },
          {
            path: "code",
            label: "Short code",
            required: true,
            placeholder: "HRA",
            hint: "Uppercase, no spaces. Other lines use this to refer to it.",
            labelSuffix: help("code", "Short code"),
          },
          {
            path: "type",
            label: "Is this money added or taken off?",
            type: "select",
            required: true,
            labelSuffix: help("type", "Is this money added or taken off?"),
            options: [
              { value: "earning", label: "Added — an earning" },
              { value: "deduction", label: "Taken off — a deduction" },
              { value: "employer_contribution", label: "Paid by the company on top" },
              { value: "reimbursement", label: "Repaying something they spent" },
              { value: "informational", label: "Shown only, moves no money" },
            ],
          },
          {
            path: "category",
            label: "Category",
            type: "select",
            hint: "Used for grouping in reports. Does not affect the amount.",
            labelSuffix: help("category", "Category"),
            options: [
              "basic",
              "allowance",
              "bonus",
              "overtime",
              "statutory",
              "tax",
              "loan",
              "advance",
              "other",
            ].map((value) => ({ value, label: humanise(value) })),
          },
          {
            path: "order",
            label: "Calculation order",
            type: "number",
            min: 1,
            hint: "Lower runs first. A line can only use ones calculated before it.",
            labelSuffix: help("order", "Calculation order"),
          },
          {
            path: "calculation.method",
            label: "How is the amount worked out?",
            type: "select",
            colSpan: 2,
            labelSuffix: help("calculation.method", "How is the amount worked out?"),
            options: [
              { value: "fixed", label: "The same amount for everyone" },
              { value: "percentage", label: "A percentage of another line" },
              { value: "formula", label: "A step-by-step calculation (caps, thresholds, remainders)" },
              { value: "attendance_based", label: "A rate for each day worked" },
              { value: "manual", label: "Typed in on each employee's record" },
            ],
          },

          // Each branch below appears only for the method that actually reads
          // it — otherwise every option is on screen at once and someone fills
          // in a percentage the chosen method never looks at.
          {
            path: "calculation.amount",
            label: "Amount per month",
            type: "number",
            min: 0,
            showWhen: (values) => methodOf(values) === "fixed",
            labelSuffix: help("calculation.amount", "Amount per month"),
          },
          {
            path: "calculation.percentage",
            label: "Percentage",
            type: "number",
            min: 0,
            showWhen: (values) => methodOf(values) === "percentage",
            labelSuffix: help("calculation.percentage", "Percentage"),
          },
          {
            path: "calculation.ofComponent",
            label: "Percentage of which line",
            placeholder: "BASIC",
            hint: "A short code from another line, or CTC_MONTHLY.",
            showWhen: (values) => methodOf(values) === "percentage",
            labelSuffix: help("calculation.ofComponent", "Percentage of which line"),
          },
          {
            path: "calculation.expression",
            label: "The calculation",
            showWhen: (values) => methodOf(values) === "formula",
            render: ({ value, onChange }) => (
              <FormulaBuilder
                value={String(value ?? "")}
                componentCodes={variables?.componentVariables || []}
                onChange={onChange}
              />
            ),
          },

          {
            path: "prorateOnAttendance",
            label: "Reduce this when the employee was absent",
            type: "checkbox",
            colSpan: 2,
            labelSuffix: help("prorateOnAttendance", "Reduce this when the employee was absent"),
          },
          {
            path: "showOnPayslip",
            label: "Show this line on the payslip",
            type: "checkbox",
            colSpan: 2,
            labelSuffix: help("showOnPayslip", "Show this line on the payslip"),
          },
        ]}
        defaults={{
          type: "earning",
          category: "allowance",
          order: 50,
          prorateOnAttendance: true,
          showOnPayslip: true,
          includeInGross: true,
          isActive: true,
          calculation: { method: "fixed", amount: 0, rounding: "nearest_1" },
        }}
      />
    </>
  );
}
