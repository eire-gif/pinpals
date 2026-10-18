import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { Nine } from "@/components/scorecard-grid";
import { LoadError, StateMessage } from "@/components/state-message";
import { TeeDot } from "@/components/tee-chip";
import { useAuth } from "@/lib/auth";
import {
  CertifyCancelled,
  METHOD_LABEL,
  biometricMethod,
  canUseBiometrics,
  certifyButtonLabel,
  resetCertifyKey,
  signCertification,
  type CertifyMethod,
} from "@/lib/certify-device";
import { requestTakeover } from "@/lib/ads";
import { isOn } from "@/lib/features";
import { goHome } from "@/lib/go-home";
import { playedLabel, scorecardTotals, shotsOnCard, vsParText } from "@/lib/scorecard-math";
import { StaleCertifyKey, certifiedAtLabel, certify, declineRequest, openRequest, queryHole, type OpenedRequest } from "@/lib/scorecard-certifications";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Certify a playing partner's card (0128) — the marker's signature.
 *
 * The certifier sees the whole card exactly as the owner does, then either
 * certifies it behind Face ID / Touch ID / fingerprint, queries a hole (with
 * an optional note) so the owner can fix it, or declines.
 *
 * Opened from the notification, or from "Waiting for you to certify" on
 * My scorecards.
 */
