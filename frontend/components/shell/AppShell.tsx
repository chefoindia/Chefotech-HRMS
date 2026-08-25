"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  User as UserIcon,
  X,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Avatar, Badge, Button, CountPill, PageLoader } from "@/components/ui";
import {
  APP_NAVIGATION,
  PORTAL_NAVIGATION,
  filterNavItems,
  filterNavigation,
  isActivePath,
  type NavItem,
} from "./navigation";
import { PoweredBy } from "@/components/brand/Logo";
import { NotificationBell } from "./NotificationBell";
import { HelpAssistant } from "@/components/help/HelpAssistant";
import { TourEngine } from "@/components/help/TourEngine";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { OnboardingBanner } from "./OnboardingBanner";

/**
 * The application shell.
 *
 * Sidebar, top bar, notifications, the help assistant and the tour overlay.
 * Navigation is filtered by permission once, here, so no page has to guard its
 * own link — and the sidebar a tenant's custom role sees is derived, not
 * configured.
 */
export function AppShell({
  children,
  variant = "app",
}: {
  children: React.ReactNode;
  variant?: "app" | "portal";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading, can, canAny, hasFeature, signOut } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Desktop sidebar visibility, remembered across visits so a preference set
  // once (a wide monitor where the sidebar is never needed, say) sticks.
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setSidebarHidden(localStorage.getItem("chefotech.sidebar_hidden") === "1");

    // Driven by an inline style further down rather than a `lg:w-0` /
    // `lg:w-64` Tailwind class pair: those two rules kept losing the
    // cascade to each other unpredictably in this tree (confirmed correct
    // in isolation, confirmed correct in the served CSS file, still 0px on
    // the real element even after a cache-busted stylesheet reload — never
    // pinned down which of Tailwind's own layer ordering or something
    // upstream of it was responsible). An inline style has the highest
    // specificity there is, so it can't lose to anything.
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const toggleSidebar = () => {
    setSidebarHidden((current) => {
      const next = !current;
      localStorage.setItem("chefotech.sidebar_hidden", next ? "1" : "0");
      return next;
    });
  };

  // Anyone who reaches the shell without a session belongs on the sign-in page.
  useEffect(() => {
    if (!loading && !session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, session, router, pathname]);

  useEffect(() => setMobileOpen(false), [pathname]);

  // Cmd/Ctrl+K opens search, "?" opens help — the two shortcuts people expect.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        router.push("/app/search");
      }
      if (event.key === "?" && !isTyping(event.target)) {
        event.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const context = useMemo(() => ({ can, canAny, hasFeature }), [can, canAny, hasFeature]);

  const sections = useMemo(
    () => (variant === "app" ? filterNavigation(APP_NAVIGATION, context) : []),
    [variant, context]
  );
  const portalItems = useMemo(
    () => (variant === "portal" ? filterNavItems(PORTAL_NAVIGATION, context) : []),
    [variant, context]
  );

  // The badge only needs the count, so ask for a single row and read the
  // total out of the pagination envelope rather than pulling the whole list.
  const { data: pendingApprovals = 0 } = useQuery({
    queryKey: ["approvals", "count"],
    queryFn: async () => {
      const { meta } = await api.get<unknown[]>("/workflows/pending", { query: { limit: 1 } });
      return meta?.total ?? 0;
    },
    enabled: Boolean(session) && canAny("workflow.act", "leave.approve", "attendance.approve"),
    refetchInterval: 120_000,
  });

  if (loading) return <PageLoader label="Signing you in" />;
  if (!session) return <PageLoader label="Redirecting" />;

  const organization = session.organization;
  const badges = { pendingApprovals };

  return (
    // `lg:items-start` is what lets the sticky sidebar work: the flex default
    // of `stretch` would size it to the full page height, leaving it nothing
    // to stick within.
    <div className="min-h-screen lg:flex lg:items-start">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          // `lg:sticky lg:top-0 lg:h-screen` rather than `lg:static`: static
          // puts the sidebar in normal page flow, so it scrolled away with
          // the content. Sticky pins it to the viewport and keeps its own
          // nav scrolling independently of the page.
          "fixed inset-y-0 left-0 z-40 w-64 overflow-hidden bg-[var(--sidebar-bg)] transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-screen",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={isDesktop && sidebarHidden ? { width: 0 } : undefined}
      >
        <div className="flex h-full w-64 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-4">
          <Link href={variant === "portal" ? "/me" : "/app"} className="flex min-w-0 items-center gap-2.5">
            {organization?.branding?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={organization.branding.logoUrl}
                alt={organization.name}
                className="h-7 max-w-[140px] object-contain"
                referrerPolicy="no-referrer"
              />
            ) : (
              <>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-600 text-[13px] font-bold text-white">
                  {organization?.name?.[0]?.toUpperCase() || "C"}
                </span>
                <span className="truncate text-[14px] font-semibold text-white">
                  {organization?.name || "Chefotech"}
                </span>
              </>
            )}
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded p-1.5 text-white/70 hover:bg-white/10 lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-4.5 w-4.5" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Main">
          {variant === "portal"
            ? portalItems.map((item) => (
                <SidebarLink key={item.href} item={item} pathname={pathname} badges={badges} />
              ))
            : sections.map((section, index) => (
                <div key={index}>
                  {section.label && (
                    <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/35">
                      {section.label}
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {section.items.map((item) => (
                      <SidebarLink key={item.href} item={item} pathname={pathname} badges={badges} />
                    ))}
                  </div>
                </div>
              ))}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-3">
          {variant === "app" ? (
            <Link
              href="/me"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-white/70 hover:bg-white/10 hover:text-white"
            >
              <UserIcon className="h-4 w-4" aria-hidden />
              My portal
            </Link>
          ) : (
            canAny("employee.view", "dashboard.view_org_wide") && (
              <Link
                href="/app"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-white/70 hover:bg-white/10 hover:text-white"
              >
                <Building2 className="h-4 w-4" aria-hidden />
                Admin
              </Link>
            )
          )}

          {organization?.branding?.showPoweredBy !== false && (
            <PoweredBy className="mt-2 px-3 text-[11px] text-white/40" />
          )}
        </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-[var(--surface)]/90 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>

          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] lg:block"
            aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
            title={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
          >
            {sidebarHidden ? (
              <PanelLeftOpen className="h-5 w-5" aria-hidden />
            ) : (
              <PanelLeftClose className="h-5 w-5" aria-hidden />
            )}
          </button>

          <button
            type="button"
            onClick={() => router.push("/app/search")}
            className="hidden max-w-xs flex-1 items-center gap-2 rounded-[calc(var(--radius)-2px)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[13px] text-[var(--text-subtle)] hover:border-[var(--border-strong)] sm:flex"
          >
            <Search className="h-4 w-4" aria-hidden />
            <span>Search</span>
            <kbd className="ml-auto rounded border bg-[var(--surface)] px-1.5 py-0.5 font-sans text-[11px]">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            {organization?.status === "trial" && organization.plan?.trialEndsAt && (
              <TrialBadge endsAt={organization.plan.trialEndsAt} />
            )}

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="rounded-full p-2 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
              aria-label="Help"
              title="Help (?)"
            >
              <HelpCircle className="h-4.5 w-4.5" aria-hidden />
            </button>

            <NotificationBell />

            <UserMenu
              name={session.user.fullName}
              email={session.user.email}
              organizations={session.organizations}
              currentOrganizationId={organization?.id}
              onSignOut={signOut}
            />
          </div>
        </header>

        <main id="main" className="flex-1 px-4 py-5 lg:px-6 lg:py-6">
          {variant === "app" && <OnboardingBanner />}
          {children}
        </main>
      </div>

      <HelpAssistant open={helpOpen} onClose={() => setHelpOpen(false)} />
      <TourEngine />
      {/* Every action it can offer is an admin/HR setup or configuration
          screen, so it is only genuinely useful on the admin side — an
          employee in the self-service portal has permission for almost none
          of it, and "guide me through setup" is not their job. */}
      {variant === "app" && <ChatWidget />}
    </div>
  );
}

function SidebarLink({
  item,
  pathname,
  badges,
}: {
  item: NavItem;
  pathname: string;
  badges: Record<string, number>;
}) {
  const active = isActivePath(pathname, item);
  const hasChildren = Boolean(item.children?.length);
  const [expanded, setExpanded] = useState(active);

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  const Icon = item.icon;
  const badgeCount = item.badgeKey ? badges[item.badgeKey] || 0 : 0;

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={item.href}
          // Warm the route on hover. By the time the click lands the bundle is
          // usually already in memory, which is the difference between a
          // sidebar that feels instant and one that stalls on every section.
          prefetch
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] transition-colors",
            active
              ? "bg-white/10 font-medium text-white"
              : "text-[var(--sidebar-fg)] hover:bg-white/5 hover:text-white"
          )}
          aria-current={active ? "page" : undefined}
        >
          {Icon && <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />}
          <span className="truncate">{item.label}</span>
          {badgeCount > 0 && <CountPill count={badgeCount} tone="danger" />}
        </Link>

        {hasChildren && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded p-1.5 text-white/40 hover:bg-white/5 hover:text-white/80"
            aria-label={expanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <div className="ml-6 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
          {item.children!.map((child) => {
            const childActive = isActivePath(pathname, child);
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "block rounded-md px-3 py-1.5 text-[13px] transition-colors",
                  childActive
                    ? "font-medium text-white"
                    : "text-[var(--sidebar-fg)] opacity-80 hover:text-white hover:opacity-100"
                )}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TrialBadge({ endsAt }: { endsAt: string }) {
  const daysLeft = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000));
  return (
    <Link href="/app/settings/plan" className="hidden sm:block">
      <Badge tone={daysLeft <= 3 ? "warning" : "brand"}>
        {daysLeft === 0 ? "Trial ended" : `${daysLeft} days left in trial`}
      </Badge>
    </Link>
  );
}

function UserMenu({
  name,
  email,
  organizations,
  currentOrganizationId,
  onSignOut,
}: {
  name: string;
  email: string;
  organizations?: Array<{ id: string; name: string }>;
  currentOrganizationId?: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { switchOrganization } = useSession();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // A click anywhere else closes the menu; the timeout stops the opening
    // click from immediately closing it again.
    const timer = setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", close);
    };
  }, [open]);

  const otherOrganizations = (organizations || []).filter((o) => o.id !== currentOrganizationId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="flex items-center gap-2 rounded-full p-0.5 hover:bg-[var(--surface-sunken)]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <Avatar name={name} size="sm" />
      </button>

      {open && (
        <div
          className="animate-in absolute right-0 top-11 z-30 w-64 overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)] shadow-lg"
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b px-4 py-3">
            <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{name}</p>
            <p className="truncate text-[12px] text-[var(--text-muted)]">{email}</p>
          </div>

          {otherOrganizations.length > 0 && (
            <div className="border-b py-1">
              <p className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Switch organization
              </p>
              {otherOrganizations.map((organization) => (
                <button
                  key={organization.id}
                  type="button"
                  onClick={() => switchOrganization(organization.id)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] hover:bg-[var(--surface-muted)]"
                >
                  <Building2 className="h-4 w-4 text-[var(--text-subtle)]" aria-hidden />
                  <span className="truncate">{organization.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="py-1">
            <Link
              href="/me/profile"
              className="flex items-center gap-2 px-4 py-2 text-[13px] hover:bg-[var(--surface-muted)]"
            >
              <UserIcon className="h-4 w-4 text-[var(--text-subtle)]" aria-hidden />
              My profile
            </Link>
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-[var(--danger)] hover:bg-[var(--danger-bg)]"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}
