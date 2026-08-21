import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import { darkColors, lightColors, type Colors } from "./index";

/**
 * Theme, with the user's choice remembered.
 *
 * Three states, not two: "system" is the default and the one most people want,
 * and collapsing it into a light/dark boolean means the app stops following
 * the phone at sunset.
 */

type ThemePreference = "system" | "light" | "dark";

interface ThemeValue {
  colors: Colors;
  isDark: boolean;
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = "chefotech.theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        if (stored === "light" || stored === "dark" || stored === "system") {
          setPreferenceState(stored);
        }
      })
      // A missing or unreadable preference is not an error worth surfacing;
      // the system default is a perfectly good answer.
      .catch(() => undefined);
  }, []);

  const setPreference = (value: ThemePreference) => {
    setPreferenceState(value);
    SecureStore.setItemAsync(STORAGE_KEY, value).catch(() => undefined);
  };

  const isDark = preference === "system" ? systemScheme === "dark" : preference === "dark";

  const value = useMemo<ThemeValue>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      isDark,
      preference,
      setPreference,
    }),
    [isDark, preference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

/** Shorthand for the common case. */
export function useColors(): Colors {
  return useTheme().colors;
}