export default function CertifyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Number(id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [req, setReq] = useState<OpenedRequest | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "certify" | "query" | "decline">(null);
  const [querying, setQuerying] = useState(false);
  const [hole, setHole] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setReq(await openRequest(requestId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open this request.");
      setReq(null);
    }
  }, [requestId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isOn("scorecardCertification")) return <StateMessage size="screen" icon="shield-checkmark-outline" title="Certifying cards is on its way" />;
  if (req === undefined) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  if (req === null) {
    return error && /isn't available|isn't for you/.test(error) ? (
      <StateMessage size="screen" icon="lock-closed-outline" title="This request isn't available" body="It may have been withdrawn, or the card deleted." />
    ) : (
      <LoadError size="screen" what="this request" onRetry={() => void load()} />
    );
  }

  const owner = req.owner.firstName;

  // Closed and not certified: the certifier no longer gets the card itself.
  if (req.card == null) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Stack.Screen options={{ title: "Certify card" }} />
        <Status req={req} />
        <Pressable onPress={goHome} style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]} accessibilityRole="button">
          <Ionicons name="home-outline" size={18} color={colors.cream50} />
          <Text style={styles.homeLabel}>Done — back to Home</Text>
        </Pressable>
      </ScrollView>
    );
  }
  const cardInfo = req.card;
  const t = scorecardTotals(req.holeList, cardInfo.playingHandicap);
  const shots = shotsOnCard(req.holeList, cardInfo.playingHandicap);
  const front = req.holeList.filter((h) => h.hole <= 9);
  const back = req.holeList.filter((h) => h.hole > 9);
  const hasYards = req.holeList.some((h) => h.yards != null);
  const hasSI = req.holeList.some((h) => h.strokeIndex != null);
  // Putts aren't part of what's certified (0128's card hash), so they aren't shown.
  const hasPutts = false;
  const open = req.role === "certifier" && req.status === "pending" && req.challenge != null && req.cardHash != null;

  const biometrics = canUseBiometrics();
  const method: CertifyMethod = biometrics ? biometricMethod() : "in_app";

  const doCertify = async () => {
    if (!me || !req.challenge || !req.cardHash) return;
    setBusy("certify");
    const prompt = `Certify ${owner}'s card`;
    const request = { id: req.id, challenge: req.challenge, cardHash: req.cardHash };
    try {
      if (method === "in_app") {
        await certify(req.id, "in_app", null, null);
      } else {
        let signed = await signCertification(me, request, prompt);
        try {
          await certify(req.id, method, signed.keyId, signed.signature);
        } catch (e) {
          // The server doesn't know this phone's key (retired, or set up on
          // another install): set it up again and try once more.
          if (!(e instanceof StaleCertifyKey)) throw e;
          await resetCertifyKey(me);
          signed = await signCertification(me, request, prompt);
          await certify(req.id, method, signed.keyId, signed.signature);
        }
      }
      // A round just certified: the moment an "after a round" advert may
      // show (only with ads on; the host waits for a free screen).
      requestTakeover("after_round");
      await load();
    } catch (e) {
      if (e instanceof CertifyCancelled) return;
      Alert.alert("Couldn't certify it", e instanceof Error ? e.message : "Please try again.");
      void load();
    } finally {
      setBusy(null);
    }
  };

  const confirmCertify = () => {
    if (method !== "in_app") return void doCertify();
    Alert.alert(
      "Certify without Face ID?",
      "This phone has no Face ID or fingerprint set up, so the card will say it was certified in the app rather than with Face ID. Set one up in your phone's settings to certify with it.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Certify in the app", onPress: () => void doCertify() },
      ]
    );
  };

  const sendQuery = async () => {
    if (hole == null) return;
    setBusy("query");
    try {
      await queryHole(req.id, hole, note);
      setQuerying(false);
      await load();
    } catch (e) {
      Alert.alert("Couldn't send it", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const decline = () =>
    Alert.alert(`Don't certify ${owner}'s card?`, `${owner} will be told you didn't certify it, and can ask someone else.`, [
      { text: "Go back", style: "cancel" },
      {
        text: "Don't certify",
        style: "destructive",
        onPress: async () => {
          setBusy("decline");
          try {
            await declineRequest(req.id);
            await load();
          } catch (e) {
            Alert.alert("Couldn't do that", e instanceof Error ? e.message : "Please try again.");
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.cream50 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: "Certify card" }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.who}>
            <Avatar url={req.owner.avatarUrl} color={req.owner.avatarColor} name={req.owner.name} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroEyebrow}>{req.role === "certifier" ? `${owner} asks you to certify` : "Your card"}</Text>
              <Text style={styles.heroName}>{req.owner.name}</Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>{cardInfo.courseName}</Text>
          <View style={styles.heroSubRow}>
            {cardInfo.teeName ? <TeeDot name={cardInfo.teeName} size={12} /> : null}
            <Text style={styles.heroSub}>
              {[playedLabel(cardInfo.playedOn), cardInfo.teeName ? `${cardInfo.teeName} tees` : null, cardInfo.playingHandicap != null ? `plays off ${cardInfo.playingHandicap}` : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <View style={styles.tiles}>
            <Tile label={t.complete ? "Score" : `Thru ${t.played}`} value={t.complete && t.total.strokes != null ? String(t.total.strokes) : vsParText(t.vsPar)} big />
            <Tile label="To par" value={vsParText(t.vsPar)} />
            {t.points != null ? <Tile label="Points" value={String(t.points)} /> : null}
          </View>
        </View>

        <Status req={req} />

        <Nine title={cardInfo.holes === 9 ? "Holes 1–9" : "Out"} holes={front} total={t.out} shots={shots} yards={hasYards} si={hasSI} putts={hasPutts} highlight={querying ? hole : req.queryHole} />
        {back.length > 0 && t.in ? <Nine title="In" holes={back} total={t.in} shots={shots} yards={hasYards} si={hasSI} putts={hasPutts} highlight={querying ? hole : req.queryHole} /> : null}

        {open && !querying ? (
          <View style={styles.actions}>
            <Text style={styles.declare}>
              By certifying, you confirm these are the scores {owner} made, hole by hole{cardInfo.playingHandicap != null ? `, playing off ${cardInfo.playingHandicap}` : ""}.
            </Text>
            <Pressable onPress={confirmCertify} disabled={busy != null} style={({ pressed }) => [styles.certify, pressed && styles.pressed]} accessibilityRole="button">
              {busy === "certify" ? (
                <ActivityIndicator color={colors.navy900} />
              ) : (
                <>
                  <Ionicons name={method === "face_id" ? "scan" : method === "in_app" ? "checkmark-circle" : "finger-print"} size={22} color={colors.navy900} />
                  <Text style={styles.certifyLabel}>{certifyButtonLabel(method)}</Text>
                </>
              )}
            </Pressable>
            <View style={styles.row2}>
              <Pressable onPress={() => setQuerying(true)} disabled={busy != null} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
                <Ionicons name="help-circle-outline" size={18} color={colors.ink900} />
                <Text style={styles.secondaryLabel}>Query a hole</Text>
              </Pressable>
              <Pressable onPress={decline} disabled={busy != null} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
                {busy === "decline" ? <ActivityIndicator color={colors.red600} /> : <Text style={[styles.secondaryLabel, { color: colors.red600 }]}>Don't certify</Text>}
              </Pressable>
            </View>
          </View>
        ) : null}

        {open && querying ? (
          <View style={styles.query}>
            <Text style={styles.queryTitle}>Which hole?</Text>
            <View style={styles.holeChips}>
              {req.holeList.map((h) => (
                <Pressable
                  key={h.hole}
                  onPress={() => setHole(h.hole)}
                  style={[styles.holeChip, hole === h.hole && styles.holeChipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: hole === h.hole }}
                  accessibilityLabel={`Hole ${h.hole}`}
                >
                  <Text style={[styles.holeChipText, hole === h.hole && styles.holeChipTextOn]}>{h.hole}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={`A note for ${owner} (optional) — e.g. "I had you down for a 6"`}
              placeholderTextColor={colors.ink500}
              maxLength={200}
              multiline
              style={styles.note}
            />
            <View style={styles.row2}>
              <Pressable onPress={() => setQuerying(false)} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.secondaryLabel}>Back</Text>
              </Pressable>
              <Pressable
                onPress={() => void sendQuery()}
                disabled={hole == null || busy != null}
                style={({ pressed }) => [styles.send, (hole == null || busy != null) && styles.disabled, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {busy === "query" ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.sendLabel}>Send query</Text>}
              </Pressable>
            </View>
          </View>
        ) : null}

        {!open ? (
          <Pressable onPress={goHome} style={({ pressed }) => [styles.homeButton, pressed && styles.pressed]} accessibilityRole="button">
            <Ionicons name="home-outline" size={18} color={colors.cream50} />
            <Text style={styles.homeLabel}>Done — back to Home</Text>
          </Pressable>
        ) : null}
        {req.role === "owner" ? (
          <Pressable onPress={() => router.replace({ pathname: "/scorecards/[id]", params: { id: String(req.scorecardId) } })} style={styles.link} accessibilityRole="button">
            <Text style={styles.linkText}>Open the card</Text>
          </Pressable>
        ) : !open ? (
          // 0180: a certifier who played has their own card saved when the
          // round finished — it's at the top of My scorecards.
          <Pressable onPress={() => router.replace("/scorecards")} style={styles.link} accessibilityRole="button">
            <Text style={styles.linkText}>Open my card</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Where the request stands, when it's no longer waiting on this person. */
function Status({ req }: { req: OpenedRequest }) {
  const owner = req.owner.firstName;
  const you = req.role === "certifier";
  if (req.status === "pending") {
    return you ? (
      <View style={styles.note2}>
        <Ionicons name="information-circle-outline" size={18} color={colors.green700} />
        <Text style={styles.note2Text}>Check each hole against what you saw. If one looks wrong, query it and {owner} can fix it.</Text>
      </View>
    ) : null;
  }
  const map: Record<string, { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string; good?: boolean }> = {
    certified: {
      icon: "shield-checkmark",
      title: you ? `You certified ${owner}'s card` : `Certified by ${req.certifierName}`,
      body: `${METHOD_LABEL[req.method ?? "in_app"]}${req.respondedAt ? ` · ${certifiedAtLabel(req.respondedAt)}` : ""}`,
      good: true,
    },
    queried: { icon: "help-circle", title: you ? `You queried the ${req.queryHole}${suffix(req.queryHole)}` : `Queried: hole ${req.queryHole}`, body: req.queryNote ?? undefined },
    declined: { icon: "close-circle", title: you ? "You didn't certify this card" : `${req.certifierName} didn't certify it` },
    expired: { icon: "time-outline", title: "This request has expired", body: you ? `${owner} can send it again.` : undefined },
    void: { icon: "refresh-circle", title: "The card was changed", body: you ? `${owner} changed the card after asking, so they'll need to send it again.` : undefined },
    cancelled: { icon: "close-circle-outline", title: you ? `${owner} withdrew this request` : "Withdrawn" },
  };
  const s = map[req.status];
  if (!s) return null;
  return (
    <View style={[styles.status, s.good && styles.statusGood]}>
      <Ionicons name={s.icon} size={24} color={s.good ? colors.green700 : colors.ink500} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.statusTitle, s.good && { color: colors.green800 }]}>{s.title}</Text>
        {s.body ? <Text style={styles.statusBody}>{s.body}</Text> : null}
      </View>
    </View>
  );
}

const suffix = (n: number | null) => {
  const v = n ?? 0;
  return v % 100 >= 11 && v % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[v % 10] ?? "th";
};

function Tile({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, big && styles.tileBig]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md + 4, gap: 4 },
  who: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, marginBottom: spacing.sm },
  heroEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400 },
  heroName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.cream50 },
  heroSubRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroSub: { fontFamily: fonts.body, fontSize: 13.5, color: creamAlpha(0.8), flexShrink: 1 },
  tiles: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  tile: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: creamAlpha(0.08) },
  tileValue: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  tileBig: { fontSize: 30, color: colors.gold400 },
  tileLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: creamAlpha(0.7) },

  note2: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: spacing.sm + 4, borderRadius: radii.md, backgroundColor: colors.green100 },
  note2Text: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.green800 },
  status: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  statusGood: { backgroundColor: colors.green100, borderColor: "#bfd6bd" },
  statusTitle: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  statusBody: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink500 },

  actions: { gap: spacing.sm + 2 },
  declare: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink500, textAlign: "center" },
  certify: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 56, borderRadius: radii.pill, backgroundColor: colors.gold400 },
  certifyLabel: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.navy900 },
  row2: { flexDirection: "row", gap: spacing.sm },
  secondary: { flex: 1, flexDirection: "row", gap: 6, minHeight: 46, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },

  query: { gap: spacing.sm + 2, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  queryTitle: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.green700 },
  holeChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  holeChip: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  holeChipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  holeChipText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  holeChipTextOn: { color: colors.cream50 },
  note: { minHeight: 70, padding: spacing.sm + 2, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, textAlignVertical: "top" },
  send: { flex: 1, minHeight: 46, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  sendLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  disabled: { opacity: 0.5 },

  homeButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.navy900 },
  homeLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  link: { alignItems: "center", paddingVertical: spacing.sm },
  linkText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  pressed: { opacity: 0.85 },
});
