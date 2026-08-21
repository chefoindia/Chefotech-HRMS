"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui";
import { SETTINGS_NAVIGATION, filterNavItems, isActivePath } from "@/components/shell/navigation";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can, canAny, hasFeature } = useSession();

  const items = filterNavItems(SETTINGS_NAVIGATION, { can, canAny, hasFeature });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Everything about how this organization runs — policies, people and branding."
      />

      <div className="lg:flex lg:gap-8">
        <nav className="mb-5 lg:mb-0 lg:w-56 lg:shrink-0" aria-label="Settings">
          <div className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {items.map((item) => {
              const active = isActivePath(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-[13.5px] transition-colors",
                    active
                      ? "bg-brand-50 font-medium text-brand-700"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}
