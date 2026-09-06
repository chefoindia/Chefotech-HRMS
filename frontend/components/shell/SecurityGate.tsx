"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

/**
 * Sends someone to the security screen when the organization says they
 * must act first — an expired password, or missing two-factor for an
 * administrator when it is required. Rendered inside the shell, so the
 * security page itself and the sign-in flow are never affected.
 */
export function SecurityGate() {
  const { session } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const required = session?.passwordExpired ? "expired" : session?.mfaSetupRequired ? "setup" : null;

  useEffect(() => {
    if (!required) return;
    if (pathname === "/me/security") return;
    router.replace(`/me/security?${required}=1`);
  }, [required, pathname, router]);

  return null;
}
