import { useRef } from "react";
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Stack, router, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { RaisedCard, type RaisedTone } from "@/components/live-scoring-card";
import { useAgeAccess } from "@/lib/age";
import { SITE_URL } from "@/lib/config";
import { colors, fonts, radii, spacing } from "@/lib/theme";

// Every picture here is one the app already shows, so the guide looks like
// the screens it sends you to: Home's hero, the tee-times hero, the live
// hub's photo, the Groups header, a marketplace category photo.
const HERO_FALLBACK = require("../../assets/images/scenes/ballybunion.jpg");
const TEE_TIMES = require("../../assets/images/tee-times/hero.jpg");
const LIVE = require("../../assets/images/scenes/links-dusk.jpg");
const GROUPS = require("../../assets/images/scenes/coast-aerial.jpg");
const DRIVER = require("../../assets/images/marketplace/drivers.jpg");
const INTERLUDE = require("../../assets/images/scenes/old-head.jpg");
const CLOSE = require("../../assets/images/scenes/links-sunset.jpg");

/**
 * Explore — how PinPals works (Oct 2026, canvas board 9).
 *
 * Opened from "New here? Explore how PinPals works" on Home. A short guide
 * in four chapters — find golfers, live scoring, groups & societies, the
 * marketplace — each with a drawing of the real screen, three steps and the
 * big button that goes there. Then the rest of the clubhouse, and Get set up.
 *
 * The drawings are illustrations made of Views, not screenshots: they don't
 * go stale when a screen's data changes, and they need no network.
 */

type Icon = keyof typeof Ionicons.glyphMap;
type Step = { title: string; body: string };
type Chapter = {
  key: string;
  numeral: string;
  eyebrow: string;
  title: string;
  accent: string;
  lead: string;
  stage: string;
  art: () => React.ReactNode;
  steps: Step[];
  button: { tone: RaisedTone; icon: Icon; kicker?: string; title: string; subtitle: string; href: Href };
};

const NAVY = colors.navy900;
const GOLD = colors.gold400;

