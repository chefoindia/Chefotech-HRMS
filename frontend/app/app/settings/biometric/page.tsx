"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  Plus,
  RefreshCw,
  Upload,
  Wifi,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useReferenceData, toOptions } from "@/lib/hooks";
import { formatRelative, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  NoAccessState,
  PageHeader,
  Select,
  StatusBadge,
  UpgradeState,
  useToast,
} from "@/components/ui";

interface Provider {
  key: string;
  name: string;
  description: string;
  mode: string;
  requiresBridge: boolean;
  recommended: boolean;
  connectionFields: Array<{ key: string; label: string; type: string; required: boolean; help?: string }>;
  capabilities: Record<string, boolean>;
}

interface Device {
  id: string;
  name: string;
  code: string;
  provider: string;
  mode: string;
  status: string;
  lastSeenAt: string | null;
  isActive: boolean;
  locationId: { name: string } | string | null;
  connection: { host?: string; baseUrl?: string; hasApiKey: boolean; hasPassword: boolean };
  sync: {
    enabled: boolean;
    intervalMinutes: number;
    lastSyncAt: string | null;
    lastSyncStatus: string;
    lastError: string | null;
  };
}

export default function BiometricSettingsPage() {
  const { session, can, hasFeature } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [importing, setImporting] = useState<Device | null>(null);

  const reference = useReferenceData(can("biometric.view"));

  const { data: providers } = useQuery({
    queryKey: ["biometric", "providers"],
    queryFn: async () => {
      const { data } = await api.get<Provider[]>("/biometric/providers");
      return data;
    },
    enabled: can("biometric.view") && hasFeature("biometric"),
    staleTime: 30 * 60_000,
  });

  const { data: devices, isLoading } = useQuery({
    queryKey: ["biometric", "devices"],
    queryFn: async () => {
      const { data } = await api.get<Device[]>("/biometric/devices");
      return data;
    },
    enabled: can("biometric.view") && hasFeature("biometric"),
  });

  const { data: unmapped } = useQuery({
    queryKey: ["biometric", "unmapped"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ deviceUserId: string; count: number }>>(
        "/biometric/unmapped"
      );
      return data;
    },
    enabled: can("biometric.view") && hasFeature("biometric"),
  });

  const test = useMutation({
    mutationFn: async (deviceId: string) => {
      const { data } = await api.post<{ ok: boolean; message: string }>(
        `/biometric/devices/${deviceId}/test`
      );
      return data;
    },
    onSuccess: (result) => setTestResult(result),
    onError: (error) => toast.fromError(error, "Could not test that device."),
  });

  const sync = useMutation({
    mutationFn: async (deviceId: string) => {
      const { data } = await api.post<{ fetched: number; punches: number; unmapped: number }>(
        `/biometric/devices/${deviceId}/sync`
      );
      return data;
    },
    onSuccess: (result) => {
      toast.success(
        "Sync complete",
        `${result.fetched} events read, ${result.punches} punches created${
          result.unmapped ? `, ${result.unmapped} unmapped` : ""
        }.`
      );
      queryClient.invalidateQueries({ queryKey: ["biometric"] });
    },
    onError: (error) => toast.fromError(error, "The sync failed."),
  });

  const reprocess = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ reprocessed: number; stillUnmapped: number }>(
        "/biometric/reprocess",
        {}
      );
      return data;
    },
    onSuccess: (result) => {
      toast.success(
        "Reprocessed",
        `${result.reprocessed} events matched an employee. ${result.stillUnmapped} still unmapped.`
      );
      queryClient.invalidateQueries({ queryKey: ["biometric"] });
    },
    onError: (error) => toast.fromError(error, "Could not reprocess events."),
  });

  if (!hasFeature("biometric")) {
    return <UpgradeState feature="Biometric devices" planName={session?.organization?.plan?.name} />;
  }
  if (!can("biometric.view")) return <NoAccessState what="biometric devices" />;

  return (
    <>
      <PageHeader
        title="Biometric devices"
        description="Attendance hardware. Raw events are stored untouched, so a mis-mapped device can always be reprocessed."
        actions={
          can("biometric.manage") && (
            <Button onClick={() => setAdding(true)} icon={<Plus className="h-4 w-4" />} data-tour="device-add">
              Add device
            </Button>
          )
        }
      />

      {unmapped && unmapped.length > 0 && (
        <Callout tone="warning" className="mb-5" icon={<AlertTriangle className="h-4 w-4" />}>
          <p className="font-medium">
            {unmapped.length} device {unmapped.length === 1 ? "ID matches" : "IDs match"} no employee
          </p>
          <p className="mt-0.5">
            Punches from {unmapped.map((row) => row.deviceUserId).slice(0, 6).join(", ")}
            {unmapped.length > 6 && ` and ${unmapped.length - 6} more`} are stored but not counted.
            Set the matching <strong>Biometric ID</strong> on those employees, then reprocess — the
            attendance appears retroactively.
          </p>
          {can("biometric.reprocess") && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              loading={reprocess.isPending}
              onClick={() => reprocess.mutate()}
            >
              Reprocess unmapped events
            </Button>
          )}
        </Callout>
      )}

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : !devices?.length ? (
        <Card>
          <EmptyState
            icon={<Fingerprint className="h-6 w-6" />}
            title="No devices yet"
            description="Connect a device over its API, have it push events to us by webhook, or simply upload the log file its own software exports."
            action={
              can("biometric.manage") ? (
                <Button onClick={() => setAdding(true)} icon={<Plus className="h-4 w-4" />}>
                  Add your first device
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {devices.map((device) => (
            <Card key={device.id}>
              <div className="flex flex-wrap items-start gap-4">
                <span
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
                    device.status === "online"
                      ? "bg-[var(--success-bg)] text-[var(--success)]"
                      : device.status === "error"
                        ? "bg-[var(--danger-bg)] text-[var(--danger)]"
                        : "bg-[var(--surface-sunken)] text-[var(--text-subtle)]"
                  )}
                >
                  <Fingerprint className="h-5 w-5" aria-hidden />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14.5px] font-semibold text-[var(--text)]">{device.name}</h3>
                    <span className="font-mono text-[12px] text-[var(--text-muted)]">
                      {device.code}
                    </span>
                    <StatusBadge status={device.status} />
                    {!device.sync.enabled && <Badge tone="neutral">Sync off</Badge>}
                  </div>

                  <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
                    {humanise(device.provider)} · {humanise(device.mode)}
                    {device.connection.host && ` · ${device.connection.host}`}
                    {device.connection.baseUrl && ` · ${device.connection.baseUrl}`}
                    {typeof device.locationId === "object" &&
                      device.locationId &&
                      ` · ${device.locationId.name}`}
                  </p>

                  <p className="mt-1 text-[12.5px] text-[var(--text-subtle)]">
                    {device.sync.lastSyncAt
                      ? `Last sync ${formatRelative(device.sync.lastSyncAt)} · ${humanise(
                          device.sync.lastSyncStatus
                        )}`
                      : "Never synced"}
                    {device.sync.enabled && ` · every ${device.sync.intervalMinutes} minutes`}
                  </p>

                  {device.sync.lastError && (
                    <p className="mt-1 text-[12.5px] text-[var(--danger)]">
                      {device.sync.lastError}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {can("biometric.manage") && (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={test.isPending}
                      onClick={() => test.mutate(device.id)}
                      icon={<Wifi className="h-3.5 w-3.5" />}
                      data-tour="device-test"
                    >
                      Test
                    </Button>
                  )}

                  {can("biometric.sync") && device.mode !== "file" && (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={sync.isPending}
                      onClick={() => sync.mutate(device.id)}
                      icon={<RefreshCw className="h-3.5 w-3.5" />}
                    >
                      Sync now
                    </Button>
                  )}

                  {can("biometric.sync") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setImporting(device)}
                      icon={<Upload className="h-3.5 w-3.5" />}
                    >
                      Upload log
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AddDeviceDialog
        open={adding}
        providers={providers || []}
        locations={reference.locations}
        onClose={() => setAdding(false)}
        onDone={() => {
          setAdding(false);
          queryClient.invalidateQueries({ queryKey: ["biometric"] });
        }}
      />

      {testResult && (
        <Modal
          open
          onClose={() => setTestResult(null)}
          title="Connection test"
          size="sm"
          footer={<Button onClick={() => setTestResult(null)}>Close</Button>}
        >
          <div data-tour="device-test-result" className="flex gap-3">
            <span
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                testResult.ok
                  ? "bg-[var(--success-bg)] text-[var(--success)]"
                  : "bg-[var(--warning-bg)] text-[var(--warning)]"
              )}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4.5 w-4.5" aria-hidden />
              ) : (
                <AlertTriangle className="h-4.5 w-4.5" aria-hidden />
              )}
            </span>
            <p className="text-[13.5px] text-[var(--text)]">{testResult.message}</p>
          </div>
        </Modal>
      )}

      {importing && (
        <ImportLogDialog
          device={importing}
          onClose={() => setImporting(null)}
          onDone={() => {
            setImporting(null);
            queryClient.invalidateQueries({ queryKey: ["biometric"] });
          }}
        />
      )}
    </>
  );
}

