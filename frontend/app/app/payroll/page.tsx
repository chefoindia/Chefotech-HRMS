"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Lock,
  Play,
  Plus,
  Send,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatMoney, humanise } from "@/lib/format";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Modal,
  NoAccessState,
  PageHeader,
  Select,
  StatCard,
  StatusBadge,
  UpgradeState,
  useToast,
  type Column,
} from "@/components/ui";

interface PayrollRun {
  id: string;
  runNumber: number;
  type: string;
  status: string;
  periodId: { id?: string; name: string; year: number; month: number; payDate: string } | string;
  totals: {
    employeeCount: number;
    grossTotal: number;
    deductionTotal: number;
    netTotal: number;
  };
  exceptions: Array<{ employeeCode: string; message: string }>;
  processedAt: string | null;
}

interface PayrollItem {
  id: string;
  employeeSnapshot: { employeeCode: string; name: string; department: string };
  attendance: { payableDays: number; lossOfPayDays: number };
  gross: number;
  totalDeductions: number;
  net: number;
  status: string;
  breakdown: Array<{ rule: string; detail: string; effect: string }>;
}

export default function PayrollPage() {
  const { session, can, hasFeature } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const locale = session?.organization?.locale || "en-IN";
  const currency = session?.organization?.currency || "INR";

  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<"approve" | "lock" | "publish" | null>(null);
  const [inspecting, setInspecting] = useState<PayrollItem | null>(null);

  const { data: runs, isLoading } = useQuery({
    queryKey: ["payroll", "runs"],
    queryFn: async () => {
      const { data } = await api.get<PayrollRun[]>("/payroll/runs", { query: { limit: 24 } });
      return data;
    },
    enabled: can("payroll.view") && hasFeature("payroll"),
  });

  const activeRun = runs?.find((run) => run.id === selectedRun) || runs?.[0] || null;

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["payroll", "items", activeRun?.id],
    queryFn: async () => {
      const { data } = await api.get<PayrollItem[]>(`/payroll/runs/${activeRun!.id}/items`, {
        query: { limit: 200 },
      });
      return data;
    },
    enabled: Boolean(activeRun),
  });

  const process = useMutation({
    mutationFn: async () => {
      await api.post(`/payroll/runs/${activeRun!.id}/process`);
    },
    onSuccess: () => {
      toast.info("Payroll queued", "Calculation runs in the background. Refresh in a moment.");
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
    },
    onError: (error) => toast.fromError(error, "Could not start the payroll run."),
  });

  const act = useMutation({
    mutationFn: async (action: "approve" | "lock" | "publish") => {
      await api.post(`/payroll/runs/${activeRun!.id}/${action}`);
    },
    onSuccess: (_result, action) => {
      const messages = {
        approve: ["Run approved", "Payslips can now be published."],
        lock: ["Run locked", "The figures are frozen and attendance for the period is locked too."],
        publish: ["Payslips published", "Employees have been notified."],
      } as const;
      toast.success(messages[action][0], messages[action][1]);
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
    },
    onError: (error) => {
      toast.fromError(error, "Could not complete that action.");
      setConfirming(null);
    },
  });

  if (!hasFeature("payroll")) {
    return <UpgradeState feature="Payroll" planName={session?.organization?.plan?.name} />;
  }
  if (!can("payroll.view")) return <NoAccessState what="payroll" />;

  const period = activeRun && typeof activeRun.periodId === "object" ? activeRun.periodId : null;

  const columns: Array<Column<PayrollItem>> = [
    {
      key: "employee",
      header: "Employee",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
            {row.employeeSnapshot.name}
          </p>
          <p className="font-mono text-[12px] text-[var(--text-muted)]">
            {row.employeeSnapshot.employeeCode}
          </p>
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      hideBelow: "md",
      render: (row) => row.employeeSnapshot.department || "—",
    },
    {
      key: "payableDays",
      header: "Payable",
      align: "right",
      render: (row) => row.attendance.payableDays,
    },
    {
      key: "lop",
      header: "LOP",
      align: "right",
      hideBelow: "sm",
      render: (row) =>
        row.attendance.lossOfPayDays ? (
          <span className="text-[var(--warning)]">{row.attendance.lossOfPayDays}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "gross",
      header: "Gross",
      align: "right",
      render: (row) => formatMoney(row.gross, { locale, currency }),
    },
    {
      key: "deductions",
      header: "Deductions",
      align: "right",
      hideBelow: "md",
      render: (row) => formatMoney(row.totalDeductions, { locale, currency }),
    },
    {
      key: "net",
      header: "Net",
      align: "right",
      render: (row) => (
        <span className="font-semibold">{formatMoney(row.net, { locale, currency })}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Create a run, review the exceptions, approve, then publish payslips."
        actions={
          can("payroll.process") && (
            <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />} data-tour="payroll-run-create">
              New run
            </Button>
          )
        }
      />

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : !runs?.length ? (
        <Card>
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="No payroll runs yet"
            description="Before your first run, define salary components and a structure, and make sure attendance for the month is processed."
            action={
              can("payroll.process") ? (
                <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
                  Create the first run
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {runs.map((run) => {
              const runPeriod = typeof run.periodId === "object" ? run.periodId : null;
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRun(run.id)}
                  className={
                    run.id === activeRun?.id
                      ? "rounded-[calc(var(--radius)-2px)] border border-brand-400 bg-brand-50 px-3 py-1.5 text-[13px] font-medium text-brand-700"
                      : "rounded-[calc(var(--radius)-2px)] border px-3 py-1.5 text-[13px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                  }
                >
                  {runPeriod?.name || `Run ${run.runNumber}`}
                  {run.type !== "regular" && ` · ${humanise(run.type)}`}
                </button>
              );
            })}
          </div>

          {activeRun && (
            <>
              <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Employees" value={activeRun.totals.employeeCount} />
                <StatCard
                  label="Gross"
                  value={formatMoney(activeRun.totals.grossTotal, { locale, currency, compact: true })}
                />
                <StatCard
                  label="Deductions"
                  value={formatMoney(activeRun.totals.deductionTotal, { locale, currency, compact: true })}
                  tone="warning"
                />
                <StatCard
                  label="Net payable"
                  value={formatMoney(activeRun.totals.netTotal, { locale, currency, compact: true })}
                  tone="success"
                />
              </div>

              <Card className="mb-5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-[var(--text)]">
                        {period?.name || `Run ${activeRun.runNumber}`}
                      </h2>
                      <StatusBadge status={activeRun.status} />
                    </div>
                    <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
                      {period?.payDate && `Pay date ${formatDate(period.payDate, { locale })}`}
                      {activeRun.processedAt &&
                        ` · processed ${formatDate(activeRun.processedAt, { locale })}`}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {can("payroll.process") && ["draft", "processed", "failed"].includes(activeRun.status) && (
                      <Button
                        loading={process.isPending}
                        onClick={() => process.mutate()}
                        icon={<Play className="h-4 w-4" />}
                        data-tour="payroll-run-process"
                      >
                        {activeRun.status === "draft" ? "Calculate" : "Recalculate"}
                      </Button>
                    )}

                    {can("payroll.approve") && activeRun.status === "processed" && (
                      <Button
                        variant="outline"
                        onClick={() => setConfirming("approve")}
                        icon={<CheckCircle2 className="h-4 w-4" />}
                        data-tour="payroll-run-approve"
                      >
                        Approve
                      </Button>
                    )}

                    {can("payroll.lock") && activeRun.status === "approved" && (
                      <Button
                        variant="outline"
                        onClick={() => setConfirming("lock")}
                        icon={<Lock className="h-4 w-4" />}
                      >
                        Lock
                      </Button>
                    )}

                    {can("payroll.publish_payslips") &&
                      ["approved", "locked", "paid"].includes(activeRun.status) && (
                        <Button
                          onClick={() => setConfirming("publish")}
                          icon={<Send className="h-4 w-4" />}
                          data-tour="payroll-run-publish"
                        >
                          Publish payslips
                        </Button>
                      )}

                    {can("payroll.export") && (
                      <Button
                        variant="outline"
                        icon={<Download className="h-4 w-4" />}
                        onClick={() =>
                          api
                            .download("/reports/bank_transfer/run", {
                              runId: activeRun.id,
                              format: "xlsx",
                            })
                            .catch((error) => toast.fromError(error))
                        }
                      >
                        Bank statement
                      </Button>
                    )}
                  </div>
                </div>

                {activeRun.exceptions?.length > 0 && (
                  <Callout tone="warning" className="mt-4" icon={<AlertTriangle className="h-4 w-4" />}>
                    <p className="font-medium">
                      {activeRun.exceptions.length}{" "}
                      {activeRun.exceptions.length === 1 ? "employee" : "employees"} could not be
                      calculated
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {activeRun.exceptions.slice(0, 5).map((exception, index) => (
                        <li key={index}>
                          <span className="font-mono">{exception.employeeCode}</span> —{" "}
                          {exception.message}
                        </li>
                      ))}
                    </ul>
                    {activeRun.exceptions.length > 5 && (
                      <p className="mt-1">…and {activeRun.exceptions.length - 5} more.</p>
                    )}
                    <p className="mt-1.5">These must be resolved before the run can be approved.</p>
                  </Callout>
                )}
              </Card>

              <div data-tour="payroll-run-items">
                <DataTable
                  columns={columns}
                  rows={items || []}
                  rowKey={(row) => row.id}
                  loading={itemsLoading}
                  dense
                  onRowClick={(row) => setInspecting(row)}
                  emptyTitle="Nothing calculated yet"
                  emptyDescription="Run the calculation to see each employee's payslip."
                />
              </div>
            </>
          )}
        </>
      )}

      <CreateRunDialog
        open={creating}
        onClose={() => setCreating(false)}
        onDone={(runId) => {
          setCreating(false);
          setSelectedRun(runId);
          queryClient.invalidateQueries({ queryKey: ["payroll"] });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) act.mutate(confirming);
        }}
        loading={act.isPending}
        tone={confirming === "lock" ? "danger" : "primary"}
        title={
          confirming === "approve"
            ? "Approve this payroll run?"
            : confirming === "lock"
              ? "Lock this payroll run?"
              : "Publish payslips?"
        }
        confirmLabel={
          confirming === "approve" ? "Approve" : confirming === "lock" ? "Lock run" : "Publish"
        }
        message={
          confirming === "approve" ? (
            "Approval is recorded against your name in the audit trail. You can still recalculate afterwards, until the run is locked."
          ) : confirming === "lock" ? (
            <>
              Locking freezes these figures permanently and locks attendance for the period too.
              Corrections after this have to go through a supplementary run. This is deliberately
              hard to undo.
            </>
          ) : (
            "Every employee in this run will be able to see and download their payslip, and will be notified by email."
          )
        }
      />

      {inspecting && (
        <Modal
          open
          onClose={() => setInspecting(null)}
          title={`${inspecting.employeeSnapshot.name} · ${period?.name || ""}`}
          description="How this payslip was calculated."
          size="md"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[var(--radius)] border p-3">
                <p className="text-[11.5px] uppercase text-[var(--text-subtle)]">Gross</p>
                <p className="tabular mt-0.5 text-[15px] font-semibold">
                  {formatMoney(inspecting.gross, { locale, currency })}
                </p>
              </div>
              <div className="rounded-[var(--radius)] border p-3">
                <p className="text-[11.5px] uppercase text-[var(--text-subtle)]">Deductions</p>
                <p className="tabular mt-0.5 text-[15px] font-semibold">
                  {formatMoney(inspecting.totalDeductions, { locale, currency })}
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-brand-200 bg-brand-50 p-3">
                <p className="text-[11.5px] uppercase text-brand-700">Net</p>
                <p className="tabular mt-0.5 text-[15px] font-semibold text-brand-700">
                  {formatMoney(inspecting.net, { locale, currency })}
                </p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Calculation trail
              </p>
              <ul className="space-y-1.5">
                {inspecting.breakdown.map((entry, index) => (
                  <li key={index} className="flex gap-3 text-[13px]">
                    <span className="min-w-0 flex-1 text-[var(--text-muted)]">{entry.detail}</span>
                    <span className="tabular shrink-0 font-medium text-[var(--text)]">
                      {entry.effect}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function CreateRunDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (runId: string) => void;
}) {
  const toast = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [type, setType] = useState("regular");

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ id: string }>("/payroll/runs", { year, month, type });
      return data;
    },
    onSuccess: (run) => {
      toast.success("Run created", "Calculate it when the month's attendance is ready.");
      onDone(run.id);
    },
    onError: (error) => toast.fromError(error, "Could not create the run."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New payroll run"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            Create run
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-tour="payroll-run-form">
        <Callout tone="info">
          Payroll reads attendance rather than recalculating it. Process the month&apos;s attendance
          and clear any corrections first.
        </Callout>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Month"
            value={String(month)}
            onChange={(event) => setMonth(Number(event.target.value))}
            options={Array.from({ length: 12 }, (_, index) => ({
              value: index + 1,
              label: new Date(2000, index, 1).toLocaleString("en", { month: "long" }),
            }))}
            data-tour="payroll-run-period"
          />
          <Select
            label="Year"
            value={String(year)}
            onChange={(event) => setYear(Number(event.target.value))}
            options={[now.getFullYear(), now.getFullYear() - 1].map((value) => ({
              value,
              label: String(value),
            }))}
          />
        </div>

        <Select
          label="Type"
          value={type}
          onChange={(event) => setType(event.target.value)}
          options={[
            { value: "regular", label: "Regular monthly run" },
            { value: "supplementary", label: "Supplementary (corrections)" },
            { value: "bonus", label: "Bonus" },
            { value: "arrear", label: "Arrears" },
          ]}
          hint="Only one regular run is allowed per period."
        />
      </div>
    </Modal>
  );
}
