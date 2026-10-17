import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AmountSheet } from "@/components/amount-sheet";
import { KEYBOARD_DISMISS_MODE, KeyboardInset } from "@/components/keyboard";
import { ThreadEntryView, ThreadSummaryBar } from "@/components/listing-thread-view";
import { LoadError } from "@/components/state-message";
import { useAgeAccess } from "@/lib/age";
import { useAuth } from "@/lib/auth";
import { EMPTY_THREAD, answerOffer, askQuestion, loadThread, makeOffer, removePost, replyTo, withdrawOffer } from "@/lib/listing-posts";
import { euros, parseEuroInput, type ThreadEntry, type ThreadSummary } from "@/lib/listing-thread";
import { getListingDetail, type ListingDetail } from "@/lib/marketplace";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Questions & offers — the public thread under a listing (0162, approved
 * mock-up 4b). Everyone sees the same thread: asking price, highest offer,
 * every offer and how it went, and the seller's answers. Nothing here moves
 * money; collection and phone numbers go in Messages.
 *
 * `mode=offer` opens with the offer box ready (the listing's Make an offer).
 */
type Mode = "question" | "offer";

export default function ListingOffersScreen() {
  const { id, mode: startMode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const listingId = Number.parseInt(String(id), 10);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { allows } = useAgeAccess();
  const canPost = allows("buy");

  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [thread, setThread] = useState<ThreadSummary>(EMPTY_THREAD);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const [mode, setMode] = useState<Mode>(startMode === "offer" ? "offer" : "question");
  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<ThreadEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [countering, setCountering] = useState<ThreadEntry | null>(null);
  const input = useRef<TextInput>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(listingId)) return;
    setError(false);
    try {
      const [detail, posts] = await Promise.all([getListingDetail(listingId, userId), loadThread(listingId)]);
      setListing(detail);
      setThread(posts);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listingId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isSeller = !!listing?.isMine;
  const onSale = listing?.status === "active" || listing?.status === "reserved";
  const offerCents = mode === "offer" && !replyingTo ? parseEuroInput(text) : null;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      setText("");
      setReplyingTo(null);
      await load();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const body = text.trim();
    if (replyingTo) {
      if (!body) return;
      void run(() => replyTo(replyingTo.id, body));
    } else if (mode === "offer") {
      if (offerCents === null) {
        setProblem("Enter your offer in euro, like 220.");
        return;
      }
      void run(() => makeOffer(listingId, offerCents));
    } else {
      if (!body) return;
      void run(() => askQuestion(listingId, body));
    }
  }

  function startReply(entry: ThreadEntry) {
    setReplyingTo(entry);
    setText("");
    setProblem(null);
    setTimeout(() => input.current?.focus(), 50);
  }

  const actions = userId
    ? {
        isSeller,
        onReply: onSale ? startReply : undefined,
        onAccept: (entry: ThreadEntry) =>
          Alert.alert(`Accept ${euros(entry.amountCents)}?`, `Everyone sees it's accepted. Then message ${entry.authorName.split(" ")[0]} to arrange collection — PinPals doesn't take payment.`, [
            { text: "Cancel", style: "cancel" },
            { text: "Accept", onPress: () => void run(() => answerOffer(entry.id, "accept")) },
          ]),
        onDecline: (entry: ThreadEntry) =>
          Alert.alert(`Decline ${euros(entry.amountCents)}?`, "Everyone sees it was declined.", [
            { text: "Cancel", style: "cancel" },
            { text: "Decline", style: "destructive", onPress: () => void run(() => answerOffer(entry.id, "decline")) },
          ]),
        onCounter: (entry: ThreadEntry) => setCountering(entry),
        onWithdraw: (entry: ThreadEntry) =>
          Alert.alert("Withdraw your offer?", undefined, [
            { text: "Keep it", style: "cancel" },
            { text: "Withdraw", style: "destructive", onPress: () => void run(() => withdrawOffer(entry.id)) },
          ]),
        onRemove: (postId: number) =>
          Alert.alert("Remove this?", undefined, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => void run(() => removePost(postId)) },
          ]),
      }
    : undefined;

  if (!Number.isFinite(listingId)) return <LoadError onRetry={() => router.back()} what="this listing" size="screen" />;

  return (
    <>
      <Stack.Screen options={{ title: "Questions & offers", headerBackTitle: "Back" }} />
      <KeyboardInset style={styles.fill}>
        {loading ? (
          <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
        ) : error || !listing ? (
          <LoadError onRetry={() => void load()} what="the questions and offers" size="screen" />
        ) : (
          <>
            <ScrollView
              style={styles.fill}
              contentContainerStyle={styles.content}
              keyboardDismissMode={KEYBOARD_DISMISS_MODE}
              keyboardShouldPersistTaps="handled"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.green700} />}
            >
              <Pressable onPress={() => router.back()} style={styles.item} accessibilityRole="button" accessibilityLabel={`Back to ${listing.title}`}>
                {listing.images[0] ? <Image source={{ uri: listing.images[0] }} style={styles.itemPhoto} /> : <View style={[styles.itemPhoto, styles.itemNone]} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{listing.title}</Text>
                  <Text style={styles.itemMeta} numberOfLines={1}>
                    {listing.seller ? `${isSeller ? "Your listing" : listing.seller.name}` : ""}
                    {onSale ? "" : " · no longer on sale"}
                  </Text>
                </View>
              </Pressable>

              <ThreadSummaryBar askingCents={listing.priceCents} thread={thread} />

              <View style={styles.list}>
                {thread.entries.length === 0 ? (
                  <View style={styles.empty}>
                    <Ionicons name="chatbubbles-outline" size={30} color={colors.ink500} />
                    <Text style={styles.emptyTitle}>No questions or offers yet</Text>
                    <Text style={styles.emptyBody}>{isSeller ? "When someone asks or offers, it lands here and you'll get an alert." : "Ask something every buyer would want to know, or make an offer."}</Text>
                  </View>
                ) : (
                  thread.entries.map((entry) => <ThreadEntryView key={entry.id} entry={entry} actions={actions} />)
                )}
              </View>

              <Text style={styles.note}>
                Offers are public and not binding — the seller can accept, decline or counter. Phone numbers and collection go in Messages.
              </Text>
            </ScrollView>

            {!userId ? (
              <View style={styles.composer}>
                <Pressable onPress={() => router.push("/login")} style={styles.send} accessibilityRole="button">
                  <Text style={styles.sendText}>Sign in to ask or offer</Text>
                </Pressable>
              </View>
            ) : !onSale ? null : !canPost && !isSeller ? (
              <View style={styles.composer}>
                <Text style={styles.note}>Under 18s can read questions and offers; a parent can ask or offer for you.</Text>
              </View>
            ) : isSeller && !replyingTo ? (
              <View style={styles.composer}>
                <Text style={styles.sellerHint}>Tap Answer, Accept, Counter or Decline on a post to reply in the open.</Text>
              </View>
            ) : (
              <View style={styles.composer}>
                {replyingTo ? (
                  <View style={styles.replyingRow}>
                    <Text style={styles.replying} numberOfLines={1}>
                      Replying to {replyingTo.isMine ? "your " + replyingTo.kind : replyingTo.authorName}
                    </Text>
                    <Pressable onPress={() => setReplyingTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel reply">
                      <Ionicons name="close" size={18} color={colors.ink500} />
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.segment} accessibilityRole="tablist">
                    {(["question", "offer"] as const).map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => {
                          setMode(m);
                          setText("");
                          setProblem(null);
                        }}
                        style={[styles.segmentItem, mode === m && styles.segmentOn]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: mode === m }}
                      >
                        <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]}>{m === "question" ? "Ask a question" : "Make an offer"}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <View style={styles.inputRow}>
                  <View style={[styles.inputBox, mode === "offer" && !replyingTo && styles.inputOffer]}>
                    {mode === "offer" && !replyingTo ? <Text style={styles.euro}>€</Text> : null}
                    <TextInput
                      ref={input}
                      value={text}
                      onChangeText={(t) => {
                        setText(t);
                        setProblem(null);
                      }}
                      style={[styles.input, mode === "offer" && !replyingTo && styles.inputOfferText]}
                      placeholder={replyingTo ? "Write a reply" : mode === "offer" ? (listing.priceCents ? String(Math.round((listing.priceCents * 0.9) / 500) * 5) : "Your offer") : "Ask the seller something"}
                      placeholderTextColor={colors.ink500}
                      keyboardType={mode === "offer" && !replyingTo ? "decimal-pad" : "default"}
                      multiline={mode === "question" || !!replyingTo}
                      maxLength={500}
                      accessibilityLabel={replyingTo ? "Reply" : mode === "offer" ? "Your offer in euro" : "Your question"}
                    />
                  </View>
                  <Pressable onPress={send} disabled={busy} style={[styles.send, busy && { opacity: 0.6 }]} accessibilityRole="button">
                    {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.sendText}>{replyingTo ? "Reply" : mode === "offer" ? "Post offer" : "Ask"}</Text>}
                  </Pressable>
                </View>
                {problem ? <Text style={styles.problem}>{problem}</Text> : null}
              </View>
            )}
          </>
        )}
      </KeyboardInset>

      <AmountSheet
        visible={!!countering}
        title="Counter offer"
        intro={countering ? `${countering.authorName} offered ${euros(countering.amountCents)}. What would you take? Everyone sees your answer.` : undefined}
        placeholder={listing?.priceCents ? String(listing.priceCents / 100) : undefined}
        confirmLabel={(amount) => (amount ? `Counter at €${amount}` : "Counter")}
        onSubmit={async (amount) => {
          if (!countering) return;
          await answerOffer(countering.id, "counter", Math.round(amount * 100));
          setCountering(null);
          await load();
        }}
        onClose={() => setCountering(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  item: { flexDirection: "row", alignItems: "center", gap: 12 },
  itemPhoto: { width: 46, height: 46, borderRadius: radii.md },
  itemNone: { backgroundColor: colors.cream100 },
  itemTitle: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  itemMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  list: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  empty: { alignItems: "center", gap: 6, padding: spacing.lg },
  emptyTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  emptyBody: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500, textAlign: "center" },
  note: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500 },
  composer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, padding: 12, gap: 10 },
  sellerHint: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500, textAlign: "center" },
  segment: { flexDirection: "row", backgroundColor: colors.cream100, borderRadius: radii.md, padding: 3 },
  segmentItem: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: colors.surface, shadowColor: colors.navy900, shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  segmentText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: "#3d4757" },
  segmentTextOn: { fontFamily: fonts.bodyBold, color: colors.navy900 },
  replyingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  replying: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green700, flex: 1 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  inputBox: { flex: 1, minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  inputOffer: { borderWidth: 2, borderColor: colors.gold500, backgroundColor: colors.surface },
  euro: { fontFamily: fonts.display, fontSize: 20, color: colors.navy900, marginRight: 2 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, paddingVertical: 10, maxHeight: 120 },
  inputOfferText: { fontFamily: fonts.display, fontSize: 20, color: colors.navy900 },
  send: { minHeight: 48, paddingHorizontal: 18, borderRadius: radii.md, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  sendText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  problem: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.red600 },
});
