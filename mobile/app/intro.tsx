import { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Pressable,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { markIntroSeen } from "../src/auth/session";
import { useColors } from "../src/theme/ThemeProvider";
import { Button, Txt } from "../src/components/ui";
import { radius, spacing } from "../src/theme";

/**
 * The intro carousel.
 *
 * Four slides, shown once. Each one names something the app actually does
 * rather than making a claim about it — "check in from your phone" beats
 * "revolutionise your workday", because the second tells a new employee
 * nothing about what happens next.
 *
 * Skip is present on every slide and given the same visual weight as Next. An
 * onboarding flow you cannot leave is a wall, and the people most likely to
 * want out are the ones who have used the app before on another phone.
 */

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  tint: string;
}

const SLIDES: (colors: ReturnType<typeof useColors>) => Slide[] = (colors) => [
  {
    icon: "finger-print",
    title: "Check in from your phone",
    body: "One tap to clock in and out. If your employer requires it, your location is recorded at that moment — and only at that moment.",
    tint: colors.brand[600],
  },
  {
    icon: "calendar-outline",
    title: "See your attendance clearly",
    body: "Every day shows what was recorded and which rule decided its status, so a half day is never a mystery.",
    tint: colors.info,
  },
  {
    icon: "airplane-outline",
    title: "Apply for leave in seconds",
    body: "Pick your dates and see exactly how many days will be deducted — including how weekends inside the range are treated — before you submit.",
    tint: colors.success,
  },
  {
    icon: "document-text-outline",
    title: "Payslips and documents, always with you",
    body: "Every published payslip and every document your employer shares, downloadable whenever you need them.",
    tint: colors.warning,
  },
];

export default function Intro() {
  const colors = useColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const slides = SLIDES(colors);

  const finish = async () => {
    await markIntroSeen();
    router.replace("/(auth)/login");
  };

  const next = () => {
    if (index >= slides.length - 1) return finish();
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const position = Math.round(event.nativeEvent.contentOffset.x / width);
    if (position !== index) setIndex(position);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={["top", "bottom"]}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.lg }}>
        <Pressable
          onPress={finish}
          accessibilityRole="button"
          hitSlop={12}
          style={{ padding: spacing.sm }}
        >
          <Txt variant="label" tone="muted">
            Skip
          </Txt>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(item) => item.title}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Every slide is exactly one screen wide, so the list never has to
        // measure anything to know where a page starts.
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={{ width, alignItems: "center", justifyContent: "center", padding: spacing["3xl"] }}>
            <Animated.View
              entering={FadeIn.duration(400)}
              style={{
                width: 120,
                height: 120,
                borderRadius: radius.full,
                backgroundColor: `${item.tint}18`,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: spacing["3xl"],
              }}
            >
              <Ionicons name={item.icon} size={52} color={item.tint} />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(80).duration(400)}>
              <Txt variant="title" style={{ textAlign: "center" }}>
                {item.title}
              </Txt>
              <Txt
                variant="body"
                tone="muted"
                style={{ textAlign: "center", marginTop: spacing.md, lineHeight: 23 }}
              >
                {item.body}
              </Txt>
            </Animated.View>
          </View>
        )}
      />

      <View style={{ padding: spacing.xl, gap: spacing.xl }}>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
          {slides.map((slide, position) => (
            <View
              key={slide.title}
              style={{
                height: 7,
                width: position === index ? 22 : 7,
                borderRadius: radius.full,
                backgroundColor: position === index ? colors.brand[600] : colors.borderStrong,
              }}
            />
          ))}
        </View>

        <Button
          title={index >= slides.length - 1 ? "Get started" : "Next"}
          onPress={next}
          size="lg"
        />
      </View>
    </SafeAreaView>
  );
}
