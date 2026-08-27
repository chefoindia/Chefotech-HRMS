import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dimensions, Modal, Pressable, View, type LayoutRectangle } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";
import { useColors } from "../theme/ThemeProvider";
import { Button, Txt } from "../components/ui";
import { radius, spacing } from "../theme";
import { fontStyle } from "../theme/fonts";
import { TOURS, type TourStep } from "./tours";

/**
 * The guided tour.
 *
 * The web version drives the real DOM; a native app has no DOM, so the same
 * idea is expressed with measured layout: screens wrap the things a tour talks
 * about in <TourTarget id="…">, those report their position, and the overlay
 * cuts a hole around whichever one the current step names.
 *
 * Two consequences worth stating:
 *
 *  - A step whose target has not mounted is SKIPPED, not stuck. Tabs mount
 *    lazily, so a tour that insisted on a target would hang forever on a
 *    screen the user has not opened yet.
 *  - The spotlight is drawn as four rectangles around the target rather than
 *    one rectangle with a hole. React Native has no `clip-path`, and four
 *    solid views composite far more cheaply than an SVG mask on a mid-range
 *    Android device.
 */

interface TargetRect extends LayoutRectangle {}

interface TourValue {
  register: (id: string, rect: TargetRect | null) => void;
  start: (tourId: string) => void;
  active: boolean;
}

const TourContext = createContext<TourValue | null>(null);

const SEEN_PREFIX = "chefotech.tour.";

export async function hasSeenTour(tourId: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(SEEN_PREFIX + tourId).catch(() => null)) === "yes";
}
async function markTourSeen(tourId: string) {
  await SecureStore.setItemAsync(SEEN_PREFIX + tourId, "yes").catch(() => undefined);
}

