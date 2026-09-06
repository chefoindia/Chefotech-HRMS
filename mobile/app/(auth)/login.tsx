import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSession } from "../../src/auth/session";
import { ApiError, getBaseUrl } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Button, Field, Txt } from "../../src/components/ui";
import { spacing } from "../../src/theme";
import { ServerSheet } from "../../src/components/ServerSheet";
import { Wordmark } from "../../src/components/Wordmark";

/**
 * Sign in.
 *
 * Deliberately spare: an employee opening this at a factory gate on a cold
 * morning wants two fields and a button, not a marketing panel.
 *
 * The server address is reachable but tucked away, because most people are on
 * the hosted service and should never think about it, while a customer running
 * their own deployment cannot use the app at all without it.
 */
export default function Login() {
  const { signIn, completeMfa } = useSession();
  const router = useRouter();
  const colors = useColors();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverSheetOpen, setServerSheetOpen] = useState(false);
  const [baseUrl, setBaseUrlLabel] = useState<string>("");
  // The second step, when the account has two-factor on.
  const [mfa, setMfa] = useState<{ token: string; code: string; recovery: boolean } | null>(null);

  const submit = async () => {
    setError(null);
    setFieldErrors({});

    if (!email.trim() || !password) {
      setFieldErrors({
        ...(email.trim() ? {} : { email: "Enter your work email." }),
        ...(password ? {} : { password: "Enter your password." }),
      });
      return;
    }

    setSubmitting(true);
    try {
      const outcome = await signIn(email.trim(), password);
      if (outcome.mfaRequired) {
        setMfa({ token: outcome.mfaToken, code: "", recovery: false });
        return;
      }
      router.replace("/(app)");
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError("Could not sign in. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitCode = async () => {
    if (!mfa) return;
    setError(null);
    setSubmitting(true);
    try {
      await completeMfa(mfa.token, mfa.code.trim());
      router.replace("/(app)");
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        // The five-minute window closed: back to the password.
        if (/expired/i.test(caught.message)) setMfa(null);
      } else {
        setError("Could not verify the code. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (mfa) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing["2xl"] }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInDown.duration(300)}>
              <View style={{ alignItems: "center", marginBottom: spacing["2xl"] }}>
                <Ionicons name="shield-checkmark-outline" size={40} color={colors.brand[600]} />
                <Txt variant="title" style={{ marginTop: spacing.lg }}>
                  Two-factor authentication
                </Txt>
                <Txt variant="body" tone="muted" style={{ marginTop: 4, textAlign: "center" }}>
                  {mfa.recovery ? "Enter one of the recovery codes you saved when you set this up." : "Enter the six-digit code from your authenticator app."}
                </Txt>
              </View>

              {error && (
                <View accessibilityRole="alert" style={{ backgroundColor: colors.dangerBg, borderRadius: 12, padding: spacing.md, marginBottom: spacing.lg, flexDirection: "row", gap: spacing.sm }}>
                  <Ionicons name="alert-circle" size={18} color={colors.danger} />
                  <Txt variant="label" tone="danger" style={{ flex: 1, lineHeight: 19 }}>
                    {error}
                  </Txt>
                </View>
              )}

              <Field
                label={mfa.recovery ? "Recovery code" : "Authentication code"}
                icon={mfa.recovery ? "key-outline" : "shield-checkmark-outline"}
                value={mfa.code}
                onChangeText={(code) => setMfa({ ...mfa, code })}
                placeholder={mfa.recovery ? "ABCDE-FGHJK" : "123456"}
                keyboardType={mfa.recovery ? "default" : "number-pad"}
                autoCapitalize={mfa.recovery ? "characters" : "none"}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                returnKeyType="go"
                onSubmitEditing={submitCode}
                editable={!submitting}
                autoFocus
              />

              <Button title="Continue" onPress={submitCode} loading={submitting} size="lg" disabled={mfa.code.replace(/\s/g, "").length < 6} />

              <Pressable onPress={() => setMfa({ ...mfa, recovery: !mfa.recovery, code: "" })} style={{ alignSelf: "center", marginTop: spacing.xl, padding: spacing.sm }} hitSlop={8}>
                <Txt variant="label" tone="brand">
                  {mfa.recovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
                </Txt>
              </Pressable>
              <Pressable onPress={() => setMfa(null)} style={{ alignSelf: "center", padding: spacing.sm }} hitSlop={8}>
                <Txt variant="caption" tone="subtle">
                  Start over
                </Txt>
              </Pressable>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const openServerSheet = async () => {
    setBaseUrlLabel(await getBaseUrl());
    setServerSheetOpen(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing["2xl"] }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(400)}>
            <View style={{ alignItems: "center", marginBottom: spacing["3xl"] }}>
              {/* Names the product before asking for a password — see Wordmark. */}
              <Wordmark size="lg" />
              <Txt variant="title" style={{ marginTop: spacing["2xl"] }}>
                Welcome back
              </Txt>
              <Txt variant="body" tone="muted" style={{ marginTop: 4, textAlign: "center" }}>
                Sign in with the work email your employer registered.
              </Txt>
            </View>

            {error && (
              <View
                accessibilityRole="alert"
                style={{
                  backgroundColor: colors.dangerBg,
                  borderRadius: 12,
                  padding: spacing.md,
                  marginBottom: spacing.lg,
                  flexDirection: "row",
                  gap: spacing.sm,
                }}
              >
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Txt variant="label" tone="danger" style={{ flex: 1, lineHeight: 19 }}>
                  {error}
                </Txt>
              </View>
            )}

            <Field
              label="Work email"
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              error={fieldErrors.email}
              placeholder="you@company.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!submitting}
            />

            <Field
              ref={passwordRef}
              label="Password"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              error={fieldErrors.password}
              placeholder="Your password"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={!submitting}
              rightSlot={
                <Pressable
                  onPress={() => setShowPassword((value) => !value)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={19}
                    color={colors.textSubtle}
                  />
                </Pressable>
              }
            />

            <Button title="Sign in" onPress={submit} loading={submitting} size="lg" />

            <Pressable
              onPress={() => router.push("/(auth)/forgot-password")}
              style={{ alignSelf: "center", marginTop: spacing.xl, padding: spacing.sm }}
              hitSlop={8}
            >
              <Txt variant="label" tone="brand">
                Forgot your password?
              </Txt>
            </Pressable>
          </Animated.View>
        </ScrollView>

        <Pressable
          onPress={openServerSheet}
          style={{ alignItems: "center", paddingVertical: spacing.md }}
          hitSlop={8}
        >
          <Txt variant="caption" tone="subtle">
            Connection settings
          </Txt>
        </Pressable>
      </KeyboardAvoidingView>

      <ServerSheet
        open={serverSheetOpen}
        currentUrl={baseUrl}
        onClose={() => setServerSheetOpen(false)}
      />
    </SafeAreaView>
  );
}
