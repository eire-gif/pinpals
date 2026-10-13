import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSegments } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GoldButton } from "@/components/gold-button";
import {
  REOPEN_AFTER_MS,
  adsOf,
  pickWeighted,
  takeoverBlockedAt,
  takeoverDue,
  takeoverFits,
  type Ad,
  type TakeoverTrigger,
} from "@/lib/ads-rules";
import {
  adsOn,
  flushAdEvents,
  hiddenAdIds,
  lastTakeoverAt,
  logAdEvent,
  markTakeoverShown,
  onTakeoverRequest,
  openAd,
  refreshAds,
} from "@/lib/ads";
import { useAuth } from "@/lib/auth";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing } from "@/lib/theme";

/**
 * The full-screen takeover (0139, claude/advertising.md).
 *
 * <AdTakeoverHost /> sits once in the root layout. It fetches the member's
 * adverts at launch and when the app comes back after a while, and shows a
 * takeover on opening the app and/or after a round is certified — never
 * over signing in, onboarding, live scoring, the hole map, checkout or
 * scorecard entry (takeoverBlockedAt), never inside the gap since the last
 * one (checked here and by the server), and never to a member in their first
 * days (the server returns nothing). With the `ads` flag off it renders
 * nothing and fetches nothing.
 */
export function AdTakeoverHost() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const segments = useSegments() as string[];
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const [ad, setAd] = useState<Ad | null>(null);
  const showingRef = useRef(false);
  const adsRef = useRef<Ad[]>([]);
  const pending = useRef<TakeoverTrigger | null>(null);

  const tryShow = useCallback(async () => {
    const trigger = pending.current;
    if (!trigger || showingRef.current) return;
    if (takeoverBlockedAt(segmentsRef.current)) {
      // Opening the app straight into live scoring: skip this one rather
      // than pop up half an hour later. After a round: wait for a free screen.
      if (trigger === "app_open") pending.current = null;
      return;
    }
    pending.current = null;
    const hidden = await hiddenAdIds();
    const candidates = adsOf(adsRef.current, "takeover", hidden).filter((a) => takeoverFits(a, trigger));
    const choice = pickWeighted(candidates, Math.random());
    if (!choice) return;
    if (!takeoverDue(await lastTakeoverAt(), choice.takeoverGapHours, Date.now())) return;
    // Only show what has actually loaded: a blank navy screen with a countdown is worse than nothing.
    const ok = await Image.prefetch(choice.imageUrl).catch(() => false);
    if (!ok || showingRef.current || takeoverBlockedAt(segmentsRef.current)) return;
    showingRef.current = true;
    void markTakeoverShown();
    setAd(choice);
  }, []);

  // Launch, and coming back to the app after REOPEN_AFTER_MS away.
  useEffect(() => {
    if (!adsOn() || !userId) return;
    let backgroundedAt: number | null = null;
    const load = () =>
      void refreshAds(userId).then((ads) => {
        adsRef.current = ads;
        pending.current = pending.current ?? "app_open";
        void tryShow();
      });
    load();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        if (backgroundedAt != null && Date.now() - backgroundedAt >= REOPEN_AFTER_MS) load();
        backgroundedAt = null;
      } else if (s === "background") {
        backgroundedAt = Date.now();
        void flushAdEvents();
      }
    });
    return () => sub.remove();
  }, [userId, tryShow]);

  // After a round is certified (the certify screen calls requestTakeover).
  useEffect(
    () =>
      onTakeoverRequest((trigger) => {
        pending.current = trigger;
        setTimeout(() => void tryShow(), 1500);
      }),
    [tryShow]
  );

  // A waiting "after round" takeover goes when the member reaches a free screen.
  useEffect(() => {
    if (pending.current) void tryShow();
  }, [segments, tryShow]);

  if (!ad) return null;
  return (
    <AdTakeover
      ad={ad}
      onClose={() => {
        showingRef.current = false;
        setAd(null);
      }}
    />
  );
}

/** The takeover itself: the advert full screen, Sponsored top-left, a countdown that becomes the close button. */
export function AdTakeover({ ad, onClose }: { ad: Ad; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [left, setLeft] = useState<number>(ad.countdownSeconds);

  useEffect(() => {
    logAdEvent(ad.id, "view");
  }, [ad.id]);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const close = () => {
    if (left > 0) return;
    logAdEvent(ad.id, "dismiss");
    onClose();
  };
  const open = () => {
    void openAd(ad);
    onClose();
  };
  const photo = ad.displayStyle === "photo_headline";

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={close}>
      <View style={styles.screen}>
        <Pressable
          onPress={open}
          style={StyleSheet.absoluteFill}
          accessibilityRole="link"
          accessibilityLabel={`Advert from ${ad.advertiserName}${ad.headline ? `: ${ad.headline}` : ""}. Opens their website.`}
        >
          <Image source={{ uri: ad.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </Pressable>

        <View style={[styles.sponsored, { top: insets.top + spacing.sm + 4 }]} pointerEvents="none">
          <Text style={styles.sponsoredLabel}>SPONSORED</Text>
        </View>

        <View style={[styles.corner, { top: insets.top + spacing.sm }]}>
          {left > 0 ? (
            <View style={styles.ring} accessible accessibilityLabel={`Advert, closes in ${left} seconds`}>
              <Text style={styles.ringNumber}>{left}</Text>
            </View>
          ) : (
            <Pressable onPress={close} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close advert">
              <Ionicons name="close" size={24} color={colors.cream50} />
            </Pressable>
          )}
        </View>

        {photo ? (
          <View style={styles.bottom} pointerEvents="box-none">
            {/* Stacked veils rather than a gradient: a gradient is a native module (theme.ts). */}
            <View style={[styles.veil, { height: 320, backgroundColor: navyAlpha(0.35) }]} pointerEvents="none" />
            <View style={[styles.veil, { height: 230, backgroundColor: navyAlpha(0.45) }]} pointerEvents="none" />
            <View style={[styles.text, { paddingBottom: insets.bottom + spacing.lg }]} pointerEvents="box-none">
              {ad.headline ? <Text style={styles.headline}>{ad.headline}</Text> : null}
              {ad.body ? <Text style={styles.body}>{ad.body}</Text> : null}
              <GoldButton label={ad.buttonText ?? "Find out more"} onPress={open} style={{ marginTop: spacing.md }} />
              <Text style={styles.from}>{ad.advertiserName}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy900 },
  sponsored: {
    position: "absolute",
    left: spacing.md,
    backgroundColor: navyAlpha(0.7),
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sponsoredLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.4, color: colors.cream50 },
  corner: { position: "absolute", right: spacing.md },
  ring: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2.5,
    borderColor: colors.gold400,
    backgroundColor: navyAlpha(0.6),
    alignItems: "center",
    justifyContent: "center",
  },
  ringNumber: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: navyAlpha(0.7), alignItems: "center", justifyContent: "center" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  veil: { position: "absolute", left: 0, right: 0, bottom: 0 },
  text: { paddingHorizontal: spacing.lg },
  headline: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.cream50 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: creamAlpha(0.9), marginTop: spacing.sm },
  from: { fontFamily: fonts.body, fontSize: 12, color: creamAlpha(0.7), textAlign: "center", marginTop: spacing.sm },
});
