// src/screens/LeaderboardScreen.js
//
// Podium + ranked list, modelled on the reference: rank 2 left, rank 1 raised
// in the centre, rank 3 right, then the rest as rows.
//
// Two details that make a podium read correctly and are easy to get wrong:
//   · #1 must be physically taller and centred, not just have a different
//     badge. Three equal cards with numbers on them is a list, not a podium.
//   · The viewer's own row is pinned and highlighted, so someone at rank 34
//     can see where they stand without scrolling. A leaderboard you can't
//     find yourself on is just a list of other people.
//
// On the shared layout (see the HOW TO BUILD A SCREEN block in
// components/ui/Screen.js): `Screen` owns the ground, the safe area, the
// scroller, the gutter, the rhythm and the nav-pill clearance. This file owns
// the podium and nothing about the frame. Three consequences worth stating,
// because each was a hand-rolled thing here before:
//
//   · The only backgroundColor in this file is `colors.inset`, on the search
//     strip — which is a CHILD of a panel, and `inset` is the one token a
//     child of a panel may paint (rule 3). Everything else is a surface
//     component.
//   · Rhythm between the toggle, the podium, the "you" card and the list is
//     `Screen`'s `gap`. No element carries a margin to space itself.
//   · List rows are `Glass.Row`, so the hairline separator and the row metrics
//     come from the panel that owns them rather than from a local copy.
//
// The podium's own geometry (the raised first slot, the badge overlapping the
// avatar) IS this screen's content, so it stays hand-laid — but it is laid
// with `spacing`/`radius`, never with numbers.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../context/AuthContext";
import { getApiUrl } from "../lib/api";
import { useResource } from "../lib/resource";
import { Screen, Glass, Gradient, Avatar, SegmentedToggle } from "../components/ui";
import { useTheme, radius, spacing, layout, type, glow, ms, FONT } from "../theme";

const PERIODS = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

// Podium order is visual, not numeric: 2nd sits left of 1st.
const PODIUM_ORDER = [1, 0, 2];

// Rows revealed per press of "Show more".
const PAGE = 10;

