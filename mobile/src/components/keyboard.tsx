import { useEffect, useState, type ReactNode } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors, fonts, radii } from "@/lib/theme";

/**
 * Keyboard handling, in one place (tester feedback, 4 Oct 2026: "you cannot
 * push the keyboard down", "you cannot see the comment box").
 *
 * All React Native core plus safe-area-context (already in the binary), so
 * this ships over the air:
 *
 *   KEYBOARD_DISMISS_MODE  for every ScrollView / FlatList that holds a text
 *                          field: drag down and the keyboard follows your
 *                          finger away (iOS), or drops on drag (Android).
 *   FORM_SCROLL_KEYBOARD   for a form's ScrollView that has no
 *                          KeyboardAvoidingView around it: iOS insets the
 *                          content by the keyboard and scrolls the field
 *                          being typed in into view.
 *   KeyboardDoneButton     a small "Done" pill just above the keyboard, for
 *                          screens with multi-line fields (where Return adds
 *                          a line, so nothing else closes the keyboard).
 *                          Render it once, as a direct child of the screen's
 *                          outermost view. (The first version used iOS's
 *                          InputAccessoryView, which doesn't appear in this
 *                          app's React Native setup.)
 *   KeyboardInset          keeps a bottom composer above the keyboard on a
 *                          screen that reaches the bottom of the display
 *                          (the comments sheet, the post screen). It pads by
 *                          the keyboard's own height. Measuring the view
 *                          instead came back relative to the sheet, not the
 *                          screen, and left the comment box half-hidden.
 */

export const KEYBOARD_DISMISS_MODE = Platform.OS === "ios" ? ("interactive" as const) : ("on-drag" as const);

export const FORM_SCROLL_KEYBOARD = {
  keyboardDismissMode: KEYBOARD_DISMISS_MODE,
  keyboardShouldPersistTaps: "handled" as const,
  automaticallyAdjustKeyboardInsets: true,
};

/** The keyboard's height while it is up, 0 while it is down, animated with
 *  the keyboard on iOS. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const animate = (e: KeyboardEvent) => {
      if (Platform.OS === "ios" && e.duration) {
        LayoutAnimation.configureNext({ duration: e.duration, update: { type: LayoutAnimation.Types.keyboard } });
      }
    };
    const show = (e: KeyboardEvent) => {
      animate(e);
      setHeight(Math.round(e.endCoordinates.height));
    };
    const hide = (e: KeyboardEvent) => {
      animate(e);
      setHeight(0);
    };
    const subs =
      Platform.OS === "ios"
        ? [
            // iOS sends keyboardWillShow again when the keyboard changes
            // height (emoji, predictive bar), so that one listener covers it.
            Keyboard.addListener("keyboardWillShow", show),
            Keyboard.addListener("keyboardWillHide", hide),
          ]
        : [Keyboard.addListener("keyboardDidShow", show), Keyboard.addListener("keyboardDidHide", hide)];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return height;
}

/**
 * For a view whose bottom edge is the bottom of the display. Keyboard up:
 * pads by its height, so whatever sits at the bottom (a composer) rides on
 * top of it. Keyboard down: pads by the home-indicator inset, so the
 * composer isn't under the indicator either.
 */
export function KeyboardInset({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const keyboard = useKeyboardHeight();
  const { bottom } = useSafeAreaInsets();
  return <View style={[{ flex: 1 }, style, { paddingBottom: keyboard > 0 ? keyboard : bottom }]}>{children}</View>;
}

/** "Done", floating just above the keyboard on the right while it is up.
 *  Absolutely positioned against the screen's outermost view. */
export function KeyboardDoneButton() {
  const keyboard = useKeyboardHeight();
  if (keyboard === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: keyboard + 8 }]}>
      <Pressable
        onPress={() => Keyboard.dismiss()}
        hitSlop={8}
        style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel="Hide keyboard"
      >
        <Text style={styles.done}>Done</Text>
        <Ionicons name="chevron-down" size={14} color={colors.cream50} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", right: 12, alignItems: "flex-end" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    shadowColor: colors.navy900,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  done: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.cream50 },
});
