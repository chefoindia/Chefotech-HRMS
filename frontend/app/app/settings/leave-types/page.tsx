"use client";

import { CalendarDays } from "lucide-react";
import { useSession } from "@/lib/session";
import { Badge, Callout, NoAccessState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";
import type { LeaveType } from "@/lib/types";

interface LeaveTypeRow extends LeaveType {
  hasBalance: boolean;
  isCompOff: boolean;
  order: number;
  isActive: boolean;
}

export default function LeaveTypesSettingsPage() {
  const { can } = useSession();

  if (!can("leave.manage_types") && !can("leave.view")) {
    return <NoAccessState what="leave types" />;
  }

  return (
    <>
      <Callout tone="info" className="mb-5">
        Leave types are yours to define. How many days each one gives, when they are credited and
        whether weekends inside a leave are deducted are set separately, in a{" "}
        <strong>leave policy</strong> — so the same type can behave differently for staff and for
        the shop floor.
      </Callout>

      <MasterDataPage<LeaveTypeRow>
        title="Leave types"
        description="Casual, sick, earned, comp off — or whatever your organization actually calls them."
        resource="/leave/types"
        queryKey="leave-types"
        entityName="Leave type"
        aiEntity="leave_type"
        can={can}
        permissions={{ view: "leave.view", manage: "leave.manage_types" }}
        emptyIcon={<CalendarDays className="h-6 w-6" />}
        emptyDescription="Add the leave types your organization offers."
        columns={[
          {
            key: "name",
            header: "Leave type",
            render: (row) => (
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: row.colour }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{row.name}</p>
                  <p className="font-mono text-[12px] text-[var(--text-muted)]">{row.code}</p>
                </div>
              </div>
            ),
          },
          {
            key: "isPaid",
            header: "Paid",
            render: (row) =>
              row.isPaid ? <Badge tone="success">Paid</Badge> : <Badge tone="neutral">Unpaid</Badge>,
          },
          {
            key: "hasBalance",
            header: "Balance",
            hideBelow: "sm",
            render: (row) => (row.hasBalance ? "Tracked" : "Unlimited"),
          },
          {
            key: "allowHalfDay",
            header: "Half day",
            hideBelow: "md",
            render: (row) => (row.allowHalfDay ? "Allowed" : "Full days only"),
          },
          {
            key: "requiresAttachment",
            header: "Document",
            hideBelow: "lg",
            render: (row) =>
              row.requiresAttachment
                ? "Always"
                : row.attachmentRequiredAfterDays
                  ? `After ${row.attachmentRequiredAfterDays} days`
                  : "Not needed",
          },
        ]}
        fields={[
          { path: "name", label: "Name", required: true, placeholder: "Casual Leave" },
          { path: "code", label: "Code", required: true, placeholder: "CL" },
          { path: "colour", label: "Colour", type: "color" },
          { path: "order", label: "Display order", type: "number", min: 1 },
          { path: "isPaid", label: "Paid leave", type: "checkbox" },
          { path: "hasBalance", label: "Track a balance", type: "checkbox" },
          { path: "allowHalfDay", label: "Allow half days", type: "checkbox" },
          { path: "isCompOff", label: "This is compensatory off", type: "checkbox" },
          {
            path: "attachmentRequiredAfterDays",
            label: "Require a document after (days)",
            type: "number",
            min: 0,
            max: 60,
            hint: "0 means never.",
          },
          { path: "description", label: "Description", type: "textarea" },
        ]}
        defaults={{
          isPaid: true,
          hasBalance: true,
          allowHalfDay: true,
          colour: "#6366F1",
          order: 10,
          isActive: true,
        }}
      />
    </>
  );
}