export function TourProvider({ children }: { children: ReactNode }) {
  const colors = useColors();
  const targets = useRef<Map<string, TargetRect>>(new Map());
  const [tourId, setTourId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [, forceRender] = useState(0);

  const register = useCallback((id: string, rect: TargetRect | null) => {
    if (rect) targets.current.set(id, rect);
    else targets.current.delete(id);
  }, []);

  const start = useCallback((id: string) => {
    setTourId(id);
    setStepIndex(0);
    // Targets may have been measured a moment ago; nudge a render so the
    // overlay reads the latest rects.
    forceRender((value) => value + 1);
  }, []);

  const tour = tourId ? TOURS.find((entry) => entry.id === tourId) : null;

  const finish = useCallback(async () => {
    if (tourId) await markTourSeen(tourId);
    setTourId(null);
    setStepIndex(0);
  }, [tourId]);

  // Resolve the current step, skipping any whose target never appeared.
  const resolved = useMemo(() => {
    if (!tour) return null;
    for (let index = stepIndex; index < tour.steps.length; index += 1) {
      const step = tour.steps[index];
      if (!step.target) return { step, index, rect: null as TargetRect | null };
      const rect = targets.current.get(step.target);
      if (rect) return { step, index, rect };
    }
    return null;
  }, [tour, stepIndex]);

  // Nothing left to show means the tour is over.
  useEffect(() => {
    if (tour && !resolved) finish();
  }, [tour, resolved, finish]);

  const value = useMemo<TourValue>(
    () => ({ register, start, active: Boolean(tourId) }),
    [register, start, tourId]
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {tour && resolved && (
        <TourOverlay
          step={resolved.step}
          rect={resolved.rect}
          index={resolved.index}
          total={tour.steps.length}
          onNext={() => setStepIndex(resolved.index + 1)}
          onBack={() => setStepIndex(Math.max(0, resolved.index - 1))}
          onSkip={finish}
        />
      )}
    </TourContext.Provider>
  );
}

function TourOverlay({
  step,
  rect,
  index,
  total,
  onNext,
  onBack,
  onSkip,
}: {
  step: TourStep;
  rect: TargetRect | null;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const colors = useColors();
  const { height: screenHeight, width: screenWidth } = Dimensions.get("window");
  const isLast = index >= total - 1;

  // Breathing room so the highlight does not clip the target's own shadow.
  const pad = 8;
  const hole = rect
    ? {
        x: Math.max(0, rect.x - pad),
        y: Math.max(0, rect.y - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  // Put the card wherever there is more room, so it never covers the thing it
  // is pointing at.
  const cardBelow = hole ? hole.y + hole.height < screenHeight * 0.55 : true;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onSkip}>
      <View style={{ flex: 1 }}>
        {hole ? (
          <>
            <Dim style={{ top: 0, left: 0, right: 0, height: hole.y }} />
            <Dim style={{ top: hole.y, left: 0, width: hole.x, height: hole.height }} />
            <Dim
              style={{
                top: hole.y,
                left: hole.x + hole.width,
                right: 0,
                height: hole.height,
              }}
            />
            <Dim style={{ top: hole.y + hole.height, left: 0, right: 0, bottom: 0 }} />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                ...hole,
                borderRadius: radius.lg,
                borderWidth: 2,
                borderColor: colors.brand[400],
              }}
            />
          </>
        ) : (
          <Dim style={{ ...StyleSheetAbsolute }} />
        )}

        <Animated.View
          entering={FadeIn.duration(220)}
          style={{
            position: "absolute",
            left: spacing.lg,
            right: spacing.lg,
            ...(cardBelow
              ? { top: (hole ? hole.y + hole.height : screenHeight / 2) + spacing.lg }
              : { bottom: screenHeight - (hole ? hole.y : screenHeight / 2) + spacing.lg }),
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.xl,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
            <Ionicons name="sparkles" size={16} color={colors.brand[600]} />
            <Txt variant="caption" tone="brand" style={[{ marginLeft: 6 }, fontStyle("600")]}>
              Step {index + 1} of {total}
            </Txt>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onSkip} hitSlop={12} accessibilityRole="button">
              <Txt variant="caption" tone="muted">
                Skip
              </Txt>
            </Pressable>
          </View>

          <Txt variant="heading">{step.title}</Txt>
          <Txt variant="body" tone="muted" style={{ marginTop: 6, lineHeight: 21 }}>
            {step.body}
          </Txt>

          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl }}>
            {index > 0 && (
              <Button title="Back" variant="secondary" onPress={onBack} style={{ flex: 1 }} />
            )}
            <Button
              title={isLast ? "Done" : "Next"}
              onPress={isLast ? onSkip : onNext}
              style={{ flex: 2 }}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const StyleSheetAbsolute = { top: 0, left: 0, right: 0, bottom: 0 } as const;

function Dim({ style }: { style: object }) {
  const colors = useColors();
  return (
    <View
      style={[{ position: "absolute", backgroundColor: colors.overlay }, style]}
      // The dimmed area swallows taps so the user cannot interact with what
      // the tour is currently explaining.
      pointerEvents="auto"
    />
  );
}

/**
 * Wraps anything a tour step can point at.
 *
 * Measurement uses `measureInWindow` rather than the onLayout rectangle,
 * because onLayout reports coordinates relative to the parent — inside a
 * ScrollView that is not where the element actually is on screen.
 */
export function TourTarget({ id, children }: { id: string; children: ReactNode }) {
  const tour = useContext(TourContext);
  const ref = useRef<View>(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width && height) tour?.register(id, { x, y, width, height });
    });
  }, [id, tour]);

  useEffect(() => {
    return () => tour?.register(id, null);
  }, [id, tour]);

  return (
    <View ref={ref} onLayout={measure} collapsable={false}>
      {children}
    </View>
  );
}

export function useTour(): TourValue {
  const context = useContext(TourContext);
  if (!context) {
    // Tours are an enhancement; a screen rendered outside the provider (a
    // modal, a test) should still work rather than crash.
    return { register: () => {}, start: () => {}, active: false };
  }
  return context;
}
