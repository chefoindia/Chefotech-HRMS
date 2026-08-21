// src/theme/ThemeProvider.js
//
// Scheme state for the whole app: "system" | "light" | "dark".
//
// Three behaviours that matter:
//   · The choice persists, so the app doesn't flip back on relaunch.
//   · "system" is the default and stays live — following the OS toggle at
//     runtime rather than reading it once at boot.
//   · The stored value is read synchronously-ish on mount and applied before
//     first paint where possible, so there's no white flash into dark mode.

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { palettes } from "./palettes";

const STORAGE_KEY = "grav.theme.scheme";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const system = useColorScheme(); // live — updates when the OS toggles
  // Follows the phone by default, per the user's choice. The palettes are
  // designed as one architecture at two luminosities, so neither is a
  // second-class rendition — see the direction contract in palettes.js.
  const [preference, setPreference] = useState("system");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (!alive) return;
        if (v === "light" || v === "dark" || v === "system") setPreference(v);
      })
      .catch(() => {})
      .finally(() => alive && setHydrated(true));
    return () => {
      alive = false;
    };
  }, []);

  const resolved = preference === "system" ? system || "light" : preference;

  const setScheme = useCallback((next) => {
    setPreference(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  // The toggle commits to an explicit scheme rather than cycling through
  // "system" — a three-state toggle on a header button is a guessing game.
  // Explicit light/dark lives in Settings.
  const toggle = useCallback(() => {
    setScheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setScheme]);

  const value = useMemo(
    () => ({
      colors: palettes[resolved],
      scheme: resolved,
      preference,
      setScheme,
      toggle,
      hydrated,
      isDark: resolved === "dark",
    }),
    [resolved, preference, setScheme, toggle, hydrated],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}

export default ThemeProvider;
