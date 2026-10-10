import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { PostCard, postCardWidth } from "@/components/post-card";
import {
  AchievementsSection,
  CoursesSection,
  HighlightsSection,
  IdentityTiles,
  ProfileTabs,
  RoundsSection,
} from "@/components/profile-sections";
import { useAuth } from "@/lib/auth";
import { loadMemberPosts, loadMemberProfile, type FeedPost, type MemberProfile } from "@/lib/feed";
import { loadMemberCourses, loadMemberRounds } from "@/lib/member-profile";
import { LoadError } from "@/components/state-message";
import { isOn } from "@/lib/features";
import { PROFILE_TAB_LABELS, identityTiles, isProfileTab, type IdentityTile, type ProfileCourse, type ProfileTab, type RoundRow } from "@/lib/profile-sections";
import { blockConfirmText, blockMember, unblockMember } from "@/lib/blocking";
import { listMemberListings, priceLine, type Card } from "@/lib/marketplace";
import { conversationWith, requestConnection, respondToConnection } from "@/lib/members";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { usePostActions } from "@/lib/use-post-actions";

type Link = { id: number; status: "pending" | "accepted" | "declined"; theirsToAnswer: boolean } | null;

/** A section's data, loaded the first time its tab is opened. */
type Sections = {
  rounds?: RoundRow[];
  courses?: { played: ProfileCourse[]; bucket: ProfileCourse[] };
  highlights?: FeedPost[];
  achievements?: FeedPost[];
};

/**
 * A member's own page — the app's version of /members/<id> on the website.
 *
 * Who they are as a golfer (phase 10): handicap if they share it, home
 * course, courses played, PinPals. Then five sections — Posts, Rounds,
 * Courses, Highlights, Achievements. Which posts any section shows is
 * decided by RLS (0088), not here: a stranger sees only what was shared with
 * all members; a connection sees the rest. The privacy rule for each piece
 * is written down in lib/profile-sections.ts.
 */
