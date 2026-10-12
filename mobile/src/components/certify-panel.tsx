import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { METHOD_LABEL } from "@/lib/certify-device";
import {
  certifiedAtLabel,
  loadCandidates,
  loadCertification,
  requestCertification,
  type Candidate,
  type Certification,
} from "@/lib/scorecard-certifications";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Certification on a scorecard (0128).
 *
 * The owner sees where things stand and what to do next: ask someone, wait,
 * deal with a query, or the certificate itself. Anyone else who can see the
 * card sees only the certificate, if there is one.
 *
 * `autoAsk`: opened from "Get my card certified" after finishing a round —
 * go straight to choosing who to ask.
 */
export function CertifyPanel({
  scorecardId,
  mine,
  autoAsk = false,
  onAutoAsked,
  version = 0,
  onQueryHole,
}: {
  scorecardId: number;
  mine: boolean;
  autoAsk?: boolean;
  /** Called once the picker has opened for `autoAsk`, so it doesn't open again. */
  onAutoAsked?: () => void;
  /** Bumped by the card screen whenever it reloads, so this reloads too. */
  version?: number;
  /** Tells the card which hole was queried, to mark it. */
  onQueryHole?: (hole: number | null) => void;
}) {
  const [cert, setCert] = useState<Certification | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await loadCertification(scorecardId);
      setCert(c);
      onQueryHole?.(c?.status === "queried" ? c.queryHole : null);
    } catch {
      // Before the migration, or offline: show nothing rather than an error
      // on a card that is otherwise fine.
      setCert(null);
    }
  }, [scorecardId, onQueryHole]);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    if (!autoAsk || !mine || cert === undefined) return;
    if (cert?.status !== "certified" && cert?.status !== "pending") setPicking(true);
    onAutoAsked?.();
  }, [autoAsk, mine, cert, onAutoAsked]);

  if (cert === undefined) return null;

  if (cert?.status === "certified") {
    return (
      <View style={styles.badge} accessible accessibilityLabel={`Certified by ${cert.certifierName}, ${METHOD_LABEL[cert.method ?? "in_app"]}`}>
        <View style={styles.badgeIcon}>
          <Ionicons name="shield-checkmark" size={22} color={colors.cream50} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.badgeTitle}>Certified by {cert.certifierName}</Text>
          <Text style={styles.badgeSub}>
            {METHOD_LABEL[cert.method ?? "in_app"]}
            {cert.respondedAt ? ` · ${certifiedAtLabel(cert.respondedAt)}` : ""}
          </Text>
          {mine ? <Text style={styles.badgeNote}>Changing the scores removes the certificate.</Text> : null}
        </View>
      </View>
    );
  }

  if (!mine) return null;

  const name = cert?.certifierName ?? "";
  let title = "Get this card certified";
  let body = "Ask someone who played with you to confirm your scores with their Face ID or fingerprint. The card then shows who certified it.";
  let action = "Choose who to ask";
  let tone: "plain" | "wait" | "query" = "plain";

  if (cert?.status === "pending") {
    title = `Waiting for ${name}`;
    body = `${name} has been asked to certify your card. You'll get a notification when they answer.`;
    action = "Ask someone else";
    tone = "wait";
  } else if (cert?.status === "queried") {
    title = `${name} queried the ${ordinal(cert.queryHole ?? 1)}`;
    body = cert.queryNote ? `“${cert.queryNote}”\n\nFix the card if it needs it, then ask again.` : "Check that hole, fix the card if it needs it, then ask again.";
    action = "Ask again";
    tone = "query";
  } else if (cert?.status === "declined") {
    body = `${name} didn't certify it. You can ask someone else who played with you.`;
  } else if (cert?.status === "expired") {
    body = `${name} didn't answer in time. Ask them again, or someone else who played with you.`;
  } else if (cert?.status === "void") {
    title = "Certify it again";
    body = "The card changed after it was certified, so the certificate no longer applies. Ask a playing partner to certify the card as it is now.";
  }

  return (
    <View style={[styles.panel, tone === "query" && styles.panelQuery]}>
      <View style={styles.panelHead}>
        <Ionicons name={tone === "query" ? "help-circle" : tone === "wait" ? "time-outline" : "shield-checkmark-outline"} size={20} color={tone === "query" ? colors.buy700 : colors.green700} />
        <Text style={styles.panelTitle}>{title}</Text>
      </View>
      <Text style={styles.panelBody}>{body}</Text>
      <View style={styles.panelActions}>
        {tone === "query" ? (
          <Pressable
            onPress={() => router.push({ pathname: "/scorecards/new", params: { id: String(scorecardId) } })}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryLabel}>Edit card</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setPicking(true)} style={({ pressed }) => [styles.primary, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.primaryLabel}>{action}</Text>
        </Pressable>
      </View>
      <PartnerPicker
        visible={picking}
        scorecardId={scorecardId}
        onClose={() => setPicking(false)}
        onSent={() => {
          setPicking(false);
          void load();
        }}
      />
    </View>
  );
}

