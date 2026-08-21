import { useCallback, useState } from "react";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { Alert, Linking, Platform } from "react-native";
import { usePunch, type TodayStatus } from "../api/hooks";
import { ApiError } from "../api/client";

/**
 * Check in and out.
 *
 * The awkward part of this feature is location, and most of this file is about
 * handling it honestly:
 *
 *  - Permission is requested at the moment of the first punch, not at launch.
 *    A permission dialog on first open, before the user has seen why it is
 *    needed, is the single most common reason people deny it permanently.
 *  - A denial does not block the punch. Whether location is *required* is the
 *    employer's policy, enforced by the server, which can reject the punch
 *    with a clear reason. The app refusing on its own would invent a rule the
 *    organisation may not have.
 *  - Acquiring a fix is time-boxed. Indoors, on a factory floor, a GPS lock
 *    can take 30 seconds or never arrive, and an employee standing at the gate
 *    should not be held hostage by it.
 */

/** Long enough for a realistic fix, short enough not to feel broken. */
const LOCATION_TIMEOUT_MS = 8000;

export interface CheckInResult {
  ok: boolean;
  direction: "in" | "out";
  message: string;
}

export function useCheckIn(today: TodayStatus | undefined) {
  const punch = usePunch();
  const [locating, setLocating] = useState(false);

  const captureLocation = useCallback(async () => {
    const existing = await Location.getForegroundPermissionsAsync();

    let status = existing.status;
    if (status !== "granted" && existing.canAskAgain) {
      status = (await Location.requestForegroundPermissionsAsync()).status;
    }

    if (status !== "granted") {
      // Permanently denied: point at Settings once, then carry on without it.
      if (!existing.canAskAgain) {
        Alert.alert(
          "Location is off",
          "Your check-in will still be recorded, but without a location. If your employer requires one, turn location on for Chefotech HRMS in Settings.",
          [
            { text: "Not now", style: "cancel" },
            {
              text: "Open settings",
              onPress: () =>
                Platform.OS === "ios"
                  ? Linking.openURL("app-settings:")
                  : Linking.openSettings(),
            },
          ]
        );
      }
      return undefined;
    }

    // Race the fix against a timeout rather than awaiting it indefinitely.
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS)),
    ]).catch(() => null);

    if (!fix) return undefined;

    return {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? undefined,
    };
  }, []);

  const submit = useCallback(
    async (note?: string): Promise<CheckInResult> => {
      // Derived from the server's own view of the day, never from local state
      // — a phone that has been asleep may be several punches behind.
      const direction: "in" | "out" = today?.nextDirection ?? "in";

      setLocating(true);
      let location: Awaited<ReturnType<typeof captureLocation>>;
      try {
        location = await captureLocation();
      } finally {
        setLocating(false);
      }

      try {
        await punch.mutateAsync({ direction, location, note });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        return {
          ok: true,
          direction,
          message: direction === "in" ? "Checked in." : "Checked out.",
        };
      } catch (error) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        const message =
          error instanceof ApiError
            ? error.isOffline
              ? "You are offline. Your check-in was not recorded — try again when you have a connection."
              : error.message
            : "Could not record that. Please try again.";
        return { ok: false, direction, message };
      }
    },
    [captureLocation, punch, today?.nextDirection]
  );

  return {
    submit,
    /** True while either acquiring a fix or posting the punch. */
    busy: locating || punch.isPending,
    locating,
  };
}
