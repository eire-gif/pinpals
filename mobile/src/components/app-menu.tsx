import { useEffect, useRef } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  ImageBackground,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import Constants from "expo-constants";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { contactMailto, visibleMenu, type MenuItem } from "@/lib/menu";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Ballybunion rather than one of the sunsets: the panel slides over whatever
 * screen you were on, so it wants a photograph that reads instantly at 320pt
 * wide and in a fifth of a second, not one with a sun in it to squint at.
 * Same file the Tee times header uses — they are never on screen together.
 */
const DRAWER_SCENE = require("../../assets/images/scenes/ballybunion.jpg");

/**
 * The whole app, one tap from anywhere.
 *
 * Slides in from the left, because that is where the button is and a panel
 * that appears somewhere other than where you pressed feels like a different
 * app answering. The backdrop closes it, so does the back gesture, and so
 * does picking anything in it.
 *
 * Navigation happens AFTER the drawer has closed rather than alongside it:
 * pushing a screen while a modal is still animating out leaves iOS briefly
 * rendering both, which reads as a stutter on the one interaction that is
 * supposed to feel instant.
 */

const PANEL_WIDTH = Math.min(320, Dimensions.get("window").width * 0.86);
const DURATION = 220;

export function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut } = useAuth();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, slide]);

  /** Close first, act second. See the note above. */
  function closeThen(action: () => void) {
    onClose();
    setTimeout(action, DURATION);
  }

  function choose(item: MenuItem) {
    switch (item.kind) {
      case "native":
        closeThen(() => router.push(item.to));
        return;

      case "web":
        closeThen(() =>
          router.push({ pathname: "/web", params: { path: item.path, title: item.title } })
        );
        return;

      case "contact":
        closeThen(() => void openMail());
        return;

      case "signout":
        // The confirm is deliberate. Log out sits next to Contact us at the
        // bottom of a scrolling list, and signing someone out by a mis-tap
        // means making them find their password again.
        Alert.alert("Log out of PinPals?", undefined, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Log out",
            style: "destructive",
            onPress: () => closeThen(() => void signOut()),
          },
        ]);
        return;
    }
  }

  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.host}>
        <Animated.View
          style={[styles.backdrop, { opacity: slide }]}
          pointerEvents={open ? "auto" : "none"}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityLabel="Close menu"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            {
              transform: [
                {
                  translateX: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-PANEL_WIDTH, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <SafeAreaView style={styles.fill} edges={["top", "bottom"]}>
            {/* The drawer was navy from top to bottom, which was correct and
                joyless. The photograph behind the wordmark costs nothing —
                the bottom of every scene fades to exactly this navy, so the
                image reads as the top of the panel rather than as a picture
                stuck on it. */}
            <ImageBackground
              source={DRAWER_SCENE}
              style={styles.head}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            >
              <View style={styles.headRow}>
                <Text style={styles.brand}>PinPals</Text>
                <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close menu">
                  <Ionicons name="close" size={24} color={colors.cream50} />
                </Pressable>
              </View>
            </ImageBackground>

            <ScrollView
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
            >
              {visibleMenu().map((section) => (
                <View key={section.title} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {section.items.map((item) => (
                    <Pressable
                      key={item.label}
                      style={({ pressed }) => [styles.row, pressed && styles.rowOn]}
                      onPress={() => choose(item)}
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name={item.icon}
                        size={19}
                        color={item.kind === "signout" ? colors.red100 : colors.gold400}
                      />
                      <Text
                        style={[
                          styles.rowLabel,
                          item.kind === "signout" && styles.rowLabelOut,
                        ]}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))}

              <Text style={styles.version}>
                PinPals {Constants.expoConfig?.version ?? "0.1.0"}
              </Text>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Opens the member's own mail app with the address, a subject stub and the
 * build they are on already in it.
 *
 * canOpenURL first, and a plain message rather than a silent failure: a
 * device with no mail account configured will refuse the mailto, and
 * "nothing happened when I tapped Contact us" is a worse experience than
 * being told the address.
 */
async function openMail() {
  const url = contactMailto(
    String(Constants.expoConfig?.version ?? "0.1.0"),
    `${Platform.OS} ${Platform.Version}`
  );

  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // Falls through to the message below.
  }

  Alert.alert("Email us", "Send your message to info@pinpals.ie and we'll come back to you.");
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  fill: { flex: 1 },

  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(14,21,32,0.5)",
  },

  // Navy, not cream. The drawer is chrome rather than content, and the site's
  // own header is navy — this is the one surface in the app where the two
  // sit side by side often enough for the mismatch to show.
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: PANEL_WIDTH,
    backgroundColor: colors.navy900,
  },

  // The wordmark sits on the fade at the bottom of the photograph, which is
  // where that fade is at full strength — see tools/check-scene-contrast.py.
  head: { justifyContent: "flex-end", height: 132 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: 12,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 23,
    color: colors.cream50,
  },

  list: { paddingBottom: spacing.xl },

  section: { marginBottom: spacing.md },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.gold400,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 6,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  rowOn: { backgroundColor: "rgba(255,255,255,0.09)" },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: type.body,
    color: colors.cream50,
  },
  rowLabelOut: { color: colors.red100 },

  version: {
    fontFamily: fonts.body,
    fontSize: type.label,
    color: "rgba(247,243,234,0.5)",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
});

/** The three bars, for a screen header's left slot. */
export function MenuButton({ onPress, color = colors.green700 }: { onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={{ paddingHorizontal: spacing.md }}
      accessibilityRole="button"
      accessibilityLabel="Open menu"
    >
      <Ionicons name="menu" size={26} color={color} />
    </Pressable>
  );
}