function AddDeviceDialog({
  open,
  providers,
  locations,
  onClose,
  onDone,
}: {
  open: boolean;
  providers: Provider[];
  locations: Array<{ id: string; name: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Record<string, unknown>>({ provider: "", name: "", code: "" });

  const provider = providers.find((item) => item.key === form.provider);

  const create = useMutation({
    mutationFn: async () => {
      const connection: Record<string, unknown> = {};
      for (const field of provider?.connectionFields || []) {
        const value = form[field.key];
        if (value === undefined || value === "") continue;
        if (field.key.startsWith("extra.")) {
          connection.extra = { ...(connection.extra as object), [field.key.slice(6)]: value };
        } else {
          connection[field.key] = value;
        }
      }

      await api.post("/biometric/devices", {
        name: form.name,
        code: String(form.code || "").toUpperCase(),
        provider: form.provider,
        mode: provider?.mode,
        locationId: form.locationId || undefined,
        connection,
      });
    },
    onSuccess: () => {
      toast.success("Device added", "Test the connection, then set the employees' biometric IDs.");
      setForm({ provider: "", name: "", code: "" });
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not add that device."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a biometric device"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!form.provider || !form.name || !form.code}
            onClick={() => create.mutate()}
            data-tour="device-save"
          >
            Add device
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-tour="device-form">
        <Select
          label="How will it connect?"
          value={String(form.provider || "")}
          onChange={(event) => setForm({ ...form, provider: event.target.value })}
          options={providers.map((item) => ({
            value: item.key,
            label: `${item.name}${item.recommended ? " (recommended)" : ""}`,
          }))}
          placeholder="Choose a connection type"
          data-tour="device-provider"
        />

        {provider && (
          <Callout tone={provider.requiresBridge ? "warning" : "info"}>
            {provider.description}
          </Callout>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Device name"
            required
            value={String(form.name || "")}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Main Gate Reader"
            data-tour="device-name"
          />
          <Input
            label="Code"
            required
            value={String(form.code || "")}
            onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            placeholder="GATE1"
            data-tour="device-code"
          />
        </div>

        <Select
          label="Work location"
          value={String(form.locationId || "")}
          onChange={(event) => setForm({ ...form, locationId: event.target.value })}
          options={locations.map((location) => ({ value: location.id, label: location.name }))}
          placeholder="Not assigned"
          hint="The location decides which timezone the device's clock is read in."
          data-tour="device-location"
        />

        {provider?.connectionFields.map((field) => (
          <Input
            key={field.key}
            label={field.label}
            required={field.required}
            hint={field.help}
            type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
            value={String(form[field.key] || "")}
            onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
          />
        ))}
      </div>
    </Modal>
  );
}

function ImportLogDialog({
  device,
  onClose,
  onDone,
}: {
  device: Device;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.upload<{
        parsed: number;
        created: number;
        punches: number;
        unmapped: number;
        skipped: Array<{ row: number; reason: string }>;
      }>(`/biometric/devices/${device.id}/import`, formData);
      return data;
    },
    onSuccess: (result) => {
      toast.success(
        "Log imported",
        `${result.parsed} rows read, ${result.punches} punches created${
          result.unmapped ? `, ${result.unmapped} unmapped` : ""
        }.`
      );
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not import that log file."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Upload a log from ${device.name}`}
      description="Export the attendance log from the device's own software and upload it here."
      size="sm"
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        <Callout tone="info">
          Re-uploading the same file is safe. Events are deduplicated by device, user and
          timestamp, so nothing is counted twice.
        </Callout>

        <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius)] border-2 border-dashed hover:border-brand-400 hover:bg-brand-50/40">
          <Upload className="h-5 w-5 text-[var(--text-subtle)]" aria-hidden />
          <span className="text-[13px] text-[var(--text-muted)]">
            {upload.isPending ? "Importing…" : "Choose a CSV or Excel file"}
          </span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            className="hidden"
            disabled={upload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>
    </Modal>
  );
}
