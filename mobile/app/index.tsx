import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { hasSeenIntro, useSession } from "../src/auth/session";
import { useColors } from "../src/theme/ThemeProvider";

/**
 * The entry route: decides where a launch actually lands.
 *
 * Three questions in order — have they seen the intro, are they signed in, and
 * only then the app itself. Keeping this in one place means no screen has to
 * defend itself against being opened in the wrong state.
 *
 * The splash screen is held until the answer is known. Without that the app
 * flashes the login screen for a frame before redirecting a signed-in user to
 * the dashboard, which reads as a bug every single launch.
 */
export default function Entry() {
  const { session, ready } = useSession();
  const [seenIntro, setSeenIntro] = useState<boolean | null>(null);
  const colors = useColors();

  useEffect(() => {
    hasSeenIntro().then(setSeenIntro);
  }, []);

  const settled = ready && seenIntro !== null;

  useEffect(() => {
    if (settled) SplashScreen.hideAsync().catch(() => undefined);
  }, [settled]);

  if (!settled) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brand[600]} />
      </View>
    );
  }

  if (!seenIntro) return <Redirect href="/intro" />;
  if (!session) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(app)" />;
}
