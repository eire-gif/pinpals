import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  OFFER_STATUS_LABELS,
  OFFER_STATUS_TONE,
  euros,
  offerLine,
  shortAgo,
  type ThreadEntry,
  type ThreadReply,
  type ThreadSummary,
} from "@/lib/listing-thread";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * The public questions & offers thread (0162), as the app draws it: the
 * summary bar (asking · highest offer · offers), each question or offer with
 * the replies under it, and the buttons each person gets — the seller
 * answers offers and questions, a buyer withdraws their own offer.
 */

const TONE = {
  good: { bg: colors.green100, fg: colors.green800 },
  bad: { bg: colors.red100, fg: colors.red600 },
  wait: { bg: "#f6ead0", fg: "#6b4a10" },
  muted: { bg: colors.cream100, fg: colors.ink500 },
} as const;

export function ThreadSummaryBar({ askingCents, thread }: { askingCents: number | null; thread: ThreadSummary }) {
  return (
    <View style={styles.bar} accessibilityRole="summary">
      <Cell label="Asking" value={askingCents != null ? euros(askingCents) : "—"} />
      <Cell label="Highest offer" value={thread.highestOpenCents != null ? euros(thread.highestOpenCents) : "None yet"} gold />
      <Cell label="Offers" value={String(thread.offers)} last />
    </View>
  );
}

