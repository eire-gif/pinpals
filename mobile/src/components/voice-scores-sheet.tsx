import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useVoiceListener } from "@/lib/voice-listening";
import { listeningHints, parseVoiceScores, type VoicePlayer } from "@/lib/voice-scores";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing } from "@/lib/theme";

/**
 * Voice scoring (claude/voice-scoring.md): say the group's scores, check
 * them, save.
 *
 *   1. Listening — a waveform and the words as they're heard. It stops by
 *      itself after a short silence, or on Done.
 *   2. Check — one row per player: the score it heard, what it heard it
 *      from, and − / + to fix it. Anything it wasn't sure of ("for" or 4?)
 *      is highlighted and must be confirmed before Save. A player it didn't
 *      hear is left out unless the member sets a score.
 *
 * Nothing is saved until Save; saving goes through the round screen's own
 * score path, so it's the same as tapping each one in (offline queue,
 * birdie alerts, the lock screen card).
 */

export type VoiceRow = VoicePlayer & {
  /** The score already on the card for this hole, if any (null = picked up). */
  current: number | null | undefined;
};

type Entry = { strokes: number | null; include: boolean; check: string | null; heard: string | null };

export function VoiceScoresSheet({
  visible,
  hole,
  par,
  nextHole,
  rows,
  onSave,
  onClose,
}: {
  visible: boolean;
  hole: number;
  par: number;
  /** The hole Save moves on to, or null on the last hole. */
  nextHole: number | null;
  rows: readonly VoiceRow[];
  onSave: (scores: Array<{ id: number; strokes: number | null }>) => Promise<void>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const listener = useVoiceListener();
  const [phase, setPhase] = useState<"listen" | "check">("listen");
  const [entries, setEntries] = useState<Map<number, Entry>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hints = useMemo(() => listeningHints(rows), [rows]);
  // Each listen is worked out once: the round screen re-renders underneath
  // (the group's scores arrive live) and must not wipe a fix in progress.
  const session = useRef(0);
  const parsedSession = useRef(-1);
  const listen = () => {
    session.current += 1;
    void listener.start(hints);
  };

  // Open → listen straight away (the member already pressed the button).
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setPhase("listen");
      setEntries(new Map());
      setSaveError(null);
      listen();
    }
    if (!visible && wasVisible.current) listener.cancel();
    wasVisible.current = visible;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Heard it all: work the scores out and move to the check.
  useEffect(() => {
    if (!visible || listener.state !== "finished") return;
    if (!listener.transcript.trim() || parsedSession.current === session.current) return;
    parsedSession.current = session.current;
    const result = parseVoiceScores(listener.transcript, par, rows);
    setEntries((before) => {
      const next = new Map<number, Entry>();
      for (const r of rows) {
        const heard = result.scores.find((s) => s.playerId === r.id);
        const kept = before.get(r.id);
        if (heard) next.set(r.id, { strokes: heard.strokes, include: true, check: heard.check, heard: heard.heard });
        // "Say it again" for one player keeps what was already fixed for the rest.
        else if (kept?.include) next.set(r.id, kept);
        // Not heard: what's on the card already (picked up stays picked up), else net par.
        else next.set(r.id, { strokes: r.current !== undefined ? r.current : par + (r.shots ?? 0), include: false, check: null, heard: null });
      }
      return next;
    });
    setPhase("check");
  }, [listener.state, listener.transcript, visible, par, rows]);

  const change = (id: number, delta: number) =>
    setEntries((m) => {
      const e = m.get(id);
      if (!e) return m;
      const r = rows.find((x) => x.id === id);
      const base = e.include ? e.strokes : r?.current !== undefined ? r.current : par + (r?.shots ?? 0);
      // Below 1 is "picked up"; up from picked up starts at 1.
      const strokes = base == null ? (delta > 0 ? 1 : null) : base + delta < 1 ? null : Math.min(15, base + delta);
      const next = new Map(m);
      next.set(id, { ...e, strokes, include: true, check: null });
      return next;
    });
  const confirm = (id: number) =>
    setEntries((m) => {
      const e = m.get(id);
      if (!e) return m;
      const next = new Map(m);
      next.set(id, { ...e, check: null });
      return next;
    });

  const included = rows.filter((r) => entries.get(r.id)?.include);
  const unchecked = included.filter((r) => entries.get(r.id)?.check).length;

  const save = async () => {
    if (saving || included.length === 0 || unchecked > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(included.map((r) => ({ id: r.id, strokes: entries.get(r.id)!.strokes })));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "The scores didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const again = () => {
    setPhase("listen");
    listen();
  };

  const close = () => {
    listener.cancel();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, phase === "check" && styles.sheetLight]}>
          <View style={[styles.grabber, phase === "check" && { backgroundColor: colors.line }]} />
          {phase === "listen" ? (
            <ListenPhase
              hole={hole}
              players={rows.length}
              state={listener.state}
              transcript={listener.transcript}
              level={listener.level}
              problem={listener.problem}
              onDone={listener.stop}
              onRetry={again}
              onClose={close}
            />
          ) : (
            <View style={{ flexShrink: 1, gap: spacing.md }}>
              <View style={{ gap: 2 }}>
                <Text style={styles.checkTitle}>Check hole {hole}</Text>
                <Text style={styles.checkSub}>Par {par} · tap − or + to fix anything</Text>
              </View>
              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: spacing.sm }}>
                {rows.map((r) => {
                  const e = entries.get(r.id);
                  if (!e) return null;
                  return (
                    <CheckRow
                      key={r.id}
                      name={r.isMe && !r.name.includes("&") ? "You" : r.name}
                      par={par}
                      entry={e}
                      onMinus={() => change(r.id, -1)}
                      onPlus={() => change(r.id, 1)}
                      onConfirm={() => confirm(r.id)}
                    />
                  );
                })}
              </ScrollView>
              {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
              <Pressable
                onPress={() => void save()}
                disabled={saving || included.length === 0 || unchecked > 0}
                style={({ pressed }) => [styles.save, (included.length === 0 || unchecked > 0) && styles.saveOff, pressed && { opacity: 0.9 }]}
                accessibilityRole="button"
              >
                {saving ? (
                  <ActivityIndicator color={colors.navy900} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={20} color={colors.navy900} />
                    <Text style={styles.saveLabel}>
                      {unchecked > 0
                        ? `Check ${unchecked === 1 ? "1 score" : `${unchecked} scores`} first`
                        : included.length === 0
                          ? "No scores to save"
                          : nextHole != null
                            ? `Save & go to hole ${nextHole}`
                            : `Save hole ${hole}`}
                    </Text>
                  </>
                )}
              </Pressable>
              <View style={styles.checkFoot}>
                <Pressable onPress={again} style={styles.again} accessibilityRole="button">
                  <Ionicons name="mic" size={18} color={colors.navy900} />
                  <Text style={styles.againLabel}>Say it again</Text>
                </Pressable>
                <Pressable onPress={close} style={styles.again} accessibilityRole="button">
                  <Text style={styles.againLabel}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ListenPhase({
  hole,
  players,
  state,
  transcript,
  level,
  problem,
  onDone,
  onRetry,
  onClose,
}: {
  hole: number;
  players: number;
  state: ReturnType<typeof useVoiceListener>["state"];
  transcript: string;
  level: number;
  problem: string | null;
  onDone: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  // A few seconds of the microphone level, drawn as bars.
  const [bars, setBars] = useState<number[]>(() => Array(24).fill(0.08));
  useEffect(() => {
    if (state !== "listening") return;
    setBars((b) => [...b.slice(1), Math.max(0.08, level)]);
  }, [level, state]);

  const blocked = state === "denied" || state === "unavailable" || state === "failed";
  const nothing = state === "finished" && !transcript.trim();

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={styles.listenTop}>
        <View style={styles.listenTag}>
          {state === "listening" ? <View style={styles.liveDot} /> : null}
          <Text style={[styles.listenTagText, state !== "listening" && { color: colors.gold400 }]}>
            {state === "asking" ? "GETTING READY" : state === "listening" ? "LISTENING" : blocked ? "CAN'T LISTEN" : "HEARD"}
          </Text>
        </View>
        <Text style={styles.listenMeta}>
          Hole {hole} · {players} {players === 1 ? "player" : "players"}
        </Text>
      </View>

      <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {bars.map((b, i) => (
          <View key={i} style={[styles.bar, { height: 6 + b * 58, backgroundColor: state === "listening" ? colors.gold400 : creamAlpha(0.25) }]} />
        ))}
      </View>

      {blocked ? (
        <View style={{ gap: spacing.md }}>
          <Text style={styles.blockedText}>
            {state === "denied"
              ? "PinPals needs the microphone and speech recognition to hear scores. You can turn them on in Settings."
              : state === "unavailable"
                ? "This phone can't recognise speech in English right now. Tap the scores in instead."
                : (problem ?? "That didn't work. Try again, or tap the scores in.")}
          </Text>
          <View style={styles.listenButtons}>
            {state === "denied" ? (
              <Pressable onPress={() => void Linking.openSettings()} style={styles.listenPrimary} accessibilityRole="button">
                <Text style={styles.listenPrimaryLabel}>Open Settings</Text>
              </Pressable>
            ) : state === "failed" ? (
              <Pressable onPress={onRetry} style={styles.listenPrimary} accessibilityRole="button">
                <Text style={styles.listenPrimaryLabel}>Try again</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} style={styles.listenGhost} accessibilityRole="button">
              <Text style={styles.listenGhostLabel}>Tap scores in</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text style={[styles.transcript, !transcript && styles.transcriptHint]} accessibilityLiveRegion="polite">
            {transcript
              ? `“${transcript}”`
              : nothing
                ? "Didn't catch anything. Try again a little closer to the phone."
                : "Say each player's score — “Niamh bogey, I had par, Dec a five”."}
          </Text>
          <View style={styles.listenButtons}>
            {state === "listening" ? (
              <Pressable onPress={onDone} style={styles.listenPrimary} accessibilityRole="button">
                <Ionicons name="checkmark" size={18} color={colors.navy900} />
                <Text style={styles.listenPrimaryLabel}>Done</Text>
              </Pressable>
            ) : nothing ? (
              <Pressable onPress={onRetry} style={styles.listenPrimary} accessibilityRole="button">
                <Ionicons name="mic" size={18} color={colors.navy900} />
                <Text style={styles.listenPrimaryLabel}>Try again</Text>
              </Pressable>
            ) : (
              <ActivityIndicator color={colors.gold400} />
            )}
            <Pressable onPress={onClose} style={styles.listenGhost} accessibilityRole="button">
              <Text style={styles.listenGhostLabel}>Cancel</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const TERM: Record<number, string> = { [-3]: "ALBATROSS", [-2]: "EAGLE", [-1]: "BIRDIE", 0: "PAR", 1: "BOGEY", 2: "DOUBLE" };

function CheckRow({
  name,
  par,
  entry,
  onMinus,
  onPlus,
  onConfirm,
}: {
  name: string;
  par: number;
  entry: Entry;
  onMinus: () => void;
  onPlus: () => void;
  onConfirm: () => void;
}) {
  const s = entry.strokes;
  const diff = s == null ? null : s - par;
  const tag = !entry.include ? "NOT HEARD" : s == null ? "PICKED UP · NO RETURN" : s === 1 ? "HOLE IN ONE" : (TERM[diff!] ?? `+${diff}`);
  const tone = !entry.include ? styles.tagMuted : diff != null && diff < 0 ? styles.tagGood : diff != null && diff >= 2 ? styles.tagBad : diff === 1 ? styles.tagOver : styles.tagPar;
  const toneText = !entry.include ? styles.tagMutedText : diff != null && diff >= 2 ? styles.tagBadText : diff != null && diff < 0 ? styles.tagGoodText : diff === 1 ? styles.tagOverText : styles.tagParText;
  return (
    <View style={[styles.row, entry.check != null && styles.rowFlag]}>
      <View style={styles.rowMain}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={[styles.tag, tone]}>
              <Text style={[styles.tagText, toneText]}>{tag}</Text>
            </View>
            {entry.heard ? (
              <Text style={styles.heard} numberOfLines={1}>
                “{entry.heard}”
              </Text>
            ) : null}
          </View>
        </View>
        <Pressable onPress={onMinus} style={styles.step} accessibilityRole="button" accessibilityLabel={`One fewer for ${name}`}>
          <Text style={styles.stepLabel}>−</Text>
        </Pressable>
        <Text style={[styles.score, !entry.include && styles.scoreMuted]} accessibilityLabel={`${name}: ${s == null ? "picked up, no return" : s}`}>
          {!entry.include ? "–" : s == null ? "NR" : s}
        </Text>
        <Pressable onPress={onPlus} style={styles.step} accessibilityRole="button" accessibilityLabel={`One more for ${name}`}>
          <Text style={styles.stepLabel}>+</Text>
        </Pressable>
      </View>
      {entry.check ? (
        <View style={styles.flag}>
          <Ionicons name="alert-circle-outline" size={18} color="#6b4403" />
          <Text style={styles.flagText}>{entry.check}</Text>
          <Pressable onPress={onConfirm} style={styles.flagButton} accessibilityRole="button" accessibilityLabel={`Yes, ${s == null ? "picked up, no return" : s} for ${name}`}>
            <Text style={styles.flagButtonLabel}>{s == null ? "Yes" : `Yes, ${s}`}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: navyAlpha(0.45) },
  sheet: {
    backgroundColor: "#0a1a30",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 4,
    gap: spacing.md,
    maxHeight: "92%",
  },
  sheetLight: { backgroundColor: colors.cream50, paddingHorizontal: spacing.md },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: creamAlpha(0.25) },

  listenTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  listenTag: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4cc37a" },
  listenTagText: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 1.8, color: "#4cc37a" },
  listenMeta: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.7) },
  wave: { height: 64, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  bar: { width: 5, borderRadius: 3 },
  transcript: { fontFamily: fonts.displayItalic, fontSize: 24, lineHeight: 34, color: colors.cream50, minHeight: 102 },
  transcriptHint: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: creamAlpha(0.75) },
  blockedText: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.cream50 },
  listenButtons: { alignItems: "center", gap: spacing.sm, paddingBottom: spacing.sm },
  listenPrimary: {
    minWidth: 200,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.gold400,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: spacing.lg,
  },
  listenPrimaryLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  listenGhost: { height: 44, paddingHorizontal: spacing.lg, borderRadius: 22, borderWidth: 1, borderColor: creamAlpha(0.25), justifyContent: "center" },
  listenGhostLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: creamAlpha(0.85) },

  checkTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.navy900 },
  checkSub: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500 },
  row: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  rowFlag: { borderWidth: 2, borderColor: colors.gold400 },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 8 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold400 },
  rowName: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.navy900 },
  tag: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.4 },
  tagPar: { backgroundColor: "#e8edf5" },
  tagParText: { color: colors.navy900 },
  tagGood: { backgroundColor: colors.navy900 },
  tagGoodText: { color: colors.gold400 },
  tagOver: { backgroundColor: "#f6e3d2" },
  tagOverText: { color: "#7a3a0a" },
  tagBad: { backgroundColor: "#7a3a0a" },
  tagBadText: { color: colors.surface },
  tagMuted: { backgroundColor: colors.cream100 },
  tagMutedText: { color: colors.ink500 },
  heard: { flex: 1, fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  step: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceTint,
    alignItems: "center",
    justifyContent: "center",
  },
  stepLabel: { fontFamily: fonts.bodySemi, fontSize: 22, color: colors.navy900, marginTop: -2 },
  score: { width: 36, textAlign: "center", fontFamily: fonts.display, fontSize: 28, color: colors.navy900 },
  scoreMuted: { color: colors.ink500 },
  flag: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fbf0d6", borderRadius: radii.md, padding: 10 },
  flagText: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: "#5c3d00" },
  flagButton: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.navy900, justifyContent: "center" },
  flagButtonLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  error: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.red600 },
  save: {
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.gold400,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  saveOff: { backgroundColor: colors.cream100 },
  saveLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  checkFoot: { flexDirection: "row", gap: spacing.sm, justifyContent: "center" },
  again: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  againLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.navy900 },
});
