import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getBaseUrl, setBaseUrl } from "../api/client";
import { useColors } from "../theme/ThemeProvider";
import { Button, Field, Txt } from "./ui";
import { radius, spacing } from "../theme";
import { useToast } from "./Toast";
import { BRAND } from "../brand";

/**
 * Where the app points.
 *
 * Almost nobody needs this, which is why it is a sheet behind a small link
 * rather than a field on the login form. But a customer running Chefotech on
 * their own infrastructure cannot use the app at all without it, and shipping
 * a separate build per customer to change one URL is not a plan.
 *
 * Changing the server signs the session out by design: tokens issued by one
 * deployment are meaningless to another, and silently carrying them across
 * produces a confusing 401 on the next screen instead of a clear prompt here.
 */
export function ServerSheet({
  open,
  currentUrl,
  onClose,
}: {
  open: boolean;
  currentUrl: string;
  onClose: () => void;
}) {
  const colors = useColors();
  const toast = useToast();
  const [value, setValue] = useState(currentUrl);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(currentUrl);
  }, [open, currentUrl]);

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed && !/^https?:\/\/.+/i.test(trimmed)) {
      toast.error("Enter a full address, starting with http:// or https://");
      return;
    }

    setSaving(true);
    try {
      await setBaseUrl(trimmed || null);
      toast.success(trimmed ? "Server updated." : "Reset to the default server.");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    await setBaseUrl(null);
    setValue(await getBaseUrl());
    toast.success("Reset to the default server.");
  };

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" }}
        onPress={onClose}
      >
        {/* Stop taps inside the sheet from dismissing it. */}
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing["2xl"],
            paddingBottom: spacing["4xl"],
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
            <Ionicons name="server-outline" size={20} color={colors.brand[600]} />
            <Txt variant="heading" style={{ marginLeft: spacing.sm, flex: 1 }}>
              Connection settings
            </Txt>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <Txt variant="body" tone="muted" style={{ marginBottom: spacing.lg, lineHeight: 21 }}>
            Only change this if your employer runs {BRAND.name} on their own servers and has
            given you an address.
          </Txt>

          <Field
            label="Server address"
            icon="link-outline"
            value={value}
            onChangeText={setValue}
            placeholder="https://hr.yourcompany.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!saving}
          />

          <Button title="Save and reconnect" onPress={save} loading={saving} />
          <Button
            title="Use the default server"
            variant="ghost"
            onPress={reset}
            style={{ marginTop: spacing.sm }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
