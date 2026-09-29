import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing } from "@/lib/theme";

/**
 * An emoji keyboard, written out by hand.
 *
 * WHY NOT A LIBRARY. Every emoji-picker package on npm either ships a native
 * module or pulls in a megabyte of Unicode data and its own font handling.
 * A native module is the expensive kind of dependency here: the app's
 * over-the-air updates only reach the existing TestFlight build while the
 * native fingerprint is unchanged, so adding one would mean a new build and
 * a new review for what is, in the end, a grid of characters. This file is
 * the grid of characters.
 *
 * It is also why there is no skin-tone picker, no search and no recents.
 * Those are real features and they are what the libraries are for; none of
 * them is what was asked for, and each would be carried forever.
 *
 * THE LIST IS DELIBERATELY SHORT. Roughly two hundred, chosen as the ones
 * people actually send, with golf first because this is a golf app and
 * "⛳" is the emoji this particular audience reaches for. A complete Unicode
 * table would be more correct and much worse to use: nobody scrolls three
 * thousand pictographs to find the thumbs-up.
 */

type Group = { name: string; icon: string; emoji: string[] };

const GROUPS: Group[] = [
  {
    name: "Golf",
    icon: "⛳",
    emoji: [
      "⛳", "🏌️", "🏌️‍♀️", "🏌️‍♂️", "🏆", "🥇", "🥈", "🥉", "🎯", "💪",
      "🔥", "👏", "🙌", "🤝", "☀️", "🌧️", "💨", "🌈", "⏰", "📅",
      "🚗", "🍺", "🍻", "☕", "🥪", "🧢", "👟", "🛒", "📍", "🗺️",
    ],
  },
  {
    name: "Smileys",
    icon: "😀",
    emoji: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
      "😉", "😊", "😇", "🥰", "😍", "😘", "😗", "😙", "😚", "😋",
      "😛", "😜", "🤪", "😝", "🤗", "🤭", "🤫", "🤔", "🤐", "😐",
      "😑", "😶", "😏", "😒", "🙄", "😬", "😌", "😔", "😪", "😴",
      "😷", "🤒", "🥳", "😎", "🤓", "🧐", "😕", "😟", "🙁", "😮",
      "😯", "😳", "🥺", "😢", "😭", "😤", "😠", "😡", "🤯", "😱",
    ],
  },
  {
    name: "People",
    icon: "👍",
    emoji: [
      "👍", "👎", "👌", "🤌", "✌️", "🤞", "🤟", "🤘", "👈", "👉",
      "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋", "🤙", "💪",
      "🙏", "🤝", "👏", "🙌", "👐", "🤲", "✍️", "💅", "👀", "🧠",
      "🫶", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔",
      "💯", "💢", "💥", "✨", "🎉", "🎊", "🎈", "🎁", "🔔", "📣",
    ],
  },
  {
    name: "Sport",
    icon: "⚽",
    emoji: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱",
      "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "🎽", "🛹",
      "🚴", "🏃", "🚶", "🧘", "🏊", "🤽", "🏄", "⛷️", "🎿", "🏂",
      "🎣", "🤿", "🥊", "🥋", "🎖️", "🏅", "🎗️", "🎟️", "🎫", "🎪",
    ],
  },
  {
    name: "Food",
    icon: "🍔",
    emoji: [
      "🍔", "🍟", "🍕", "🌭", "🥪", "🌮", "🌯", "🥗", "🍝", "🍜",
      "🍲", "🍛", "🍣", "🍤", "🍱", "🥟", "🍗", "🥩", "🥓", "🍳",
      "🥐", "🥖", "🧀", "🥞", "🧇", "🍞", "🍰", "🎂", "🧁", "🍪",
      "🍫", "🍬", "🍩", "🍦", "🍺", "🍻", "🍷", "🥂", "🥃", "🍸",
      "☕", "🍵", "🥤", "🧃", "💧", "🧊", "🍎", "🍌", "🍓", "🍇",
    ],
  },
  {
    name: "Places",
    icon: "🌍",
    emoji: [
      "🌍", "🌎", "🌏", "🗺️", "🧭", "🏔️", "⛰️", "🌋", "🏕️", "🏖️",
      "🏝️", "🏜️", "🏞️", "🌄", "🌅", "🌇", "🌆", "🌃", "🌌", "🌉",
      "🏡", "🏠", "🏢", "🏨", "🏪", "⛪", "🏰", "🗼", "⛲", "🌳",
      "🌲", "🌴", "🌵", "🍀", "🌿", "🌺", "🌻", "🌸", "💐", "🐕",
      "🐈", "🐦", "🦅", "🐟", "🦆", "🐝", "🦋", "🐇", "🦊", "🐴",
    ],
  },
  {
    name: "Symbols",
    icon: "✅",
    emoji: [
      "✅", "❌", "❓", "❗", "⚠️", "🚫", "♻️", "⭐", "🌟", "💫",
      "⚡", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "🔺",
      "🔻", "🔷", "🔶", "➡️", "⬅️", "⬆️", "⬇️", "🔁", "🔃", "🆗",
      "🆕", "🆙", "🔝", "💰", "💶", "💳", "🧾", "📦", "📮", "📱",
      "💻", "📷", "🎥", "🔑", "🔒", "⏳", "⌛", "🕐", "📌", "🔗",
    ],
  },
];

/**
 * Fixed height, and it matters. The tray opens in place of the keyboard, so
 * anything that changed height between groups would make the whole composer
 * jump while somebody is choosing — 244 is close enough to an iOS keyboard
 * that the transition reads as a swap rather than a resize.
 */
const TRAY_HEIGHT = 244;

export function EmojiTray({ onPick }: { onPick: (emoji: string) => void }) {
  const [group, setGroup] = useState(0);

  return (
    <View style={styles.tray}>
      <ScrollView
        contentContainerStyle={styles.grid}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {GROUPS[group].emoji.map((emoji, index) => (
          <Pressable
            // Index in the key because a character can legitimately repeat
            // across a group (💪 is in Golf and in People) and React would
            // otherwise drop one.
            key={`${emoji}-${index}`}
            onPress={() => onPick(emoji)}
            style={styles.cell}
            hitSlop={2}
            accessibilityRole="button"
            accessibilityLabel={`Emoji ${emoji}`}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.tabs}>
        {GROUPS.map((entry, index) => {
          const active = index === group;
          return (
            <Pressable
              key={entry.name}
              onPress={() => setGroup(index)}
              style={[styles.tab, active && styles.tabOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={entry.name}
            >
              <Text style={styles.tabIcon}>{entry.icon}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    height: TRAY_HEIGHT,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surfaceTint,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  // 12.5% — eight per row at any phone width, without measuring anything.
  cell: {
    width: "12.5%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // No fontFamily: the system emoji font is the only one that has these
  // glyphs, and naming Public Sans here would get every one of them replaced
  // with a tofu box.
  emoji: { fontSize: 27 },

  tabs: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  tabOn: { backgroundColor: colors.green100 },
  tabIcon: { fontSize: 19 },
});
