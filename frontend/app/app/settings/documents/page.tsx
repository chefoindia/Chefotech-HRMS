"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui";

/** Templates are managed alongside generation; keep one implementation. */
export default function DocumentSettingsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/documents");
  }, [router]);

  return <PageLoader label="Opening document templates" />;
}
