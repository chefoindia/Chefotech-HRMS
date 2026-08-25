"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useListQuery, useListState } from "@/lib/hooks";
import { setPath } from "@/lib/utils";
import {
  Button,
  Callout,
  ConfirmDialog,
  DataTable,
  Modal,
  PageHeader,
  TableToolbar,
  useToast,
  type Column,
} from "@/components/ui";

/**
 * Reference-data screens.
 *
 * Departments, designations, locations, shifts and leave types are genuinely
 * the same interaction: a searchable list, a modal form, archive-not-delete.
 * Writing five near-identical pages would mean five places for a permission or
 * validation bug to hide, so they share this one.
 *
 * Screens with real domain behaviour — attendance policies, payroll, the
 * import wizard — deliberately do NOT use this.
 */

export interface FieldDefinition {
  path: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea" | "time" | "color" | "checkbox";
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  colSpan?: 1 | 2;
  tour?: string;
  /** The info icon shown beside the label — see `<FieldHelp>`. */
  labelSuffix?: ReactNode;
  /**
   * Hide a field unless the current form values call for it. Without this
   * every branch of a "how is this calculated?" choice is on screen at once,
   * which is how someone ends up filling in a percentage that the chosen
   * method never reads.
   */
  showWhen?: (values: Record<string, unknown>) => boolean;
  /**
   * Replace the generic control entirely — for fields that need a purpose-built
   * editor rather than a text box, such as the guided salary-formula builder.
   */
  render?: (context: {
    value: unknown;
    values: Record<string, unknown>;
    onChange: (value: unknown) => void;
  }) => ReactNode;
}

export interface MasterDataPageProps<T> {
  title: string;
  description: string;
  resource: string;
  queryKey: string;
  columns: Array<Column<T>>;
  fields: FieldDefinition[];
  defaults?: Record<string, unknown>;
  permissions: { view: string; manage: string };
  can: (...permissions: string[]) => boolean;
  entityName: string;
  searchPlaceholder?: string;
  emptyIcon?: ReactNode;
  emptyDescription?: string;
  extraActions?: ReactNode;
  formTour?: string;
  addTour?: string;
  saveTour?: string;
  rowTour?: string;
  beforeSave?: (values: Record<string, unknown>) => Record<string, unknown>;
}

export function MasterDataPage<T extends { id: string }>({
  title,
  description,
  resource,
  queryKey,
  columns,
  fields,
  defaults = {},
  permissions,
  can,
  entityName,
  searchPlaceholder,
  emptyIcon,
  emptyDescription,
  extraActions,
  formTour,
  addTour,
  saveTour,
  rowTour,
  beforeSave,
}: MasterDataPageProps<T>) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const state = useListState();

  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { items, total, limit, isLoading, error, refetch } = useListQuery<T>(
    queryKey,
    resource,
    state,
    { limit: 50 }
  );

  const canManage = can(permissions.manage);

  const openNew = () => {
    setValues({ ...defaults });
    setFieldErrors({});
    setEditing("new");
  };

  const openEdit = (row: T) => {
    setValues({ ...(row as unknown as Record<string, unknown>) });
    setFieldErrors({});
    setEditing(row);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = beforeSave ? beforeSave(values) : values;
      if (editing === "new") {
        await api.post(resource, payload);
      } else if (editing) {
        await api.patch(`${resource}/${editing.id}`, payload);
      }
    },
    onSuccess: () => {
      toast.success(editing === "new" ? `${entityName} created` : `${entityName} updated`);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      queryClient.invalidateQueries({ queryKey: ["ref"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const errors: Record<string, string> = {};
        for (const [key, message] of Object.entries(err.fieldErrors)) {
          errors[key.replace(/^body\./, "")] = message;
        }
        setFieldErrors(errors);
      }
      toast.fromError(err, `Could not save this ${entityName.toLowerCase()}.`);
    },
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`${resource}/${id}`);
    },
    onSuccess: () => {
      toast.success(`${entityName} archived`);
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      queryClient.invalidateQueries({ queryKey: ["ref"] });
    },
    onError: (err) => {
      toast.fromError(err, `Could not archive this ${entityName.toLowerCase()}.`);
      setDeleting(null);
    },
  });

  const actionColumn: Column<T> = {
    key: "actions",
    header: "",
    align: "right",
    width: "110px",
    render: (row) => (
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${entityName.toLowerCase()}`}
          onClick={(event) => {
            event.stopPropagation();
            openEdit(row);
          }}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Archive ${entityName.toLowerCase()}`}
          onClick={(event) => {
            event.stopPropagation();
            setDeleting(row);
          }}
        >
          <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" aria-hidden />
        </Button>
      </div>
    ),
  };

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {extraActions}
            {canManage && (
              <Button onClick={openNew} icon={<Plus className="h-4 w-4" />} data-tour={addTour}>
                Add {entityName.toLowerCase()}
              </Button>
            )}
          </>
        }
      />

      <DataTable
        columns={canManage ? [...columns, actionColumn] : columns}
        rows={items}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        onRowClick={canManage ? openEdit : undefined}
        page={state.page}
        limit={limit}
        total={total}
        onPageChange={state.setPage}
        emptyIcon={emptyIcon}
        emptyTitle={`No ${entityName.toLowerCase()}s yet`}
        emptyDescription={emptyDescription}
        emptyAction={
          canManage ? (
            <Button size="sm" onClick={openNew} icon={<Plus className="h-4 w-4" />}>
              Add {entityName.toLowerCase()}
            </Button>
          ) : undefined
        }
        toolbar={
          <TableToolbar
            search={state.search}
            onSearchChange={state.setSearch}
            placeholder={searchPlaceholder || `Search ${entityName.toLowerCase()}s`}
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
          />
        }
      />

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === "new" ? `Add ${entityName.toLowerCase()}` : `Edit ${entityName.toLowerCase()}`}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()} data-tour={saveTour}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2" data-tour={formTour}>
          {save.error instanceof ApiError && !Object.keys(fieldErrors).length && (
            <Callout tone="danger" className="sm:col-span-2">
              {save.error.message}
            </Callout>
          )}

          {fields
            .filter((field) => !field.showWhen || field.showWhen(values))
            .map((field) => (
              <FieldControl
                key={field.path}
                field={field}
                values={values}
                value={getValue(values, field.path)}
                error={fieldErrors[field.path]}
                onChange={(value) => {
                  setValues((current) => setPath(current, field.path, value));
                  setFieldErrors((current) => ({ ...current, [field.path]: "" }));
                }}
              />
            ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) archive.mutate(deleting.id);
        }}
        loading={archive.isPending}
        tone="danger"
        title={`Archive this ${entityName.toLowerCase()}?`}
        confirmLabel="Archive"
        message={
          <>
            It stops appearing in pickers, but existing records that reference it keep working.
            You can restore it later.
          </>
        }
      />
    </>
  );
}

