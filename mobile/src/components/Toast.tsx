import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "../theme/ThemeProvider";
import { radius, shadow, spacing } from "../theme";
import { Txt } from "./ui";

/**
 * Toasts.
 *
 * Shown at the top rather than the bottom: the bottom of the screen is where
 * the tab bar and the primary action live, and a toast that covers the button
 * someone just pressed is a toast that gets tapped by accident.
 *
 * Success and error also fire a haptic. On a phone held at arm's length while
 * clocking in at a factory gate, the buzz is often noticed before the text is
 * read.
 */

type ToastTone = "success" | "error" | "info";

interface ToastValue {
  show: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

interface ActiveToast {
  id: number;
  message: string;
  tone: ToastTone;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextId = useRef(0);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -20, duration: 180, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, translateY]);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: (nextId.current += 1), message, tone });

      if (tone === "success") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } else if (tone === "error") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      }

      opacity.setValue(0);
      translateY.setValue(-20);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 18 }),
      ]).start();

      // Errors stay longer: they usually carry something the user has to act
      // on, and four seconds is not enough to read a sentence and decide.
      timer.current = setTimeout(dismiss, tone === "error" ? 5000 : 3000);
    },
    [dismiss, opacity, translateY]
  );

  useEffect(
    () => () => {
      // A cleanup must return nothing; the terse `&&` form returns the
      // clearTimeout result and React rejects it as a destructor.
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const value: ToastValue = {
    show,
    success: (message) => show(message, "success"),
    error: (message) => show(message, "error"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && <ToastView toast={toast} opacity={opacity} translateY={translateY} onDismiss={dismiss} />}
    </ToastContext.Provider>
  );
}

function ToastView({
  toast,
  opacity,
  translateY,
  onDismiss,
}: {
  toast: ActiveToast;
  opacity: Animated.Value;
  translateY: Animated.Value;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const palette = {
    success: { bg: colors.successBg, fg: colors.success, icon: "checkmark-circle" as const },
    error: { bg: colors.dangerBg, fg: colors.danger, icon: "alert-circle" as const },
    info: { bg: colors.surface, fg: colors.text, icon: "information-circle" as const },
  }[toast.tone];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFill,
        { top: insets.top + spacing.sm, alignItems: "center" },
        { opacity, transform: [{ translateY }] },
      ]}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          {
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            maxWidth: "92%",
            backgroundColor: palette.bg,
            borderColor: colors.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
          },
          shadow(3, colors),
        ]}
      >
        <Ionicons name={palette.icon} size={19} color={palette.fg} />
        <View style={{ flexShrink: 1 }}>
          <Txt variant="label" style={{ color: palette.fg, lineHeight: 19 }}>
            {toast.message}
          </Txt>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function useToast(): ToastValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
