"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Eye, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { openRendered } from "@/lib/files";
import { Button, Callout, Checkbox, Input, Modal, Select, Switch, useToast } from "@/components/ui";
import type { BulkJob, DocumentTemplate } from "@/lib/documentTemplateTypes";
import { EmployeeMultiPicker, useEmployeeOptions } from "./EmployeePicker";

type TemplateSummary = Pick<DocumentTemplate, "id" | "name" | "contextType" | "storeAs">;

/** Generate one document for one employee, from any template. */
export function GenerateDialog({
  template,
  employeeId: fixedEmployeeId,
  onClose,
  onDone,
}: {
  template: TemplateSummary;
  employeeId?: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { employees } = useEmployeeOptions(!fixedEmployeeId);
  const [employeeId, setEmployeeId] = useState(fixedEmployeeId || "");
  const [visible, setVisible] = useState(template.storeAs?.visibleToEmployee !== false);
  const [requireAck, setRequireAck] = useState(Boolean(template.storeAs?.requireAcknowledgement));
  const [dueOn, setDueOn] = useState("");
  const [previewing, setPreviewing] = useState(false);

  const needsEmployee = template.contextType !== "organization";

  const store = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ document: { id: string; name: string } }>("/documents/generate", {
        templateId: template.id,
        employeeId,
        visibleToEmployee: visible,
        requireAcknowledgement: requireAck,
        acknowledgementDueOn: requireAck && dueOn ? dueOn : null,
      });
      return data;
    },
    onSuccess: (data) => {
      toast.success("Document generated", `${data.document.name} is in the employee's file${visible ? " and they have been told" : ""}.`);
      queryClient.invalidateQueries({ queryKey: ["employee", employeeId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDone?.();
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not generate that document."),
  });

  const preview = async () => {
    setPreviewing(true);
    try {
      await openRendered("/documents/generate/preview", { templateId: template.id, employeeId: employeeId || undefined });
    } catch (error) {
      toast.fromError(error, "Could not render a preview. Check the employee has the data the template needs.");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Generate: ${template.name}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" disabled={needsEmployee && !employeeId} loading={previewing} onClick={preview} icon={<Eye className="h-3.5 w-3.5" />}>
            Preview
          </Button>
          <Button loading={store.isPending} disabled={!employeeId} onClick={() => store.mutate()}>
            Generate and attach
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!fixedEmployeeId && (
          <Select
            label="Employee"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            options={employees.map((employee) => ({ value: employee.id, label: `${employee.fullName} (${employee.employeeCode})` }))}
            placeholder="Choose an employee"
          />
        )}
        <Switch label="Visible to the employee" hint="They are notified and can download it from My documents." checked={visible} onChange={setVisible} />
        <Switch label="Ask them to acknowledge it" hint="Records a timestamped, named confirmation that they read it." checked={requireAck} onChange={(v) => setRequireAck(v && visible)} disabled={!visible} />
        {requireAck && <Input label="Acknowledge by (optional)" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}
        <Callout tone="info">A preview never uses a document number. Numbers are only consumed when you generate and attach.</Callout>
      </div>
    </Modal>
  );
}

/** Generate one template for many employees; the result is a zip. */
export function BulkGenerateDialog({ template, onClose }: { template: TemplateSummary; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [visible, setVisible] = useState(template.storeAs?.visibleToEmployee !== false);
  const [requireAck, setRequireAck] = useState(Boolean(template.storeAs?.requireAcknowledgement));
  const [jobId, setJobId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ jobId: string; employees: number }>("/documents/generate/bulk", {
        templateId: template.id,
        employeeIds: selected,
        visibleToEmployee: visible,
        requireAcknowledgement: requireAck,
      });
      return data;
    },
    onSuccess: (data) => setJobId(data.jobId),
    onError: (error) => toast.fromError(error, "Could not start bulk generation."),
  });

  const { data: job } = useQuery({
    queryKey: ["documents", "bulk", jobId],
    queryFn: async () => {
      const { data } = await api.get<BulkJob>(`/documents/generate/bulk/${jobId}`);
      return data;
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" ? false : 2000;
    },
  });

  useEffect(() => {
    if (job?.status === "succeeded") {
      queryClient.invalidateQueries({ queryKey: ["documents", "bulk-downloads"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    }
  }, [job?.status, queryClient]);

  const finished = job?.status === "succeeded" || job?.status === "failed";

  return (
    <Modal
      open
      onClose={onClose}
      title={`Generate for many: ${template.name}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {finished ? "Close" : "Cancel"}
          </Button>
          {!jobId && (
            <Button loading={start.isPending} disabled={!selected.length} onClick={() => start.mutate()}>
              Generate {selected.length ? `${selected.length} document${selected.length === 1 ? "" : "s"}` : ""}
            </Button>
          )}
          {job?.status === "succeeded" && job.result?.file && (
            <a href={api.fileUrl(job.result.file.downloadUrl)} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] bg-brand-600 px-3.5 text-[13.5px] font-medium text-white hover:bg-brand-700">
              <Download className="h-4 w-4" aria-hidden />
              Download zip
            </a>
          )}
        </>
      }
    >
      {!jobId ? (
        <div className="space-y-4">
          <EmployeeMultiPicker selected={selected} onChange={setSelected} />
          <div className="flex flex-wrap gap-5">
            <Checkbox label="Visible to each employee" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
            <Checkbox label="Ask each to acknowledge" checked={requireAck} disabled={!visible} onChange={(e) => setRequireAck(e.target.checked)} />
          </div>
          <Callout tone="info">Each document is numbered, stored in the employee&apos;s file, and bundled into one zip for you. Large batches take a minute or two.</Callout>
        </div>
      ) : (
        <div className="space-y-4">
          {!finished && (
            <div className="flex items-center gap-3 rounded-md border bg-[var(--surface-muted)] p-4">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />
              <div>
                <p className="text-[13.5px] font-medium text-[var(--text)]">Generating {selected.length} documents…</p>
                <p className="text-[12.5px] text-[var(--text-muted)]">You can close this window; the finished bundle appears under Bulk downloads and you will be notified.</p>
              </div>
            </div>
          )}
          {job?.status === "succeeded" && job.result && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-md border border-[var(--success-border,#bbf7d0)] bg-[var(--success-bg)] p-4">
                <CheckCircle2 className="h-5 w-5 text-[var(--success)]" aria-hidden />
                <p className="text-[13.5px] text-[var(--text)]">
                  {job.result.generated} generated{job.result.failed ? `, ${job.result.failed} failed` : ""}.
                </p>
              </div>
              {job.result.failures.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-[12.5px] text-[var(--text-muted)]">
                  {job.result.failures.map((f) => (
                    <li key={f.employeeId}>
                      {f.employeeId}: {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {job?.status === "failed" && <Callout tone="danger">The batch failed: {job.error || "unknown error"}. Nothing was left half-done — try again.</Callout>}
        </div>
      )}
    </Modal>
  );
}
