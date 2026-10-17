import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { FORM_SCROLL_KEYBOARD } from "@/components/keyboard";
import {
  CashError,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_TAG_LABELS,
  TAGS_FOR,
  declineSale,
  leaveFeedback,
  saleSummary,
  type FeedbackTag,
  type SaleSummary,
} from "@/lib/marketplace-cash";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Leave feedback (mock-up 7). One per side per sale.
 *
 * Good / Not good, a few tap-on tags, an optional comment. It shows on the
 * other person's marketplace page only — never their golf profile — and stays
 * hidden until they've left theirs or a week passes, so nobody writes theirs
 * in reply. The buyer can also say "That wasn't me" if the seller picked the
 * wrong person; that closes it for both.
 */
export default function FeedbackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const saleId = Number.parseInt(String(id), 10);

  const [sale, setSale] = useState<SaleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [positive, setPositive] = useState<boolean | null>(null);
  const [tags, setTags] = useState<Set<FeedbackTag>>(new Set());
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(saleId)) {
      setLoading(false);
      return;
    }
    try {
      setSale(await saleSummary(saleId));
    } catch {
      setSale(null);
    } finally {
      setLoading(false);
    }
  }, [saleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    if (positive === null) {
      setError("Choose Good or Not good first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await leaveFeedback(saleId, positive, [...tags], body);
      setSent(true);
    } catch (err) {
      setError(err instanceof CashError ? err.message : "Couldn't send that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function notMe() {
    Alert.alert(
      "You didn't buy this?",
      "We'll let the seller know it wasn't you, and feedback for this sale closes.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "It wasn't me",
          style: "destructive",
          onPress: () =>
            void declineSale(saleId)
              .then(() => router.back())
              .catch((err) => setError(err instanceof CashError ? err.message : "Couldn't do that just now.")),
        },
      ]
    );
  }

  const header = <Stack.Screen options={{ title: "Feedback", headerBackTitle: "Back" }} />;

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        {header}
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  if (!sale || !sale.other) {
    return (
      <Closed header={header} title="Nothing to review" body="This sale isn't one you can leave feedback on." />
    );
  }

  const otherFirst = sale.other.name.split(" ")[0];
  const theirRole = sale.myRole === "seller" ? "buyer" : "seller";
  const closed = Date.parse(sale.closesAt) < Date.now();

  if (sale.declined) {
    return <Closed header={header} title="Feedback closed" body={sale.myRole === "seller" ? `${otherFirst} said they didn't buy this.` : "You said you didn't buy this."} />;
  }

  if (sent || sale.iLeft) {
    return (
      <Closed
        header={header}
        icon="checkmark-circle"
        title="Thanks — feedback sent"
        body={
          sale.theyLeft
            ? `You'll both see each other's feedback now.`
            : `It shows on ${otherFirst}'s marketplace page once they leave theirs, or in 7 days.`
        }
        action={{ label: `See ${otherFirst}'s page`, onPress: () => router.replace({ pathname: "/seller/[id]", params: { id: sale.other!.id } }) }}
      />
    );
  }

  if (closed) {
    return <Closed header={header} title="Feedback closed" body="Feedback stays open for 30 days after a sale." />;
  }

  return (
    <View style={styles.fill}>
      {header}
      <ScrollView contentContainerStyle={styles.content} {...FORM_SCROLL_KEYBOARD}>
        <View style={styles.who}>
          <Avatar url={sale.other.avatarUrl} color={sale.other.avatarColor} name={sale.other.name} size={72} />
          <Text style={styles.title}>
            How was {sale.myRole === "buyer" ? "buying from" : "selling to"} {otherFirst}?
          </Text>
          <Text style={styles.item} numberOfLines={1}>
            {sale.title}
          </Text>
          {sale.theyLeft ? <Text style={styles.waiting}>{otherFirst} has left theirs — leave yours to see it.</Text> : null}
        </View>

        <View style={styles.thumbs}>
          <Thumb up on={positive === true} onPress={() => setPositive(true)} />
          <Thumb up={false} on={positive === false} onPress={() => setPositive(false)} />
        </View>

        <View style={{ gap: 10 }}>
          <Text style={styles.label}>
            {positive === false ? "Anything that was still fine?" : "What went well?"} <Text style={styles.optional}>Tap any</Text>
          </Text>
          <View style={styles.tags}>
            {TAGS_FOR[theirRole].map((tag) => {
              const on = tags.has(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() =>
                    setTags((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(tag);
                      else next.add(tag);
                      return next;
                    })
                  }
                  style={[styles.tag, on && styles.tagOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Text style={[styles.tagText, on && styles.tagTextOn]}>{FEEDBACK_TAG_LABELS[tag]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>
            Add a comment <Text style={styles.optional}>Optional</Text>
          </Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={FEEDBACK_MAX_LENGTH}
            style={styles.comment}
            placeholder={sale.myRole === "buyer" ? "Met at the club, exactly as described." : "Paid on the day, easy to deal with."}
            placeholderTextColor={colors.ink500}
            accessibilityLabel="Comment"
          />
        </View>

        <Text style={styles.small}>
          Shows on {otherFirst}'s marketplace page only. Hidden until {otherFirst} leaves theirs, or after 7 days.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable onPress={() => void send()} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.gold400} /> : <Text style={styles.primaryLabel}>Send feedback</Text>}
        </Pressable>

        {sale.myRole === "buyer" ? (
          <Pressable onPress={notMe} hitSlop={8} style={styles.notMe} accessibilityRole="button">
            <Text style={styles.notMeText}>I didn't buy this</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Thumb({ up, on, onPress }: { up: boolean; on: boolean; onPress: () => void }) {
  const tint = on ? (up ? colors.green700 : colors.red600) : colors.ink900;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.thumb, on && (up ? styles.thumbGood : styles.thumbBad)]}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={up ? "Good" : "Not good"}
    >
      <Ionicons name={up ? (on ? "thumbs-up" : "thumbs-up-outline") : on ? "thumbs-down" : "thumbs-down-outline"} size={32} color={tint} />
      <Text style={[styles.thumbText, { color: tint }]}>{up ? "Good" : "Not good"}</Text>
    </Pressable>
  );
}

function Closed({
  header,
  title,
  body,
  icon = "information-circle-outline",
  action,
}: {
  header: ReactElement;
  title: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={[styles.fill, styles.centre, { padding: spacing.lg, gap: spacing.sm }]}>
      {header}
      <Ionicons name={icon} size={46} color={icon === "checkmark-circle" ? colors.green700 : colors.ink500} />
      <Text style={styles.closedTitle}>{title}</Text>
      <Text style={styles.closedBody}>{body}</Text>
      {action ? (
        <Pressable onPress={action.onPress} style={[styles.secondary, { marginTop: spacing.sm }]} accessibilityRole="button">
          <Text style={styles.secondaryLabel}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  who: { alignItems: "center", gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 25, lineHeight: 31, color: colors.navy900, textAlign: "center" },
  item: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  waiting: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green700, textAlign: "center" },
  thumbs: { flexDirection: "row", gap: 12 },
  thumb: { flex: 1, height: 110, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: 6 },
  thumbGood: { borderWidth: 2, borderColor: colors.green700, backgroundColor: colors.green100 },
  thumbBad: { borderWidth: 2, borderColor: colors.red600, backgroundColor: colors.red100 },
  thumbText: { fontFamily: fonts.bodyBold, fontSize: type.body },
  label: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  optional: { fontFamily: fonts.body, color: colors.ink500 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { minHeight: 40, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  tagOn: { borderColor: colors.green700, backgroundColor: colors.green100 },
  tagText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  tagTextOn: { color: colors.green800 },
  comment: { minHeight: 90, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 12, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, textAlignVertical: "top" },
  small: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500, textAlign: "center" },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  primary: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.gold400 },
  notMe: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
  notMeText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500, textDecorationLine: "underline" },
  closedTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900, textAlign: "center" },
  closedBody: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink500, textAlign: "center" },
  secondary: { minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.navy900, justifyContent: "center" },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900 },
});