export default function MemberScreen() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const isMe = userId === id;
  const { width } = useWindowDimensions();

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [listings, setListings] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [link, setLink] = useState<Link>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Whether I have blocked this member. Only my own blocks are readable
  // (0049), which is all this screen needs to choose Block or Unblock.
  const [blocked, setBlocked] = useState(false);
  const [tab, setTab] = useState<ProfileTab>(isOn("profileSections") && isProfileTab(tabParam) ? tabParam : "posts");
  const [sections, setSections] = useState<Sections>({});
  const [sectionLoading, setSectionLoading] = useState(false);
  const [sectionFailed, setSectionFailed] = useState<ProfileTab | null>(null);

  const load = useCallback(async () => {
    if (!userId || !id) return;
    try {
      const [p, page, forSale, connection, myBlock] = await Promise.all([
        loadMemberProfile(id, userId),
        loadMemberPosts(userId, id, null),
        // A failure here leaves the row empty rather than the whole page
        // unloadable — the posts are what most people came for.
        listMemberListings(id, userId).catch(() => [] as Card[]),
        isMe
          ? Promise.resolve(null)
          : supabase
              .from("connections")
              .select("id, requester_id, recipient_id, status")
              .or(`and(requester_id.eq.${userId},recipient_id.eq.${id}),and(requester_id.eq.${id},recipient_id.eq.${userId})`)
              .maybeSingle<{ id: number; requester_id: string; recipient_id: string; status: "pending" | "accepted" | "declined" }>()
              .then(({ data }) => data),
        isMe
          ? Promise.resolve(false)
          : supabase
              .from("blocked_users")
              .select("blocked_id")
              .eq("blocker_id", userId)
              .eq("blocked_id", id)
              .maybeSingle()
              .then(({ data }) => !!data),
      ]);
      setBlocked(myBlock);
      setProfile(p);
      // A refresh starts every section again; the open one reloads below.
      setSections({});
      setSectionFailed(null);
      setPosts(page.posts);
      setListings(forSale);
      setCursor(page.cursor);
      setLink(
        connection
          ? {
              id: connection.id,
              status: connection.status,
              theirsToAnswer: connection.recipient_id === userId && connection.status === "pending",
            }
          : null
      );
    } catch (err) {
      Alert.alert("Couldn't load this page", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, id, isMe]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load the open section the first time it's needed (and after a refresh).
  useEffect(() => {
    if (!userId || !id || !profile || blocked || tab === "posts" || sections[tab] !== undefined || sectionFailed === tab) return;
    let live = true;
    setSectionLoading(true);
    const work: Promise<Partial<Sections>> =
      tab === "rounds"
        ? loadMemberRounds(id).then((rounds) => ({ rounds }))
        : tab === "courses"
          ? loadMemberCourses(id, profile.homeClubId).then((courses) => ({ courses }))
          : loadMemberPosts(userId, id, null, tab).then((page) => ({ [tab]: page.posts }));
    work
      .then((part) => live && setSections((prev) => ({ ...prev, ...part })))
      // A failure is shown as one, with Try again — never as "nothing shared".
      .catch(() => live && setSectionFailed(tab))
      .finally(() => live && setSectionLoading(false));
    return () => {
      live = false;
    };
  }, [tab, sections, sectionFailed, userId, id, profile, blocked]);

  function onTile(key: IdentityTile["key"]) {
    if (key === "courses" && isOn("profileSections")) setTab("courses");
    else if (key === "posts") setTab("posts");
    else if (key === "pinpals" && isMe) router.push("/connections");
    else if (key === "handicap" && isMe) router.push("/edit-profile");
  }

  async function more() {
    if (tab !== "posts") return;
    if (!userId || !id || !cursor) return;
    try {
      const page = await loadMemberPosts(userId, id, cursor);
      setPosts((prev) => [...prev, ...page.posts]);
      setCursor(page.cursor);
    } catch {
      // Keep what is on screen.
    }
  }

  const actions = usePostActions({
    update: (postId, change) => setPosts((prev) => prev.map((p) => (p.id === postId ? change(p) : p))),
    remove: (postId) => setPosts((prev) => prev.filter((p) => p.id !== postId)),
    reload: load,
    // Blocking this member from one of their posts reloads the page into its
    // blocked state; blocking a commenter drops their comments.
    afterBlock: (memberId) => {
      if (memberId === id) {
        void load();
        return;
      }
      setPosts((prev) => prev.map((p) => ({ ...p, comments: p.comments.filter((c) => c.author.id !== memberId) })));
    },
  });

  function block() {
    if (!profile) return;
    const { title, message } = blockConfirmText(profile.name);
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await blockMember(profile.id);
            await load();
          } catch (err) {
            Alert.alert("Couldn't block that member", err instanceof Error ? err.message : "Please try again.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function unblock() {
    if (!profile) return;
    setBusy(true);
    try {
      await unblockMember(profile.id);
      await load();
    } catch (err) {
      Alert.alert("Couldn't unblock that member", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (!userId || !id) return;
    setBusy(true);
    try {
      if (link?.theirsToAnswer) {
        await respondToConnection(link.id, userId, true);
      } else {
        await requestConnection(userId, id);
      }
      await load();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function message() {
    if (!id) return;
    setBusy(true);
    try {
      const conversation = await conversationWith(id);
      router.push({ pathname: "/conversation/[id]", params: { id: String(conversation) } });
    } catch (err) {
      Alert.alert("Couldn't open a conversation", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: "", headerBackTitle: "Back" }} />
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.green700} />
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <Stack.Screen options={{ title: "", headerBackTitle: "Back" }} />
        <Text style={styles.missing}>This member couldn&apos;t be found.</Text>
      </>
    );
  }

  const contentWidth = width - spacing.md * 2;
  const tiles = blocked
    ? []
    : identityTiles(
        {
          handicap: profile.handicap,
          privateHandicap: profile.privateHandicap,
          coursesPlayed: profile.coursesPlayed,
          pinpals: profile.pinpals,
          postCount: profile.postCount,
        },
        isMe,
      );
  const meta = [profile.place, profile.ageBand ? `Age ${profile.ageBand}` : null, profile.joined].filter(Boolean).join(" · ");

  const header = (
    <View style={styles.profile}>
      {/* Their cover photograph (0112) across the top, the face overlapping it. */}
      <Image source={profile.coverUrl ? { uri: profile.coverUrl } : MEMBER_COVER} style={styles.cover} resizeMode="cover" />
      <View style={[styles.identity, styles.identityOnCover]}>
        <View style={styles.avatarRing}>
          <Avatar url={profile.avatarUrl} color={profile.avatarColor} name={profile.name} size={80} />
        </View>
        <View style={[styles.identityText, styles.identityTextOnCover]}>
          <Text style={styles.name}>{profile.name}</Text>
          {profile.homeClub ? (
            <Pressable
              style={styles.homeRow}
              disabled={!profile.homeClubId}
              onPress={() => profile.homeClubId && router.push({ pathname: "/course/[id]", params: { id: String(profile.homeClubId) } })}
              accessibilityRole={profile.homeClubId ? "link" : undefined}
              accessibilityLabel={`Home course: ${profile.homeClub}`}
            >
              <Ionicons name="flag" size={13} color={colors.green700} />
              <Text style={styles.club} numberOfLines={1}>
                {profile.homeClub}
              </Text>
            </Pressable>
          ) : isMe ? (
            <Pressable style={styles.homeRow} onPress={() => router.push("/edit-profile")} accessibilityRole="button">
              <Ionicons name="add-circle-outline" size={14} color={colors.green700} />
              <Text style={styles.club}>Add your home course</Text>
            </Pressable>
          ) : null}
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        </View>
      </View>

      {tiles.length > 0 && <IdentityTiles tiles={tiles} onPress={onTile} />}

      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      {blocked ? (
        <View style={styles.blockedBox}>
          <Text style={styles.blockedText}>
            <Text style={styles.blockedStrong}>You&apos;ve blocked {profile.firstName}.</Text> Neither of you sees the
            other&apos;s posts or comments, or can message the other.
          </Text>
          <Pressable style={[styles.button, styles.buttonOutline]} onPress={unblock} disabled={busy}>
            <Text style={styles.buttonOutlineLabel}>{busy ? "Unblocking…" : `Unblock ${profile.firstName}`}</Text>
          </Pressable>
        </View>
      ) : (
      <View style={styles.buttons}>
        {isMe ? (
          <Pressable style={[styles.button, styles.buttonOutline]} onPress={() => router.push("/edit-profile")}>
            <Text style={styles.buttonOutlineLabel}>Edit profile</Text>
          </Pressable>
        ) : link?.status === "accepted" ? (
          <>
            <View style={[styles.button, styles.buttonQuiet]}>
              <Ionicons name="checkmark" size={16} color={colors.green700} />
              <Text style={styles.buttonQuietLabel}>Connected</Text>
            </View>
            <Pressable style={[styles.button, styles.buttonSolid]} onPress={message} disabled={busy}>
              <Text style={styles.buttonSolidLabel}>Message</Text>
            </Pressable>
          </>
        ) : link?.status === "pending" && !link.theirsToAnswer ? (
          <View style={[styles.button, styles.buttonQuiet]}>
            <Text style={styles.buttonQuietLabel}>Request sent</Text>
          </View>
        ) : (
          <Pressable style={[styles.button, styles.buttonSolid]} onPress={connect} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={colors.cream50} />
            ) : (
              <Text style={styles.buttonSolidLabel}>
                {link?.theirsToAnswer ? "Accept request" : link?.status === "declined" ? "Connect again" : "Connect"}
              </Text>
            )}
          </Pressable>
        )}
      </View>
      )}

      {/* Apple guideline 1.2: a member must be able to block someone from
          their profile as well as from what they post. Quiet, because it
          is rarely needed; a confirm says what it does. */}
      {!isMe && !blocked && (
        <Pressable onPress={block} disabled={busy} hitSlop={8} style={styles.blockLink} accessibilityRole="button">
          <Text style={styles.blockLinkText}>Block {profile.firstName}</Text>
        </Pressable>
      )}

      {/* What they're selling, right here rather than a trip to the
          website — each card opens the app's own listing screen, where
          buying, offers and messaging the seller all work natively. */}
      {listings.length > 0 && (
        <>
          <Text style={styles.section}>For sale</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.listingStrip}
            contentContainerStyle={styles.listingStripContent}
          >
            {listings.map((card) => (
              <Pressable
                key={card.id}
                style={styles.listingCard}
                onPress={() => router.push({ pathname: "/listing/[id]", params: { id: String(card.id) } })}
                accessibilityRole="link"
                accessibilityLabel={`${card.title}, ${priceLine(card).value}`}
              >
                {card.imageUrl ? (
                  <Image source={{ uri: card.imageUrl }} style={styles.listingImage} />
                ) : (
                  <View style={[styles.listingImage, styles.listingImageEmpty]}>
                    <Ionicons name="pricetag-outline" size={26} color={colors.ink500} />
                  </View>
                )}
                <Text style={styles.listingTitle} numberOfLines={2}>
                  {card.title}
                </Text>
                <Text style={styles.listingPrice}>{priceLine(card).value}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      {!blocked && isOn("profileSections") ? <ProfileTabs tab={tab} onChange={setTab} /> : null}
    </View>
  );

  const first = profile.firstName;
  const sectionBody = sectionLoading ? (
    <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.green700} />
  ) : sectionFailed === tab ? (
    <LoadError what={PROFILE_TAB_LABELS[tab].toLowerCase()} onRetry={() => setSectionFailed(null)} />
  ) : tab === "rounds" ? (
    <>
    {isOn("scorecards") ? (
      <Pressable
        onPress={() => router.push(isMe ? "/scorecards" : { pathname: "/scorecards", params: { member: id, name: first } })}
        style={({ pressed }) => [scorecardLink.row, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
      >
        <Ionicons name="document-text-outline" size={20} color={colors.green700} />
        <Text style={scorecardLink.text}>{isMe ? "My scorecards" : `${first}'s scorecards`}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
      </Pressable>
    ) : null}
    <RoundsSection
      rows={sections.rounds ?? []}
      empty={isMe ? "Rounds you share on Social are kept here, with your best and your average." : `${first} hasn't shared a round you can see yet.`}
    />
    </>
  ) : tab === "courses" ? (
    <CoursesSection
      played={sections.courses?.played ?? []}
      bucket={sections.courses?.bucket ?? []}
      empty={isMe ? "Add the courses you've played and the ones on your bucket list." : `${first} hasn't added any courses yet.`}
      onAdd={isMe ? () => router.push("/courses") : undefined}
    />
  ) : tab === "highlights" ? (
    <HighlightsSection
      isMe={isMe}
      posts={sections.highlights ?? []}
      width={contentWidth}
      empty={isMe ? "Your most-reacted posts will show here." : `Nothing of ${first}'s has had a reaction yet.`}
    />
  ) : (
    <AchievementsSection
      posts={sections.achievements ?? []}
      width={contentWidth}
      empty={
        isMe
          ? "Mark a Hole in One, an Eagle, a Personal Best or breaking 80 when you post a round or a hole, and it's kept here."
          : `${first} hasn't shared an achievement you can see yet.`
      }
    />
  );

  return (
    <>
      <Stack.Screen options={{ title: profile.firstName, headerBackTitle: "Back" }} />
      <FlatList
        style={styles.fill}
        data={tab === "posts" && !blocked ? posts : []}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListHeaderComponentStyle={{ marginBottom: tab === "posts" ? spacing.md : 0 }}
        onEndReached={more}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.green700}
          />
        }
        ListEmptyComponent={
          tab !== "posts" && !blocked ? (
            sectionBody
          ) : (
          <Text style={styles.empty}>
            {isMe
              ? "You haven't posted yet. Share your last round from the Social tab."
              : blocked
                ? `You have blocked ${profile.firstName}, so their posts are hidden.`
                : `${profile.firstName} hasn't shared anything you can see yet.`}
          </Text>
          )
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            currentMemberId={id}
            width={postCardWidth(width)}
            onLike={actions.like}
                onReact={actions.react}
                onShare={actions.share}
                onSave={actions.save}
            onMenu={actions.menu}
            onComment={(p) => router.push({ pathname: "/comments/[id]", params: { id: String(p.id), focus: "comment" } })}
            onCommentOptions={actions.commentOptions}
          />
        )}
      />
    </>
  );
}

const MEMBER_COVER = require("../../../assets/images/scenes/links-sunset.jpg");

const styles = StyleSheet.create({
  cover: { height: 150, marginHorizontal: -spacing.md, marginTop: -spacing.md, backgroundColor: colors.navy900 },
  identityOnCover: { marginTop: -34, alignItems: "flex-start" },
  identityTextOnCover: { paddingTop: 40 },
  fill: { flex: 1, backgroundColor: colors.cream50 },
  list: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  missing: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500, textAlign: "center", marginTop: spacing.xl },
  profile: { marginBottom: spacing.sm },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatarRing: { padding: 3, borderRadius: 46, borderWidth: 2, borderColor: colors.gold400, backgroundColor: colors.cream50 },
  homeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3, minHeight: 24 },
  identityText: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.display, fontSize: 26, color: colors.ink900 },
  club: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 1 },
  bio: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink900, marginTop: spacing.md },
  buttons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  button: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingVertical: spacing.sm + 4,
    minHeight: 44,
  },
  buttonSolid: { backgroundColor: colors.green700 },
  buttonSolidLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  buttonOutline: { borderWidth: 1.5, borderColor: colors.green700 },
  buttonOutlineLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  buttonQuiet: { backgroundColor: colors.green100 },
  buttonQuietLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  blockedBox: {
    marginTop: spacing.md,
    gap: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  blockedText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink500 },
  blockedStrong: { fontFamily: fonts.bodyBold, color: colors.ink900 },
  blockLink: { alignSelf: "flex-start", marginTop: spacing.sm + 2, paddingVertical: spacing.xs },
  blockLinkText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink500 },
  listingStrip: { marginTop: spacing.sm, marginHorizontal: -spacing.md },
  listingStripContent: { paddingHorizontal: spacing.md, gap: spacing.sm + 2 },
  listingCard: {
    width: 148,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.sm,
  },
  listingImage: { width: "100%", aspectRatio: 1, borderRadius: radii.md, backgroundColor: colors.cream100 },
  listingImageEmpty: { alignItems: "center", justifyContent: "center" },
  listingTitle: { fontFamily: fonts.bodyBold, fontSize: 13.5, lineHeight: 18, color: colors.ink900, marginTop: spacing.sm, minHeight: 36 },
  listingPrice: { fontFamily: fonts.display, fontSize: 16, color: colors.green700, marginTop: 2 },
  section: { fontFamily: fonts.display, fontSize: type.heading, color: colors.ink900, marginTop: spacing.lg },
  empty: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", marginTop: spacing.lg },
});

const scorecardLink = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  text: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
});
