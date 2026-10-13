import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { guideById, resolveGuide, type Guide, type GuideChoice, type GuideControl, type GuideCrumb } from "@/lib/guide";
import { useGuideAudience } from "@/lib/guide-audience";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The pieces the how-to guides are drawn from (app/guide/*).
 *
 * The buttons here are pictures of the app's own buttons, in the same
 * colours and shapes, so a member who has just read "tap Start a group"
 * recognises it on the next screen. They are not pressable: a picture of a
 * button that does something different from the real one would be worse
 * than no picture.
 */

export const TONES: Record<Guide["tone"], { bg: string; ink: string; soft: string }> = {
  green: { bg: colors.green700, ink: colors.cream50, soft: colors.green100 },
  navy: { bg: colors.navy900, ink: colors.cream50, soft: "#e3e8f0" },
  gold: { bg: colors.gold500, ink: colors.navy900, soft: "#f6ecd2" },
};

/** "☰ Menu › Groups › Your group" */
export function Crumbs({ path }: { path: GuideCrumb[] }) {
  return (
    <View style={styles.crumbs} accessible accessibilityLabel={`Where: ${path.map((c) => c.label).join(", then ")}`}>
      {path.map((c, i) => (
        <View key={`${c.label}-${i}`} style={styles.crumbWrap}>
          {i > 0 ? <Ionicons name="chevron-forward" size={14} color={colors.ink500} /> : null}
          <View style={styles.crumb}>
            <Ionicons name={c.icon} size={14} color={colors.navy900} />
            <Text style={styles.crumbText}>{c.label}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** A picture of one control, drawn the way the app draws it. */
export function ControlMock({ control }: { control: GuideControl }) {
  const { style, label, icon } = control;
  if (style === "tile") {
    return (
      <View style={styles.tile}>
        {icon ? <Ionicons name={icon} size={20} color={colors.green800} /> : null}
        <Text style={styles.tileText}>{label}</Text>
      </View>
    );
  }
  if (style === "field") {
    return (
      <View style={styles.field}>
        {icon ? <Ionicons name={icon} size={16} color={colors.ink500} /> : null}
        <Text style={styles.fieldText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  }
  if (style === "link") {
    return (
      <View style={styles.linkWrap}>
        {icon ? <Ionicons name={icon} size={16} color={colors.green700} /> : null}
        <Text style={styles.link}>{label}</Text>
      </View>
    );
  }
  const primary = style === "primary";
  return (
    <View style={[styles.button, primary ? styles.buttonMain : styles.buttonPlain]}>
      {icon ? <Ionicons name={icon} size={17} color={primary ? colors.cream50 : colors.navy900} /> : null}
      <Text style={[styles.buttonText, primary && styles.buttonTextMain]}>{label}</Text>
    </View>
  );
}

/** "Look for" — a phone-screen panel holding the controls to find. */
export function LookFor({ controls }: { controls: GuideControl[] }) {
  return (
    <View style={styles.look} accessible accessibilityLabel={`Look for: ${controls.map((c) => c.label).join(", ")}`}>
      <View style={styles.lookHead}>
        <Ionicons name="eye-outline" size={14} color={colors.ink500} />
        <Text style={styles.kicker}>LOOK FOR</Text>
      </View>
      <View style={styles.lookBody}>
        {controls.map((c, i) => (
          <ControlMock key={`${c.label}-${i}`} control={c} />
        ))}
      </View>
    </View>
  );
}

/** Options as cards, the first one shown picked. */
export function Choices({ choices }: { choices: GuideChoice[] }) {
  return (
    <View style={styles.choices}>
      {choices.map((c, i) => (
        <View key={c.label} style={[styles.choice, i === 0 && styles.choiceOn]}>
          <View style={[styles.choiceIcon, i === 0 && styles.choiceIconOn]}>
            <Ionicons name={c.icon} size={20} color={i === 0 ? colors.cream50 : colors.navy900} />
          </View>
          <View style={styles.choiceBody}>
            <Text style={styles.choiceName}>{c.label}</Text>
            <Text style={styles.choiceBlurb}>{c.blurb}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function WhoBadge({ who }: { who: string }) {
  return (
    <View style={styles.who}>
      <Ionicons name="key-outline" size={14} color={colors.navy900} />
      <Text style={styles.whoText}>{who}</Text>
    </View>
  );
}

export function Tip({ text }: { text: string }) {
  return (
    <View style={styles.tip}>
      <Ionicons name="bulb" size={18} color={colors.gold500} />
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

/**
 * "New here? …" — a slim card for the screens where a first-timer is most
 * likely to be lost. With a guide id it opens that guide, written for the
 * member's saved choice of friends / trip / society; without one it opens
 * the guides page, where they choose.
 */
export function GuideLink({ id, lead = "New here?", title }: { id?: string; lead?: string; title?: string }) {
  const { audience } = useGuideAudience();
  const g = id ? guideById(id) : undefined;
  if (id && !g) return null;
  const resolved = g ? resolveGuide(g, audience ?? "society") ?? resolveGuide(g, "friends") : null;
  const tone = TONES[g?.tone ?? "green"];
  const label = title ?? (resolved ? `${resolved.title} · ${resolved.steps.length} quick steps` : "How-to guides");
  return (
    <Pressable
      style={({ pressed }) => [styles.guideLink, pressed && { opacity: 0.85 }]}
      onPress={() => (g ? router.push({ pathname: "/guide/[id]", params: { id: g.id } }) : router.push("/guide"))}
      accessibilityRole="button"
      accessibilityLabel={`${lead} ${label}`}
    >
      <View style={[styles.guideLinkIcon, { backgroundColor: tone.bg }]}>
        <Ionicons name="book" size={18} color={tone.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.guideLinkLead}>{lead}</Text>
        <Text style={styles.guideLinkTitle}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  guideLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: "dashed",
    backgroundColor: colors.surfaceTint,
  },
  guideLinkIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  guideLinkLead: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500 },
  guideLinkTitle: { fontFamily: fonts.bodyBold, fontSize: type.small + 0.5, color: colors.navy900 },

  crumbs: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: 6 },
  crumbWrap: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 4 },
  crumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  crumbText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.navy900 },

  look: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceTint, overflow: "hidden" },
  lookHead: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingTop: 10 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.ink500 },
  lookBody: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 14, alignItems: "center" },

  button: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 18, borderRadius: radii.pill, borderWidth: 1 },
  buttonMain: { backgroundColor: colors.green700, borderColor: colors.green700 },
  buttonPlain: { backgroundColor: colors.surface, borderColor: colors.line },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
  buttonTextMain: { color: colors.cream50 },
  tile: {
    width: 92,
    paddingVertical: 12,
    alignItems: "center",
    gap: 4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.green600,
    backgroundColor: colors.green100,
  },
  tileText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green800 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 130,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  fieldText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500 },
  linkWrap: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green700, textDecorationLine: "underline" },

  choices: { gap: spacing.sm },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  choiceOn: { borderWidth: 2, borderColor: colors.green600, backgroundColor: colors.green100 },
  choiceIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream100 },
  choiceIconOn: { backgroundColor: colors.green700 },
  choiceBody: { flex: 1, gap: 2 },
  choiceName: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  choiceBlurb: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, lineHeight: 19 },

  who: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: "#f6ecd2",
  },
  whoText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.navy900 },

  tip: { flexDirection: "row", gap: 10, padding: 14, borderRadius: radii.md, backgroundColor: colors.navy900 },
  tipText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.cream50 },
});
