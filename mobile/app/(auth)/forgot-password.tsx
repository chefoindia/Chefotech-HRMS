import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Button, Field, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";

/**
 * Password reset request.
 *
 * The confirmation is deliberately identical whether or not the address is
 * registered. Telling an anonymous caller "no account with that email" turns
 * this screen into a free tool for checking who works at a company, which is
 * exactly the enumeration a directory of employees should not enable.
 */
export default function ForgotPassword() {
  const router = useRouter();
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim()) {
      setError("Enter your work email.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() }, { skipAuth: true });
      setSent(true);
    } catch (caught) {
      // Rate limiting is the one failure worth showing: it is actionable, and
      // silently swallowing it leaves the user tapping a button that will not
      // work for another minute.
      if (caught instanceof ApiError && caught.status === 429) {
        setError(caught.message);
      } else {
        setSent(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing["3xl"] }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.full,
              backgroundColor: colors.successBg,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: spacing.xl,
            }}
          >
            <Ionicons name="mail-outline" size={30} color={colors.success} />
          </View>
          <Txt variant="title" style={{ textAlign: "center" }}>
            Check your email
          </Txt>
          <Txt variant="body" tone="muted" style={{ textAlign: "center", marginTop: spacing.md, lineHeight: 22 }}>
            If {email.trim()} belongs to an account, we have sent a link to reset your password.
            It expires shortly, so use it soon.
          </Txt>
          <Button
            title="Back to sign in"
            onPress={() => router.replace("/(auth)/login")}
            style={{ marginTop: spacing["2xl"], alignSelf: "stretch" }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing["2xl"] }}
          keyboardShouldPersistTaps="handled"
        >
          <Txt variant="title">Reset your password</Txt>
          <Txt variant="body" tone="muted" style={{ marginTop: spacing.sm, marginBottom: spacing["2xl"], lineHeight: 21 }}>
            Enter your work email and we will send you a link to choose a new password.
          </Txt>

          {error && (
            <Txt variant="label" tone="danger" style={{ marginBottom: spacing.md }}>
              {error}
            </Txt>
          )}

          <Field
            label="Work email"
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!submitting}
          />

          <Button title="Send reset link" onPress={submit} loading={submitting} size="lg" />
          <Button
            title="Back to sign in"
            variant="ghost"
            onPress={() => router.back()}
            style={{ marginTop: spacing.sm }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
