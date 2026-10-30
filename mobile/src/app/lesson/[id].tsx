import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Kicker, proPhoto, proStyles } from "@/components/pro-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { cancelOutcome, euroCents, lessonPhase, lessonWhen, untilText } from "@/lib/pro-rules";
import { cancelLesson, lessonPayPath, loadLesson, type Lesson } from "@/lib/pros";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Book a pro (0204): one lesson, for the golfer or the pro. Being paid for
 * ("Finish paying"), booked (the ticket, with Message, Share and Cancel),
 * done, or cancelled (with what was refunded).
 */
export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lessonId = Number(id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [lesson, setLesson] = useState<Lesson | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLesson(await loadLesson(lessonId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [lessonId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (failed && lesson === undefined) return <LoadError size="screen" onRetry={() => void load()} what="this lesson" />;
  if (lesson === undefined) {
    return (
      <View style={[proStyles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (!lesson) return <StateMessage size="screen" icon="school-outline" title="That lesson isn't there any more" />;

  const asPro = lesson.proMemberId === me;
  const phase = lessonPhase(lesson);
  const outcome = cancelOutcome(lesson, asPro);
  const other = asPro ? lesson.golferName : lesson.proName;
  const pay = () => router.push({ pathname: "/web", params: { path: lessonPayPath(lesson.id), title: "Pay for your lesson" } });

  const doCancel = async () => {
    setBusy(true);
    try {
      const r = await cancelLesson(lesson.id, reason);
      setCancelling(false);
      await load();
      Alert.alert("Cancelled", r.refund_cents > 0 ? `${euroCents(r.refund_cents)} is on its way back${asPro ? " to the golfer" : " to you"}.` : asPro ? "The time is free again." : "No refund under the pro's terms.");
    } catch (e) {
      Alert.alert("Couldn't cancel", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.navy900 }} contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.md }}>
      <Stack.Screen options={{ title: asPro ? "Lesson" : "Your lesson" }} />

      <View style={{ alignItems: "center", gap: 6, paddingTop: 8 }}>
        <Kicker color={colors.gold400}>
          {phase === "upcoming" ? (asPro ? "BOOKED IN YOUR DIARY" : "YOU'RE BOOKED IN") : phase === "paying" ? "WAITING FOR PAYMENT" : phase === "done" ? "DONE" : phase === "cancelled" ? "CANCELLED" : "NOT BOOKED"}
        </Kicker>
        <Text style={styles.headline}>
          {phase === "upcoming" ? (asPro ? `${lesson.golferName.split(" ")[0]} is coming` : "See you on the range") : phase === "paying" ? "Nearly there" : phase === "done" ? "Hope it went well" : phase === "cancelled" ? "This one's off" : "The hold ran out"}
        </Text>
      </View>

      <View style={styles.ticket}>
        <View style={{ height: 110 }}>
          <Image source={proPhoto(lesson.proClub)} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(12,32,56,0.35)" }]} />
          {phase === "upcoming" ? (
            <View style={styles.until}>
              <Text style={styles.untilText}>{untilText(lesson.starts_at)}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ padding: 16, gap: 4 }}>
          <Kicker>{[lesson.title, ...lesson.focus].join(" · ").toUpperCase()}</Kicker>
          <Text style={styles.when}>{lessonWhen(lesson.starts_at)}</Text>
          <Text style={proStyles.hint}>{asPro ? `with ${lesson.golferName}` : `with ${lesson.proName} · ${lesson.proClub}`}</Text>
          {lesson.note ? <Text style={styles.note}>“{lesson.note}”</Text> : null}
        </View>
        <View style={styles.perf}>
          <View style={[styles.notch, { left: -11 }]} />
          <View style={styles.dash} />
          <View style={[styles.notch, { right: -11 }]} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 16, paddingTop: 6, gap: 12 }}>
          <View>
            <Text style={proStyles.hint}>{asPro ? "You get" : phase === "paying" ? "To pay" : "Paid"}</Text>
            <Text style={styles.amount}>{euroCents(asPro ? lesson.price_cents - lesson.commission_cents : lesson.price_cents)}</Text>
          </View>
          <View style={{ alignItems: "flex-end", flex: 1 }}>
            {phase === "cancelled" ? (
              <>
                <Text style={proStyles.hint}>{lesson.cancelled_by === "pro" ? "Cancelled by the pro" : lesson.cancelled_by === "system" ? "The time was taken" : "Cancelled by the golfer"}</Text>
                <Text style={styles.refund}>{lesson.refund_cents > 0 ? `${euroCents(lesson.refund_cents)} refunded` : "No refund"}</Text>
              </>
            ) : lesson.free_cancel_until && phase === "upcoming" ? (
              <>
                <Text style={proStyles.hint}>Free to cancel until</Text>
                <Text style={styles.refund}>{lessonWhen(lesson.free_cancel_until)}</Text>
              </>
            ) : phase === "upcoming" ? (
              <Text style={proStyles.hint}>No refunds if the golfer cancels</Text>
            ) : null}
          </View>
        </View>
      </View>

      {phase === "paying" && !asPro ? (
        <Pressable style={[proStyles.primary, { backgroundColor: colors.gold400 }]} onPress={pay} accessibilityRole="button">
          <Text style={[proStyles.primaryText, { color: colors.ink900 }]}>Finish paying · {euroCents(lesson.price_cents)}</Text>
        </Pressable>
      ) : null}
      {phase === "expired" && !asPro ? (
        <Pressable style={[proStyles.primary, { backgroundColor: colors.gold400 }]} onPress={() => router.replace({ pathname: "/pros/[id]", params: { id: String(lesson.proId) } })} accessibilityRole="button">
          <Text style={[proStyles.primaryText, { color: colors.ink900 }]}>Pick another time</Text>
        </Pressable>
      ) : null}

      {phase === "upcoming" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Action icon="chatbubble-ellipses-outline" label="Message" onPress={() => router.push({ pathname: "/member/[id]", params: { id: asPro ? lesson.memberId : lesson.proMemberId } })} />
          <Action
            icon="share-outline"
            label="Tell the crew"
            onPress={() => void Share.share({ message: `${lesson.title} with ${lesson.proName}, ${lessonWhen(lesson.starts_at)} at ${lesson.proClub}. Booked on PinPals.` })}
          />
        </View>
      ) : null}

      {outcome.allowed ? (
        cancelling ? (
          <View style={[proStyles.card, { padding: spacing.md, gap: 10 }]}>
            <Text style={proStyles.label}>Cancel this {lesson.title.toLowerCase()}?</Text>
            <View style={[proStyles.terms, outcome.refundCents > 0 && { backgroundColor: colors.green100 }]}>
              <Ionicons name={outcome.refundCents > 0 ? "checkmark-circle-outline" : "alert-circle-outline"} size={20} color={outcome.refundCents > 0 ? colors.green800 : "#5a4512"} />
              <Text style={[proStyles.termsText, outcome.refundCents > 0 && { color: colors.green800 }]}>{outcome.line}</Text>
            </View>
            <TextInput value={reason} onChangeText={setReason} maxLength={300} placeholder={`A word for ${other.split(" ")[0]} (optional)`} placeholderTextColor={colors.ink500} style={proStyles.input} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={[proStyles.secondary, { flex: 1 }]} onPress={() => setCancelling(false)} accessibilityRole="button">
                <Text style={proStyles.secondaryText}>Keep it</Text>
              </Pressable>
              <Pressable style={[proStyles.primary, { flex: 1, backgroundColor: "#9b2c1f" }]} onPress={() => void doCancel()} disabled={busy} accessibilityRole="button">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={proStyles.primaryText}>Cancel lesson</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setCancelling(true)} style={{ alignSelf: "center", minHeight: 44, justifyContent: "center" }} accessibilityRole="button">
            <Text style={styles.cancelLink}>Need to cancel?</Text>
          </Pressable>
        )
      ) : null}
    </ScrollView>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={colors.gold400} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headline: { fontFamily: fonts.display, fontSize: 32, color: "#fff", textAlign: "center" },
  ticket: { backgroundColor: colors.cream50, borderRadius: 20, overflow: "hidden" },
  until: { position: "absolute", left: 14, bottom: 12, backgroundColor: colors.gold400, borderRadius: 14, paddingHorizontal: 12, minHeight: 28, justifyContent: "center" },
  untilText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink900 },
  when: { fontFamily: fonts.display, fontSize: 28, color: colors.ink900 },
  note: { fontFamily: fonts.body, fontSize: 14, fontStyle: "italic", color: colors.ink900, marginTop: 4 },
  perf: { height: 22, justifyContent: "center" },
  notch: { position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: colors.navy900 },
  dash: { marginHorizontal: 18, borderTopWidth: 2, borderStyle: "dashed", borderColor: colors.line },
  amount: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink900 },
  refund: { fontFamily: fonts.bodyBold, fontSize: 14, color: "#5a4512", textAlign: "right" },
  action: { flex: 1, minHeight: 64, borderRadius: radii.md, borderWidth: 1, borderColor: "#284870", backgroundColor: colors.navy800, alignItems: "center", justifyContent: "center", gap: 6 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.cream50 },
  cancelLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: "#c9d1dc", textDecorationLine: "underline" },
});
