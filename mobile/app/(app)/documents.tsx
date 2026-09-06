import { useMemo, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAcknowledgeDocument, useCompanyDocuments, useDocumentRequests, useMyDocuments, useUploadDocument, type CompanyDocument, type DocumentRequest, type EmployeeDocument } from "../../src/api/hooks";
import { useSession } from "../../src/auth/session";
import { ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { CheckRow, Note, Sheet, TabStrip } from "../../src/components/Sheet";
import { DatePickerSheet } from "../../src/components/DatePickerSheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { formatBytes, openFile, pickDocument, type PickedFile } from "../../src/lib/files";
import { dateLabel, humanise, relative } from "../../src/lib/format";

/**
 * My documents — the web portal's /me/documents: what HR shared, what HR
 * asked for, and the company policies to read. Acknowledging is a typed
 * name and a tick, recorded with the time and shown back.
 */
export default function Documents() {
  const colors = useColors();
  const toast = useToast();
  const [tab, setTab] = useState<"mine" | "requests" | "company">("mine");
  const documents = useMyDocuments();
  const requests = useDocumentRequests();
  const company = useCompanyDocuments();
  const [acknowledging, setAcknowledging] = useState<{ id: string; title: string; company: boolean; file: EmployeeDocument["file"] } | null>(null);
  const [uploading, setUploading] = useState<DocumentRequest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const open = async (file: NonNullable<EmployeeDocument["file"]>) => {
    setBusy(file.id);
    try {
      await openFile(file.downloadUrl, file.fileName, file.mimeType);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not open that document.");
    } finally {
      setBusy(null);
    }
  };

  const pendingAcks = (documents.data || []).filter((d) => d.acknowledgement?.required && !d.acknowledgement.acknowledgedAt).length;
  const pendingCompany = (company.data || []).filter((d) => d.requireAcknowledgement && !d.acknowledged).length;
  const todo = pendingAcks + pendingCompany + (requests.data?.length || 0);

  const refetchAll = () => {
    documents.refetch();
    requests.refetch();
    company.refetch();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={documents.isRefetching || requests.isRefetching || company.isRefetching} onRefresh={refetchAll} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="My documents" />

        {todo > 0 && (
          <Note tone="warning">
            You have {todo} thing{todo === 1 ? "" : "s"} to do here:{pendingAcks ? ` ${pendingAcks} document${pendingAcks === 1 ? "" : "s"} to acknowledge` : ""}
            {requests.data?.length ? `${pendingAcks ? "," : ""} ${requests.data.length} upload${requests.data.length === 1 ? "" : "s"} requested` : ""}
            {pendingCompany ? `${pendingAcks || requests.data?.length ? "," : ""} ${pendingCompany} polic${pendingCompany === 1 ? "y" : "ies"} to read` : ""}.
          </Note>
        )}

        <TabStrip
          items={[
            { key: "mine", label: "My documents", count: documents.data?.length },
            { key: "requests", label: "Requested from me", count: requests.data?.length },
            { key: "company", label: "Company documents", count: company.data?.length },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "mine" &&
          (documents.isLoading ? (
            <Loading />
          ) : documents.isError ? (
            <ErrorState message={documents.error instanceof ApiError ? documents.error.message : "Could not load these."} onRetry={documents.refetch} />
          ) : !documents.data?.length ? (
            <Card>
              <EmptyState icon="folder-open-outline" title="No documents yet" body="Offer letters, certificates and other documents shared with you appear here." />
            </Card>
          ) : (
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              {documents.data.map((document, index) => {
                const ack = document.acknowledgement;
                const needsAck = ack?.required && !ack.acknowledgedAt;
                return (
                  <View key={document.id}>
                    {index > 0 && <Divider />}
                    <View style={{ paddingVertical: spacing.md }}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                        <Ionicons name="document-text-outline" size={20} color={colors.textSubtle} style={{ marginTop: 2 }} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt variant="bodyMedium" numberOfLines={2}>
                            {document.name}
                          </Txt>
                          <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                            {humanise(document.category)}
                            {document.documentNumber ? ` · ${document.documentNumber}` : ""} · added {relative(document.createdAt)}
                            {document.expiresOn ? ` · ${document.isExpired ? "expired" : "expires"} ${dateLabel(document.expiresOn)}` : ""}
                          </Txt>
                          {ack?.acknowledgedAt ? (
                            <Txt variant="caption" tone="success" style={{ marginTop: 2 }}>
                              ✓ You acknowledged this on {dateLabel(ack.acknowledgedAt)}
                            </Txt>
                          ) : null}
                          {document.status === "rejected" && document.rejectionReason ? (
                            <Txt variant="caption" tone="danger" style={{ marginTop: 2 }}>
                              Needs attention: {document.rejectionReason}
                            </Txt>
                          ) : null}
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, marginLeft: 28 }}>
                        {needsAck && <Badge label={ack.isOverdue ? "Acknowledgement overdue" : "Please acknowledge"} tone={ack.isOverdue ? "danger" : "warning"} />}
                        {document.status === "pending_review" && <Badge label="Being checked" tone="info" />}
                        {document.status === "rejected" && <Badge label="Rejected" tone="danger" />}
                        {document.isExpired && <Badge label="Expired" tone="danger" />}
                        {document.expiresOn && !document.isExpired && document.daysToExpiry !== null && document.daysToExpiry <= 30 && <Badge label={`${document.daysToExpiry} days left`} tone="warning" />}
                        {document.file && <Button title={busy === document.file.id ? "Opening…" : "Open"} variant="secondary" size="sm" icon="download-outline" onPress={() => open(document.file!)} loading={busy === document.file.id} />}
                        {needsAck && <Button title="Acknowledge" size="sm" icon="shield-checkmark-outline" onPress={() => setAcknowledging({ id: document.id, title: document.name, company: false, file: document.file })} />}
                      </View>
                    </View>
                  </View>
                );
              })}
            </Card>
          ))}

        {tab === "requests" &&
          (requests.isLoading ? (
            <Loading />
          ) : !requests.data?.length ? (
            <Card>
              <EmptyState icon="clipboard-outline" title="Nothing requested" body="When HR needs a document from you — an ID proof, a certificate — it appears here with an upload button." />
            </Card>
          ) : (
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              {requests.data.map((request, index) => (
                <View key={request.id}>
                  {index > 0 && <Divider />}
                  <View style={{ paddingVertical: spacing.md }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Txt variant="bodyMedium" style={{ flex: 1 }}>
                        {request.name}
                      </Txt>
                      {request.isOverdue && <Badge label="Overdue" tone="danger" />}
                    </View>
                    <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                      {humanise(request.category)} · asked {relative(request.createdAt)}
                      {request.requestedBy ? ` by ${request.requestedBy}` : ""}
                      {request.dueOn ? ` · due ${dateLabel(request.dueOn)}` : ""}
                    </Txt>
                    {request.note ? (
                      <Txt variant="caption" style={{ marginTop: 3 }}>
                        {request.note}
                      </Txt>
                    ) : null}
                    <View style={{ marginTop: spacing.sm, alignSelf: "flex-start" }}>
                      <Button title="Upload" size="sm" icon="cloud-upload-outline" onPress={() => setUploading(request)} />
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          ))}

        {tab === "company" && <CompanyDocuments documents={company.data} isLoading={company.isLoading} onOpen={open} busy={busy} onAcknowledge={(d) => setAcknowledging({ id: d.id, title: d.title, company: true, file: d.file })} />}
      </Screen>

      {acknowledging && <AcknowledgeSheet target={acknowledging} onClose={() => setAcknowledging(null)} onOpen={(file) => open(file)} />}
      {uploading && <UploadSheet request={uploading} onClose={() => setUploading(null)} />}
    </SafeAreaView>
  );
}

function CompanyDocuments({ documents, isLoading, onOpen, busy, onAcknowledge }: { documents?: CompanyDocument[]; isLoading: boolean; onOpen: (file: NonNullable<CompanyDocument["file"]>) => void; busy: string | null; onAcknowledge: (d: CompanyDocument) => void }) {
  const colors = useColors();
  const groups = useMemo(() => {
    const map = new Map<string, CompanyDocument[]>();
    for (const d of documents || []) {
      if (!map.has(d.category)) map.set(d.category, []);
      map.get(d.category)!.push(d);
    }
    return [...map.entries()];
  }, [documents]);

  if (isLoading) return <Loading />;
  if (!documents?.length)
    return (
      <Card>
        <EmptyState icon="book-outline" title="Nothing published yet" body="Company policies, the handbook and forms appear here once HR publishes them." />
      </Card>
    );

  return (
    <View style={{ gap: spacing.lg }}>
      {groups.map(([category, rows]) => (
        <View key={category}>
          <Txt variant="caption" tone="subtle" style={{ textTransform: "uppercase", letterSpacing: 0.6, marginBottom: spacing.sm }}>
            {humanise(category)}
          </Txt>
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {rows.map((document, index) => (
              <View key={document.id}>
                {index > 0 && <Divider />}
                <View style={{ paddingVertical: spacing.md }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                    <Ionicons name="book-outline" size={20} color={colors.textSubtle} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMedium">
                        {document.title} <Txt variant="caption" tone="subtle">v{document.version}</Txt>
                      </Txt>
                      {document.description ? (
                        <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                          {document.description}
                        </Txt>
                      ) : null}
                      <Txt variant="caption" tone="subtle" style={{ marginTop: 2 }}>
                        {document.effectiveFrom ? `Effective ${dateLabel(document.effectiveFrom)} · ` : ""}published {relative(document.publishedAt)}
                      </Txt>
                      {document.acknowledged && document.acknowledgedAt ? (
                        <Txt variant="caption" tone="success" style={{ marginTop: 2 }}>
                          ✓ You acknowledged this on {dateLabel(document.acknowledgedAt)}
                        </Txt>
                      ) : null}
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, marginLeft: 28 }}>
                    {document.requireAcknowledgement && !document.acknowledged && <Badge label="Please read and acknowledge" tone="warning" />}
                    {document.file && <Button title={busy === document.file.id ? "Opening…" : "Open"} variant="secondary" size="sm" icon="download-outline" onPress={() => onOpen(document.file!)} loading={busy === document.file.id} />}
                    {document.requireAcknowledgement && !document.acknowledged && <Button title="Acknowledge" size="sm" icon="shield-checkmark-outline" onPress={() => onAcknowledge(document)} />}
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </View>
      ))}
    </View>
  );
}

function AcknowledgeSheet({ target, onClose, onOpen }: { target: { id: string; title: string; company: boolean; file: EmployeeDocument["file"] }; onClose: () => void; onOpen: (file: NonNullable<EmployeeDocument["file"]>) => void }) {
  const { session } = useSession();
  const toast = useToast();
  const acknowledge = useAcknowledgeDocument();
  const [name, setName] = useState(session?.user.fullName || [session?.user.firstName, session?.user.lastName].filter(Boolean).join(" "));
  const [read, setRead] = useState(false);

  const submit = async () => {
    try {
      await acknowledge.mutateAsync({ id: target.id, name, company: target.company });
      toast.success("Thank you. Your acknowledgement has been recorded.");
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not record your acknowledgement.");
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Acknowledge: ${target.title}`}
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Not now" variant="secondary" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="I acknowledge" onPress={submit} loading={acknowledge.isPending} disabled={!read || !name.trim()} />
          </View>
        </View>
      }
    >
      {target.file && (
        <Pressable onPress={() => onOpen(target.file!)} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.lg }}>
          <Ionicons name="download-outline" size={16} color="#4f46e5" />
          <Txt variant="label" tone="brand">
            Open and read the document first
          </Txt>
        </Pressable>
      )}
      <Field label="Your full name" value={name} onChangeText={setName} hint="Typed as your signature." />
      <CheckRow label="I have read and understood this document." checked={read} onChange={setRead} />
      <Txt variant="caption" tone="subtle" style={{ marginTop: spacing.sm, marginBottom: spacing.lg }}>
        The date, time and your name are recorded with the document.
      </Txt>
    </Sheet>
  );
}

function UploadSheet({ request, onClose }: { request: DocumentRequest; onClose: () => void }) {
  const colors = useColors();
  const toast = useToast();
  const upload = useUploadDocument();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [documentNumber, setDocumentNumber] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [picking, setPicking] = useState(false);

  const submit = async () => {
    if (!file) return;
    try {
      await upload.mutateAsync({ file, requestId: request.id, documentNumber: documentNumber || undefined, expiresOn: expiresOn || undefined, notes: notes || undefined });
      toast.success("Uploaded. HR will check it and let you know.");
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not upload that file.");
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Upload: ${request.name}`}
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Upload" onPress={submit} loading={upload.isPending} disabled={!file} />
          </View>
        </View>
      }
    >
      <Pressable
        onPress={async () => {
          const picked = await pickDocument();
          if (picked) setFile(picked);
        }}
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg }}
      >
        <Ionicons name="cloud-upload-outline" size={22} color={colors.brand[600]} />
        <View style={{ flex: 1 }}>
          <Txt variant="label" tone="brand">
            {file ? "Choose another file" : "Choose a file"}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {file ? `${file.name}${file.size ? ` · ${formatBytes(file.size)}` : ""}` : "A clear scan or photo, or a PDF"}
          </Txt>
        </View>
      </Pressable>
      <Field label="Document number (if any)" value={documentNumber} onChangeText={setDocumentNumber} />
      <Pressable onPress={() => setPicking(true)} style={{ marginBottom: spacing.lg }}>
        <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
          Expiry date (if any)
        </Txt>
        <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface }}>
          <Ionicons name="calendar-outline" size={16} color={colors.brand[600]} />
          <Txt variant="body" style={{ marginLeft: spacing.sm, flex: 1 }} tone={expiresOn ? "default" : "subtle"}>
            {expiresOn ? dateLabel(expiresOn) : "None"}
          </Txt>
          {expiresOn ? (
            <Pressable onPress={() => setExpiresOn("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textSubtle} />
            </Pressable>
          ) : null}
        </View>
      </Pressable>
      <Field label="Note to HR (optional)" value={notes} onChangeText={setNotes} multiline numberOfLines={2} style={{ minHeight: 56, textAlignVertical: "top" }} />
      <DatePickerSheet
        open={picking}
        value={expiresOn || new Date().toISOString().slice(0, 10)}
        title="Expiry date"
        onClose={() => setPicking(false)}
        onSelect={(value) => {
          setExpiresOn(value);
          setPicking(false);
        }}
      />
    </Sheet>
  );
}
