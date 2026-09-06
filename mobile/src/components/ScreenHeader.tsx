import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "../theme/ThemeProvider";
import { Txt } from "./ui";
import { spacing } from "../theme";

/** Back arrow, title, optional action — the top of every secondary screen. */
export function ScreenHeader({ title, action }: { title: string; action?: ReactNode }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      <Txt variant="title" style={{ marginLeft: spacing.sm, flex: 1 }} numberOfLines={1}>
        {title}
      </Txt>
      {action}
    </View>
  );
}

/** A row of tappable choices — categories, priorities, request types. */
export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | ""; onChange: (value: T) => void }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.lg }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: active ? colors.brand[600] : colors.surface,
              borderWidth: 1,
              borderColor: active ? colors.brand[600] : colors.border,
            }}
          >
            <Txt variant="label" style={{ color: active ? colors.onBrand : colors.text }}>
              {option.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function humanise(value: string | null | undefined) {
  return String(value || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