function Cell({ label, value, gold, last }: { label: string; value: string; gold?: boolean; last?: boolean }) {
  return (
    <View style={[styles.cell, !last && styles.cellRule]}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={[styles.cellValue, gold && { color: colors.gold400 }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function Initials({ person, size = 34 }: { person: ThreadReply; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: person.isSeller ? colors.navy900 : person.color }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{person.initials}</Text>
    </View>
  );
}

function Byline({ person }: { person: ThreadReply }) {
  return (
    <View style={styles.byline}>
      <Text style={styles.name} numberOfLines={1}>
        {person.isMine ? "You" : person.authorName}
      </Text>
      {person.isSeller ? (
        <View style={styles.sellerTag}>
          <Text style={styles.sellerTagText}>SELLER</Text>
        </View>
      ) : null}
      <Text style={styles.meta} numberOfLines={1}>
        {[person.club, shortAgo(person.createdAt)].filter(Boolean).join(" · ")}
      </Text>
    </View>
  );
}

export type ThreadActions = {
  isSeller: boolean;
  onReply?: (entry: ThreadEntry) => void;
  onAccept?: (entry: ThreadEntry) => void;
  onDecline?: (entry: ThreadEntry) => void;
  onCounter?: (entry: ThreadEntry) => void;
  onWithdraw?: (entry: ThreadEntry) => void;
  onRemove?: (postId: number) => void;
};

export function ThreadEntryView({ entry, actions }: { entry: ThreadEntry; actions?: ThreadActions }) {
  const tone = entry.status ? TONE[OFFER_STATUS_TONE[entry.status]] : null;
  const seller = actions?.isSeller ?? false;
  const answered = entry.replies.some((r) => r.isSeller);
  const buttons: { label: string; onPress: () => void; primary?: boolean }[] = [];
  if (actions) {
    if (entry.kind === "offer" && seller && entry.status === "open") {
      if (actions.onAccept) buttons.push({ label: "Accept", onPress: () => actions.onAccept!(entry), primary: true });
      if (actions.onCounter) buttons.push({ label: "Counter", onPress: () => actions.onCounter!(entry) });
      if (actions.onDecline) buttons.push({ label: "Decline", onPress: () => actions.onDecline!(entry) });
    } else if (entry.kind === "question" && seller && actions.onReply) {
      buttons.push({ label: answered ? "Reply again" : "Answer", onPress: () => actions.onReply!(entry), primary: !answered });
    } else if (entry.isMine && actions.onReply && entry.replies.length > 0) {
      buttons.push({ label: "Reply", onPress: () => actions.onReply!(entry) });
    }
    if (entry.kind === "offer" && entry.isMine && (entry.status === "open" || entry.status === "countered") && actions.onWithdraw) {
      buttons.push({ label: "Withdraw", onPress: () => actions.onWithdraw!(entry) });
    }
    if (entry.kind === "question" && entry.isMine && actions.onRemove) {
      buttons.push({ label: "Remove", onPress: () => actions.onRemove!(entry.id) });
    }
  }

  return (
    <View style={styles.entry}>
      <View style={styles.row}>
        <Initials person={entry} />
        <View style={styles.main}>
          <Byline person={entry} />
          {entry.kind === "offer" ? (
            <View style={styles.offerRow}>
              <Text style={styles.offer}>{offerLine(entry)}</Text>
              {entry.status && tone ? (
                <View style={[styles.pill, { backgroundColor: tone.bg }]}>
                  <Text style={[styles.pillText, { color: tone.fg }]}>{OFFER_STATUS_LABELS[entry.status]}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {entry.body ? <Text style={styles.body}>{entry.body}</Text> : null}
        </View>
      </View>

      {entry.replies.map((r) => (
        <View key={r.id} style={[styles.row, styles.reply]}>
          <Initials person={r} size={28} />
          <View style={styles.main}>
            <Byline person={r} />
            <Text style={styles.body}>{r.body}</Text>
            {r.isMine && actions?.onRemove ? (
              <Pressable onPress={() => actions.onRemove!(r.id)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}

      {buttons.length ? (
        <View style={styles.buttons}>
          {buttons.map((b) => (
            <Pressable key={b.label} onPress={b.onPress} style={[styles.button, b.primary && styles.buttonPrimary]} accessibilityRole="button">
              <Text style={[styles.buttonText, b.primary && styles.buttonTextPrimary]}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The card on the listing screen: highest offer, the latest question and its answer, and a way in. */
export function ThreadPreviewCard({ thread, onOpen }: { thread: ThreadSummary; onOpen: () => void }) {
  const latestOffer = thread.entries.find((e) => e.kind === "offer" && (e.status === "open" || e.status === "countered"));
  const latestQuestion = thread.entries.find((e) => e.kind === "question");
  const answer = latestQuestion?.replies.find((r) => r.isSeller);
  return (
    <Pressable onPress={onOpen} style={styles.preview} accessibilityRole="button" accessibilityLabel={`Questions and offers, ${thread.total}`}>
      <View style={styles.previewHead}>
        <Text style={styles.previewTitle}>
          Questions & offers <Text style={styles.previewCount}>· {thread.total}</Text>
        </Text>
        <Text style={styles.seeAll}>{thread.total ? "See all" : "Ask or offer"}</Text>
      </View>
      {thread.total === 0 ? (
        <Text style={styles.previewEmpty}>Nothing yet. Questions and offers here are public, so every buyer sees the same thing.</Text>
      ) : (
        <>
          {thread.highestOpenCents != null ? (
            <View style={styles.previewOffer}>
              <Text style={styles.previewAmount}>{euros(thread.highestOpenCents)}</Text>
              <Text style={styles.previewMeta} numberOfLines={1}>
                highest of {thread.offers} offer{thread.offers === 1 ? "" : "s"}
                {latestOffer ? ` · ${latestOffer.isMine ? "you" : latestOffer.authorName}, ${shortAgo(latestOffer.createdAt)} ago` : ""}
              </Text>
            </View>
          ) : null}
          {latestQuestion ? (
            <Text style={styles.previewQ} numberOfLines={3}>
              <Text style={styles.bold}>{latestQuestion.isMine ? "You" : latestQuestion.authorName}</Text> {latestQuestion.body}
              {answer ? (
                <>
                  <Text style={styles.previewMeta}> — </Text>
                  <Text style={[styles.bold, { color: "#8a6a1f" }]}>Seller:</Text> {answer.body}
                </>
              ) : null}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: colors.navy900, borderRadius: radii.lg, overflow: "hidden" },
  cell: { flex: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 2 },
  cellRule: { borderRightWidth: 1, borderRightColor: "rgba(247,243,234,0.12)" },
  cellLabel: { fontFamily: fonts.body, fontSize: 11.5, color: "#d9d2c3" },
  cellValue: { fontFamily: fonts.display, fontSize: 21, color: colors.cream50 },

  entry: { paddingVertical: 14, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.cream100, gap: 10 },
  row: { flexDirection: "row", gap: 10 },
  reply: { marginLeft: 30, paddingTop: 10, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: colors.gold400 },
  main: { flex: 1, gap: 4, minWidth: 0 },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  byline: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  name: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.ink900, maxWidth: "60%" },
  sellerTag: { backgroundColor: colors.gold400, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  sellerTagText: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 0.6, color: colors.navy900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, flexShrink: 1 },
  offerRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  offer: { fontFamily: fonts.display, fontSize: 17, color: colors.navy900 },
  pill: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 11 },
  body: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: "#2b3443" },
  remove: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500, marginTop: 2 },
  buttons: { flexDirection: "row", gap: 8, marginLeft: 44, flexWrap: "wrap" },
  button: { minHeight: 38, paddingHorizontal: 14, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  buttonPrimary: { backgroundColor: colors.green700, borderColor: colors.green700 },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.navy900 },
  buttonTextPrimary: { color: colors.cream50 },

  preview: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.gold500, backgroundColor: colors.surface, padding: 14, gap: 10 },
  previewHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  previewTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  previewCount: { fontFamily: fonts.body, color: colors.ink500 },
  seeAll: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  previewEmpty: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink500 },
  previewOffer: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  previewAmount: { fontFamily: fonts.display, fontSize: 18, color: colors.navy900 },
  previewMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, flexShrink: 1 },
  previewQ: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: "#2b3443", borderTopWidth: 1, borderTopColor: colors.cream100, paddingTop: 8 },
  bold: { fontFamily: fonts.bodyBold },
});
