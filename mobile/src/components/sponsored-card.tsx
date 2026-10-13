import { useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Image, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { whyText, type Ad } from "@/lib/ads-rules";
import { hideAd, logAdEvent, openAd, useAdAudience } from "@/lib/ads";
import { countryName } from "@/lib/courses";
import { colors, fonts, navyAlpha, radii, spacing, type } from "@/lib/theme";

/**
 * A sponsored post in Social (0139): shaped like a member's post so it sits
 * in the list naturally, but labelled SPONSORED in the header and carrying
 * a link strip in place of reactions. ••• offers "Hide this advert" (this
 * phone, for good) and "Why am I seeing this?".
 */
export function SponsoredCard({ ad, width }: { ad: Ad; width: number }) {
  const [why, setWhy] = useState(false);
  const [gone, setGone] = useState(false);
  const where = useAdAudience();

  useEffect(() => {
    logAdEvent(ad.id, "view");
  }, [ad.id]);

  if (gone) return null;

  const image = ad.imageSquareUrl ?? ad.imageUrl;
  const photo = ad.displayStyle === "photo_headline";
  const hide = () => {
    setGone(true);
    void hideAd(ad.id);
  };
  const menu = () => {
    const options = ["Hide this advert", "Why am I seeing this?", "Cancel"];
    const choose = (i: number) => (i === 0 ? hide() : i === 1 ? setWhy(true) : undefined);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 2, destructiveButtonIndex: 0 }, choose);
    } else {
      Alert.alert("Sponsored", undefined, [
        { text: options[0], onPress: () => choose(0) },
        { text: options[1], onPress: () => choose(1) },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Avatar url={ad.advertiserLogoUrl} name={ad.advertiserName} color={colors.navy900} size={40} />
        <View style={styles.who}>
          <Text style={styles.name} numberOfLines={1}>
            {ad.advertiserName}
          </Text>
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>SPONSORED</Text>
          </View>
        </View>
        <Pressable onPress={menu} hitSlop={12} style={styles.more} accessibilityRole="button" accessibilityLabel="Advert options">
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.ink500} />
        </Pressable>
      </View>

      {photo && (ad.headline || ad.body) ? (
        <View style={styles.copy}>
          {ad.headline ? <Text style={styles.headline}>{ad.headline}</Text> : null}
          {ad.body ? <Text style={styles.body}>{ad.body}</Text> : null}
        </View>
      ) : null}

      <Pressable onPress={() => void openAd(ad)} accessibilityRole="link" accessibilityLabel={`Open ${ad.advertiserName}'s website`}>
        <Image source={{ uri: image }} style={{ width, height: width, backgroundColor: colors.cream100 }} resizeMode="cover" />
        <View style={styles.strip}>
          <Text style={styles.stripText} numberOfLines={1}>
            {hostOf(ad.linkUrl)}
          </Text>
          <View style={styles.button}>
            <Text style={styles.buttonLabel}>{(photo && ad.buttonText) || "Learn more"}</Text>
          </View>
        </View>
      </Pressable>

      <Modal visible={why} transparent animationType="slide" onRequestClose={() => setWhy(false)}>
        <Pressable style={styles.backdrop} onPress={() => setWhy(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>Why am I seeing this?</Text>
          <Text style={styles.sheetBody}>{whyText(ad, { countryName: where.country ? countryName(where.country) : null, county: where.county })}</Text>
          <Text style={styles.sheetSmall}>Adverts help keep PinPals free. You can hide any advert from its ••• menu.</Text>
          <Pressable onPress={() => setWhy(false)} style={styles.sheetButton} accessibilityRole="button">
            <Text style={styles.sheetButtonLabel}>OK</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

function hostOf(url: string): string {
  const m = /^https:\/\/([^/?#]+)/.exec(url);
  return (m?.[1] ?? url).replace(/^www\./, "");
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
    shadowColor: colors.navy900,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.md - 2 },
  who: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  chip: { alignSelf: "flex-start", backgroundColor: colors.cream100, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 1 },
  chipLabel: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 1.3, color: colors.gold500 },
  more: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -spacing.sm },
  copy: { paddingHorizontal: spacing.md - 2, paddingBottom: spacing.sm + 2, gap: 3 },
  headline: { fontFamily: fonts.display, fontSize: 18, color: colors.ink900 },
  body: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink900 },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surfaceTint,
  },
  stripText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink500 },
  button: { backgroundColor: colors.navy900, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  backdrop: { flex: 1, backgroundColor: navyAlpha(0.35) },
  sheet: { backgroundColor: colors.cream50, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, paddingBottom: spacing.xl + spacing.md, gap: spacing.sm },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: spacing.sm },
  sheetTitle: { fontFamily: fonts.display, fontSize: type.title, color: colors.ink900 },
  sheetBody: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink900 },
  sheetSmall: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  sheetButton: { marginTop: spacing.md, backgroundColor: colors.navy900, borderRadius: radii.pill, minHeight: 48, alignItems: "center", justifyContent: "center" },
  sheetButtonLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
