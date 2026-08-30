"use client";

import { GitBranch } from "lucide-react";
import { useSession } from "@/lib/session";
import { humanise } from "@/lib/format";
import { Badge, Callout, NoAccessState, UpgradeState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";
import {
  WorkflowStepsEditor,
  emptyStep,
  normaliseSteps,
} from "@/components/workflow/WorkflowStepsEditor";

interface Workflow {
  id: string;
  name: string;
  code: string;
  entityType: string;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  steps: Array<{ order: number; name: string; approverType: string; mode: string }>;
}

/**
 * Approval workflows.
 *
 * A workflow is a reusable chain — reporting manager, then HR if the request
 * is long. Nothing in leave, attendance or expenses contains an approval
 * chain of its own; they raise an instance and react to the outcome, which is
 * what lets a customer restructure approvals without a release.
 */
export default function WorkflowsPage() {
  const { session, can, hasFeature } = useSession();

  if (!hasFeature("workflows")) {
    return <UpgradeState feature="Approval workflows" planName={session?.organization?.plan?.name} />;
  }
  if (!can("workflow.view")) return <NoAccessState what="workflows" />;

  return (
    <>
      <Callout tone="info" className="mb-5">
        Without a workflow, requests go to the employee&apos;s reporting manager — which is the
        right default for most organizations. Add one when you need something more: a second level
        for long leave, a department head instead of a line manager, or escalation when nobody
        acts.
      </Callout>

      <MasterDataPage<Workflow>
        title="Approval workflows"
        description="Who approves what, in which order, and what happens when nobody acts."
        resource="/workflows"
        queryKey="workflows"
        entityName="Workflow"
        aiEntity="workflow"
        can={can}
        permissions={{ view: "workflow.view", manage: "workflow.manage" }}
        emptyIcon={<GitBranch className="h-6 w-6" />}
        emptyDescription="Create one when the default single-manager approval is not enough."
        columns={[
          {
            key: "name",
            header: "Workflow",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{row.name}</p>
                <p className="font-mono text-[12px] text-[var(--text-muted)]">{row.code}</p>
              </div>
            ),
          },
          {
            key: "entityType",
            header: "Applies to",
            render: (row) => <Badge tone="brand">{humanise(row.entityType)}</Badge>,
          },
          {
            key: "steps",
            header: "Steps",
            hideBelow: "md",
            render: (row) => (
              <span className="text-[12.5px] text-[var(--text-muted)]">
                {row.steps?.length
                  ? row.steps
                      .sort((a, b) => a.order - b.order)
                      .map((step) => humanise(step.approverType))
                      .join(" → ")
                  : "No steps"}
              </span>
            ),
          },
          {
            key: "priority",
            header: "Priority",
            align: "right",
            hideBelow: "lg",
            render: (row) => row.priority,
          },
          {
            key: "isActive",
            header: "",
            align: "right",
            render: (row) => (row.isActive ? null : <Badge tone="neutral">Inactive</Badge>),
          },
        ]}
        fields={[
          { path: "name", label: "Name", required: true, placeholder: "Long leave approval" },
          { path: "code", label: "Code", required: true, placeholder: "LEAVE_LONG" },
          {
            path: "entityType",
            label: "Applies to",
            type: "select",
            required: true,
            options: [
              "leave_request",
              "attendance_correction",
              "expense_claim",
              "salary_revision",
              "overtime",
              "document_approval",
            ].map((value) => ({ value, label: humanise(value) })),
          },
          {
            path: "priority",
            label: "Priority",
            type: "number",
            min: 1,
            hint: "Lower wins when more than one workflow could apply.",
          },
          { path: "description", label: "Description", type: "textarea" },
          {
            path: "steps",
            label: "Approval steps",
            // The chain is the whole substance of a workflow. It was
            // previously fixed at one hardcoded manager step because the form
            // never collected it.
            render: ({ value, onChange }) => (
              <WorkflowStepsEditor value={value} onChange={(steps) => onChange(steps)} />
            ),
          },
        ]}
        defaults={{
          entityType: "leave_request",
          priority: 100,
          isActive: true,
          steps: [emptyStep(1)],
        }}
        // Steps must reach the API ordered from 1 with no gaps. The editor
        // keeps them that way, but a workflow saved straight from the
        // defaults never passes through it.
        beforeSave={(values) => ({ ...values, steps: normaliseSteps(values.steps) })}
      />
    </>
  );
}
