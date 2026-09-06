import { useMemo, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "../theme/ThemeProvider";
import { Field, Txt } from "./ui";
import { radius, spacing } from "../theme";

/**
 * A bottom sheet: the phone's equivalent of the web portal's dialogs.
 *
 * One component so every form (acknowledge a document, change a password,
 * rate a ticket) opens the same way, dismisses the same way, and scrolls
 * above the keyboard the same way.
 */
export function Sheet({ open, onClose, title, subtitle, children, footer, tall }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  const colors = useColors();
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" }} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ justifyContent: "flex-end", maxHeight: "100%" }}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              maxHeight: tall ? "94%" : "88%",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing["2xl"], paddingTop: spacing["2xl"], paddingBottom: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Txt variant="heading" numberOfLines={2}>
                  {title}
                </Txt>
                {subtitle ? (
                  <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                    {subtitle}
                  </Txt>
                ) : null}
              </View>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: spacing["2xl"], paddingBottom: footer ? spacing.md : spacing["4xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
            {footer ? (
              <View style={{ paddingHorizontal: spacing["2xl"], paddingTop: spacing.md, paddingBottom: spacing["3xl"], borderTopWidth: 1, borderTopColor: colors.border }}>{footer}</View>
            ) : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

/** A searchable list of options in a sheet — departments, shifts, colleagues. */
export function PickerSheet({ open, onClose, title, options, value, onSelect, searchable = true, allowClear, clearLabel = "None" }: { open: boolean; onClose: () => void; title: string; options: PickerOption[]; value: string | null | undefined; onSelect: (value: string) => void; searchable?: boolean; allowClear?: boolean; clearLabel?: string }) {
  const colors = useColors();
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint || "").toLowerCase().includes(q)) : options;
  }, [options, search]);

  return (
    <Sheet open={open} onClose={onClose} title={title} tall>
      {searchable && options.length > 6 && <Field placeholder="Search" icon="search-outline" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} />}
      {allowClear && (
        <Pressable
          onPress={() => {
            onSelect("");
            onClose();
          }}
          style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <Txt variant="body" tone="muted">
            {clearLabel}
          </Txt>
        </Pressable>
      )}
      {shown.length === 0 ? (
        <Txt variant="body" tone="muted" style={{ paddingVertical: spacing.lg }}>
          Nothing matches.
        </Txt>
      ) : (
        shown.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                onSelect(option.value);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
            >
              <View style={{ flex: 1 }}>
                <Txt variant={active ? "bodyMedium" : "body"} tone={active ? "brand" : "default"}>
                  {option.label}
                </Txt>
                {option.hint ? (
                  <Txt variant="caption" tone="muted">
                    {option.hint}
                  </Txt>
                ) : null}
              </View>
              {active && <Ionicons name="checkmark" size={18} color={colors.brand[600]} />}
            </Pressable>
          );
        })
      )}
    </Sheet>
  );
}

/** A tappable field that opens a picker — the phone's <select>. */
export function SelectField({ label, value, placeholder = "Choose", onPress, hint, error }: { label?: string; value: string | null | undefined; placeholder?: string; onPress: () => void; hint?: string; error?: string }) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {label && (
        <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
          {label}
        </Txt>
      )}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: error ? colors.danger : colors.border, paddingHorizontal: spacing.md, minHeight: 48 }}
      >
        <Txt variant="body" tone={value ? "default" : "subtle"} style={{ flex: 1 }} numberOfLines={1}>
          {value || placeholder}
        </Txt>
        <Ionicons name="chevron-down" size={17} color={colors.textSubtle} />
      </Pressable>
      {(error || hint) && (
        <Txt variant="caption" tone={error ? "danger" : "subtle"} style={{ marginTop: 5 }}>
          {error || hint}
        </Txt>
      )}
    </View>
  );
}

/** A labelled on/off row. */
export function ToggleRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Txt variant="bodyMedium">{label}</Txt>
        {hint ? (
          <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <View style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: value ? colors.brand[600] : colors.borderStrong, justifyContent: "center", paddingHorizontal: 3 }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff", alignSelf: value ? "flex-end" : "flex-start" }} />
      </View>
    </Pressable>
  );
}

/** A check box row for "I have read this" style confirmations. */
export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: spacing.sm }}>
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={checked ? colors.brand[600] : colors.textSubtle} />
      <Txt variant="body" style={{ flex: 1, marginLeft: spacing.sm, lineHeight: 21 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Small tabs, the phone's version of the web Tabs strip. */
export function TabStrip<T extends string>({ items, active, onChange }: { items: { key: T; label: string; count?: number }[]; active: T; onChange: (key: T) => void }) {
  const colors = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg, flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
      {items.map((item) => {
        const on = item.key === active;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? colors.brand[600] : colors.surface, borderWidth: 1, borderColor: on ? colors.brand[600] : colors.border }}
          >
            <Txt variant="label" style={{ color: on ? colors.onBrand : colors.text }}>
              {item.label}
            </Txt>
            {typeof item.count === "number" && item.count > 0 && (
              <View style={{ marginLeft: 6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: on ? "rgba(255,255,255,0.25)" : colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
                <Txt variant="caption" style={{ color: on ? colors.onBrand : colors.textMuted, fontSize: 11 }}>
                  {item.count}
                </Txt>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A quiet informational box. */
export function Note({ tone = "info", children }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode }) {
  const colors = useColors();
  const bg = { info: colors.infoBg, warning: colors.warningBg, danger: colors.dangerBg, success: colors.successBg }[tone];
  const fg = { info: colors.info, warning: colors.warning, danger: colors.danger, success: colors.success }[tone];
  const icon = { info: "information-circle-outline", warning: "alert-circle-outline", danger: "alert-circle-outline", success: "checkmark-circle-outline" }[tone] as "information-circle-outline";
  return (
    <View style={{ flexDirection: "row", backgroundColor: bg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg }}>
      <Ionicons name={icon} size={18} color={fg} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>{typeof children === "string" ? <Txt variant="caption" style={{ color: fg, lineHeight: 18 }}>{children}</Txt> : children}</View>
    </View>
  );
}

/** Label/value pairs, the phone's DetailGrid. */
export function DetailRow({ label, value, last }: { label: string; value: ReactNode; last?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <Txt variant="label" tone="muted" style={{ flex: 1 }}>
        {label}
      </Txt>
      {typeof value === "string" || typeof value === "number" ? (
        <Txt variant="label" style={{ flex: 1.4, textAlign: "right" }} numberOfLines={2}>
          {value}
        </Txt>
      ) : (
        <View style={{ flex: 1.4, alignItems: "flex-end" }}>{value}</View>
      )}
    </View>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, minWidth: "45%", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      <Txt variant="heading" style={{ marginTop: 2 }}>
        {value}
      </Txt>
      {hint ? (
        <Txt variant="caption" tone="subtle" style={{ marginTop: 2 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}
