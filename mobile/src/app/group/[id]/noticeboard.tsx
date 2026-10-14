import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Chip, Kicker, type ChipTone } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { ago } from "@/lib/feed-rules";
import { loadGroupPage } from "@/lib/groups-data";
import type { SocietyArea } from "@/lib/groups";
import {
  ALERT_PREFS,
  NOTICE_KINDS,
  deleteNotice,
  listNotices,
  myAlertPrefs,
  mySocietyAreas,
  saveNotice,
  setAlertPref,
  type AlertPrefKind,
  type Notice,
  type NoticeKind,
} from "@/lib/society";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A society's noticeboard (0143): what the committee has posted, pinned
 * notices first. Whoever has the "messages" area posts, edits and takes
 * notices down; everyone chooses which of the society's alerts they get.
 * The alerts that matter to your place (confirmed, offered, event changed or
 * cancelled) and committee messages can't be turned off.
 */

const KIND_TONE: Record<NoticeKind, ChipTone> = { general: "grey", change: "wait", reminder: "asked", result: "ok" };
const kindLabel = (k: NoticeKind) => NOTICE_KINDS.find((n) => n.kind === k)?.label ?? "Notice";

type Form = { id: number | null; kind: NoticeKind; title: string; body: string; pinned: boolean; alert: boolean };
const BLANK: Form = { id: null, kind: "general", title: "", body: "", pinned: false, alert: false };

