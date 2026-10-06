import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AchievementCard } from "@/components/achievement-card";
import { HeaderPill, headerButtons } from "@/components/header-actions";
import { coursePhoto } from "@/components/course-photos";
import { PostDetailsForm } from "@/components/post-details-form";
import { RoundRecapCard } from "@/components/round-recap-card";
import { useAuth } from "@/lib/auth";
import { createPost, discardPhoto, stagePhoto, type StagedPhoto } from "@/lib/feed";
import {
  MAX_POST_BODY,
  MAX_POST_PHOTOS,
  POST_VISIBILITIES,
  POST_VISIBILITY_LABELS,
  draftProblem,
  recentDays,
  type PostVisibility,
} from "@/lib/feed-rules";
import { POST_TYPE_INFO, isPostType, type PostKind, type PostType, type RoundDetails } from "@/lib/post-details";
import { achievementOf } from "@/lib/achievements";
import { claimableAchievements, draftDetailsProblem, draftToDetails, emptyDraft, type DetailsDraft } from "@/lib/post-draft";
import { recapCaption, recapSubtitle, type RecapSource } from "@/lib/round-recap";
import { listConfirmedRounds } from "@/lib/rounds";
import { todayIso } from "@/lib/tee-times";
import { COUNTRY_NAMES, searchClubs, type ClubHit } from "@/lib/tee-time-post";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { KEYBOARD_DISMISS_MODE, KeyboardDoneButton } from "@/components/keyboard";
import { PHOTO_PICKER_OPTIONS, photoProblem, preparePhotoForUpload } from "@/lib/photo-picking";
import { videoEnabled } from "@/lib/native-capabilities";
import { discardVideo, durationLabel, stageVideo, videoProblem, type PickedVideo } from "@/lib/post-video";

type Photo = {
  id: string;
  uri: string;
  status: "uploading" | "done" | "failed";
  staged?: StagedPhoto;
  error?: string;
};

/** The one video a post can carry (0102), while it uploads. */
type Video = {
  picked: PickedVideo;
  status: "uploading" | "done" | "failed";
  /** 0–1 while uploading. */
  progress: number;
  path?: string;
  error?: string;
};

let nextId = 0;

/** What the caption box asks, per type. */
const PROMPTS: Record<PostKind | "photo", string> = {
  general: "How did the round go?",
  photo: "Say something about these photos",
  round: "Add a caption — how did it feel?",
  hole: "What happened on this hole?",
  shot: "Tell us about the shot",
};

/**
 * Sharing a post — any of the composer's types (phase 3).
 *
 * `type` arrives in the route from the Create a post menu (compose.tsx) or
 * the feed's quick chips; anything unknown is a general post. A round, hole
 * or shot adds its golf fields (post-details-form.tsx) above the usual
 * caption, photos, course and audience, and is a valid post on its golf
 * facts alone. "Photo / video" is a general post that opens the photo
 * library straight away. "Find players" never arrives here — it goes to the
 * tee-time form.
 *
 * Photos upload the moment they are picked, one request each — the same
 * shape as listing photos, for the same two reasons: a failure is one
 * thumbnail with a retry on it rather than a whole post to write again, and
 * a request to the website cannot carry six phone photos at once. Nothing
 * is visible to anyone until Post is pressed; staged photos sit in a folder
 * no member can read.
 */
