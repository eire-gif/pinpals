import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { SectionTitle } from "@/components/group-bits";
import { Button, Card, Chip, Kicker, LinkRow, euro, type ChipTone } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage } from "@/lib/groups-data";
import { CLAIM_LABELS, formatIban, paymentReference, payWays, revolutUrl, type ClaimMethod } from "@/lib/outing-payments";
import { outingDateLabel } from "@/lib/outing-rules";
import {
  billingSeason,
  claimMembershipPaid,
  loadMembershipSettings,
  MEMBERSHIP_LABELS,
  myDues,
  myMembership,
  seasonLabel,
  type Due,
  type MembershipSettings,
  type MembershipStatus,
} from "@/lib/society";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A member's annual membership (0143): the member card for this season,
 * what they owe the society, how to pay the treasurer, and "I've paid" so
 * the treasurer knows to check. PinPals never moves the money — the
 * Revolut row opens revolut.me, bank details are press-and-hold to copy.
 *
 * A society that only charges per event says so; its officers get a way in
 * to set membership up.
 */

type Mine = Awaited<ReturnType<typeof myMembership>>;

type Loaded = {
  societyName: string;
  officer: boolean;
  myName: string;
  settings: MembershipSettings;
  season: number | null;
  mine: Mine | null;
  dues: Due[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** YYYY-MM-DD for a UTC date. */
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The season's first day, last day and the day membership falls due. */
function seasonDates(season: number, startMonth: number, dueAfterDays: number): { from: string; to: string; due: string } {
  const start = new Date(Date.UTC(season, startMonth - 1, 1));
  const end = new Date(Date.UTC(season + 1, startMonth - 1, 0));
  const due = new Date(Date.UTC(season, startMonth - 1, 1 + dueAfterDays));
  return { from: iso(start), to: iso(end), due: iso(due) };
}

const shortDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
};

export default function MembershipScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [page, settings, season, dues] = await Promise.all([loadGroupPage(groupId, userId), loadMembershipSettings(groupId), billingSeason(groupId), myDues(groupId)]);
      if (!page || !page.myRole) {
        setData(null);
        setFailed(false);
        return;
      }
      const mine = settings.enabled && season != null ? await myMembership(groupId, userId, season) : null;
      setData({
        societyName: page.group.name,
        officer: page.myRole === "owner" || page.myRole === "admin",
        myName: page.members.find((m) => m.id === userId)?.name ?? "",
        settings,
        season,
        mine,
        dues,
      });
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

  async function claim(method: ClaimMethod | null) {
    setBusy(true);
    try {
      await claimMembershipPaid(groupId, method);
      await load();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const header = <Stack.Screen options={{ title: "Membership", headerBackTitle: "Back" }} />;

  if (data === undefined && !failed) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (failed && !data) {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="your membership" size="screen" />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="lock-closed-outline" title="Only members can see this" body="Join the society to see its membership." size="screen" />
      </View>
    );
  }

  const { settings, season, mine, officer, societyName, myName, dues } = data;

  if (!settings.enabled || season == null) {
    return (
      <View style={styles.fill}>
        {header}
        <View style={styles.emptyWrap}>
          <StateMessage icon="card-outline" title="No annual membership" body="This society charges per event only." />
          {officer ? (
            <Button
              label="Set up annual membership"
              icon="settings-outline"
              onPress={() => router.push({ pathname: "/group/[id]/membership-settings", params: { id: String(groupId) } })}
              style={{ alignSelf: "stretch" }}
            />
          ) : null}
        </View>
      </View>
    );
  }

  const label = seasonLabel(season, settings.seasonStartMonth);
  const dates = seasonDates(season, settings.seasonStartMonth, settings.dueAfterDays);
  const status: MembershipStatus = mine?.status ?? "unpaid";
  const chip = statusChip(status, dates.due);
  const claimed = status === "claimed";
  const settled = status === "paid" || status === "honorary";
  const total = dues.reduce((sum, d) => sum + d.amountCents, 0);
  const ways = payWays(settings);
  const reference = paymentReference(label, myName || "Your name");
  const history = (mine?.history ?? []).filter((h) => h.season !== season);

  function sayPaid() {
    const options: ClaimMethod[] = ways.length ? ways : ["revolut", "transfer", "cash"];
    Alert.alert("How did you pay?", "The treasurer checks and confirms it.", [
      ...options.map((m) => ({ text: m === "revolut" ? "Revolut" : m === "transfer" ? "Bank transfer" : "Cash", onPress: () => void claim(m) })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  return (
    <View style={styles.fill}>
      {header}
      <ScrollView
        contentContainerStyle={styles.body}
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
        {/* The member card */}
        <View style={styles.memberCard} accessible accessibilityLabel={`${societyName}, member ${label}, ${myName}, ${chip.label}`}>
          <Kicker color={colors.gold400}>{societyName}</Kicker>
          <Text style={styles.memberTitle}>{`Member ${label}`}</Text>
          {myName ? <Text style={styles.memberName}>{myName}</Text> : null}
          <Text style={styles.memberDates}>{`${shortDate(dates.from)} – ${shortDate(dates.to)}`}</Text>
          <Chip tone={chip.tone} style={styles.memberChip}>
            {chip.label}
          </Chip>
        </View>

        {/* What you owe */}
        <Card>
          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>Annual fee</Text>
            <Text style={styles.feeValue}>{settings.feeCents != null ? euro(settings.feeCents) : "Not set"}</Text>
          </View>
          <View style={styles.divider} />
          <Text style={styles.cardTitle} accessibilityRole="header">
            What you owe
          </Text>
          {dues.length === 0 ? (
            <Text style={styles.muted}>Nothing — you&apos;re all square.</Text>
          ) : (
            <>
              {dues.map((d, i) => (
                <View key={`${d.kind}-${d.outingId ?? d.season ?? i}`} style={styles.dueRow}>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={styles.dueLabel}>{d.label}</Text>
                    {d.playsOn || d.claimed ? <Text style={styles.muted}>{[d.playsOn ? outingDateLabel(d.playsOn) : null, d.claimed ? "Says paid — waiting to be confirmed" : null].filter(Boolean).join(" · ")}</Text> : null}
                  </View>
                  <Text style={styles.dueAmount}>{euro(d.amountCents)}</Text>
                </View>
              ))}
              <View style={[styles.dueRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalAmount}>{euro(total)}</Text>
              </View>
            </>
          )}
        </Card>

        {/* How to pay */}
        {!settled ? (
          <View style={styles.payCard}>
            <Text style={styles.payKicker}>{claimed ? "WAITING TO BE CONFIRMED" : "HOW TO PAY THE TREASURER"}</Text>
            {settings.feeCents != null ? <Text style={styles.payAmount}>{`Pay ${euro(settings.feeCents)}`}</Text> : null}
            {settings.payNote ? <Text style={styles.payNote}>{settings.payNote}</Text> : null}

            {claimed ? (
              <View style={styles.claim}>
                <Ionicons name="time-outline" size={18} color={colors.navy900} />
                <Text style={styles.claimText}>You said you&apos;ve paid. The treasurer will confirm it here.</Text>
              </View>
            ) : null}

            {!claimed && settings.payRevtag ? (
              <Pressable
                style={styles.revolut}
                onPress={() => void Linking.openURL(revolutUrl(settings.payRevtag!))}
                accessibilityRole="link"
                accessibilityLabel={`Pay ${euro(settings.feeCents)} with Revolut to @${settings.payRevtag}`}
              >
                <View style={styles.revolutMark}>
                  <Ionicons name="send" size={15} color={colors.navy900} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.revolutTitle}>Pay with Revolut</Text>
                  <Text style={styles.revolutSub}>{`@${settings.payRevtag} · enter ${euro(settings.feeCents) || "the amount"}`}</Text>
                </View>
                <Ionicons name="open-outline" size={18} color={colors.cream50} />
              </Pressable>
            ) : null}

            {!claimed && settings.payIban ? (
              <View style={styles.bank}>
                <Text style={styles.wayTitle}>Bank transfer</Text>
                {settings.payAccountName ? <BankRow label="Name" value={settings.payAccountName} /> : null}
                <BankRow label="IBAN" value={formatIban(settings.payIban)} mono />
                <BankRow label="Reference" value={reference} />
                <Text style={styles.hint}>Press and hold to copy.</Text>
              </View>
            ) : null}

            {!claimed && settings.payCash ? (
              <View style={styles.cash}>
                <Ionicons name="cash-outline" size={18} color={colors.green700} />
                <Text style={styles.cashText}>Cash to the treasurer is fine too.</Text>
              </View>
            ) : null}

            {!claimed && ways.length === 0 ? <Text style={styles.hint}>Pay the treasurer — they&apos;ll mark it here.</Text> : null}

            {claimed ? (
              <Button label="Withdraw 'I've paid'" tone="danger" icon="arrow-undo-outline" onPress={() => void claim(null)} busy={busy} />
            ) : (
              <Button label="I've paid" tone="line" icon="checkmark-circle-outline" onPress={sayPaid} busy={busy} />
            )}
          </View>
        ) : null}

        {/* History */}
        {history.length > 0 ? (
          <>
            <SectionTitle>Past seasons</SectionTitle>
            <Card style={{ gap: 0, paddingVertical: spacing.xs }}>
              {history.map((h, i) => {
                const s = (h.status in MEMBERSHIP_LABELS ? h.status : "unpaid") as MembershipStatus;
                return (
                  <View key={h.season} style={[styles.historyRow, i > 0 && styles.historyLine]} accessible accessibilityLabel={`${seasonLabel(h.season, settings.seasonStartMonth)}, ${MEMBERSHIP_LABELS[s]}`}>
                    <Text style={styles.historySeason}>{seasonLabel(h.season, settings.seasonStartMonth)}</Text>
                    {h.method ? <Text style={styles.muted}>{methodLabel(h.method)}</Text> : null}
                    <Chip tone={historyTone(s)}>{MEMBERSHIP_LABELS[s]}</Chip>
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        {officer ? (
          <LinkRow
            icon="settings-outline"
            title="Membership settings"
            detail="Fee, season, how members pay"
            onPress={() => router.push({ pathname: "/group/[id]/membership-settings", params: { id: String(groupId) } })}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function statusChip(status: MembershipStatus, due: string): { tone: ChipTone; label: string } {
  switch (status) {
    case "paid":
      return { tone: "ok", label: "Paid" };
    case "honorary":
      return { tone: "navy", label: "Honorary" };
    case "claimed":
      return { tone: "asked", label: "Says paid — waiting for the treasurer" };
    case "lapsed":
      return { tone: "grey", label: "Lapsed" };
    case "unpaid":
      return { tone: "due", label: `Due ${shortDate(due)}` };
  }
}

const methodLabel = (m: string) => {
  const l = (CLAIM_LABELS as Record<string, string>)[m] ?? m;
  return l.charAt(0).toUpperCase() + l.slice(1);
};

function historyTone(s: MembershipStatus): ChipTone {
  return s === "paid" ? "ok" : s === "honorary" ? "navy" : s === "claimed" ? "asked" : s === "unpaid" ? "due" : "grey";
}

function BankRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} selectable accessibilityLabel={`${label} ${value}, press and hold to copy`}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xl * 2 },
  emptyWrap: { padding: spacing.md, gap: spacing.md, alignItems: "center" },
  memberCard: { gap: 4, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.gold400, backgroundColor: colors.navy900 },
  memberTitle: { fontFamily: fonts.display, fontSize: 28, color: colors.cream50 },
  memberName: { fontFamily: fonts.bodySemi, fontSize: type.heading, color: colors.cream50 },
  memberDates: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100 },
  memberChip: { marginTop: spacing.sm },
  feeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feeLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  feeValue: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  divider: { height: 1, backgroundColor: colors.line },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  dueRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 36 },
  dueLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  dueAmount: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  totalLabel: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  totalAmount: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.red600 },
  payCard: { gap: spacing.sm + 2, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.gold400, backgroundColor: "#fbf3df" },
  payKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: "#7a5a12" },
  payAmount: { fontFamily: fonts.display, fontSize: 26, color: colors.navy900 },
  payNote: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  claim: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface },
  claimText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  revolut: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 14, borderRadius: radii.md, backgroundColor: colors.navy900 },
  revolutMark: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  revolutTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  revolutSub: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100 },
  bank: { gap: 6, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface },
  wayTitle: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  row: { flexDirection: "row", gap: spacing.sm },
  rowLabel: { width: 76, fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  rowValue: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  mono: { letterSpacing: 0.5 },
  hint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  cash: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cashText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48 },
  historyLine: { borderTopWidth: 1, borderTopColor: colors.line },
  historySeason: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
});
