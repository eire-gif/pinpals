import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ImageBackground, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";

import { Avatar } from "@/components/avatar";
import { GroupIcon, RoleBadge, SectionTitle, membersLabel } from "@/components/group-bits";
import { useAgeAccess } from "@/lib/age";
import { GroupPastResults } from "@/components/group-past-results";
import { GroupChatCard } from "@/components/group-chat-card";
import { AddMembersDropdown } from "@/components/group-add-members";
import { TONES } from "@/components/live-scoring-card";
import { TintedHeader } from "@/components/tinted-header";
import { groupLine } from "@/lib/group-chat-rules";
import { LoadError, StateMessage } from "@/components/state-message";
import { TwoPane } from "@/components/two-pane";
import { FULL_WIDTH_CONTENT, pageColumn, useWideLayout } from "@/lib/content-width";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { GROUP_KIND_INFO, GROUP_OFFICE_LABELS, GROUP_OFFICES, canStyleGroup, groupCan, hasEvents, joinState, officeAreas, roleLabel, type GroupRole, type GroupSettings, type SocietyArea } from "@/lib/groups";
import { PHOTO_PICKER_OPTIONS, preparePhotoForUpload } from "@/lib/photo-picking";
import {
  canDrawFrom,
  leaveGroup,
  loadGroupPage,
  removeGroupImage,
  removeMember,
  requestToJoin,
  respondToInvitation,
  reviewRequest,
  setGroupMuted,
  setMemberOffice,
  setMemberRole,
  uploadGroupImage,
  withdrawRequest,
  type GroupImage,
  type GroupMember,
  type GroupPage,
} from "@/lib/groups-data";
import { irishToday } from "@/lib/outing-rules";
import { listOutings } from "@/lib/outings";
import { indexLabel } from "@/lib/live-scoring";
import { listNotices, loadMembershipSettings, myDues, mySocietyHandicap, type Due, type Notice } from "@/lib/society";
import { Chip, euro } from "@/components/society-bits";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/** What's on its way to a group's page, in the order it arrives (steps C–E). */
const COMING = [
  { icon: "images-outline", label: "Posts" },
  { icon: "golf-outline", label: "Tee times" },
  { icon: "calendar-outline", label: "Events" },
] as const;

/**
 * A group's page (0120).
 *
 * For a member: the group's chat (crews and trips, 0181), who's in it, the
 * invite button, and — for whoever runs it — the join requests and each
 * member's role. For anyone else: the
 * front page only (name, kind, size, about) and the one button that fits,
 * which joinState() in lib/groups.ts decides.
 *
 * Posts, tee times and events show as "soon": they're the next steps of the
 * groups plan (claude/groups-architecture.md), and showing where they'll be
 * tells a secretary the page is going somewhere.
 */
