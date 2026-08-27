import { forwardRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, useTheme } from "../theme/ThemeProvider";
import { HIT_SLOP, MIN_TAP, radius, shadow, spacing, type } from "../theme";
import { fontStyle, type FontWeight } from "../theme/fonts";

/**
 * The shared UI kit.
 *
 * Small on purpose. Every component here exists because it is used on three or
 * more screens; anything used once stays on the screen that uses it, where it
 * can be read alongside its context instead of being abstracted into a prop
 * soup that nobody can follow.
 */

// ── Text ────────────────────────────────────────────────────────────────────

type Variant = keyof typeof type;
type Tone = "default" | "muted" | "subtle" | "brand" | "success" | "warning" | "danger" | "onBrand";

export function Txt({
  variant = "body",
  tone = "default",
  style,
  children,
  ...rest
}: TextProps & { variant?: Variant; tone?: Tone }) {
  const colors = useColors();
  const toneColor: Record<Tone, string> = {
    default: colors.text,
    muted: colors.textMuted,
    subtle: colors.textSubtle,
    brand: colors.brand[600],
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    onBrand: colors.onBrand,
  };
  return (
    <Text
      style={[
        type[variant] as object,
        // The variant already states its weight; this turns that into the
        // matching Inter file, because React Native will not pick one from
        // `fontWeight` alone on Android.
        fontStyle((type[variant] as { fontWeight?: FontWeight }).fontWeight),
        { color: toneColor[tone] },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  icon,
  style,
  ...rest
}: PressableProps & {
  title: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}) {
  const colors = useColors();
  const isDisabled = disabled || loading;

  const heights = { sm: 36, md: 46, lg: 54 };
  const palette = {
    primary: { bg: colors.brand[600], fg: colors.onBrand, border: "transparent" },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.border },
    ghost: { bg: "transparent", fg: colors.brand[600], border: "transparent" },
    danger: { bg: colors.danger, fg: colors.onBrand, border: "transparent" },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: Boolean(loading) }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        {
          height: heights[size],
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === "secondary" ? StyleSheet.hairlineWidth * 2 : 0,
          // A press that does not visibly respond reads as a missed tap, and
          // the user taps again — which is how a leave request gets submitted
          // twice.
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.985 : 1 }],
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={palette.fg} style={{ marginRight: 8 }} />}
          <Text
            style={[
              { fontSize: size === "sm" ? 14 : 15.5, color: palette.fg },
              fontStyle("600"),
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  padded = true,
  elevated = false,
}: {
  children: ReactNode;
  style?: ViewStyle;
  padded?: boolean;
  elevated?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          padding: padded ? spacing.lg : 0,
        },
        elevated ? shadow(2, colors) : undefined,
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ── Field ───────────────────────────────────────────────────────────────────

export const Field = forwardRef<TextInput, TextInputProps & {
  label?: string;
  error?: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  rightSlot?: ReactNode;
}>(function Field({ label, error, hint, icon, rightSlot, style, ...rest }, ref) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {label && (
        <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
          {label}
        </Txt>
      )}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: error ? colors.danger : colors.border,
          paddingHorizontal: spacing.md,
          minHeight: MIN_TAP + 4,
        }}
      >
        {icon && (
          <Ionicons name={icon} size={18} color={colors.textSubtle} style={{ marginRight: 8 }} />
        )}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textSubtle}
          style={[{ flex: 1, fontSize: 15.5, color: colors.text, paddingVertical: 12 }, style]}
          {...rest}
        />
        {rightSlot}
      </View>
      {(error || hint) && (
        <Txt variant="caption" tone={error ? "danger" : "subtle"} style={{ marginTop: 5 }}>
          {error || hint}
        </Txt>
      )}
    </View>
  );
});

// ── Badge ───────────────────────────────────────────────────────────────────

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "brand" | "info";
}) {
  const colors = useColors();
  const palette = {
    neutral: { bg: colors.surfaceSunken, fg: colors.textMuted },
    success: { bg: colors.successBg, fg: colors.success },
    warning: { bg: colors.warningBg, fg: colors.warning },
    danger: { bg: colors.dangerBg, fg: colors.danger },
    brand: { bg: colors.brand[50], fg: colors.brand[700] },
    info: { bg: colors.infoBg, fg: colors.info },
  }[tone];

  return (
    <View
      style={{
        backgroundColor: palette.bg,
        borderRadius: radius.full,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: "flex-start",
      }}
    >
      <Text style={[{ fontSize: 12, color: palette.fg }, fontStyle("600")]}>{label}</Text>
    </View>
  );
}

// ── Rows and lists ──────────────────────────────────────────────────────────

export function Row({
  icon,
  title,
  subtitle,
  right,
  onPress,
  danger,
  testID,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const content = (
    <View style={styles.row}>
      {icon && (
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: radius.md,
            backgroundColor: danger ? colors.dangerBg : colors.brand[50],
            alignItems: "center",
            justifyContent: "center",
            marginRight: spacing.md,
          }}
        >
          <Ionicons name={icon} size={17} color={danger ? colors.danger : colors.brand[600]} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyMedium" tone={danger ? "danger" : "default"} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle && (
          <Txt variant="caption" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>
            {subtitle}
          </Txt>
        )}
      </View>
      {right ??
        (onPress ? (
          <Ionicons name="chevron-forward" size={17} color={colors.textSubtle} />
        ) : null)}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      hitSlop={HIT_SLOP}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  );
}

export function Divider() {
  const colors = useColors();
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 46 }}
    />
  );
}

// ── States ──────────────────────────────────────────────────────────────────

export function EmptyState({
  icon = "file-tray-outline",
  title,
  body,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", paddingVertical: spacing["4xl"], paddingHorizontal: spacing.xl }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.full,
          backgroundColor: colors.surfaceSunken,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: spacing.lg,
        }}
      >
        <Ionicons name={icon} size={26} color={colors.textSubtle} />
      </View>
      <Txt variant="heading" style={{ textAlign: "center" }}>
        {title}
      </Txt>
      {body && (
        <Txt variant="body" tone="muted" style={{ textAlign: "center", marginTop: 6, lineHeight: 21 }}>
          {body}
        </Txt>
      )}
      {action && <View style={{ marginTop: spacing.xl }}>{action}</View>}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={{ paddingVertical: spacing["4xl"], alignItems: "center" }}>
      <ActivityIndicator color={colors.brand[600]} />
      {label && (
        <Txt variant="caption" tone="muted" style={{ marginTop: spacing.md }}>
          {label}
        </Txt>
      )}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="That did not load"
      body={message}
      action={onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : undefined}
    />
  );
}

// ── Screen scaffold ─────────────────────────────────────────────────────────

export function Screen({
  children,
  scroll = true,
  refreshControl,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<any>;
  contentStyle?: ViewStyle;
}) {
  const colors = useColors();
  const base: ViewStyle = { flex: 1, backgroundColor: colors.surfaceMuted };

  if (!scroll) return <View style={[base, contentStyle]}>{children}</View>;

  return (
    <ScrollView
      style={base}
      contentContainerStyle={[{ padding: spacing.lg, paddingBottom: spacing["4xl"] }, contentStyle]}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Txt variant="label" tone="subtle" style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
        {title}
      </Txt>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    minHeight: MIN_TAP,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
});
