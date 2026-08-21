"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/session";
import { Callout, Card, CardHeader, NoAccessState } from "@/components/ui";

/**
 * Security.
 *
 * The editable values are registry-driven and live on the main settings page
 * alongside every other group, so there is one implementation of the settings
 * form rather than two. This page explains what the platform enforces
 * regardless of configuration — the part a customer's security reviewer asks
 * about.
 */
export default function SecuritySettingsPage() {
  const { can } = useSession();

  if (!can("settings.manage_security") && !can("settings.view")) {
    return <NoAccessState what="security settings" />;
  }

  return (
    <div className="space-y-5">
      <Callout tone="info" icon={<ShieldCheck className="h-4 w-4" />}>
        Session length, password rules, IP restrictions and two-factor enforcement are edited on
        the{" "}
        <Link href="/app/settings" className="font-medium underline">
          Organization settings
        </Link>{" "}
        page, under Security.
      </Callout>

      <Card>
        <CardHeader
          title="What the platform enforces"
          description="These hold regardless of how the organization is configured."
        />

        <ul className="mt-4 space-y-4">
          {[
            [
              "Tenant isolation at the data layer",
              "Every query is scoped to the organization on your session before it reaches the database, by the data layer rather than by each developer remembering. A query written without a tenant scope raises an error instead of returning another company's records.",
            ],
            [
              "Permissions enforced by the API",
              "The interface hides what you cannot do; the API is what decides. Every mutating endpoint carries a permission guard, so a hidden button is a convenience, not a control.",
            ],
            [
              "Sensitive data behind its own permission",
              "Bank details, identity documents and statutory numbers require a separate permission from the rest of a profile, and are stripped on the way out rather than hidden in the interface.",
            ],
            [
              "Private files are never public",
              "Employee documents and payslips are streamed through an authenticated proxy after a tenant and permission check. They are never given a shareable link, so a leaked file id is worthless.",
            ],
            [
              "Passwords and sessions",
              "Passwords are hashed with bcrypt and never logged. Refresh tokens are stored hashed and rotated on every use; presenting one twice is treated as theft and revokes the whole session family. Changing a password ends every other session.",
            ],
            [
              "Sign-in protection",
              "Repeated failures lock an account temporarily. Sign-in, sign-up and password reset are rate limited per IP, and none of them reveal whether an email address exists.",
            ],
            [
              "Immutable audit trail",
              "Salary changes, approvals, policy edits, locks and unlocks are written to an append-only log with before and after values. Entries cannot be edited or deleted through the application.",
            ],
            [
              "Tenant formulas never execute as code",
              "Salary and policy formulas are parsed and evaluated by a purpose-built expression engine with no property access and no host objects — never by running the text as JavaScript.",
            ],
          ].map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--success)]" aria-hidden />
              <div>
                <p className="text-[13.5px] font-medium text-[var(--text)]">{title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-muted)]">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Reviewing access"
          description="Two things worth checking periodically."
        />
        <div className="mt-4 space-y-3 text-[13.5px] text-[var(--text-muted)]">
          <p>
            <Link href="/app/settings/users" className="font-medium text-brand-600 hover:underline">
              Users
            </Link>{" "}
            — who can sign in, when they were last seen, and which roles they hold. Removing
            someone here takes effect on their next request.
          </p>
          <p>
            <Link href="/app/audit" className="font-medium text-brand-600 hover:underline">
              Audit trail
            </Link>{" "}
            — filter to <strong>critical</strong> to see salary revisions, payroll locks,
            attendance unlocks and permission changes.
          </p>
        </div>
      </Card>
    </div>
  );
}
