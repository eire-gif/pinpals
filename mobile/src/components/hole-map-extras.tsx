import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CLUBS, clubInfo, type BagClub, type Suggestion } from "@/lib/bag";
import { addHoleTip, deleteHoleTip, loadHoleTips, setTipUseful, type HoleTip } from "@/lib/hole-extras";
import type { Wind } from "@/lib/wind";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

const ON_PHOTO = "rgba(12,32,56,0.82)";

/**
 * The wind, over the map, top left (Oct 2026): an arrow turned to show
 * where it's blowing on this hole, the speed and gusts, and one line —
 * "Into you, left to right". Tap to fold it to just the arrow.
 */
export function WindChip({
  top,
  arrowDeg,
  speed,
  gust,
  line,
  open,
  onToggle,
}: {
  top: number;
  arrowDeg: number;
  speed: string;
  gust: string | null;
  line: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.windChip, { top }, !open && styles.windChipClosed, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`Wind ${speed}${gust ? `, gusts ${gust}` : ""}. ${line}. ${open ? "Fold away" : "Show"}.`}
    >
      <View style={styles.windDisc}>
        <View style={{ transform: [{ rotate: `${arrowDeg}deg` }] }}>
          <Ionicons name="arrow-up" size={20} color={colors.navy900} />
        </View>
      </View>
      {open ? (
        <View>
          <Text style={styles.windSpeed}>
            {speed}
            {gust ? <Text style={styles.windGust}>{`  gusts ${gust}`}</Text> : null}
          </Text>
          <Text style={styles.windLine}>{line}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Under the three numbers: how far it plays with the wind, and the club
 * from My bag for that distance. Either half can be missing.
 */
export function PlaysLikeRow({
  playsLike,
  windDelta,
  suggestion,
  fmt,
  unit,
  onBag,
}: {
  playsLike: number | null;
  windDelta: number | null;
  suggestion: Suggestion | null;
  fmt: (m: number) => string;
  unit: string;
  onBag: () => void;
}) {
  if (playsLike == null && !suggestion) {
    return (
      <Pressable onPress={onBag} style={styles.bagPrompt} accessibilityRole="button">
        <Ionicons name="golf-outline" size={14} color={colors.gold400} />
        <Text style={styles.bagPromptText}>Set up My bag for a club on every shot</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.playsRow}>
      {playsLike != null ? (
        <View style={styles.playsPill} accessible accessibilityLabel={`Plays like ${fmt(playsLike)} ${unit}`}>
          <Text style={styles.playsText}>
            Plays like <Text style={styles.playsBig}>{fmt(playsLike)}</Text>
            {windDelta != null && windDelta !== 0 ? <Text style={styles.playsSub}>{`  wind ${windDelta > 0 ? "+" : "−"}${Math.abs(windDelta)}`}</Text> : null}
          </Text>
        </View>
      ) : null}
      {suggestion ? (
        <Pressable onPress={onBag} style={styles.clubPill} accessibilityRole="button" accessibilityLabel={`Suggested club ${clubInfo(suggestion.club.club).name}. Open My bag.`}>
          <Text style={styles.clubShort}>{clubInfo(suggestion.club.club).short}</Text>
          <Text style={styles.clubText} numberOfLines={1}>
            {clubInfo(suggestion.club.club).name}
            {suggestion.longer ? <Text style={styles.playsSub}>{` or ${clubInfo(suggestion.longer.club).short}`}</Text> : null}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** In the shot card: which club was that? Likeliest first; scrolls for the rest. */
export function ClubTagRow({ order, chosen, busy, onPick }: { order: string[]; chosen: string | null; busy: boolean; onPick: (club: string | null) => void }) {
  return (
    <View style={styles.tagWrap}>
      <Text style={styles.tagLabel}>{chosen ? "Club" : "Which club?"}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow} keyboardShouldPersistTaps="handled">
        {order.map((k) => {
          const on = chosen === k;
          return (
            <Pressable
              key={k}
              disabled={busy}
              onPress={() => onPick(on ? null : k)}
              style={[styles.tagChip, on && styles.tagChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={clubInfo(k).name}
            >
              <Text style={[styles.tagChipText, on && styles.tagChipTextOn]}>{clubInfo(k).short}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Every club, longest first: the order for tagging when the bag says nothing. */
export const ALL_CLUB_KEYS = CLUBS.map((c) => c.key);

export function clubOrder(likely: string[], bag: readonly BagClub[] | null): string[] {
  const inBag = (bag ?? []).filter((c) => c.inBag).map((c) => c.club);
  const rest = (inBag.length ? inBag : ALL_CLUB_KEYS).filter((k) => !likely.includes(k));
  return [...likely, ...rest];
}

/**
 * Local knowledge for one hole, in the hole map's pull-up list: members'
 * tips, most useful first. Tap "Useful" on someone else's; delete your own.
 */
export function TipsBlock({ clubId, hole }: { clubId: number; hole: number }) {
  const [tips, setTips] = useState<HoleTip[] | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      setTips(await loadHoleTips(clubId, hole));
    } catch {
      setFailed(true);
    }
  }, [clubId, hole]);
  useEffect(() => {
    setTips(null);
    setWriting(false);
    setDraft("");
    void load();
  }, [load]);

  const mineExists = tips?.some((t) => t.mine) ?? false;
  const save = async () => {
    if (draft.trim().length < 3) return;
    setBusy(true);
    try {
      await addHoleTip(clubId, hole, draft);
      setDraft("");
      setWriting(false);
      await load();
    } catch (e) {
      Alert.alert("That tip didn't save", e instanceof Error && e.message ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const toggleUseful = async (t: HoleTip) => {
    setTips((cur) => cur?.map((x) => (x.id === t.id ? { ...x, iFoundUseful: !t.iFoundUseful, useful: x.useful + (t.iFoundUseful ? -1 : 1) } : x)) ?? cur);
    try {
      await setTipUseful(t.id, !t.iFoundUseful);
    } catch {
      void load();
    }
  };
  const remove = (t: HoleTip) =>
    Alert.alert("Delete your tip?", "You can write a new one afterwards.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteHoleTip(t.id);
            await load();
          } catch {
            Alert.alert("Couldn't delete it", "Please try again.");
          }
        },
      },
    ]);

  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Local knowledge · hole {hole}</Text>
      {tips === null && !failed ? <ActivityIndicator color={colors.cream50} /> : null}
      {failed ? <Text style={styles.muted}>Couldn't load the tips. Pull the list down and open it again.</Text> : null}
      {tips && tips.length === 0 ? <Text style={styles.muted}>No tips for this hole yet. Know where to aim? Help the next golfer.</Text> : null}
      {tips?.map((t) => (
        <View key={t.id} style={styles.tip}>
          <Text style={styles.tipBody}>{t.body}</Text>
          <View style={styles.tipMeta}>
            <Text style={styles.tipWho}>
              {t.mine ? "You" : t.author}
              {t.handicap != null && !t.mine ? ` · ${t.handicap} hcp` : ""}
              {t.hidden ? " · hidden by PinPals" : ""}
            </Text>
            {t.mine ? (
              <Pressable onPress={() => remove(t)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete your tip">
                <Text style={styles.tipAction}>Delete</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => void toggleUseful(t)} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: t.iFoundUseful }}>
                <Text style={[styles.tipAction, t.iFoundUseful && styles.tipActionOn]}>
                  {t.iFoundUseful ? "Useful ✓" : "Useful"}
                  {t.useful > 0 ? ` · ${t.useful}` : ""}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
      {writing ? (
        <View style={styles.tipForm}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Where to aim, what to avoid, which club…"
            placeholderTextColor={creamAlpha(0.5)}
            style={styles.tipInput}
            multiline
            maxLength={280}
            autoFocus
          />
          <View style={styles.tipFormRow}>
            <Text style={styles.muted}>{280 - draft.length} left</Text>
            <Pressable onPress={() => setWriting(false)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.tipAction}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => void save()} disabled={busy || draft.trim().length < 3} style={[styles.tipSave, (busy || draft.trim().length < 3) && { opacity: 0.4 }]} accessibilityRole="button">
              <Text style={styles.tipSaveText}>{busy ? "Saving…" : "Post tip"}</Text>
            </Pressable>
          </View>
        </View>
      ) : tips && !mineExists ? (
        <Pressable onPress={() => setWriting(true)} style={styles.addTip} accessibilityRole="button">
          <Ionicons name="add" size={16} color={colors.gold400} />
          <Text style={styles.addTipText}>Add a tip for this hole</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The weather source's credit, as its terms ask, under the wind. */
export function WindCredit({ wind }: { wind: Wind }) {
  return (
    <Pressable onPress={() => void Linking.openURL(wind.creditUrl)} accessibilityRole="link">
      <Text style={styles.credit}>Wind: {wind.credit}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  windChip: {
    position: "absolute",
    left: spacing.sm + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 14,
    borderRadius: radii.lg,
    backgroundColor: ON_PHOTO,
  },
  windChipClosed: { paddingRight: 7, borderRadius: 26 },
  windDisc: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.cream50, alignItems: "center", justifyContent: "center" },
  windSpeed: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  windGust: { fontFamily: fonts.body, fontSize: 12, color: creamAlpha(0.75) },
  windLine: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.gold400 },

  playsRow: { flexDirection: "row", justifyContent: "center", gap: spacing.sm, flexWrap: "wrap" },
  playsPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radii.pill, borderWidth: 1, borderColor: "rgba(232,196,107,0.55)", backgroundColor: "rgba(232,196,107,0.12)" },
  playsText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.cream50 },
  playsBig: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold400 },
  playsSub: { fontFamily: fonts.body, fontSize: 12, color: creamAlpha(0.75) },
  clubPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 4, paddingRight: 12, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.navy800, maxWidth: 200 },
  clubShort: { minWidth: 26, height: 22, paddingHorizontal: 4, borderRadius: 11, overflow: "hidden", backgroundColor: colors.gold400, color: colors.navy900, fontFamily: fonts.bodyBold, fontSize: 12, textAlign: "center", lineHeight: 22 },
  clubText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.cream50, flexShrink: 1 },
  bagPrompt: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 2 },
  bagPromptText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.gold400 },

  tagWrap: { marginTop: 8, gap: 4 },
  tagLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.1, textTransform: "uppercase", color: colors.gold400 },
  tagRow: { gap: 6, paddingRight: 4 },
  tagChip: { minWidth: 38, height: 32, paddingHorizontal: 8, borderRadius: 16, borderWidth: 1, borderColor: creamAlpha(0.35), alignItems: "center", justifyContent: "center" },
  tagChipOn: { backgroundColor: colors.gold400, borderColor: colors.gold400 },
  tagChipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  tagChipTextOn: { color: colors.navy900 },

  block: { backgroundColor: creamAlpha(0.06), borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  blockTitle: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400 },
  muted: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.7) },
  tip: { backgroundColor: colors.navy800, borderRadius: radii.md, padding: 12, gap: 6 },
  tipBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.cream50 },
  tipMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tipWho: { fontFamily: fonts.body, fontSize: 12, color: creamAlpha(0.65), flexShrink: 1 },
  tipAction: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: creamAlpha(0.85) },
  tipActionOn: { color: colors.gold400 },
  addTip: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.gold400 },
  addTipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold400 },
  tipForm: { gap: spacing.sm },
  tipInput: { minHeight: 84, borderRadius: radii.md, borderWidth: 1, borderColor: creamAlpha(0.3), padding: 10, color: colors.cream50, fontFamily: fonts.body, fontSize: 16, textAlignVertical: "top" },
  tipFormRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, justifyContent: "flex-end" },
  tipSave: { paddingHorizontal: 16, minHeight: 40, borderRadius: radii.pill, backgroundColor: colors.gold400, justifyContent: "center" },
  tipSaveText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },
  credit: { fontFamily: fonts.body, fontSize: 11, color: creamAlpha(0.55), textAlign: "center" },
});
