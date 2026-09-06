"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { api } from "@/lib/api";
import { openRendered, saveRendered } from "@/lib/files";
import { useSession } from "@/lib/session";
import { Button, Callout, Modal, Select, useToast } from "@/components/ui";
import type { SheetFilters, SheetSource, SheetTemplate } from "@/lib/documentTemplateTypes";
import { SheetFilterFields } from "./SheetFilters";

/**
 * "Download this sheet": pick the period or run, pick a format, go.
 * The same filters drive the designer's preview, so what you saw is what
 * you get.
 */
export function SheetRunDialog({ sheet, onClose }: { sheet: Pick<SheetTemplate, "id" | "name" | "source" | "filters">; onClose: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const [filters, setFilters] = useState<SheetFilters>((sheet.filters || {}) as SheetFilters);
  const [format, setFormat] = useState<"xlsx" | "csv" | "pdf">("xlsx");
  const [busy, setBusy] = useState<"download" | "preview" | null>(null);

  const { data: sources } = useQuery({
    queryKey: ["sheets", "sources"],
    queryFn: async () => {
      const { data } = await api.get<SheetSource[]>("/sheets/sources");
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const source = sources?.find((s) => s.key === sheet.source);

  const ready = !source || ((!source.requiresDateRange || (filters.fromDate && filters.toDate)) && (!source.requiresRun || filters.runId));

  const download = async () => {
    setBusy("download");
    try {
      const name = await saveRendered(`/sheets/${sheet.id}/render`, { filters, format }, `${sheet.name}.${format}`);
      toast.success("Downloaded", name);
      onClose();
    } catch (error) {
      toast.fromError(error, "Could not produce that sheet.");
    } finally {
      setBusy(null);
    }
  };

  const previewPdf = async () => {
    setBusy("preview");
    try {
      await openRendered(`/sheets/${sheet.id}/render`, { filters, format: "pdf" });
    } catch (error) {
      toast.fromError(error, "Could not produce a preview.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Download: ${sheet.name}`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" icon={<Eye className="h-3.5 w-3.5" />} disabled={!ready} loading={busy === "preview"} onClick={previewPdf}>
            Preview PDF
          </Button>
          <Button icon={<Download className="h-3.5 w-3.5" />} disabled={!ready || !can("report.export")} loading={busy === "download"} onClick={download}>
            Download {format.toUpperCase()}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {source && source.filters.length > 0 && (
          <SheetFilterFields keys={source.filters.filter((k) => k !== "employeeIds")} value={filters} onChange={setFilters} requiresDateRange={source.requiresDateRange} requiresRun={source.requiresRun} columns={2} />
        )}
        <Select
          label="Format"
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
          options={[
            { value: "xlsx", label: "Excel workbook (.xlsx)" },
            { value: "csv", label: "CSV" },
            { value: "pdf", label: "PDF" },
          ]}
        />
        {!can("report.export") && <Callout tone="warning">You can preview sheets but need the &quot;export reports&quot; permission to download them.</Callout>}
      </div>
    </Modal>
  );
}