export default function ExploreScreen() {
  const scroll = useRef<ScrollView>(null);
  const tops = useRef<Record<string, number>>({});
  const { allows } = useAgeAccess();

  const chapters: Chapter[] = [
    {
      key: "find",
      numeral: "01",
      eyebrow: "Chapter one · Play",
      title: "Never short of a",
      accent: "fourball again.",
      lead: "Find golfers at your club and near you, connect, and fill each other's tee times — or slot into someone else's game.",
      stage: "#4c1a26",
      art: FindArt,
      steps: [
        { title: "Find golfers", body: "Golfers at your club and nearby, with their handicap and home club." },
        { title: "Connect", body: "Send a request — once they accept, you're PinPals." },
        { title: "Play together", body: "Post a tee time and your PinPals hear about it, or join theirs." },
      ],
      button: { tone: "claret", icon: "search", kicker: "Play", title: "Find Golfers", subtitle: "Golfers at your club and near you", href: "/members" },
    },
    {
      key: "score",
      numeral: "02",
      eyebrow: "Chapter two · Score",
      title: "Score it",
      accent: "together, live.",
      lead: "Pick a format, enter handicaps once and PinPals works out the shots. Everyone sees the leaderboard move as you play.",
      stage: "#14305c",
      art: ScoreArt,
      steps: [
        { title: "Pick a format", body: "Stableford, stroke play, foursomes, greensomes, matchplay or a scramble." },
        { title: "One game for the group", body: "Start it once and everyone joins — each scores on their own phone." },
        { title: "Certify and share", body: "A playing partner signs your card, then share the result." },
      ],
      button: { tone: "navy", icon: "flag", kicker: "Live scoring", title: "Start a Round", subtitle: "Try live scoring now", href: "/live" },
    },
    {
      key: "groups",
      numeral: "03",
      eyebrow: "Chapter three · Groups",
      title: "Your buddies and",
      accent: "your society.",
      lead: "Start Golf Buddies, a trip or a society. Plan outings, collect entries, and have 1st, 2nd and 3rd worked out — countbacks included — the moment the cards are in.",
      stage: "#1c2f22",
      art: GroupsArt,
      steps: [
        { title: "Start or join", body: "Golf Buddies, a golf trip or a society — societies can be found and joined." },
        { title: "Book the day", body: "Members take a place, pay the organiser, and the waiting list fills gaps." },
        { title: "Results in seconds", body: "The podium, countbacks and handicaps, shared with every member." },
      ],
      button: { tone: "green", icon: "people", kicker: "Societies & outings", title: "Groups & Societies", subtitle: "Find or start yours", href: "/groups" },
    },
    {
      key: "market",
      numeral: "04",
      eyebrow: "Chapter four · Marketplace",
      title: "Clubs in the garage?",
      accent: "Sell them.",
      lead: "List in a minute with a few photos. Offers show on the listing for everyone to see, and you pay each other in cash or by Revolut — no fees.",
      stage: "#3c2b0d",
      art: MarketArt,
      steps: [
        { title: "Snap and list", body: "A few photos, a price and a title — done in a minute." },
        { title: "Offers in the open", body: "Every offer shows on the listing; messages land in your Inbox." },
        { title: "Meet and pay", body: "Cash on collection or Revolut, then rate the seller." },
      ],
      button: { tone: "bronze", icon: "pricetag", kicker: "Buy & sell", title: "Marketplace", subtitle: "Browse or sell an item", href: "/marketplace" },
    },
  ];

  // Under 18s don't have Find PinPals — their guide starts at live scoring.
  const shown = allows("connections") ? chapters : chapters.filter((c) => c.key !== "find");

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <ScrollView ref={scroll} contentContainerStyle={styles.scroll}>
        {/* COVER */}
        {/* Home's own hero photograph, from the site (as on Home); the bundled
            Ballybunion scene shows until it loads. */}
        <ImageBackground
          source={{ uri: `${SITE_URL}/images/homepage-hero.jpg` }}
          defaultSource={HERO_FALLBACK}
          style={styles.hero}
          imageStyle={styles.cover}
        >
          <View style={[styles.veil, { backgroundColor: "rgba(10,18,34,0.35)" }]} />
          <View style={[styles.veilLow, { height: "65%", backgroundColor: "rgba(10,18,34,0.45)" }]} />
          <View style={[styles.veilLow, { height: "30%", backgroundColor: "rgba(10,18,34,0.4)" }]} />
          <View style={styles.frame} pointerEvents="none" />
          <View style={styles.heroBody}>
            <Rule label="The PinPals guide" />
            <Text style={styles.heroTitle}>
              Golf,{"\n"}
              <Text style={styles.heroAccent}>better together.</Text>
            </Text>
            <Text style={styles.heroLead}>Everything PinPals does, in four short chapters — from finding a fourball to lifting the society trophy.</Text>
            <Text style={styles.heroMeta}>{shown.length} chapters · 2 minute read</Text>
          </View>
        </ImageBackground>

        {/* CONTENTS */}
        <View style={styles.contents}>
          <Text style={styles.contentsLabel}>In this guide</Text>
          {shown.map((c, i) => (
            <Pressable
              key={c.key}
              style={({ pressed }) => [styles.tocRow, i === shown.length - 1 && styles.tocLast, pressed && styles.pressed]}
              onPress={() => scroll.current?.scrollTo({ y: (tops.current[c.key] ?? 0) - 8, animated: true })}
              accessibilityRole="button"
              accessibilityLabel={`Chapter ${c.numeral}: ${c.button.title}`}
            >
              <Text style={styles.tocNum}>{c.numeral}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.tocTitle}>{c.button.title}</Text>
                <Text style={styles.tocSub}>{c.button.kicker}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={GOLD} />
            </Pressable>
          ))}
        </View>

        {/* CHAPTERS */}
        {shown.map((c, i) => (
          <View key={c.key}>
            <View style={styles.chapter} onLayout={(e) => (tops.current[c.key] = e.nativeEvent.layout.y)}>
              <View style={styles.chapterHead}>
                <Text style={styles.numeral}>{c.numeral}</Text>
                <Text style={styles.chapterEyebrow}>{c.eyebrow}</Text>
              </View>
              <Text style={styles.chapterTitle}>
                {c.title} <Text style={styles.chapterAccent}>{c.accent}</Text>
              </Text>
              <Text style={styles.lead}>{c.lead}</Text>

              <Stage colour={c.stage}>{c.art()}</Stage>

              <View style={styles.steps}>
                {c.steps.map((s, n) => (
                  <View key={s.title} style={styles.step}>
                    <View style={styles.stepRail}>
                      <View style={styles.stepNum}>
                        <Text style={styles.stepNumText}>{n + 1}</Text>
                      </View>
                      {n < c.steps.length - 1 ? <View style={styles.stepLine} /> : null}
                    </View>
                    <View style={styles.stepBody}>
                      <Text style={styles.stepTitle}>{s.title}</Text>
                      <Text style={styles.stepText}>{s.body}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <RaisedCard
                inset={false}
                marginTop={4}
                tone={c.button.tone}
                icon={c.button.icon}
                kicker={c.button.kicker}
                title={c.button.title}
                subtitle={c.button.subtitle}
                wrapTitle
                onPress={() => router.push(c.button.href)}
              />
            </View>

            {/* A photograph between the scoring and groups chapters. */}
            {c.key === "score" ? (
              <ImageBackground source={INTERLUDE} style={styles.interlude} imageStyle={styles.cover}>
                <View style={[styles.veil, { backgroundColor: "rgba(10,18,34,0.3)" }]} />
                <View style={[styles.veilLow, { height: "60%", backgroundColor: "rgba(10,18,34,0.5)" }]} />
                <View style={styles.interludeBody}>
                  <Text style={styles.quoteMark}>“</Text>
                  <Text style={styles.quote}>Handicaps in once. Shots worked out. Leaderboard live.</Text>
                  <Text style={styles.quoteBy}>From the first tee to the 19th</Text>
                </View>
              </ImageBackground>
            ) : i < shown.length - 1 ? (
              <View style={styles.hr} />
            ) : null}
          </View>
        ))}

        {/* THE REST OF THE CLUBHOUSE */}
        <View style={styles.more}>
          <Rule label="Also on PinPals" />
          <Text style={styles.moreTitle}>
            The rest of the <Text style={styles.heroAccent}>clubhouse.</Text>
          </Text>
          <MoreRow icon="trophy" title="Competitions" sub="Matchplay leagues and open comps" href="/compete" />
          <MoreRow icon="library-outline" title="Game formats" sub="Every way to play, explained" href="/formats" />
          <MoreRow icon="barbell-outline" title="Training" sub="Tricky lies, putting drills, plans" href="/train" />
          <MoreRow icon="document-text-outline" title="Rules of Golf" sub="Plain-English answers, fast" href="/rules" />
          <MoreRow icon="help-buoy-outline" title="How-to guides" sub="Step by step, for every part of PinPals" href="/guide" last />
        </View>

        {/* CLOSE */}
        <View style={styles.closeWrap}>
          <ImageBackground source={CLOSE} style={styles.close} imageStyle={styles.closeImage}>
            <View style={[styles.veil, { backgroundColor: "rgba(10,18,34,0.25)" }]} />
            <View style={[styles.veilLow, { height: "65%", backgroundColor: "rgba(10,18,34,0.55)" }]} />
            <View style={styles.closeBody}>
              <Text style={styles.closeEyebrow}>You're all set</Text>
              <Text style={styles.closeTitle}>
                Golf is better{"\n"}
                <Text style={styles.heroAccent}>on PinPals.</Text>
              </Text>
              <Pressable onPress={() => router.push("/onboarding")} accessibilityRole="button" style={styles.goldOuter}>
                {({ pressed }) => (
                  <View style={[styles.goldLip, pressed && styles.goldLipPressed]}>
                    <View style={styles.goldFace}>
                      <Text style={styles.goldLabel}>Get set up</Text>
                    </View>
                  </View>
                )}
              </Pressable>
              <Pressable onPress={() => router.navigate("/")} hitSlop={10} accessibilityRole="button">
                <Text style={styles.backHome}>Back to Home</Text>
              </Pressable>
            </View>
          </ImageBackground>
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Rule({ label }: { label: string }) {
  return (
    <View style={styles.ruleRow}>
      <View style={styles.rule} />
      <Text style={styles.ruleLabel}>{label}</Text>
    </View>
  );
}

function MoreRow({ icon, title, sub, href, last }: { icon: Icon; title: string; sub: string; href: Href; last?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.moreRow, last && styles.moreLast, pressed && styles.pressed]} onPress={() => router.push(href)} accessibilityRole="button">
      <View style={styles.moreIcon}>
        <Ionicons name={icon} size={21} color={GOLD} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.moreRowTitle}>{title}</Text>
        <Text style={styles.moreRowSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={GOLD} />
    </Pressable>
  );
}

/** The coloured panel a chapter's phone sits in, rising from the bottom. */
function Stage({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <View style={[styles.stage, { backgroundColor: colour }]} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={styles.stageGlow} />
      <Text style={styles.stageLabel}>THE APP</Text>
      <View style={styles.phone}>
        <View style={styles.screen}>
          <View style={styles.notch} />
          {children}
        </View>
      </View>
    </View>
  );
}

function Face({ initials, colour, size = 26, ring }: { initials: string; colour: string; size?: number; ring?: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colour, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: ring ? GOLD : "#ffffff" }}>
      <Text style={{ color: "#ffffff", fontSize: size * 0.36, fontWeight: "700" }}>{initials}</Text>
    </View>
  );
}

