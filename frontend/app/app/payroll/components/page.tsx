"use client";

import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatMoney, humanise } from "@/lib/format";
import { Badge, Callout, NoAccessState, UpgradeState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";

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
        <p className="font-medium">Formulas are configuration, not code</p>
        <p className="mt-0.5">
          Components are calculated in <strong>order</strong>, and each result becomes available to
          the next. That is how the usual chain is expressed entirely as data:{" "}
          <code className="font-mono text-[12px]">BASIC = pct(CTC_MONTHLY, 40)</code>, then{" "}
          <code className="font-mono text-[12px]">HRA = pct(BASIC, 50)</code>, then{" "}
          <code className="font-mono text-[12px]">PF = min(pct(BASIC, 12), 1800)</code>.
        </p>
        {variables && (
          <p className="mt-1.5 text-[12.5px]">
            Available: {variables.systemVariables.map((v) => v.code).slice(0, 8).join(", ")} and any
            component code · Functions: {variables.functions.join(", ")}
          </p>
        )}
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
          { path: "name", label: "Name", required: true, placeholder: "House Rent Allowance" },
          {
            path: "code",
            label: "Code",
            required: true,
            placeholder: "HRA",
            hint: "Uppercase. This is the name formulas use to reference it.",
          },
          {
            path: "type",
            label: "Type",
            type: "select",
            required: true,
            options: [
              "earning",
              "deduction",
              "employer_contribution",
              "reimbursement",
              "informational",
            ].map((value) => ({ value, label: humanise(value) })),
          },
          {
            path: "category",
            label: "Category",
            type: "select",
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
            hint: "Lower runs first. A component can only reference earlier ones.",
          },
          {
            path: "calculation.method",
            label: "How is it calculated?",
            type: "select",
            options: [
              { value: "fixed", label: "A fixed amount" },
              { value: "percentage", label: "A percentage of another component" },
              { value: "formula", label: "A formula" },
              { value: "attendance_based", label: "A per-day rate" },
              { value: "manual", label: "Set per employee" },
            ],
          },
          { path: "calculation.amount", label: "Fixed amount", type: "number", min: 0 },
          { path: "calculation.percentage", label: "Percentage", type: "number", min: 0 },
          {
            path: "calculation.ofComponent",
            label: "Percentage of",
            placeholder: "BASIC",
            hint: "A component code, or CTC_MONTHLY.",
          },
          {
            path: "calculation.expression",
            label: "Formula",
            type: "textarea",
            placeholder: "min(pct(BASIC, 12), 1800)",
            hint: "Rejected on save if it does not parse or references something unknown.",
          },
          {
            path: "prorateOnAttendance",
            label: "Reduce this when the employee was absent",
            type: "checkbox",
            colSpan: 2,
          },
          { path: "showOnPayslip", label: "Show on the payslip", type: "checkbox", colSpan: 2 },
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
