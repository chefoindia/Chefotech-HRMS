import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { darkColors, lightColors, type Colors } from "./index";
import { buildBrandScale } from "./brandColor";
import { api } from "../api/client";
import { useSession } from "../auth/session";

/**
 * Theme, with the user's light/dark choice remembered AND the organization's
 * brand colour applied live.
 *
 * The brand colour is not a setting the app owner picked once — it is fetched
 * from `GET /organizations/current`, the same endpoint and the same field
 * (`branding.primaryColor`) the web portal reads. An HR admin who changes the
 * brand colour in Settings → Branding sees it on this app the next time it is
 * opened, with no app-store release involved, because the app was never
 * carrying its own copy of the colour to begin with.
 *
 * The derivation is the identical OKLCH scale the web app uses (see
 * theme/brandColor.ts), so the ten shades a component reaches for —
 * brand[50] through brand[900] — are pixel-identical to the web portal's,
 * not merely "close."
 */

type ThemePreference = "system" | "light" | "dark";

interface ThemeValue {
  colors: Colors;
  isDark: boolean;
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
  /** True while the organization's own colour has not loaded yet — the app is showing the default indigo. */
  isDefaultBrand: boolean;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = "chefotech.theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const { session } = useSession();

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        if (stored === "light" || stored === "dark" || stored === "system") {
          setPreferenceState(stored);
        }
      })
      .catch(() => undefined);
  }, []);

  const setPreference = (value: ThemePreference) => {
    setPreferenceState(value);
    SecureStore.setItemAsync(STORAGE_KEY, value).catch(() => undefined);
  };

  const isDark = preference === "system" ? systemScheme === "dark" : preference === "dark";

  // Branding changes on a human timescale — an admin picking a new colour —
  // not a per-second one, so a long staleTime avoids re-fetching it on every
  // screen focus while still catching a change within the hour.
  const branding = useQuery({
    queryKey: ["organization", "branding"],
    queryFn: async () => {
      const { data } = await api.get<{ branding?: { primaryColor?: string; accentColor?: string } }>(
        "/organizations/current"
      );
      return data?.branding ?? null;
    },
    enabled: Boolean(session),
    staleTime: 60 * 60_000,
    retry: 1,
  });

  const brandScale = useMemo(() => {
    const hex = branding.data?.primaryColor;
    return hex ? buildBrandScale(hex) : null;
  }, [branding.data?.primaryColor]);

  const value = useMemo<ThemeValue>(() => {
    const base = isDark ? darkColors : lightColors;
    const colors: Colors = brandScale ? { ...base, brand: brandScale } : base;
    return {
      colors,
      isDark,
      preference,
      setPreference,
      isDefaultBrand: !brandScale,
    };
  }, [isDark, preference, brandScale]);

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
