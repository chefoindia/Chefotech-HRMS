"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { api, ApiError, tokens } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Callout, Checkbox, Input, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Dubai", label: "UAE (GST)" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Dhaka", label: "Bangladesh" },
  { value: "Asia/Karachi", label: "Pakistan" },
  { value: "Asia/Colombo", label: "Sri Lanka" },
  { value: "Europe/London", label: "United Kingdom" },
  { value: "America/New_York", label: "US Eastern" },
  { value: "UTC", label: "UTC" },
];

const PASSWORD_RULES = [
  { label: "At least 10 characters", test: (value: string) => value.length >= 10 },
  { label: "One lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { label: "One uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { label: "One number", test: (value: string) => /[0-9]/.test(value) },
];

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useSession();

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    companyName: "",
    timezone: "Asia/Kolkata",
    acceptedTerms: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const passwordScore = PASSWORD_RULES.filter((rule) => rule.test(form.password)).length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const { data } = await api.post<{
        pending?: boolean;
        accessToken?: string;
        refreshToken?: string;
        redirectTo?: string;
      }>("/auth/register", form, { raw: true });

      if (data.pending) {
        // The address already has an account. We do not say so — the real
        // owner is told by email instead.
        setPending(true);
        return;
      }

      tokens.set(data.accessToken || null, data.refreshToken || null);
      await refresh();
      router.push("/onboarding");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (pending) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="If that address can be used, we have sent you a message with what to do next."
        footer={
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Callout tone="info">
          We do not confirm whether an email address already has an account. If you think you
          have one, use <strong>Forgot your password</strong> from the sign-in page.
        </Callout>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your organization"
      subtitle="Two minutes to set up. Everything is unlocked for 14 days."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
      points={[
        "No card required for the trial",
        "Import your employee list from a spreadsheet",
        "Guided setup for shifts, leave and attendance rules",
        "Cancel any time — your data stays yours",
      ]}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            required
            autoFocus
            value={form.firstName}
            onChange={(event) => set("firstName", event.target.value)}
            error={fieldErrors["body.firstName"] || fieldErrors.firstName}
          />
          <Input
            label="Last name"
            value={form.lastName}
            onChange={(event) => set("lastName", event.target.value)}
            error={fieldErrors["body.lastName"] || fieldErrors.lastName}
          />
        </div>

        <Input
          label="Work email"
          type="email"
          required
          autoComplete="username"
          value={form.email}
          onChange={(event) => set("email", event.target.value)}
          placeholder="you@company.com"
          error={fieldErrors["body.email"] || fieldErrors.email}
        />

        <div>
          <Input
            label="Password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => set("password", event.target.value)}
            error={fieldErrors["body.password"] || fieldErrors.password}
            suffix={
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="pointer-events-auto text-[var(--text-subtle)] hover:text-[var(--text)]"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />

          {form.password && (
            <div className="mt-2 space-y-1.5">
              <div className="flex gap-1" aria-hidden>
                {PASSWORD_RULES.map((_, index) => (
                  <span
                    key={index}
                    className={cn(
                      "h-1 flex-1 rounded-full transition-colors",
                      index < passwordScore
                        ? passwordScore === 4
                          ? "bg-[var(--success)]"
                          : "bg-[var(--warning)]"
                        : "bg-[var(--border)]"
                    )}
                  />
                ))}
              </div>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {PASSWORD_RULES.map((rule) => {
                  const passed = rule.test(form.password);
                  return (
                    <li
                      key={rule.label}
                      className={cn(
                        "flex items-center gap-1 text-[11.5px]",
                        passed ? "text-[var(--success)]" : "text-[var(--text-subtle)]"
                      )}
                    >
                      {passed ? (
                        <Check className="h-3 w-3 shrink-0" aria-hidden />
                      ) : (
                        <X className="h-3 w-3 shrink-0" aria-hidden />
                      )}
                      {rule.label}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <Input
          label="Company name"
          required
          value={form.companyName}
          onChange={(event) => set("companyName", event.target.value)}
          placeholder="Acme Manufacturing Pvt Ltd"
          hint="You can change this later in Settings."
          error={fieldErrors["body.companyName"] || fieldErrors.companyName}
        />

        <Select
          label="Time zone"
          value={form.timezone}
          onChange={(event) => set("timezone", event.target.value)}
          options={TIMEZONES}
          hint="Attendance days and payroll periods are calculated in this zone."
        />

        <Checkbox
          checked={form.acceptedTerms}
          onChange={(event) => set("acceptedTerms", event.target.checked)}
          label={
            <span>
              I agree to the{" "}
              <Link href="#" className="text-brand-600 hover:underline">
                terms of service
              </Link>{" "}
              and{" "}
              <Link href="#" className="text-brand-600 hover:underline">
                privacy policy
              </Link>
            </span>
          }
        />
        {fieldErrors["body.acceptedTerms"] && (
          <p className="text-[12.5px] text-[var(--danger)]">{fieldErrors["body.acceptedTerms"]}</p>
        )}

        <Button
          type="submit"
          fullWidth
          size="lg"
          loading={submitting}
          disabled={!form.acceptedTerms}
        >
          Create organization
        </Button>
      </form>
    </AuthLayout>
  );
}