/** A photo band with a gold kicker and title, as the app's headers have. */
function Photo({ source, kicker, title, height = 64 }: { source: number; kicker: string; title: string; height?: number }) {
  return (
    <ImageBackground source={source} style={{ height, borderRadius: 12, overflow: "hidden", justifyContent: "flex-end" }} imageStyle={{ borderRadius: 12, resizeMode: "cover" }}>
      <View style={[styles.veil, { backgroundColor: "rgba(10,18,34,0.45)" }]} />
      <View style={{ paddingHorizontal: 8, paddingBottom: 6 }}>
        <Text style={[art.k, { color: GOLD }]}>{kicker}</Text>
        <Text style={{ color: "#fff", fontFamily: fonts.display, fontSize: 14 }}>{title}</Text>
      </View>
    </ImageBackground>
  );
}

const mini: ViewStyle = { backgroundColor: "#ffffff", borderRadius: 12, borderWidth: 1, borderColor: colors.line };

function FindArt() {
  const people = [
    { i: "SÓ", c: "#16305a", n: "Seán Ó.", d: "Hcp 9 · your club" },
    { i: "AM", c: "#6f3340", n: "Aoife M.", d: "Hcp 14 · 6 km away" },
    { i: "NB", c: "#2e6644", n: "Niall B.", d: "Hcp 18 · your club" },
  ];
  return (
    <View style={{ paddingHorizontal: 12, gap: 8 }}>
      <Photo source={TEE_TIMES} kicker="PLAY" title="Find PinPals" />
      <View style={{ flexDirection: "row", gap: 5 }}>
        <Text style={[art.pill, art.pillOn]}>For you</Text>
        <Text style={art.pill}>My club</Text>
        <Text style={art.pill}>Nearby</Text>
      </View>
      {people.map((p) => (
        <View key={p.n} style={[mini, { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 }]}>
          <Face initials={p.i} colour={p.c} size={30} />
          <View style={{ flex: 1 }}>
            <Text style={art.b}>{p.n}</Text>
            <Text style={art.s}>{p.d}</Text>
          </View>
          <Text style={art.cta}>Connect</Text>
        </View>
      ))}
    </View>
  );
}

