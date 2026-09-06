import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { format } from "date-fns";
import { useMySurveys, useRespondSurvey, type SurveyItem, type SurveyQuestionItem } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { Chips, ScreenHeader } from "../../src/components/ScreenHeader";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";

/** Surveys sent to me. One answer each; anonymous ones never record who. */
export default function Surveys() {
  const colors = useColors();
  const query = useMySurveys();
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = query.data || [];
  const waiting = rows.filter((s) => !s.responded);
  const done = rows.filter((s) => s.responded);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="Surveys" />
        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState message={(query.error as Error).message} onRetry={query.refetch} />
        ) : rows.length === 0 ? (
          <EmptyState icon="chatbubbles-outline" title="No open surveys" body="When HR sends one, it appears here and in your notifications. A couple of minutes each." />
        ) : (
          <>
            {waiting.map((survey) => (
              <Card key={survey.id} style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="heading">{survey.title}</Txt>
                    {survey.description ? (
                      <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
                        {survey.description}
                      </Txt>
                    ) : null}
                    <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
                      {survey.questions.length} question{survey.questions.length === 1 ? "" : "s"}
                      {survey.closesAt ? ` · closes ${format(new Date(survey.closesAt), "d MMM")}` : ""}
                    </Txt>
                  </View>
                  {survey.anonymous && <Badge label="Anonymous" tone="info" />}
                </View>
                {openId === survey.id ? (
                  <AnswerForm survey={survey} onDone={() => setOpenId(null)} />
                ) : (
                  <View style={{ marginTop: spacing.md, alignSelf: "flex-start" }}>
                    <Button title="Answer" size="sm" icon="create-outline" onPress={() => setOpenId(survey.id)} />
                  </View>
                )}
              </Card>
            ))}
            {done.length > 0 && (
              <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                {done.map((survey, index) => (
                  <View key={survey.id}>
                    {index > 0 && <Divider />}
                    <View style={{ paddingVertical: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Txt variant="bodyMedium" style={{ flex: 1 }} numberOfLines={2}>
                        {survey.title}
                      </Txt>
                      <Badge label="Answered" tone="success" />
                    </View>
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}

function AnswerForm({ survey, onDone }: { survey: SurveyItem; onDone: () => void }) {
  const toast = useToast();
  const respond = useRespondSurvey();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const set = (id: string, value: unknown) => setAnswers((current) => ({ ...current, [id]: value }));
  const missing = survey.questions.filter((q) => q.required && isEmpty(answers[q.id]));

  const submit = async () => {
    setError(null);
    try {
      await respond.mutateAsync({ id: survey.id, answers: survey.questions.map((q) => ({ questionId: q.id, value: answers[q.id] ?? null })) });
      toast.success(survey.anonymous ? "Recorded anonymously. Thank you." : "Recorded. Thank you.");
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not submit your answers.");
    }
  };

  return (
    <View style={{ marginTop: spacing.md }}>
      {survey.questions.map((q, i) => (
        <View key={q.id} style={{ marginBottom: spacing.md }}>
          <Txt variant="bodyMedium">
            {i + 1}. {q.prompt}
            {q.required ? " *" : ""}
          </Txt>
          {q.help ? (
            <Txt variant="caption" tone="muted" style={{ marginBottom: 6 }}>
              {q.help}
            </Txt>
          ) : (
            <View style={{ height: 6 }} />
          )}
          <QuestionInput question={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
        </View>
      ))}
      {error && (
        <Txt variant="caption" tone="danger" style={{ marginBottom: spacing.md }}>
          {error}
        </Txt>
      )}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="Later" variant="secondary" onPress={onDone} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Submit" onPress={submit} loading={respond.isPending} disabled={missing.length > 0} />
        </View>
      </View>
    </View>
  );
}

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function QuestionInput({ question, value, onChange }: { question: SurveyQuestionItem; value: unknown; onChange: (v: unknown) => void }) {
  const colors = useColors();
  switch (question.type) {
    case "rating":
    case "scale":
      return (
        <View>
          <Chips options={Array.from({ length: question.max }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} value={typeof value === "number" ? String(value) : ""} onChange={(v) => onChange(Number(v))} />
          {(question.lowLabel || question.highLabel) && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: -spacing.md, marginBottom: spacing.sm }}>
              <Txt variant="caption" tone="muted">{question.lowLabel}</Txt>
              <Txt variant="caption" tone="muted">{question.highLabel}</Txt>
            </View>
          )}
        </View>
      );
    case "yes_no":
      return <Chips options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(v) => onChange(v === "yes")} />;
    case "single":
      return <Chips options={question.options.map((o) => ({ value: o, label: o }))} value={typeof value === "string" ? value : ""} onChange={onChange} />;
    case "multi": {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.sm }}>
          {question.options.map((o) => {
            const active = chosen.includes(o);
            return (
              <Pressable
                key={o}
                onPress={() => onChange(active ? chosen.filter((c) => c !== o) : [...chosen, o])}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: active ? colors.brand[600] : colors.border, backgroundColor: active ? colors.brand[50] : colors.surface }}
              >
                <Txt variant="caption" tone={active ? "brand" : undefined}>
                  {o}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      );
    }
    default:
      return <Field value={typeof value === "string" ? value : ""} onChangeText={onChange} multiline numberOfLines={3} placeholder="Your answer" style={{ minHeight: 70, textAlignVertical: "top" }} />;
  }
}
