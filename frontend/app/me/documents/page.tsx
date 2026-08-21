"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatRelative, humanise } from "@/lib/format";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";

interface EmployeeDocument {
  id: string;
  name: string;
  category: string;
  status: string;
  documentNumber: string;
  issuedOn: string | null;
  expiresOn: string | null;
  isExpired: boolean;
  daysToExpiry: number | null;
  createdAt: string;
  file: { id: string; downloadUrl: string; mimeType: string; size: number } | null;
}

export default function MyDocumentsPage() {
  const { session } = useSession();
  const locale = session?.organization?.locale || "en-IN";

  const { data, isLoading } = useQuery({
    queryKey: ["me", "documents"],
    queryFn: async () => {
      const { data: documents } = await api.get<EmployeeDocument[]>("/documents/me");
      return documents;
    },
  });

  return (
    <>
      <PageHeader
        title="My documents"
        description="Letters, certificates and anything HR has shared with you."
      />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-14" />
          ))}
        </div>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="No documents yet"
            description="Offer letters, certificates and other documents shared with you appear here."
          />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {data.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <FileText className="h-5 w-5 shrink-0 text-[var(--text-subtle)]" aria-hidden />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
                    {document.name}
                  </p>
                  <p className="truncate text-[12.5px] text-[var(--text-muted)]">
                    {humanise(document.category)}
                    {document.documentNumber && ` · ${document.documentNumber}`}
                    {" · added "}
                    {formatRelative(document.createdAt)}
                    {document.expiresOn &&
                      ` · ${document.isExpired ? "expired" : "expires"} ${formatDate(document.expiresOn, { locale })}`}
                  </p>
                </div>

                {document.expiresOn &&
                  !document.isExpired &&
                  document.daysToExpiry !== null &&
                  document.daysToExpiry <= 30 && (
                    <StatusBadge status="pending" label={`${document.daysToExpiry} days left`} />
                  )}
                {document.isExpired && <StatusBadge status="expired" />}

                {document.file && (
                  <a
                    href={api.fileUrl(document.file.downloadUrl)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[calc(var(--radius)-2px)] border px-3 text-[13px] font-medium hover:bg-[var(--surface-muted)]"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