export default function NoticeboardScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [areas, setAreas] = useState<SocietyArea[]>([]);
  const [prefs, setPrefs] = useState<Map<AlertPrefKind, boolean>>(new Map());
  const [groupName, setGroupName] = useState("");
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const canPost = areas.includes("messages");

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [list, a, p, page] = await Promise.all([listNotices(groupId), mySocietyAreas(groupId), myAlertPrefs(groupId, userId), loadGroupPage(groupId, userId)]);
      setNotices(list);
      setAreas(a);
      setPrefs(p);
      setGroupName(page?.group.name ?? "");
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

  async function save() {
    if (!form) return;
    const title = form.title.trim();
    if (!title) return;
    setSaving(true);
    try {
      await saveNotice(groupId, form.id, { kind: form.kind, title, body: form.body.trim() || null, pinned: form.pinned, alert: form.id == null && form.alert });
      setForm(null);
      await load();
    } catch (err) {
      Alert.alert("Couldn't post that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function noticeMenu(n: Notice) {
    if (!canPost) return;
    Alert.alert(n.title, undefined, [
      { text: "Edit", onPress: () => setForm({ id: n.id, kind: n.kind, title: n.title, body: n.body ?? "", pinned: n.pinned, alert: false }) },
      {
        text: "Take down",
        style: "destructive",
        onPress: () =>
          Alert.alert("Take this notice down?", "Members won't see it any more.", [
            { text: "Keep it", style: "cancel" },
            {
              text: "Take down",
              style: "destructive",
              onPress: async () => {
                setBusy(n.id);
                try {
                  await deleteNotice(n.id);
                  if (form?.id === n.id) setForm(null);
                  await load();
                } catch (err) {
                  Alert.alert("Couldn't take it down", err instanceof Error ? err.message : "Please try again.");
                } finally {
                  setBusy(null);
                }
              },
            },
          ]),
      },
      { text: "Close", style: "cancel" },
    ]);
  }

  async function togglePref(kind: AlertPrefKind, enabled: boolean) {
    const before = prefs;
    setPrefs(new Map(prefs).set(kind, enabled));
    try {
      await setAlertPref(groupId, kind, enabled);
    } catch (err) {
      setPrefs(before);
      Alert.alert("Couldn't change that", err instanceof Error ? err.message : "Please try again.");
    }
  }

  const pinned = (notices ?? []).filter((n) => n.pinned);
  const others = (notices ?? []).filter((n) => !n.pinned);

  function meta(n: Notice) {
    return [n.author, ago(n.createdAt), n.editedAt ? "edited" : null].filter(Boolean).join(" · ");
  }

  function noticeBody(n: Notice) {
    return (
      <>
        <View style={styles.noticeTop}>
          <Chip tone={KIND_TONE[n.kind]}>{kindLabel(n.kind)}</Chip>
          {busy === n.id ? <ActivityIndicator size="small" color={colors.ink500} /> : null}
          {canPost ? <Ionicons name="ellipsis-horizontal" size={18} color={colors.ink500} style={{ marginLeft: "auto" }} /> : null}
        </View>
        <Text style={styles.noticeTitle}>{n.title}</Text>
        {n.body ? <Text style={styles.noticeBody}>{n.body}</Text> : null}
        <Text style={styles.meta}>{meta(n)}</Text>
      </>
    );
  }

  const a11y = (n: Notice) => `${n.pinned ? "Pinned. " : ""}${kindLabel(n.kind)}: ${n.title}. ${meta(n)}`;

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Noticeboard", headerBackTitle: "Back" }} />
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
        <View style={styles.head}>
          <View style={{ flex: 1 }}>{groupName ? <Kicker color={colors.ink500}>{groupName}</Kicker> : null}</View>
          {canPost && !form ? (
            <Pressable style={styles.post} onPress={() => setForm({ ...BLANK })} accessibilityRole="button" accessibilityLabel="Post a notice">
              <Ionicons name="add" size={20} color={colors.cream50} />
              <Text style={styles.postText}>Post</Text>
            </Pressable>
          ) : null}
        </View>

        {form ? (
          <Card>
            <Text style={styles.formTitle}>{form.id == null ? "New notice" : "Edit notice"}</Text>
            <View style={styles.kinds} accessibilityRole="radiogroup">
              {NOTICE_KINDS.map((k) => {
                const on = form.kind === k.kind;
                return (
                  <Pressable
                    key={k.kind}
                    style={[styles.kind, on && styles.kindOn]}
                    onPress={() => setForm({ ...form, kind: k.kind })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={k.label}
                  >
                    <Text style={[styles.kindText, on && styles.kindTextOn]}>{k.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={styles.input}
              value={form.title}
              onChangeText={(t) => setForm({ ...form, title: t })}
              placeholder="Title"
              placeholderTextColor={colors.ink500}
              maxLength={80}
              accessibilityLabel="Title"
            />
            <TextInput
              style={[styles.input, styles.multi]}
              value={form.body}
              onChangeText={(t) => setForm({ ...form, body: t })}
              placeholder="More detail (optional)"
              placeholderTextColor={colors.ink500}
              maxLength={2000}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Notice text"
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Pin to the top</Text>
              <Switch value={form.pinned} onValueChange={(v) => setForm({ ...form, pinned: v })} accessibilityLabel="Pin to the top" />
            </View>
            {form.id == null ? (
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Send as an alert to everyone</Text>
                <Switch value={form.alert} onValueChange={(v) => setForm({ ...form, alert: v })} accessibilityLabel="Send as an alert to everyone" />
              </View>
            ) : null}
            <View style={styles.formActions}>
              <Button label="Cancel" tone="line" onPress={() => setForm(null)} style={{ flex: 1 }} disabled={saving} />
              <Button label={form.id == null ? "Post" : "Save"} onPress={() => void save()} busy={saving} disabled={!form.title.trim()} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : null}

        {failed && !notices ? (
          <LoadError onRetry={() => void load()} what="the noticeboard" />
        ) : notices === null ? (
          <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.lg }} />
        ) : notices.length === 0 ? (
          <StateMessage icon="clipboard-outline" title="Nothing on the noticeboard yet" body={canPost ? "Post a notice and every member sees it here." : "When the committee posts a notice, it shows here."} />
        ) : (
          <>
            {pinned.map((n) => (
              <Pressable key={n.id} style={styles.pinned} onPress={() => noticeMenu(n)} disabled={!canPost} accessibilityRole={canPost ? "button" : "text"} accessibilityLabel={a11y(n)} accessibilityHint={canPost ? "Edit or take down" : undefined}>
                <View style={styles.pinTag}>
                  <Ionicons name="pin" size={14} color="#7e5f14" />
                  <Text style={styles.pinTagText}>PINNED</Text>
                </View>
                {noticeBody(n)}
              </Pressable>
            ))}
            {others.length ? (
              <View style={styles.list}>
                {others.map((n, i) => (
                  <Pressable
                    key={n.id}
                    style={[styles.row, i > 0 && styles.rowLine]}
                    onPress={() => noticeMenu(n)}
                    disabled={!canPost}
                    accessibilityRole={canPost ? "button" : "text"}
                    accessibilityLabel={a11y(n)}
                    accessibilityHint={canPost ? "Edit or take down" : undefined}
                  >
                    {noticeBody(n)}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        )}

        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.formTitle}>Alerts from this society</Text>
          {ALERT_PREFS.map((p) => {
            const value = prefs.get(p.kind) ?? true;
            return (
              <View key={p.kind} style={styles.switchRow}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.switchLabel}>{p.label}</Text>
                  {p.hint ? <Text style={styles.meta}>{p.hint}</Text> : null}
                </View>
                <Switch value={value} onValueChange={(v) => void togglePref(p.kind, v)} accessibilityLabel={p.label} accessibilityHint={p.hint} />
              </View>
            );
          })}
          <View style={[styles.switchRow, styles.locked]} accessible accessibilityLabel="Your place confirmed, a place opened, an event changed or cancelled, messages from the committee: always on">
            <Ionicons name="lock-closed" size={18} color={colors.ink500} />
            <Text style={[styles.meta, { flex: 1 }]}>Your place confirmed, a place opened, an event changed or cancelled, messages from the committee — always on</Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  post: { flexDirection: "row", gap: 6, height: 44, paddingHorizontal: 18, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  postText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  formTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kind: { paddingHorizontal: 14, minHeight: 44, borderRadius: radii.pill, justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  kindOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  kindText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  kindTextOn: { color: colors.cream50 },
  // 16pt floor: iOS zooms the screen when a smaller input takes focus.
  input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50, fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  multi: { minHeight: 120 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  switchLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  formActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  locked: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  pinned: { gap: 6, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.gold400, backgroundColor: "#fbf3df" },
  pinTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  pinTagText: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: "#7e5f14" },
  list: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  row: { gap: 6, padding: spacing.md, minHeight: 44 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line },
  noticeTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  noticeTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  noticeBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
});