export default function NewPostScreen() {
  const params = useLocalSearchParams<{ type?: string; recap?: string }>();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  // ?recap=<tee time id>: a round recap of a played tee time (phase 7).
  const recapId = params.recap && Number.isInteger(Number(params.recap)) ? Number(params.recap) : null;
  const postType: PostType = isPostType(params.type) && params.type !== "tee_time" ? params.type : "general";
  const info = POST_TYPE_INFO[postType];
  const kind: PostKind = info.kind ?? "general";
  const structured = kind !== "general";

  const [details, setDetails] = useState<DetailsDraft>(() => emptyDraft(recentDays(1)[0].iso));
  const [touched, setTouched] = useState(false);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("members");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [video, setVideo] = useState<Video | null>(null);
  const [club, setClub] = useState<ClubHit | null>(null);
  // The played round a recap is built from, once loaded; and whether the
  // member has written their own caption (then it's theirs — no more
  // suggestions overwrite it).
  const [recap, setRecap] = useState<RecapSource | null>(null);
  const [bodyEdited, setBodyEdited] = useState(false);

  useEffect(() => {
    if (!recapId || !userId) return;
    let live = true;
    listConfirmedRounds(userId)
      .then(({ past }) => {
        const round = past.find((r) => r.inviteId === recapId);
        if (!live || !round) return;
        setRecap({
          inviteId: round.inviteId,
          course: round.club,
          playDate: round.playDate,
          when: round.when,
          players: round.players.map((p) => p.name),
        });
        if (round.clubRef) setClub(round.clubRef);
        setDetails((d) => ({ ...d, played_on: round.playDate, tee_time_id: String(round.inviteId) }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [recapId, userId]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClubHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [posting, setPosting] = useState(false);

  // The suggested caption follows the numbers until the member writes their
  // own. Nothing is posted until they press Post.
  const recapDetails = recap ? ((draftToDetails("round", details) ?? {}) as Partial<RoundDetails>) : null;
  const suggested = recap && recapDetails ? recapCaption(recap, recapDetails, todayIso()) : null;
  useEffect(() => {
    if (suggested !== null && !bodyEdited) setBody(suggested);
  }, [suggested, bodyEdited]);

  useEffect(() => {
    if (club || query.trim().length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchClubs(query)
        .then((found) => live && setHits(found))
        .catch(() => live && setHits([]))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, club]);

  const upload = useCallback(async (photo: Photo, mimeType: string, fileName: string, width?: number, height?: number) => {
    try {
      // Resized on the phone first where the build can (photo-picking.ts).
      const ready = await preparePhotoForUpload({ uri: photo.uri, name: fileName, type: mimeType, width, height });
      const staged = await stagePhoto(ready);
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, status: "done", staged } : p)));
    } catch (err) {
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photo.id
            ? { ...p, status: "failed", error: err instanceof Error ? err.message : "Didn't upload" }
            : p
        )
      );
    }
  }, []);

  const startVideo = useCallback(async (picked: PickedVideo) => {
    const problem = videoProblem(picked);
    if (problem) {
      setVideo({ picked, status: "failed", progress: 0, error: problem });
      return;
    }
    setVideo({ picked, status: "uploading", progress: 0 });
    try {
      const path = await stageVideo(picked, (progress) =>
        setVideo((v) => (v && v.picked.uri === picked.uri ? { ...v, progress } : v))
      );
      setVideo((v) => (v && v.picked.uri === picked.uri ? { ...v, status: "done", progress: 1, path } : v));
    } catch (err) {
      setVideo((v) =>
        v && v.picked.uri === picked.uri
          ? { ...v, status: "failed", error: err instanceof Error ? err.message : "The video didn't upload." }
          : v
      );
    }
  }, []);

  const pick = useCallback(
    async (source: "camera" | "library") => {
      const room = MAX_POST_PHOTOS - photos.length;
      if (room <= 0 || video) return;
      // Videos (0102) only where the build has the player.
      const withVideo = videoEnabled();

      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          source === "camera" ? "Camera access is off" : "Photo access is off",
          "You can turn it on for PinPals in Settings."
        );
        return;
      }

      const videoOptions: ImagePicker.ImagePickerOptions = withVideo
        ? {
            mediaTypes: ["images", "videos"],
            // Recording stops at 30 seconds; library clips are checked after.
            videoMaxDuration: 30,
            // 720p H.264: a 30-second clip is a few megabytes.
            videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
            videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
          }
        : {};
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ ...PHOTO_PICKER_OPTIONS, ...videoOptions })
          : await ImagePicker.launchImageLibraryAsync({
              // Smaller JPEGs: see lib/photo-picking.ts.
              ...PHOTO_PICKER_OPTIONS,
              ...videoOptions,
              allowsMultipleSelection: true,
              selectionLimit: room,
            });
      if (result.canceled) return;

      const videos = result.assets.filter((a) => a.type === "video");
      if (videos.length > 0) {
        if (photos.length > 0 || result.assets.length > 1) {
          Alert.alert("Photos or a video", "A post can have photos or one video, not both. Choose a video on its own.");
          return;
        }
        const v = videos[0];
        void startVideo({
          uri: v.uri,
          fileName: v.fileName,
          mimeType: v.mimeType,
          fileSize: v.fileSize,
          duration: v.duration,
          width: v.width,
          height: v.height,
        });
        return;
      }

      const added = result.assets.slice(0, room).map((asset) => {
        // A photo that can't be sent says why at once, rather than failing
        // after an upload with a bare "Retry".
        const problem = photoProblem(asset);
        return {
          photo: problem
            ? { id: String(++nextId), uri: asset.uri, status: "failed" as const, error: problem }
            : { id: String(++nextId), uri: asset.uri, status: "uploading" as const },
          type: asset.mimeType ?? "image/jpeg",
          name: asset.fileName ?? `photo-${nextId}.jpg`,
          width: asset.width,
          height: asset.height,
        };
      });
      setPhotos((prev) => [...prev, ...added.map((a) => a.photo)]);
      for (const a of added) if (a.photo.status === "uploading") void upload(a.photo, a.type, a.name, a.width, a.height);
    },
    [photos.length, upload, video, startVideo]
  );

  function removeVideo() {
    if (video?.path) void discardVideo(video.path);
    setVideo(null);
  }

  function remove(photo: Photo) {
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    if (photo.staged) void discardPhoto(photo.staged.path);
  }

  function retry(photo: Photo) {
    const again = { ...photo, status: "uploading" as const, error: undefined };
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? again : p)));
    void upload(again, "image/jpeg", `photo-${photo.id}.jpg`);
  }

  // "Photo / video" opens on the library, once, as if Photos were tapped.
  const opened = useRef(false);
  useEffect(() => {
    if (postType !== "photo" || opened.current) return;
    opened.current = true;
    const t = setTimeout(() => void pick("library"), 350);
    return () => clearTimeout(t);
  }, [postType, pick]);

  const uploading = photos.some((p) => p.status === "uploading") || video?.status === "uploading";
  const failed = photos.some((p) => p.status === "failed") || video?.status === "failed";
  const detailsIssue = structured ? draftDetailsProblem(kind, details) : null;
  const problem = detailsIssue ?? draftProblem(body, photos.length + (video ? 1 : 0), structured);
  const canPost = !posting && !uploading && !failed && problem === null;
  const { width: screenWidth } = useWindowDimensions();
  // Phase 8: a claimed achievement previews exactly as the feed will draw it.
  const achievement =
    structured && details.achievement
      ? achievementOf({ kind, details: draftToDetails(kind, details), courseName: club?.name ?? recap?.course ?? null, createdAt: new Date().toISOString() })
      : null;

  async function post() {
    if (!canPost) return;
    setPosting(true);
    try {
      await createPost({
        body,
        visibility,
        clubId: club?.id ?? null,
        photoPaths: photos.map((p) => p.staged!.path),
        video: video?.path
          ? {
              path: video.path,
              durationMs: video.picked.duration ? Math.round(video.picked.duration) : null,
              width: video.picked.width ?? null,
              height: video.picked.height ?? null,
            }
          : null,
        kind,
        details: structured ? draftToDetails(kind, details) : null,
      });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't post that", err instanceof Error ? err.message : "Please try again.");
      setPosting(false);
    }
  }

  function cancel() {
    if (body.trim() || photos.length > 0 || video || touched) {
      Alert.alert("Discard this post?", undefined, [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            for (const p of photos) if (p.staged) void discardPhoto(p.staged.path);
            if (video?.path) void discardVideo(video.path);
            router.back();
          },
        },
      ]);
    } else {
      router.back();
    }
  }

  // Where it was played. Leads the form for a round, hole or shot — the
  // course is the first thing a golfer says about one — and follows the
  // photos on a general post, where it's an optional tag.
  const courseBlock = (
    <>
          <Text style={[styles.label, structured && styles.labelFirst]}>{structured ? "Course" : "Course (optional)"}</Text>
          {club ? (
            <Pressable style={styles.chosen} onPress={() => setClub(null)} accessibilityRole="button">
              <Ionicons name="flag" size={16} color={colors.green700} />
              <View style={styles.chosenText}>
                <Text style={styles.chosenName}>{club.name}</Text>
                <Text style={styles.chosenMeta}>
                  {[club.town, COUNTRY_NAMES[club.country] ?? club.country].filter(Boolean).join(", ")}
                </Text>
              </View>
              <Text style={styles.change}>Change</Text>
            </Pressable>
          ) : (
            <>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Where did you play?"
                placeholderTextColor={colors.ink500}
                autoCorrect={false}
                style={styles.input}
              />
              {searching && <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.sm }} />}
              {hits.slice(0, 8).map((hit) => (
                <Pressable
                  key={hit.id}
                  style={styles.hit}
                  onPress={() => {
                    setClub(hit);
                    setQuery("");
                  }}
                >
                  <Text style={styles.hitName}>{hit.name}</Text>
                  <Text style={styles.hitMeta}>
                    {[hit.town, COUNTRY_NAMES[hit.country] ?? hit.country].filter(Boolean).join(", ")}
                  </Text>
                </Pressable>
              ))}
            </>
          )}

    </>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: recap || recapId ? "Share your round" : info.title,
          // No `presentation: "modal"` here. On iOS a screen's presentation
          // cannot change after it has been pushed, and options set from
          // inside the screen arrive after the push — react-native-screens
          // treats that as a fatal error, which crashed the app the moment
          // Share a post was tapped. Pushed like List an item instead.
          ...headerButtons({
            left: <HeaderPill label="Cancel" variant="secondary" onPress={cancel} />,
            right: <HeaderPill label="Post" onPress={post} disabled={!canPost} busy={posting} />,
          }),
        }}
      />

      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardDismissMode={KEYBOARD_DISMISS_MODE} style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {recap && recapDetails ? (
            <View style={styles.recap}>
              <Text style={styles.recapIntro}>
                We&apos;ve made a recap from your round. Add your numbers and change anything you like — nothing is
                shared until you press Post.
              </Text>
              <RoundRecapCard
                course={club?.name ?? recap.course}
                subtitle={recapSubtitle(recap, recapDetails, todayIso())}
                details={recapDetails}
                photo={
                  photos[0]?.uri ? { uri: photos[0].uri } : coursePhoto(club?.id ?? null, club?.name ?? recap.course)
                }
              />
            </View>
          ) : null}

          {structured && courseBlock}

          {structured && (
            <View style={styles.details}>
              <PostDetailsForm
                kind={kind}
                draft={details}
                onChange={(next) => {
                  // A claim the numbers no longer support (the score was
                  // changed) is dropped, not left to fail on Post.
                  const still = next.achievement && claimableAchievements(kind, next).includes(next.achievement as never);
                  setDetails(still || !next.achievement ? next : { ...next, achievement: "" });
                  setTouched(true);
                }}
              />
              {achievement ? (
                <View style={styles.achievementPreview}>
                  <Text style={styles.achievementPreviewLabel}>How it will look</Text>
                  <AchievementCard
                    achievement={achievement}
                    width={screenWidth - spacing.md * 2}
                    photo={photos[0]?.uri ? { uri: photos[0].uri } : coursePhoto(club?.id ?? null, club?.name ?? null)}
                  />
                </View>
              ) : null}
              {touched && detailsIssue ? <Text style={styles.detailsHint}>{detailsIssue}</Text> : null}
            </View>
          )}

          <TextInput
            value={body}
            onChangeText={(t) => {
              setBody(t);
              if (recap) setBodyEdited(true);
            }}
            placeholder={PROMPTS[postType === "photo" ? "photo" : kind]}
            placeholderTextColor={colors.ink500}
            multiline
            maxLength={MAX_POST_BODY}
            // A round, hole or shot starts with its numbers, not the caption.
            autoFocus={!structured && postType !== "photo"}
            style={[styles.body, structured && styles.bodyShort]}
            accessibilityLabel={structured ? "Caption" : "Your post"}
          />
          {recap && bodyEdited && suggested && body !== suggested ? (
            <Text
              style={styles.suggest}
              onPress={() => {
                setBodyEdited(false);
                setBody(suggested);
              }}
              accessibilityRole="button"
              suppressHighlighting
            >
              Use the suggested caption
            </Text>
          ) : null}

          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {photos.map((photo) => (
                <View key={photo.id} style={styles.thumbWrap}>
                  <Image source={{ uri: photo.uri }} style={styles.thumb} />
                  {photo.status === "uploading" && (
                    <View style={styles.thumbOverlay}>
                      <ActivityIndicator color={colors.cream50} />
                    </View>
                  )}
                  {photo.status === "failed" && (
                    <Pressable style={[styles.thumbOverlay, styles.thumbFailed]} onPress={() => retry(photo)}>
                      <Ionicons name="refresh" size={22} color={colors.cream50} />
                      <Text style={styles.thumbFailedText}>Retry</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => remove(photo)}
                    style={styles.thumbRemove}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                  >
                    <Ionicons name="close" size={16} color={colors.cream50} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          {video ? (
            <View style={styles.videoTile}>
              <View style={styles.videoIcon}>
                <Ionicons name={video.status === "failed" ? "alert-circle" : "videocam"} size={22} color={colors.cream50} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.videoTitle}>
                  Video{durationLabel(video.picked.duration) ? ` · ${durationLabel(video.picked.duration)}` : ""}
                </Text>
                <Text style={styles.videoStatus} numberOfLines={2}>
                  {video.status === "uploading"
                    ? `Uploading… ${Math.round(video.progress * 100)}%`
                    : video.status === "done"
                      ? "Ready to post"
                      : video.error ?? "Didn't upload"}
                </Text>
                {video.status === "uploading" ? (
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.max(4, Math.round(video.progress * 100))}%` }]} />
                  </View>
                ) : null}
              </View>
              {video.status === "failed" && !videoProblem(video.picked) ? (
                <Pressable onPress={() => void startVideo(video.picked)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Try the video again">
                  <Ionicons name="refresh" size={22} color={colors.green700} />
                </Pressable>
              ) : null}
              <Pressable onPress={removeVideo} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove video">
                <Ionicons name="close-circle" size={24} color={colors.ink500} />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.pickRow}>
            <Pressable
              style={[styles.pick, (photos.length >= MAX_POST_PHOTOS || !!video) && styles.pickDisabled]}
              onPress={() => void pick("library")}
              disabled={photos.length >= MAX_POST_PHOTOS || !!video}
              accessibilityRole="button"
            >
              <Ionicons name="images-outline" size={20} color={colors.green700} />
              <Text style={styles.pickLabel}>{videoEnabled() ? "Library" : "Photos"}</Text>
            </Pressable>
            <Pressable
              style={[styles.pick, (photos.length >= MAX_POST_PHOTOS || !!video) && styles.pickDisabled]}
              onPress={() => void pick("camera")}
              disabled={photos.length >= MAX_POST_PHOTOS || !!video}
              accessibilityRole="button"
            >
              <Ionicons name="camera-outline" size={20} color={colors.green700} />
              <Text style={styles.pickLabel}>Camera</Text>
            </Pressable>
            {video ? null : (
              <Text style={styles.pickCount}>
                {photos.length}/{MAX_POST_PHOTOS}
              </Text>
            )}
          </View>

          {!structured && courseBlock}

          <Text style={styles.label}>Who can see this</Text>
          <View style={styles.audiences}>
            {POST_VISIBILITIES.map((v) => {
              const active = v === visibility;
              return (
                <Pressable
                  key={v}
                  onPress={() => setVisibility(v)}
                  style={[styles.audience, active && styles.audienceActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={v === "members" ? "people-outline" : "person-circle-outline"}
                    size={20}
                    color={active ? colors.cream50 : colors.green700}
                  />
                  <Text style={[styles.audienceLabel, active && styles.audienceLabelActive]}>{POST_VISIBILITY_LABELS[v]}</Text>
                </Pressable>
              );
            })}
          </View>

          {failed && (
            <Text style={styles.warn}>
              {/* Say why, not just that it failed: "too large" and "no
                  signal" need different things from the member. */}
              {video?.status === "failed"
                ? video.error ?? "The video didn't upload."
                : photos.find((p) => p.status === "failed")?.error ?? "A photo didn't upload."}{" "}
              {video?.status === "failed" ? "Remove it or try again, then post." : "Retry or remove it, then post."}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Closes the keyboard from the multi-line fields (Return adds a line). */}
      <KeyboardDoneButton />
    </>
  );
}

const styles = StyleSheet.create({
  videoTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.sm + 4,
    marginTop: spacing.sm,
  },
  videoIcon: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  videoTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  videoStatus: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 1 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.cream100, marginTop: 6, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.green700 },
  achievementPreview: { marginTop: spacing.md, gap: spacing.sm },
  achievementPreviewLabel: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 0.8, color: colors.ink500, textTransform: "uppercase" },
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  body: {
    minHeight: 120,
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 24,
    color: colors.ink900,
    textAlignVertical: "top",
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  bodyShort: { minHeight: 84 },
  recap: { gap: spacing.sm + 2, marginBottom: spacing.md },
  recapIntro: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500 },
  suggest: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green700, paddingVertical: spacing.sm },
  labelFirst: { marginTop: 0 },
  details: { marginTop: spacing.md, marginBottom: spacing.md },
  detailsHint: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500, marginTop: spacing.sm },
  strip: { gap: spacing.sm, paddingVertical: spacing.md },
  thumbWrap: { width: 96, height: 96, borderRadius: radii.md, overflow: "hidden" },
  thumb: { width: 96, height: 96, backgroundColor: colors.cream100 },
  thumbOverlay: {
    position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: "rgba(12,32,56,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbFailed: { backgroundColor: "rgba(168,58,43,0.85)" },
  thumbFailedText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.cream50, marginTop: 2 },
  thumbRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(12,32,56,0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  pick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pickDisabled: { opacity: 0.45 },
  pickLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  pickCount: { marginLeft: "auto", fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  label: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.ink900, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  hit: { paddingVertical: spacing.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  hitName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  hitMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  chosen: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.green100,
    borderRadius: radii.md,
    padding: spacing.sm + 4,
  },
  chosenText: { flex: 1 },
  chosenName: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  chosenMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  change: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  audiences: { gap: spacing.sm },
  audience: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm + 6,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  audienceActive: { backgroundColor: colors.green700, borderColor: colors.green700 },
  audienceLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  audienceLabelActive: { color: colors.cream50 },
  warn: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, marginTop: spacing.md },
});
