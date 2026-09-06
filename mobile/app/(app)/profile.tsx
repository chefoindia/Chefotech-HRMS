import { useEffect, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useProfile, useUpdateProfile, useUploadAvatar } from "../../src/api/hooks";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Button, Card, Divider, ErrorState, Field, Loading, Row, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { DetailRow, Note } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { ApiError } from "../../src/api/client";
import { pickPhoto } from "../../src/lib/files";
import { dateLabel, humanise, refName } from "../../src/lib/format";

/**
 * My profile — the web portal's /me/profile.
 *
 * Which fields an employee may edit is a tenant setting, not a hard-coded
 * list: the API rejects anything outside it and reports what it rejected,
 * so this screen stays correct when an organization narrows the list.
 */
export default function Profile() {
  const colors = useColors();
  const router = useRouter();
  const toast = useToast();
  const { session, signOut } = useSession();
  const query = useProfile();
  const save = useUpdateProfile();
  const upload = useUploadAvatar();

  const employee = query.data;
  const [form, setForm] = useState({ phone: "", alternatePhone: "", personalEmail: "", line1: "", city: "" });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (employee) {
      setForm({
        phone: employee.personal.phone || "",
        alternatePhone: employee.personal.alternatePhone || "",
        personalEmail: employee.personal.personalEmail || "",
        line1: employee.personal.currentAddress?.line1 || "",
        city: employee.personal.currentAddress?.city || "",
      });
      setDirty(false);
    }
  }, [employee]);

  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const onSave = async () => {
    try {
      const { data } = await save.mutateAsync({
        personal: { phone: form.phone, alternatePhone: form.alternatePhone, personalEmail: form.personalEmail, currentAddress: { ...(employee?.personal.currentAddress || {}), line1: form.line1, city: form.city } },
      });
      if (data.rejected.length) toast.error(`Saved, except: your organization does not allow you to edit ${data.rejected.join(", ")}.`);
      else toast.success("Profile updated.");
      setDirty(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save your profile.");
    }
  };

  const changePhoto = async () => {
    if (!employee) return;
    const file = await pickPhoto({ allowsEditing: true, aspect: [1, 1] });
    if (!file) return;
    try {
      await upload.mutateAsync({ employeeId: employee.id, file });
      toast.success("Photo updated.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not upload that photo.");
    }
  };

  const initials = `${session?.user.firstName?.[0] ?? ""}${session?.user.lastName?.[0] ?? ""}`.toUpperCase().trim();
  const manager = employee?.employment.managerId;
  const managerName = manager && typeof manager === "object" ? [manager.personal?.firstName, manager.personal?.lastName].filter(Boolean).join(" ") || manager.employeeCode || "—" : "—";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="My profile" action={dirty ? <Button title="Save" size="sm" icon="save-outline" onPress={onSave} loading={save.isPending} /> : undefined} />

        {query.isLoading ? (
          <Loading label="Loading your profile…" />
        ) : query.isError || !employee ? (
          <ErrorState message={query.error instanceof ApiError ? query.error.message : "Could not load your profile."} onRetry={query.refetch} />
        ) : (
          <>
            <Card>
              <View style={{ alignItems: "center", paddingVertical: spacing.md }}>
                <Pressable onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Change photo" disabled={upload.isPending}>
                  {employee.avatarUrl ? (
                    <Image source={{ uri: employee.avatarUrl }} style={{ width: 88, height: 88, borderRadius: radius.full, opacity: upload.isPending ? 0.5 : 1 }} contentFit="cover" transition={200} />
                  ) : (
                    <View style={{ width: 88, height: 88, borderRadius: radius.full, backgroundColor: colors.brand[100], alignItems: "center", justifyContent: "center" }}>
                      <Txt variant="display" tone="brand">
                        {initials || "?"}
                      </Txt>
                    </View>
                  )}
                  <View style={{ position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brand[600], borderWidth: 2, borderColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={upload.isPending ? "hourglass-outline" : "camera-outline"} size={15} color={colors.onBrand} />
                  </View>
                </Pressable>
                <Txt variant="heading" style={{ marginTop: spacing.md }}>
                  {employee.fullName}
                </Txt>
                <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {refName(employee.employment.designationId, "")}
                  {employee.employment.departmentId ? ` · ${refName(employee.employment.departmentId)}` : ""}
                </Txt>
                <Txt variant="caption" tone="subtle" style={{ marginTop: 4 }}>
                  {employee.employeeCode}
                </Txt>
              </View>
            </Card>

            <SectionHeader title="Contact details" action={dirty ? <Txt variant="caption" tone="warning">Unsaved changes</Txt> : undefined} />
            <Card>
              <Txt variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
                These are the fields you can change yourself. Work email: {employee.personal.workEmail || session?.user.email || "—"}
              </Txt>
              <Field label="Phone" value={form.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" />
              <Field label="Alternate phone" value={form.alternatePhone} onChangeText={(v) => set("alternatePhone", v)} keyboardType="phone-pad" />
              <Field label="Personal email" value={form.personalEmail} onChangeText={(v) => set("personalEmail", v)} keyboardType="email-address" autoCapitalize="none" />
              <Field label="Current address" value={form.line1} onChangeText={(v) => set("line1", v)} />
              <Field label="City" value={form.city} onChangeText={(v) => set("city", v)} />
              <Button title="Save changes" onPress={onSave} loading={save.isPending} disabled={!dirty} />
            </Card>

            <SectionHeader title="Employment" />
            <Card>
              <DetailRow label="Employee code" value={employee.employeeCode} />
              <DetailRow label="Department" value={refName(employee.employment.departmentId)} />
              <DetailRow label="Designation" value={refName(employee.employment.designationId)} />
              <DetailRow label="Location" value={refName(employee.employment.locationId)} />
              <DetailRow label="Manager" value={managerName} />
              <DetailRow label="Joining date" value={dateLabel(employee.employment.joiningDate)} />
              <DetailRow label="Employment type" value={humanise(employee.employment.employmentType)} />
              <DetailRow label="Status" value={humanise(employee.status)} last />
            </Card>
            <View style={{ marginTop: spacing.md }}>
              <Note tone="info">Employment details are managed by HR. If something here is wrong, ask them to correct it — or raise a request to change your details.</Note>
            </View>

            <SectionHeader title="Account" />
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              <Row icon="lock-closed-outline" title="Change password" subtitle="Signs you out of every device" onPress={() => router.push("/(app)/security")} />
              <Divider />
              <Row icon="shield-checkmark-outline" title="Security" subtitle="Two-factor authentication and signed-in devices" onPress={() => router.push("/(app)/security")} />
              <Divider />
              <Row icon="notifications-outline" title="Notification preferences" subtitle="What reaches your inbox and your phone" onPress={() => router.push("/(app)/notification-preferences")} />
              <Divider />
              <Row icon="swap-horizontal-outline" title="Request a change to my details" subtitle="Bank, statutory or personal details, approved by HR" onPress={() => router.push({ pathname: "/(app)/requests", params: { type: "profile_change" } })} />
              <Divider />
              <Row icon="log-out-outline" title="Sign out" danger onPress={() => signOut().then(() => router.replace("/(auth)/login"))} />
            </Card>
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}