function FieldControl({
  field,
  value,
  values,
  error,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  values: Record<string, unknown>;
  error?: string;
  onChange: (value: unknown) => void;
}) {
  const span = field.colSpan === 2 || field.type === "textarea" ? "sm:col-span-2" : "";

  if (field.render) return <>{field.render({ value, values, onChange })}</>;

  if (field.type === "checkbox") {
    return (
      <label className={`flex items-center gap-2.5 ${span}`}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
        />
        <span className="flex items-center gap-1.5 text-[13.5px] text-[var(--text)]">
          <span>{field.label}</span>
          {field.labelSuffix}
        </span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <div className={span}>
        <label className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]">
          <span>
            {field.label}
            {field.required && <span className="ml-0.5 text-[var(--danger)]">*</span>}
          </span>
          {field.labelSuffix}
        </label>
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          data-tour={field.tour}
          className="input-base mt-1.5 cursor-pointer"
        >
          <option value="">{field.placeholder || "Choose…"}</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {(error || field.hint) && (
          <p className={`mt-1 text-[12.5px] ${error ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>
            {error || field.hint}
          </p>
        )}
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className={span}>
        <label className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]">
          <span>{field.label}</span>
          {field.labelSuffix}
        </label>
        <textarea
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          rows={2}
          placeholder={field.placeholder}
          data-tour={field.tour}
          className="input-base mt-1.5 resize-y"
        />
        {(error || field.hint) && (
          <p className={`mt-1 text-[12.5px] ${error ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>
            {error || field.hint}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={span}>
      <label className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]">
        <span>
          {field.label}
          {field.required && <span className="ml-0.5 text-[var(--danger)]">*</span>}
        </span>
        {field.labelSuffix}
      </label>
      <input
        type={field.type === "number" ? "number" : field.type === "time" ? "time" : field.type === "color" ? "color" : "text"}
        value={String(value ?? "")}
        min={field.min}
        max={field.max}
        placeholder={field.placeholder}
        data-tour={field.tour}
        aria-invalid={error ? "true" : undefined}
        onChange={(event) =>
          onChange(field.type === "number" ? Number(event.target.value) : event.target.value)
        }
        className={`input-base mt-1.5 ${field.type === "color" ? "h-9 w-20 cursor-pointer p-1" : ""}`}
      />
      {(error || field.hint) && (
        <p className={`mt-1 text-[12.5px] ${error ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>
          {error || field.hint}
        </p>
      )}
    </div>
  );
}

function getValue(object: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc === null || acc === undefined ? undefined : (acc as Record<string, unknown>)[key]),
      object
    );
}
