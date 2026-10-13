import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StateMessage } from "@/components/state-message";
import { Choices, Crumbs, LookFor, TONES, Tip, WhoBadge } from "@/components/guide-bits";
import { guideById, type GuideStep } from "@/lib/guide";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * One guide, one step per page. Swipe, or use Back and Next.
 *
 * A step shows where to go, what it looks like when you get there, and —
 * where the screen doesn't need a group picked first — a button that goes
 * straight there. The last page is the "done" page, offering the next guide.
 */
export default function GuideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const guide = guideById(String(id));
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  if (!guide) {
    return (
      <>
        <Stack.Screen options={{ title: "Guide", headerBackTitle: "Back" }} />
        <StateMessage icon="book-outline" title="This guide has moved" body="Open How-to guides from the menu to see them all." size="screen" />
      </>
    );
  }

  const tone = TONES[guide.tone];
  const total = guide.steps.length;
  const pages = total + 1; // + the "done" page
  const next = guide.next ? guideById(guide.next) : undefined;

  const goTo = (p: number) => {
    const clamped = Math.max(0, Math.min(pages - 1, p));
    pager.current?.scrollTo({ x: clamped * width, animated: true });
    setPage(clamped);
  };
  const onSwipe = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  const done = page >= total;

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: guide.title, headerBackTitle: "Back" }} />

      {/* Progress: a segment per step, filled up to this one. */}
      <View style={styles.progressWrap}>
        <View style={styles.progress} accessible accessibilityLabel={done ? "All steps done" : `Step ${page + 1} of ${total}`}>
          {guide.steps.map((_, i) => (
            <Pressable key={i} style={styles.segHit} onPress={() => goTo(i)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Go to step ${i + 1}`}>
              <View style={[styles.seg, i <= page && { backgroundColor: tone.bg }]} />
            </Pressable>
          ))}
        </View>
        <Text style={styles.progressText}>{done ? "Done" : `Step ${page + 1} of ${total}`}</Text>
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onSwipe}
        style={styles.fill}
      >
        {guide.steps.map((step, i) => (
          <StepPage key={i} step={step} n={i + 1} width={width} toneBg={tone.bg} toneInk={tone.ink} />
        ))}

        <ScrollView style={{ width }} contentContainerStyle={styles.page}>
          <View style={[styles.doneBadge, { backgroundColor: tone.bg }]}>
            <Ionicons name="checkmark" size={44} color={tone.ink} />
          </View>
          <Text style={styles.doneTitle}>That&apos;s it</Text>
          <Text style={styles.body}>{`You know how to ${guide.title.charAt(0).toLowerCase()}${guide.title.slice(1)}. Swipe back any time to check a step.`}</Text>
          {next ? (
            <Pressable style={styles.nextCard} onPress={() => router.replace({ pathname: "/guide/[id]", params: { id: next.id } })} accessibilityRole="button" accessibilityLabel={`Next guide: ${next.title}`}>
              <View style={[styles.nextIcon, { backgroundColor: TONES[next.tone].bg }]}>
                <Ionicons name={next.icon} size={22} color={TONES[next.tone].ink} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.nextKicker}>NEXT GUIDE</Text>
                <Text style={styles.nextTitle}>{next.title}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.ink500} />
            </Pressable>
          ) : null}
          <Pressable style={styles.allLink} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.allLinkText}>All guides</Text>
          </Pressable>
        </ScrollView>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Pressable style={[styles.navBtn, page === 0 && styles.navOff]} onPress={() => goTo(page - 1)} disabled={page === 0} accessibilityRole="button" accessibilityLabel="Previous step">
          <Ionicons name="chevron-back" size={20} color={colors.navy900} />
          <Text style={styles.navText}>Back</Text>
        </Pressable>
        {done ? (
          <Pressable style={[styles.navBtn, styles.navMain]} onPress={() => router.back()} accessibilityRole="button">
            <Text style={[styles.navText, styles.navMainText]}>Finish</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.navBtn, styles.navMain]} onPress={() => goTo(page + 1)} accessibilityRole="button" accessibilityLabel="Next step">
            <Text style={[styles.navText, styles.navMainText]}>Next</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.cream50} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function StepPage({ step, n, width, toneBg, toneInk }: { step: GuideStep; n: number; width: number; toneBg: string; toneInk: string }) {
  return (
    <ScrollView style={{ width }} contentContainerStyle={styles.page}>
      <View style={styles.head}>
        <View style={[styles.num, { backgroundColor: toneBg }]}>
          <Text style={[styles.numText, { color: toneInk }]}>{n}</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {step.title}
        </Text>
      </View>

      {step.path ? <Crumbs path={step.path} /> : null}
      {step.who ? <WhoBadge who={step.who} /> : null}
      <Text style={styles.body}>{step.body}</Text>
      {step.choices ? <Choices choices={step.choices} /> : null}
      {step.look ? <LookFor controls={step.look} /> : null}
      {step.tip ? <Tip text={step.tip} /> : null}
      {step.go ? (
        <Pressable style={styles.go} onPress={() => router.push(step.go!.to)} accessibilityRole="button" accessibilityHint="Opens that screen; come back here with Back.">
          <Ionicons name="navigate" size={17} color={colors.green700} />
          <Text style={styles.goText}>{`Take me there · ${step.go.label}`}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  progressWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: 6 },
  progress: { flexDirection: "row", gap: 5 },
  segHit: { flex: 1, paddingVertical: 4 },
  seg: { height: 5, borderRadius: 3, backgroundColor: colors.line },
  progressText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500 },

  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  num: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  numText: { fontFamily: fonts.display, fontSize: 22 },
  title: { flex: 1, fontFamily: fonts.display, fontSize: type.title + 2, lineHeight: 30, color: colors.navy900 },
  body: { fontFamily: fonts.body, fontSize: type.body + 1, lineHeight: 25, color: colors.ink900 },
  go: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.green700,
    backgroundColor: colors.surface,
  },
  goText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },

  doneBadge: { alignSelf: "center", width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginTop: spacing.lg },
  doneTitle: { fontFamily: fonts.display, fontSize: 30, color: colors.navy900, textAlign: "center" },
  nextCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  nextIcon: { width: 44, height: 44, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  nextKicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.ink500 },
  nextTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  allLink: { alignSelf: "center", padding: spacing.sm },
  allLinkText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },

  footer: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm + 4, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.cream50 },
  navBtn: { flex: 1, height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  navOff: { opacity: 0.4 },
  navMain: { backgroundColor: colors.green700, borderColor: colors.green700 },
  navText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  navMainText: { color: colors.cream50 },
});