function PartnerPicker({ visible, scorecardId, onClose, onSent }: { visible: boolean; scorecardId: number; onClose: () => void; onSent: () => void }) {
  const [people, setPeople] = useState<Candidate[] | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPeople(undefined);
    setFailed(null);
    loadCandidates(scorecardId)
      .then(setPeople)
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : "Couldn't load your playing partners."));
  }, [visible, scorecardId]);

  const ask = (p: Candidate) =>
    Alert.alert(`Ask ${p.name}?`, `${p.name.split(" ")[0]} gets a notification to check your scores and certify the card on their phone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Send",
        onPress: async () => {
          setSending(p.memberId);
          try {
            await requestCertification(scorecardId, p.memberId);
            onSent();
          } catch (e) {
            Alert.alert("Couldn't send it", e instanceof Error ? e.message : "Please try again.");
          } finally {
            setSending(null);
          }
        },
      },
    ]);

  const played = people?.some((p) => p.playedInRound) ?? false;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>Who should certify it?</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={colors.ink900} />
          </Pressable>
        </View>
        <Text style={styles.sheetIntro}>
          {played
            ? "The PinPals who played this round with you."
            : "Your PinPals. Pick someone who played the round with you — they're vouching for your scores."}
        </Text>
        {failed ? (
          <Text style={styles.sheetEmpty}>{failed}</Text>
        ) : people === undefined ? (
          <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.lg }} />
        ) : people.length === 0 ? (
          <Text style={styles.sheetEmpty}>
            Nobody to ask yet. Only members can certify a card — a playing partner who joins PinPals and plays in your live round can certify the next one.
          </Text>
        ) : (
          <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}>
            {people.map((p) => (
              <Pressable
                key={p.memberId}
                onPress={() => ask(p)}
                disabled={sending != null}
                style={({ pressed }) => [styles.person, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Ask ${p.name}`}
              >
                <Avatar url={p.avatarUrl} color={p.avatarColor} name={p.name} size={40} />
                <Text style={styles.personName} numberOfLines={1}>
                  {p.name}
                </Text>
                {p.playedInRound ? <Text style={styles.played}>Played with you</Text> : null}
                {sending === p.memberId ? <ActivityIndicator color={colors.green700} /> : <Ionicons name="chevron-forward" size={18} color={colors.ink500} />}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.green100, borderWidth: 1, borderColor: "#bfd6bd" },
  badgeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  badgeTitle: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.green800 },
  badgeSub: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green700 },
  badgeNote: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 2 },

  panel: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  panelQuery: { borderColor: colors.buy500, backgroundColor: "#fff8ec" },
  panelHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  panelTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  panelBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500 },
  panelActions: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  primary: { flex: 1, minHeight: 44, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  primaryLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  secondary: { flex: 1, minHeight: 44, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  pressed: { opacity: 0.85 },

  sheet: { flex: 1, backgroundColor: colors.cream50, padding: spacing.md, gap: spacing.md },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  sheetTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900 },
  sheetIntro: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500 },
  sheetEmpty: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500, marginTop: spacing.md },
  person: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.sm + 4, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  personName: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  played: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.green700 },
});
