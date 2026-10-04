import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  InputAccessoryView,
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

import { colors, fonts, spacing } from "@/lib/theme";

/**
 * Keyboard handling, in one place (tester feedback, 4 Oct 2026: "you cannot
 * push the keyboard down, it gets in the way of the buttons").
 *
 * Three pieces, all React Native core — no native module, so this ships
 * over the air:
 *
 *   KEYBOARD_DISMISS_MODE  for every ScrollView / FlatList that holds a text
 *                          field: drag down and the keyboard follows your
 *                          finger away (iOS), or drops on drag (Android).
 *   KeyboardDoneBar        a "Done" bar above the keyboard for multi-line
 *                          fields, where Return adds a new line and so can't
 *                          close it. Give the field
 *                          inputAccessoryViewID={KEYBOARD_DONE_ID} and render
 *                          <KeyboardDoneBar /> once on the screen.
 *   KeyboardInset          keeps a bottom composer above the keyboard.
 *                          React Native's KeyboardAvoidingView mis-measures
 *                          inside an iOS sheet modal (it assumes the view
 *                          starts at the top of the screen), which left the
 *                          comment box under the keyboard. This measures the
 *                          view's real bottom edge and pads by exactly the
 *                          overlap, so it is right in a sheet, a pushed
 *                          screen or a tab alike.
 */

export const KEYBOARD_DISMISS_MODE = Platform.OS === "ios" ? ("interactive" as const) : ("on-drag" as const);

export const KEYBOARD_DONE_ID = "pinpals-keyboard-done";

export function KeyboardDoneBar() {
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View style={styles.bar}>
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide keyboard">
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

export function KeyboardInset({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const animate = (e: KeyboardEvent) => {
      if (Platform.OS === "ios" && e.duration) {
        LayoutAnimation.configureNext({
          duration: e.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
    };
    const show = (e: KeyboardEvent) => {
      const keyboardTop = e.endCoordinates.screenY;
      // Measure where this view's bottom edge really is on screen right now —
      // in a sheet modal it is not where a full-screen layout would put it.
      ref.current?.measureInWindow((_x, y, _w, h) => {
        // The view fills its space (flex: 1), so padding never moves its
        // bottom edge: y + h is the edge, whatever the current inset.
        const overlap = Math.max(0, Math.round(y + h - keyboardTop));
        animate(e);
        setInset(overlap);
      });
    };
    const hide = (e: KeyboardEvent) => {
      animate(e);
      setInset(0);
    };
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const subs = [
      Keyboard.addListener(showEvent, show),
      Keyboard.addListener(hideEvent, hide),
      // The keyboard changing height (emoji, predictive bar) re-measures.
      ...(Platform.OS === "ios" ? [Keyboard.addListener("keyboardWillChangeFrame", show)] : []),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return (
    <View ref={ref} style={[{ flex: 1 }, style, { paddingBottom: inset }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.cream100,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  done: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green700 },
});
