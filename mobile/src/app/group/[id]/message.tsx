import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Kicker } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { ago } from "@/lib/feed-rules";
import { loadGroupPage } from "@/lib/groups-data";
import { irishToday, outingDateLabel } from "@/lib/outing-rules";
import { listOutings, type OutingSummary } from "@/lib/outings";
import { AUDIENCES, audienceCount, loadMembershipSettings, mySocietyAreas, sendSocietyMessage, sentMessages, type Audience, type SentMessage } from "@/lib/society";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A committee message (0144): pick who gets it (everyone, an event's
 * entrants or waiting list, whoever owes fees or membership, the
 * committee), see how many that is, write it and send. It arrives as an
 * alert members can't turn off; a message to everyone can also go on the
 * noticeboard. Only members with the "messages" area can send — the
 * database checks that too.
 *
 * Params: `audience` and `outing` preselect (e.g. from an event's page).
 */

const isAudience = (a: string | undefined): a is Audience => !!a && AUDIENCES.some((x) => x.audience === a);
const audienceLabel = (a: Audience) => AUDIENCES.find((x) => x.audience === a)?.label ?? a;
const people = (n: number) => `${n} ${n === 1 ? "member" : "members"}`;

export default function SocietyMessageScreen() {
  const { id: rawId, audience: rawAudience, outing: rawOuting } = useLocalSearchParams<{ id: string; audience?: string; outing?: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [membership, setMembership] = useState(false);
  const [events, setEvents] = useState<OutingSummary[]>([]);
  const [sent, setSent] = useState<SentMessage[]>([]);

  const [audience, setAudience] = useState<Audience>(isAudience(rawAudience) ? rawAudience : "everyone");
  const [outingId, setOutingId] = useState<number | null>(rawOuting && Number.isFinite(Number(rawOuting)) ? Number(rawOuting) : null);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [postNotice, setPostNotice] = useState(false);
  const [sending, setSending] = useState(false);

  const needsEvent = !!AUDIENCES.find((a) => a.audience === audience)?.needsEvent;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [areas, page, m, list, s] = await Promise.all([
        mySocietyAreas(groupId),
        loadGroupPage(groupId, userId),
        loadMembershipSettings(groupId),
        listOutings(groupId, userId, { fromDate: irishToday() }),
        sentMessages(groupId),
      ]);
      setAllowed(areas.includes("messages"));
      setGroupName(page?.group.name ?? "");
      setMembership(m.enabled);
      setEvents(list.filter((o) => o.status === "open"));
      setSent(s);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // The live count: who this would reach right now.
  useEffect(() => {
    if (!allowed) return;
    if (needsEvent && outingId == null) {
      setCount(null);
      setCounting(false);
      return;
    }
    let live = true;
    setCounting(true);
    audienceCount(groupId, audience, needsEvent ? outingId : null)
      .then((n) => live && setCount(n))
      .catch(() => live && setCount(null))
      .finally(() => live && setCounting(false));
    return () => {
      live = false;
    };
  }, [allowed, groupId, audience, outingId, needsEvent]);

  // Only a message to everyone can go on the noticeboard.
  useEffect(() => {
    if (audience !== "everyone") setPostNotice(false);
  }, [audience]);

  const audiences = AUDIENCES.filter((a) => !a.needsMembership || membership);
  const ready = title.trim().length > 0 && (!needsEvent || outingId != null) && count != null && count > 0 && !counting;

  async function send() {
    if (!ready || count == null) return;
    setSending(true);
    try {
      const n = await sendSocietyMessage(groupId, audience, needsEvent ? outingId : null, title.trim(), body.trim() || null, audience === "everyone" && postNotice);
      Alert.alert("Sent", `Your message went to ${people(Number.isFinite(n) ? n : count)}.`);
      router.back();
    } catch (err) {
      Alert.alert("Couldn't send it", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (allowed === null && !failed) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "New message", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (failed && allowed === null) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "New message", headerBackTitle: "Back" }} />
        <LoadError onRetry={() => void load()} what="messages" size="screen" />
      </View>
    );
  }
  if (!allowed) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "New message", headerBackTitle: "Back" }} />
        <StateMessage icon="mail-outline" title="Only the committee can send messages" body="The captain, secretary and committee members who look after messages send them from here." size="screen" />
      </View>
    );
  }

  const preview = body.trim().length > 100 ? `${body.trim().slice(0, 100).trimEnd()}…` : body.trim();
  const countText = counting ? "…" : count != null ? String(count) : null;

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "New message", headerBackTitle: "Back" }} />
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {groupName ? <Kicker color={colors.ink500}>{groupName}</Kicker> : null}

        <Card>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Who gets it</Text>
            {countText != null ? (
              <Text style={styles.count} accessibilityLiveRegion="polite" accessibilityLabel={counting ? "Counting" : people(count ?? 0)}>
                {counting ? "…" : people(count ?? 0)}
              </Text>
            ) : null}
          </View>
          <View accessibilityRole="radiogroup">
            {audiences.map((a) => {
              const on = audience === a.audience;
              return (
                <Pressable key={a.audience} style={styles.radio} onPress={() => setAudience(a.audience)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={a.label}>
                  <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? colors.green700 : colors.ink500} />
                  <Text style={[styles.radioText, on && styles.radioTextOn]}>{a.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {needsEvent ? (
          <Card>
            <Text style={styles.cardTitle}>Which event</Text>
            {events.length === 0 ? (
              <Text style={styles.hint}>There are no upcoming events open right now.</Text>
            ) : (
              <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
                {events.map((o) => {
                  const on = outingId === o.id;
                  return (
                    <Pressable
                      key={o.id}
                      style={[styles.event, on && styles.eventOn]}
                      onPress={() => setOutingId(o.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${o.title}, ${outingDateLabel(o.playsOn)}, ${o.entered} in`}
                    >
                      <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={22} color={on ? colors.green700 : colors.ink500} />
                      <View style={{ flex: 1, gap: 1 }}>
                        <Text style={styles.eventTitle} numberOfLines={1}>
                          {o.title}
                        </Text>
                        <Text style={styles.hint}>{[outingDateLabel(o.playsOn), o.courseName ?? o.location, `${o.entered} in`].filter(Boolean).join(" · ")}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </Card>
        ) : null}

        <Card>
          <Text style={styles.cardTitle}>Message</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.ink500} maxLength={80} accessibilityLabel="Title" />
          <TextInput
            style={[styles.input, styles.multi]}
            value={body}
            onChangeText={setBody}
            placeholder="Your message"
            placeholderTextColor={colors.ink500}
            maxLength={1000}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Message"
          />
          <Text style={styles.counter}>{body.length}/1000</Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[styles.switchLabel, audience !== "everyone" && styles.off]}>Also post on the noticeboard</Text>
              <Text style={styles.hint}>{audience === "everyone" ? "Members see it there too." : "Only for messages to everyone. Messages about money are never posted on the noticeboard."}</Text>
            </View>
            <Switch value={postNotice} onValueChange={setPostNotice} disabled={audience !== "everyone"} accessibilityLabel="Also post on the noticeboard" accessibilityState={{ disabled: audience !== "everyone" }} />
          </View>
        </Card>

        <Text style={styles.sectionLabel}>PREVIEW</Text>
        <View style={styles.notif} accessible accessibilityLabel={`Preview: ${groupName || "Your society"}, now. ${title.trim() || "Title"}. ${preview}`}>
          <View style={styles.notifTop}>
            <View style={styles.notifIcon}>
              <Ionicons name="golf" size={13} color={colors.navy900} />
            </View>
            <Text style={styles.notifApp} numberOfLines={1}>
              {(groupName || "Your society").toUpperCase()} · now
            </Text>
          </View>
          <Text style={styles.notifTitle} numberOfLines={1}>
            {title.trim() || "Title"}
          </Text>
          {preview ? (
            <Text style={styles.notifBody} numberOfLines={3}>
              {preview}
            </Text>
          ) : null}
        </View>

        <Button
          label={count != null && !counting ? `Send to ${people(count)}` : needsEvent && outingId == null ? "Choose an event" : "Send"}
          icon="send"
          onPress={() => void send()}
          disabled={!ready}
          busy={sending}
          style={{ marginTop: spacing.sm }}
        />

        {sent.length ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>SENT RECENTLY</Text>
            <View style={styles.list}>
              {sent.map((m, i) => (
                <View key={m.id} style={[styles.sentRow, i > 0 && styles.rowLine]} accessible accessibilityLabel={`${m.title}. ${audienceLabel(m.audience)}, ${people(m.recipients)}, ${ago(m.sentAt)}`}>
                  <Text style={styles.eventTitle}>{m.title}</Text>
                  <Text style={styles.hint}>{[audienceLabel(m.audience), people(m.recipients), ago(m.sentAt)].join(" · ")}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  count: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green800, backgroundColor: colors.green100, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill, overflow: "hidden" },
  radio: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  radioText: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  radioTextOn: { fontFamily: fonts.bodySemi },
  event: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 56, padding: 10, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  eventOn: { borderColor: colors.green600, backgroundColor: colors.green100 },
  eventTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  // 16pt floor: iOS zooms the screen when a smaller input takes focus.
  input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50, fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  multi: { minHeight: 140 },
  counter: { alignSelf: "flex-end", fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  switchLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  off: { color: colors.ink500 },
  sectionLabel: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.ink500, marginTop: spacing.sm },
  notif: { gap: 3, padding: 14, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  notifTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  notifIcon: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.gold400 },
  notifApp: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 11.5, letterSpacing: 0.8, color: colors.cream100 },
  notifTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  notifBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.cream100 },
  list: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  sentRow: { gap: 2, padding: spacing.md },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line },
});
