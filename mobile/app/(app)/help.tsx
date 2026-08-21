import { useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { HELP_ARTICLES, HELP_CATEGORIES, searchHelp } from "../../src/help/articles";
import { TOURS } from "../../src/help/tours";
import { useTour } from "../../src/help/TourEngine";
import { useColors } from "../../src/theme/ThemeProvider";
import { Card, Divider, EmptyState, Field, Row, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { useSession } from "../../src/auth/session";

/**
 * Help and support.
 *
 * Answers first, contact second. Most questions an employee has are already
 * answered here, and a support screen whose most prominent element is an email
 * address teaches people to email rather than look.
 *
 * Starting a tour navigates to the screen it describes first — a tour that
 * points at a check-in button while you are looking at the help screen has
 * nothing to point at.
 */
export default function Help() {
  const colors = useColors();
  const router = useRouter();
  const tour = useTour();
  const { session } = useSession();

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const results = useMemo(() => (query.trim() ? searchHelp(query) : null), [query]);

  const startTour = (tourId: string) => {
    // Send the user where the tour's targets actually live, then start it once
    // the screen has had a moment to mount and measure.
    const destination =
      tourId === "apply-leave"
        ? "/(app)/apply-leave"
        : tourId === "attendance"
          ? "/(app)/attendance"
          : "/(app)";
    router.push(destination as never);
    setTimeout(() => tour.start(tourId), 550);
  };

  const supportEmail = "support@chefotech.com";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Txt variant="title" style={{ marginLeft: spacing.sm }}>
            Help
          </Txt>
        </View>

        <Field
          icon="search-outline"
          value={query}
          onChangeText={setQuery}
          placeholder="Search — try “sandwich” or “forgot to check out”"
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />

        {results ? (
          results.length === 0 ? (
            <Card>
              <EmptyState
                icon="search-outline"
                title="Nothing matched"
                body="Try a different word, or contact your HR team — they can see your records and we cannot."
              />
            </Card>
          ) : (
            <>
              <Txt variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>
                {results.length} {results.length === 1 ? "answer" : "answers"}
              </Txt>
              <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                {results.map((article, index) => (
                  <View key={article.id}>
                    {index > 0 && <Divider />}
                    <Answer
                      article={article}
                      expanded={expanded === article.id}
                      onToggle={() => setExpanded(expanded === article.id ? null : article.id)}
                    />
                  </View>
                ))}
              </Card>
            </>
          )
        ) : (
          <>
            {/* Guided tours */}
            <SectionHeader title="Show me around" />
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              {TOURS.map((entry, index) => (
                <View key={entry.id}>
                  {index > 0 && <Divider />}
                  <Row
                    icon="sparkles-outline"
                    title={entry.title}
                    subtitle={entry.description}
                    onPress={() => startTour(entry.id)}
                  />
                </View>
              ))}
            </Card>

            {/* Answers by category */}
            {HELP_CATEGORIES.map((category) => {
              const articles = HELP_ARTICLES.filter((item) => item.category === category.id);
              if (articles.length === 0) return null;
              return (
                <View key={category.id}>
                  <SectionHeader title={category.title} />
                  <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                    {articles.map((article, index) => (
                      <View key={article.id}>
                        {index > 0 && <Divider />}
                        <Answer
                          article={article}
                          expanded={expanded === article.id}
                          onToggle={() =>
                            setExpanded(expanded === article.id ? null : article.id)
                          }
                        />
                      </View>
                    ))}
                  </Card>
                </View>
              );
            })}

            {/* Contact */}
            <SectionHeader title="Still stuck" />
            <Card>
              <Txt variant="body" tone="muted" style={{ lineHeight: 21 }}>
                For anything about your own records — a wrong balance, a missing payslip, a
                correction that was not approved — your HR team is the right place to ask. They
                can see your data; we cannot.
              </Txt>
              <Pressable
                onPress={() =>
                  Linking.openURL(
                    `mailto:${supportEmail}?subject=${encodeURIComponent(
                      `Chefotech HRMS app — ${session?.organization?.name ?? "support"}`
                    )}`
                  )
                }
                accessibilityRole="button"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: spacing.lg,
                  padding: spacing.md,
                  borderRadius: radius.sm,
                  backgroundColor: colors.surfaceSunken,
                }}
              >
                <Ionicons name="mail-outline" size={17} color={colors.brand[600]} />
                <Txt variant="label" tone="brand" style={{ marginLeft: spacing.sm, flex: 1 }}>
                  Report a problem with the app
                </Txt>
                <Ionicons name="open-outline" size={15} color={colors.textSubtle} />
              </Pressable>
            </Card>
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}

function Answer({
  article,
  expanded,
  onToggle,
}: {
  article: (typeof HELP_ARTICLES)[number];
  expanded: boolean;
  onToggle: () => void;
}) {
  const colors = useColors();
  const router = useRouter();

  return (
    <View style={{ paddingVertical: spacing.md }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={{ flexDirection: "row", alignItems: "center" }}
      >
        <Txt variant="bodyMedium" style={{ flex: 1, paddingRight: spacing.sm }}>
          {article.question}
        </Txt>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={17}
          color={colors.textSubtle}
        />
      </Pressable>

      {expanded && (
        <View style={{ marginTop: spacing.sm }}>
          <Txt variant="body" tone="muted" style={{ lineHeight: 22 }}>
            {article.answer}
          </Txt>
          {article.route && article.routeLabel && (
            <Pressable
              onPress={() => router.push(article.route as never)}
              accessibilityRole="button"
              style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.md }}
            >
              <Txt variant="label" tone="brand">
                {article.routeLabel}
              </Txt>
              <Ionicons
                name="arrow-forward"
                size={14}
                color={colors.brand[600]}
                style={{ marginLeft: 4 }}
              />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
