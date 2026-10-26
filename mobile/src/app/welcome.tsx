import { ImageBackground, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { PrimaryButton } from "@/components/join-ui";
import { colors, fonts } from "@/lib/theme";

/**
 * The first screen anyone sees after downloading the app.
 *
 * Its whole job is the first tap. Two buttons and three short promises — not
 * a swipeable tour, which most people skip and the rest forget. Join is gold
 * because it is the one thing this screen wants; "I already have an account"
 * is an outline so it is findable without competing.
 *
 * The photograph is bundled, unlike Home's hero which loads from the site:
 * this is the screen that shows before there is any reason to trust the
 * network, and a blank navy box as a first impression is worse than a few
 * hundred kilobytes in the binary.
 */
export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <ImageBackground
      source={require("../../assets/images/welcome-ballybunion.jpg")}
      style={styles.fill}
      imageStyle={styles.image}
      accessibilityLabel="The 10th hole at Ballybunion"
    >
      {/* Two flat layers rather than a gradient: a gradient means
          expo-linear-gradient, a native module, and therefore a new build
          for every member. The heavier lower layer is what the text sits on. */}
      <View style={styles.scrimAll} />
      <View style={styles.scrimLow} />

      <SafeAreaView style={styles.fill}>
        <View style={styles.brand}>
          <Ionicons name="flag-outline" size={24} color={colors.gold400} />
          <Text style={styles.wordmark}>PinPals</Text>
        </View>

        <View style={styles.bottom}>
          <View style={styles.eyebrowRow}>
            <View style={styles.rule} />
            <Text style={styles.eyebrow}>Golf community — Ireland &amp; the UK</Text>
          </View>

          <Text style={styles.title}>
            Find your{"\n"}
            <Text style={styles.titleAccent}>next fourball.</Text>
          </Text>

          <Text style={styles.lead}>
            Meet golfers at clubs near you, swap tee times, sell the gear you no
            longer use — and keep a record of every course you&apos;ve played.
          </Text>

          <View style={styles.points}>
            <Point icon="people-outline" label="Play together" />
            <Point icon="pricetags-outline" label="Buy & sell" />
            <Point icon="star-outline" label="Rate courses" />
          </View>

          <View style={styles.buttons}>
            <PrimaryButton
              tone="gold"
              label="Join PinPals — it's free"
              onPress={() => router.push("/signup")}
            />
            <PrimaryButton
              tone="outline"
              label="I already have an account"
              onPress={() => router.push("/login")}
            />
          </View>
          <Text style={styles.small}>Free to join · 18 and over · No card needed</Text>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

function Point({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.point}>
      <Ionicons name={icon} size={22} color={colors.gold400} />
      <Text style={styles.pointLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.navy900 },
  image: { resizeMode: "cover" },
  scrimAll: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(12,32,56,0.35)",
  },
  scrimLow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "62%",
    backgroundColor: "rgba(12,32,56,0.82)",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  wordmark: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50 },
  bottom: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 24, paddingBottom: 12 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rule: { width: 28, height: 2, backgroundColor: colors.gold500 },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.cream100,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 44,
    lineHeight: 48,
    color: colors.cream50,
    marginTop: 14,
  },
  titleAccent: { fontFamily: fonts.displayItalic, color: colors.gold400 },
  lead: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 24,
    color: colors.cream100,
    marginTop: 14,
  },
  points: { flexDirection: "row", gap: 8, marginTop: 20 },
  point: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(247,243,234,0.10)",
    borderWidth: 1,
    borderColor: "rgba(247,243,234,0.18)",
  },
  pointLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.cream50 },
  buttons: { gap: 10, marginTop: 22 },
  small: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.cream100,
    textAlign: "center",
    marginTop: 14,
  },
});
