"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Laptop, Package, Plus, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState, useReferenceData } from "@/lib/hooks";
import { formatDate, formatMoney, formatRelative, humanise } from "@/lib/format";
import { Badge, Button, DataTable, Drawer, FieldGrid, FilterSelect, Input, Modal, NoAccessState, PageHeader, Select, StatCard, StatusBadge, TableToolbar, Textarea, useToast, type Column } from "@/components/ui";
import { useEmployeeOptions } from "@/components/documents/EmployeePicker";
import { ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_STATUSES, type Asset, type AssetStats } from "@/lib/moduleTypes";

const STATUS_MAP: Record<string, string> = { available: "active", assigned: "processing", in_repair: "pending", lost: "rejected", retired: "cancelled" };

/** The asset register. */
export default function AssetsPage() {
  const { session, can } = useSession();
  const currency = session?.organization?.currency || "INR";
  const locale = session?.organization?.locale || "en-IN";
  const state = useListState();
  const [editing, setEditing] = useState<Asset | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: stats } = useQuery({ queryKey: ["assets", "stats"], queryFn: async () => (await api.get<AssetStats>("/assets/stats")).data, enabled: can("asset.view") });
  const { items, total, limit, isLoading, error, refetch } = useListQuery<Asset>("assets", "/assets", state, { limit: 30, enabled: can("asset.view") });

  if (!can("asset.view")) return <NoAccessState what="assets" />;

  const columns: Array<Column<Asset>> = [
    { key: "tag", header: "Tag", width: "7rem", render: (a) => <span className="font-mono text-[12px]">{a.tag}</span> },
    {
      key: "name",
      header: "Asset",
      render: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--text)]">{a.name}</p>
          <p className="truncate text-[12px] text-[var(--text-muted)]">
            {humanise(a.category)}
            {a.make || a.model ? ` · ${[a.make, a.model].filter(Boolean).join(" ")}` : ""}
            {a.serialNumber ? ` · ${a.serialNumber}` : ""}
          </p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={STATUS_MAP[a.status] || a.status} label={humanise(a.status)} /> },
    { key: "assignedTo", header: "With", hideBelow: "md", render: (a) => (a.assignedTo ? `${a.assignedTo.name} (${a.assignedTo.employeeCode})` : <span className="text-[var(--text-subtle)]">—</span>) },
    { key: "condition", header: "Condition", hideBelow: "lg", render: (a) => humanise(a.condition) },
    { key: "warrantyUntil", header: "Warranty", hideBelow: "lg", render: (a) => (a.warrantyUntil ? <span className={a.warrantyExpired ? "text-[var(--danger)]" : ""}>{formatDate(a.warrantyUntil, { locale })}</span> : "—") },
  ];

  return (
    <>
      <PageHeader
        title="Assets"
        description="Every laptop, phone, card and tool the company owns, who has it, and what it is worth."
        actions={
          can("asset.manage") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
              Add asset
            </Button>
          )
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total" value={stats?.total ?? "—"} hint={stats ? formatMoney(stats.totalValue, { currency, locale, compact: true }) : undefined} icon={<Package className="h-4 w-4" />} />
        <StatCard label="Assigned" value={stats?.assigned ?? "—"} icon={<Laptop className="h-4 w-4" />} onClick={() => state.setFilter("status", "assigned")} />
        <StatCard label="Available" value={stats?.available ?? "—"} tone="success" onClick={() => state.setFilter("status", "available")} />
        <StatCard label="In repair" value={stats?.inRepair ?? "—"} icon={<Wrench className="h-4 w-4" />} tone={stats?.inRepair ? "warning" : "default"} onClick={() => state.setFilter("status", "in_repair")} />
        <StatCard label="Needs attention" value={stats ? stats.overdueReturns + stats.warrantyExpiring : "—"} hint={stats ? `${stats.overdueReturns} overdue return${stats.overdueReturns === 1 ? "" : "s"}, ${stats.warrantyExpiring} warranties ending` : undefined} icon={<AlertTriangle className="h-4 w-4" />} tone={stats && stats.overdueReturns + stats.warrantyExpiring ? "danger" : "default"} />
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(a) => a.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        onRowClick={(a) => setOpenId(a.id)}
        page={state.page}
        limit={limit}
        total={total}
        onPageChange={state.setPage}
        emptyIcon={<Package className="h-6 w-6" />}
        emptyTitle="No assets yet"
        emptyDescription="Add the laptops, phones and cards you hand out, then assign them to people."
        toolbar={
          <TableToolbar
            search={state.search}
            onSearchChange={state.setSearch}
            placeholder="Search tag, name, serial"
            filters={
              <>
                <FilterSelect value={state.filters.status || ""} onChange={(v) => state.setFilter("status", v)} placeholder="Any status" options={ASSET_STATUSES.map((s) => ({ value: s, label: humanise(s) }))} />
                <FilterSelect value={state.filters.category || ""} onChange={(v) => state.setFilter("category", v)} placeholder="Any category" options={ASSET_CATEGORIES.map((c) => ({ value: c, label: humanise(c) }))} />
              </>
            }
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
          />
        }
      />

      {editing && <AssetDialog asset={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {openId && <AssetDrawer assetId={openId} onClose={() => setOpenId(null)} onEdit={(a) => { setOpenId(null); setEditing(a); }} />}
    </>
  );
}

function AssetDialog({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { locations } = useReferenceData();
  const [form, setForm] = useState({
    tag: asset?.tag || "",
    name: asset?.name || "",
    category: asset?.category || "laptop",
    make: asset?.make || "",
    model: asset?.model || "",
    serialNumber: asset?.serialNumber || "",
    purchaseDate: asset?.purchaseDate ? asset.purchaseDate.slice(0, 10) : "",
    purchaseCost: asset?.purchaseCost ?? "",
    vendor: asset?.vendor || "",
    warrantyUntil: asset?.warrantyUntil ? asset.warrantyUntil.slice(0, 10) : "",
    locationId: asset?.location?.id || "",
    condition: asset?.condition || "good",
    status: asset?.status || "available",
    notes: asset?.notes || "",
  });
  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...form, tag: form.tag || undefined, purchaseCost: form.purchaseCost === "" ? null : Number(form.purchaseCost), purchaseDate: form.purchaseDate || null, warrantyUntil: form.warrantyUntil || null, locationId: form.locationId || null };
      if (asset) {
        const { status, ...rest } = body;
        await api.patch(`/assets/${asset.id}`, asset.status === "assigned" ? rest : body);
        void status;
      } else await api.post("/assets", body);
    },
    onSuccess: () => {
      toast.success(asset ? "Saved" : "Asset added");
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not save the asset."),
  });

  return (
    <Modal open onClose={onClose} title={asset ? `Edit ${asset.tag}` : "Add an asset"} size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>{asset ? "Save" : "Add"}</Button></>}>
      <div className="space-y-4">
        <FieldGrid columns={2}>
          <Input label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. MacBook Air 13" required />
          <Input label="Tag" value={form.tag} onChange={(e) => set("tag", e.target.value.toUpperCase())} placeholder="Auto (e.g. LT-0007)" hint="Printed on the label. Leave blank to number it." disabled={Boolean(asset)} />
          <Select label="Category" value={form.category} onChange={(e) => set("category", e.target.value)} options={ASSET_CATEGORIES.map((c) => ({ value: c, label: humanise(c) }))} />
          <Select label="Condition" value={form.condition} onChange={(e) => set("condition", e.target.value)} options={ASSET_CONDITIONS.map((c) => ({ value: c, label: humanise(c) }))} />
          <Input label="Make" value={form.make} onChange={(e) => set("make", e.target.value)} />
          <Input label="Model" value={form.model} onChange={(e) => set("model", e.target.value)} />
          <Input label="Serial number" value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} />
          <Select label="Location" value={form.locationId} onChange={(e) => set("locationId", e.target.value)} placeholder="—" options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Purchased on" type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} />
          <Input label="Cost" type="number" min={0} value={form.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value)} />
          <Input label="Vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} />
          <Input label="Warranty until" type="date" value={form.warrantyUntil} onChange={(e) => set("warrantyUntil", e.target.value)} />
          {asset && asset.status !== "assigned" && <Select label="Status" value={form.status} onChange={(e) => set("status", e.target.value)} options={ASSET_STATUSES.filter((s) => s !== "assigned").map((s) => ({ value: s, label: humanise(s) }))} />}
        </FieldGrid>
        <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
    </Modal>
  );
}

