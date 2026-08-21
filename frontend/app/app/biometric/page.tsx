"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui";

/**
 * Devices are configured in Settings, but people look for them under Time
 * because that is where attendance lives. Rather than duplicate the screen,
 * this sends them to the one place it is maintained.
 */
export default function BiometricRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/settings/biometric");
  }, [router]);

  return <PageLoader label="Opening biometric devices" />;
}
