"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Sheet, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Button, Card, EmptyState, Modal, Select, useToast } from "@/components/ui";
import { BLANK_SHEET, type SheetSource, type SheetTemplate } from "@/lib/documentTemplateTypes";
import { SheetRunDialog } from "./SheetRunDialog";

/** The sheets tab: every designable spreadsheet, with download and design. */
export function SheetsPanel() {
  const router = useRouter();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<SheetTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [newSource, setNewSource] = useState("");

  const { data: sheets, isLoading } = useQuery({
    queryKey: ["sheets"],
    queryFn: async () => {
      const { data } = await api.get<SheetTemplate[]>("/sheets");
      return data;
    },
  });

  const { data: sources } = useQuery({
    queryKey: ["sheets", "sources"],
    queryFn: async () => {
      const { data } = await api.get<SheetSource[]>("/sheets/sources");
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const sourceLabel = (key: string) => sources?.find((s) => s.key === key)?.label || key;

  const seed = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ created: number }>("/sheets/seed-defaults");
      return data;
    },
    onSuccess: (result) => {
      toast.success(`${result.created} starter sheets added`, "Salary sheet, bank advice, muster roll, PF and ESI registers, and more.");
      queryClient.invalidateQueries({ queryKey: ["sheets"] });
    },
    onError: (error) => toast.fromError(error, "Could not add the starter sheets."),
  });

  const create = useMutation({
    mutationFn: async () => {
      const source = sources?.find((s) => s.key === newSource);
      const { data } = await api.post<SheetTemplate>("/sheets", {
        ...BLANK_SHEET,
        name: source ? `${source.label} sheet` : "Untitled sheet",
        code: `SHEET_${Date.now().toString(36).toUpperCase()}`,
        source: newSource,
        columns: (source?.fields || []).filter((f) => !f.sensitive).slice(0, 6).map((f) => ({ key: f.key, label: f.label, width: 16, format: (["money", "number", "integer", "percent", "date", "boolean"] as const).includes(f.type as never) ? (f.type as never) : "text" })),
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sheets"] });
      router.push(`/app/documents/sheets/${data.id}`);
    },
    onError: (error) => toast.fromError(error, "Could not create a sheet."),
  });

  const canDesign = can("report.manage_definitions");
  const active = (sheets || []).filter((s) => s.isActive || canDesign);

  return (
    <>
      {canDesign && (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          {!sheets?.length && (
            <Button variant="outline" loading={seed.isPending} onClick={() => seed.mutate()} icon={<Sparkles className="h-4 w-4" />}>
              Add the starter sheets
            </Button>
          )}
          {Boolean(sheets?.length) && (
            <Button variant="outline" loading={seed.isPending} onClick={() => seed.mutate()} icon={<Sparkles className="h-4 w-4" />}>
              Add missing starter sheets
            </Button>
          )}
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New sheet
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-28" />
          ))}
        </div>
      ) : !active.length ? (
        <Card>
          <EmptyState
            icon={<Sheet className="h-6 w-6" />}
            title="No sheets yet"
            description="Salary sheets, bank advice files, muster rolls, PF and ESI registers — start from ours, then change the columns to match what your accountant or auditor asks for."
            action={canDesign ? <Button loading={seed.isPending} onClick={() => seed.mutate()}>Add the starter sheets</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((sheet) => (
            <Card key={sheet.id} className="flex flex-col">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                  <Sheet className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-[var(--text)]">{sheet.name}</p>
                  <p className="truncate text-[12px] text-[var(--text-muted)]">
                    {sourceLabel(sheet.source)} · {sheet.columns.filter((c) => !c.hidden).length} columns
                  </p>
                </div>
                {!sheet.isActive && <Badge tone="neutral">Inactive</Badge>}
              </div>
              {sheet.description && <p className="mt-2 line-clamp-2 text-[12.5px] text-[var(--text-muted)]">{sheet.description}</p>}
              <div className="mt-4 flex gap-2">
                {canDesign && (
                  <Button variant="outline" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => router.push(`/app/documents/sheets/${sheet.id}`)}>
                    Design
                  </Button>
                )}
                <Button variant="outline" size="sm" fullWidth icon={<Download className="h-3.5 w-3.5" />} onClick={() => setRunning(sheet)} disabled={!sheet.isActive}>
                  Download
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {running && <SheetRunDialog sheet={running} onClose={() => setRunning(null)} />}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New sheet"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={!newSource} loading={create.isPending} onClick={() => create.mutate()}>
              Create and design
            </Button>
          </>
        }
      >
        <Select
          label="Build it from"
          value={newSource}
          onChange={(e) => setNewSource(e.target.value)}
          placeholder="Choose a data source"
          options={(sources || []).map((s) => ({ value: s.key, label: s.label }))}
          hint={sources?.find((s) => s.key === newSource)?.description || "Each source is one kind of row: an employee, a day of attendance, a payroll line."}
        />
      </Modal>
    </>
  );
}
