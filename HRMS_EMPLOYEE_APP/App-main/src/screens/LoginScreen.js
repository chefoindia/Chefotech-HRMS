// src/screens/LoginScreen.js
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
  StatusBar,
  Image,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../context/AuthContext";
import { Field, Band, PrimaryAction } from "../components/ui";
import { useTheme, radius, spacing, layout, type } from "../theme";

const LOGO = require("../../assets/grav-logo.png");

export default function LoginScreen() {
  const { login } = useAuth();
  const { colors, isDark } = useTheme();
  // Styles depend on the palette, so they are built per-scheme rather than at
  // module scope — a module-scope StyleSheet can only ever hold one theme.
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const passRef = useRef(null);

  const handleLogin = async () => {
    Keyboard.dismiss();
    if (!phone.trim() || !password.trim()) {
      setError("Enter your phone number and password");
      return;
    }
    setLoading(true);
    setError("");
    const res = await login(phone.trim(), password);
    setLoading(false);
    if (!res.success) setError(res.message || "Login failed");
  };

  return (
    <Field>
      <SafeAreaView style={s.safe}>
        {/* translucent + transparent so the field runs under the status bar.
            barStyle must follow the scheme — it was pinned to "dark-content",
            which paints dark glyphs on the dark ground in dark mode. */}
        <StatusBar
          barStyle={isDark ? "light-content" : "dark-content"}
          backgroundColor="transparent"
          translucent
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={s.container}>
              {/* The mark sits directly on the field — the one sanctioned
                  exception to The Field Is Not A Text Surface Rule is a page
                  title in full-strength ink, and the wordmark reads as one. */}
              <View style={s.topSection}>
                <Image source={LOGO} style={s.logo} resizeMode="contain" />
                <Text style={s.tagline}>Employee Portal</Text>
              </View>

              <Band weight="primary">
                <Text style={s.welcome}>Welcome back</Text>
                <Text style={s.welcomeSub}>Sign in to your account</Text>

                {error ? (
                  <View style={s.errorBox}>
                    <Ionicons name="alert-circle" size={16} color={colors.danger} />
                    <Text style={s.errorText}>{error}</Text>
                  </View>
                ) : null}

                <View style={s.inputGroup}>
                  <Text style={s.label}>Phone number</Text>
                  <View style={s.inputRow}>
                    <Ionicons
                      name="call-outline"
                      size={16}
                      color={colors.textFaint}
                      style={s.inputIcon}
                    />
                    <TextInput
                      style={s.input}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="Enter phone number"
                      keyboardType="phone-pad"
                      returnKeyType="next"
                      onSubmitEditing={() => passRef.current?.focus()}
                      placeholderTextColor={colors.textFaint}
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={s.inputGroup}>
                  <Text style={s.label}>Password</Text>
                  <View style={s.inputRow}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={16}
                      color={colors.textFaint}
                      style={s.inputIcon}
                    />
                    <TextInput
                      ref={passRef}
                      style={s.input}
                      value={password}
                      onChangeText={setPassword}
                      placeholder="Enter password"
                      secureTextEntry={!showPassword}
                      returnKeyType="done"
                      onSubmitEditing={handleLogin}
                      placeholderTextColor={colors.textFaint}
                      autoCapitalize="none"
                    />
                    <Pressable
                      onPress={() => setShowPassword((v) => !v)}
                      style={s.eyeBtn}
                      accessibilityRole="button"
                      accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                    >
                      <Ionicons
                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                        size={18}
                        color={colors.textFaint}
                      />
                    </Pressable>
                  </View>
                </View>

                <PrimaryAction
                  label={loading ? "" : "Sign in"}
                  onPress={handleLogin}
                  disabled={loading}
                  style={s.submit}
                />
                {loading ? (
                  <ActivityIndicator color={colors.onAccent} style={s.submitSpinner} />
                ) : null}
              </Band>

              <Text style={s.footer}>Grav Clothing Pvt. Ltd.</Text>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Field>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.loose },
  topSection: { alignItems: "center", marginBottom: spacing.section },
  logo: { width: 140, height: 72 },
  // On the field, secondary text takes ink-muted at Body size or larger —
  // ink-faint is a panel-only token.
  tagline: { ...type.body, color: colors.textMuted, marginTop: spacing.tight },

  welcome: { ...type.headline, color: colors.text },
  welcomeSub: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.hair,
    marginBottom: spacing.loose,
  },

  // Everything below sits INSIDE the <Band> (a Glass panel), so it paints
  // `inset` — never `glass`/`baseElevated`. Repainting a panel token inside a
  // panel is the two-tone artifact Screen.js rule 3 exists to prevent.
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.tight,
    backgroundColor: colors.inset,
    padding: spacing.snug,
    borderRadius: radius.control,
    borderLeftWidth: 2,
    borderLeftColor: colors.danger,
    marginBottom: spacing.base,
  },
  errorText: { ...type.caption, color: colors.text, flex: 1 },

  inputGroup: { marginBottom: spacing.base },
  label: { ...type.caption, color: colors.textFaint, marginBottom: spacing.tight },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inset,
    borderWidth: layout.hairlineWidth,
    borderColor: colors.insetBorder,
    borderRadius: radius.control,
    paddingHorizontal: spacing.snug,
    height: 46,
  },
  inputIcon: { marginRight: spacing.tight },
  input: { flex: 1, ...type.body, color: colors.text },
  eyeBtn: { padding: spacing.hair },

  submit: { marginTop: spacing.tight },
  submitSpinner: { position: "absolute", left: 0, right: 0, bottom: 36 },

  footer: {
    textAlign: "center",
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.section,
  },
});
