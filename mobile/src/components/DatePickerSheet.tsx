import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { addMonths, format, getDay, getDaysInMonth, parseISO, startOfMonth } from "date-fns";
import { useColors } from "../theme/ThemeProvider";
import { Button, Txt } from "./ui";
import { radius, spacing } from "../theme";

/**
 * A calendar sheet.
 *
 * Written rather than pulled in, for two reasons. The platform pickers look
 * and behave differently enough on iOS and Android that a shared design ends
 * up fighting both; and neither can grey out the days before a minimum date in
 * the inline style this form needs, which is exactly the constraint that keeps
 * a leave range from being invalid.
 */
export function DatePickerSheet({
  open,
  value,
  minimumDate,
  title,
  onSelect,
  onClose,
}: {
  open: boolean;
  value: string;
  /** ISO date; days before this cannot be picked. */
  minimumDate?: string;
  title: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const [cursor, setCursor] = useState(() => startOfMonth(parseISO(value)));

  // Reopening on a different value should land on that value's month, not
  // wherever the user last browsed to.
  useEffect(() => {
    if (open) setCursor(startOfMonth(parseISO(value)));
  }, [open, value]);

  const cells = useMemo(() => {
    const leading = getDay(cursor);
    const total = getDaysInMonth(cursor);
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: total }, (_, index) =>
        format(new Date(cursor.getFullYear(), cursor.getMonth(), index + 1), "yyyy-MM-dd")
      ),
    ];
  }, [cursor]);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing.xl,
            paddingBottom: spacing["3xl"],
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
            <Txt variant="heading" style={{ flex: 1 }}>
              {title}
            </Txt>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: spacing.md,
            }}
          >
            <Pressable
              onPress={() => setCursor(addMonths(cursor, -1))}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              style={{ padding: spacing.sm }}
            >
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </Pressable>
            <Txt variant="bodyMedium">{format(cursor, "MMMM yyyy")}</Txt>
            <Pressable
              onPress={() => setCursor(addMonths(cursor, 1))}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              style={{ padding: spacing.sm }}
            >
              <Ionicons name="chevron-forward" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", marginBottom: spacing.xs }}>
            {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
              <Txt key={index} variant="caption" tone="subtle" style={{ flex: 1, textAlign: "center" }}>
                {label}
              </Txt>
            ))}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {cells.map((date, index) => {
              if (!date) {
                return <View key={`blank-${index}`} style={{ width: `${100 / 7}%`, height: 44 }} />;
              }
              const isSelected = date === value;
              const isDisabled = minimumDate ? date < minimumDate : false;

              return (
                <Pressable
                  key={date}
                  onPress={() => !isDisabled && onSelect(date)}
                  disabled={isDisabled}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                  accessibilityLabel={format(parseISO(date), "d MMMM yyyy")}
                  style={{ width: `${100 / 7}%`, height: 44, padding: 3 }}
                >
                  <View
                    style={{
                      flex: 1,
                      borderRadius: radius.sm,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isSelected ? colors.brand[600] : "transparent",
                      opacity: isDisabled ? 0.3 : 1,
                    }}
                  >
                    <Txt
                      variant="label"
                      style={{ color: isSelected ? colors.onBrand : colors.text }}
                    >
                      {Number(date.slice(-2))}
                    </Txt>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Button
            title="Today"
            variant="ghost"
            onPress={() => {
              const today = format(new Date(), "yyyy-MM-dd");
              if (!minimumDate || today >= minimumDate) onSelect(today);
            }}
            style={{ marginTop: spacing.md }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
