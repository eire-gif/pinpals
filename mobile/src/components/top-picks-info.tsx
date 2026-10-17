import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { TOP_PICKS } from "@/lib/finder";
import { topPickUntil } from "@/lib/gear-finder";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * On your own advert: what Top picks is (0163, approved mock-up "Flow · App:
 * Boost your ad").
 *
 * Information only — no button, no link, no price. A place in Top picks is a
 * digital service, so under App Store rule 3.1.1 it's bought on the website,
 * never inside the app (not even its web view).
 */
export function TopPicksInfo({ listingId, featuredUntil }: { listingId: number; featuredUntil: string | null }) {
  const [until, setUntil] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void topPickUntil(listingId).then((u) => live && setUntil(u));
    return () => {
      live = false;
    };
  }, [listingId]);

  const plus = !!featuredUntil && Date.parse(featuredUntil) > Date.now();
  const ends = until ?? (plus ? featuredUntil : null);
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="arrow-up" size={16} color="#b6862a" />
        <Text style={styles.eyebrow}>{TOP_PICKS.title.toUpperCase()}</Text>
      </View>
      {ends ? (
        <>
          <Text style={styles.title}>{plus ? "Premium Plus" : "Premium"} — showing first</Text>
          <Text style={styles.body}>In {TOP_PICKS.title} until {date(ends)}, above the other listings for its club, brand and model.</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>Want it seen first?</Text>
          <Text style={styles.body}>
            {TOP_PICKS.title} sit above every other listing for the same club type, brand and model, with a gold {TOP_PICKS.badge} badge. Up
            to {TOP_PICKS.slots} show at once.
          </Text>
          <Text style={styles.web}>Adding it to {TOP_PICKS.title} is done on the PinPals website, from My listings.</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.md, borderRadius: radii.lg, borderWidth: 2, borderColor: colors.gold500, backgroundColor: colors.surface, padding: spacing.md, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: "#8a6a1f" },
  title: { fontFamily: fonts.display, fontSize: 19, color: colors.navy900 },
  body: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink900 },
  web: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500, marginTop: 2 },
});
