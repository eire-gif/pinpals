import { useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { requestConnection } from "@/lib/members";
import { suggestionReason, type Suggestion } from "@/lib/onboarding";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * Suggested PinPals, in the two shapes the app shows them: a row (the
 * profile builder, the Find PinPals screen) and a card (Home's sideways
 * strip). Both carry their own Connect button and its state, so a screen
 * only has to hand over the list.
 */

function useConnect(personId: string) {
  const { session } = useAuth();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const connect = async () => {
    const me = session?.user?.id;
    if (!me || state === "sending" || state === "sent") return;
    setState("sending");
    try {
      await requestConnection(me, personId);
      setState("sent");
    } catch {
      setState("failed");
    }
  };

  const label =
    state === "sent" ? "Requested" : state === "sending" ? "Sending…" : state === "failed" ? "Try again" : "Connect";
  return { state, connect, label };
}

const fullName = (p: Suggestion) => `${p.first_name} ${p.last_name}`.trim();

export function SuggestionRow({ person, last = false }: { person: Suggestion; last?: boolean }) {
  const router = useRouter();
  const { state, connect, label } = useConnect(person.id);
  const detail = [person.home_club, person.handicap !== null ? `Hcp ${person.handicap.toFixed(1)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Pressable
        style={styles.who}
        onPress={() => router.push(`/member/${person.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${fullName(person)}, ${suggestionReason(person)}`}
      >
        <Avatar url={person.avatar_url} color={person.avatar_color} name={fullName(person)} size={48} />
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>{fullName(person)}</Text>
          {detail ? <Text style={styles.meta} numberOfLines={1}>{detail}</Text> : null}
          <View style={styles.why}>
            <Text style={styles.whyText}>{suggestionReason(person)}</Text>
          </View>
        </View>
      </Pressable>
      <ConnectButton state={state} label={label} onPress={connect} />
    </View>
  );
}

export function SuggestionCard({ person }: { person: Suggestion }) {
  const router = useRouter();
  const { state, connect, label } = useConnect(person.id);

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.cardWho}
        onPress={() => router.push(`/member/${person.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${fullName(person)}, ${suggestionReason(person)}`}
      >
        <Avatar url={person.avatar_url} color={person.avatar_color} name={fullName(person)} size={56} />
        <Text style={styles.cardName} numberOfLines={1}>{fullName(person)}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{person.home_club ?? " "}</Text>
        <Text style={styles.cardWhy} numberOfLines={1}>{suggestionReason(person)}</Text>
      </Pressable>
      <ConnectButton state={state} label={label} onPress={connect} wide />
    </View>
  );
}

function ConnectButton({
  state,
  label,
  onPress,
  wide = false,
}: {
  state: string;
  label: string;
  onPress: () => void;
  wide?: boolean;
}) {
  const done = state === "sent";
  return (
    <Pressable
      onPress={onPress}
      disabled={done || state === "sending"}
      style={[styles.connect, wide && styles.connectWide, done && styles.connectDone]}
      accessibilityRole="button"
      accessibilityState={{ disabled: done }}
    >
      <Text style={[styles.connectLabel, done && styles.connectLabelDone]}>{label}</Text>
    </Pressable>
  );
}

/**
 * "Bring your fourball" — the system share sheet with a link to join.
 *
 * Share, not a contacts picker: no permission prompt, no address book leaving
 * the phone, and the member picks WhatsApp or Messages themselves, which is
 * where their golf group already lives.
 */
export function InviteBanner({
  title = "Bring your fourball",
  body = "Invite the friends you already play with.",
}: {
  title?: string;
  body?: string;
}) {
  const invite = () =>
    void Share.share({
      message: `I've joined PinPals — golfers in Ireland swapping tee times and selling gear. Join me: ${SITE_URL}/signup`,
    });

  return (
    <View style={styles.invite}>
      <Ionicons name="person-add-outline" size={24} color={colors.gold400} />
      <View style={styles.text}>
        <Text style={styles.inviteTitle}>{title}</Text>
        <Text style={styles.inviteBody}>{body}</Text>
      </View>
      <Pressable onPress={invite} style={styles.inviteButton} accessibilityRole="button">
        <Text style={styles.inviteLabel}>Invite</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.cream100,
  },
  rowLast: { borderBottomWidth: 0 },
  who: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  text: { flex: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: "#5b6576", marginTop: 2 },
  why: {
    alignSelf: "flex-start",
    marginTop: 5,
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  whyText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green800 },
  connect: {
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  connectWide: { alignSelf: "stretch", marginTop: 10 },
  connectDone: { backgroundColor: colors.cream100 },
  connectLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.cream50 },
  connectLabelDone: { color: colors.green800 },
  card: {
    width: 156,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  cardWho: { alignItems: "center" },
  cardName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900, marginTop: 8 },
  cardMeta: { fontFamily: fonts.body, fontSize: 12.5, color: "#5b6576", marginTop: 2 },
  cardWhy: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.green800, marginTop: 2 },
  invite: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.navy900,
  },
  inviteTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  inviteBody: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100, marginTop: 2 },
  inviteButton: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
    justifyContent: "center",
  },
  inviteLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
});