export default function LeaderboardScreen() {
  const { apiFetch, user } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [period, setPeriod] = useState("month");
  const [query, setQuery] = useState("");
  // A company-wide board is hundreds of rows. Rendering them all costs a long
  // first paint for a list nobody scrolls to the bottom of, so it grows on
  // demand. Reset whenever the period or the search changes — otherwise a new
  // query silently inherits the previous page count.
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    setShown(PAGE);
  }, [period, query]);

  const fetcher = useCallback(async () => {
    const res = await apiFetch(getApiUrl(`/leaderboard?period=${period}`));
    if (!res?.success) throw new Error(res?.message || "Could not load standings");
    return res.data;
  }, [apiFetch, period]);

  const { data, loading, refreshing, error, refresh } = useResource(
    `leaderboard:${period}`,
    fetcher,
  );

  const entries = data?.entries || [];
  const me = data?.me || null;

  const top3 = entries.slice(0, 3);
  const rest = useMemo(() => {
    const r = entries.slice(3);
    if (!query.trim()) return r;
    const q = query.trim().toLowerCase();
    return r.filter(
      (e) =>
        e.name?.toLowerCase().includes(q) ||
        e.designation?.toLowerCase().includes(q) ||
        e.department?.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const medal = (rank) =>
    rank === 1 ? colors.gold : rank === 2 ? colors.silver : colors.bronze;

  return (
    <Screen
      title="Standings"
      subtitle="Ranked on hours worked."
      refreshing={refreshing}
      onRefresh={refresh}
    >
      <SegmentedToggle options={PERIODS} value={period} onChange={setPeriod} />

      {error ? (
        <Glass>
          <Text style={s.muted}>Couldn't load standings. Pull down to retry.</Text>
        </Glass>
      ) : loading ? (
        <Glass>
          <Text style={s.muted}>Loading…</Text>
        </Glass>
      ) : entries.length === 0 ? (
        <Glass>
          <Text style={s.muted}>
            Nothing recorded for this period yet. Check back once attendance
            is in.
          </Text>
        </Glass>
      ) : (
        <>
          {/* ── Podium ─────────────────────────────────────────────── */}
          {/* Not a panel — three people standing on the ground, which is
              what Screen.Section is for. */}
          <Screen.Section>
            <View style={s.podium}>
              {PODIUM_ORDER.map((idx, i) => {
                const e = top3[idx];
                if (!e) return <View key={i} style={s.podiumSlot} />;
                const first = e.rank === 1;
                return (
                  <View
                    key={e.employeeId}
                    style={[s.podiumSlot, first && s.podiumSlotFirst]}
                  >
                    <View style={first ? s.crownWrap : null}>
                      {first ? (
                        <Ionicons
                          name="flame"
                          size={18}
                          color={colors.gold}
                          style={s.crown}
                        />
                      ) : null}
                      <Avatar
                        name={e.name}
                        uri={e.avatar}
                        size={first ? 56 : 44}
                        style={[
                          { borderWidth: 2, borderColor: medal(e.rank) },
                          first && glow(colors.gold, 0.5),
                        ]}
                      />
                    </View>

                    <Gradient
                      colors={[medal(e.rank), colors.base]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={s.rankBadge}
                    >
                      <Text style={s.rankBadgeText}>{e.rank}</Text>
                    </Gradient>

                    <Text style={s.podiumName} numberOfLines={1}>
                      {e.name}
                    </Text>
                    <Text style={s.podiumMeta} numberOfLines={1}>
                      {e.designation || e.department || "—"}
                    </Text>
                    <Text style={[s.podiumScore, { color: medal(e.rank) }]}>
                      {e.worked}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Screen.Section>

          {/* ── Your position, always visible ──────────────────────── */}
          {me ? (
            <Glass strong style={glow(colors.accent, 0.28)}>
              <Glass.Row first>
                <Text style={[s.rank, { color: colors.accent }]}>#{me.rank}</Text>
                <Avatar name={me.name || user?.name} uri={me.avatar} size={34} ring />
                <View style={s.rowText}>
                  <Text style={s.rowName} numberOfLines={1}>
                    You
                  </Text>
                  <Text style={s.rowMeta} numberOfLines={1}>
                    {me.designation || me.department || "—"}
                  </Text>
                </View>
                <View style={s.rowRight}>
                  <Text style={[s.rowScore, { color: colors.accent }]}>
                    {me.worked}
                  </Text>
                  <Text style={s.rowUnit}>worked</Text>
                </View>
              </Glass.Row>
            </Glass>
          ) : null}

          {/* ── The rest ───────────────────────────────────────────── */}
          <Glass padded={false} style={s.listPanel}>
            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={colors.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Find a colleague"
                placeholderTextColor={colors.textFaint}
                style={s.search}
                autoCapitalize="none"
              />
            </View>

            {rest.length === 0 ? (
              <Text style={[s.muted, s.pad]}>No one matches that.</Text>
            ) : (
              rest.slice(0, shown).map((e, i) => (
                <Glass.Row key={e.employeeId} first={i === 0}>
                  <Text style={s.rank}>{e.rank}</Text>
                  <Avatar name={e.name} uri={e.avatar} size={30} />
                  <View style={s.rowText}>
                    <Text style={s.rowName} numberOfLines={1} ellipsizeMode="tail">
                      {e.name}
                    </Text>
                    <Text style={s.rowMeta} numberOfLines={1}>
                      {e.designation || e.department || "—"}
                    </Text>
                  </View>
                  <View style={s.rowRight}>
                    <Text style={s.rowScore} numberOfLines={1}>{e.worked}</Text>
                    <Text style={s.rowUnit}>worked</Text>
                  </View>
                </Glass.Row>
              ))
            )}

            {rest.length > shown ? (
              <Glass.Row onPress={() => setShown((n) => n + PAGE)}>
                <Text style={s.more}>
                  Show {Math.min(PAGE, rest.length - shown)} more
                </Text>
                <View style={{ flex: 1 }} />
                <Text style={s.moreCount}>
                  {shown} of {rest.length}
                </Text>
              </Glass.Row>
            ) : null}
          </Glass>
        </>
      )}
    </Screen>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    muted: { ...type.body, color: colors.textMuted },

    // ── Podium ────────────────────────────────────────────────────────────
    // No marginTop: the space above the podium is Screen's `gap`. A screen
    // that spaces itself only looks right on the page it was written for.
    podium: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: spacing.tight,
    },
    podiumSlot: { flex: 1, alignItems: "center", gap: 2 },
    // #1 sits higher — the whole point of a podium. This is the podium's own
    // geometry, not page rhythm, so it is a margin on purpose.
    podiumSlotFirst: { marginBottom: spacing.loose },
    crownWrap: { alignItems: "center" },
    crown: { marginBottom: 2 },
    rankBadge: {
      width: 24,
      height: 24,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      // Pulls the badge up to straddle the avatar's lower edge.
      marginTop: -12,
      borderWidth: 2,
      borderColor: colors.base,
    },
    // fontWeight is inert once fontFamily names a static face, so every
    // heavier cut below names the face instead. See theme/typography.js.
    rankBadgeText: {
      ...type.caption,
      fontFamily: FONT.extrabold,
      color: colors.text,
    },
    podiumName: {
      ...type.caption,
      fontFamily: FONT.bold,
      color: colors.text,
      marginTop: spacing.hair,
      textAlign: "center",
    },
    podiumMeta: { ...type.caption, color: colors.textFaint, textAlign: "center" },
    podiumScore: {
      ...type.caption,
      fontFamily: FONT.bold,
      marginTop: 2,
    },

    // ── The ranked list ───────────────────────────────────────────────────
    listPanel: { paddingVertical: spacing.tight },
    // Glass.Row owns the vertical metrics and the hairline; the panel is
    // full-bleed, so the rows supply their own gutter.
    pad: { paddingHorizontal: spacing.base },
    searchWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      marginHorizontal: spacing.base,
      marginBottom: spacing.tight,
      paddingHorizontal: spacing.snug,
      height: 40,
      borderRadius: radius.control,
      // `inset`: this sits INSIDE <Glass padded={false}>, which paints the
      // panel token. Painting the same token here made the search strip read
      // as a lighter header over a darker list body.
      backgroundColor: colors.inset,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
    },
    search: { flex: 1, ...type.body, color: colors.text, paddingVertical: 0 },

    rank: {
      ...type.caption,
      fontFamily: FONT.bold,
      color: colors.textFaint,
      width: 26,
      textAlign: "center",
    },
    rowText: { flex: 1 },
    // Deliberately caption-sized, not title. A leaderboard row is a
    // comparison instrument: the reader scans a column of times, and oversized
    // names pushed the figure onto a second line or truncated it instead.
    rowName: { ...type.caption, color: colors.text, fontFamily: FONT.semibold },
    rowMeta: { ...type.caption, color: colors.textFaint, fontSize: ms(10), lineHeight: ms(13) },
    // Fixed width so every time in the column starts at the same x. A right
    // edge that moves with the value makes a ranked list impossible to scan.
    rowRight: { alignItems: "flex-end", minWidth: ms(64) },
    more: { ...type.caption, color: colors.accent, fontFamily: FONT.semibold },
    moreCount: { ...type.caption, color: colors.textFaint },
    rowScore: { ...type.title, color: colors.text, fontFamily: FONT.bold },
    rowUnit: { ...type.caption, color: colors.textFaint, fontSize: ms(10) },
  });
