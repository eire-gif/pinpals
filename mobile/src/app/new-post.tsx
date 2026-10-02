import { useCallback, useEffect, useState } from "react";
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
} from "react-native";
import { Stack, router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";

import { createPost, discardPhoto, stagePhoto, type StagedPhoto } from "@/lib/feed";
import {
  MAX_POST_BODY,
  MAX_POST_PHOTOS,
  POST_VISIBILITIES,
  POST_VISIBILITY_LABELS,
  draftProblem,
  type PostVisibility,
} from "@/lib/feed-rules";
import { COUNTRY_NAMES, searchClubs, type ClubHit } from "@/lib/tee-time-post";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

type Photo = {
  id: string;
  uri: string;
  status: "uploading" | "done" | "failed";
  staged?: StagedPhoto;
  error?: string;
};

let nextId = 0;

/**
 * Sharing a post.
 *
 * Photos upload the moment they are picked, one request each — the same
 * shape as listing photos, for the same two reasons: a failure is one
 * thumbnail with a retry on it rather than a whole post to write again, and
 * a request to the website cannot carry six phone photos at once. Nothing
 * is visible to anyone until Post is pressed; staged photos sit in a folder
 * no member can read.
 */
export default function NewPostScreen() {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("members");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [club, setClub] = useState<ClubHit | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClubHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [posting, setPosting] = useState(false);

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

  const upload = useCallback(async (photo: Photo, mimeType: string, fileName: string) => {
    try {
      const staged = await stagePhoto({ uri: photo.uri, name: fileName, type: mimeType });
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

  const pick = useCallback(
    async (source: "camera" | "library") => {
      const room = MAX_POST_PHOTOS - photos.length;
      if (room <= 0) return;

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

      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              // The server downscales to 2000px regardless; sending the
              // 12-megapixel original only buys a slower upload from the
              // car park and a likelier rejection.
              quality: 0.8,
              allowsMultipleSelection: true,
              selectionLimit: room,
            });
      if (result.canceled) return;

      const added = result.assets.slice(0, room).map((asset) => ({
        photo: { id: String(++nextId), uri: asset.uri, status: "uploading" as const },
        type: asset.mimeType ?? "image/jpeg",
        name: asset.fileName ?? `photo-${nextId}.jpg`,
      }));
      setPhotos((prev) => [...prev, ...added.map((a) => a.photo)]);
      for (const a of added) void upload(a.photo, a.type, a.name);
    },
    [photos.length, upload]
  );

  function remove(photo: Photo) {
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    if (photo.staged) void discardPhoto(photo.staged.path);
  }

  function retry(photo: Photo) {
    const again = { ...photo, status: "uploading" as const, error: undefined };
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? again : p)));
    void upload(again, "image/jpeg", `photo-${photo.id}.jpg`);
  }

  const uploading = photos.some((p) => p.status === "uploading");
  const failed = photos.some((p) => p.status === "failed");
  const problem = draftProblem(body, photos.length);
  const canPost = !posting && !uploading && !failed && problem === null;

  async function post() {
    if (!canPost) return;
    setPosting(true);
    try {
      await createPost({
        body,
        visibility,
        clubId: club?.id ?? null,
        photoPaths: photos.map((p) => p.staged!.path),
      });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't post that", err instanceof Error ? err.message : "Please try again.");
      setPosting(false);
    }
  }

  function cancel() {
    if (body.trim() || photos.length > 0) {
      Alert.alert("Discard this post?", undefined, [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            for (const p of photos) if (p.staged) void discardPhoto(p.staged.path);
            router.back();
          },
        },
      ]);
    } else {
      router.back();
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "New post",
          presentation: "modal",
          headerLeft: () => (
            <Pressable onPress={cancel} hitSlop={12} accessibilityRole="button">
              <Text style={styles.headerCancel}>Cancel</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={post} disabled={!canPost} hitSlop={12} accessibilityRole="button" accessibilityState={{ disabled: !canPost }}>
              {posting ? (
                <ActivityIndicator color={colors.green700} />
              ) : (
                <Text style={[styles.headerPost, !canPost && styles.headerPostDisabled]}>Post</Text>
              )}
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="How did the round go?"
            placeholderTextColor={colors.ink500}
            multiline
            maxLength={MAX_POST_BODY}
            autoFocus
            style={styles.body}
            accessibilityLabel="Your post"
          />

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

          <View style={styles.pickRow}>
            <Pressable
              style={[styles.pick, photos.length >= MAX_POST_PHOTOS && styles.pickDisabled]}
              onPress={() => void pick("library")}
              disabled={photos.length >= MAX_POST_PHOTOS}
              accessibilityRole="button"
            >
              <Ionicons name="images-outline" size={20} color={colors.green700} />
              <Text style={styles.pickLabel}>Photos</Text>
            </Pressable>
            <Pressable
              style={[styles.pick, photos.length >= MAX_POST_PHOTOS && styles.pickDisabled]}
              onPress={() => void pick("camera")}
              disabled={photos.length >= MAX_POST_PHOTOS}
              accessibilityRole="button"
            >
              <Ionicons name="camera-outline" size={20} color={colors.green700} />
              <Text style={styles.pickLabel}>Camera</Text>
            </Pressable>
            <Text style={styles.pickCount}>
              {photos.length}/{MAX_POST_PHOTOS}
            </Text>
          </View>

          <Text style={styles.label}>Course (optional)</Text>
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

          {failed && <Text style={styles.warn}>Retry or remove the photos that didn&apos;t upload, then post.</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  headerCancel: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500 },
  headerPost: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },
  headerPostDisabled: { color: colors.ink500, opacity: 0.6 },
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
