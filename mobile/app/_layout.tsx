import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { SessionProvider } from "../src/auth/session";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { ToastProvider } from "../src/components/Toast";
import { AppLockGate } from "../src/auth/AppLockGate";
import { TourProvider } from "../src/help/TourEngine";
import { ApiError } from "../src/api/client";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Root layout: providers, theme, and the lock screen.
 *
 * Query defaults are tuned for a phone rather than a desktop. HR data changes
 * on a human timescale, so a minute of staleness costs nothing, while a
 * refetch storm on a metered connection costs the user money.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        retry(failureCount, error) {
          // Offline is not a server problem and retrying immediately will not
          // fix it; the focus listener below refetches when the app returns.
          if (error instanceof ApiError && error.isOffline) return false;
          if (error instanceof ApiError && error.status < 500 && error.status !== 429) {
            return false;
          }
          return failureCount < 2;
        },
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
    },
  });
}

/**
 * React Query's window-focus refetching is a browser concept. On a phone the
 * equivalent event is the app coming back to the foreground, which is exactly
 * when a stale check-in state would be most misleading.
 */
function useAppStateFocus() {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (Platform.OS !== "web") focusManager.setFocused(status === "active");
    });
    return () => subscription.remove();
  }, []);
}

function RootNavigator() {
  const { isDark, colors } = useTheme();
  useAppStateFocus();

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.surfaceMuted },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="intro" options={{ animation: "fade" }} />
        <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
        <Stack.Screen name="(app)" options={{ animation: "fade" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(makeQueryClient);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            {/* Inside Session and QueryClient deliberately: the organization's
                brand colour is fetched here, which needs both a signed-in
                session and react-query. */}
            <ThemeProvider>
              <ToastProvider>
                <AppLockGate>
                  <TourProvider>
                    <RootNavigator />
                  </TourProvider>
                </AppLockGate>
              </ToastProvider>
            </ThemeProvider>
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
