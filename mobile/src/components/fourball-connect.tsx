import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { guestScorecardMessage, loadPlayedWith, shareVia, type ShareChannel } from "@/lib/find-pinpals";
import { requestConnection } from "@/lib/members";
import { supabase } from "@/lib/supabase";
import { colors, fonts } from "@/lib/theme";

type Player = { id: number; memberId: string | null; name: string };
type Status = "accepted" | "pending" | "declined" | null;

/**
 * After a round (approved mock-up 5): your fourball — connect with the
 * PinPals you just played with, and send a guest their scorecard
 * (round_guest_invite(), 0118). Joining saves the round to their profile and
 * connects you. Then "Same again next Saturday?".
 */
export function FourballConnect({ me, courseName, players }: { me: string; courseName: string; players: Player[] }) {
  const others = players.filter((p) => p.memberId !== me);
  const memberIds = others.map((p) => p.memberId).filter((x): x is string => !!x);
  const [status, setStatus] = useState<Map<string, Status>>(new Map());
  const [invited, setInvited] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | number | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ data }, played] = await Promise.all([
        memberIds.length
          ? supabase
              .from("connections")
              .select("requester_id, recipient_id, status")
              .or(`requester_id.eq.${me},recipient_id.eq.${me}`)
          : Promise.resolve({ data: [] as { requester_id: string; recipient_id: string; status: Status }[] }),
        loadPlayedWith(365),
      ]);
      if (!live) return;
      const map = new Map<string, Status>();
      for (const c of (data ?? []) as { requester_id: string; recipient_id: string; status: Status }[]) {
        map.set(c.requester_id === me ? c.recipient_id : c.requester_id, c.status);
      }
      setStatus(map);
      setInvited(new Set(played.filter((p) => p.invited).map((p) => p.playerId)));
    })();
    return () => {
      live = false;
    };
    // memberIds is derived from players
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, players]);

  if (others.length === 0) return null;
  const guests = others.filter((p) => !p.memberId);

  async function connect(id: string) {
    setBusy(id);
    try {
      await requestConnection(me, id);
      setStatus((prev) => new Map(prev).set(id, "pending"));
    } catch (err) {
      Alert.alert("Couldn't send that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function sendCard(p: Player, channel: ShareChannel) {
    setBusy(p.id);
    try {
      await shareVia(channel, await guestScorecardMessage(p.id, p.name.replace(/\s*\(guest\)\s*$/i, ""), courseName));
      setInvited((prev) => new Set(prev).add(p.id));
    } catch (err) {
      Alert.alert("Couldn't make the link", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.heading}>Your fourball</Text>
      <View style={styles.card}>
        {others.map((p, i) => {
          const st = p.memberId ? status.get(p.memberId) ?? null : null;
          const name = p.name.replace(/\s*\(guest\)\s*$/i, "");
          return (
            <View key={p.id} style={[styles.row, i < others.length - 1 && styles.rowLine]}>
              <View style={[styles.circle, !p.memberId && styles.circleGuest]}>
                <Text style={[styles.initials, !p.memberId && { color: "#7a6a3e" }]}>{initials(name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {name}
                  {!p.memberId ? <Text style={styles.guest}> · guest</Text> : null}
                </Text>
                <Text style={styles.meta}>{p.memberId ? "On PinPals" : invited.has(p.id) ? "Scorecard sent" : "Not on PinPals yet"}</Text>
              </View>
              {p.memberId ? (
                st === "accepted" ? (
                  <Text style={styles.connected}>Connected</Text>
                ) : st === "pending" ? (
                  <Text style={styles.requested}>Requested</Text>
                ) : (
                  <Pressable onPress={() => void connect(p.memberId!)} disabled={busy === p.memberId} accessibilityRole="button" accessibilityLabel={`Connect with ${name}`}>
                    {({ pressed }) => (
                      <View style={[styles.lip, pressed && styles.lipPressed]}>
                        <View style={styles.gold}>
                          {busy === p.memberId ? <ActivityIndicator color={colors.navy900} size="small" /> : <Text style={styles.goldText}>Connect</Text>}
                        </View>
                      </View>
                    )}
                  </Pressable>
                )
              ) : null}
            </View>
          );
        })}
      </View>

      {guests.map((g) => {
        const first = g.name.replace(/\s*\(guest\)\s*$/i, "").split(" ")[0];
        return (
          <View key={g.id} style={styles.send}>
            <Text style={styles.sendTitle}>Send {first} the scorecard{invited.has(g.id) ? " again" : ""}</Text>
            <Text style={styles.sendBody}>A link to today&apos;s card. When {first} joins, the round is saved to their profile and you&apos;re connected.</Text>
            <View style={styles.sendRow}>
              <Pressable onPress={() => void sendCard(g, "whatsapp")} disabled={busy === g.id} style={{ flex: 1 }} accessibilityRole="button">
                {({ pressed }) => (
                  <View style={[styles.lip, pressed && styles.lipPressed]}>
                    <View style={[styles.gold, { height: 44 }]}>
                      {busy === g.id ? <ActivityIndicator color={colors.navy900} /> : <Text style={styles.goldText}>WhatsApp</Text>}
                    </View>
                  </View>
                )}
              </Pressable>
              <Pressable onPress={() => void sendCard(g, "sms")} disabled={busy === g.id} style={styles.outline} accessibilityRole="button">
                <Text style={styles.outlineText}>Text message</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Pressable onPress={() => router.push("/post-tee-time")} style={styles.again} accessibilityRole="button">
        <Ionicons name="calendar-outline" size={22} color={colors.navy900} />
        <View style={{ flex: 1 }}>
          <Text style={styles.againTitle}>Same again next week?</Text>
          <Text style={styles.againBody}>Post a tee time and invite this fourball</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.navy900} />
      </Pressable>
    </View>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const shadow = {
  shadowColor: colors.navy900,
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: "800", color: colors.navy900 },
  card: { backgroundColor: colors.surface, borderRadius: 18, ...shadow },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: "#eee7d6" },
  circle: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  circleGuest: { backgroundColor: "transparent", borderWidth: 2, borderStyle: "dashed", borderColor: "#b9a777" },
  initials: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold400 },
  name: { fontSize: 15, fontWeight: "800", color: colors.navy900 },
  guest: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: "#7a6a3e" },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  connected: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700 },
  requested: { fontFamily: fonts.bodyBold, fontSize: 13, color: "#7a6a3e" },
  lip: { borderRadius: 22, backgroundColor: "#9c7a2c", paddingBottom: 3 },
  lipPressed: { paddingBottom: 0, marginTop: 3 },
  gold: { height: 36, paddingHorizontal: 14, borderRadius: 22, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  goldText: { fontSize: 14, fontWeight: "800", color: colors.navy900 },
  send: { backgroundColor: colors.navy900, borderRadius: 18, padding: 16, gap: 10 },
  sendTitle: { fontSize: 16, fontWeight: "800", color: colors.gold400 },
  sendBody: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: "#c9d2de" },
  sendRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  outline: { flex: 1, height: 47, borderRadius: 22, borderWidth: 1.5, borderColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  outlineText: { fontSize: 14, fontWeight: "800", color: colors.gold400 },
  again: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, ...shadow },
  againTitle: { fontSize: 14, fontWeight: "800", color: colors.navy900 },
  againBody: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
});
