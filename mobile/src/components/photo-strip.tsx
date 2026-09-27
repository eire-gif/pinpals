import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { UploadedPhoto } from "@/lib/listings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The photos on a new listing, while they are still going up.
 *
 * Each photo is uploaded the moment it is picked rather than all of them at
 * the end. That is what makes a failure survivable: a photo that didn't make
 * it is one thumbnail with a retry on it, not a whole listing to fill in
 * again. It is also why the local `uri` is kept alongside the uploaded url —
 * the thumbnail shows the file on the phone, so it appears instantly and
 * keeps appearing if the upload fails.
 *
 * The first photo is the cover, and it says so. `listings.image_url` — the
 * column the marketplace grid, the listing card and every share preview read
 * — is set from position 0, so which photo comes first is a real decision and
 * not a detail of the order they were picked in.
 */

export type Photo = {
  /** Stable across re-renders and retries; not the uri, which can repeat. */
  id: string;
  /** The file on this phone, for the thumbnail. */
  uri: string;
  status: "uploading" | "done" | "failed";
  uploaded?: UploadedPhoto;
  error?: string;
};

const SIZE = 104;

export function PhotoStrip({
  photos,
  max,
  onAdd,
  onRemove,
  onRetry,
}: {
  photos: Photo[];
  max: number;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const failed = photos.filter((photo) => photo.status === "failed");

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        keyboardShouldPersistTaps="handled"
      >
        {photos.map((photo, index) => (
          <View key={photo.id} style={styles.tile}>
            <Image source={{ uri: photo.uri }} style={styles.image} />

            {photo.status === "uploading" ? (
              <View style={styles.veil}>
                <Ionicons name="cloud-upload-outline" size={20} color={colors.cream50} />
              </View>
            ) : null}

            {photo.status === "failed" ? (
              <Pressable
                style={[styles.veil, styles.veilFailed]}
                onPress={() => onRetry(photo.id)}
                accessibilityRole="button"
                accessibilityLabel="Retry this photo"
              >
                <Ionicons name="refresh" size={20} color={colors.cream50} />
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            ) : null}

            {index === 0 && photo.status === "done" ? (
              <View style={styles.cover}>
                <Text style={styles.coverLabel}>Cover</Text>
              </View>
            ) : null}

            <Pressable
              style={styles.remove}
              onPress={() => onRemove(photo.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove this photo"
            >
              <Ionicons name="close" size={14} color={colors.cream50} />
            </Pressable>
          </View>
        ))}

        {photos.length < max ? (
          <Pressable
            style={styles.add}
            onPress={onAdd}
            accessibilityRole="button"
            accessibilityLabel="Add a photo"
          >
            <Ionicons name="camera-outline" size={26} color={colors.green700} />
            <Text style={styles.addLabel}>
              {photos.length === 0 ? "Add photos" : "Add"}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {failed.length > 0 ? (
        <Text style={styles.error}>
          {failed[0].error ??
            (failed.length === 1
              ? "One photo didn't upload. Tap it to try again."
              : `${failed.length} photos didn't upload. Tap each to try again.`)}
        </Text>
      ) : (
        <Text style={styles.hint}>
          {photos.length === 0
            ? `The first photo is the one buyers see. Up to ${max}.`
            : `${photos.length} of ${max}. Drag isn't in yet — remove and re-add to change the cover.`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  strip: { gap: spacing.sm, paddingRight: spacing.md },

  tile: {
    width: SIZE,
    height: SIZE,
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceTint,
    borderWidth: 1,
    borderColor: colors.line,
  },
  image: { width: "100%", height: "100%" },

  veil: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: "rgba(12,32,56,0.55)",
  },
  veilFailed: { backgroundColor: "rgba(168,58,43,0.72)" },
  retry: { fontFamily: fonts.bodyBold, fontSize: 11.5, color: colors.cream50 },

  // Gold with ink on it, never white — the palette note in theme.ts.
  cover: {
    position: "absolute",
    left: 6,
    bottom: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
  },
  coverLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, color: colors.ink900 },

  remove: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(14,21,32,0.66)",
  },

  add: {
    width: SIZE,
    height: SIZE,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.green600,
    backgroundColor: colors.green100,
  },
  addLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },

  hint: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.red600 },
});
