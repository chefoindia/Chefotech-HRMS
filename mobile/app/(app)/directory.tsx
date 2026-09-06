import { useEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useDepartments, useDirectory, useLocations } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Button, Card, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { PickerSheet } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";

/** People — the web portal's /me/directory: find a colleague and how to reach them. */
export default function DirectoryScreen() {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [page, setPage] = useState(1);
  const [picking, setPicking] = useState<"department" | "location" | null>(null);
  const departments = useDepartments();
  const locations = useLocations();
  const list = useDirectory({ q: query, departmentId, locationId, page });

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const departmentName = departments.data?.find((d) => d.id === departmentId)?.name;
  const locationName = locations.data?.find((l) => l.id === locationId)?.name;
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="People" />
        <Field placeholder="Search by name, code or skill" icon="search-outline" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} />
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: -spacing.sm, marginBottom: spacing.lg }}>
          <Pressable onPress={() => setPicking("department")} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: departmentId ? colors.brand[600] : colors.border, backgroundColor: departmentId ? colors.brand[50] : colors.surface }}>
            <Txt variant="label" tone={departmentId ? "brand" : "default"}>
              {departmentName || "All departments"}
            </Txt>
            <Ionicons name="chevron-down" size={14} color={departmentId ? colors.brand[600] : colors.textSubtle} />
          </Pressable>
          <Pressable onPress={() => setPicking("location")} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: locationId ? colors.brand[600] : colors.border, backgroundColor: locationId ? colors.brand[50] : colors.surface }}>
            <Txt variant="label" tone={locationId ? "brand" : "default"}>
              {locationName || "All locations"}
            </Txt>
            <Ionicons name="chevron-down" size={14} color={locationId ? colors.brand[600] : colors.textSubtle} />
          </Pressable>
        </View>

        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={list.error instanceof ApiError ? list.error.message : "Could not load the directory."} onRetry={list.refetch} />
        ) : !list.data?.items.length ? (
          <Card>
            <EmptyState icon="people-outline" title="Nobody matches" body="Try another name, or clear the filters." />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {list.data.items.map((p) => (
              <Card key={p.id}>
                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  {p.avatarUrl ? (
                    <Image source={{ uri: p.avatarUrl }} style={{ width: 48, height: 48, borderRadius: radius.full }} contentFit="cover" />
                  ) : (
                    <View style={{ width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.brand[100], alignItems: "center", justifyContent: "center" }}>
                      <Txt variant="label" tone="brand">
                        {initials(p.name)}
                      </Txt>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="bodyMedium" numberOfLines={1}>
                      {p.name}
                    </Txt>
                    <Txt variant="caption" tone="muted" numberOfLines={1}>
                      {p.designation || "—"}
                      {p.department ? ` · ${p.department}` : ""}
                    </Txt>
                    <Txt variant="caption" tone="subtle" numberOfLines={1}>
                      {p.location || ""}
                      {p.manager ? `${p.location ? " · " : ""}reports to ${p.manager.name}` : ""}
                    </Txt>
                    <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                      {p.workEmail && <Button title="Email" variant="secondary" size="sm" icon="mail-outline" onPress={() => Linking.openURL(`mailto:${p.workEmail}`)} />}
                      {p.phone && <Button title="Call" variant="secondary" size="sm" icon="call-outline" onPress={() => Linking.openURL(`tel:${p.phone}`)} />}
                    </View>
                    {p.skills.length > 0 && (
                      <Txt variant="caption" tone="subtle" numberOfLines={1} style={{ marginTop: 6 }}>
                        {p.skills.join(" · ")}
                      </Txt>
                    )}
                  </View>
                </View>
              </Card>
            ))}
            {list.data.total > 60 && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm }}>
                <Txt variant="caption" tone="muted">
                  Page {page} of {Math.ceil(list.data.total / 60)}
                </Txt>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button title="Previous" variant="secondary" size="sm" disabled={page <= 1} onPress={() => setPage(page - 1)} />
                  <Button title="Next" variant="secondary" size="sm" disabled={page * 60 >= list.data.total} onPress={() => setPage(page + 1)} />
                </View>
              </View>
            )}
          </View>
        )}
      </Screen>

      <PickerSheet open={picking === "department"} onClose={() => setPicking(null)} title="Department" options={(departments.data || []).map((d) => ({ value: d.id, label: d.name }))} value={departmentId} onSelect={(v) => { setDepartmentId(v); setPage(1); }} allowClear clearLabel="All departments" />
      <PickerSheet open={picking === "location"} onClose={() => setPicking(null)} title="Location" options={(locations.data || []).map((l) => ({ value: l.id, label: l.name }))} value={locationId} onSelect={(v) => { setLocationId(v); setPage(1); }} allowClear clearLabel="All locations" />
    </SafeAreaView>
  );
}
