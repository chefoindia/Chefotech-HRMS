import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { format } from "date-fns";
import { useMyDocuments } from "../../src/api/hooks";
import { api, tokens, ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Card, EmptyState, ErrorState, Loading, Screen, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";

/**
 * Documents shared with the employee.
 *
 * Everything here is private — offer letters, certificates, contracts — so
 * each file is fetched through the authenticated proxy with the session token
 * rather than a public URL, and handed to the share sheet from the app's own
 * cache.
 */
export default function Documents() {
  const colors = useColors();
  const router = useRouter();
  const toast = useToast();
  const query = useMyDocuments();
  const [busy, setBusy] = useState<string | null>(null);

  const open = async (id: string, fileName: string) => {
    setBusy(id);
    try {
      const url = await api.fileUrl(`/files/${id}/content`);
      const { access } = await tokens.get();
      const safeName = fileName.replace(/[^\w.\-]+/g, "-");
      const target = new File(Paths.cache, safeName);

      const file = await File.downloadFileAsync(url, target, {
        headers: access ? { Authorization: `Bearer ${access}` } : undefined,
        idempotent: true,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { dialogTitle: fileName });
      } else {
        toast.success("Downloaded.");
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not open that document.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={colors.brand[600]}
          />
        }
      >
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Txt variant="title" style={{ marginLeft: spacing.sm }}>
            Documents
          </Txt>
        </View>

        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState
            message={query.error instanceof ApiError ? query.error.message : "Could not load these."}
            onRetry={query.refetch}
          />
        ) : (query.data ?? []).length === 0 ? (
          <Card>
            <EmptyState
              icon="folder-open-outline"
              title="No documents yet"
              body="Letters and certificates your employer shares with you will appear here."
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {(query.data ?? []).map((document) => (
              <Pressable
                key={document.id}
                onPress={() => open(document.id, document.fileName)}
                disabled={busy === document.id}
                accessibilityRole="button"
                style={({ pressed }) => ({ opacity: pressed || busy === document.id ? 0.6 : 1 })}
              >
                <Card>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: radius.md,
                        backgroundColor: colors.brand[50],
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: spacing.md,
                      }}
                    >
                      <Ionicons
                        name={busy === document.id ? "hourglass-outline" : "document-outline"}
                        size={19}
                        color={colors.brand[600]}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt variant="bodyMedium" numberOfLines={1}>
                        {document.fileName}
                      </Txt>
                      <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                        {document.category ? `${document.category} · ` : ""}
                        {format(new Date(document.createdAt), "d MMM yyyy")}
                      </Txt>
                    </View>
                    <Ionicons name="download-outline" size={18} color={colors.textSubtle} />
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </Screen>
    </SafeAreaView>
  );
}
