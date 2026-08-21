"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus, Save } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Input,
  NoAccessState,
  PageHeader,
  PageLoader,
  UpgradeState,
  useToast,
} from "@/components/ui";

interface Component {
  id: string;
  name: string;
  code: string;
  type: string;
  order: number;
}

interface Structure {
  id: string;
  name: string;
  code: string;
  description: string;
  isDefault: boolean;
  employeeCount: number;
  components: Array<{ componentId: Component | string; order: number | null }>;
}

export default function SalaryStructuresPage() {
  const { session, can, hasFeature } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");

  const { data: structures, isLoading } = useQuery({
    queryKey: ["salary-structures"],
    queryFn: async () => {
      const { data } = await api.get<Structure[]>("/payroll/structures");
      return data;
    },
    enabled: can("payroll.view") && hasFeature("payroll"),
  });

  const { data: components } = useQuery({
    queryKey: ["salary-components", "all"],
    queryFn: async () => {
      const { data } = await api.get<Component[]>("/payroll/components", { query: { limit: 100 } });
      return data;
    },
    enabled: can("payroll.view") && hasFeature("payroll"),
  });

  const active = structures?.find((structure) => structure.id === selectedId) || structures?.[0] || null;

  // Sync the editor when the selected structure changes.
  const activeId = active?.id;
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (activeId && activeId !== loadedId) {
    setLoadedId(activeId);
    setSelected(
      new Set(
        (active?.components || []).map((entry) =>
          typeof entry.componentId === "object" ? entry.componentId.id : entry.componentId
        )
      )
    );
    setName(active?.name || "");
    setDirty(false);
  }

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/payroll/structures/${active!.id}`, {
        name,
        components: [...selected].map((componentId) => ({ componentId })),
      });
    },
    onSuccess: () => {
      toast.success("Structure saved", "New payroll runs use this immediately.");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
    },
    onError: (error) => toast.fromError(error, "Could not save this structure."),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Structure>("/payroll/structures", {
        name: "New structure",
        code: `STR${Date.now().toString().slice(-5)}`,
      });
      return data;
    },
    onSuccess: (structure) => {
      toast.success("Structure created");
      setSelectedId(structure.id);
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
    },
    onError: (error) => toast.fromError(error, "Could not create a structure."),
  });

  if (!hasFeature("payroll")) {
    return <UpgradeState feature="Payroll" planName={session?.organization?.plan?.name} />;
  }
  if (!can("payroll.view")) return <NoAccessState what="salary structures" />;
  if (isLoading) return <PageLoader label="Loading structures" />;

  const canManage = can("payroll.manage_structures");

  return (
    <>
      <PageHeader
        title="Salary structures"
        description="A named set of components. Assign different structures to staff and workers, and payroll uses whichever one the employee is on."
        actions={
          canManage && (
            <Button onClick={() => create.mutate()} loading={create.isPending} icon={<Plus className="h-4 w-4" />}>
              New structure
            </Button>
          )
        }
      />

      {!structures?.length ? (
        <Card>
          <EmptyState
            icon={<Layers className="h-6 w-6" />}
            title="No salary structures yet"
            description="Create one and choose which components it includes. You need at least one before payroll can run."
            action={
              canManage ? (
                <Button onClick={() => create.mutate()} icon={<Plus className="h-4 w-4" />}>
                  Create a structure
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {structures.map((structure) => (
              <button
                key={structure.id}
                type="button"
                onClick={() => setSelectedId(structure.id)}
                className={
                  structure.id === active?.id
                    ? "rounded-[calc(var(--radius)-2px)] border border-brand-400 bg-brand-50 px-3 py-1.5 text-[13px] font-medium text-brand-700"
                    : "rounded-[calc(var(--radius)-2px)] border px-3 py-1.5 text-[13px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                }
              >
                {structure.name}
                {structure.isDefault && (
                  <span className="ml-1.5 text-[11px] text-[var(--text-subtle)]">default</span>
                )}
                <span className="ml-1.5 text-[11px] text-[var(--text-subtle)]">
                  {structure.employeeCount}
                </span>
              </button>
            ))}
          </div>

          {active && (
            <Card>
              <CardHeader
                title="Components in this structure"
                description="They calculate in order, and each one can reference the ones before it."
                action={
                  canManage && (
                    <Button
                      size="sm"
                      loading={save.isPending}
                      disabled={!dirty}
                      onClick={() => save.mutate()}
                      icon={<Save className="h-3.5 w-3.5" />}
                    >
                      Save
                    </Button>
                  )
                }
              />

              <div className="mt-5">
                <Input
                  label="Structure name"
                  value={name}
                  disabled={!canManage}
                  onChange={(event) => {
                    setName(event.target.value);
                    setDirty(true);
                  }}
                />
              </div>

              {!components?.length ? (
                <Callout tone="warning" className="mt-5">
                  No salary components exist yet. Create them first — a structure is just a
                  selection of components.
                </Callout>
              ) : (
                <div className="mt-5 space-y-1">
                  {[...components]
                    .sort((a, b) => a.order - b.order)
                    .map((component) => (
                      <label
                        key={component.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-md p-2.5",
                          canManage && "hover:bg-[var(--surface-muted)]"
                        )}
                      >
                        <input
                          type="checkbox"
                          disabled={!canManage}
                          checked={selected.has(component.id)}
                          onChange={(event) => {
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(component.id);
                              else next.delete(component.id);
                              return next;
                            });
                            setDirty(true);
                          }}
                          className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
                        />

                        <span className="tabular w-8 text-[12px] text-[var(--text-subtle)]">
                          {component.order}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium text-[var(--text)]">
                            {component.name}
                          </span>
                          <span className="block font-mono text-[11.5px] text-[var(--text-muted)]">
                            {component.code}
                          </span>
                        </span>

                        <Badge
                          tone={
                            component.type === "earning"
                              ? "success"
                              : component.type === "deduction"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {humanise(component.type)}
                        </Badge>
                      </label>
                    ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