export default function GroupScreen() {
  const { id: rawId, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const { allows: ageAllows } = useAgeAccess();
  const userId = session?.user?.id ?? null;
  const [page, setPage] = useState<GroupPage | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // iPad on its side: the page in two columns (stage 2, claude/ipad.md).
  const wide = useWideLayout();
  /** Upcoming events and your tee times among them (0125; crews and trips since 0129). */
  const [outingCounts, setOutingCounts] = useState<{ upcoming: number; mine: number; teeTimes: number } | null>(null);
  /** A society's extras (0143–0145): what you owe, the latest notice, your society handicap, membership. */
  const [extras, setExtras] = useState<{ dues: Due[]; notice: Notice | null; noticeCount: number; handicap: number | null; membership: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(groupId) || groupId <= 0 || !isOn("groups")) {
      setPage(null);
      return;
    }
    try {
      const p = await loadGroupPage(groupId, userId);
      setPage(p);
      setFailed(false);
      if (p && hasEvents(p.group.kind) && p.myRole) {
        const list = await listOutings(groupId, userId, { fromDate: irishToday() }).catch(() => null);
        const open = list?.filter((o) => o.status === "open") ?? null;
        setOutingCounts(
          open
            ? { upcoming: open.length, mine: open.filter((o) => o.mine).length, teeTimes: open.filter((o) => o.mine && o.myTeeGroup != null && o.drawPublishedAt).length }
            : null
        );
      }
      if (p && p.group.kind === "society" && p.myRole) {
        const [dues, notices, hc, ms] = await Promise.all([
          myDues(groupId).catch(() => []),
          listNotices(groupId, 5).catch(() => []),
          mySocietyHandicap(groupId).catch(() => null),
          loadMembershipSettings(groupId).catch(() => null),
        ]);
        setExtras({ dues, notice: notices[0] ?? null, noticeCount: notices.length, handicap: hc?.index ?? null, membership: !!ms?.enabled });
      }
    } catch {
      setFailed(true);
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // ---- Cover photo and logo (0124) ----
  async function pickImage(which: GroupImage, source: "camera" | "library") {
    const permission =
      source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(source === "camera" ? "Camera is off" : "Photos are off", "PinPals needs this to set the group's picture. You can turn it on in Settings.", [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    // A logo is cropped square on the phone; a cover keeps its shape.
    const options = which === "logo" ? { ...PHOTO_PICKER_OPTIONS, allowsEditing: true, aspect: [1, 1] as [number, number] } : PHOTO_PICKER_OPTIONS;
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await act(which, async () => {
      const file = await preparePhotoForUpload({
        uri: asset.uri,
        name: asset.fileName ?? `${which}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
        width: asset.width,
        height: asset.height,
      });
      await uploadGroupImage(groupId, which, file);
    });
  }

  function imageMenu(which: GroupImage, current: string | null) {
    const cover = which === "cover";
    Alert.alert(
      cover ? "Cover photo" : "Logo",
      cover ? "The picture across the top of the group's page — your home course, a day out." : "The group's badge, shown on its page and wherever it's listed.",
      [
        { text: "Take a photo", onPress: () => void pickImage(which, "camera") },
        { text: "Choose from library", onPress: () => void pickImage(which, "library") },
        ...(current
          ? [{ text: cover ? "Remove the cover" : "Remove the logo", style: "destructive" as const, onPress: () => void act(which, () => removeGroupImage(groupId, which)) }]
          : []),
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  }

  /** Runs a change, then reloads; shows the database's message on failure. */
  async function act(key: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(key);
    try {
      await fn();
      after?.();
      await load();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (page === undefined && !failed) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Group", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={styles.spinner} />
      </View>
    );
  }
  if (failed && !page) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Group", headerBackTitle: "Back" }} />
        <LoadError onRetry={() => void load()} what="this group" size="screen" />
      </View>
    );
  }
  if (!page) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Group", headerBackTitle: "Back" }} />
        <StateMessage icon="people-outline" title="This group isn't available" body="It may have been deleted, or it's invite only." size="screen" />
      </View>
    );
  }

  const { group, myRole, myPending, members, requests } = page;
  const society = group.kind === "society";
  /** Owner or admin — in a society, the owner, captain and secretary. */
  const runsIt = myRole === "owner" || myRole === "admin";
  const info = GROUP_KIND_INFO[group.kind];
  const settings: GroupSettings = { privacy: group.privacy, features: group.features as GroupSettings["features"], membersCanPost: true, membersCanInvite: group.membersCanInvite };
  const can = (action: Parameters<typeof groupCan>[1]) => groupCan(myRole, action, settings);
  const door = joinState({
    privacy: group.privacy,
    isMember: myRole !== null,
    invited: myPending === "invite",
    requested: myPending === "request",
    blockedByAdmin: false,
    full: group.memberCount >= info.maxMembers,
  });
  const detail = [info.label, membersLabel(group.memberCount), group.clubName].filter(Boolean).join(" · ");
  const canStyle = canStyleGroup(group.kind, myRole, page.myOffice);
  /** Your committee areas (0144): the same rule as the database's society_can. */
  const areas: SocietyArea[] = society ? officeAreas(myRole, page.myOffice) : [];
  const owed = (extras?.dues ?? []).reduce((a, d) => a + d.amountCents, 0);
  const go = (pathname: string, params: Record<string, string> = {}) => router.push({ pathname, params: { id: String(groupId), ...params } } as never);

  // Junior members (0159): under 18s are in groups as members only, with no
  // group chat (chat is 18+). A minor viewer never holds owner/admin, so the
  // role and office options below never show for them. The app can't tell
  // another member's age band, so "Make admin / captain" still shows on a
  // minor's row for an owner; age_guard refuses it with "Members under 18
  // can't run a group", shown by act().
  const chatAllowed = ageAllows("chat");

  function memberMenu(m: GroupMember) {
    if (m.id === userId) {
      // The owner of a society can hold an office themselves.
      if (myRole === "owner" && society) {
        const mine = GROUP_OFFICES.filter((o) => o !== m.office).map((office) => ({
          text: `Make me ${GROUP_OFFICE_LABELS[office].toLowerCase()}`,
          onPress: () => void act(`office-${m.id}`, () => setMemberOffice(groupId, m.id, office)),
        }));
        const off = m.office ? [{ text: `Stand down as ${GROUP_OFFICE_LABELS[m.office].toLowerCase()}`, onPress: () => void act(`office-${m.id}`, () => setMemberOffice(groupId, m.id, null)) }] : [];
        Alert.alert("You", undefined, [...mine, ...off, { text: "Cancel", style: "cancel" }]);
      }
      return;
    }
    const profile = { text: "View profile", onPress: () => router.push({ pathname: "/member/[id]", params: { id: m.id } }) };
    const options: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [profile];
    const set = (role: GroupRole, label: string) =>
      options.push({ text: label, onPress: () => void act(`role-${m.id}`, () => setMemberRole(groupId, m.id, role)) });

    if (myRole === "owner" && society) {
      // 0122: a society's owner appoints its captain and secretary (one of
      // each — a new one stands the old one down).
      for (const office of GROUP_OFFICES) {
        if (m.office === office) continue;
        const current = office === "event_organiser" ? undefined : members.find((x) => x.office === office);
        options.push({
          text: `Make ${GROUP_OFFICE_LABELS[office].toLowerCase()}`,
          onPress: () => {
            const go = () => void act(`office-${m.id}`, () => setMemberOffice(groupId, m.id, office));
            if (current) {
              Alert.alert(`Make ${m.name} ${GROUP_OFFICE_LABELS[office].toLowerCase()}?`, `${current.id === userId ? "You stand" : `${current.name} stands`} down as ${GROUP_OFFICE_LABELS[office].toLowerCase()}.`, [
                { text: "Cancel", style: "cancel" },
                { text: "Appoint", onPress: go },
              ]);
            } else go();
          },
        });
      }
      if (m.office) {
        options.push({ text: `Stand down as ${GROUP_OFFICE_LABELS[m.office].toLowerCase()}`, onPress: () => void act(`office-${m.id}`, () => setMemberOffice(groupId, m.id, null)) });
      } else if (m.role === "admin") {
        set("member", "Remove as admin");
      }
    }
    if (myRole === "owner") {
      if (!society && m.role === "member") set("admin", "Make admin");
      if (!society && m.role === "admin") set("member", "Remove as admin");
      options.push({
        text: "Hand the group to them",
        onPress: () =>
          Alert.alert(`Hand ${group.name} to ${m.name}?`, "They'll become the owner and you'll become an admin.", [
            { text: "Cancel", style: "cancel" },
            { text: "Hand over", onPress: () => void act(`role-${m.id}`, () => setMemberRole(groupId, m.id, "owner")) },
          ]),
      });
    }
    if (myRole === "owner" || (myRole === "admin" && m.role === "member")) {
      options.push({
        text: "Remove from group",
        style: "destructive",
        onPress: () =>
          Alert.alert(`Remove ${m.name}?`, `They'll be taken out of ${group.name}.`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => void act(`remove-${m.id}`, () => removeMember(groupId, m.id)) },
          ]),
      });
    }
    if (options.length === 1) {
      profile.onPress();
      return;
    }
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert(m.name, undefined, options);
  }

  function leave() {
    if (myRole === "owner" && group.memberCount > 1) {
      Alert.alert("Hand it over first", "Someone has to run the group. Make another member the owner (tap their name), then you can leave — or delete the group in Settings.");
      return;
    }
    const last = myRole === "owner";
    Alert.alert(last ? `Leave and delete ${group.name}?` : `Leave ${group.name}?`, last ? "You're the only one in it, so it will be deleted." : undefined, [
      { text: "Cancel", style: "cancel" },
      { text: last ? "Delete" : "Leave", style: "destructive", onPress: () => void act("leave", () => leaveGroup(groupId), () => router.back()) },
    ]);
  }

  return (
    <View style={styles.fill}>
      {/* The name in a green bar, as on Groups & Societies (Oct 2026), so the
          page starts a hero's height higher. */}
      <TintedHeader color={TONES.green.card} title={group.name} subtitle={groupLine(group, irishToday())} />
      <Stack.Screen options={{ contentStyle: FULL_WIDTH_CONTENT }} />
      <ScrollView
        contentContainerStyle={[styles.body, pageColumn(wide)]}
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
        {group.coverUrl ? (
          <ImageBackground source={{ uri: group.coverUrl }} style={styles.cover} imageStyle={styles.coverImage} resizeMode="cover" accessibilityIgnoresInvertColors>
            <View style={styles.coverVeil} />
            {canStyle ? (
              <Pressable onPress={() => imageMenu("cover", group.coverUrl)} disabled={busy !== null} style={styles.coverButton} accessibilityRole="button" accessibilityLabel="Change the cover photo">
                {busy === "cover" ? <ActivityIndicator size="small" color={colors.cream50} /> : <Ionicons name="camera" size={16} color={colors.cream50} />}
                <Text style={styles.coverButtonText}>{busy === "cover" ? "Saving" : "Cover"}</Text>
              </Pressable>
            ) : null}
          </ImageBackground>
        ) : canStyle ? (
          <Pressable onPress={() => imageMenu("cover", null)} disabled={busy !== null} style={styles.addCover} accessibilityRole="button" accessibilityLabel="Add a cover photo">
            {busy === "cover" ? <ActivityIndicator color={colors.navy900} /> : <Ionicons name="image-outline" size={20} color={colors.navy900} />}
            <Text style={styles.addCoverText}>{busy === "cover" ? "Saving…" : "Add a cover photo"}</Text>
          </Pressable>
        ) : null}

        <TwoPane
          wide={wide}
          left={
        <>
        <View style={[styles.hero, group.coverUrl ? styles.heroOnCover : null]}>
          <Pressable
            onPress={() => imageMenu("logo", group.logoUrl)}
            disabled={!canStyle || busy !== null}
            style={group.coverUrl ? styles.logoRing : null}
            accessibilityRole={canStyle ? "button" : "image"}
            accessibilityLabel={canStyle ? "Change the group's logo" : `${group.name} logo`}
          >
            <GroupIcon kind={group.kind} size={group.coverUrl ? 76 : 64} logoUrl={group.logoUrl} />
            {canStyle ? (
              <View style={styles.logoEdit}>
                {busy === "logo" ? <ActivityIndicator size="small" color={colors.cream50} /> : <Ionicons name="camera" size={13} color={colors.cream50} />}
              </View>
            ) : null}
          </Pressable>
          {/* The name is in the bar above; the kind, size and club stay here. */}
          <Text style={styles.detail}>{detail}</Text>
          {group.about ? <Text style={styles.about}>{group.about}</Text> : null}
        </View>

        {/* What joining a crew or trip brings (0181): its chat, from the start. */}
        {(door === "invited" || door === "join") && !society && chatAllowed && group.features.includes("chat") ? (
          <View style={styles.gives}>
            <Text style={styles.givesTitle}>JOINING GIVES YOU</Text>
            <View style={styles.givesRow}>
              <Ionicons name="chatbubbles-outline" size={18} color={colors.green700} />
              <Text style={styles.givesText}>
                <Text style={styles.givesStrong}>{group.kind === "trip" ? "The trip chat" : "The group chat"}</Text>, from the start — catch up on everything said so far
              </Text>
            </View>
            <View style={styles.givesRow}>
              <Ionicons name="calendar-outline" size={18} color={colors.green700} />
              <Text style={styles.givesText}>
                <Text style={styles.givesStrong}>{group.kind === "trip" ? "The itinerary" : "Rounds and events"}</Text>
                {group.kind === "trip" ? ", with courses, tee times and payments" : ", with who's in and how to pay"}
              </Text>
            </View>
          </View>
        ) : null}
        {/* The one button for someone outside the group. */}
        {door === "invited" ? (
          <View style={styles.row}>
            <Pressable style={[styles.button, styles.buttonMain]} onPress={() => void act("join", () => respondToInvitation(groupId, true))} disabled={busy !== null} accessibilityRole="button">
              <Text style={styles.buttonMainText}>{busy === "join" ? "Joining…" : "Join group"}</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void act("decline", () => respondToInvitation(groupId, false), () => router.back())} disabled={busy !== null} accessibilityRole="button">
              <Text style={styles.buttonText}>Decline</Text>
            </Pressable>
          </View>
        ) : door === "request" || door === "join" ? (
          <Pressable
            style={[styles.button, styles.buttonMain]}
            onPress={() =>
              void act("ask", async () => {
                const result = await requestToJoin(groupId);
                if (result === "requested") Alert.alert("Request sent", `Whoever runs ${group.name} will be told. You'll hear when you're in.`);
              })
            }
            disabled={busy !== null}
            accessibilityRole="button"
          >
            <Text style={styles.buttonMainText}>{busy === "ask" ? "Sending…" : door === "join" ? "Join group" : "Ask to join"}</Text>
          </Pressable>
        ) : door === "requested" ? (
          <View style={styles.note}>
            <Ionicons name="time-outline" size={20} color={colors.navy900} />
            <Text style={styles.noteText}>You&apos;ve asked to join. Whoever runs the group will let you in.</Text>
            <Pressable onPress={() => void act("withdraw", () => withdrawRequest(groupId))} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.link}>Withdraw</Text>
            </Pressable>
          </View>
        ) : door === "closed" ? (
          <View style={styles.note}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.navy900} />
            <Text style={styles.noteText}>This group isn&apos;t taking new members.</Text>
          </View>
        ) : null}

        {myRole ? (
          <>
            {fresh === "1" && group.memberCount === 1 ? (
              <View style={styles.tip}>
                <Text style={styles.tipTitle}>{society ? "Now bring your golfers in" : group.kind === "trip" ? "Your trip chat is ready" : "Your group chat is ready"}</Text>
                <Text style={styles.tipBody}>
                  {society
                    ? "Invite PinPals you're connected with, or share the society's link in your society's WhatsApp group — anyone with it joins straight in."
                    : "Invite PinPals you're connected with, or share the link — everyone who joins is in the chat straight away, and sees everything said so far."}
                </Text>
              </View>
            ) : null}

            {/* The group's chat (0181), first thing on the page: it opens with
                the group and everyone who joins is in it. Not for under 18s. */}
            {group.conversationId && chatAllowed && !society ? (
              <GroupChatCard conversationId={group.conversationId} trip={group.kind === "trip"} memberCount={group.memberCount} />
            ) : null}

            {can("invite") ? (
              <View style={styles.row}>
                <Pressable style={[styles.button, styles.buttonMain]} onPress={() => router.push({ pathname: "/group/[id]/invite", params: { id: String(groupId) } })} accessibilityRole="button">
                  <Ionicons name="person-add-outline" size={18} color={colors.cream50} />
                  <Text style={styles.buttonMainText}>Invite</Text>
                </Pressable>
                {/* Find PinPals: whoever runs the group searches every member
                    and invites them (0122); anyone else finds people to
                    connect with first, in the members directory. */}
                <Pressable
                  style={styles.button}
                  onPress={() => (runsIt ? router.push({ pathname: "/group/[id]/invite", params: { id: String(groupId), find: "1" } }) : router.push("/members"))}
                  accessibilityRole="button"
                  accessibilityLabel="Find PinPals to add to the group"
                >
                  <Ionicons name="search" size={18} color={colors.navy900} />
                  <Text style={styles.buttonText}>Find PinPals</Text>
                </Pressable>
              </View>
            ) : society ? (
              <Text style={styles.hint}>The captain or secretary brings new members in — ask them, or share the society&apos;s name so golfers can find it.</Text>
            ) : null}
            {society && extras ? (
              <>
                {owed > 0 ? (
                  <Pressable
                    style={styles.owe}
                    onPress={() => {
                      const first = extras.dues[0];
                      if (first?.kind === "membership" || !first?.outingId) go("/group/[id]/membership");
                      else go("/group/[id]/outing/[outingId]", { outingId: String(first.outingId) });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`What you owe, ${euro(owed)}`}
                  >
                    <View style={styles.oweTop}>
                      <Text style={styles.oweKicker}>WHAT YOU OWE</Text>
                      <Text style={styles.oweTotal}>{euro(owed)}</Text>
                    </View>
                    {extras.dues.slice(0, 4).map((d, i) => (
                      <View key={i} style={styles.oweRow}>
                        <Text style={styles.oweLabel} numberOfLines={1}>
                          {d.label}
                        </Text>
                        <Text style={styles.oweAmount}>{d.claimed ? "Says paid" : euro(d.amountCents)}</Text>
                      </View>
                    ))}
                    <Text style={styles.oweHint}>Tap to see how to pay</Text>
                  </Pressable>
                ) : null}

                {extras.notice ? (
                  <Pressable style={[styles.notice, extras.notice.pinned && styles.noticePinned]} onPress={() => go("/group/[id]/noticeboard")} accessibilityRole="button" accessibilityLabel={`Noticeboard: ${extras.notice.title}`}>
                    <View style={styles.oweTop}>
                      <Text style={styles.noticeKicker}>{extras.notice.pinned ? "NOTICEBOARD · PINNED" : "NOTICEBOARD"}</Text>
                      {extras.notice.kind === "change" ? <Chip tone="wait">Change</Chip> : null}
                    </View>
                    <Text style={styles.noticeTitle}>{extras.notice.title}</Text>
                    {extras.notice.body ? (
                      <Text style={styles.noticeBody} numberOfLines={2}>
                        {extras.notice.body}
                      </Text>
                    ) : null}
                  </Pressable>
                ) : null}

                {extras.handicap != null ? (
                  <Text style={styles.hint}>{`The society plays you off ${indexLabel(extras.handicap)}.`}</Text>
                ) : null}

                {areas.length > 0 ? (
                  <View style={styles.committee}>
                    <View style={styles.oweTop}>
                      <Text style={styles.committeeKicker}>RUN THE SOCIETY</Text>
                      <Text style={styles.committeeHint}>Committee only</Text>
                    </View>
                    <View style={styles.committeeRow}>
                      {areas.includes("people") || areas.includes("money") ? <CommitteeTool icon="people-outline" label="Members" onPress={() => go("/group/[id]/committee")} /> : null}
                      {areas.includes("money") ? <CommitteeTool icon="cash-outline" label="Money" onPress={() => go("/group/[id]/money")} /> : null}
                      {areas.includes("messages") ? <CommitteeTool icon="paper-plane-outline" label="Message" onPress={() => go("/group/[id]/message")} /> : null}
                      <CommitteeTool icon="download-outline" label="Export" onPress={() => go("/group/[id]/exports")} />
                      {runsIt ? <CommitteeTool icon="card-outline" label="Membership" onPress={() => go("/group/[id]/membership-settings")} /> : null}
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            <View style={styles.tools}>
              {can("edit_group") ? (
                <Pressable style={styles.tool} onPress={() => router.push({ pathname: "/group/[id]/settings", params: { id: String(groupId) } })} accessibilityRole="button">
                  <Ionicons name="settings-outline" size={18} color={colors.navy900} />
                  <Text style={styles.buttonText} numberOfLines={1}>Settings</Text>
                </Pressable>
              ) : null}
              {society && areas.includes("handicaps") ? (
                <Pressable style={styles.tool} onPress={() => router.push({ pathname: "/group/[id]/handicaps", params: { id: String(groupId) } })} accessibilityRole="button">
                  <Ionicons name="stats-chart-outline" size={18} color={colors.navy900} />
                  <Text style={styles.buttonText} numberOfLines={1}>Handicaps</Text>
                </Pressable>
              ) : null}
              {myRole ? (
                <Pressable
                  style={styles.tool}
                  onPress={() => router.push({ pathname: "/group/[id]/contacts", params: { id: String(groupId) } })}
                  accessibilityRole="button"
                  accessibilityLabel={runsIt ? "Phone numbers members have shared with you" : "Phone numbers of the people who run this group"}
                >
                  <Ionicons name="call-outline" size={18} color={colors.navy900} />
                  <Text style={styles.buttonText} numberOfLines={1}>Phone numbers</Text>
                </Pressable>
              ) : null}
            </View>
            {myRole && canDrawFrom({ kind: group.kind, role: myRole, office: page.myOffice }) && isOn("liveScoring") ? (
              <Pressable
                style={styles.play}
                onPress={() => router.push({ pathname: "/live/day/group", params: { group: String(groupId) } })}
                accessibilityRole="button"
                accessibilityLabel="Start a round. Draw the group into tee groups or teams and score it live."
              >
                <Ionicons name="shuffle" size={20} color={colors.navy900} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.playTitle}>Start a round</Text>
                  <Text style={styles.playHint}>Draw into groups or teams, scored live</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.navy900} />
              </Pressable>
            ) : null}

            <View style={styles.soon}>
              {COMING.map((c) => {
                // Tee times and Events are live for societies (0125) and,
                // since 0129, crews and trips; posts are still to come.
                const liveTile = hasEvents(group.kind) && c.label !== "Posts";
                if (!liveTile) {
                  return (
                    <View key={c.label} style={styles.soonItem} accessibilityLabel={`${c.label}, coming soon`}>
                      <Ionicons name={c.icon} size={18} color={colors.ink500} />
                      <Text style={styles.soonLabel}>{c.label}</Text>
                      <Text style={styles.soonTag}>Soon</Text>
                    </View>
                  );
                }
                const events = c.label === "Events";
                const sub = outingCounts
                  ? events
                    ? outingCounts.upcoming === 0
                      ? "None yet"
                      : `${outingCounts.upcoming} coming up`
                    : outingCounts.teeTimes === 0
                      ? outingCounts.mine > 0
                        ? "Draw to come"
                        : "None yet"
                      : `${outingCounts.teeTimes} yours`
                  : " ";
                const hot = events ? (outingCounts?.upcoming ?? 0) > 0 : (outingCounts?.teeTimes ?? 0) > 0;
                return (
                  <Pressable
                    key={c.label}
                    style={[styles.soonItem, styles.liveItem, hot && styles.liveItemHot]}
                    onPress={() => router.push({ pathname: events ? "/group/[id]/events" : "/group/[id]/tee-times", params: { id: String(groupId) } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.label}, ${sub}`}
                  >
                    <Ionicons name={c.icon} size={18} color={hot ? colors.green800 : colors.navy900} />
                    <Text style={[styles.soonLabel, styles.liveLabel]}>{c.label}</Text>
                    <Text style={[styles.soonTag, hot && styles.liveTagHot]}>{sub}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* A society's second row of boxes (0143–0145): every member sees
                the noticeboard and order of merit, and membership when the
                society charges it (the committee always, to switch it on). */}
            {society && myRole ? (
              <View style={styles.soon}>
                <Pressable style={[styles.soonItem, styles.liveItem]} onPress={() => go("/group/[id]/noticeboard")} accessibilityRole="button" accessibilityLabel="Noticeboard and alerts">
                  <Ionicons name="megaphone-outline" size={18} color={colors.navy900} />
                  <Text style={[styles.soonLabel, styles.liveLabel]}>Noticeboard</Text>
                  <Text style={styles.soonTag}>{extras?.noticeCount ? `${extras.noticeCount}${extras.noticeCount >= 5 ? "+" : ""} posts` : "Alerts"}</Text>
                </Pressable>
                <Pressable style={[styles.soonItem, styles.liveItem]} onPress={() => go("/group/[id]/merit")} accessibilityRole="button" accessibilityLabel="Order of merit">
                  <Ionicons name="podium-outline" size={18} color={colors.navy900} />
                  <Text style={[styles.soonLabel, styles.liveLabel]}>Order of merit</Text>
                  <Text style={styles.soonTag}>Season table</Text>
                </Pressable>
                {extras?.membership || runsIt ? (
                  <Pressable
                    style={[styles.soonItem, styles.liveItem, extras?.dues.some((d) => d.kind === "membership") && styles.oweTile]}
                    onPress={() => go("/group/[id]/membership")}
                    accessibilityRole="button"
                    accessibilityLabel="Annual membership"
                  >
                    <Ionicons name="card-outline" size={18} color={colors.navy900} />
                    <Text style={[styles.soonLabel, styles.liveLabel]}>Membership</Text>
                    <Text style={styles.soonTag}>{extras?.membership ? (extras.dues.some((d) => d.kind === "membership") ? "Due" : "Paid up") : "Off"}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

          </>
        ) : null}
        </>
          }
          right={
        myRole ? (
          <>
            {/* Past results (0138): competitions published to this group. */}
            {myRole !== null && isOn("liveScoring") ? <GroupPastResults groupId={groupId} /> : null}

            {requests.length > 0 ? (
              <>
                <SectionTitle>{`Asking to join (${requests.length})`}</SectionTitle>
                {requests.map((r) => (
                  <View key={r.id} style={styles.person}>
                    <Pressable style={styles.personMain} onPress={() => router.push({ pathname: "/member/[id]", params: { id: r.id } })} accessibilityRole="button">
                      <Avatar url={r.avatarUrl} color={r.avatarColor} name={r.name} size={40} />
                      <View style={styles.personBody}>
                        <Text style={styles.personName} numberOfLines={1}>
                          {r.name}
                        </Text>
                        {r.homeClub ? (
                          <Text style={styles.personPlace} numberOfLines={1}>
                            {r.homeClub}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                    <Pressable style={[styles.pill, styles.pillMain]} onPress={() => void act(`ok-${r.id}`, () => reviewRequest(groupId, r.id, true))} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`Approve ${r.name}`}>
                      <Text style={styles.pillMainText}>Approve</Text>
                    </Pressable>
                    <Pressable style={styles.pill} onPress={() => void act(`no-${r.id}`, () => reviewRequest(groupId, r.id, false))} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`Decline ${r.name}`}>
                      <Text style={styles.pillText}>Decline</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}

            <SectionTitle>{`Members (${members.length})`}</SectionTitle>
            {/* Add members right here (Oct 2026): tick your PinPals, they get an alert to join. */}
            {can("invite") && userId ? (
              <AddMembersDropdown groupId={groupId} userId={userId} memberIds={members.map((m) => m.id)} onSent={() => void load()} />
            ) : null}
            {members.map((m) => (
              <Pressable key={m.id} style={styles.person} onPress={() => memberMenu(m)} accessibilityRole="button" accessibilityLabel={`${m.name}${roleLabel(m.role, m.office) ? `, ${roleLabel(m.role, m.office)}` : ""}`}>
                <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.name} size={40} />
                <View style={styles.personBody}>
                  <Text style={styles.personName} numberOfLines={1}>
                    {m.id === userId ? `${m.name} (you)` : m.name}
                  </Text>
                  {m.homeClub ? (
                    <Text style={styles.personPlace} numberOfLines={1}>
                      {m.homeClub}
                    </Text>
                  ) : null}
                </View>
                <RoleBadge role={m.role} office={m.office} />
              </Pressable>
            ))}

            {society ? (
              <Text style={[styles.hint, styles.privacy]}>
                The society&apos;s owner, captain, secretary and handicap secretary can see each member&apos;s handicap and unofficial PinPals handicap indicator, to set the handicaps the society plays off. The treasurer sees who has paid.
              </Text>
            ) : null}

            <View style={styles.setting}>
              <View style={styles.settingBody}>
                <Text style={styles.settingTitle}>Mute this group</Text>
                <Text style={styles.settingHint}>No alerts about join requests or activity here.</Text>
              </View>
              <Switch value={page.muted} onValueChange={(v) => void act("mute", () => setGroupMuted(groupId, v))} accessibilityLabel="Mute this group" />
            </View>

            <Pressable style={styles.leave} onPress={leave} accessibilityRole="button">
              <Text style={styles.leaveText}>Leave group</Text>
            </Pressable>
          </>
        ) : null
          }
        />
      </ScrollView>
    </View>
  );
}

function CommitteeTool({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.committeeTool} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.committeeIcon}>
        <Ionicons name={icon} size={20} color={colors.cream50} />
      </View>
      <Text style={styles.committeeLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  oweTile: { borderColor: "#e7c9c5", backgroundColor: "#fbf0ee" },
  owe: { gap: 6, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: "#e7c9c5", backgroundColor: colors.surface },
  oweTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  oweKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: "#8c1d16" },
  oweTotal: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900 },
  oweRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  oweLabel: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  oweAmount: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  oweHint: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.navy900 },
  notice: { gap: 4, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  noticePinned: { borderColor: colors.gold500, backgroundColor: "#fbf4e2" },
  noticeKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: "#7e5f14" },
  noticeTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  noticeBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  committee: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  committeeKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: colors.gold400 },
  committeeHint: { fontFamily: fonts.body, fontSize: 12, color: colors.cream100 },
  committeeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  committeeTool: { alignItems: "center", gap: 4, width: 62, minHeight: 60 },
  committeeIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.navy800 },
  committeeLabel: { fontFamily: fonts.bodySemi, fontSize: 11.5, color: colors.cream50 },
  fill: { flex: 1, backgroundColor: colors.cream50 },
  spinner: { marginTop: spacing.xl },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  hero: { alignItems: "center", gap: 6, paddingVertical: spacing.md },
  // The cover runs edge to edge, out of the scroll view's padding.
  cover: { height: 190, marginHorizontal: -spacing.md, marginTop: -spacing.md, justifyContent: "flex-end" },
  coverImage: { backgroundColor: colors.navy900 },
  coverVeil: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(12,32,56,0.18)" },
  coverButton: {
    position: "absolute",
    top: spacing.sm + 4,
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: "rgba(12,32,56,0.55)",
  },
  coverButtonText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.cream50 },
  addCover: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
  },
  addCoverText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  // With a cover, the logo sits half over the photograph.
  heroOnCover: { marginTop: -54, paddingTop: 0 },
  logoRing: { padding: 4, borderRadius: 26, backgroundColor: colors.cream50 },
  logoEdit: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.navy900,
    borderWidth: 2,
    borderColor: colors.cream50,
  },
  detail: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500, textAlign: "center" },
  about: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, textAlign: "center", marginTop: spacing.xs, lineHeight: 22 },
  row: { flexDirection: "row", gap: spacing.sm },
  button: {
    flex: 1,
    height: 46,
    borderRadius: radii.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.navy900,
    backgroundColor: colors.surface,
  },
  // Settings, Handicaps, Phone numbers (Chat moved to its own card, 0181)
  // (one row of four squeezed "Phone numbers" out of its pill).
  tools: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tool: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 0,
    height: 46,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.navy900,
    backgroundColor: colors.surface,
  },
  buttonMain: { backgroundColor: colors.green700, borderColor: colors.green700 },
  buttonText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.navy900 },
  buttonMainText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  play: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.gold400,
  },
  playTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  playHint: { fontFamily: fonts.body, fontSize: type.small, color: colors.navy900 },
  hint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center" },
  privacy: { marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.cream100,
  },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  tip: { padding: spacing.md, borderRadius: radii.lg, backgroundColor: "#f6ead0", borderWidth: 1, borderColor: colors.gold400, gap: 4 },
  tipTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  tipBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, lineHeight: 20 },
  soon: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  soonItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
  },
  soonLabel: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink500 },
  soonTag: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  liveItem: { borderStyle: "solid", backgroundColor: colors.surface },
  liveItemHot: { borderColor: colors.green600, backgroundColor: colors.green100 },
  liveLabel: { color: colors.navy900 },
  liveTagHot: { color: colors.green800, fontFamily: fonts.bodySemi },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  personMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  personBody: { flex: 1, gap: 1 },
  personName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  personPlace: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  pill: { paddingHorizontal: 12, height: 36, borderRadius: radii.pill, justifyContent: "center", borderWidth: 1, borderColor: colors.navy900 },
  pillMain: { backgroundColor: colors.navy900 },
  pillText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  pillMainText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  setting: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  settingBody: { flex: 1, gap: 2 },
  settingTitle: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  settingHint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  gives: { gap: 10, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  givesTitle: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: colors.ink500 },
  givesRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  givesText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink900 },
  givesStrong: { fontFamily: fonts.bodyBold },
  leave: { alignItems: "center", paddingVertical: spacing.md },
  leaveText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.red600 },
});