function AssetDrawer({ assetId, onClose, onEdit }: { assetId: string; onClose: () => void; onEdit: (asset: Asset) => void }) {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currency = session?.organization?.currency || "INR";
  const locale = session?.organization?.locale || "en-IN";
  const { employees } = useEmployeeOptions(can("asset.manage"));
  const [assigning, setAssigning] = useState(false);
  const [returning, setReturning] = useState(false);
  const [assign, setAssign] = useState({ employeeId: "", expectedReturnOn: "", condition: "", notes: "" });
  const [ret, setRet] = useState({ condition: "", notes: "", recoveryAmount: "", newStatus: "available" });

  const { data: asset, isLoading } = useQuery({ queryKey: ["assets", assetId], queryFn: async () => (await api.get<Asset>(`/assets/${assetId}`)).data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["assets"] });

  const doAssign = useMutation({
    mutationFn: () => api.post(`/assets/${assetId}/assign`, { employeeId: assign.employeeId, expectedReturnOn: assign.expectedReturnOn || null, condition: assign.condition || undefined, notes: assign.notes }),
    onSuccess: () => { toast.success("Assigned", "The employee has been notified and asked to confirm receipt."); setAssigning(false); refresh(); },
    onError: (error) => toast.fromError(error, "Could not assign."),
  });
  const doReturn = useMutation({
    mutationFn: () => api.post(`/assets/${assetId}/return`, { condition: ret.condition || undefined, notes: ret.notes, recoveryAmount: ret.recoveryAmount ? Number(ret.recoveryAmount) : undefined, newStatus: ret.newStatus }),
    onSuccess: () => { toast.success("Return recorded"); setReturning(false); refresh(); },
    onError: (error) => toast.fromError(error, "Could not record the return."),
  });

  return (
    <Drawer open onClose={onClose} title={asset ? `${asset.tag} · ${asset.name}` : "Asset"} width="lg" footer={
      asset && can("asset.manage") ? (
        <>
          <Button variant="outline" onClick={() => onEdit(asset)}>Edit</Button>
          {asset.status === "assigned" ? <Button onClick={() => setReturning(true)}>Record return</Button> : ["available", "in_repair"].includes(asset.status) ? <Button onClick={() => setAssigning(true)}>Assign</Button> : null}
        </>
      ) : undefined
    }>
      {isLoading || !asset ? (
        <div className="skeleton h-40" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={STATUS_MAP[asset.status] || asset.status} label={humanise(asset.status)} />
            <Badge tone="neutral">{humanise(asset.category)}</Badge>
            <Badge tone={asset.condition === "damaged" || asset.condition === "poor" ? "warning" : "neutral"}>{humanise(asset.condition)}</Badge>
            {asset.warrantyExpired && <Badge tone="danger">Warranty expired</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            {[
              ["Make / model", [asset.make, asset.model].filter(Boolean).join(" ") || "—"],
              ["Serial", asset.serialNumber || "—"],
              ["Purchased", asset.purchaseDate ? `${formatDate(asset.purchaseDate, { locale })}${asset.vendor ? ` from ${asset.vendor}` : ""}` : "—"],
              ["Cost", asset.purchaseCost ? formatMoney(asset.purchaseCost, { currency, locale }) : "—"],
              ["Warranty until", asset.warrantyUntil ? formatDate(asset.warrantyUntil, { locale }) : "—"],
              ["Location", asset.location?.name || "—"],
              ["With", asset.assignedTo ? `${asset.assignedTo.name} (${asset.assignedTo.employeeCode})` : "Nobody"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">{k}</dt>
                <dd className="text-[var(--text)]">{v}</dd>
              </div>
            ))}
          </dl>
          {asset.notes && <p className="rounded-md border bg-[var(--surface-muted)] p-3 text-[13px]">{asset.notes}</p>}

          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">History</p>
            {!asset.history?.length ? (
              <p className="text-[12.5px] text-[var(--text-muted)]">Never assigned.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {asset.history.map((h) => (
                  <li key={h.id} className="px-3 py-2 text-[12.5px]">
                    <p className="text-[var(--text)]">
                      <strong>{h.employee.name}</strong> ({h.employee.employeeCode}) · {formatDate(h.assignedOn, { locale })} → {h.returnedOn ? formatDate(h.returnedOn, { locale }) : "now"}
                    </p>
                    <p className="text-[var(--text-muted)]">
                      Given in {h.conditionAtAssignment} condition{h.returnedOn ? `, returned ${h.conditionAtReturn || "—"}${h.recoveryAmount ? `, ${formatMoney(h.recoveryAmount, { currency, locale })} recovered` : ""}` : ""}
                      {h.acknowledgedAt ? ` · receipt confirmed ${formatRelative(h.acknowledgedAt)}` : h.returnedOn ? "" : " · receipt not yet confirmed"}
                      {h.isOverdue ? " · return overdue" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {assigning && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-[13px] font-medium">Assign to</p>
              <Select value={assign.employeeId} onChange={(e) => setAssign({ ...assign, employeeId: e.target.value })} placeholder="Choose an employee" options={employees.map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))} />
              <FieldGrid columns={2}>
                <Input label="Expected return (optional)" type="date" value={assign.expectedReturnOn} onChange={(e) => setAssign({ ...assign, expectedReturnOn: e.target.value })} />
                <Select label="Condition now" value={assign.condition} onChange={(e) => setAssign({ ...assign, condition: e.target.value })} placeholder={humanise(asset.condition)} options={ASSET_CONDITIONS.map((c) => ({ value: c, label: humanise(c) }))} />
              </FieldGrid>
              <Input label="Notes (optional)" value={assign.notes} onChange={(e) => setAssign({ ...assign, notes: e.target.value })} placeholder="Charger and bag included" />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setAssigning(false)}>Cancel</Button>
                <Button size="sm" loading={doAssign.isPending} disabled={!assign.employeeId} onClick={() => doAssign.mutate()}>Assign</Button>
              </div>
            </div>
          )}

          {returning && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-[13px] font-medium">Record return from {asset.assignedTo?.name}</p>
              <FieldGrid columns={2}>
                <Select label="Condition on return" value={ret.condition} onChange={(e) => setRet({ ...ret, condition: e.target.value })} placeholder={humanise(asset.condition)} options={ASSET_CONDITIONS.map((c) => ({ value: c, label: humanise(c) }))} />
                <Select label="Then mark it" value={ret.newStatus} onChange={(e) => setRet({ ...ret, newStatus: e.target.value })} options={[{ value: "available", label: "Available" }, { value: "in_repair", label: "In repair" }, { value: "lost", label: "Lost" }, { value: "retired", label: "Retired" }]} />
              </FieldGrid>
              <Input label="Notes" value={ret.notes} onChange={(e) => setRet({ ...ret, notes: e.target.value })} />
              {can("payroll.process") && <Input label="Recover from salary (optional)" type="number" min={0} value={ret.recoveryAmount} onChange={(e) => setRet({ ...ret, recoveryAmount: e.target.value })} hint="For loss or damage — filed as a payroll deduction." />}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setReturning(false)}>Cancel</Button>
                <Button size="sm" loading={doReturn.isPending} onClick={() => doReturn.mutate()}>Record return</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
