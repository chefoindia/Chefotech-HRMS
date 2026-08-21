"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Building2, ListChecks, ScrollText, ShieldAlert } from "lucide-react";
import { useSession } from "@/lib/session";
import { PageLoader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/Logo";

/**
 * The platform administration shell.
 *
 * Deliberately separate from the tenant application, and visually distinct
 * from it, because someone working here is looking at every customer's
 * organisation at once. An interface that looks identical to the tenant app
 * is how a support engineer forgets which one they are in.
 *
 * The real gate is the API — every route under /platform requires a platform
 * role server-side and returns 404 to a tenant user, so a tenant cannot even
 * confirm the endpoints exist. This check only avoids rendering a shell that
 * would fail every request inside it.
 */

const NAV = [
  { href: "/platform", label: "Overview", icon: Activity, exact: true },
  { href: "/platform/organizations", label: "Organisations", icon: Building2 },
  { href: "/platform/jobs", label: "Background jobs", icon: ListChecks },
  { href: "/platform/audit", label: "Audit", icon: ScrollText },
];

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const isPlatformUser = Boolean(session?.isPlatformUser || session?.platformRole);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading) return <PageLoader label="Loading platform administration…" />;
  if (!session) return null;

  if (!isPlatformUser) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-[var(--text-subtle)]" aria-hidden />
          <h1 className="mt-4 text-[20px] font-semibold text-[var(--text)]">
            This area is not for your account
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
            Platform administration is used by the Chefotech team to operate the service. Your
            own organisation is managed from the main application.
          </p>
          <Link
            href="/app"
            className="mt-6 inline-flex h-10 items-center rounded-[calc(var(--radius)-2px)] bg-brand-600 px-5 text-[14px] font-medium text-white hover:bg-brand-700"
          >
            Back to your dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--surface-sunken,#f8fafc)]">
      {/* A standing reminder of which account is in use and what it can reach. */}
      <div className="bg-[#1e1b4b] px-5 py-2 text-center text-[12.5px] text-white/90">
        Platform administration — you are working across every customer organisation. Signed in
        as {session.user.email} ({session.platformRole ?? "platform user"}).
      </div>

      <header className="border-b bg-[var(--surface)]">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-5">
          <Link href="/platform" className="flex items-center gap-2.5 py-4">
            <LogoMark size="md" />
            <span className="text-[15px] font-semibold tracking-tight text-[var(--text)]">
              Platform
            </span>
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Platform">
            {NAV.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[13.5px] transition-colors",
                    active
                      ? "bg-[var(--surface-muted)] font-medium text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Link
            href="/app"
            className="ml-auto whitespace-nowrap text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Exit to app
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-5 py-8">
        {children}
      </main>
    </div>
  );
}
