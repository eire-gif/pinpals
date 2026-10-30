import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadMyProfile } from "@/lib/profile";
import { closeWanted, loadMyWanted, loadWantedBoard, wantedLine, type WantedAd } from "@/lib/wanted";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Wanted ads (0203): yours (change or take down), and what other golfers are
 * looking for — in your county, or everywhere. Got one of them in the garage?
 * List it, and they're told.
 */
export default function WantedScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [mine, setMine] = useState<WantedAd[] | null | undefined>(undefined);
  const [board, setBoard] = useState<WantedAd[]>([]);
  const [county, setCounty] = useState<string | null>(null);
  const [everywhere, setEverywhere] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (all = everywhere) => {
      if (!me) return;
      try {
        const profile = await loadMyProfile(me).catch(() => null);
        const c = profile?.county ?? null;
        setCounty(c);
        const [m, b] = await Promise.all([loadMyWanted(me), loadWantedBoard(me, all ? null : c)]);
        setMine(m);
        setBoard(b);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    [me, everywhere]
  );
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isOn("wantedAds")) return <StateMessage size="screen" icon="search-outline" title="Wanted ads are on their way" />;
  if (failed && mine === undefined) return <LoadError size="screen" onRetry={() => void load()} what="wanted ads" />;
  if (mine === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (mine === null) return <StateMessage size="screen" icon="search-outline" title="Wanted ads are on their way" />;

  const open = mine.filter((w) => w.status === "open" && Date.parse(w.expiresAt) > Date.now());
  const takeDown = (w: WantedAd) =>
    Alert.alert("Take it down?", "Sellers stop being told about it.", [
      { text: "Keep it up", style: "cancel" },
      {
        text: "Take it down",
        style: "destructive",
        onPress: async () => {
          try {
            await closeWanted(w.id);
            await load();
          } catch (e) {
            Alert.alert("Couldn't take it down", e instanceof Error ? e.message : "Please try again.");
          }
        },
      },
    ]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.cream50 }}
      contentContainerStyle={styles.body}
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
      <Stack.Screen options={{ title: "Wanted" }} />
      <Pressable style={styles.post} onPress={() => router.push("/wanted/new")} accessibilityRole="button">
        <Ionicons name="add" size={20} color={colors.ink900} />
        <Text style={styles.postText}>Post a wanted ad</Text>
      </Pressable>

      <Text style={styles.section}>YOUR WANTED ADS</Text>
      {open.length === 0 ? (
        <Text style={styles.meta}>Looking for a 3-wood, a putter or a trolley? Post it — anything listed that fits comes straight to you.</Text>
      ) : (
        <View style={styles.card}>
          {open.map((w, i) => (
            <View key={w.id} style={[styles.row, i > 0 && styles.rowLine]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{w.category}</Text>
                <Text style={styles.meta}>{wantedLine(w)}</Text>
                <Text style={styles.small}>{`Up until ${new Date(w.expiresAt).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}`}</Text>
              </View>
              <Pressable onPress={() => router.push({ pathname: "/wanted/new", params: { id: String(w.id) } })} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Change it">
                <Ionicons name="create-outline" size={20} color={colors.navy800} />
              </Pressable>
              <Pressable onPress={() => takeDown(w)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Take it down">
                <Ionicons name="close-circle-outline" size={20} color={colors.red600} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
        <Text style={[styles.section, { flex: 1 }]}>{everywhere || !county ? "WANTED EVERYWHERE" : `WANTED IN ${county.toUpperCase()}`}</Text>
        {county ? (
          <Pressable
            onPress={() => {
              const next = !everywhere;
              setEverywhere(next);
              void load(next);
            }}
            accessibilityRole="button"
            style={{ minHeight: 40, justifyContent: "center" }}
          >
            <Text style={styles.link}>{everywhere ? `Just ${county}` : "Everywhere"}</Text>
          </Pressable>
        ) : null}
      </View>
      {board.length === 0 ? (
        <Text style={styles.meta}>Nobody&apos;s looking for anything here just now.</Text>
      ) : (
        <View style={styles.card}>
          {board.map((w, i) => (
            <View key={w.id} style={[styles.row, i > 0 && styles.rowLine]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(w.firstName ?? "?").charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{`${w.firstName ?? "A member"} wants: ${w.category.toLowerCase()}`}</Text>
                <Text style={styles.meta}>{wantedLine(w)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      {board.length > 0 ? (
        <Pressable style={styles.sell} onPress={() => router.push("/new-listing")} accessibilityRole="button">
          <Text style={styles.sellText}>Got one of these? List it — they&apos;re told</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  post: { flexDirection: "row", gap: 6, minHeight: 50, borderRadius: radii.md, backgroundColor: colors.buy500, alignItems: "center", justifyContent: "center" },
  postText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  section: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, color: colors.ink500 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, paddingVertical: 12 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 2 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green700 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  sell: { minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  sellText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900 },
});
