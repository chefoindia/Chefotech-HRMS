// src/navigation/AppNavigator.js
import React, { useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  DarkTheme,
  DefaultTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import FloatingTabBar from "../components/ui/FloatingTabBar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../context/AuthContext";
import { useTheme, layout, type } from "../theme";

import SplashScreen from "../screens/SplashScreen";
import OnboardingScreen, { ONBOARDING_KEY } from "../screens/OnboardingScreen";
import LockScreen from "../screens/LockScreen";
import { isAppLockEnabled, isBiometricAvailable } from "../lib/biometrics";
import LoginScreen from "../screens/LoginScreen";
import DashboardScreen from "../screens/DashboardScreen";
import WorkScreen from "../screens/WorkScreen";
import RegularizeScreen from "../screens/RegularizeScreen";
import DocumentsScreen from "../screens/DocumentsScreen";

import LeaveScreen from "../screens/LeaveScreen";
import OvertimeScreen from "../screens/Overtimescreen";
import AttendanceScreen from "../screens/AttendanceScreen";
import PerformanceScreen from "../screens/PerformanceScreen";
import LeaderboardScreen from "../screens/LeaderboardScreen";
import SalaryScreen from "../screens/SalaryScreen";
import ProfileScreen from "../screens/ProfileScreen";

// The `withAurora` bridge is gone: every screen in the app is now on
// <Screen>, which owns Aurora itself. Wrapping one again would mount a second
// full-screen opaque gradient behind the first and render it every frame for
// nothing.

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const WorkNav = createNativeStackNavigator();

// ── Exported navigation ref — used by App.js for notification deep-linking ──
export const navigationRef = createNavigationContainerRef();

/**
 * Tasks, Leave, Overtime and Attendance group behind one tab, because five
 * tabs is the practical ceiling on a phone.
 *
 * Tasks was removed: it showed interview tasks that apply to almost nobody
 * and was empty for everyone else. Regularize replaces it — correcting a
 * missed punch is what employees actually need from an attendance app.
 */
function WorkStack() {
  return (
    <WorkNav.Navigator screenOptions={{ headerShown: false }}>
      <WorkNav.Screen name="WorkHub" component={WorkScreen} />
      <WorkNav.Screen name="Regularize" component={RegularizeScreen} />
      <WorkNav.Screen name="Leave" component={LeaveScreen} />
      <WorkNav.Screen name="Overtime" component={OvertimeScreen} />
      <WorkNav.Screen name="Attendance" component={AttendanceScreen} />
      <WorkNav.Screen name="Performance" component={PerformanceScreen} />
      {/* Route name is byte-matched by notifyEmployee's SCREENS registry on the
          backend. Renaming it here silently drops every document push. */}
      <WorkNav.Screen name="Documents" component={DocumentsScreen} />
    </WorkNav.Navigator>
  );
}

const TABS = [
  { name: "Home", component: DashboardScreen, icon: "home-outline", active: "home" },
  { name: "Work", component: WorkStack, icon: "layers-outline", active: "layers" },
  {
    name: "Standings",
    component: LeaderboardScreen,
    icon: "trophy-outline",
    active: "trophy",
  },
  { name: "Pay", component: SalaryScreen, icon: "card-outline", active: "card" },
  { name: "Profile", component: ProfileScreen, icon: "person-outline", active: "person" },
];

// Icons live here rather than inside the bar so the bar stays a pure
// presentation component and the tab list remains the single source of truth.
const TAB_ICONS = TABS.reduce((acc, t) => {
  acc[t.name] = { idle: t.icon, active: t.active };
  return acc;
}, {});

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // The pill floats over content, so screens must be able to scroll
        // beneath it. Each screen adds bottom padding of its own.
        tabBarStyle: { position: "absolute", borderTopWidth: 0, elevation: 0, backgroundColor: "transparent" },
      }}
      tabBar={(props) => <FloatingTabBar {...props} icons={TAB_ICONS} />}
    >
      {TABS.map((t) => (
        <Tab.Screen key={t.name} name={t.name} component={t.component} />
      ))}
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user, loading, logout } = useAuth();
  const { scheme, colors } = useTheme();

  // App Lock: null = not yet determined, true = must unlock before Main.
  const [locked, setLocked] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!user) {
      setLocked(false);
      return;
    }
    Promise.all([isAppLockEnabled(), isBiometricAvailable()])
      .then(([enabled, available]) => {
        // If the user enabled the lock and then removed every enrolled
        // fingerprint, honouring it would lock them out of the app with no
        // way back in. Availability has to gate it.
        if (alive) setLocked(Boolean(enabled && available));
      })
      .catch(() => alive && setLocked(false));
    return () => {
      alive = false;
    };
  }, [user]);

  // Onboarding is keyed on its own completion flag, not on whether a session
  // exists — otherwise signing out would replay the whole intro.
  const [onboarded, setOnboarded] = useState(null); // null = still reading

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((v) => alive && setOnboarded(v === "1"))
      .catch(() => alive && setOnboarded(false));
    return () => {
      alive = false;
    };
  }, []);

  const completeOnboarding = useCallback(() => {
    setOnboarded(true);
    AsyncStorage.setItem(ONBOARDING_KEY, "1").catch(() => {});
  }, []);

  // ── Handle notification that launched the app (cold start) ──────────────
  useEffect(() => {
    if (!user) return;
    if (Platform.OS === "web") return;

    import("expo-notifications")
      .then((Notifications) => {
        Notifications.getLastNotificationResponseAsync()
          .then((response) => {
            if (!response) return;
            const data = response.notification.request.content.data;
            if (data?.screen && navigationRef.current?.isReady()) {
              setTimeout(() => {
                try {
                  navigationRef.current.navigate("Main", { screen: data.screen });
                } catch (e) {
                  console.warn("[PUSH] Cold-start navigation failed:", e.message);
                }
              }, 500);
            }
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, [user]);

  // Hold on the splash until BOTH the session and the onboarding flag have
  // resolved. Rendering earlier is what caused a login form to flash before
  // a restored session swapped it away.
  if (loading || onboarded === null || (user && locked === null)) {
    return <SplashScreen />;
  }

  if (!user && !onboarded) {
    return <OnboardingScreen onDone={completeOnboarding} />;
  }

  if (user && locked) {
    return <LockScreen onUnlock={() => setLocked(false)} onSignOut={logout} />;
  }

  const navTheme = {
    ...(scheme === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === "dark" ? DarkTheme : DefaultTheme).colors,
      background: "transparent",
      card: "transparent",
      text: colors.text,
      primary: colors.accent,
      border: colors.glassBorder,
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: "fade" }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <Stack.Screen name="Main" component={MainTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
