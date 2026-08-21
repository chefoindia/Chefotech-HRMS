"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui";

/** Salary components live under Payroll; keep one implementation. */
export default function PayrollSettingsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/payroll/components");
  }, [router]);

  return <PageLoader label="Opening payroll settings" />;
}
