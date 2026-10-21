import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Pills } from "@/components/compete-bits";
import { Button, Chip } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { PROVINCES, type Province } from "@/lib/matchplay";
import { amCompetitionStaff, loadOpens, removeOpen, setOpenSource, setPartnerRequest, type Open } from "@/lib/matchplay-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { myRoundRight } from "@/components/my-round-pill";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Open competitions (0148): shared by members, or marked by PinPals as
 * posted by the club. Members flag that they need a partner and message
 * each other; entry is booked on the club's own system, never here.
 */
export default function OpensScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [opens, setOpens] = useState<Open[] | null>(null);
  const [staff, setStaff] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [region, setRegion] = useState<"all" | Province>("all");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, isStaff] = await Promise.all([loadOpens(), amCompetitionStaff()]);
      setOpens(list);
      setStaff(isStaff);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function run(id: number, fn: () => Promise<unknown>, title: string) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (err) {
      Alert.alert(title, err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <Stack.Screen
      options={{
        title: "Open competitions",
        headerBackTitle: "Back",
        ...myRoundRight(() => (
          <Pressable style={styles.headerBtn} onPress={() => router.push("/compete/share-open")} accessibilityRole="button" accessibilityLabel="Share an open">
            <Ionicons name="add-circle-outline" size={20} color={colors.navy900} />
            <Text style={styles.headerBtnText}>Share</Text>
          </Pressable>
        )),
      }}
    />
  );

  if (!isOn("competitions")) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="flag-outline" title="Opens are on their way" size="screen" />
      </View>
    );
  }
  if (failed && !opens) {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="the opens" size="screen" />
      </View>
    );
  }
  if (!opens) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  const shown = opens.filter((o) => region === "all" || o.province === region);

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {header}
      <Pills label="Province" value={region} onChange={setRegion} options={[{ id: "all" as const, label: "All" }, ...PROVINCES.map((p) => ({ id: p.id, label: p.label }))]} />
      <Text style={styles.small}>{`${shown.length} ${shown.length === 1 ? "open" : "opens"} coming up. You book and pay with the club.`}</Text>

      {shown.length === 0 ? (
        <StateMessage icon="flag-outline" title="No opens listed here yet" body="Spotted one on a club's website or booking page? Share it so others can find it, and a partner." action={{ label: "Share an open", onPress: () => router.push("/compete/share-open") }} />
      ) : null}

      {shown.map((o) => {
        const [, m, d] = o.playsOn.split("-").map(Number);
        const imIn = !!me && o.partners.some((p) => p.userId === me);
        const others = o.partners.filter((p) => p.userId !== me);
        const expanded = open === o.id;
        const canRemove = o.postedBy === me || staff;
        return (
          <View key={o.id} style={styles.card}>
            <View style={styles.top}>
              <View style={styles.date} accessible accessibilityLabel={`${d} ${MONTHS[m - 1]}`}>
                <Text style={styles.dateMon}>{MONTHS[m - 1]}</Text>
                <Text style={styles.dateDay}>{d}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.club}>{o.clubName}</Text>
                <Text style={styles.title}>{o.title}</Text>
                <Text style={styles.small}>{[o.clubTown, o.entryFee].filter(Boolean).join(" · ")}</Text>
              </View>
              {canRemove ? (
                <Pressable
                  style={styles.more}
                  onPress={() =>
                    Alert.alert(o.title, undefined, [
                      ...(staff ? [{ text: o.source === "club" ? "Mark as shared by a member" : "Mark as posted by the club", onPress: () => void run(o.id, () => setOpenSource(o.id, o.source === "club" ? "member" : "club"), "Couldn't change it") }] : []),
                      { text: "Take it down", style: "destructive" as const, onPress: () => void run(o.id, () => removeOpen(o.id), "Couldn't take it down") },
                      { text: "Close", style: "cancel" as const },
                    ])
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Options"
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={colors.ink500} />
                </Pressable>
              ) : null}
            </View>
            <View style={styles.chips}>
              <Chip tone={o.source === "club" ? "ok" : "grey"}>{o.source === "club" ? "Posted by the club" : "Shared by a member"}</Chip>
              {others.length ? (
                <Pressable onPress={() => setOpen(expanded ? null : o.id)} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${others.length} need a partner. Show them`}>
                  <Chip tone="wait">{`${others.length} ${others.length === 1 ? "PinPal needs" : "PinPals need"} a partner`}</Chip>
                </Pressable>
              ) : null}
            </View>
            {expanded
              ? others.map((p) => (
                  <Pressable key={p.userId} style={styles.partner} onPress={() => router.push(`/member/${p.userId}`)} accessibilityRole="button" accessibilityLabel={`${p.name}${p.note ? `, ${p.note}` : ""}. Open their page`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.partnerName}>{p.name}</Text>
                      {p.note ? <Text style={styles.small}>{p.note}</Text> : null}
                    </View>
                    <Ionicons name="chatbubble-outline" size={18} color={colors.navy900} />
                  </Pressable>
                ))
              : null}
            <View style={styles.row}>
              <Button
                label={imIn ? "Found a partner" : "Need a partner"}
                tone="line"
                busy={busy === o.id}
                onPress={() =>
                  imIn
                    ? void run(o.id, () => setPartnerRequest(o.id, false, null), "Couldn't take you off")
                    : void run(o.id, () => setPartnerRequest(o.id, true, null), "Couldn't add you")
                }
                style={{ flex: 1 }}
              />
              {o.bookingUrl ? (
                <Button label="Book with club" icon="open-outline" tone="gold" onPress={() => void Linking.openURL(o.bookingUrl as string)} style={{ flex: 1 }} />
              ) : null}
            </View>
          </View>
        );
      })}

      <View style={styles.clubs}>
        <Text style={styles.clubsTitle}>Run a club?</Text>
        <Text style={styles.small}>Send your opens to info@pinpals.ie and we'll list them as posted by the club, with your own booking link.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  headerBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, minWidth: 44, paddingHorizontal: 6, justifyContent: "center" },
  headerBtnText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900 },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, lineHeight: 18 },
  card: { gap: 10, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  top: { flexDirection: "row", gap: 12 },
  date: { width: 54, borderRadius: radii.md, backgroundColor: colors.navy900, alignItems: "center", paddingVertical: 6 },
  dateMon: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.gold400 },
  dateDay: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  club: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  title: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  more: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  partner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: 12, borderRadius: radii.md, backgroundColor: colors.surfaceTint },
  partnerName: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  row: { flexDirection: "row", gap: spacing.sm },
  clubs: { gap: 4, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colors.gold500, marginTop: spacing.sm },
  clubsTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.navy900 },
});