function ScoreArt() {
  const rows = [
    { p: "1", i: "SÓ", c: "#16305a", n: "Seán", pts: "29" },
    { p: "2", i: "YOU", c: "#2e6644", n: "You ▲1", pts: "27", me: true },
    { p: "3", i: "NB", c: "#6f3340", n: "Niall", pts: "24" },
  ];
  return (
    <View style={{ paddingHorizontal: 10, gap: 8 }}>
      <Photo source={LIVE} kicker="SCORE IT TOGETHER" title="Saturday fourball" height={54} />
      <View style={{ borderRadius: 12, backgroundColor: NAVY, borderWidth: 1.5, borderColor: colors.gold500, padding: 9, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View>
          <Text style={[art.k, { color: GOLD }]}>HOLE 13</Text>
          <Text style={{ color: colors.cream50, fontSize: 15, fontWeight: "800" }}>Par 4 · SI 7</Text>
        </View>
        <Text style={{ color: GOLD, fontSize: 9, fontWeight: "700", textAlign: "right" }}>Stableford{"\n"}1 shot here</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12 }}>
        <Text style={art.step}>−</Text>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: colors.green100 }}>
          <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800" }}>4</Text>
        </View>
        <Text style={art.step}>+</Text>
      </View>
      <Text style={{ textAlign: "center", fontSize: 10, fontWeight: "800", color: colors.green700 }}>Net par · 2 points</Text>
      <View style={[mini, { overflow: "hidden" }]}>
        <Text style={[art.k, { color: "#8a6a1f", padding: 7, borderBottomWidth: 1, borderBottomColor: "#eee6d4" }]}>LEADERBOARD · THRU 13</Text>
        {rows.map((r) => (
          <View key={r.p} style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: r.me ? "#fbf3dc" : "transparent" }}>
            <Text style={[art.b, { width: 10 }]}>{r.p}</Text>
            <Face initials={r.i === "YOU" ? "GW" : r.i} colour={r.c} size={20} />
            <Text style={[art.s, { flex: 1, color: colors.ink900, fontWeight: r.me ? "800" : "400" }]}>{r.n}</Text>
            <Text style={art.b}>{r.pts}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function GroupsArt() {
  return (
    <View style={{ paddingHorizontal: 10, gap: 8 }}>
      <Photo source={GROUPS} kicker="SOCIETY OUTING · SAT" title="Autumn Outing" height={80} />
      <View style={{ flexDirection: "row", gap: 5 }}>
        {[
          ["18", "GOING"],
          ["2", "PLACES"],
          ["€", "REVOLUT"],
        ].map(([v, l]) => (
          <View key={l} style={[mini, { flex: 1, alignItems: "center", paddingVertical: 6 }]}>
            <Text style={{ fontSize: 14, fontWeight: "800", color: l === "REVOLUT" ? colors.green700 : colors.ink900 }}>{v}</Text>
            <Text style={[art.k, { color: colors.ink500 }]}>{l}</Text>
          </View>
        ))}
      </View>
      <View style={[mini, { padding: 8, gap: 6 }]}>
        <Text style={[art.k, { color: "#8a6a1f" }]}>RESULTS · STABLEFORD</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 6 }}>
          {[
            { h: 34, c: "#c8ccd4", t: "38", f: "SÓ", fc: "#16305a" },
            { h: 50, c: GOLD, t: "39", f: "GW", fc: "#2e6644" },
            { h: 26, c: "#c69469", t: "38*", f: "NB", fc: "#6f3340" },
          ].map((b) => (
            <View key={b.t + b.f} style={{ alignItems: "center", gap: 3 }}>
              <Face initials={b.f} colour={b.fc} size={22} ring />
              <View style={{ width: 46, height: b.h, backgroundColor: b.c, borderTopLeftRadius: 7, borderTopRightRadius: 7, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: NAVY }}>{b.t}</Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={[art.s, { textAlign: "center", fontSize: 8 }]}>*Decided on countback · back 9</Text>
      </View>
    </View>
  );
}

function MarketArt() {
  return (
    <View style={{ paddingHorizontal: 10, gap: 8 }}>
      <ImageBackground source={DRIVER} style={{ height: 104, borderRadius: 12, overflow: "hidden" }} imageStyle={{ borderRadius: 12, resizeMode: "cover" }}>
        <Text style={[art.pill, art.pillOn, { position: "absolute", left: 8, top: 8 }]}>USED · DUBLIN</Text>
      </ImageBackground>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <View>
          <Text style={art.b}>Driver, regular flex</Text>
          <Text style={art.s}>Seller ★ 4.9 · 12 sales</Text>
        </View>
        <Text style={{ fontFamily: fonts.display, fontSize: 18, color: colors.green700 }}>€150</Text>
      </View>
      <View style={[mini, { overflow: "hidden" }]}>
        <Text style={[art.k, { color: "#8a6a1f", padding: 7, borderBottomWidth: 1, borderBottomColor: "#eee6d4" }]}>OFFERS · VISIBLE TO ALL</Text>
        {[
          ["SÓ", "#16305a", "Seán", "€130"],
          ["AM", "#6f3340", "Aoife", "€120"],
        ].map(([i, c, n, v]) => (
          <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 8, paddingVertical: 5 }}>
            <Face initials={i} colour={c} size={20} />
            <Text style={[art.s, { flex: 1, color: colors.ink900 }]}>{n}</Text>
            <Text style={art.b}>{v}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Text style={[art.btn, { backgroundColor: colors.green700, color: "#fff" }]}>Make an offer</Text>
        <Text style={[art.btn, { backgroundColor: "#fff", color: colors.ink900, borderWidth: 1, borderColor: colors.line }]}>Message</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

const art = StyleSheet.create({
  h: { fontFamily: fonts.display, fontSize: 18, color: colors.ink900 },
  k: { fontSize: 8, fontWeight: "800", letterSpacing: 1.2 },
  b: { fontSize: 11, fontWeight: "800", color: colors.ink900 },
  s: { fontSize: 9.5, color: colors.ink500 },
  pill: { fontSize: 9, fontWeight: "700", color: colors.ink900, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" },
  pillOn: { backgroundColor: NAVY, color: GOLD, borderColor: NAVY },
  cta: { fontSize: 9, fontWeight: "800", color: "#fff", backgroundColor: colors.green700, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, overflow: "hidden" },
  step: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff", textAlign: "center", lineHeight: 32, fontSize: 18, fontWeight: "700", color: colors.ink900, overflow: "hidden" },
  btn: { flex: 1, textAlign: "center", fontSize: 10, fontWeight: "800", borderRadius: 999, paddingVertical: 8, overflow: "hidden" },
});

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: NAVY },
  scroll: { paddingBottom: 0 },
  pressed: { opacity: 0.8 },
  cover: { resizeMode: "cover" },
  veil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  veilLow: { position: "absolute", left: 0, right: 0, bottom: 0 },

  hero: { minHeight: 520, justifyContent: "flex-end", backgroundColor: NAVY },
  frame: { position: "absolute", top: 12, left: 12, right: 12, bottom: 12, borderRadius: 24, borderWidth: 1, borderColor: "rgba(232,196,107,0.55)" },
  heroBody: { paddingHorizontal: 30, paddingBottom: 40, gap: 14 },
  heroTitle: { fontFamily: fonts.display, fontSize: 44, lineHeight: 48, color: colors.cream50 },
  heroAccent: { fontFamily: fonts.displayItalic, color: GOLD },
  heroLead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: "rgba(247,243,234,0.9)" },
  heroMeta: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, color: GOLD },

  ruleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rule: { width: 26, height: 2, backgroundColor: GOLD },
  ruleLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2.4, textTransform: "uppercase", color: GOLD },

  contents: { backgroundColor: NAVY, paddingHorizontal: 26, paddingBottom: 36, paddingTop: 6 },
  contentsLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2.4, textTransform: "uppercase", color: "#9aa6bc", paddingVertical: 14 },
  tocRow: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 16, borderTopWidth: 1, borderTopColor: "rgba(216,184,101,0.28)" },
  tocLast: { borderBottomWidth: 1, borderBottomColor: "rgba(216,184,101,0.28)" },
  tocNum: { fontFamily: fonts.display, fontSize: 28, color: GOLD, width: 42 },
  tocTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.cream50 },
  tocSub: { fontFamily: fonts.body, fontSize: 13, color: "#9aa6bc" },

  chapter: { backgroundColor: colors.cream50, paddingHorizontal: 20, paddingTop: 48, paddingBottom: 44, gap: 16 },
  chapterHead: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  numeral: { fontFamily: fonts.display, fontSize: 84, lineHeight: 84, color: GOLD, opacity: 0.55 },
  chapterEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#8a6a1f", paddingBottom: 14 },
  chapterTitle: { fontFamily: fonts.display, fontSize: 31, lineHeight: 36, color: colors.ink900 },
  chapterAccent: { fontFamily: fonts.displayItalic, color: "#8a6a1f" },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 25, color: "#3e4757" },

  stage: { height: 340, borderRadius: 28, overflow: "hidden", alignItems: "center", borderWidth: 1, borderColor: "rgba(232,196,107,0.6)" },
  stageGlow: { position: "absolute", top: -120, width: 420, height: 300, borderRadius: 210, backgroundColor: "rgba(255,255,255,0.08)" },
  stageLabel: { position: "absolute", left: 18, top: 16, fontSize: 10, fontWeight: "800", letterSpacing: 2.2, color: GOLD },
  phone: { position: "absolute", top: 36, width: 236, height: 420, borderRadius: 40, backgroundColor: "#0a1222", padding: 7, borderWidth: 1.5, borderColor: "rgba(232,196,107,0.55)" },
  screen: { flex: 1, borderRadius: 33, backgroundColor: colors.cream50, overflow: "hidden" },
  notch: { width: 70, height: 18, borderRadius: 10, backgroundColor: "#0a1222", alignSelf: "center", marginTop: 7, marginBottom: 8 },

  steps: { paddingTop: 4 },
  step: { flexDirection: "row", gap: 14 },
  stepRail: { alignItems: "center", width: 38 },
  stepNum: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: colors.gold500, backgroundColor: colors.surfaceTint, alignItems: "center", justifyContent: "center" },
  stepNumText: { fontSize: 15, fontWeight: "800", color: "#8a6a1f" },
  stepLine: { flex: 1, width: 2, backgroundColor: "#e2cf9c", marginVertical: 2 },
  stepBody: { flex: 1, paddingBottom: 18, paddingTop: 2 },
  stepTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  stepText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink500, marginTop: 3 },

  hr: { height: 1, backgroundColor: colors.gold500, opacity: 0.5, marginHorizontal: 40 },

  interlude: { height: 360, justifyContent: "flex-end", backgroundColor: NAVY },
  interludeBody: { paddingHorizontal: 30, paddingBottom: 36, gap: 8 },
  quoteMark: { fontFamily: fonts.display, fontSize: 64, lineHeight: 56, color: GOLD },
  quote: { fontFamily: fonts.displayItalic, fontSize: 26, lineHeight: 32, color: colors.cream50 },
  quoteBy: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: GOLD, marginTop: 6 },

  more: { backgroundColor: NAVY, paddingHorizontal: 26, paddingTop: 52, paddingBottom: 36, gap: 0 },
  moreTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.cream50, marginTop: 12, marginBottom: 18 },
  moreRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, borderTopWidth: 1, borderTopColor: "rgba(216,184,101,0.25)" },
  moreLast: { borderBottomWidth: 1, borderBottomColor: "rgba(216,184,101,0.25)" },
  moreIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  moreRowTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  moreRowSub: { fontFamily: fonts.body, fontSize: 13, color: "#9aa6bc" },

  closeWrap: { backgroundColor: NAVY, padding: spacing.md, paddingBottom: 48 },
  close: { height: 420, justifyContent: "flex-end", borderRadius: 28, overflow: "hidden", borderWidth: 1, borderColor: "rgba(232,196,107,0.6)" },
  closeImage: { resizeMode: "cover", borderRadius: 28 },
  closeBody: { padding: 22, gap: 14, alignItems: "stretch" },
  closeEyebrow: { textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2.4, textTransform: "uppercase", color: GOLD },
  closeTitle: { textAlign: "center", fontFamily: fonts.display, fontSize: 34, lineHeight: 38, color: colors.cream50 },
  backHome: { textAlign: "center", fontFamily: fonts.bodySemi, fontSize: 15, color: "rgba(247,243,234,0.85)", marginTop: 2 },

  goldOuter: { borderRadius: radii.pill, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 7, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  goldLip: { borderRadius: radii.pill, backgroundColor: "#9c7a2c", paddingBottom: 3 },
  goldLipPressed: { paddingBottom: 0, marginTop: 3 },
  goldFace: { minHeight: 56, borderRadius: radii.pill, backgroundColor: GOLD, borderWidth: 1, borderColor: "#f6dc97", alignItems: "center", justifyContent: "center" },
  goldLabel: { color: NAVY, fontSize: 18, fontWeight: "800" },
});
