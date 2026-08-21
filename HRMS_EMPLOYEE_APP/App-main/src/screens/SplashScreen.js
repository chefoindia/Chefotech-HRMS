// src/screens/SplashScreen.js
//
// Shown while the session is being restored from secure storage.
//
// It exists to remove a specific ugly moment: the app used to mount, decide
// it had no user, paint Login, then a few hundred milliseconds later restore
// the token and swap to the dashboard. That flash of a login form you never
// needed to see is what made launch feel broken. Holding here until auth
// resolves costs the same time but reads as loading rather than as a bug.

import React, { useEffect, useRef } from "react";
import { View, Image, StyleSheet, Text, Animated, Easing } from "react-native";

import { Aurora } from "../components/ui";
import { useTheme, spacing, type } from "../theme";

const LOGO = require("../../assets/grav-logo.png");

export default function SplashScreen({ message }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const markStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }),
    transform: [
      { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.02] }) },
    ],
  };

  return (
    <Aurora>
      <View style={styles.root}>
        <Animated.View style={markStyle}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </Animated.View>
        {message ? (
          <Text style={[type.caption, { color: colors.textMuted, marginTop: spacing.loose }]}>
            {message}
          </Text>
        ) : null}
      </View>
    </Aurora>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: { width: 180, height: 90 },
});
