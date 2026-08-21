"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  NoAccessState,
  PageHeader,
  useToast,
} from "@/components/ui";

interface AnalyseResult {
  totalRows: number;
  headers: string[];
  suggestedMapping: Record<string, string>;
  targets: Array<{ key: string; label: string; required: boolean; lookup: string | null }>;
  sample: Array<Record<string, unknown>>;
  rows: Array<Record<string, unknown>>;
}

interface ValidationResult {
  total: number;
  validCount: number;
  invalidCount: number;
  errorReport: Array<{
    rowNumber: number;
    employeeCode: string;
    name: string;
    errors: Array<{ field: string; message: string }>;
  }>;
}

interface CommitResult {
  total: number;
  importedCount: number;
  failedCount: number;
  failed: ValidationResult["errorReport"];
}

const STEPS = ["Upload", "Map columns", "Validate", "Import"] as const;

/**
 * Bulk employee import.
 *
 * Four explicit steps, and nothing is written until the last one. A silent
 * partial import is the worst thing a product can do to a customer's employee
 * data, so every problem row is shown with its reason before the user commits,
 * and rejected rows are reported back afterwards rather than quietly dropped.
 */
export default function ImportEmployeesPage() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();

  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<AnalyseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const analyse = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.upload<AnalyseResult>("/employees/import/analyse", formData);
      return data;
    },
    onSuccess: (data) => {
      setAnalysis(data);
      setMapping(data.suggestedMapping);
      setStep(1);
      toast.success(
        `${data.totalRows} rows read`,
        "Nothing has been saved yet. Check the column mapping next."
      );
    },
    onError: (error) => toast.fromError(error, "Could not read that file."),
  });

  const validate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<ValidationResult>("/employees/import/validate", {
        rows: analysis!.rows,
        mapping,
      });
      return data;
    },
    onSuccess: (data) => {
      setValidation(data);
      setStep(2);
    },
    onError: (error) => toast.fromError(error, "Could not validate those rows."),
  });

  const commit = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<CommitResult>("/employees/import/commit", {
        rows: analysis!.rows,
        mapping,
        skipInvalid: true,
      });
      return data;
    },
    onSuccess: (data) => {
      setResult(data);
      setStep(3);
      toast.success(
        `${data.importedCount} employees imported`,
        data.failedCount ? `${data.failedCount} rows were rejected.` : undefined
      );
    },
    onError: (error) => toast.fromError(error, "The import could not be completed."),
  });

  const downloadTemplate = async () => {
    try {
      await api.download("/employees/import/template", {}, "employee-import-template.xlsx");
    } catch (error) {
      toast.fromError(error, "Could not download the template.");
    }
  };

  if (!can("employee.import")) return <NoAccessState what="employee import" />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Import employees"
        description="Bring your existing employee list in from a spreadsheet."
        breadcrumb={
          <Link
            href="/app/employees"
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Employees
          </Link>
        }
      />

      {/* ── Steps ────────────────────────────────────────────────── */}
      <ol className="mb-6 flex items-center gap-2">
        {STEPS.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold",
                index < step
                  ? "bg-[var(--success)] text-white"
                  : index === step
                    ? "bg-brand-600 text-white"
                    : "bg-[var(--surface-sunken)] text-[var(--text-subtle)]"
              )}
            >
              {index < step ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : index + 1}
            </span>
            <span
              className={cn(
                "hidden text-[13px] sm:block",
                index === step ? "font-medium text-[var(--text)]" : "text-[var(--text-muted)]"
              )}
            >
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
            )}
          </li>
        ))}
      </ol>

      {/* ── Step 1: upload ───────────────────────────────────────── */}
      {step === 0 && (
        <Card>
          <CardHeader
            title="Upload your file"
            description="CSV or Excel. Nothing is saved at this stage — we only read the columns."
          />

          <Callout tone="info" className="mt-4">
            Departments, designations and locations must already exist — the file refers to them
            by code. Create those first if you have not.
          </Callout>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              variant="outline"
              onClick={downloadTemplate}
              icon={<Download className="h-4 w-4" />}
              data-tour="import-template"
            >
              Download the template
            </Button>

            <label
              className="inline-flex h-9.5 cursor-pointer items-center justify-center gap-2 rounded-[calc(var(--radius)-2px)] bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              data-tour="import-upload"
            >
              <Upload className="h-4 w-4" aria-hidden />
              {analyse.isPending ? "Reading…" : "Choose a file"}
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                disabled={analyse.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) analyse.mutate(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          <p className="mt-4 text-[12.5px] text-[var(--text-muted)]">
            The template already includes any custom fields you have created, plus a sheet
            explaining what every column accepts.
          </p>
        </Card>
      )}

      {/* ── Step 2: mapping ──────────────────────────────────────── */}
      {step === 1 && analysis && (
        <Card data-tour="import-mapping">
          <CardHeader
            title="Check the column mapping"
            description={`${analysis.totalRows} rows read. We guessed the mapping from your headers — correct anything that is wrong.`}
          />

          <div className="mt-5 space-y-2">
            {analysis.headers.map((header) => {
              const sampleValue = analysis.sample[0]?.[header];
              return (
                <div
                  key={header}
                  className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{header}</p>
                    <p className="truncate text-[12px] text-[var(--text-muted)]">
                      e.g. {String(sampleValue ?? "—").slice(0, 40)}
                    </p>
                  </div>

                  <span className="text-[var(--text-subtle)]" aria-hidden>
                    →
                  </span>

                  <select
                    value={mapping[header] || ""}
                    onChange={(event) =>
                      setMapping({ ...mapping, [header]: event.target.value })
                    }
                    className="input-base h-9 w-56 py-0 text-[13px]"
                  >
                    <option value="">Ignore this column</option>
                    {analysis.targets.map((target) => (
                      <option key={target.key} value={target.key}>
                        {target.label}
                        {target.required ? " *" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button
              loading={validate.isPending}
              onClick={() => validate.mutate()}
              data-tour="import-validate"
            >
              Validate rows
            </Button>
          </div>
        </Card>
      )}

      {/* ── Step 3: validation ───────────────────────────────────── */}
      {step === 2 && validation && (
        <Card data-tour="import-results">
          <CardHeader
            title="Validation results"
            description="Still nothing saved. Review the problems below before importing."
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--radius)] border p-3.5">
              <p className="text-[12px] uppercase text-[var(--text-subtle)]">Total rows</p>
              <p className="tabular mt-0.5 text-xl font-semibold">{validation.total}</p>
            </div>
            <div className="rounded-[var(--radius)] border border-emerald-200 bg-[var(--success-bg)] p-3.5">
              <p className="text-[12px] uppercase text-[var(--success)]">Ready to import</p>
              <p className="tabular mt-0.5 text-xl font-semibold text-[var(--success)]">
                {validation.validCount}
              </p>
            </div>
            <div
              className={cn(
                "rounded-[var(--radius)] border p-3.5",
                validation.invalidCount > 0 && "border-red-200 bg-[var(--danger-bg)]"
              )}
            >
              <p
                className={cn(
                  "text-[12px] uppercase",
                  validation.invalidCount > 0 ? "text-[var(--danger)]" : "text-[var(--text-subtle)]"
                )}
              >
                With problems
              </p>
              <p
                className={cn(
                  "tabular mt-0.5 text-xl font-semibold",
                  validation.invalidCount > 0 && "text-[var(--danger)]"
                )}
              >
                {validation.invalidCount}
              </p>
            </div>
          </div>

          {validation.invalidCount > 0 && (
            <div className="mt-5">
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]">
                <AlertTriangle className="h-4 w-4 text-[var(--warning)]" aria-hidden />
                Rows that will not be imported
              </p>

              <div className="max-h-72 overflow-y-auto rounded-[var(--radius)] border">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-[var(--surface-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-[12px] font-semibold uppercase text-[var(--text-muted)]">
                        Row
                      </th>
                      <th className="px-3 py-2 text-left text-[12px] font-semibold uppercase text-[var(--text-muted)]">
                        Who
                      </th>
                      <th className="px-3 py-2 text-left text-[12px] font-semibold uppercase text-[var(--text-muted)]">
                        Problems
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.errorReport.map((row) => (
                      <tr key={row.rowNumber} className="border-t">
                        <td className="tabular px-3 py-2 align-top">{row.rowNumber}</td>
                        <td className="px-3 py-2 align-top">
                          {row.name || row.employeeCode || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <ul className="space-y-0.5">
                            {row.errors.map((error, index) => (
                              <li key={index} className="text-[12.5px] text-[var(--danger)]">
                                {error.field}: {error.message}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-5 flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back to mapping
            </Button>
            <Button
              loading={commit.isPending}
              disabled={validation.validCount === 0}
              onClick={() => commit.mutate()}
              data-tour="import-commit"
            >
              Import {validation.validCount} {validation.validCount === 1 ? "employee" : "employees"}
            </Button>
          </div>
        </Card>
      )}

      {/* ── Step 4: result ───────────────────────────────────────── */}
      {step === 3 && result && (
        <Card>
          <div className="text-center">
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]">
              <CheckCircle2 className="h-6 w-6" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold text-[var(--text)]">
              {result.importedCount} {result.importedCount === 1 ? "employee" : "employees"} imported
            </h2>
            <p className="mt-1 text-[13.5px] text-[var(--text-muted)]">
              {result.failedCount > 0
                ? `${result.failedCount} rows were rejected and are listed below. Fix them in your file and import just those.`
                : "Every row went in cleanly."}
            </p>
          </div>

          {result.failedCount > 0 && (
            <div className="mt-5 max-h-64 overflow-y-auto rounded-[var(--radius)] border">
              <table className="w-full text-[13px]">
                <tbody>
                  {result.failed.map((row) => (
                    <tr key={row.rowNumber} className="border-b last:border-0">
                      <td className="tabular px-3 py-2 align-top">Row {row.rowNumber}</td>
                      <td className="px-3 py-2 align-top">{row.name || row.employeeCode}</td>
                      <td className="px-3 py-2 text-[12.5px] text-[var(--danger)]">
                        {row.errors.map((error) => error.message).join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 flex justify-center gap-3">
            <Button variant="outline" onClick={() => { setStep(0); setAnalysis(null); setValidation(null); setResult(null); }}>
              Import another file
            </Button>
            <Button onClick={() => router.push("/app/employees")} icon={<FileSpreadsheet className="h-4 w-4" />}>
              View employees
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
